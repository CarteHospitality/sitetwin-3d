// SiteTwin 3D change planner: edit antennas on the twin, see EMF zones,
// conflicts and indicative coverage update live, compare with the baseline.

import { tr } from "./i18n.js";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { REGIMES, siteZones } from "./emf.js";
import { checkSite, headline, pointInPolygon, roofOf } from "./checks.js";
import { coverageGrid, coverageGridAsync, paintCoverage, RSRP_BINS } from "./coverage.js";
import { initAgent } from "./agent.js";
import { initPhoto, photoRequest, seenLine } from "./photo.js";
import { populationContext } from "./population.js";
import { initVoice } from "./voice.js";
import { initConversation } from "./conversation.js";
import { createSceneMotion } from "./scene.js";
import { restoreProposed, saveProposed, sourceFingerprint, consumeHandoff, handoffId, absoluteUrl } from "./session.js";
import { fieldWorkOrder } from "./fieldwork.js";
import { $, el, token, initShell, setText } from "./ui.js";
import { initCards, showCard, hideCard, setCardSummary } from "./cards.js";
import { crewPlan } from "./crew.js";
import { actionPlan, openActionPlan } from "./actionplan.js";

initShell();
initCards();
const extraToggle = $("extraToggle");
extraToggle.onclick = () => {
  const open = extraToggle.closest(".cards").classList.toggle("show-extra");
  extraToggle.setAttribute("aria-expanded", String(open));
  extraToggle.textContent = open ? "Hide technical details" : "Technical details";
};

const BAND_PRESETS = {
  L800: { name: "L800", frequency_mhz: 800, tx_power_w: 20, gain_dbi: 15.0, horizontal_beamwidth_deg: 65, vertical_beamwidth_deg: 9, front_to_back_db: 25, feeder_loss_db: 0 },
  L1800: { name: "L1800", frequency_mhz: 1800, tx_power_w: 20, gain_dbi: 17.5, horizontal_beamwidth_deg: 65, vertical_beamwidth_deg: 6, front_to_back_db: 25, feeder_loss_db: 0 },
  L2100: { name: "L2100", frequency_mhz: 2100, tx_power_w: 20, gain_dbi: 18.0, horizontal_beamwidth_deg: 65, vertical_beamwidth_deg: 5, front_to_back_db: 25, feeder_loss_db: 0 },
  N3500: { name: "N3500", frequency_mhz: 3500, tx_power_w: 80, gain_dbi: 22.0, horizontal_beamwidth_deg: 65, vertical_beamwidth_deg: 7, front_to_back_db: 30, feeder_loss_db: 0 },
};

const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------- state ----------
const params = new URLSearchParams(location.search);
const src = params.get("twin") || "data/site.twin.json";
const portfolioUrl = params.get("portfolio") || "data/private/portfolio.json";
const backTo = params.get("from") || `portfolio.html${params.get("portfolio") ? `?portfolio=${encodeURIComponent(portfolioUrl)}` : ""}`;
const twin = await fetch(src).then((r) => {
  if (!r.ok) throw new Error(`Twin unavailable (${r.status})`);
  return r.json();
}).catch((error) => { $("loading").textContent = error.message; throw error; });
// A twin may carry the existing state separately (e.g. SiteTwin's retain/remove
// antennas); the plan starts from the proposed site and is compared with it.
const baseline = twin.baseline ?? twin.site;
const restored = restoreProposed(src, twin);
const fingerprint = sourceFingerprint(twin);
let site = clone(restored.site);
let selectedId = site.antennas.some((a) => a.id === restored.view.selected) ? restored.view.selected : null;
let regimeKey = restored.regime;
const layers = { zones: true, coverage: false, baseline: false };
for (const key of Object.keys(layers)) if (typeof restored.view.layers?.[key] === "boolean") layers[key] = restored.view.layers[key];
let coverageBand = restored.view.coverageBand ?? null;
let lastModelState = clone(site);
const planActions = restored.actions.filter((a) => a && typeof a.time === "string" && Array.isArray(a.delta));
let saveTimer = null;
let lastReason = null; // the operator's own words for the latest applied change, for the action plan
let pageActive = true;
window.addEventListener("pagehide", () => { pageActive = false; });
window.addEventListener("pageshow", () => { pageActive = true; });
function saveSessionPlan() {
  clearTimeout(saveTimer);
  const saved = saveProposed(src, twin, { site, regime: regimeKey, actions: planActions,
    view: { selected: selectedId, layers, coverageBand } }, fingerprint);
  if (!saved) $("planSession").textContent = "Session storage unavailable · export the plan to keep it";
}
window.addEventListener("pagehide", saveSessionPlan);


