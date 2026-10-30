// Action plan: everything the field crew needs for one site in one document,
// ready to e-mail to the site chief, copy, print or share. It is built from the
// same work order and crew plan the panel shows; durations are estimates.

import { el } from "./ui.js";
import { tr } from "./i18n.js";

const uniq = (items) => [...new Set(items.filter(Boolean))];

// What the change fixes first, then what is still open.
function result(before, after) {
  if (after.text === before.text) return [after.text];
  const fixed = before.text.replace(" inside an EMF zone", " no longer inside an EMF zone");
  return after.level === "ok" ? [fixed !== before.text ? fixed : after.text, after.text].filter((v, i, a) => a.indexOf(v) === i)
    : [...(fixed !== before.text ? [fixed] : []), `Still open: ${after.text}`];
}

// Sections of plain English lines; the page and the e-mail translate them.
export function actionPlan({ site, entry, before, after, changes, reason, order, crew, regime }) {
  const where = [`Structure: ${(site.structure ?? "rooftop").replaceAll("_", " ")}`];
  if (entry?.address) where.push(`Address: ${entry.address}`);
  if (entry?.lat != null) where.push(`Coordinates: ${entry.lat}, ${entry.lon}`, `Map: https://www.google.com/maps?q=${entry.lat},${entry.lon}`);
  const why = [`Finding: ${before.text}`, ...(reason ? [`Reason for the change: ${reason}`] : []), `EMF limit: ${regime}`];
  const visits = crew.visits.map((v) => `${v.name}: ${v.remote ? `${v.people} engineer, ~${v.hours} h, remote` : `${v.people} people, ${v.days} day(s)`}`);
  return {
    site: site.site_id,
    sections: [
      { heading: "Site", lines: where },
      { heading: "Why", lines: why },
      { heading: "Work to do", lines: changes },
      { heading: "Expected result", lines: result(before, after) },
      { heading: "Crew and schedule", lines: [...visits, ...crew.crew.map((c) => `${c.role}: ${c.count}`)] },
      { heading: "Work steps", lines: order.items.flatMap((i) => i.steps) },
      { heading: "Tools and equipment", lines: crew.tools },
      { heading: "Materials", lines: uniq(order.items.flatMap((i) => i.materials)) },
      { heading: "Precautions and approvals", lines: uniq([...order.items.flatMap((i) => i.precautions), ...order.general]) },
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

const titleOf = (plan) => `${tr("Action plan")} · ${plan.parts ? `${plan.parts.length} ${tr("sites")}` : plan.site}`;
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

// The dialog: the plan to read, and one row of ways to send it.
export function openActionPlan(plan, { data } = {}) {
  const text = planText(plan);
  const status = el("span", { className: "muted", role: "status" });
  const action = (label, onclick, primary = false) => Object.assign(el("button", { className: primary ? "primary" : "", textContent: tr(label) }), { onclick });
  const actions = [
    action("Send by e-mail", () => { location.href = `mailto:?subject=${encodeURIComponent(titleOf(plan))}&body=${encodeURIComponent(text)}`; }, true),
    action("Copy", async () => { await navigator.clipboard.writeText(text); status.textContent = tr("Copied"); }),
    action("Print / PDF", () => { const w = open("", "_blank"); w.document.write(printable(plan)); w.document.close(); w.focus(); w.print(); }),
  ];
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
