// Action plan: everything the field crew needs for one site in one document,
// ready to e-mail to the site chief, copy, print or share. It is built from the
// same work order and crew plan the panel shows; durations are estimates.

import { el } from "./ui.js";
import { tr } from "./i18n.js";
import { REGIMES, siteZones } from "./emf.js";
import { checkSite, headline } from "./checks.js";
import { fieldWorkOrder } from "./fieldwork.js";
import { crewPlan } from "./crew.js";
import { planSteps, capacityAdded, heightLines, CAPACITY_PEOPLE_PER_ANTENNA } from "./overview.js";
import { busyCells, monthsUntil, PRB_BALANCE } from "./kpi.js";
import { populationContext } from "./population.js";

const uniq = (items) => [...new Set(items.filter(Boolean))];
const MAILTO_MAX = 1800;

// The change list between two plans, one line per parameter, band or antenna.
export const FIELDS = { azimuth_deg: "azimuth", mechanical_tilt_deg: "mech. tilt", electrical_tilt_deg: "elec. tilt", height_agl_m: "height", x_m: "x", z_m: "z" };
// In a change line each value carries its unit; x and z are said as the antenna's place on the roof.
const UNITS = { azimuth_deg: "°", mechanical_tilt_deg: "°", electrical_tilt_deg: "°", height_agl_m: " m", x_m: " m", z_m: " m" };
const LINE_LABELS = { ...FIELDS, x_m: "roof position x", z_m: "roof position z" };
// The difference between two versions of a site as steps, in the order an operator makes them: each
// with its plain line (the action plan's wording) and a way to make it on a copy of the site.
export function diffSteps(before, after) {
  const steps = [];
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const on = (s, id) => s.antennas.find((x) => x.id === id);
  const prev = Object.fromEntries(before.antennas.map((a) => [a.id, a]));
  const next = Object.fromEntries(after.antennas.map((a) => [a.id, a]));
  for (const a of after.antennas) {
    const p = prev[a.id];
    if (!p) {
      steps.push({ id: a.id, kind: "add", line: `Add ${a.id} at ${a.azimuth_deg}° (${a.bands.map((x) => x.name).join(", ")})`, apply: (s) => { s.antennas.push(copy(a)); } });
      continue;
    }
    for (const [k, label] of Object.entries(LINE_LABELS)) if (p[k] !== a[k]) {
      steps.push({ id: a.id, kind: "field", key: k, from: p[k], to: a[k], line: `${a.id} ${label}: ${p[k]}${UNITS[k]} → ${a[k]}${UNITS[k]}`, apply: (s) => { on(s, a.id)[k] = a[k]; } });
    }
    const pb = Object.fromEntries(p.bands.map((x) => [x.name, x]));
    const nb = Object.fromEntries(a.bands.map((x) => [x.name, x]));
    for (const name of Object.keys(nb)) {
      if (!pb[name]) steps.push({ id: a.id, kind: "band", band: name, line: `${a.id} add band ${name}`, apply: (s) => { on(s, a.id).bands.push(copy(nb[name])); } });
      else if (pb[name].tx_power_w !== nb[name].tx_power_w) {
        const from = pb[name].tx_power_w, to = nb[name].tx_power_w;
        steps.push({ id: a.id, kind: "power", band: name, from, to, line: `${a.id} ${name} power: ${from} → ${to} W`, apply: (s) => { on(s, a.id).bands.find((x) => x.name === name).tx_power_w = to; } });
      }
    }
    for (const name of Object.keys(pb)) if (!nb[name]) {
      steps.push({ id: a.id, kind: "removeBand", band: name, line: `${a.id} remove band ${name}`, apply: (s) => { const x = on(s, a.id); x.bands = x.bands.filter((b) => b.name !== name); } });
    }
  }
  for (const id of Object.keys(prev)) if (!next[id]) {
    steps.push({ id, kind: "remove", line: `Remove ${id}`, apply: (s) => { s.antennas = s.antennas.filter((x) => x.id !== id); } });
  }
  return steps;
}
export function diffSites(before, after) {
  return diffSteps(before, after).map((step) => step.line);
}

