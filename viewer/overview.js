// The site at a glance, in plain words: what is good and what is not, then
// what the plan changes, without antenna parameters. The detailed cards
// (checks, changes, crew, work order) stay below for whoever needs them.

import { PRB_BALANCE, PRB_EXPAND, monthsUntil } from "./kpi.js";
import { safetyZone, HEALTH } from "./emf.js";

// Buildings are analysed within this radius (the importer's neighbours, sitetwin3d/osm.py).
export const CHECK_RADIUS_M = 150;
// How far the 3 V/m health-facility level reaches from the site's strongest antenna: past
// CHECK_RADIUS_M, a hospital or clinic could be above it unseen.
export const healthReach = (site) => Math.max(0, ...site.antennas.filter((a) => a.bands.length).map((a) => safetyZone(a, HEALTH).front_m));

// Indicative, as on the portfolio map: people in one antenna's main lobe worth a capacity look.
export const CAPACITY_PEOPLE_PER_ANTENNA = 1500;
const sectorOf = (id) => id.split("-")[0];
// When OpenStreetMap was unavailable as the site file was loaded, every building counts as a home:
// schools and hospitals around the site are not identified (sitetwin3d/osm.py notes it).
export const usesUnknown = (site) => (site.notes ?? []).some((n) => n.startsWith("OpenStreetMap unavailable"));

// The site's most serious problem in one plain sentence, with what it means: on the map's card and
// in the twin's welcome. `cell`: the busiest measured cell, if any; `relieved`: the plan adds capacity
// on that cell's sector; `proposed`: a change is planned in SiteTwin 3D.
// `unknownUses`: schools and hospitals could not be identified (usesUnknown).
export function siteProblem({ findings, hit }, population, { cell = null, relieved = false, proposed = false, unknownUses = false } = {}) {
  const bad = findings.filter((f) => f.level === "bad");
  const sensitive = bad.filter((f) => f.sensitive);
  const busiest = Object.entries(population.people_per_antenna).sort((a, b) => b[1] - a[1])[0];
  const busyCell = cell && !relieved && cell.prb_dl_pct >= PRB_BALANCE;
  const busySector = !cell && busiest && busiest[1] > CAPACITY_PEOPLE_PER_ANTENNA;
  if (sensitive[0]?.health) return `The field from ${sensitive[0].antenna} at a hospital is above 3 V/m in the planning model, the level set for health facilities and used here as a screen: it needs a fix or a measurement.`;
  if (sensitive.length) return `A ${sensitive[0].use} is inside the EMF safety zone of ${sensitive[0].antenna} in the planning model: it needs a fix or a measurement.`;
  if (bad.length) return `The EMF safety zone reaches ${hit.size} neighbouring ${hit.size === 1 ? "building" : "buildings"} in the planning model: it needs a fix or a measurement.`;
  if (unknownUses) return "Building uses are unknown here (OpenStreetMap was unavailable when the site file was loaded): schools and hospitals are not identified, so load the file again.";
  if (busyCell && cell.prb_dl_pct >= PRB_EXPAND) return `Cell ${cell.sector} ${cell.band} is ${cell.prb_dl_pct}% full in the busy hour: users there are likely slowed down.`;
  if (busyCell) return `Cell ${cell.sector} ${cell.band} runs at ${cell.prb_dl_pct}% in the busy hour: at about 20% growth a year it could fill up within roughly ${Math.max(1, monthsUntil(cell.prb_dl_pct, PRB_EXPAND))} months (a rough estimate).`;
  if (busySector) return `About ${Math.round(busiest[1] / 100) * 100} people rely on sector ${sectorOf(busiest[0])} alone: its capacity may soon not be enough.`;
  if (findings.some((f) => f.level === "warn")) return "Part of the roof is inside an EMF zone: access must be restricted before anyone works there.";
  if (proposed) return "A change is planned in SiteTwin 3D; the site itself is unchanged.";
  return "No problem found in the model: no building in an EMF zone (school gardens not checked), no busy sector.";
}

const healthCheckLine = (reach) => `Health facilities are checked within ${CHECK_RADIUS_M} m; the 3 V/m distance reaches ${Math.round(reach)} m`;

