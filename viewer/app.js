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
import { twinKpi, TRAFFIC_GROWTH, monthsUntil } from "./kpi.js";
import { groundMap } from "./groundmap.js";
import { createIntro } from "./intro.js";
import { fieldWorkOrder } from "./fieldwork.js";
import { $, el, token, initShell, setText, reducedMotion, confirmClick } from "./ui.js";
import { initCards, showCard, hideCard, setCardSummary, foldCard } from "./cards.js";
import { crewPlan } from "./crew.js";
import { openActionPlan, result, diffSites, diffSteps, sitePlan, FIELDS, sendByEmail } from "./actionplan.js";
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
// Where the busiest cell will be in a year, for "what if nothing changes" (growth: see kpi.js).
function capacityOutlook() {
  const cell = kpi?.cells[0];
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
let coverageBand = freshOpen ? null : restored.view.coverageBand ?? null;
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
const camera = new THREE.PerspectiveCamera(45, 1, 1, 3000);
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

// The structure of a ground site. The file gives the antennas' heights and places them around it;
// the structure is drawn from them: a tapering lattice or tube up to just above the highest antenna,
// a platform ring at each antenna level and an arm out to each antenna. It follows the plan when an
// antenna is raised above the top.
const TOWER_KINDS = new Set(["lattice_tower", "monopole", "pole"]);
const towerKind = TOWER_KINDS.has(baseline.structure) ? baseline.structure : null;
const towerGroup = new THREE.Group();
const towerMaterial = softenShadow(new THREE.MeshStandardMaterial({ color: token("scene-pole"), roughness: 0.6, metalness: 0.35 }));
scene.add(towerGroup);
let towerSignature = "";
function renderTower(state) {
  if (!towerKind) return;
  const levels = [...new Set(state.antennas.map((a) => Math.round(a.height_agl_m * 2) / 2))].sort((x, y) => x - y);
  const top = Math.max(6, ...levels) + 1.2;
  const signature = JSON.stringify(state.antennas.map((a) => [a.x_m, a.z_m, a.height_agl_m]));
  if (signature === towerSignature) return;
  towerSignature = signature;
  for (const child of [...towerGroup.children]) { child.geometry.dispose(); towerGroup.remove(child); }
  const parts = [];
  const up = new THREE.Vector3(0, 1, 0);
  const strut = (from, to, radius) => {
    const along = to.clone().sub(from);
    const g = new THREE.CylinderGeometry(radius, radius, along.length(), 6, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, along.normalize()));
    g.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
    parts.push(g);
  };
  if (towerKind === "lattice_tower") {
    // Four legs, wide at the foot and narrow at the top, braced crosswise every few metres.
    const half = (y) => THREE.MathUtils.lerp(Math.max(2.2, top * 0.06), 0.75, y / top);
    const corners = (y) => [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([sx, sz]) => new THREE.Vector3(sx * half(y), y, sz * half(y)));
    const heights = [];
    for (let y = 0; y < top - 1; y += 4) heights.push(y);
    heights.push(top);
    for (let i = 0; i + 1 < heights.length; i++) {
      const lo = corners(heights[i]), hi = corners(heights[i + 1]);
      for (let c = 0; c < 4; c++) {
        const next = (c + 1) % 4;
        strut(lo[c], hi[c], 0.1);
        strut(lo[c], hi[next], 0.035);
        strut(lo[next], hi[c], 0.035);
        strut(hi[c], hi[next], 0.045);
      }
    }
  } else {
    const [topRadius, footRadius] = towerKind === "pole" ? [0.16, 0.24] : [0.3, 0.6];
    parts.push(new THREE.CylinderGeometry(topRadius, footRadius, top, 20).translate(0, top / 2, 0));
  }
  // A platform ring under each level of antennas, and an arm out to each one.
  for (const level of levels) {
    const at = state.antennas.filter((a) => Math.round(a.height_agl_m * 2) / 2 === level);
    const reach = Math.max(1, ...at.map((a) => Math.hypot(a.x_m, a.z_m)));
    parts.push(new THREE.TorusGeometry(reach, 0.06, 6, 40).rotateX(Math.PI / 2).translate(0, level - 0.7, 0));
    for (const a of at) strut(new THREE.Vector3(0, level - 0.7, 0), new THREE.Vector3(a.x_m, level - 0.7, a.z_m), 0.06);
  }
  const mesh = new THREE.Mesh(mergeGeometries(parts.map((g) => g.toNonIndexed())), towerMaterial);
  for (const g of parts) g.dispose();
  mesh.castShadow = mesh.receiveShadow = true;
  towerGroup.add(mesh);
}
renderTower(twin.site);

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
  ...(towerKind ? [{ object: towerGroup, kind: "up", delay: 500, duration: 700 }] : []),
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
// Smooth between the 6 m cells: hard steps read as pixels, not as a signal fading out.
coverageTexture.magFilter = THREE.LinearFilter;
const coveragePlane = new THREE.Mesh(new THREE.PlaneGeometry(COVERAGE_SIZE_M, COVERAGE_SIZE_M), new THREE.MeshBasicMaterial({ map: coverageTexture, transparent: true, depthWrite: false, toneMapped: false }));
coveragePlane.rotation.x = -Math.PI / 2;
coveragePlane.position.y = 0.05;
coveragePlane.visible = false;
scene.add(coveragePlane);

