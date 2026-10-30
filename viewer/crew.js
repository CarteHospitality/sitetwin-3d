// Crew plan for a field work order: who goes to site, how many people, what
// they bring and roughly how long it takes. Rules of thumb from rooftop and
// tower work (two people minimum at height, separate structural survey and
// accredited EMF measurement); every duration is an estimate for planning,
// to be confirmed by the contractor.

const WORKDAY_H = 8;

// Hours per antenna, by kind of work (on-site, excluding set-up and close-out).
const TASK_HOURS = {
  install: 5,      // new antenna/AAU: mount, cable, ground, weatherproof, commission
  raise: 3.5,      // pole extension and re-mount
  lower: 2,
  move: 4,         // new pole base / ballast and re-route
  band: 3,         // add a radio or carrier on an existing antenna
  removal: 2,
  azimuth: 1.25,   // re-point and re-torque
  mechTilt: 1,
};
const SETUP_H = 1;      // safety briefing, RF shutdown coordination, access
const CLOSEOUT_H = 1;   // tidy-up, as-built photos, handover

function kindsOf(item) {
  const c = item.change;
  if (c === "new antenna") return ["install"];
  if (c === "removal") return ["removal"];
  const kinds = [];
  if (/raise/.test(c)) kinds.push("raise");
  if (/lower/.test(c)) kinds.push("lower");
  if (/move on the roof/.test(c)) kinds.push("move");
  if (/add [A-Z]/.test(c)) kinds.push("band");
  if (/azimuth/.test(c)) kinds.push("azimuth");
  if (/mech\. tilt/.test(c)) kinds.push("mechTilt");
  return kinds; // electrical tilt and power changes are remote (OSS/RET)
}

export function crewPlan(order, site) {
  const tasks = order.items.map((i) => ({ antenna: i.antenna, change: i.change, kinds: kindsOf(i) }));
  const climbing = tasks.filter((t) => t.kinds.length);
  const remoteOnly = tasks.filter((t) => !t.kinds.length);
  const has = (k) => climbing.some((t) => t.kinds.includes(k));
  const heavy = has("install") || has("raise") || has("move");
  const radio = has("install") || has("band");
  const tower = site.structure && site.structure !== "rooftop";

  const crew = [];
  const visits = [];
  if (climbing.length) {
    crew.push({ role: "Site supervisor / team lead", count: 1, why: "Permit to work, safety briefing, RF shutdown coordination, sign-off" });
    crew.push({ role: tower ? "Certified tower climbers" : "Certified rooftop riggers", count: heavy ? 3 : 2,
      why: heavy ? "Two at height plus one ground/hoist person for lifting antennas and pole sections" : "Two-person rule for work at height" });
    if (radio || has("move")) crew.push({ role: "RF / commissioning engineer", count: 1, why: "Connect and commission radios, verify alarms and cells with the NOC" });
    if (radio) crew.push({ role: "DC power / electrical technician", count: 1, why: "DC power cabling, breakers, battery backup check" });
    const onsiteH = climbing.reduce((s, t) => s + t.kinds.reduce((a, k) => a + TASK_HOURS[k], 0), 0);
    // Two climbers work two antennas in parallel only for light jobs; heavy lifts go one at a time.
    const parallel = heavy ? 1 : Math.min(2, climbing.length);
    const workH = SETUP_H + onsiteH / parallel + CLOSEOUT_H;
    visits.push({
      name: "Installation visit", people: crew.reduce((s, c) => s + c.count, 0),
      hours: +workH.toFixed(1), days: Math.ceil(workH / WORKDAY_H),
      tasks: climbing.map((t) => `${t.antenna}: ${t.change}`),
    });
  }
  if (heavy) visits.unshift({ name: "Structural survey (before installation)", people: 1, hours: 2, days: 1,
    tasks: ["Check the support, pole extension and wind load; approve the mounting method"] });
  if (remoteOnly.length) visits.push({ name: "Remote change (OSS / RET)", people: 1, hours: +(0.25 * remoteOnly.length).toFixed(2), days: 0, remote: true,
    tasks: remoteOnly.map((t) => `${t.antenna}: ${t.change}`) });
  if (tasks.length) visits.push({ name: "EMF re-measurement (after the change)", people: 1, hours: 2, days: 1,
    tasks: ["Accredited on-site EMF measurement and BTK safety-certificate update"] });

  const tools = climbing.length ? [
    "PPE: helmet, full-body harness, double lanyard, gloves, safety boots",
    "Rope access / fall-arrest kit, rope and pulley or hoist",
    "Personal RF exposure monitor",
    "Torque wrench set, spanners, cable ties",
    ...(has("azimuth") || has("install") || has("move") ? ["Antenna alignment tool or digital compass"] : []),
    ...(has("mechTilt") || has("install") ? ["Digital inclinometer"] : []),
    ...(radio ? ["Fibre cleaning kit and optical power meter", "Multimeter / insulation tester", "Laptop with commissioning software (LMT)"] : []),
    "Weatherproofing kit, crimping and cable-cutting tools",
    "Barrier tape and EMF warning signs",
    "First-aid kit, camera for as-built photos",
  ] : [];

  const installVisit = visits.find((v) => v.name === "Installation visit");
  return {
    headcount: installVisit?.people ?? 0,
    crew, visits, tools,
    materials: [...new Set(order.items.flatMap((i) => i.materials))],
    onsite_days: visits.filter((v) => !v.remote).reduce((s, v) => s + v.days, 0),
    note: "Durations and crew size are planning estimates from typical rooftop/tower work; confirm with the contractor.",
  };
}