// One line per topic, good or bad: [{ level: "ok" | "warn" | "bad", text, topic, fileOnly? }]. `topic` pairs a
// line today with the same point after the plan (compareLines); `fileOnly` lines are about the site file,
// shown for today only. A busy sector the plan adds capacity to counts as answered (its load after is not modelled).
// `coverageLoss`: bands that lose a large share of their coverage against the baseline.
// `kpi`: measured busy-hour load per cell; when given it replaces the population estimate.
// `before`: the site before the plan, to tell whether the plan adds capacity on the busy sector.
export function statusLines(site, checks, population, { coverageLoss = [], kpi = null, before = null } = {}) {
  const lines = [];
  const bad = checks.findings.filter((f) => f.level === "bad");
  const sensitiveUses = [...new Set(bad.filter((f) => f.sensitive && !f.health).map((f) => f.use))];
  const others = new Set(bad.filter((f) => !f.sensitive).map((f) => f.building));
  if (bad.some((f) => f.health)) lines.push({ level: "bad", topic: "hospital", text: "A hospital is above the 3 V/m health-facility level (screening, not a measurement)" });
  for (const use of sensitiveUses) lines.push({ level: "bad", topic: `use:${use}`, text: `A ${use} is inside an EMF zone` });
  for (const f of lowestHeights(bad)) lines.push({ level: "warn", topic: `height:${f.building}`, text: heightText(f) });
  // One all-clear line: about schools and hospitals when other buildings are hit, else about all.
  const sensitiveHit = sensitiveUses.length || bad.some((f) => f.health);
  const unknown = usesUnknown(site);
  if (unknown && !before) lines.push({ level: "warn", topic: "uses", fileOnly: true, text: "Building uses unknown (OpenStreetMap was unavailable): schools and hospitals are not identified, load the site file again" });
  if (others.size) {
    if (!sensitiveHit && !unknown) lines.push({ level: "ok", topic: "clear", text: "No school or hospital building found in an EMF zone (school gardens not checked)" });
    lines.push({ level: "bad", topic: "others", text: `EMF zone reaches ${others.size} other building(s)` });
  } else if (!sensitiveHit) lines.push({ level: "ok", topic: "clear", text: "No building found in an EMF zone (school gardens not checked)" });
  if (site.structure === "rooftop") {
    const roof = checks.findings.filter((f) => f.level === "warn").length;
    lines.push(roof ? { level: "warn", topic: "roof", text: "Part of the roof must be closed off" } : { level: "ok", topic: "roof", text: "No roof area inside a zone at head height" });
  }
  const cell = kpi?.cells?.[0];
  if (cell) {
    const name = `${cell.sector} ${cell.band}`, prb = cell.prb_dl_pct;
    if (prb < PRB_BALANCE) lines.push({ level: "ok", topic: "capacity", text: `No busy cell: busiest ${name} at ${prb}% PRB (${cell.tag})` });
    else if (before && capacityAdded(before, site).has(cell.sector)) lines.push({ level: "ok", topic: "capacity", text: `Cell ${name} at ${prb}% PRB (${cell.tag}): the plan adds capacity there, the load after it is not modelled` });
    else lines.push({ level: prb >= PRB_EXPAND ? "bad" : "warn", topic: "capacity", text: `Cell ${name} is ${prb >= PRB_EXPAND ? "full" : "busy"}: ${prb}% PRB in the busy hour (${cell.tag})` });
  } else {
    // The busy sector stays busy in people, but a plan that adds capacity there answers it.
    const busiest = Object.entries(population.people_per_antenna).sort((a, b) => b[1] - a[1])[0];
    const sector = busiest && sectorOf(busiest[0]), people = busiest && Math.round(busiest[1] / 100) * 100;
    if (!busiest || busiest[1] <= CAPACITY_PEOPLE_PER_ANTENNA) lines.push({ level: "ok", topic: "capacity", text: "No busy sector (estimated from the people nearby)" });
    else if (before && capacityAdded(before, site).has(sector)) lines.push({ level: "ok", topic: "capacity", text: `Sector ${sector} has about ${people} people: the plan adds capacity there` });
    else lines.push({ level: "warn", topic: "capacity", text: `Sector ${sector} is busy: about ${people} people` });
  }
  if (coverageLoss.length) lines.push({ level: "warn", topic: "coverage", text: `Coverage drops sharply: ${coverageLoss.map((l) => `${l.band} ${l.change_pct}%`).join(", ")}` });
  // A health facility beyond the checked radius could still be above 3 V/m: say where the check stops.
  const reach = healthReach(site);
  if (reach > CHECK_RADIUS_M) lines.push({ level: "warn", topic: "health-reach", text: healthCheckLine(reach) });
  // No building around at all makes "no building in a zone" an empty all-clear: the coordinates may be
  // wrong (or the site is rural).
  if (!before && !site.neighbours.length) lines.push({ level: "warn", topic: "neighbours", fileOnly: true, text: `No building found within ${CHECK_RADIUS_M} m: check the coordinates, unless the site is rural` });
  // The site as filed (not the plan): an antenna without a band, or a band without power, radiates
  // nothing here, most likely a gap in the file.
  if (!before) for (const a of site.antennas) {
    if (!a.bands.length) lines.push({ level: "warn", topic: `file:${a.id}`, fileOnly: true, text: `${a.id} has no band in the site file: it radiates nothing here, check the file` });
    for (const b of a.bands) if (!(b.tx_power_w > 0)) lines.push({ level: "warn", topic: `file:${a.id}:${b.name}`, fileOnly: true, text: `${a.id} ${b.name} has no power in the site file (0 W): check the file` });
  }
  return lines;
}