const sceneMotion = createSceneMotion({ THREE, scene, renderer, camera, controls, host, building: b,
  antennaGroup, zoneGroup, baselineGroup, neighbourMeshes, tower: Boolean(towerKind), onEditFrame: () => update() });

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

// ---------- a change the engineer watches ----------
// Applied by the agent or a chosen option: the antennas move at a readable pace and glow, the
// panel's sliders follow, the ground it newly covers flashes, and the numbers count to their new
// values. A band the change adds becomes the band shown: that is where the difference is.
const FLASH_MS = 2600;
// What the page itself can tell at once while the operator thinks about a question on the site: one
// plain line per fact, from the site as it stands. Instructions ("turn S2 to 150°") get none.
const ANALYSIS = /analy|analiz|incele|durum|state|capacity|kapasite|risk|okul|school|hastane|hospital/i;
function scanLines(asked) {
  if (!ANALYSIS.test(asked ?? "")) return [];
  const locale = document.documentElement.lang === "tr" ? "tr" : "en";
  const round = (n) => (Math.round(n / 100) * 100).toLocaleString(locale);
  const sectors = new Map();
  for (const a of baseline.antennas) if (!sectors.has(a.id.split("-")[0])) sectors.set(a.id.split("-")[0], Math.round(a.azimuth_deg));
  const bands = [...baseline.antennas.flatMap((a) => a.bands)].sort((x, y) => x.frequency_mhz - y.frequency_mhz);
  const population = populationContext(baseline);
  const zones = siteZones(baseline, REGIMES[regimeKey]);
  const lines = [
    { step: tr("Scanning the site data") },
    { text: `${tr("Structure")}: ${tr((baseline.structure ?? "rooftop").replaceAll("_", " "))}, ${tr(`${sectors.size} sectors`)}` },
    { text: `${tr("Antennas")}: ${[...sectors].map(([s, az]) => `${s} ${az}°`).join(", ")} · ${[...new Set(bands.map((b) => b.name))].join(", ")}` },
    { text: tr(`About ${round(population.total_people_nearby)} people live and work nearby (estimated)`) },
    { step: tr("Reviewing the technical data") },
    ...statusLines(baseline, checkSite(baseline, zones), population, { kpi }).map((l) => ({ text: tr(l.text), level: l.level })),
  ];
  if (bands.length) {
    const served = statsFor(coverageGrid(baseline, bands[0].name, COVERAGE_SIZE_M, COVERAGE_CELLS), baseline.antennas.map((a) => a.id), null);
    lines.push({ text: tr(`Coverage (${bands[0].name}): about ${round(served.people)} people in the covered area`) });
  }
  const outlook = capacityOutlook();
  if (outlook?.load_pct_in_one_year) {
    const load = outlook.load_pct_in_one_year;
    lines.push({ text: tr(`Next year: ${outlook.busiest_cell} at about ${load}% PRB`), level: load >= 85 ? "bad" : load >= 70 ? "warn" : "ok" });
  } else if (outlook) {
    lines.push({ text: tr(outlook.months_until_busy ? `The busiest sector gets crowded in about ${outlook.months_until_busy} months` : "The busiest sector is already crowded"), level: "warn" });
  }
  lines.push({ step: tr("Weighing what to do") });
  return lines;
}

