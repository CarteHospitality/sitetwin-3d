// SiteTwin 3D change planner: edit antennas on the twin, see EMF zones,
// conflicts and indicative coverage update live, compare with the baseline.

import { tr } from "./i18n.js";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { REGIMES, siteZones } from "./emf.js";
import { checkSite, headline, pointInPolygon, roofOf } from "./checks.js";
import { coverageGrid, coverageGridAsync, paintBestServer } from "./coverage.js";
import { initAgent } from "./agent.js";
import { initPhoto, photoRequest, seenLine } from "./photo.js";
import { finishStop, progress } from "./tour.js";
import { composeBeforeAfter, openSnapshot } from "./snapshot.js";
import { populationContext, occupancy, footprintPeople } from "./population.js";
import { initVoice } from "./voice.js";
import { initConversation } from "./conversation.js";
import { createSceneMotion } from "./scene.js";
import { restoreProposed, saveProposed, sourceFingerprint, consumeHandoff, handoffId, absoluteUrl, withUploads, startOver } from "./session.js";
import { twinKpi } from "./kpi.js";
import { groundMap } from "./groundmap.js";
import { createIntro } from "./intro.js";
import { fieldWorkOrder } from "./fieldwork.js";
import { $, el, token, initShell, setText, reducedMotion, confirmClick } from "./ui.js";
import { initCards, showCard, hideCard, setCardSummary } from "./cards.js";
import { crewPlan } from "./crew.js";
import { openActionPlan, result, diffSites, sitePlan, FIELDS } from "./actionplan.js";
import { statusLines, planSteps, CAPACITY_PEOPLE_PER_ANTENNA } from "./overview.js";

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
// The SiteTwin result is the site as it stands: the plan starts from it and every change is
// measured against it. (twin.baseline, the site before that SiteTwin application, is history.)
const baseline = twin.site;
const restored = restoreProposed(src, twin);
const fingerprint = sourceFingerprint(twin);
let site = clone(restored.site);
// Measured load: the busy hour per cell that the site file carries (network_kpi), if any.
const kpi = twinKpi(twin);
// Where the busiest cell will be in a year, for "what if nothing changes". Indicative: mobile data
// traffic per site grows about 20% a year (operator and industry outlooks give roughly 15-30%).
const TRAFFIC_GROWTH = 0.2;
function capacityOutlook() {
  const cell = kpi?.cells[0];
  const monthsUntil = (now, target) => (now >= target ? 0 : Math.round((12 * Math.log(target / now)) / Math.log(1 + TRAFFIC_GROWTH)));
  if (!cell) {
    // No measured load: the same outlook from the people in the busiest antenna's main lobe.
    const [antenna, people] = Object.entries(populationContext(site).people_per_antenna).sort((a, b) => b[1] - a[1])[0] ?? [];
    if (!antenna || !people) return null;
    return { busiest_antenna: antenna, people_in_main_lobe_estimated: people, busy_threshold_people: CAPACITY_PEOPLE_PER_ANTENNA,
      months_until_busy: monthsUntil(people, CAPACITY_PEOPLE_PER_ANTENNA),
      assumption: "estimated from the people around the site, not measured; demand grows about 20% a year (indicative)" };
  }
  const monthsTo = (target) => monthsUntil(cell.prb_dl_pct, target);
  return { busiest_cell: `${cell.sector} ${cell.band}`, busy_hour_load_pct_now: cell.prb_dl_pct,
    load_pct_in_one_year: Math.min(100, Math.round(cell.prb_dl_pct * (1 + TRAFFIC_GROWTH))),
    months_until_busy_70pct: monthsTo(70), months_until_full_85pct: monthsTo(85),
    assumption: "traffic grows about 20% a year (indicative); measured load is before the plan" };
}
// Opened from the map without a task: a quiet start (fresh chat, nothing selected).
const freshOpen = params.get("fresh") === "1";
let selectedId = !freshOpen && site.antennas.some((a) => a.id === restored.view.selected) ? restored.view.selected : null;
let regimeKey = restored.regime;
// Coverage is on by default: where each antenna reaches is half of what the twin shows.
const layers = { zones: true, coverage: true, baseline: false };
// Coverage comes back on with every opening; the other layers keep the engineer's choice.
for (const key of ["zones", "baseline"]) if (typeof restored.view.layers?.[key] === "boolean") layers[key] = restored.view.layers[key];
let coverageBand = restored.view.coverageBand ?? null;
let lastModelState = clone(site);
const planActions = restored.actions.filter((a) => a && typeof a.time === "string" && Array.isArray(a.delta));
let saveTimer = null;
// The operator's own words for the latest applied change, for the action plan; kept with the session plan.
let lastReason = typeof restored.view.reason === "string" ? restored.view.reason : null;
let pageActive = true;
window.addEventListener("pagehide", () => { pageActive = false; });
window.addEventListener("pageshow", () => { pageActive = true; });
function saveSessionPlan() {
  clearTimeout(saveTimer);
  const saved = saveProposed(src, twin, { site, regime: regimeKey, actions: planActions,
    view: { selected: selectedId, layers, coverageBand, reason: lastReason } }, fingerprint);
  if (!saved) $("planSession").textContent = "Session storage unavailable · export the plan to keep it";
  // Said under the plan, so the engineer knows a change is kept, and since when: the time of the
  // latest change (a plan restored from earlier in the session is not news), with a way back.
  const changed = diffSites(baseline, site).length > 0;
  const last = planActions.at(-1)?.time;
  $("savedNote").hidden = $("planReset").hidden = !changed;
  $("savedNote").textContent = !saved ? "Not saved: this browser blocks storage, export the action plan to keep it"
    : `Last change ${new Date(last ?? Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}, kept in this browser · the site file is unchanged`;
}
// A short confirmation on the 3D view for each change: what changed, and that it is kept.
let savedTimer = null;
function showSaved(delta) {
  const toast = $("savedToast");
  toast.replaceChildren(el("span", { textContent: delta[0] }), ...(delta.length > 1 ? [el("span", { textContent: `+${delta.length - 1}` })] : []),
    el("strong", { textContent: "✓ Saved" }));
  toast.hidden = false;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { toast.hidden = true; }, 2500);
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
// Far enough to keep the neighbourhood sharp; only the horizon fades.
scene.fog = new THREE.Fog(token("stage"), 450, 1400);
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
const grids = [];
for (const [divisions, opacity] of [[60, 0.06], [12, 0.12]]) {
  const grid = new THREE.GridHelper(300, divisions / 2, token("scene-edge"), token("scene-edge"));
  grids.push(grid);
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
const northArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, b.height_m + 0.1, roofBounds.z0 - 1), 6, token("accent"), 1.5, 1);
scene.add(northArrow);

