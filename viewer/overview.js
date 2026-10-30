// The site at a glance, in plain words: what is good and what is not, then
// what the plan changes, without antenna parameters. The detailed cards
// (checks, changes, crew, work order) stay below for whoever needs them.

// Indicative, as on the portfolio map: people in one antenna's main lobe worth a capacity look.
const CAPACITY_PEOPLE_PER_ANTENNA = 1500;
const sectorOf = (id) => id.split("-")[0];

// One line per topic, good or bad: [{ level: "ok" | "warn" | "bad", text }].
export function statusLines(site, checks, population) {
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
  const busiest = Object.entries(population.people_per_antenna).sort((a, b) => b[1] - a[1])[0];
  if (busiest && busiest[1] > CAPACITY_PEOPLE_PER_ANTENNA) lines.push({ level: "warn", text: `Sector ${sectorOf(busiest[0])} is busy: about ${Math.round(busiest[1] / 100) * 100} people` });
  else lines.push({ level: "ok", text: "Capacity is sufficient" });
  return lines;
}

// What the plan does, one plain line per kind of work, most visible first.
export function planSteps(before, after) {
  const prev = Object.fromEntries(before.antennas.map((a) => [a.id, a]));
  const next = new Set(after.antennas.map((a) => a.id));
  const steps = [];
  const add = (text) => { if (!steps.includes(text)) steps.push(text); };
  for (const a of after.antennas) {
    const p = prev[a.id];
    const s = sectorOf(a.id);
    if (!p) { add(a.bands.some((b) => b.name.startsWith("N")) ? "Install a new 5G antenna" : "Install a new antenna"); continue; }
    const pb = Object.fromEntries(p.bands.map((b) => [b.name, b]));
    const added = a.bands.filter((b) => !pb[b.name]);
    if (added.some((b) => b.name.startsWith("N"))) add(`Add 5G on sector ${s}`);
    else if (added.length) add(`Add a new frequency on sector ${s}`);
    if (p.bands.some((b) => !a.bands.some((x) => x.name === b.name))) add(`Switch off a frequency on sector ${s}`);
    const power = a.bands.filter((b) => pb[b.name]).map((b) => b.tx_power_w - pb[b.name].tx_power_w);
    if (power.some((d) => d < 0)) add(`Lower the power on sector ${s} (remote)`);
    if (power.some((d) => d > 0)) add(`Raise the power on sector ${s} for more capacity`);
    if (p.height_agl_m !== a.height_agl_m) add(`${a.height_agl_m > p.height_agl_m ? "Raise" : "Lower"} the antenna on sector ${s}`);
    if (p.azimuth_deg !== a.azimuth_deg) add(`Turn the antenna on sector ${s}`);
    const tilt = a.mechanical_tilt_deg + a.electrical_tilt_deg - p.mechanical_tilt_deg - p.electrical_tilt_deg;
    if (tilt) add(`Point the antenna on sector ${s} ${tilt > 0 ? "further down" : "further up"}`);
    if (p.x_m !== a.x_m || p.z_m !== a.z_m) add(`Move the antenna on sector ${s} on the roof`);
  }
  for (const id of Object.keys(prev)) if (!next.has(id)) add(`Remove the antenna on sector ${sectorOf(id)}`);
  return steps;
}
