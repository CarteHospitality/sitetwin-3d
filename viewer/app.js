// SiteTwin 3D change planner: edit antennas on the twin, see EMF zones,
// conflicts and indicative coverage update live, compare with the baseline.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { REGIMES, siteZones } from "./emf.js";
import { checkSite, pointInPolygon, roofOf } from "./checks.js";
import { coverageGrid, paintCoverage, RSRP_BINS } from "./coverage.js";
import { initAgent, replyHtml } from "./agent.js";
import { populationContext } from "./population.js";
import { initVoice } from "./voice.js";
import { fieldWorkOrder } from "./fieldwork.js";

const BAND_PRESETS = {
  L800: { name: "L800", frequency_mhz: 800, tx_power_w: 20, gain_dbi: 15.0, horizontal_beamwidth_deg: 65, vertical_beamwidth_deg: 9, front_to_back_db: 25, feeder_loss_db: 0 },
  L1800: { name: "L1800", frequency_mhz: 1800, tx_power_w: 20, gain_dbi: 17.5, horizontal_beamwidth_deg: 65, vertical_beamwidth_deg: 6, front_to_back_db: 25, feeder_loss_db: 0 },
  L2100: { name: "L2100", frequency_mhz: 2100, tx_power_w: 20, gain_dbi: 18.0, horizontal_beamwidth_deg: 65, vertical_beamwidth_deg: 5, front_to_back_db: 25, feeder_loss_db: 0 },
  N3500: { name: "N3500", frequency_mhz: 3500, tx_power_w: 80, gain_dbi: 22.0, horizontal_beamwidth_deg: 65, vertical_beamwidth_deg: 7, front_to_back_db: 30, feeder_loss_db: 0 },
};

const clone = (o) => JSON.parse(JSON.stringify(o));
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};

// ---------- state ----------
const params = new URLSearchParams(location.search);
const src = params.get("twin") || "data/site.twin.json";
const portfolioUrl = params.get("portfolio") || "data/private/portfolio.json";
const backTo = params.get("from") || `portfolio.html${params.get("portfolio") ? `?portfolio=${encodeURIComponent(portfolioUrl)}` : ""}`;
const twin = await (await fetch(src)).json();
// A twin may carry the existing state separately (e.g. SiteTwin's retain/remove
// antennas); the plan starts from the proposed site and is compared with it.
const baseline = twin.baseline ?? twin.site;
let site = clone(twin.site);
let selectedId = null;
let regimeKey = "tr";
const layers = { zones: true, coverage: false, baseline: false };
let coverageBand = null;

// ---------- scene ----------
// x = East, y = Up, z = South; azimuth clockwise from North (-z).
// three.js puts angle theta at (sin theta, cos theta) in x/z, so azimuth a maps to theta = PI - a.
const azToTheta = (deg) => Math.PI - THREE.MathUtils.degToRad(deg);
const host = $("scene");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
host.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f1115);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 3000);
camera.position.set(55, 70, 75);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, baseline.building.height_m, 0);
scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.0));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(30, 80, 20);
scene.add(sun);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ color: 0x1d222b }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
scene.add(new THREE.GridHelper(600, 120, 0x2c3340, 0x232833));

// A footprint is extruded to its height; without one, a box from the bounds.
// Shape points are (x, -z) so that rotating the extrusion upright lands them back on z.
function buildingMesh(item, height, color) {
  const mat = new THREE.MeshLambertMaterial({ color });
  if (!item.footprint) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(item.width_m, height, item.depth_m), mat);
    m.position.set(item.x_m ?? 0, height / 2, item.z_m ?? 0);
    return m;
  }
  const shape = new THREE.Shape(item.footprint.map(([x, z]) => new THREE.Vector2(x, -z)));
  const m = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false }), mat);
  m.rotation.x = -Math.PI / 2;
  return m;
}

const b = baseline.building;
const roof = roofOf(b);
// Antennas may move between just above the roof (or compound) and 10 m above today's highest one.
const HEIGHT_RANGE = [b.height_m + 1, Math.round(Math.max(b.height_m + 15, ...twin.site.antennas.map((a) => a.height_agl_m + 10)))];
const roofBounds = roof.bounds;
const onRoof = roof.contains;
scene.add(buildingMesh(b, b.height_m, 0x8a919e));
scene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, b.height_m + 0.1, roofBounds.z0 - 1), 6, 0x4096ff, 1.5, 1));