const neighbourMeshes = {};
const shadowCasters = new Set([...(baseline.neighbours ?? [])].sort((a, b) => Math.hypot(a.x_m, a.z_m) - Math.hypot(b.x_m, b.z_m)).slice(0, 40).map((n) => n.id));
for (const n of baseline.neighbours ?? []) {
  const m = buildingMesh(n, n.height_m, token("scene-building"));
  m.castShadow = shadowCasters.has(n.id); m.receiveShadow = true;
  scene.add(m);
  neighbourMeshes[n.id] = m;
}
const equipmentMeshes = baseline.equipment.map((e) => {
  const [w, h, d] = e.size_m;
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), softenShadow(new THREE.MeshStandardMaterial({ color: token("scene-pole"), roughness: 0.93 })));
  box.position.set(e.x_m, e.height_agl_m + h / 2, e.z_m);
  box.castShadow = box.receiveShadow = true;
  scene.add(box);
  return box;
});

// Buildings beyond the analysed neighbours (to 400 m), for context only: one lighter
// mesh, no checks, no shadows cast.
function contextMesh(items) {
  const parts = items.map((c) => new THREE.ExtrudeGeometry(new THREE.Shape(c.footprint.map(([x, z]) => new THREE.Vector2(x, -z))),
    { depth: c.height_m, bevelEnabled: false }).rotateX(-Math.PI / 2));
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  const color = new THREE.Color(token("scene-building")).lerp(new THREE.Color(token("scene-ground")), 0.45);
  const mesh = new THREE.Mesh(merged, softenShadow(new THREE.MeshStandardMaterial({ color, roughness: 0.95 })));
  mesh.receiveShadow = true;
  return mesh;
}
const contextBuildings = Array.isArray(twin.context) && twin.context.length ? contextMesh(twin.context) : null;
if (contextBuildings) scene.add(contextBuildings);