// One site's plan as a document, built the same way on the 3D page and on the map.
export function sitePlan({ site, baseline, entry, regimeKey = "tr", reason = null, kpi = null }) {
  const regime = REGIMES[regimeKey];
  const zones = siteZones(site, regime);
  const checks = checkSite(site, zones);
  const order = fieldWorkOrder(baseline, site, checks);
  const changes = diffSites(baseline, site);
  const baseChecks = checkSite(baseline, siteZones(baseline, regime));
  const before = headline(baseChecks);
  const gained = [...capacityAdded(baseline, site)].sort();
  const plan = actionPlan({
    site, entry, regime: regime.name, reason, order, crew: crewPlan(order, site), changes, steps: planSteps(baseline, site),
    findings: planFindings(baseline, before, gained, kpi), gained, measured: busyCells(kpi), before, after: headline(checks),
    heights: heightLines(baseChecks.findings.filter((f) => f.level === "bad")),
  });
  return { plan, zones, checks, order, changes };
}

// Why the plan is made, in its own terms: a safety problem first; then, for a sector the plan adds
// capacity to, its load (measured, or estimated from the people it serves) and when it gets busy
// at today's growth. A clean EMF headline is not a finding: it is said only when nothing else is.
const inTime = (months) => (months <= 24 ? `in roughly ${months} months` : `in roughly ${Math.round(months / 12)} years`);
function planFindings(baseline, before, gained, kpi) {
  const findings = before.level !== "ok" ? [{ text: before.text }] : [];
  for (const sector of gained) {
    const cell = (kpi?.cells ?? []).filter((c) => c.sector === sector).sort((a, b) => b.prb_dl_pct - a.prb_dl_pct)[0];
    if (cell) {
      const months = monthsUntil(cell.prb_dl_pct, PRB_BALANCE);
      findings.push({ cell, text: months ? `Cell ${cell.sector} ${cell.band} at ${cell.prb_dl_pct}% PRB in the busy hour (${cell.tag}), and with about 20% more traffic a year it could get busy ${inTime(months)} (a rough estimate)`
        : `Cell ${cell.sector} ${cell.band} is busy: ${cell.prb_dl_pct}% PRB in the busy hour (${cell.tag})` });
      continue;
    }
    const people = Math.max(0, ...Object.entries(populationContext(baseline).people_per_antenna).filter(([id]) => id.split("-")[0] === sector).map(([, n]) => n));
    if (!people) continue;
    const months = monthsUntil(people, CAPACITY_PEOPLE_PER_ANTENNA), about = Math.round(people / 100) * 100;
    findings.push({ text: months ? `Sector ${sector} serves about ${about} people (estimated), and with about 20% more traffic a year it could get busy ${inTime(months)} (a rough estimate)`
      : `Sector ${sector} serves about ${about} people (estimated): it is busy already` });
  }
  return findings.length ? findings : [{ text: before.text }];
}

// What the change fixes first, then what is still open.
export function result(before, after) {
  // A problem the plan leaves as it was is still open, not a result.
  if (after.text === before.text) return [after.level === "ok" ? after.text : `Still open: ${after.text}`];
  const fixed = before.text.replace(" inside an EMF zone", " no longer inside an EMF zone").replace(" above the 3 V/m health-facility level", " below the 3 V/m health-facility level");
  return after.level === "ok" ? [fixed !== before.text ? fixed : after.text, after.text].filter((v, i, a) => a.indexOf(v) === i)
    : [...(fixed !== before.text ? [fixed] : []), `Still open: ${after.text}`];
}