const neighbourMeshes = {};
for (const n of baseline.neighbours ?? []) {
  const m = buildingMesh(n, n.height_m, 0x4b5263);
  scene.add(m);
  neighbourMeshes[n.id] = m;
}
for (const e of baseline.equipment) {
  const [w, h, d] = e.size_m;
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: 0x597ef7 }));
  box.position.set(e.x_m, e.height_agl_m + h / 2, e.z_m);
  scene.add(box);
}

const antennaGroup = new THREE.Group();
const zoneGroup = new THREE.Group();
const baselineGroup = new THREE.Group();
scene.add(antennaGroup, zoneGroup, baselineGroup);

// Size the canvas before the texture exists: three.js allocates GPU storage at
// the first upload, and a later size change would only fill part of it.
const COVERAGE_CELLS = 150;
const coverageCanvas = Object.assign(document.createElement("canvas"), { width: COVERAGE_CELLS, height: COVERAGE_CELLS });
const coverageTexture = new THREE.CanvasTexture(coverageCanvas);
coverageTexture.magFilter = THREE.NearestFilter;
const coveragePlane = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshBasicMaterial({ map: coverageTexture, transparent: true, depthWrite: false }));
coveragePlane.rotation.x = -Math.PI / 2;
coveragePlane.position.y = 0.05;
coveragePlane.visible = false;
scene.add(coveragePlane);

const poleMat = new THREE.MeshLambertMaterial({ color: 0x5c6370 });
function antennaMesh(a, selected) {
  const g = new THREE.Group();
  const poleLen = a.height_agl_m - b.height_m + a.length_m / 2;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, poleLen), poleMat);
  pole.position.set(a.x_m, b.height_m + poleLen / 2, a.z_m);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.35, a.length_m, 0.14), new THREE.MeshLambertMaterial({ color: selected ? 0x4096ff : 0xf0f0f0 }));
  panel.position.set(a.x_m, a.height_agl_m, a.z_m);
  panel.rotation.y = azToTheta(a.azimuth_deg);
  panel.translateZ(0.2);
  panel.rotateX(-THREE.MathUtils.degToRad(a.mechanical_tilt_deg));
  panel.userData.antennaId = a.id;
  g.add(pole, panel);
  return g;
}

const zoneMat = (color, wire = false) => wire
  ? new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.12 })
  : new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
function zoneMeshes(a, z, wire) {
  const hbw = THREE.MathUtils.degToRad(z.horizontal_beamwidth_deg);
  const front = new THREE.Mesh(
    new THREE.CylinderGeometry(z.front_m, z.front_m, 2 * z.half_height_m, wire ? 12 : 48, 1, false, azToTheta(a.azimuth_deg) - hbw / 2, hbw),
    zoneMat(wire ? 0xbfbfbf : 0xff4d4f, wire),
  );
  front.position.set(a.x_m, a.height_agl_m, a.z_m);
  const back = new THREE.Mesh(new THREE.CylinderGeometry(z.back_m, z.back_m, a.length_m, 24), zoneMat(wire ? 0xbfbfbf : 0xffa940, wire));
  back.position.copy(front.position);
  return [front, back];
}

function clearGroup(g) {
  for (const c of [...g.children]) {
    g.remove(c);
    c.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  }
}