const antennaGroup = new THREE.Group();
const zoneGroup = new THREE.Group();
const baselineGroup = new THREE.Group();
scene.add(antennaGroup, zoneGroup, baselineGroup);

// The site is built in front of the engineer on opening (see intro.js).
const standing = (mesh) => (mesh.rotation.x ? "extrude" : "box");
const farthest = Math.max(1, ...(baseline.neighbours ?? []).map((n) => Math.hypot(n.x_m, n.z_m)));
const intro = createIntro([
  { object: siteBuilding, kind: standing(siteBuilding), delay: 0, duration: 600 },
  { object: roofEdge, kind: standing(siteBuilding), delay: 0, duration: 600 },
  { object: northArrow, kind: "lift", delay: 0, duration: 600 },
  ...equipmentMeshes.map((object) => ({ object, kind: "box", delay: 0, duration: 600 })),
  ...(baseline.neighbours ?? []).map((n) => ({ object: neighbourMeshes[n.id], kind: standing(neighbourMeshes[n.id]),
    delay: 150 + 550 * (Math.hypot(n.x_m, n.z_m) / farthest), duration: 450 })),
  ...(contextBuildings ? [{ object: contextBuildings, kind: "up", delay: 450, duration: 800 }] : []),
  { object: antennaGroup, kind: "up", delay: 900, duration: 550 },
  { object: zoneGroup, kind: "grow", delay: 1300, duration: 500 },
], { reducedMotion, onFrame: () => sceneMotion.changedGeometry() });
intro.hide();

// Size the canvas before the texture exists: three.js allocates GPU storage at
// the first upload, and a later size change would only fill part of it.
// The coverage view spans the street map (1.2 km): far enough to see where each sector fades.
const COVERAGE_CELLS = 200, COVERAGE_SIZE_M = 1200;
const coverageCanvas = Object.assign(document.createElement("canvas"), { width: COVERAGE_CELLS, height: COVERAGE_CELLS });
const coverageTexture = new THREE.CanvasTexture(coverageCanvas);
coverageTexture.colorSpace = THREE.SRGBColorSpace;
coverageTexture.magFilter = THREE.NearestFilter;
const coveragePlane = new THREE.Mesh(new THREE.PlaneGeometry(COVERAGE_SIZE_M, COVERAGE_SIZE_M), new THREE.MeshBasicMaterial({ map: coverageTexture, transparent: true, depthWrite: false, toneMapped: false }));
coveragePlane.rotation.x = -Math.PI / 2;
coveragePlane.position.y = 0.05;
coveragePlane.visible = false;
scene.add(coveragePlane);

const sceneMotion = createSceneMotion({ THREE, scene, renderer, camera, controls, host, building: b,
  antennaGroup, zoneGroup, baselineGroup, neighbourMeshes, onEditFrame: () => update() });

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
    // Only a move is checked: surveyed antennas often sit on the roof edge or facade,
    // just outside the mapped outline, and a power or tilt change must still be possible.
    const moved = c.action === "add_antenna" || typeof c.x_m === "number" || typeof c.z_m === "number";
    if (moved && !onRoof(a.x_m, a.z_m)) errors.push(`${a.id} is off the roof`);
    if ((c.action === "add_antenna" || typeof c.height_agl_m === "number") && (a.height_agl_m < HEIGHT_RANGE[0] || a.height_agl_m > HEIGHT_RANGE[1])) errors.push(`${a.id} height out of range (${HEIGHT_RANGE.join('-')} m)`);
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

// A band that loses this share of its good-signal area (≥ −90 dBm) against the
// baseline is a heavy cost, a band switched off everywhere included: the panel and
// the agent must both say it.
const HEAVY_COVERAGE_LOSS = 0.3;
let baselineCoverageMetric = null;
function coverageLoss(cov) {
  baselineCoverageMetric ??= coverageMetric(baseline);
  return Object.entries(baselineCoverageMetric).map(([band, b]) => {
    const before = b.km2_above_minus90dBm, after = cov[band]?.km2_above_minus90dBm ?? 0;
    return { band, before_km2: before, after_km2: after, change_pct: before ? Math.round(((after - before) / before) * 100) : 0 };
  }).filter((x) => x.change_pct <= -HEAVY_COVERAGE_LOSS * 100);
}
// The overview renders often (sliders): coverage is recomputed only when antennas change.
let coverageMemo = { key: "", loss: [] };
function currentCoverageLoss() {
  const key = JSON.stringify(site.antennas);
  if (coverageMemo.key !== key) coverageMemo = { key, loss: coverageLoss(coverageMetric(site)) };
  return coverageMemo.loss;
}