// Sections of plain English lines; the page and the e-mail translate them.
// `measured`: busy cells from the operator's KPI export, if one was loaded.
// `heights`: lines on a school or hospital whose finding hangs on an assumed height (overview.js).
export function actionPlan({ site, entry, before, after, changes, steps = [], reason, order, crew, regime, measured = [], findings = [{ text: before.text }], gained = [], heights = [] }) {
  const where = [...(entry?.twin?.includes("/samples/") ? ["Data: synthetic sample site (antennas and load invented for the demo)"] : []),
    `Structure: ${(site.structure ?? "rooftop").replaceAll("_", " ")}`];
  if (entry?.address) where.push(`Address: ${entry.address}`);
  if (entry?.lat != null) where.push(`Coordinates: ${entry.lat}, ${entry.lon}`, `Map: https://www.google.com/maps?q=${entry.lat},${entry.lon}`);
  // A busy cell the finding already names is not listed again under measured load.
  const named = new Set(findings.map((f) => f.cell).filter(Boolean));
  const why = [...findings.map((f) => `Finding: ${f.text}`),
    ...measured.filter((c) => ![...named].some((n) => n.sector === c.sector && n.band === c.band)).map((c) => `${c.tag === "measured" ? "Measured" : "Sample"} load: ${c.sector} ${c.band} ${c.prb_dl_pct}% PRB (busy hour)`),
    ...(reason ? [`Reason for the change: ${reason}`] : []), `EMF limit: ${regime}`];
  const visits = crew.visits.map((v) => `${v.name}: ${v.remote ? `${v.people} engineer, ~${v.hours} h, remote` : `${v.people} people, ${v.days} day(s)`}`);
  // The regulation measures a school's distance from its garden and playgrounds, which the data lacks:
  // with a school nearby, the plan makes checking them on site a step before any work.
  const school = (site.neighbours ?? []).some((n) => ["school", "kindergarten"].includes(n.use));
  const gardens = school ? ["Before any work, confirm on site the safety distance from the nearby school's garden boundary and playgrounds (Article 6(2), 6(4)): the model checks the school building only"] : [];
  return {
    site: site.site_id,
    sections: [
      { heading: "In short", lines: [...steps, "Status: planning draft from a screening model; a field measurement and the operator's approval come before any work"] },
      { heading: "Site", lines: where },
      { heading: "Why", lines: why },
      { heading: "Work to do", lines: changes },
      // What the plan gains comes first: more capacity where it adds some, then the EMF state.
      { heading: "Expected result", lines: [...gained.map((s) => `More capacity on sector ${s} (a new band; how much the load drops is not modelled)`), ...result(before, after)] },
      { heading: "Crew and schedule", lines: [...visits, ...crew.crew.map((c) => `${c.role}: ${c.count}`)] },
      { heading: "Work steps", lines: order.items.flatMap((i) => i.steps) },
      { heading: "Tools and equipment", lines: crew.tools },
      { heading: "Materials", lines: uniq(order.items.flatMap((i) => i.materials)) },
      { heading: "Precautions and approvals", lines: uniq([...heights.filter((l) => l.endsWith("so measure it")), ...gardens, ...order.items.flatMap((i) => i.precautions), ...order.general]) },
    ].filter((s) => s.lines.length),
    note: crew.note, date: new Date().toLocaleDateString(),
  };
}

// "Label: value" lines translate in two parts when the label is known; change
// lines like "S3-1 L800 power: 40 → 18 W" have whole-line patterns instead.
function trLine(line) {
  const m = line.match(/^([^:]{2,60}): (.+)$/);
  return m && tr(m[1]) !== m[1] ? `${tr(m[1])}: ${tr(m[2])}` : tr(line);
}

const titleOf = (plan) => `${tr("Action plan (planning draft)")} · ${plan.parts ? `${plan.parts.length} ${tr("sites")}` : plan.site}`;
// A tour's plans, one after another; a single plan is one part.
const partsOf = (plan) => plan.parts ?? [plan];

export function combinePlans(plans) {
  return { parts: plans, note: plans[0]?.note ?? "", date: new Date().toLocaleDateString() };
}
const footOf = (plan) => `${tr(plan.note)} ${tr("Prepared with SiteTwin 3D")} · ${plan.date}`;

export function planText(plan) {
  const out = [titleOf(plan), ""];
  for (const part of partsOf(plan)) {
    if (plan.parts) out.push(`=== ${part.site} ===`, "");
    for (const s of part.sections) out.push(tr(s.heading).toLocaleUpperCase(document.documentElement.lang), ...s.lines.map((l) => `- ${trLine(l)}`), "");
  }
  out.push(footOf(plan));
  return out.join("\r\n");
}