// ---------- analysis ----------
const FIELDS = { azimuth_deg: "azimuth", mechanical_tilt_deg: "mech. tilt", electrical_tilt_deg: "elec. tilt", height_agl_m: "height", x_m: "x", z_m: "z" };
function diffSites(before, after) {
  const changes = [];
  const prev = Object.fromEntries(before.antennas.map((a) => [a.id, a]));
  const next = Object.fromEntries(after.antennas.map((a) => [a.id, a]));
  for (const a of after.antennas) {
    const p = prev[a.id];
    if (!p) { changes.push(`Add ${a.id} at ${a.azimuth_deg}° (${a.bands.map((x) => x.name).join(", ")})`); continue; }
    for (const [k, label] of Object.entries(FIELDS)) if (p[k] !== a[k]) changes.push(`${a.id} ${label}: ${p[k]} → ${a[k]}`);
    const pb = Object.fromEntries(p.bands.map((x) => [x.name, x]));
    const nb = Object.fromEntries(a.bands.map((x) => [x.name, x]));
    for (const name of Object.keys(nb)) {
      if (!pb[name]) changes.push(`${a.id} add band ${name}`);
      else if (pb[name].tx_power_w !== nb[name].tx_power_w) changes.push(`${a.id} ${name} power: ${pb[name].tx_power_w} → ${nb[name].tx_power_w} W`);
    }
    for (const name of Object.keys(pb)) if (!nb[name]) changes.push(`${a.id} remove band ${name}`);
  }
  for (const id of Object.keys(prev)) if (!next[id]) changes.push(`Remove ${id}`);
  return changes;
}

// ---------- planner API used by the assistant ----------
const EDITABLE = ["azimuth_deg", "mechanical_tilt_deg", "electrical_tilt_deg", "height_agl_m", "x_m", "z_m"];
function applyChanges(s, changes) {
  const out = clone(s);
  const errors = [];
  const bld = out.building;
  for (const c of changes ?? []) {
    if (c.action === "add_antenna") {
      if (out.antennas.some((a) => a.id === c.antenna_id)) { errors.push(`${c.antenna_id} already exists`); continue; }
      out.antennas.push({
        id: c.antenna_id, sector: null, azimuth_deg: 0, mechanical_tilt_deg: 0, electrical_tilt_deg: 6,
        height_agl_m: bld.height_m + 4, x_m: 0, z_m: 0, manufacturer: null, model: "5G AAU", length_m: 0.9,
        bands: [], source_photos: [], confidence: null,
      });
    }
    const a = out.antennas.find((x) => x.id === c.antenna_id);
    if (!a) { errors.push(`no antenna ${c.antenna_id}`); continue; }
    if (c.action === "remove_antenna") { out.antennas = out.antennas.filter((x) => x !== a); continue; }
    for (const k of EDITABLE) if (typeof c[k] === "number") a[k] = c[k];
    for (const name of c.add_bands ?? []) if (BAND_PRESETS[name] && !a.bands.some((x) => x.name === name)) a.bands.push(clone(BAND_PRESETS[name]));
    a.bands = a.bands.filter((x) => !(c.remove_bands ?? []).includes(x.name));
    for (const [name, w] of Object.entries(c.band_power_w ?? {})) {
      const band = a.bands.find((x) => x.name === name);
      if (band) band.tx_power_w = w; else errors.push(`${a.id} has no band ${name}`);
    }
    if (c.action === "add_antenna" && !a.bands.length) a.bands.push(clone(BAND_PRESETS.N3500));
    if (!onRoof(a.x_m, a.z_m)) errors.push(`${a.id} is off the roof`);
    if (a.height_agl_m < HEIGHT_RANGE[0] || a.height_agl_m > HEIGHT_RANGE[1]) errors.push(`${a.id} height out of range (${HEIGHT_RANGE.join('-')} m)`);
    if (a.bands.some((x) => x.tx_power_w < 1 || x.tx_power_w > 240)) errors.push(`${a.id} power out of range`);
  }
  return { site: out, errors };
}

function coverageMetric(s) {
  const result = {};
  for (const name of [...new Set(s.antennas.flatMap((a) => a.bands.map((x) => x.name)))]) {
    const { grid, n, size } = coverageGrid(s, name, 600, 60);
    const cell = (size / n) ** 2 / 1e6;
    let good = 0, fair = 0;
    for (const v of grid) { if (v >= -90) good++; if (v >= -100) fair++; }
    result[name] = { km2_above_minus90dBm: +(good * cell).toFixed(3), km2_above_minus100dBm: +(fair * cell).toFixed(3) };
  }
  return result;
}