// The problems a plan leaves (statusLines with `before`): what still needs work. None left: the plan
// solves every problem found.
export const openProblems = (lines) => lines.filter((l) => l.level !== "ok" && !l.fileOnly).map(({ topic, text }) => ({ topic, text }));
// The same problems in a few words each, for the decision card.
export function problemName(topic) {
  if (topic === "hospital") return "hospital above 3 V/m";
  if (topic.startsWith("use:") || topic.startsWith("height:")) return "school or hospital in a zone";
  return { others: "buildings in a zone", roof: "roof partly closed off", capacity: "busy sector", coverage: "sharp coverage drop",
    "health-reach": "3 V/m past the checked 150 m" }[topic] ?? topic;
}

// The plan's lines against today's, so the engineer sees what it changes: each line after the plan
// with `change` "unchanged", "new" (a problem today does not have) or "worse" (or none: changed, or
// fine), then today's problems the plan clears ("fixed"), which have no line after it.
const RANK = { ok: 0, warn: 1, bad: 2 };
export function compareLines(now, after) {
  const today = new Map(now.map((l) => [l.topic, l]));
  const out = after.map((l) => {
    const was = today.get(l.topic);
    if (!was) return { ...l, change: l.level === "ok" ? null : "new" };
    if (was.text === l.text && was.level === l.level) return { ...l, change: "unchanged" };
    return { ...l, change: RANK[l.level] > RANK[was.level] ? "worse" : null };
  });
  const remaining = new Set(after.map((l) => l.topic));
  const fixed = now.filter((l) => l.level !== "ok" && !l.fileOnly && !remaining.has(l.topic)).map((l) => ({ ...l, level: "ok", change: "fixed" }));
  return [...fixed, ...out];
}

// A school or hospital whose height was assumed (no height in the open data): whether the finding
// hangs on that assumption, from the check's lowest storey count (viewer/checks.js), one line each.
export const heightLines = (findings) => lowestHeights(findings).map(heightText);
function lowestHeights(findings) {
  // Several antennas can reach the same building: it is in a zone from the lowest of their thresholds.
  const lowest = new Map();
  for (const f of findings) if (f.height_assumed && f.holds_from_storeys) {
    const seen = lowest.get(f.building);
    if (!seen || f.holds_from_storeys < seen.holds_from_storeys) lowest.set(f.building, f);
  }
  return [...lowest.values()];
}
const heightText = (f) => (f.holds_from_storeys > 1
  ? `Height of ${f.building} assumed (${f.assumed_storeys} storeys): the zone reaches it only from ${f.holds_from_storeys} storeys up, so measure it`
  : `Height of ${f.building} assumed (${f.assumed_storeys} storeys): the zone reaches it even at one storey, the lowest height tried`);