// ---------- scene ----------
// x = East, y = Up, z = South; azimuth clockwise from North (-z).
// three.js puts angle theta at (sin theta, cos theta) in x/z, so azimuth a maps to theta = PI - a.
const azToTheta = (deg) => Math.PI - THREE.MathUtils.degToRad(deg);
const host = $("scene");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
host.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(token("stage"));
scene.fog = new THREE.Fog(token("stage"), 160, 420);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 3000);
camera.position.set(55, 70, 75);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, baseline.building.height_m, 0);
scene.add(new THREE.HemisphereLight(0xffffff, 0xd3dae2, 1.7));
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.position.set(-60, 100, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 1, far: 240 });
sun.shadow.bias = -0.0001;
sun.shadow.normalBias = 0.04;
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun);

// Pinned r160 lighting chunk: retain at least 78% of direct illumination in
// shadow. Hemisphere fill further reduces visible darkness; no extra pass.
function softenShadow(material) {
  material.onBeforeCompile = (shader) => {
    const lights = THREE.ShaderChunk.lights_fragment_begin.replace(/getShadow\( directionalShadowMap[^;]+? \)/g,
      (expression) => `mix(0.78, 1.0, ${expression})`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <lights_fragment_begin>", lights);
  };
  material.customProgramCacheKey = () => "sitetwin-soft-shadow-r160";
  return material;
}

const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), softenShadow(new THREE.MeshStandardMaterial({ color: token("scene-ground"), roughness: 1 })));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
for (const [divisions, opacity] of [[60, 0.06], [12, 0.12]]) {
  const grid = new THREE.GridHelper(300, divisions / 2, token("scene-edge"), token("scene-edge"));
  grid.position.y = 0.02;
  grid.material.transparent = true;
  grid.material.opacity = opacity;
  grid.material.depthWrite = false;
  grid.material.onBeforeCompile = (shader) => {
    shader.vertexShader = "varying vec2 vGroundXZ;\n" + shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvGroundXZ = (modelMatrix * vec4(position, 1.0)).xz;");
    shader.fragmentShader = "varying vec2 vGroundXZ;\n" + shader.fragmentShader.replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.a *= 1.0 - smoothstep(80.0, 150.0, length(vGroundXZ));");
  };
  grid.material.customProgramCacheKey = () => "sitetwin-grid-fade-r160";
  scene.add(grid);
}

// A footprint is extruded to its height; without one, a box from the bounds.
// Shape points are (x, -z) so that rotating the extrusion upright lands them back on z.
function buildingMesh(item, height, color) {
  const mat = softenShadow(new THREE.MeshStandardMaterial({ color, roughness: 0.93, metalness: 0 }));
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
const siteBuilding = buildingMesh(b, b.height_m, token("scene-site"));
siteBuilding.castShadow = siteBuilding.receiveShadow = true;
scene.add(siteBuilding);
const roofEdge = new THREE.LineSegments(new THREE.EdgesGeometry(siteBuilding.geometry, 30), new THREE.LineBasicMaterial({ color: token("scene-edge"), toneMapped: false }));
roofEdge.position.copy(siteBuilding.position); roofEdge.rotation.copy(siteBuilding.rotation);
scene.add(roofEdge);
scene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, b.height_m + 0.1, roofBounds.z0 - 1), 6, token("accent"), 1.5, 1));

const neighbourMeshes = {};
const shadowCasters = new Set([...(baseline.neighbours ?? [])].sort((a, b) => Math.hypot(a.x_m, a.z_m) - Math.hypot(b.x_m, b.z_m)).slice(0, 40).map((n) => n.id));
for (const n of baseline.neighbours ?? []) {
  const m = buildingMesh(n, n.height_m, token("scene-building"));
  m.castShadow = shadowCasters.has(n.id); m.receiveShadow = true;
  scene.add(m);
  neighbourMeshes[n.id] = m;
}
for (const e of baseline.equipment) {
  const [w, h, d] = e.size_m;
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), softenShadow(new THREE.MeshStandardMaterial({ color: token("scene-pole"), roughness: 0.93 })));
  box.position.set(e.x_m, e.height_agl_m + h / 2, e.z_m);
  box.castShadow = box.receiveShadow = true;
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
coverageTexture.colorSpace = THREE.SRGBColorSpace;
coverageTexture.magFilter = THREE.NearestFilter;
const coveragePlane = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshBasicMaterial({ map: coverageTexture, transparent: true, depthWrite: false, toneMapped: false }));
coveragePlane.rotation.x = -Math.PI / 2;
coveragePlane.position.y = 0.05;
coveragePlane.visible = false;
scene.add(coveragePlane);