function summarize(s) {
  const coverage = coverageMetric(s);
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
    coverage,
    heavy_coverage_loss: coverageLoss(coverage),
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
    const outlook = capacityOutlook();
    return { site_id: site.site_id, structure: site.structure, ...state, people: { ...people, buildings: buildings.filter((b) => b.sensitive || b.distance_m <= 120) },
      ...(kpi ? { network_kpi: { source: "measured: operator OSS data carried in the site file, busiest hour per cell, current network before the plan", cells: kpi.cells } } : {}),
      ...(outlook ? { capacity_outlook: outlook } : {}) };
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
    if (progress(site.site_id)) return { error: "This site is one stop of a portfolio tour: fix this site only; the next site opens by itself." };
    const s = (await portfolioIndex()).sites.find((x) => x.site_id.toLowerCase().includes(String(site_id).toLowerCase()));
    if (!s) return { error: `no site ${site_id} in the portfolio` };
    const p = new URLSearchParams({ twin: s.twin, ...(instruction ? { ask: instruction } : { fresh: "1" }), from: backTo, portfolio: portfolioUrl, handoff: handoffId() });
    if (agent.voice) p.set("voice", "1");
    pendingOpen = `index.html?${p}`;
    return { opening: s.site_id, instruction: instruction ?? "none: ready for questions" };
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
  portfolioCache ??= withUploads(portfolioUrl, await fetch(portfolioUrl).then((r) => (r.ok ? r.json() : fetch("data/samples/portfolio.json").then((x) => x.json()))));
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
  // Bands the antenna already carries cannot be added again: offer only the others.
  for (const option of $("bandPreset").options) option.disabled = a.bands.some((x) => x.name === BAND_PRESETS[option.value].name);
  if ($("bandPreset").selectedOptions[0]?.disabled) $("bandPreset").value = [...$("bandPreset").options].find((o) => !o.disabled)?.value ?? "";
  $("addBand").disabled = !$("bandPreset").value;
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
  const crew = crewPlan(order, site);
  renderFieldWork(order);
  renderCrew(crew);
  renderOverview(checks, changes, crew);
}

// The overview on top of the panel: good and bad points, then the plan in plain words.
let overviewSignature = "";
function renderOverview(checks, changes, crew) {
  const lines = statusLines(site, checks, populationContext(site), { coverageLoss: changes.length ? currentCoverageLoss() : [], kpi, before: baseline });
  const steps = planSteps(baseline, site);
  // What the plan achieves; a problem it leaves is said as still open, never with a tick.
  const after = headline(checks);
  const outcome = !changes.length ? [] : result(headline(checkSite(baseline, siteZones(baseline, REGIMES[regimeKey]))), after)
    .map((text) => (after.level !== "ok" && text === after.text ? `Still open: ${text}` : text)).slice(0, 2)
    // Translated in two parts here: the page translator knows each part, not the joined line.
    .map((text) => ({ open: text.startsWith("Still open: "), text: text.startsWith("Still open: ") ? `${tr("Still open")}: ${tr(text.slice(12))}` : text }));
  const install = crew.visits.find((v) => v.name === "Installation visit");
  const crewText = !changes.length || !crew.visits.length ? "" : install ? `Field work: ${crew.headcount} people · ${install.days} day(s)` : "Field work: remote only, no site visit";
  const signature = JSON.stringify([lines, steps, outcome, crewText]);
  if (signature === overviewSignature) return;
  overviewSignature = signature;
  const icon = { ok: "✓", warn: "!", bad: "✕" };
  $("statusLines").replaceChildren(...lines.map((l) => el("li", { className: l.level }, el("span", { className: "mark", ariaHidden: "true", textContent: icon[l.level] }), el("span", { textContent: l.text }))));
  $("overview").querySelector("h2").textContent = changes.length ? "With the plan" : "Current state";
  $("planSteps").replaceChildren(...(steps.length
    ? [...steps.map((t) => el("li", { textContent: t })), ...outcome.map((o) => el("li", { className: o.open ? "outcome open" : "outcome", textContent: o.text }))]
    : [el("li", { className: "muted", textContent: "No changes yet. Ask the Expert Operator, or select an antenna to edit it." })]));
  $("crewLine").hidden = !crewText;
  $("sendPlan").hidden = !changes.length;
  $("crewLine").textContent = crewText ? `${crewText} ›` : "";
}
$("crewLine").onclick = () => showCard("crew", { reveal: true });
// The action plan opens with e-mail, copy, print and share for the site chief.
$("sendPlan").onclick = () => $("export").click();
confirmClick($("startOver"), "Click again: everything is forgotten", () => startOver(portfolioUrl));

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
// Sector colours for "who serves where" (red stays for EMF zones).
const SECTOR_COLORS = ["#2563EB", "#0F9F6E", "#9333EA", "#D97706", "#DB2777", "#0891B2"];
const sectorIds = () => [...new Set(site.antennas.map((a) => a.id.split("-")[0]))].sort();
const sectorColor = (sector) => SECTOR_COLORS[Math.max(0, sectorIds().indexOf(sector)) % SECTOR_COLORS.length];
const rgb = (hex) => hex.match(/[\da-f]{2}/gi).map((part) => parseInt(part, 16));
let paintedCoverage = null;
// Repaints the last result: on a new result, and when the selected antenna changes (its area stays strong).
function paintCoverageView() {
  if (!paintedCoverage) return;
  const { grid, antennas } = paintedCoverage;
  const focus = antennas.indexOf(selectedId);
  paintBestServer(coverageCanvas, grid, (index) => rgb(sectorColor(antennas[index].split("-")[0])), focus < 0 ? null : focus);
  coverageTexture.needsUpdate = true;
  sceneMotion.invalidate();
  renderStats();
}