function summarize(s) {
  const zones = siteZones(s, REGIMES[regimeKey]);
  const zoneById = Object.fromEntries(zones.map((z) => [z.antenna_id, z]));
  const { findings } = checkSite(s, zones);
  return {
    antennas: s.antennas.map((a) => ({
      id: a.id, azimuth_deg: a.azimuth_deg, mechanical_tilt_deg: a.mechanical_tilt_deg, electrical_tilt_deg: a.electrical_tilt_deg,
      height_agl_m: a.height_agl_m, x_m: a.x_m, z_m: a.z_m,
      bands: a.bands.map((x) => `${x.name} ${x.tx_power_w} W`), zone_front_m: zoneById[a.id]?.front_m ?? 0,
    })),
    neighbour_conflicts: findings.filter((f) => f.level === "bad").map((f) => f.text),
    roof_restrictions: findings.filter((f) => f.level === "warn").map((f) => f.text),
    coverage: coverageMetric(s),
  };
}

const planner = {
  get site() { return site; },
  roofBounds,
  heightRange: HEIGHT_RANGE,
  state: () => ({ regime: REGIMES[regimeKey].name, current_plan: summarize(site), baseline: summarize(baseline), neighbours: site.neighbours }),
  evaluate(changes) {
    const { site: candidate, errors } = applyChanges(site, changes);
    return errors.length ? { errors } : summarize(candidate);
  },
  apply(changes, reason) {
    const { site: candidate, errors } = applyChanges(site, changes);
    if (errors.length) return { errors };
    undoStack.push(site);
    site = candidate;
    selectedId = changes[0]?.antenna_id ?? selectedId;
    refreshCoverageBands();
    update();
    renderEditor();
    return { applied: true, reason, result: summarize(site) };
  },
  undo() {
    if (!undoStack.length) return { error: "nothing to undo" };
    site = undoStack.pop();
    refreshCoverageBands();
    update();
    renderEditor();
    return { undone: true, result: summarize(site) };
  },
  population: () => populationContext(site),
  fieldWork: () => fieldWorkOrder(baseline, site, checkSite(site, siteZones(site, REGIMES[regimeKey]))),
  listSites: async () => (await portfolioIndex()).sites.map((s) => ({ site_id: s.site_id, structure: s.structure, technology: s.technology, pending_change: s.reason })),
  async openSite({ site_id, instruction }) {
    const s = (await portfolioIndex()).sites.find((x) => x.site_id.toLowerCase().includes(String(site_id).toLowerCase()));
    if (!s) return { error: `no site ${site_id} in the portfolio` };
    const p = new URLSearchParams({ twin: s.twin, ...(instruction ? { ask: instruction } : { auto: "review" }), from: backTo, portfolio: portfolioUrl });
    if (agent.voice) p.set("voice", "1");
    pendingOpen = `index.html?${p}`;
    return { opening: s.site_id, instruction: instruction ?? "full review" };
  },
  setView({ zones, coverage, baseline: showBaseline, coverage_band, select_antenna }) {
    for (const [k, v] of Object.entries({ zones, coverage, baseline: showBaseline })) if (typeof v === "boolean") layers[k] = v;
    if (coverage_band && bandNames().includes(coverage_band)) coverageBand = coverage_band;
    if (select_antenna !== undefined) selectedId = site.antennas.some((a) => a.id === select_antenna) ? select_antenna : null;
    syncLayerChips();
    update();
    renderEditor();
    return { layers, coverage_band: coverageBand, selected: selectedId };
  },
};
const undoStack = [];
let pendingOpen = null;
let portfolioCache = null;
async function portfolioIndex() {
  portfolioCache ??= await fetch(portfolioUrl).then((r) => (r.ok ? r.json() : fetch("data/samples/portfolio.json").then((x) => x.json())));
  return portfolioCache;
}

// ---------- UI ----------
function renderEditor() {
  const a = site.antennas.find((x) => x.id === selectedId);
  $("editor").hidden = !a;
  if (!a) return;
  $("editId").textContent = a.id;
  for (const input of document.querySelectorAll("#editor input[type=range]")) {
    input.value = a[input.dataset.k];
    input.nextElementSibling.textContent = a[input.dataset.k];
  }
  const bands = $("bands");
  bands.replaceChildren();
  for (const band of a.bands) {
    const out = el("output", { textContent: `${band.tx_power_w} W` });
    const range = el("input", { type: "range", min: 1, max: band.frequency_mhz > 3000 ? 240 : 80, step: 1, value: band.tx_power_w });
    range.oninput = () => { band.tx_power_w = Number(range.value); out.textContent = `${band.tx_power_w} W`; update(); };
    const del = el("button", { textContent: "×", title: `Remove ${band.name}` });
    del.onclick = () => { a.bands = a.bands.filter((x) => x !== band); update(); renderEditor(); };
    bands.append(el("div", { className: "row" }, el("label", { textContent: band.name }), range, out, del));
  }
}