const sceneMotion = createSceneMotion({ THREE, scene, renderer, camera, controls, host, building: b,
  antennaGroup, zoneGroup, baselineGroup, neighbourMeshes, onEditFrame: () => update() });

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
  // What the agent knows before its first tool call, so a goal needs no reading turns.
  briefing: () => {
    const { neighbours, ...state } = planner.state();
    const { buildings, ...people } = populationContext(site);
    return { site_id: site.site_id, structure: site.structure, ...state, people: { ...people, buildings: buildings.filter((b) => b.sensitive || b.distance_m <= 120) } };
  },
  evaluate(changes) {
    const { site: candidate, errors } = applyChanges(site, changes);
    return errors.length ? { errors } : summarize(candidate);
  },
  apply(changes, reason) {
    const { site: candidate, errors } = applyChanges(site, changes);
    if (errors.length) return { errors };
    lastReason = reason ?? lastReason;
    undoStack.push(site);
    site = candidate;
    selectedId = changes[0]?.antenna_id ?? selectedId;
    refreshCoverageBands();
    update({ animate: true });
    renderEditor();
    // The engineer should see who has to go to site without asking.
    if (crewPlan(fieldWorkOrder(baseline, site, checkSite(site, siteZones(site, REGIMES[regimeKey]))), site).visits.length) {
      showCard("crew", { reveal: true });
    }
    const { visits, crew } = planner.fieldWork().crew;
    return { applied: true, reason, result: summarize(site), field_crew: { visits, crew } };
  },
  undo() {
    if (!undoStack.length) return { error: "nothing to undo" };
    site = undoStack.pop();
    refreshCoverageBands();
    update({ animate: true, action: "Undo · Applied to plan" });
    renderEditor();
    return { undone: true, result: summarize(site) };
  },
  population: () => populationContext(site),
  fieldWork: () => {
    const order = fieldWorkOrder(baseline, site, checkSite(site, siteZones(site, REGIMES[regimeKey])));
    return { ...order, crew: crewPlan(order, site) };
  },
  listSites: async () => (await portfolioIndex()).sites.map((s) => ({ site_id: s.site_id, structure: s.structure, technology: s.technology, pending_change: s.reason })),
  async openSite({ site_id, instruction }) {
    const s = (await portfolioIndex()).sites.find((x) => x.site_id.toLowerCase().includes(String(site_id).toLowerCase()));
    if (!s) return { error: `no site ${site_id} in the portfolio` };
    const p = new URLSearchParams({ twin: s.twin, ...(instruction ? { ask: instruction } : { auto: "review" }), from: backTo, portfolio: portfolioUrl, handoff: handoffId() });
    if (agent.voice) p.set("voice", "1");
    pendingOpen = `index.html?${p}`;
    return { opening: s.site_id, instruction: instruction ?? "full review" };
  },
  setView({ zones, coverage, baseline: showBaseline, coverage_band, select_antenna }) {
    const previousSelection = selectedId;
    for (const [k, v] of Object.entries({ zones, coverage, baseline: showBaseline })) if (typeof v === "boolean") layers[k] = v;
    if (coverage_band && bandNames().includes(coverage_band)) coverageBand = coverage_band;
    if (select_antenna !== undefined) selectedId = site.antennas.some((a) => a.id === select_antenna) ? select_antenna : null;
    syncLayerChips();
    update();
    renderEditor();
    if (selectedId && selectedId !== previousSelection) sceneMotion.focus(selectedId);
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
let editSnapshot = null;
function beginEdit() { editSnapshot ??= clone(site); }
function finishEdit() {
  if (editSnapshot && JSON.stringify(editSnapshot) !== JSON.stringify(site)) undoStack.push(editSnapshot);
  editSnapshot = null;
  update();
  renderCoverage(true);
}
function pairRange(range, out, label, setter) {
  out.hidden = true;
  const numeric = el("input", { type: "number", className: "numeric", min: range.min, max: range.max, step: range.step, value: range.value, ariaLabel: label });
  range.setAttribute("aria-label", label);
  range.after(out); out.after(numeric);
  numeric.after(el("span", { className: "unit", textContent: label.includes("degrees") ? "°" : label.includes("watts") ? "W" : "m" }));
  range.addEventListener("pointerdown", beginEdit);
  range.addEventListener("keydown", beginEdit);
  const change = (value) => {
    beginEdit(); range.value = value; numeric.value = range.value; out.textContent = range.value;
    setter(Number(range.value)); sceneMotion.queueEdit();
  };
  range.oninput = () => change(range.value);
  numeric.oninput = () => { if (numeric.value !== "" && numeric.validity.valid) change(numeric.value); };
  range.onchange = numeric.onchange = finishEdit;
  numeric.onblur = () => { numeric.value = range.value; };
  range.userNumeric = numeric;
}
function renderEditor() {
  const a = site.antennas.find((x) => x.id === selectedId);
  $("editor").hidden = !a;
  if (!a) { hideCard("antenna"); return; }
  showCard("antenna");
  setCardSummary("antenna", `${a.id} · ${Math.round(a.azimuth_deg)}° · ${a.height_agl_m} m`);
  $("editId").textContent = a.id;
  for (const input of document.querySelectorAll("#editor input[data-k]")) {
    input.value = a[input.dataset.k];
    input.nextElementSibling.textContent = a[input.dataset.k];
    if (input.userNumeric) input.userNumeric.value = input.value;
  }
  const bands = $("bands");
  bands.replaceChildren();
  for (const band of a.bands) {
    const out = el("output", { textContent: `${band.tx_power_w} W` });
    const range = el("input", { type: "range", min: 1, max: band.frequency_mhz > 3000 ? 240 : 80, step: 1, value: band.tx_power_w });
    const del = el("button", { textContent: "×", title: `Remove ${band.name}`, ariaLabel: `Remove band ${band.name}`, className: "destructive" });
    del.onclick = () => { undoStack.push(clone(site)); a.bands = a.bands.filter((x) => x !== band); refreshCoverageBands(); update(); renderEditor(); };
    bands.append(el("div", { className: "row" }, el("label", { textContent: `${band.name} W` }), range, out, del));
    pairRange(range, out, `${a.id} ${band.name} power in watts`, (value) => { band.tx_power_w = value; });
  }
}

const antennaRows = new Map();
let findingSignature = "", deltaSignature = "", workSignature = "", actionSignature = "";
let previousAssessment = null;
function renderPanels(zones, checks, changes) {
  const zoneById = Object.fromEntries(zones.map((z) => [z.antenna_id, z]));
  const tbody = $("antennas");
  const ids = new Set(site.antennas.map((a) => a.id));
  for (const [id, row] of antennaRows) if (!ids.has(id)) { row.remove(); antennaRows.delete(id); }
  for (const a of site.antennas) {
    const z = zoneById[a.id];
    let row = antennaRows.get(a.id);
    if (!row) {
      row = el("tr", { tabIndex: 0, role: "button", ariaLabel: `Select antenna ${a.id}` }, ...Array.from({ length: 5 }, () => el("td")));
      row.onclick = () => select(a.id);
      row.onkeydown = (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); select(a.id); } };
      antennaRows.set(a.id, row); tbody.append(row);
    }
    row.classList.toggle("sel", a.id === selectedId);
    row.setAttribute("aria-pressed", String(a.id === selectedId));
    const values = [a.id, `${Math.round(a.azimuth_deg)}°`, `${a.mechanical_tilt_deg + a.electrical_tilt_deg}°`, a.bands.map((x) => x.name).join(" "), z ? z.front_m.toFixed(1) : "–"];
    [...row.children].forEach((cell, i) => setText(cell, values[i]));
  }
  const nextFindingSignature = JSON.stringify(checks.findings);
  if (findingSignature !== nextFindingSignature) {
  findingSignature = nextFindingSignature;
  // One sentence first; sensitive buildings are listed, everything else waits behind "All findings".
  const head = headline(checks);
  $("checksHeadline").className = `headline ${head.level}`;
  setText($("checksHeadline"), head.text);
  const row = (f) => {
    const item = el("li", { className: f.level, textContent: f.text, title: "Show in 3D" });
    if (f.antenna) item.onclick = () => select(f.antenna, f);
    return item;
  };
  const rest = checks.findings.filter((f) => !f.sensitive && f.level !== "ok");
  $("checks").replaceChildren(...checks.findings.filter((f) => f.sensitive).map(row),
    ...(rest.length ? [el("li", {}, el("details", { className: "more" }, el("summary", { textContent: `All findings (${rest.length})` }), el("ul", {}, ...rest.map(row))))] : []));
  }
  $("activeRegime").textContent = REGIMES[regimeKey].name;
  $("planDelta").textContent = changes.length ? `${changes.length} delta(s) · Applied to plan` : "Plan equals baseline";
  const nextDeltaSignature = JSON.stringify(changes);
  if (deltaSignature !== nextDeltaSignature) {
    deltaSignature = nextDeltaSignature;
    $("changes").replaceChildren(...(changes.length ? changes.map((c) => el("li", { textContent: c })) : [el("li", { className: "muted", textContent: "No changes yet" })]));
  }
  if (actionSignature !== JSON.stringify(planActions)) {
    actionSignature = JSON.stringify(planActions);
    $("planActions").replaceChildren(...planActions.map((action) => el("li", {},
      el("time", { textContent: new Date(action.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) }),
      el("strong", { textContent: action.label ?? "Applied to plan" }),
      el("div", { textContent: action.delta.join("; ") }), el("div", { className: "muted", textContent: action.result ?? "" }))));
  }
  $("undo").disabled = !undoStack.length;
  // Exporting only makes sense once the plan differs from the source.
  $("export").hidden = !changes.length;

  const bad = checks.findings.filter((f) => f.level === "bad");
  const sensitive = bad.filter((f) => f.sensitive).length;
  setCardSummary("checks", bad.length ? `${checks.hit.size} building(s)${sensitive ? ` · ${sensitive} sensitive` : ""}` : "No conflicts", bad.length ? "bad" : "ok");
  setCardSummary("site", REGIMES[regimeKey].name.replace(" (20% field)", ""));
  setCardSummary("antennas", `${site.antennas.length}`);
  if (changes.length) { showCard("changes"); setCardSummary("changes", `${changes.length} change(s)`); } else hideCard("changes");

  const order = fieldWorkOrder(baseline, site, checks);
  renderFieldWork(order);
  renderCrew(crewPlan(order, site));
}