// Two numbers on the 3D view, for the whole site or the selected antenna: the people it serves
// (estimated from the buildings around it) and the share of the shown area with a strong signal.
const STRONG_DBM = -90;
// The weakest signal drawn on the map (RSRP_BINS): below it a cell is not served.
const USABLE_DBM = -110;
// Everyone in the buildings drawn around the site (analysed neighbours and context to 400 m),
// placed where they live: the people count reads the same coverage map as the colours.
const residents = [
  ...(baseline.neighbours ?? []).map((n) => ({ x: n.x_m, z: n.z_m, people: occupancy(n).people })),
  ...(Array.isArray(twin.context) ? twin.context : []).map((c) => ({
    x: c.footprint.reduce((s, p) => s + p[0], 0) / c.footprint.length,
    z: c.footprint.reduce((s, p) => s + p[1], 0) / c.footprint.length,
    people: footprintPeople(c.footprint, c.height_m) })),
];
function renderStats() {
  const focus = site.antennas.some((a) => a.id === selectedId) ? selectedId : null;
  let share = null, people = null;
  if (layers.coverage && paintedCoverage?.key === JSON.stringify([coverageBand, site.antennas])) {
    const { grid: { grid, server, n, size }, antennas } = paintedCoverage;
    const index = focus ? antennas.indexOf(focus) : -1;
    const mine = (k) => index < 0 || server[k] === index;
    let strong = 0;
    for (let k = 0; k < grid.length; k++) if (grid[k] >= STRONG_DBM && mine(k)) strong++;
    share = Math.round((100 * strong) / grid.length);
    // People served: those living in cells this antenna (or the site) serves with a usable signal.
    people = 0;
    for (const r of residents) {
      const i = Math.floor(((r.x + size / 2) / size) * n), j = Math.floor(((r.z + size / 2) / size) * n);
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const k = j * n + i;
      if (grid[k] >= USABLE_DBM && mine(k)) people += r.people;
    }
  }
  const turkish = document.documentElement.lang === "tr";
  const row = (value, label) => el("div", { className: "stat-row" }, el("b", { textContent: value }), el("span", { textContent: label }));
  $("sceneStats").replaceChildren(
    el("div", { className: "stats-title", textContent: focus ?? "Whole site" }),
    row(people === null ? "…" : `~${people.toLocaleString(turkish ? "tr" : "en")}`, focus ? "people in the area it serves (estimated)" : "people in the covered area (estimated)"),
    row(share === null ? "…" : turkish ? `%${share}` : `${share}%`, focus ? "of the area served by it with a strong signal" : "of the area with a strong signal"),
    el("div", { className: "muted", textContent: `${coverageBand ?? ""} · 1.2 km × 1.2 km around the site` }),
  );
}
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
      const grid = await coverageGridAsync(snapshot, band, COVERAGE_SIZE_M, COVERAGE_CELLS, { signal: controller.signal });
      if (layers.baseline && !baselineCoverage.has(band)) {
        const baseGrid = await coverageGridAsync(baseline, band, COVERAGE_SIZE_M, COVERAGE_CELLS, { signal: controller.signal });
        baselineCoverage.set(band, coverageArea(baseGrid));
      }
      if (!layers.coverage || controller.signal.aborted) return;
      coverageComparison = { key, band, before: baselineCoverage.get(band), after: coverageArea(grid) };
      paintedCoverage = { grid, antennas: snapshot.antennas.map((a) => a.id), key };
      paintCoverageView();
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
  $("legend").replaceChildren(...items.map(([c, t]) => el("div", {}, el("span", { className: "sw", style: `background:${c}` }), t)));
  // Who serves where: one colour per sector; the stronger the signal, the deeper the colour.
  // With an antenna selected, only the area it serves (select none to see them all again).
  const focus = site.antennas.some((a) => a.id === selectedId) ? selectedId : null;
  const sectors = focus ? [focus.split("-")[0]]
    : sectorIds().filter((sector) => site.antennas.some((a) => a.id.startsWith(`${sector}-`) && a.bands.some((x) => x.name === coverageBand)));
  if (layers.coverage) $("legend").append(
    el("div", { className: "coverage-key" }, ...sectors.flatMap((sector) => [el("span", { className: "sw", style: `background:${sectorColor(sector)}` }), el("span", { textContent: focus ?? sector })])),
    el("div", { textContent: focus ? `Coverage ${coverageBand ?? ""}: area served by ${focus}, deeper = stronger · click it again to see all`
      : `Coverage ${coverageBand ?? ""}: area served by each sector, deeper = stronger` }),
    el("div", { className: "muted", textContent: coveragePending ? "Calculating coverage…" : "Coverage is indicative (Hata model, no terrain)." }));

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
    showSaved(delta);
  }
  previousAssessment = nextAssessment;
  renderPanels(zones, checks, diffSites(baseline, site));
  renderComparison(checks);
  clearTimeout(saveTimer); saveTimer = setTimeout(saveSessionPlan, 120);

  renderCoverage();
  renderLegend();
  renderAntennaPicker();
  renderStats();
}