function renderPanels(zones, checks, changes) {
  const zoneById = Object.fromEntries(zones.map((z) => [z.antenna_id, z]));
  const tbody = $("antennas");
  tbody.replaceChildren();
  for (const a of site.antennas) {
    const z = zoneById[a.id];
    const tr = el("tr", { className: a.id === selectedId ? "sel" : "" },
      ...[a.id, `${a.azimuth_deg}°`, `${a.mechanical_tilt_deg + a.electrical_tilt_deg}°`, a.bands.map((x) => x.name).join(" "), z ? `${z.front_m} m` : "–"].map((t) => el("td", { textContent: t })));
    tr.style.cursor = "pointer";
    tr.onclick = () => select(a.id);
    tbody.append(tr);
  }
  $("checks").replaceChildren(...checks.findings.map((f) => el("li", { className: f.level, textContent: f.text })));
  $("changes").replaceChildren(...(changes.length ? changes.map((c) => el("li", { textContent: c })) : [el("li", { className: "muted", textContent: "No changes yet" })]));
  for (const [id, m] of Object.entries(neighbourMeshes)) m.material.color.set(checks.hit.has(id) ? 0x8c2f39 : 0x4b5263);
  renderFieldWork(fieldWorkOrder(baseline, site, checks));
}

function renderFieldWork(order) {
  const box = $("fieldwork");
  if (!order.items.length) return box.replaceChildren(el("div", { className: "muted", textContent: order.summary }));
  const list = (title, items) => items.length ? [el("div", { className: "muted", textContent: title }), el("ul", {}, ...items.map((t) => el("li", { textContent: t })))] : [];
  box.replaceChildren(
    el("div", { textContent: order.summary }),
    ...order.items.flatMap((i) => [
      el("div", { className: "wo-head", textContent: `${i.antenna}: ${i.change}` }),
      ...list("Work steps", i.steps), ...list("Materials", i.materials), ...list("Precautions", i.precautions),
    ]),
    ...list("Site-wide", order.general),
  );
}

let coverageTimer = null;
function renderCoverage() {
  clearTimeout(coverageTimer);
  coveragePlane.visible = layers.coverage;
  if (!layers.coverage) return;
  coverageTimer = setTimeout(() => {
    paintCoverage(coverageCanvas, coverageGrid(site, coverageBand, 600, COVERAGE_CELLS));
    coverageTexture.needsUpdate = true;
  }, 60);
}

function renderLegend() {
  const items = [
    ["#ff4d4f", "EMF zone, main lobe"], ["#ffa940", "EMF zone, back lobe"], ["#8c2f39", "Neighbour inside a zone"],
  ];
  if (layers.baseline) items.push(["#bfbfbf", "Baseline zones (wireframe)"]);
  if (layers.coverage) items.push(...RSRP_BINS.map((b) => [`rgb(${b.color})`, `${coverageBand} ${b.label}`]));
  $("legend").replaceChildren(...items.map(([c, t]) => el("div", {}, el("span", { className: "sw", style: `background:${c}` }), t)));
  if (layers.coverage) $("legend").append(el("div", { className: "muted", textContent: "Coverage is indicative (Hata model, no terrain)." }));
}

function update() {
  const regime = REGIMES[regimeKey];
  const zones = siteZones(site, regime);
  clearGroup(antennaGroup);
  clearGroup(zoneGroup);
  clearGroup(baselineGroup);
  for (const a of site.antennas) antennaGroup.add(antennaMesh(a, a.id === selectedId));
  const byId = Object.fromEntries(site.antennas.map((a) => [a.id, a]));
  if (layers.zones) for (const z of zones) zoneGroup.add(...zoneMeshes(byId[z.antenna_id], z, false));
  if (layers.baseline) {
    const baseById = Object.fromEntries(baseline.antennas.map((a) => [a.id, a]));
    for (const z of siteZones(baseline, regime)) baselineGroup.add(...zoneMeshes(baseById[z.antenna_id], z, true));
  }
  renderPanels(zones, checkSite(site, zones), diffSites(baseline, site));
  renderCoverage();
  renderLegend();
}