// Sectors where the plan adds capacity: a new antenna or a new band (more spectrum). More power
// is not capacity: it widens the coverage, the cell has the same resource blocks to share.
export function capacityAdded(before, after) {
  const prev = Object.fromEntries(before.antennas.map((a) => [a.id, a]));
  const out = new Set();
  for (const a of after.antennas) {
    const p = prev[a.id];
    if (!p || a.bands.some((b) => !p.bands.some((x) => x.name === b.name))) out.add(sectorOf(a.id));
  }
  return out;
}

// One line per kind of work; the same work on several sectors is one line ("on sectors S1, S2, S3").
const on = (sectors) => (sectors.length > 1 ? `sectors ${sectors.join(", ")}` : `sector ${sectors[0]}`);
const antennaOn = (sectors) => (sectors.length > 1 ? `antennas on ${on(sectors)}` : `antenna on ${on(sectors)}`);
const STEP_TEXT = {
  add5g: (s) => `Add 5G on ${on(s)}`,
  addBand: (s) => `Add a new frequency on ${on(s)}`,
  switchOff: (s) => `Switch off a frequency on ${on(s)}`,
  lowerPower: (s) => `Lower the power on ${on(s)} (remote)`,
  raisePower: (s) => `Raise the power on ${on(s)} for wider coverage`,
  raise: (s) => `Raise the ${antennaOn(s)}`,
  lower: (s) => `Lower the ${antennaOn(s)}`,
  turn: (s) => `Turn the ${antennaOn(s)}`,
  down: (s) => `Point the ${antennaOn(s)} further down`,
  up: (s) => `Point the ${antennaOn(s)} further up`,
  move: (s) => `Move the ${antennaOn(s)} on the roof`,
  remove: (s) => `Remove the ${antennaOn(s)}`,
};

// What the plan does, in plain lines, most visible first.
export function planSteps(before, after) {
  const prev = Object.fromEntries(before.antennas.map((a) => [a.id, a]));
  const next = new Set(after.antennas.map((a) => a.id));
  const lines = [];
  const sectorsOf = new Map();
  const add = (kind, s) => {
    if (!sectorsOf.has(kind)) { sectorsOf.set(kind, []); lines.push(kind); }
    if (!sectorsOf.get(kind).includes(s)) sectorsOf.get(kind).push(s);
  };
  const fresh = after.antennas.filter((a) => !prev[a.id]);
  const fiveG = fresh.filter((a) => a.bands.some((b) => b.name.startsWith("N"))).length;
  if (fiveG) lines.push(fiveG === 1 ? "Install a new 5G antenna" : `Install ${fiveG} new 5G antennas`);
  if (fresh.length > fiveG) lines.push(fresh.length - fiveG === 1 ? "Install a new antenna" : `Install ${fresh.length - fiveG} new antennas`);
  for (const a of after.antennas) {
    const p = prev[a.id];
    const s = sectorOf(a.id);
    if (!p) continue;
    const pb = Object.fromEntries(p.bands.map((b) => [b.name, b]));
    const added = a.bands.filter((b) => !pb[b.name]);
    if (added.some((b) => b.name.startsWith("N"))) add("add5g", s);
    else if (added.length) add("addBand", s);
    if (p.bands.some((b) => !a.bands.some((x) => x.name === b.name))) add("switchOff", s);
    const power = a.bands.filter((b) => pb[b.name]).map((b) => b.tx_power_w - pb[b.name].tx_power_w);
    if (power.some((d) => d < 0)) add("lowerPower", s);
    if (power.some((d) => d > 0)) add("raisePower", s);
    if (p.height_agl_m !== a.height_agl_m) add(a.height_agl_m > p.height_agl_m ? "raise" : "lower", s);
    if (p.azimuth_deg !== a.azimuth_deg) add("turn", s);
    const tilt = a.mechanical_tilt_deg + a.electrical_tilt_deg - p.mechanical_tilt_deg - p.electrical_tilt_deg;
    if (tilt) add(tilt > 0 ? "down" : "up", s);
    if (p.x_m !== a.x_m || p.z_m !== a.z_m) add("move", s);
  }
  for (const id of Object.keys(prev)) if (!next.has(id)) add("remove", sectorOf(id));
  return lines.map((line) => (STEP_TEXT[line] ? STEP_TEXT[line](sectorsOf.get(line)) : line));
}