function select(id, finding = null) {
  const changed = id !== selectedId || (finding?.building ?? null) !== sceneMotion.selectedBuilding;
  selectedId = id;
  // The coverage view shows the selected antenna's own area, so it needs a band that antenna carries.
  const carried = site.antennas.find((a) => a.id === id)?.bands ?? [];
  if (layers.coverage && carried.length && !carried.some((x) => x.name === coverageBand)) {
    coverageBand = [...carried].sort((x, y) => x.frequency_mhz - y.frequency_mhz)[0].name;
    refreshCoverageBands();
  }
  if (id && !finding) showCard("antenna", { reveal: true });
  update();
  renderEditor();
  paintCoverageView();
  // The camera stays where the engineer put it; only a finding (a building in conflict) is flown to.
  if (changed && id && finding) sceneMotion.focus(id, finding.building ?? null);
}

function bandNames() {
  return [...new Set(site.antennas.flatMap((a) => a.bands.map((x) => x.name)))];
}
function refreshCoverageBands() {
  const names = bandNames();
  // The lowest band reaches farthest: the natural first look at the coverage area.
  const lowest = site.antennas.flatMap((a) => a.bands).sort((x, y) => x.frequency_mhz - y.frequency_mhz)[0]?.name ?? null;
  if (!names.includes(coverageBand)) coverageBand = lowest;
  for (const select of [$("coverageBand"), $("viewBand")]) select.replaceChildren(...names.map((n) => el("option", { value: n, textContent: n, selected: n === coverageBand })));
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
$("reset").onclick = () => { undoStack.push(clone(site)); site = clone(baseline); selectedId = null; lastReason = null; refreshCoverageBands(); update(); renderEditor(); };
// The same reset under the plan: the first click asks, the second resets (and Undo brings it back).
let resetArmed = null;
$("planReset").onclick = () => {
  if (!resetArmed) {
    $("planReset").textContent = "↺ Click again to reset the plan";
    resetArmed = setTimeout(() => { resetArmed = null; $("planReset").textContent = "↺ Reset the plan"; }, 4000);
    return;
  }
  clearTimeout(resetArmed); resetArmed = null;
  $("planReset").textContent = "↺ Reset the plan";
  $("reset").click();
};
async function buildPlan() {
  const entry = (await portfolioIndex().catch(() => ({ sites: [] }))).sites.find((s) => s.site_id === site.site_id);
  const { plan, zones, checks, order, changes } = sitePlan({ site, baseline, entry, regimeKey, reason: lastReason, kpi });
  const data = {
    site_id: site.site_id, regime: REGIMES[regimeKey].name, created: new Date().toISOString(),
    changes, checks: checks.findings, zones, baseline, proposed: site, actions: planActions, field_work_order: order,
  };
  return { plan, data };
}
// The current camera view drawn once with the source plan and once with the proposed one.
function captureScene(s) {
  const regime = REGIMES[regimeKey];
  const zones = siteZones(s, regime);
  sceneMotion.sync(s, zones, checkSite(s, zones), layers, baseline, siteZones(baseline, regime), null);
  renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, camera);
  return { image: renderer.domElement.toDataURL("image/png"), headline: headline(checkSite(s, zones)) };
}
async function beforeAfter() {
  const after = captureScene(site), before = captureScene(baseline);
  update();
  // Lead with what the change fixed ("School no longer inside an EMF zone"), as the action plan does.
  const fixed = result(before.headline, after.headline)[0];
  if (fixed !== after.headline.text) after.headline = { level: "ok", text: fixed };
  openSnapshot(await composeBeforeAfter({ site: site.site_id, before, after }), site.site_id);
}
$("export").onclick = async () => {
  const { plan, data } = await buildPlan();
  openActionPlan(plan, { data, extra: [{ label: "Before / after", onclick: beforeAfter }] });
};
$("regime").onchange = (e) => { regimeKey = e.target.value; update(); };
$("coverageBand").onchange = $("viewBand").onchange = (e) => { coverageBand = e.target.value; refreshCoverageBands(); renderCoverage(); renderLegend(); saveSessionPlan(); };
$("undo").onclick = () => planner.undo();
function syncLayerChips() {
  for (const chip of document.querySelectorAll(".chip[data-layer]")) {
    chip.classList.toggle("on", layers[chip.dataset.layer]);
    chip.setAttribute("aria-pressed", String(layers[chip.dataset.layer]));
  }
  $("coverageRow").hidden = !layers.coverage;
  for (const button of document.querySelectorAll("[data-view-layer]")) button.setAttribute("aria-pressed", String(layers[button.dataset.viewLayer]));
  $("viewBand").hidden = !layers.coverage;
  refreshCoverageBands();
}
// The same layers, on the 3D view itself.
for (const button of document.querySelectorAll("[data-view-layer]")) {
  button.onclick = () => {
    layers[button.dataset.viewLayer] = !layers[button.dataset.viewLayer];
    syncLayerChips();
    update();
  };
}
for (const chip of document.querySelectorAll(".chip[data-layer]")) {
  chip.onclick = () => {
    layers[chip.dataset.layer] = !layers[chip.dataset.layer];
    syncLayerChips();
    update();
  };
}