function select(id) {
  selectedId = id;
  update();
  renderEditor();
}

function bandNames() {
  return [...new Set(site.antennas.flatMap((a) => a.bands.map((x) => x.name)))];
}
function refreshCoverageBands() {
  const names = bandNames();
  if (!names.includes(coverageBand)) coverageBand = names[0] ?? null;
  $("coverageBand").replaceChildren(...names.map((n) => el("option", { value: n, textContent: n, selected: n === coverageBand })));
}

// ---------- wiring ----------
for (const input of document.querySelectorAll("#editor input[type=range]")) {
  const k = input.dataset.k;
  if (k === "height_agl_m") Object.assign(input, { min: HEIGHT_RANGE[0], max: HEIGHT_RANGE[1] });
  if (k === "x_m") Object.assign(input, { min: roofBounds.x0, max: roofBounds.x1 });
  if (k === "z_m") Object.assign(input, { min: roofBounds.z0, max: roofBounds.z1 });
  input.oninput = () => {
    const a = site.antennas.find((x) => x.id === selectedId);
    a[k] = Number(input.value);
    input.nextElementSibling.textContent = a[k];
    update();
  };
}
$("bandPreset").replaceChildren(...Object.keys(BAND_PRESETS).map((n) => el("option", { value: n, textContent: n })));
$("addBand").onclick = () => {
  const a = site.antennas.find((x) => x.id === selectedId);
  const preset = BAND_PRESETS[$("bandPreset").value];
  if (a.bands.some((x) => x.name === preset.name)) return;
  a.bands.push(clone(preset));
  refreshCoverageBands();
  update();
  renderEditor();
};
$("removeAntenna").onclick = () => {
  site.antennas = site.antennas.filter((x) => x.id !== selectedId);
  selectedId = null;
  refreshCoverageBands();
  update();
  renderEditor();
};
$("addAntenna").onclick = () => {
  let i = site.antennas.length + 1;
  while (site.antennas.some((a) => a.id === `S${i}-N`)) i++;
  site.antennas.push({
    id: `S${i}-N`, sector: String(i), azimuth_deg: 0, mechanical_tilt_deg: 0, electrical_tilt_deg: 6,
    height_agl_m: b.height_m + 4, x_m: 0, z_m: 0, manufacturer: null, model: "5G AAU", length_m: 0.9,
    bands: [clone(BAND_PRESETS.N3500)], source_photos: [], confidence: null,
  });
  refreshCoverageBands();
  select(`S${i}-N`);
};
$("reset").onclick = () => { site = clone(baseline); selectedId = null; refreshCoverageBands(); update(); renderEditor(); };
$("export").onclick = () => {
  const regime = REGIMES[regimeKey];
  const zones = siteZones(site, regime);
  const plan = {
    site_id: site.site_id, regime: regime.name, created: new Date().toISOString(),
    changes: diffSites(baseline, site), checks: checkSite(site, zones).findings,
    zones, baseline, proposed: site,
  };
  const a = el("a", { href: URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" })), download: `${site.site_id}-plan.json` });
  a.click();
  URL.revokeObjectURL(a.href);
};
$("regime").onchange = (e) => { regimeKey = e.target.value; update(); };
$("coverageBand").onchange = (e) => { coverageBand = e.target.value; renderCoverage(); renderLegend(); };
function syncLayerChips() {
  for (const chip of document.querySelectorAll(".chip[data-layer]")) chip.classList.toggle("on", layers[chip.dataset.layer]);
  $("coverageRow").hidden = !layers.coverage;
  refreshCoverageBands();
}
for (const chip of document.querySelectorAll(".chip[data-layer]")) {
  chip.onclick = () => {
    layers[chip.dataset.layer] = !layers[chip.dataset.layer];
    syncLayerChips();
    update();
  };
}

const raycaster = new THREE.Raycaster();
let downAt = null;
renderer.domElement.addEventListener("pointerdown", (e) => (downAt = [e.clientX, e.clientY]));
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
  const r = renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hit = raycaster.intersectObjects(antennaGroup.children, true).find((h) => h.object.userData.antennaId);
  select(hit ? hit.object.userData.antennaId : null);
});