let crewSignature = "";
function renderCrew(plan) {
  const signature = JSON.stringify(plan);
  if (crewSignature === signature) return;
  crewSignature = signature;
  if (!plan.visits.length) { hideCard("crew"); hideCard("work"); return; }
  showCard("crew");
  showCard("work");
  const install = plan.visits.find((v) => v.name === "Installation visit");
  setCardSummary("crew", install ? `${plan.headcount} people · ${install.days} day(s)` : "Remote only", install ? "warn" : "ok");
  const list = (title, items) => items.length ? [el("h2", { textContent: title }), el("ul", {}, ...items.map((t) => el("li", { textContent: t })))] : [];
  // One line per visit; roles, tasks, tools and materials open on request.
  $("crew").replaceChildren(
    ...plan.visits.map((v) => el("div", { className: "visit-line" }, el("span", { textContent: v.name }),
      el("span", { className: "muted", textContent: v.remote ? `${v.people} engineer · ~${v.hours} h` : `${v.people} people · ${v.days} day(s)` }))),
    el("details", { className: "more" }, el("summary", { textContent: "Crew, tasks and materials" }),
      ...(plan.crew.length ? [el("h2", { textContent: "Crew" }), el("ul", {}, ...plan.crew.map((c) => el("li", {}, `${c.count} × `, el("span", { textContent: c.role }))))] : []),
      ...plan.visits.flatMap((v) => list(v.name, v.tasks)),
      ...list("Tools and equipment to bring", plan.tools),
      ...list("Materials", plan.materials),
      el("p", { className: "muted", textContent: plan.note })),
  );
  setCardSummary("work", `${plan.materials.length} material(s)`);
}