// "New" on the 3D view: the halo around a changed antenna and the ground it newly covers.
const NEW_COLOR = "#12B76A";
let showcaseFrom = null;
// Resolves when the latest watched change has played out (the chat's closing line waits for it).
let lastShowcase = Promise.resolve();
function showcase(before, changes) {
  const ids = [...new Set(changes.map((c) => c.antenna_id).filter((id) => site.antennas.some((a) => a.id === id)))];
  const focus = ids[0] ?? null;
  const antenna = site.antennas.find((a) => a.id === focus);
  const lowest = (bands) => [...bands].sort((x, y) => x.frequency_mhz - y.frequency_mhz)[0];
  const isNew = changes.some((c) => c.action === "add_antenna" && c.antenna_id === focus);
  const added = !antenna ? null : isNew ? lowest(antenna.bands)
    : antenna.bands.find((b) => changes.some((c) => c.antenna_id === focus && (c.add_bands ?? []).includes(b.name)));
  // The change is told on the coverage map, so it is turned on for it.
  if (!layers.coverage && antenna && !reducedMotion.matches) { layers.coverage = true; syncLayerChips(); }
  if (layers.coverage && antenna) {
    if (added) coverageBand = added.name;
    else if (!antenna.bands.some((b) => b.name === coverageBand)) coverageBand = lowest(antenna.bands).name;
  }
  refreshCoverageBands();
  if (layers.coverage && coverageBand) {
    const grid = coverageGrid(before, coverageBand, COVERAGE_SIZE_M, COVERAGE_CELLS);
    const antennaIds = before.antennas.map((a) => a.id);
    showcaseFrom = { grid, antennaIds, focus };
    statsBefore = { focus, band: coverageBand, stats: statsFor(grid, antennaIds, focus) };
  }
  $("planReady").dataset.wait = "";
  // The change is played as a plan, step by step; then the plan is ready on top of the panel.
  lastShowcase = playPlan(before, focus, ids).then(() => {
    foldCard("antenna", true);
    glide(document.querySelector(".panel.cards"), 0);
    const ready = $("planReady");
    delete ready.dataset.wait;
    if (!ready.hidden && !reducedMotion.matches) ready.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 500, easing: "cubic-bezier(.16,1,.3,1)" });
  });
}
// One plain line on what the watched change did to the numbers in the box, or null.
function watchedSummary() {
  if (!statsBefore || !paintedCoverage || paintedCoverage.key !== JSON.stringify([coverageBand, site.antennas])) return null;
  const now = statsFor(paintedCoverage.grid, paintedCoverage.antennas, statsBefore.focus), then = statsBefore.stats;
  const turkish = document.documentElement.lang === "tr", locale = turkish ? "tr" : "en";
  const pct = (v) => (turkish ? `%${Math.round(v)}` : `${Math.round(v)}%`);
  const who = statsBefore.focus ?? tr("The site"), people = Math.round(now.people).toLocaleString(locale);
  // A layer that did not exist before has no "before": say what the new layer reaches.
  const line = then.covered === 0 && statsBefore.focus
    ? `Done: the new ${coverageBand} layer of ${who} reaches ${pct(now.covered)} of the area, about ${people} people.`
    : `Done: ${who} now reaches ${pct(now.covered)} of the area (was ${pct(then.covered)}), about ${people} people.`;
  return `${tr(line)} ${tr("The action plan is on the right, ready to send to the team.")}`;
}
// Cells the focus antenna (or the site) serves now and did not before: the ground the change wins.
function newlyServed(result, now) {
  if (!showcaseFrom) return null;
  const { grid: before, antennaIds, focus } = showcaseFrom;
  showcaseFrom = null;
  const after = now.antennas.map((a) => a.id).indexOf(focus), was = antennaIds.indexOf(focus);
  const mask = new Uint8Array(result.grid.length);
  let any = false;
  for (let k = 0; k < mask.length; k++) {
    const served = result.grid[k] >= USABLE_DBM && (!focus || result.server[k] === after);
    const servedBefore = before.grid[k] >= USABLE_DBM && (!focus || before.server[k] === was);
    if (served && !servedBefore) { mask[k] = 1; any = true; }
  }
  return any ? { mask, until: performance.now() + FLASH_MS } : null;
}
// Scrolls a panel softly by time, not by frames: the browser's own smooth scroll stalls while the
// 3D view is busy animating, and this one always arrives.
function glide(panel, top) {
  const from = panel.scrollTop, started = performance.now(), ms = reducedMotion.matches ? 0 : 600;
  let done = false;
  const frame = (now) => {
    if (done) return;
    panel.scrollTop = from + (top - from) * (1 - (1 - Math.min(1, (now - started) / ms)) ** 3);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  setTimeout(() => { done = true; panel.scrollTop = top; }, ms);
}
// The coverage map of a given state, with only one antenna's area strong (the story's "before").
function paintCoverageOf(result, antennaIds, focusId) {
  const index = antennaIds.indexOf(focusId);
  paintBestServer(coverageCanvas, result, (i) => rgb(sectorColor(antennaIds[i].split("-")[0])), index < 0 ? null : index, null, rgb(NEW_COLOR));
  coverageTexture.needsUpdate = true;
  coveragePlane.visible = true;
  sceneMotion.invalidate();
}
// The line over the 3D view that says which part of the story is showing: before, change, after.
function storyCaption(tag, text) {
  const box = $("storyCaption");
  if (!tag) { box.hidden = true; return; }
  box.dataset.tag = tag.toLowerCase();
  $("storyTag").textContent = tr(tag);
  $("storyText").textContent = tr(text);
  box.hidden = false;
  if (!reducedMotion.matches) box.animate([{ opacity: 0, transform: "translate(-50%, -6px)" }, { opacity: 1, transform: "translate(-50%, 0)" }], { duration: 400, easing: "cubic-bezier(.16,1,.3,1)" });
}
// A value shown on an editor control without changing the plan (the playback moves the controls).
function showValue(input, value) {
  input.value = value;
  input.nextElementSibling.textContent = input.closest("#bands") ? `${value} W` : value;
  if (input.userNumeric) input.userNumeric.value = value;
}
// The editor showing the selected antenna as it stands at this point of the playback, not as it ends.
function editorAt(state) {
  renderEditor();
  const a = state.antennas.find((x) => x.id === selectedId);
  if (!a) return;
  for (const input of document.querySelectorAll("#editor input[data-k]")) showValue(input, a[input.dataset.k]);
  for (const row of $("bands").children) {
    const band = a.bands.find((b) => b.name === row.dataset.band);
    row.hidden = !band;
    if (band) showValue(row.querySelector("input"), band.tx_power_w);
  }
}

// The change played the way an operator would make it. The manual card first lists every step of
// the plan; then each step in turn lights up, its control moves in the editor, its antenna moves on
// the 3D view, and it is ticked off. Coverage and the numbers follow once the last step is done.
const STEP_MS = 2600, PAUSE_MS = 1400;
async function playPlan(before, focus, ids) {
  const target = site;
  sceneMotion.scan(false); // the examining is over: now the change itself is watched
  const finish = () => { selectedId = focus ?? selectedId; update({ animate: true, slow: true }); sceneMotion.highlight(ids, NEW_COLOR); renderEditor(); };
  const steps = [];
  for (const step of diffSteps(before, target)) {
    // An antenna that already stands is picked first, as the operator would on the 3D view.
    if (step.kind !== "add" && step.kind !== "remove" && steps.at(-1)?.id !== step.id) steps.push({ id: step.id, kind: "select", line: `Select ${step.id}` });
    steps.push(step);
  }
  if (!steps.length || reducedMotion.matches) { finish(); return; }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const press = (control) => { control.classList.add("pressed"); setTimeout(() => control.classList.remove("pressed"), 600); };
  // Frames move the slider; a timer ends it, so a hidden tab (no frames) never stalls the playback.
  const slide = (input, a, b) => new Promise((resolve) => {
    const row = input.closest(".row");
    row.classList.add("changing");
    const started = performance.now();
    let done = false;
    const frame = (now) => {
      if (done) return;
      const t = Math.min(1, (now - started) / 1600);
      showValue(input, Math.round((a + (b - a) * (1 - (1 - t) ** 3)) * 10) / 10);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    setTimeout(() => { done = true; showValue(input, b); row.classList.remove("changing"); resolve(); }, 1600);
  });
  const regime = REGIMES[regimeKey];
  const showScene = (state) => {
    renderTower(state);
    const zones = siteZones(state, regime);
    sceneMotion.sync(state, zones, checkSite(state, zones), layers, baseline, siteZones(baseline, regime), selectedId, { animate: true, slow: true });
  };
  const pick = (id) => { selectedId = id; renderAntennaPicker(); };
  const bandRow = (name) => [...$("bands").children].find((row) => row.dataset.band === name);

  const azimuthOf = (id, state) => state.antennas.find((a) => a.id === id)?.azimuth_deg ?? 0;
  // The plan first: the card opens with every step waiting its turn.
  const card = document.querySelector('.card[data-card="antenna"]'), panel = card.closest(".panel");
  foldCard("antenna", false);
  card.classList.add("operating");
  const title = $("operatorTitle"), list = $("operatorSteps");
  title.hidden = list.hidden = false;
  title.className = "operator-title";
  title.textContent = `The plan: ${steps.length} steps`;
  const items = steps.map((step) => el("li", { className: "pending", textContent: step.line }));
  items.forEach((item, i) => { item.style.animationDelay = `${i * 140}ms`; });
  list.replaceChildren(...items);
  let state = structuredClone(before);
  editorAt(state);
  glide(panel, panel.scrollTop + card.getBoundingClientRect().top - panel.getBoundingClientRect().top - 8);
  // The story on the 3D view: from afar, only this antenna's area of service today; then close in
  // on it while the steps play; then afar again for its new area (the new ground flashes green).
  const story = Boolean(showcaseFrom && focus);
  const existed = before.antennas.some((a) => a.id === focus);
  let closeOn = null;
  if (story) {
    paintCoverageOf(showcaseFrom.grid, showcaseFrom.antennaIds, existed ? focus : null);
    if (existed) pick(focus);
    showScene(state);
    storyCaption("Before", !existed ? "The site's coverage today"
      : statsBefore?.stats.covered ? `${focus}: its ${coverageBand} coverage today` : `${focus} has no ${coverageBand} coverage yet`);
    await Promise.all([sceneMotion.shot("wide", focus, azimuthOf(focus, existed ? before : target)), wait(PAUSE_MS + steps.length * 140)]);
    await wait(1800);
    storyCaption("Change", `Watching the work on ${focus}`);
    await sceneMotion.shot("close", focus, azimuthOf(focus, existed ? before : target), 1600);
    closeOn = focus;
  } else await wait(PAUSE_MS + steps.length * 140);

  // Then one step at a time.
  for (const [i, step] of steps.entries()) {
    if (site !== target) break; // undone, reset or replaced meanwhile: stop and show what is there now
    items[i].className = "active";
    title.textContent = `Step ${i + 1} of ${steps.length}`;
    const started = performance.now();
    if (step.kind === "select") {
      pick(step.id);
      const button = [...$("antennaPicker").querySelectorAll("button")].find((b) => b.textContent === step.id);
      if (button) press(button);
      editorAt(state);
      // Another antenna in the same plan: the camera moves on to it.
      if (story && step.id !== closeOn) {
        storyCaption("Change", `Watching the work on ${step.id}`);
        await sceneMotion.shot("close", step.id, azimuthOf(step.id, state), 1400);
        closeOn = step.id;
      }
      sceneMotion.highlight([step.id], NEW_COLOR, 2200);
      showScene(state);
      await wait(1400);
    } else {
      if (step.kind === "add") { press($("addAntenna")); await wait(600); step.apply(state); pick(step.id); editorAt(state); }
      else if (step.kind === "remove") { press($("removeAntenna")); await wait(600); step.apply(state); }
      else if (step.kind === "band") {
        const preset = [...$("bandPreset").options].find((o) => BAND_PRESETS[o.value]?.name === step.band);
        if (preset) { $("bandPreset").value = preset.value; press($("bandPreset")); await wait(700); }
        press($("addBand"));
        await wait(400);
        step.apply(state);
        editorAt(state);
        bandRow(step.band)?.classList.add("just-added");
      } else if (step.kind === "removeBand") {
        const remove = bandRow(step.band)?.querySelector("button");
        if (remove) { press(remove); await wait(600); }
        step.apply(state);
        editorAt(state);
      } else {
        const input = step.kind === "field" ? document.querySelector(`#editor input[data-k="${step.key}"]`) : bandRow(step.band)?.querySelector("input");
        step.apply(state);
        showScene(state);
        if (input) await slide(input, step.from, step.to);
      }
      if (step.kind !== "field" && step.kind !== "power") showScene(state);
      sceneMotion.highlight([step.id], NEW_COLOR, STEP_MS);
      await wait(Math.max(0, STEP_MS - (performance.now() - started)));
    }
    items[i].className = "done";
    await wait(350);
  }

  // Done: back afar, coverage and the numbers catch up with the whole plan, then the card closes.
  if (story) {
    storyCaption("After", `${focus}: its new ${coverageBand} coverage, new ground in green`);
    await sceneMotion.shot("wide", focus, azimuthOf(focus, target));
  }
  finish();
  title.className = "operator-title done";
  title.textContent = `Done: all ${steps.length} steps applied`;
  await wait(FLASH_MS + (story ? 1600 : 400));
  storyCaption(null);
  card.classList.remove("operating");
}

const planner = {
  get site() { return site; },
  // Resolves when the change being played on screen has finished (the agent waits before replying).
  settled: () => lastShowcase,
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
    const before = site;
    site = candidate;
    selectedId = changes[0]?.antenna_id ?? selectedId;
    showcase(before, changes);
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
  $("manualHint").hidden = Boolean(a);
  if (!a) { setCardSummary("antenna", ""); return; }
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
    const row = el("div", { className: "row" }, el("label", { textContent: `${band.name} W` }), range, out, del);
    row.dataset.band = band.name;
    bands.append(row);
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
  $("planUndo").hidden = !undoStack.length;
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

// The overview on top of the panel: the site as it stands today, the plan in plain words and, once
// there is a plan, the same points as they would be after it. The plan is only a simulation, so the
// current state stays on top and never gives way to it.
let overviewSignature = "", currentState = null;
function renderOverview(checks, changes, crew) {
  if (currentState?.of !== baseline || currentState.regime !== regimeKey || currentState.kpi !== kpi) {
    const zones = siteZones(baseline, REGIMES[regimeKey]);
    currentState = { of: baseline, regime: regimeKey, kpi, lines: statusLines(baseline, checkSite(baseline, zones), populationContext(baseline), { kpi }) };
  }
  const now = currentState.lines;
  const after = changes.length ? statusLines(site, checks, populationContext(site), { coverageLoss: currentCoverageLoss(), kpi, before: baseline }) : [];
  const steps = planSteps(baseline, site);
  const install = crew.visits.find((v) => v.name === "Installation visit");
  const crewText = !changes.length || !crew.visits.length ? "" : install ? `Field work: ${crew.headcount} people · ${install.days} day(s)` : "Field work: remote only, no site visit";
  const signature = JSON.stringify([now, after, steps, crewText]);
  if (signature === overviewSignature) return;
  overviewSignature = signature;
  const icon = { ok: "✓", warn: "!", bad: "✕" };
  const items = (lines) => lines.map((l) => el("li", { className: l.level }, el("span", { className: "mark", ariaHidden: "true", textContent: icon[l.level] }), el("span", { textContent: l.text })));
  $("statusLines").replaceChildren(...items(now));
  $("planSteps").replaceChildren(...(steps.length
    ? steps.map((t) => el("li", { textContent: t }))
    : [el("li", { className: "muted", textContent: "No changes yet. Ask the Expert Operator, or select an antenna to edit it." })]));
  $("afterHeading").hidden = $("afterLines").hidden = !after.length;
  $("afterLines").replaceChildren(...items(after));
  // One line once there is a plan: it is ready, what it takes, and the two things to do with it.
  $("planReady").hidden = !changes.length;
  $("planReadyCrew").textContent = crewText;
}

// The action plan opens with e-mail, copy, print and share for the site chief.
$("reviewPlan").onclick = () => $("export").click();
$("sendPlanNow").onclick = async () => { const { plan } = await buildPlan(); await sendByEmail(plan); };
$("planUndo").onclick = () => { planner.undo(); agent.note("The engineer undid the last change by hand."); };
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
  const fresh = paintedCoverage.fresh && performance.now() < paintedCoverage.fresh.until ? paintedCoverage.fresh.mask : null;
  paintBestServer(coverageCanvas, grid, (index) => rgb(sectorColor(antennas[index].split("-")[0])), focus < 0 ? null : focus, fresh, rgb(NEW_COLOR));
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
// People served, area covered and area with a strong signal, for the site or one antenna,
// from a coverage result ({ grid, server, n, size }) and the antenna ids it was computed for.
function statsFor(result, antennaIds, focus) {
  const { grid, server, n, size } = result;
  const index = focus ? antennaIds.indexOf(focus) : -1;
  if (focus && index < 0) return { people: 0, covered: 0, strong: 0 };
  const mine = (k) => index < 0 || server[k] === index;
  // Covered: any usable signal; strong: the deeper colours. Shares of the whole 1.2 km area.
  let usable = 0, deep = 0;
  for (let k = 0; k < grid.length; k++) if (mine(k)) { if (grid[k] >= USABLE_DBM) usable++; if (grid[k] >= STRONG_DBM) deep++; }
  // People served: those living in cells this antenna (or the site) serves with a usable signal.
  let people = 0;
  for (const r of residents) {
    const i = Math.floor(((r.x + size / 2) / size) * n), j = Math.floor(((r.z + size / 2) / size) * n);
    if (i < 0 || j < 0 || i >= n || j >= n) continue;
    const k = j * n + i;
    if (grid[k] >= USABLE_DBM && mine(k)) people += r.people;
  }
  return { people, covered: (100 * usable) / grid.length, strong: (100 * deep) / grid.length };
}
// Set by a watched change (showcase): the numbers before it, so the box counts to the new ones.
let statsBefore = null;
let countFrame = 0;
function renderStats() {
  const focus = site.antennas.some((a) => a.id === selectedId) ? selectedId : null;
  const current = layers.coverage && paintedCoverage?.key === JSON.stringify([coverageBand, site.antennas])
    ? statsFor(paintedCoverage.grid, paintedCoverage.antennas, focus) : null;
  const turkish = document.documentElement.lang === "tr";
  const locale = turkish ? "tr" : "en";
  // Whole numbers, but a small share keeps one decimal instead of rounding to nothing.
  const pct = (v) => {
    const text = v === 0 ? "0" : v < 0.1 ? (turkish ? "<0,1" : "<0.1") : v.toLocaleString(locale, { maximumFractionDigits: v < 10 ? 1 : 0 });
    return turkish ? `%${text}` : `${text}%`;
  };
  const people = (v) => `~${Math.round(v).toLocaleString(locale)}`;
  const compare = current && statsBefore?.focus === focus && statsBefore.band === coverageBand ? statsBefore.stats : null;
  const delta = (now, then, format) => {
    const d = now - then;
    if (Math.abs(d) < 0.05) return [];
    return [el("em", { className: d > 0 ? "up" : "down", textContent: `${d > 0 ? "▲ +" : "▼ −"}${format(Math.abs(d))}` })];
  };
  const peopleValue = el("b"), coveredValue = el("b");
  $("sceneStats").replaceChildren(
    el("div", { className: "stats-title", textContent: focus ?? "Whole site" }),
    el("div", { className: "stat-row" }, peopleValue, el("span", { textContent: focus ? "people in the area it serves (estimated)" : "people in the covered area (estimated)" }),
      ...(compare ? delta(current.people, compare.people, (v) => Math.round(v).toLocaleString(locale)) : [])),
    el("div", { className: "stat-row" }, coveredValue, el("span", { textContent: focus ? "of the area gets its signal" : "of the area is covered" }),
      ...(compare ? delta(current.covered, compare.covered, pct) : [])),
    ...(current ? [el("div", { className: "stat-note", textContent: `Strong signal: ${pct(current.strong)} of the area` })] : []),
    el("div", { className: "muted", textContent: `${coverageBand ?? ""} · 1.2 km × 1.2 km around the site` }),
  );
  cancelAnimationFrame(countFrame);
  if (!current) { peopleValue.textContent = coveredValue.textContent = "…"; return; }
  if (!compare || reducedMotion.matches || statsBefore.counted) { peopleValue.textContent = people(current.people); coveredValue.textContent = pct(current.covered); return; }
  // Count from the old numbers to the new ones, once, so the change is felt.
  const started = performance.now(), from = compare;
  statsBefore.counted = true;
  const step = (now) => {
    const t = Math.min(1, (now - started) / 1400);
    const e = 1 - (1 - t) ** 3;
    peopleValue.textContent = people(from.people + (current.people - from.people) * e);
    coveredValue.textContent = pct(from.covered + (current.covered - from.covered) * e);
    if (t < 1) countFrame = requestAnimationFrame(step);
  };
  countFrame = requestAnimationFrame(step);
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
      paintedCoverage = { grid, antennas: snapshot.antennas.map((a) => a.id), key, fresh: newlyServed(grid, snapshot) };
      if (paintedCoverage.fresh) setTimeout(() => { if (paintedCoverage?.key === key) paintCoverageView(); }, FLASH_MS + 50);
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
  renderTower(site);
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
  if (id !== selectedId) statsBefore = null;
  selectedId = id;
  // The coverage view shows the selected antenna's own area, so it needs a band that antenna carries.
  const carried = site.antennas.find((a) => a.id === id)?.bands ?? [];
  if (layers.coverage && carried.length && !carried.some((x) => x.name === coverageBand)) {
    coverageBand = [...carried].sort((x, y) => x.frequency_mhz - y.frequency_mhz)[0].name;
    refreshCoverageBands();
  }
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
$("reset").onclick = () => {
  undoStack.push(clone(site)); site = clone(baseline); selectedId = null; lastReason = null; refreshCoverageBands(); update(); renderEditor();
  agent.note("The engineer reset the plan: the site is back to its current state and none of the earlier changes are applied any more.");
};
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
$("undo").onclick = () => { planner.undo(); agent.note("The engineer undid the last change by hand."); };
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
  onBusy: (on) => { voice.setRunning(on); sceneMotion.scan(on); },
  scanLines,
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
    lastShowcase.then(() => chat.say("assistant", watchedSummary() ?? tr("The plan is ready: the field work is on the right, and you can send the action plan to the team from there.")));
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