// ---------- assistant chat ----------
const log = $("chatLog");
const say = (cls, text) => {
  log.append(cls === "assistant" ? el("div", { className: `msg ${cls}`, innerHTML: replyHtml(text) }) : el("div", { className: `msg ${cls}`, textContent: text }));
  log.scrollTop = log.scrollHeight;
};
const fmtChange = (c) => {
  const parts = Object.entries(c).filter(([k]) => !["action", "antenna_id"].includes(k)).map(([k, v]) => `${k.replace(/_deg|_m$|_w$/g, "")}=${typeof v === "object" ? JSON.stringify(v) : v}`);
  return `${c.action === "modify" ? "" : c.action + " "}${c.antenna_id} ${parts.join(" ")}`.trim();
};
const agent = initAgent(planner, {
  user: (t) => say("user", t),
  assistant: (t) => say("assistant", t),
  model: (m) => ($("chatModel").textContent = m),
  busy: (on) => {
    $("chatSend").disabled = on;
    $("chatInput").disabled = on;
    $("chatBusy").textContent = "Thinking and testing options on the twin…";
    $("chatBusy").hidden = !on;
    if (!on && pendingOpen) setTimeout(() => (location.href = pendingOpen), agent.voice ? 4000 : 1500);
  },
  tool: (name, args, result) => {
    if (name === "get_site_state") return say("tool", "🔎 Reading the twin…");
    if (name === "get_population_context") return say("tool", `👥 Checking who is around the site (${result.total_people_nearby ?? "?"} people, estimated)…`);
    if (name === "set_view") return say("tool", "👁 Adjusting the view");
    if (name === "get_field_work_order") return say("tool", `🛠 Preparing the field work order (${result.summary ?? ""})`);
    if (name === "list_sites") return say("tool", "🗺 Looking up the portfolio…");
    if (name === "open_site") return say("tool", result.error ? `✖ ${result.error}` : `🧭 Opening ${result.opening}…`);
    if (result.error) return say("tool", `✖ ${name}: ${result.error}`);
    if (name === "undo_last_change") return say("tool", "↩ Undid the last change");
    const what = (args.changes ?? []).map(fmtChange).join("; ");
    if (result.errors) return say("tool", `✖ ${what}: ${result.errors.join(", ")}`);
    const r = result.result ?? result;
    const verdict = `${r.neighbour_conflicts.length} neighbour conflict(s), ${r.roof_restrictions.length} roof restriction(s)`;
    say("tool", `${name === "apply_change" ? "✅ Applied" : "🧪 Tried"} ${what} → ${verdict}`);
  },
  speak: (t) => voice.speak(t),
});
const voice = initVoice({
  button: $("micButton"),
  status: (t) => ($("chatBusy").hidden = !t, t && ($("chatBusy").textContent = t)),
  onText: (t) => agent.ask(t, { voice: true }),
});
const send = () => {
  const text = $("chatInput").value.trim();
  if (!text) return;
  $("chatInput").value = "";
  agent.ask(text);
};
$("chatSend").onclick = send;
$("chatInput").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };
for (const s of document.querySelectorAll(".suggest")) s.onclick = () => agent.ask(s.textContent);

$("title").textContent = site.site_id;
$("subtitle").textContent = site.name ?? "";
$("notes").textContent = site.notes.join(" ");
$("backToMap").href = backTo;
refreshCoverageBands();
update();
// Opened from the portfolio map: the Expert Operator carries out what was asked
// there, or reviews the site straight away.
if (params.get("ask")) {
  agent.ask(params.get("ask"), { voice: params.get("voice") === "1" });
} else if (params.get("auto") === "review") {
  agent.ask("Review this site like an operator: what is the most important problem, what would you change and why? Apply the best fix and give the before/after numbers.");
}

function resize() {
  const { clientWidth: w, clientHeight: h } = host;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(host);
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