function renderFieldWork(order) {
  const box = $("fieldwork");
  const signature = JSON.stringify(order);
  if (workSignature === signature) return;
  workSignature = signature;
  if (!order.items.length) return box.replaceChildren(el("div", { className: "muted", textContent: order.summary }));
  const list = (title, items) => items.length ? [el("div", { className: "muted", textContent: title }), el("ul", {}, ...items.map((t) => el("li", { textContent: t })))] : [];
  box.replaceChildren(
    el("div", { textContent: order.summary }),
    ...order.items.map((i) => el("section", { className: "work-card" },
      el("div", { className: "wo-head", textContent: `${i.antenna}: ${i.change}` }),
      ...list("Work steps", i.steps), ...list("Materials", i.materials), ...list("Precautions", i.precautions),
    )),
    ...list("Site-wide precautions and approvals", order.general),
  );
}

let coverageTimer = null, coverageRequest = null, paintedCoverageKey = "", coverageComparison = null, coveragePending = false;
function renderCoverage(immediate = false) {
  clearTimeout(coverageTimer);
  coverageRequest?.abort();
  coveragePending = false;
  if (!layers.coverage) { coveragePlane.visible = false; sceneMotion.invalidate(); return; }
  const key = JSON.stringify([coverageBand, site.antennas]);
  coveragePlane.visible = paintedCoverageKey === key;
  sceneMotion.invalidate();
  if (paintedCoverageKey === key && (!layers.baseline || coverageComparison?.key === key && coverageComparison.before !== undefined)) return;
  coveragePending = true;
  const controller = coverageRequest = new AbortController();
  const calculate = async () => {
    try {
      const snapshot = clone(site), band = coverageBand;
      const grid = await coverageGridAsync(snapshot, band, 600, COVERAGE_CELLS, { signal: controller.signal });
      if (layers.baseline && !baselineCoverage.has(band)) {
        const baseGrid = await coverageGridAsync(baseline, band, 600, COVERAGE_CELLS, { signal: controller.signal });
        baselineCoverage.set(band, coverageArea(baseGrid));
      }
      if (!layers.coverage || controller.signal.aborted) return;
      coverageComparison = { key, band, before: baselineCoverage.get(band), after: coverageArea(grid) };
      paintCoverage(coverageCanvas, grid);
      paintedCoverageKey = key;
      coveragePending = false;
      coveragePlane.visible = true;
      renderComparison();
      renderLegend();
      coverageTexture.needsUpdate = true;
      sceneMotion.invalidate();
    } catch (error) {
      if (error.name !== "AbortError") {
        coveragePending = false;
        $("planSession").textContent = `Coverage unavailable: ${error.message}`;
        renderLegend();
      }
    }
  };
  if (immediate) calculate(); else coverageTimer = setTimeout(calculate, 120);
}
window.addEventListener("pagehide", () => { clearTimeout(coverageTimer); coverageRequest?.abort(); });