const raycaster = new THREE.Raycaster();
// Antennas are a few pixels wide from a distance: a click that misses them but lands
// this close to one on screen still selects it.
const PICK_RADIUS_PX = 28;
function nearestAntenna(clientX, clientY) {
  const r = renderer.domElement.getBoundingClientRect();
  let best = null, bestDistance = PICK_RADIUS_PX;
  antennaGroup.traverse((part) => {
    if (!part.isMesh || !part.userData.antennaId) return;
    const p = part.getWorldPosition(new THREE.Vector3()).project(camera);
    const distance = Math.hypot(r.left + (p.x + 1) / 2 * r.width - clientX, r.top + (1 - p.y) / 2 * r.height - clientY);
    if (p.z < 1 && distance < bestDistance) { best = part.userData.antennaId; bestDistance = distance; }
  });
  return best;
}
let downAt = null;
renderer.domElement.addEventListener("pointerdown", (e) => (downAt = [e.clientX, e.clientY]));
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
  const r = renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hit = raycaster.intersectObjects(antennaGroup.children, true).find((h) => h.object.userData.antennaId);
  select(hit ? hit.object.userData.antennaId : nearestAntenna(e.clientX, e.clientY));
});

// One button per antenna on the 3D view: always a sure way to pick one, however small it looks.
let pickerSignature = "";
function renderAntennaPicker() {
  const ids = site.antennas.map((a) => a.id);
  const signature = JSON.stringify([ids, selectedId]);
  if (signature === pickerSignature) return;
  pickerSignature = signature;
  $("antennaPicker").replaceChildren(el("span", { className: "muted", textContent: "Antennas" }), ...ids.map((id) => {
    const button = el("button", { type: "button", textContent: id, ariaPressed: String(id === selectedId) });
    button.onclick = () => select(id === selectedId ? null : id);
    return button;
  }));
}

