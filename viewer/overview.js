// The site at a glance, in plain words: what is good and what is not, then
// what the plan changes, without antenna parameters. The detailed cards
// (checks, changes, crew, work order) stay below for whoever needs them.

import { PRB_BALANCE, PRB_EXPAND } from "./kpi.js";

// Indicative, as on the portfolio map: people in one antenna's main lobe worth a capacity look.
export const CAPACITY_PEOPLE_PER_ANTENNA = 1500;
const sectorOf = (id) => id.split("-")[0];

// One line per topic, good or bad: [{ level: "ok" | "warn" | "bad", text }].
// `coverageLoss`: bands that lose a large share of their coverage against the baseline.
// `kpi`: measured busy-hour load per cell; when given it replaces the population estimate.
// `before`: the site before the plan, to tell whether the plan adds capacity on the busy sector.
export function statusLines(site, checks, population, { coverageLoss = [], kpi = null, before = null } = {}) {
  const lines = [];
  const bad = checks.findings.filter((f) => f.level === "bad");
  const sensitiveUses = [...new Set(bad.filter((f) => f.sensitive).map((f) => f.use))];
  const others = new Set(bad.filter((f) => !f.sensitive).map((f) => f.building));
  if (sensitiveUses.length) for (const use of sensitiveUses) lines.push({ level: "bad", text: `A ${use} is inside an EMF zone` });
  else lines.push({ level: "ok", text: "No school or hospital in an EMF zone" });
  if (others.size) lines.push({ level: "bad", text: `EMF zone reaches ${others.size} other building(s)` });
  else if (!sensitiveUses.length) lines.push({ level: "ok", text: "EMF zone reaches no building" });
  if (site.structure === "rooftop") {
    const roof = checks.findings.filter((f) => f.level === "warn").length;
    lines.push(roof ? { level: "warn", text: "Part of the roof must be closed off" } : { level: "ok", text: "Roof is safe to walk" });
  }
  const cell = kpi?.cells?.[0];
  if (cell) {
    const name = `${cell.sector} ${cell.band}`, prb = cell.prb_dl_pct;
    if (prb < PRB_BALANCE) lines.push({ level: "ok", text: `Capacity is sufficient: busiest cell ${name} at ${prb}% PRB (measured)` });
    else if (before && capacityAdded(before, site).has(cell.sector)) lines.push({ level: "ok", relieves: cell.sector, text: `Cell ${name} at ${prb}% PRB (measured): the plan adds capacity there` });
    else lines.push({ level: prb >= PRB_EXPAND ? "bad" : "warn", text: `Cell ${name} is ${prb >= PRB_EXPAND ? "full" : "busy"}: ${prb}% PRB in the busy hour (measured)` });
  } else {
    // The busy sector stays busy in people, but a plan that adds capacity there answers it.
    const busiest = Object.entries(population.people_per_antenna).sort((a, b) => b[1] - a[1])[0];
    const sector = busiest && sectorOf(busiest[0]), people = busiest && Math.round(busiest[1] / 100) * 100;
    if (!busiest || busiest[1] <= CAPACITY_PEOPLE_PER_ANTENNA) lines.push({ level: "ok", text: "Capacity is sufficient" });
    else if (before && capacityAdded(before, site).has(sector)) lines.push({ level: "ok", relieves: sector, text: `Sector ${sector} has about ${people} people: the plan adds capacity there` });
    else lines.push({ level: "warn", text: `Sector ${sector} is busy: about ${people} people` });
  }
  if (coverageLoss.length) lines.push({ level: "warn", text: `Coverage drops sharply: ${coverageLoss.map((l) => `${l.band} ${l.change_pct}%`).join(", ")}` });
  return lines;
}

// Sectors where the plan adds capacity: a new antenna, a new band or more power.
export function capacityAdded(before, after) {
  const prev = Object.fromEntries(before.antennas.map((a) => [a.id, a]));
  const out = new Set();
  for (const a of after.antennas) {
    const p = prev[a.id];
    const more = (b) => { const old = p?.bands.find((x) => x.name === b.name); return !old || b.tx_power_w > old.tx_power_w; };
    if (!p || a.bands.some(more)) out.add(sectorOf(a.id));
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
  raisePower: (s) => `Raise the power on ${on(s)} for more capacity`,
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