function printable(plan) {
  const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const body = partsOf(plan).map((part) => (plan.parts ? `<h1 class="site">${esc(part.site)}</h1>` : "") +
    part.sections.map((s) => `<h2>${esc(tr(s.heading))}</h2><ul>${s.lines.map((l) => `<li>${esc(trLine(l))}</li>`).join("")}</ul>`).join("")).join("");
  return `<!doctype html><meta charset="utf-8"><title>${esc(titleOf(plan))}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:720px;margin:32px auto;color:#101828}h1{font-size:22px}h1.site{font-size:18px;margin-top:32px;border-top:1px solid #D0D5DD;padding-top:16px}h2{font-size:14px;margin:20px 0 6px;text-transform:uppercase;color:#344054}ul{margin:0;padding-left:18px}p{color:#5D6B7E;font-size:12px;margin-top:24px}</style>
<h1>${esc(titleOf(plan))}</h1>${body}<p>${esc(footOf(plan))}</p>`;
}

// Opens the e-mail with the plan. Mail programs cut long mailto links (about 2000 characters on
// Windows), so a long plan goes to the clipboard and the mail says to paste it. Returns a note or "".
export async function sendByEmail(plan) {
  const text = planText(plan);
  const subject = encodeURIComponent(titleOf(plan));
  let body = encodeURIComponent(text), note = "";
  if (body.length > MAILTO_MAX) {
    try { await navigator.clipboard.writeText(text); } catch { /* the paste line still explains */ }
    body = encodeURIComponent(tr("The action plan is on the clipboard: paste it here (Ctrl+V)."));
    note = tr("Plan copied: paste it into the e-mail");
  }
  location.href = `mailto:?subject=${subject}&body=${body}`;
  return note;
}

// The dialog: the plan to read, and one row of ways to send it.
// `extra`: more ways to share, as { label, onclick }.
export function openActionPlan(plan, { data, extra = [] } = {}) {
  if (document.querySelector(".plan-dialog[open]:not(.snapshot-dialog)")) return; // a double click opens one plan
  const text = planText(plan);
  const status = el("span", { className: "muted", role: "status" });
  const action = (label, onclick, primary = false) => Object.assign(el("button", { className: primary ? "primary" : "", textContent: tr(label) }), { onclick });
  const actions = [
    action("Print / PDF", () => {
      const w = open("", "_blank");
      if (!w) { status.textContent = tr("The print window was blocked: allow pop-ups for this page, or use Copy"); return; }
      w.document.write(printable(plan)); w.document.close(); w.focus(); w.print();
    }, true),
    action("Copy", async () => { await navigator.clipboard.writeText(text); status.textContent = tr("Copied"); }),
    action("E-mail draft", async () => { status.textContent = await sendByEmail(plan); }),
  ];
  actions.push(...extra.map((x) => action(x.label, x.onclick)));
  if (navigator.share) actions.push(action("Share", () => navigator.share({ title: titleOf(plan), text }).catch(() => {})));
  if (data) actions.push(action("Data (JSON)", () => {
    const a = el("a", { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })), download: `${data.site_id}-plan.json` });
    a.click(); URL.revokeObjectURL(a.href);
  }));
  const close = Object.assign(el("button", { className: "icon-btn close", title: tr("Close"), ariaLabel: tr("Close") }), { onclick: () => dialog.close() });
  // Built already translated, so the page translator leaves it alone.
  const dialog = el("dialog", { className: "plan-dialog" },
    el("header", {}, el("h1", { textContent: titleOf(plan) }), close),
    el("div", { className: "plan-body" },
      ...partsOf(plan).flatMap((part) => [
        ...(plan.parts ? [el("h1", { className: "plan-site", textContent: part.site })] : []),
        ...part.sections.map((s) => el("section", {}, el("h2", { textContent: tr(s.heading) }), el("ul", {}, ...s.lines.map((l) => el("li", { textContent: trLine(l) }))))),
      ]),
      el("p", { className: "muted", textContent: footOf(plan) })),
    el("footer", {}, ...actions, status));
  dialog.setAttribute("data-no-i18n", "");
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