function renderLegend() {
  const items = [
    [token("emf-front"), "EMF zone, main lobe"], [token("emf-back"), "EMF zone, back lobe"], [token("building-hit"), "Neighbour inside a zone"],
  ];
  if (layers.baseline) items.push([token("baseline-wire"), "Baseline zones (wireframe)"]);
  if (layers.coverage) items.push(...RSRP_BINS.map((b) => [token(b.token), `${coverageBand ?? "No band"} ${b.label}`]));
  $("legend").replaceChildren(...items.map(([c, t]) => el("div", {}, el("span", { className: "sw", style: `background:${c}` }), t)));
  if (layers.coverage) $("legend").append(
    el("div", { className: "muted", textContent: coveragePending ? "Calculating coverage…" : !coverageBand || paintedCoverageKey !== JSON.stringify([coverageBand, site.antennas]) ? "No coverage result" : "< −110 dBm · Below displayed range (transparent)" }),
    el("div", { className: "muted", textContent: "Coverage is indicative (Hata model, no terrain)." }));

}

const baselineChecks = new Map(), baselineCoverage = new Map();
function coverageArea({ grid, n, size }) {
  let good = 0, finite = false;
  for (const value of grid) { if (Number.isFinite(value)) finite = true; if (value >= -90) good++; }
  return finite ? `${(good * (size / n) ** 2 / 1e6).toFixed(3)} km²` : "No coverage result";
}
function renderComparison(checks = checkSite(site, siteZones(site, REGIMES[regimeKey]))) {
  $("comparison").hidden = !layers.baseline;
  if (!layers.baseline) return;
  if (!baselineChecks.has(regimeKey)) baselineChecks.set(regimeKey, checkSite(baseline, siteZones(baseline, REGIMES[regimeKey])));
  const base = baselineChecks.get(regimeKey);
  const items = [el("strong", { textContent: "Baseline → proposed plan" }),
    el("div", { textContent: `Unique hit buildings: ${base.hit.size} → ${checks.hit.size}` }),
    el("div", { textContent: `Roof restriction findings: ${base.findings.filter((f) => f.level === "warn").length} → ${checks.findings.filter((f) => f.level === "warn").length}` })];
  if (layers.coverage && coverageBand) {
    const key = JSON.stringify([coverageBand, site.antennas]);
    items.push(el("div", { textContent: coverageComparison?.key === key && coverageComparison.before !== undefined
      ? `${coverageBand}, ≥ −90 dBm: ${coverageComparison.before} → ${coverageComparison.after}`
      : "Coverage comparison updating…" }));
  }
  items.push(el("div", { className: "muted", textContent: "Same band, threshold and model. Indicative coverage; field verification required." }));
  $("comparison").replaceChildren(...items);
}