// ---------- assistant chat ----------
const chat = initConversation({
  onBusy: (on) => voice.setRunning(on),
  onComplete: () => { if (pendingOpen && pageActive) location.href = pendingOpen; },
  speak: (text) => voice.speak(text),
  // One conversation per site: switching sites must not show another site's chat.
  transcriptKey: `twin:${absoluteUrl(src)}`,
  // The engineer picked one of the agent's choices: apply it here (the antennas move on the 3D view),
  // tell the agent, and bring the plan forward on the right, ready to send to the team.
  onApplyOption: ({ label, changes }) => {
    const r = planner.apply(changes, label);
    if (r.errors) return chat.say("tool", `✕ ${r.errors.join(", ")}`);
    chat.say("tool", `✓ Applied to plan: ${label}`);
    agent.note(`I applied option "${label}" from your choices myself (apply_change done). Do not apply it again.`);
    chat.say("assistant", tr("The plan is ready: the field work is on the right, and you can send the action plan to the team from there."));
    showCard("crew", { reveal: true });
  },
  // A choice that is not one of the compared options (or a question): the agent takes it from there.
  onChoice: (text) => agent.ask(text),
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
// The logo opens the map's home view (all sites, nothing selected); "Portfolio" goes back to where the map was.
document.querySelector(".app-brand").href = `portfolio.html?${new URLSearchParams({ portfolio: portfolioUrl, home: "1" })}`;

// Streets under the twin. The position comes from the portfolio (the twin carries none);
// without it, or offline, the plain ground and its grid stay.
portfolioIndex().then(async (index) => {
  const entry = index.sites.find((s) => s.site_id === site.site_id);
  if (!Number.isFinite(entry?.lat) || !Number.isFinite(entry?.lon)) return;
  const streets = await groundMap({ lat: entry.lat, lon: entry.lon, wash: token("scene-ground") });
  if (!streets) return;
  const texture = new THREE.CanvasTexture(streets.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  ground.geometry.dispose();
  ground.geometry = new THREE.PlaneGeometry(streets.width, streets.depth);
  ground.position.set(streets.x, 0, streets.z);
  Object.assign(ground.material, { map: texture, needsUpdate: true });
  ground.material.color.set(0xffffff);
  for (const grid of grids) grid.visible = false;
  $("mapAttribution").hidden = false;
  sceneMotion.changedGeometry();
}).catch(() => {});
refreshCoverageBands();
update();
$("loading").hidden = true;
intro.play();

// Opened from the portfolio map: the Expert Operator carries out what was asked there.
// Without a task, the page starts quietly: a fresh chat, a short welcome and ready questions.
const handoff = consumeHandoff(params);
if (freshOpen) {
  chat.clear();
  const url = new URL(location.href);
  url.searchParams.delete("fresh");
  history.replaceState(history.state, "", url.href);
}
if (!handoff && !$("chatLog").children.length) {
  $("chatLog").append(el("div", { className: "msg assistant welcome", textContent:
    tr(`${site.site_id} is open: its current state is on the right. Pick a question below, or ask your own.`) }));
}
const stop = progress(site.site_id);
if (stop) $("breadcrumbSite").textContent = `${site.site_id} · ${stop.done}/${stop.total}`;
if (handoff) {
  agent.ask(handoff.instruction, { voice: handoff.voice }).then(async () => {
    // On a portfolio tour: keep this site's action plan, then open the next site.
    if (!stop || pendingOpen) return;
    const { plan, data } = await buildPlan();
    const next = finishStop(site.site_id, data.changes.length ? plan : null);
    $("chatBusy").hidden = false;
    $("chatBusy").textContent = tr("Next site in a few seconds…");
    setTimeout(() => { if (pageActive) location.href = next; }, 4000);
  });
}


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