function update(options = {}) {
  const regime = REGIMES[regimeKey];
  const zones = siteZones(site, regime);
  const checks = checkSite(site, zones);
  sceneMotion.sync(site, zones, checks, layers, baseline, siteZones(baseline, regime), selectedId, options);
  const delta = diffSites(lastModelState, site);
  const nextAssessment = { hit: checks.hit.size, roof: checks.findings.filter((f) => f.level === "warn").length };
  if (delta.length) {
    planActions.push({ time: new Date().toISOString(), label: options.action ?? "Applied to plan", site: site.site_id, delta,
      result: `Unique hit buildings: ${previousAssessment?.hit ?? nextAssessment.hit} → ${nextAssessment.hit} · roof restrictions: ${previousAssessment?.roof ?? nextAssessment.roof} → ${nextAssessment.roof}` });
    if (planActions.length > 30) planActions.shift();
    lastModelState = clone(site);
  }
  previousAssessment = nextAssessment;
  renderPanels(zones, checks, diffSites(baseline, site));
  renderComparison(checks);
  clearTimeout(saveTimer); saveTimer = setTimeout(saveSessionPlan, 120);

  renderCoverage();
  renderLegend();
}

function select(id, finding = null) {
  const changed = id !== selectedId || (finding?.building ?? null) !== sceneMotion.selectedBuilding;
  selectedId = id;
  if (id && !finding) showCard("antenna", { reveal: true });
  update();
  renderEditor();
  if (changed && id) sceneMotion.focus(id, finding?.building ?? null);
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
for (const input of document.querySelectorAll("#editor input[data-k]")) {
  const k = input.dataset.k;
  if (k === "height_agl_m") Object.assign(input, { min: HEIGHT_RANGE[0], max: HEIGHT_RANGE[1] });
  if (k === "x_m") Object.assign(input, { min: roofBounds.x0, max: roofBounds.x1 });
  if (k === "z_m") Object.assign(input, { min: roofBounds.z0, max: roofBounds.z1 });
  const units = k.endsWith("_deg") ? "degrees" : "metres";
  pairRange(input, input.nextElementSibling, `${FIELDS[k]} in ${units}`, (value) => {
    const a = site.antennas.find((x) => x.id === selectedId);
    if (a) a[k] = value;
  });
}
$("bandPreset").replaceChildren(...Object.keys(BAND_PRESETS).map((n) => el("option", { value: n, textContent: n })));
$("addBand").onclick = () => {
  const a = site.antennas.find((x) => x.id === selectedId);
  const preset = BAND_PRESETS[$("bandPreset").value];
  if (a.bands.some((x) => x.name === preset.name)) return;
  undoStack.push(clone(site));
  a.bands.push(clone(preset));
  refreshCoverageBands();
  update();
  renderEditor();
};
$("removeAntenna").onclick = () => {
  undoStack.push(clone(site));
  site.antennas = site.antennas.filter((x) => x.id !== selectedId);
  selectedId = null;
  refreshCoverageBands();
  update();
  renderEditor();
};
$("addAntenna").onclick = () => {
  undoStack.push(clone(site));
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
$("reset").onclick = () => { undoStack.push(clone(site)); site = clone(baseline); selectedId = null; refreshCoverageBands(); update(); renderEditor(); };
$("export").onclick = async () => {
  const regime = REGIMES[regimeKey];
  const zones = siteZones(site, regime);
  const checks = checkSite(site, zones);
  const order = fieldWorkOrder(baseline, site, checks);
  const data = {
    site_id: site.site_id, regime: regime.name, created: new Date().toISOString(),
    changes: diffSites(baseline, site), checks: checks.findings,
    zones, baseline, proposed: site, actions: planActions, field_work_order: order,
  };
  const entry = (await portfolioIndex().catch(() => ({ sites: [] }))).sites.find((s) => s.site_id === site.site_id);
  openActionPlan(actionPlan({
    site, entry, regime: regime.name, reason: lastReason, order, crew: crewPlan(order, site), changes: data.changes,
    before: headline(checkSite(baseline, siteZones(baseline, regime))), after: headline(checks),
  }), { data });
};
$("regime").onchange = (e) => { regimeKey = e.target.value; update(); };
$("coverageBand").onchange = (e) => { coverageBand = e.target.value; renderCoverage(); renderLegend(); saveSessionPlan(); };
$("undo").onclick = () => planner.undo();
function syncLayerChips() {
  for (const chip of document.querySelectorAll(".chip[data-layer]")) {
    chip.classList.toggle("on", layers[chip.dataset.layer]);
    chip.setAttribute("aria-pressed", String(layers[chip.dataset.layer]));
  }
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
const chat = initConversation({
  onBusy: (on) => voice.setRunning(on),
  onComplete: () => { if (pendingOpen && pageActive) location.href = pendingOpen; },
  speak: (text) => voice.speak(text),
  transcriptKey: absoluteUrl(portfolioUrl),
});
const agent = initAgent(planner, chat);
const voice = initVoice({
  button: $("micButton"),
  status: (text) => { $("chatBusy").hidden = !text; $("chatBusy").textContent = text; },
  onText: (text) => agent.ask(text, { voice: true }),
});
const send = () => {
  if ($("chatInput").disabled) return;
  const text = $("chatInput").value.trim();
  if (!text) return;
  $("chatInput").value = "";
  agent.ask(text);
};
$("chatSend").onclick = send;
initPhoto({
  button: $("photoButton"),
  status: (text) => { $("chatBusy").hidden = !text; $("chatBusy").textContent = text; },
  onRead: (obs, src) => {
    chat.photo(src, seenLine(obs) || tr("No telecom equipment recognised"));
    agent.ask(photoRequest(obs, document.documentElement.lang), { silent: true });
  },
});
$("chatInput").onkeydown = (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } };
for (const button of document.querySelectorAll(".suggest")) button.onclick = () => agent.ask(button.textContent);

$("title").textContent = site.site_id;
$("breadcrumbSite").textContent = site.site_id;
$("subtitle").textContent = site.name ?? "";
$("notes").textContent = (site.notes ?? []).join(" ");
const profileButton = el("button", { textContent: "Measure 20-second orbit / edit" });
const profileResult = el("pre", { className: "profile-result", textContent: "No recording profile measured in this session." });
$("notes").after(el("details", { className: "performance-details" }, el("summary", { textContent: "Recording performance" }),
  el("p", { className: "muted", textContent: "Use a 1440×900 viewport and a 250-building case. Orbit and edit during capture. Targets: p95 ≤22ms, ≤350 draw calls, ≤180,000 triangles, estimated textures ≤96MiB. A failed frame budget lowers DPR to 1 for the next run." }), profileButton, profileResult));
profileButton.onclick = async () => {
  profileButton.disabled = true;
  profileResult.textContent = "Measuring actual frames for 20 seconds. Orbit and edit; keep this tab visible.";
  try { profileResult.textContent = JSON.stringify(await sceneMotion.startProfile(), null, 2); }
  finally { profileButton.disabled = false; }
};
$("planSession").textContent = restored.message;
$("regime").value = regimeKey;
syncLayerChips();
$("backToMap").href = backTo;
refreshCoverageBands();
update();
$("loading").hidden = true;

// Opened from the portfolio map: the Expert Operator carries out what was asked
// there, or reviews the site straight away.
const handoff = consumeHandoff(params);
if (handoff) agent.ask(handoff.instruction, { voice: handoff.voice });


function resize() {
  const { clientWidth: w, clientHeight: h } = host;
  if (!w || !h) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  sceneMotion.invalidate();
}
new ResizeObserver(resize).observe(host);
resize();
sceneMotion.focus(null, null, true);
sceneMotion.invalidate();
