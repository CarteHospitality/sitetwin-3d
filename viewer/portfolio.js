// Portfolio map: every site, checked with the same code as the 3D planner,
// ranked by how urgently it needs attention.

import { tr } from "./i18n.js";
import { siteZones, REGIMES } from "./emf.js";
import { checkSite, headline } from "./checks.js";
import { populationContext } from "./population.js";
import { createAgent } from "./agent.js";
import { initVoice } from "./voice.js";
import { initConversation } from "./conversation.js";
import { readSession, writeSession, restoreProposed, canonical, handoffId, absoluteUrl, rememberUpload, withUploads, isUpload, forgetUpload, forgetPlan } from "./session.js";
import { $, el, token, initShell, reducedMotion } from "./ui.js";
import { startTour, readTour, endTour } from "./tour.js";
import { combinePlans, openActionPlan, diffSites, sitePlan } from "./actionplan.js";
import { initCards, showCard, hideCard, setCardSummary } from "./cards.js";
import { twinKpi, PRB_BALANCE, PRB_EXPAND } from "./kpi.js";
import { capacityAdded, planSteps } from "./overview.js";

initShell();
initCards();
$("loadTwin").onclick = () => $("upload").click();

const LEVELS = {
  critical: { label: "Critical", glyph: "!", rank: 4 },
  high: { label: "Action needed", glyph: "▲", rank: 3 },
  medium: { label: "Review", glyph: "•", rank: 2 },
  planned: { label: "Change planned", glyph: "◆", rank: 1 },
  ok: { label: "OK", glyph: "✓", rank: 0 },
};
// Indicative: people in the main lobes of one antenna above which capacity is worth a look.
const CAPACITY_PEOPLE_PER_ANTENNA = 1500;

const params = new URLSearchParams(location.search);
const indexUrl = params.get("portfolio") || "data/private/portfolio.json";
const mapKey = `map:${absoluteUrl(indexUrl)}`;
const storedMap = readSession(mapKey, {}) || {};
// The logo, or a first visit, opens the home view: every site in view, nothing selected.
const homeView = params.get("home") === "1" || !storedMap.bounds;
if (params.has("home")) { params.delete("home"); history.replaceState(history.state, "", `${location.pathname}${params.toString() ? `?${params}` : ""}`); }
const mapActions = Array.isArray(storedMap.actions) ? storedMap.actions.filter((a) => a && typeof a.text === "string" && typeof a.time === "string") : [];
const seenProposals = storedMap.proposals && typeof storedMap.proposals === "object" ? storedMap.proposals : {};
const baseIndex = await fetch(indexUrl).then((r) => (r.ok ? r.json() : fetch("data/samples/portfolio.json").then((s) => s.json())))
  .catch((e) => { $("loading").textContent = `Portfolio unavailable: ${e.message}`; throw e; });
const index = withUploads(indexUrl, baseIndex);

const map = L.map("map", { zoomControl: true, fadeAnimation: !reducedMotion.matches,
  zoomAnimation: !reducedMotion.matches, markerZoomAnimation: !reducedMotion.matches });
// Standard OSM tiles, darkened with a CSS filter to match the app.
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>', maxZoom: 19,
}).addTo(map);

// `source`: the twin as loaded; `site`: the plan as the engineer last left it.
function assess(entry, source, site = source.site, regime = "tr", proposed = false) {
  const checks = checkSite(site, siteZones(site, REGIMES[regime]));
  const { findings, hit } = checks;
  const pop = populationContext(site);
  const issues = [];
  const bad = findings.filter((f) => f.level === "bad");
  const sensitive = bad.filter((f) => f.sensitive);
  for (const f of sensitive) issues.push(`Sensitive building inside an EMF zone: ${f.text}`);
  for (const f of bad.filter((f) => !f.sensitive)) issues.push(f.text);
  for (const f of findings.filter((f) => f.level === "warn")) issues.push(f.text);
  // Capacity: measured busy-hour PRB from the site file, otherwise estimated from people nearby.
  const cell = twinKpi(source)?.cells[0];
  let capacity = false, full = false, capacityText = "";
  if (cell) {
    const name = `${cell.sector} ${cell.band}`;
    const relieved = capacityAdded(source.site, site).has(cell.sector);
    if (cell.prb_dl_pct >= PRB_BALANCE && relieved) issues.push(`Capacity: ${name} at ${cell.prb_dl_pct}% PRB (measured), the plan adds capacity there`);
    else if (cell.prb_dl_pct >= PRB_BALANCE) {
      capacity = true; full = cell.prb_dl_pct >= PRB_EXPAND;
      capacityText = `${full ? "Full" : "Busy"} cell: ${name} at ${cell.prb_dl_pct}% PRB (measured)`;
      issues.push(`Capacity: ${name} at ${cell.prb_dl_pct}% PRB in the busy hour (measured)`);
    }
  } else {
    const busiest = Object.entries(pop.people_per_antenna).sort((a, b) => b[1] - a[1])[0];
    capacity = busiest && busiest[1] > CAPACITY_PEOPLE_PER_ANTENNA;
    if (capacity) { capacityText = "Busy sector: capacity to review"; issues.push(`Capacity: ${busiest[0]} serves ~${busiest[1]} people in its main lobe (estimated)`); }
  }
  // The SiteTwin result is the site as it stands; its application is history. Only a change
  // planned in SiteTwin 3D is "Change planned".
  const applied = Object.entries(entry.antenna_actions ?? {}).filter(([k]) => k !== "retain");
  if (applied.length) issues.push(`Last SiteTwin application: ${applied.map(([k, v]) => `${v} ${k}`).join(", ")}${entry.reason ? ` (${entry.reason})` : ""}`);
  if (proposed) issues.push("Session proposal · applied to plan; source file unchanged");
  const level = sensitive.length ? "critical" : bad.length || full ? "high" : findings.some((f) => f.level === "warn") || capacity ? "medium" : proposed ? "planned" : "ok";
  const score = 100 * sensitive.length + 30 * bad.length + (full ? 25 : 0) + 5 * findings.filter((f) => f.level === "warn").length + (capacity ? 10 : 0) + (proposed ? 1 : 0);
  // One sentence for the list: the EMF state, or else the next most important thing.
  const head = headline(checks);
  const summary = head.level !== "ok" ? head.text : capacity ? capacityText : proposed ? "Change planned" : "No issues found";
  return { level, score, issues, summary, hitBuildings: hit.size, findingCount: bad.length, people: pop.total_people_nearby, buildings: site.neighbours.length };
}

const sites = [];
const markers = {};
let selectedSite = null;
let attentionCount = 0;
let pageActive = true;
window.addEventListener("pagehide", () => { pageActive = false; });
window.addEventListener("pageshow", () => { pageActive = true; });

function pinIcon(level, selected = false, attention = false) {
  const pin = el("div", { className: `pin ${level}${selected ? " selected" : ""}${attention ? " attention" : ""}` }, el("span", { textContent: LEVELS[level].glyph }));
  pin.style.color = token(level);
  return L.divIcon({ className: "map-pin", html: pin, iconSize: [32, 32], iconAnchor: [16, 16] });
}

// The actions log lists only the selected site's entries: the panel speaks about one site at a time.
function renderActions() {
  const id = selectedSite?.entry.site_id;
  const mine = id ? mapActions.filter((a) => a.text.includes(id)) : [];
  setCardSummary("actions", mine.length ? `${mine.length}` : "");
  if (mine.length) showCard("actions"); else hideCard("actions");
  $("actions").replaceChildren(...mine.map((action) => el("li", {}, el("time", { textContent: new Date(action.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }), action.text)));
}
function logAction(text) {
  mapActions.push({ time: new Date().toISOString(), text });
  if (mapActions.length > 40) mapActions.shift();
  renderActions();
  saveMapState();
}
function saveMapState() {
  if (!map.getCenter || !map._loaded) return;
  const bounds = map.getBounds();
  writeSession(mapKey, { selected: selectedSite?.entry.site_id,
    bounds: [[bounds.getSouth(), bounds.getWest()], [bounds.getNorth(), bounds.getEast()]],
    actions: mapActions, proposals: seenProposals });
}
map.on("moveend", saveMapState);
window.addEventListener("pagehide", saveMapState);

function twinUrl(s, instruction, voice = false) {
  const p = new URLSearchParams({ twin: s.entry.twin, ...(instruction ? { ask: instruction } : { auto: "review" }),
    from: location.pathname + location.search, portfolio: indexUrl, handoff: handoffId() });
  if (voice) p.set("voice", "1");
  return `index.html?${p}`;
}
function openTwin(s) {
  logAction(`Opened ${s.entry.site_id} in 3D for a full review`);
  selectedSite = s; saveMapState();
  location.href = twinUrl(s);
}

let focusRequest = 0, focusedTarget = null;
const byUrgency = (a, b) => LEVELS[b.a.level].rank - LEVELS[a.a.level].rank || b.a.score - a.a.score;
// The right panel speaks about the selected site only; with none selected it stays closed.
function render(selected = selectedSite) {
  selectedSite = selected;
  sites.sort(byUrgency);
  for (const s of sites) markers[s.entry.site_id]?.getElement()?.querySelector(".pin")?.classList.toggle("selected", s === selected);
  document.body.classList.toggle("site-open", Boolean(selected));
  renderSelected(selected);
  renderActions();
  renderLegend();
}
let shownSelected = null;
function renderSelected(s) {
  if (!s) { hideCard("selected"); shownSelected = null; return; }
  const lv = LEVELS[s.a.level];
  setCardSummary("selected", `${s.entry.site_id} · ${lv.label}`, s.a.level === "critical" ? "bad" : s.a.level === "high" ? "warn" : s.a.level === "ok" ? "ok" : "");
  $("selectedSite").replaceChildren(
    el("h1", { textContent: s.entry.site_id }),
    el("div", { className: `headline ${s.a.level === "critical" || s.a.level === "high" ? "bad" : s.a.level === "ok" ? "ok" : ""}`, textContent: s.a.summary }),
    el("div", { className: "row" },
      Object.assign(el("button", { className: "primary", textContent: "Open in 3D →" }), { onclick: () => openTwin(s) }),
      Object.assign(el("button", { textContent: "Inspect surroundings" }), { onclick: () => select(s, { inspect: true }) }),
      ...(isUpload(indexUrl, s.entry.site_id) ? [removeButton(s)] : []),
      Object.assign(el("button", { textContent: "Close" }), { onclick: deselect })),
    el("details", { className: "more" }, el("summary", { textContent: "Details" }),
      el("div", { className: "muted", textContent: `${s.entry.structure.replaceAll("_", " ")} · ${s.regime === "tr" ? "TR 20%" : "ICNIRP"} · ${s.a.buildings} buildings · ~${s.a.people} people nearby (estimated)` }),
      el("ul", {}, ...(s.a.issues.length ? s.a.issues : ["No issues found"]).map((text) => el("li", { textContent: text })))),
  );
  showCard("selected", { reveal: shownSelected !== s });
  shownSelected = s;
}
function deselect() {
  if (!selectedSite) return;
  document.querySelector(".panel.drawer-open .drawer-close")?.click();
  render(null);
  saveMapState();
}

// What the pin colours mean, with how many sites each.
const legend = L.control({ position: "bottomleft" });
legend.onAdd = () => el("div", { className: "map-legend" });
legend.addTo(map);
function renderLegend() {
  legend.getContainer().replaceChildren(...Object.keys(LEVELS).map((k) => [k, sites.filter((s) => s.a.level === k).length]).filter(([, n]) => n)
    .map(([k, n]) => el("div", {}, el("span", { className: "dot", style: `background:${token(k)}`, textContent: LEVELS[k].glyph }),
      el("span", { textContent: LEVELS[k].label }), el("b", { textContent: String(n) }))));
}

// ---------- home: the operator sums the portfolio up; the right panel stays closed ----------
const baselineOf = (s) => s.source.site;
// Sites with a change planned in SiteTwin 3D: field work to do.
const plannedWork = () => sites.filter((s) => diffSites(baselineOf(s), s.site).length);
function siteLink(s) {
  const row = el("button", { type: "button", className: "home-site" },
    el("span", { className: "dot", style: `background:${token(s.a.level)}`, textContent: LEVELS[s.a.level].glyph }),
    el("span", { className: "id", textContent: s.entry.site_id }), el("span", { className: "why", textContent: tr(s.a.summary) }));
  row.onclick = () => select(s);
  return row;
}
function openCombinedPlan() {
  const plans = plannedWork().map((s) => sitePlan({ site: s.site, baseline: baselineOf(s), entry: s.entry, regimeKey: s.regime,
    reason: s.reason ?? s.entry.reason ?? null, kpi: twinKpi(s.source) }).plan);
  logAction(`Combined action plan for ${plans.length} sites`);
  openActionPlan(combinePlans(plans));
}
const fixUrgent = () => mapAgent.ask(document.documentElement.lang === "tr"
  ? "Aksiyon gerektiren tüm sahaları sırayla düzelt" : "Fix every site that needs action, one by one");

// The operator's opening summary, written from the checks (no model call). Assistant messages are
// not translated by the page, so it is put in the screen's language here. Home starts a fresh
// conversation, unless the operator is still answering.
let briefing = null;
function showBriefing({ fresh = false } = {}) {
  if (fresh && !$("chatInput").disabled) { chat.clear(); mapAgent.reset(); }
  briefing ??= el("div", { className: "msg assistant briefing" });
  renderBriefing();
  $("chatLog").append(briefing);
  $("chatLog").scrollTop = $("chatLog").scrollHeight;
}
function renderBriefing() {
  if (!briefing) return;
  const urgent = sites.filter((s) => ["critical", "high"].includes(s.a.level));
  const work = plannedWork();
  const allOpen = briefing.querySelector("details")?.open ?? false;
  const button = (text, onclick) => Object.assign(el("button", { type: "button", textContent: tr(text) }), { onclick });
  briefing.replaceChildren(
    el("p", { textContent: urgent.length ? tr(`Checked ${sites.length} sites, ${urgent.length} need action:`)
      : `${tr(`Checked ${sites.length} sites automatically`)}. ${tr("No site needs urgent action.")}` }),
    ...(urgent.length ? [el("div", { className: "home-list" }, ...urgent.slice(0, 3).map(siteLink))] : []),
    ...(work.length ? [el("p", { textContent: tr(`${work.length} site(s) have planned field work.`) })] : []),
    el("div", { className: "briefing-actions" },
      ...(urgent.length ? [button("Fix urgent sites one by one", fixUrgent)] : []),
      ...(work.length ? [button(work.length > 1 ? `Combined action plan (${work.length} sites)` : "Action plan", openCombinedPlan)] : [])),
    Object.assign(el("details", {}, el("summary", { textContent: tr(`All sites (${sites.length})`) }),
      el("div", { className: "home-list" }, ...sites.map(siteLink))), { open: allOpen }));
}
function goHome() {
  stopFollowing();
  document.querySelector(".panel.drawer-open .drawer-close")?.click();
  render(null);
  if (sites.length) {
    const all = L.latLngBounds(sites.map((s) => [s.entry.lat, s.entry.lon])).pad(0.2);
    if (reducedMotion.matches) map.fitBounds(all, { animate: false }); else map.flyToBounds(all, { duration: 1 });
  }
  showBriefing({ fresh: true });
  saveMapState();
}
document.querySelector(".app-brand").onclick = (event) => { event.preventDefault(); goHome(); };
map.on("click", deselect);

// A loaded file can be taken off the map again: the first click asks, the second removes.
function removeButton(s) {
  const button = el("button", { textContent: "Remove from map" });
  let armed;
  button.onclick = () => {
    if (!armed) {
      button.textContent = "Click again to remove";
      armed = setTimeout(() => { armed = null; button.textContent = "Remove from map"; }, 4000);
      return;
    }
    clearTimeout(armed);
    removeUpload(s);
  };
  return button;
}
// Forgets the loaded file and its session plan; a portfolio site it replaced comes back.
async function removeUpload(s) {
  const id = s.entry.site_id;
  forgetUpload(indexUrl, id);
  forgetPlan(s.entry.twin, id);
  markers[id]?.remove(); delete markers[id];
  sites.splice(sites.indexOf(s), 1);
  delete seenProposals[id];
  const original = baseIndex.sites.find((e) => e.site_id === id);
  const back = original ? await add(original) : null;
  render(back);
  renderBriefing();
  logAction(original ? `Removed the loaded file for ${id}, the portfolio version is back` : `Removed ${id} from the map`);
}

function select(s, { inspect = false, travel = true } = {}) {
  const same = selectedSite === s;
  render(s); saveMapState();
  // On narrow screens the panel is a drawer: open it for the site, as a wide screen shows it.
  if (matchMedia("(max-width: 1179px)").matches && !document.querySelector(".panel.drawer-open")) {
    [...document.querySelectorAll('[data-pane="inspect"]')].find((b) => b.offsetParent)?.click();
  }
  if (!travel || same && !inspect) return;
  const request = ++focusRequest;
  map.stop();
  focusedTarget = { s, zoom: inspect ? 17 : 15 };
  const reveal = () => { if (request === focusRequest) focusedTarget = null; };
  if (reducedMotion.matches) { map.setView([s.entry.lat, s.entry.lon], focusedTarget.zoom, { animate: false }); reveal(); }
  else { map.once("moveend", reveal); map.flyTo([s.entry.lat, s.entry.lon], focusedTarget.zoom, { duration: 1.15 }); }
}
function stopFollowing() { focusRequest++; focusedTarget = null; map.stop(); }
map.on("dragstart", stopFollowing);
$("map").addEventListener("wheel", stopFollowing, { passive: true });
// Escape closes the site (open drawers handle their own Escape).
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !event.defaultPrevented) deselect(); });
reducedMotion.addEventListener("change", () => {
  map.options.fadeAnimation = map.options.zoomAnimation = map.options.markerZoomAnimation = !reducedMotion.matches;
  if (reducedMotion.matches && focusedTarget) { const { s, zoom } = focusedTarget; map.stop(); map.setView([s.entry.lat, s.entry.lon], zoom, { animate: false }); }
});
function recordProposal(s, saved) {
  const latest = saved.actions.at(-1);
  if (!latest || seenProposals[s.entry.site_id] === latest.time) return;
  seenProposals[s.entry.site_id] = latest.time;
  logAction(`${s.entry.site_id} · Applied to plan · ${latest.delta.join("; ")} · ${latest.result ?? "Reassessed"}`);
}

// Assesses a site as the engineer last left it: the session plan, its EMF regime and any measured load.
function reassess(s) {
  const saved = restoreProposed(s.entry.twin, s.source);
  s.regime = saved.regime; s.planInfo = saved.message; s.site = saved.site; s.reason = saved.view?.reason;
  s.a = assess(s.entry, s.source, saved.site, saved.regime, saved.status === "restored" && canonical(saved.site) !== canonical(s.source.site));
  return saved;
}
function updateMarker(s) {
  const marker = markers[s.entry.site_id];
  marker.options.title = marker.options.alt = `${s.entry.site_id}: ${LEVELS[s.a.level].label}`;
  marker.setIcon(pinIcon(s.a.level, s === selectedSite));
  marker.getElement()?.setAttribute("aria-label", marker.options.title);
}

async function add(entry) {
  const twin = await fetch(entry.twin).then((r) => r.json());
  const s = { entry, source: twin };
  const saved = reassess(s);
  if (saved.status === "stale") logAction(`${entry.site_id}: ${saved.message}`);
  if (saved.status === "restored" && canonical(saved.site) !== canonical(twin.site)) recordProposal(s, saved);

  const existing = sites.findIndex((x) => x.entry.site_id === entry.site_id);
  if (existing >= 0) sites.splice(existing, 1, s); else sites.push(s);
  markers[entry.site_id]?.remove();
  markers[entry.site_id] = L.marker([entry.lat, entry.lon], { icon: pinIcon(s.a.level, false, s.a.level === "critical" && attentionCount++ < 3), title: `${entry.site_id}: ${LEVELS[s.a.level].label}`, alt: `${entry.site_id}: ${LEVELS[s.a.level].label}` })
    .addTo(map).on("click", () => select(s))
    // Only the name on hover: what the site needs is said once, in the panel when it is selected.
    .bindTooltip(entry.site_id, { direction: "top", offset: [0, -14] });
  return s;
}

await Promise.all(index.sites.map(add)).catch((e) => { $("loading").textContent = `Site assessment failed: ${e.message}`; throw e; });
const validBounds = Array.isArray(storedMap.bounds) && storedMap.bounds.length === 2 && storedMap.bounds.every((pair) => Array.isArray(pair) && pair.length === 2 && pair.every(Number.isFinite));
if (validBounds && !homeView) map.fitBounds(storedMap.bounds, { animate: false });
else map.fitBounds(L.latLngBounds(index.sites.map((s) => [s.lat, s.lon])).pad(0.2), { animate: false });
render(homeView ? null : sites.find((s) => s.entry.site_id === storedMap.selected) ?? null);
$("loading").hidden = true;
saveMapState();
new ResizeObserver(() => map.invalidateSize({ animate: false, pan: false })).observe($("map"));
logAction(`Checked ${sites.length} sites automatically`);

// ---------- Expert Operator on the map (text or voice) ----------
const findSite = (id) => sites.find((s) => s.entry.site_id.toLowerCase() === String(id).toLowerCase())
  ?? sites.find((s) => s.entry.site_id.toLowerCase().includes(String(id).toLowerCase()));
let pendingOpen = null;

const MAP_TOOLS = [
  { type: "function", function: { name: "list_sites", description: "All sites on the map, most urgent first, with urgency level, structure, estimated people nearby and the issues found by the automatic checks.", parameters: { type: "object", properties: { level: { type: "string", enum: Object.keys(LEVELS), description: "Only sites at this urgency level" } } } } },
  { type: "function", function: { name: "focus_site", description: "Zoom the map to a site and show its issues to the engineer.", parameters: { type: "object", properties: { site_id: { type: "string" } }, required: ["site_id"] } } },
  { type: "function", function: { name: "fix_sites", description: "Fix several sites one after another: each site's 3D twin opens in turn, the Expert Operator there applies the smallest fix, and at the end the map shows one combined action plan for the field teams. Use when the engineer asks to fix all, several or every problem site.", parameters: { type: "object", properties: { site_ids: { type: "array", items: { type: "string" }, description: "Most urgent first" } }, required: ["site_ids"] } } },
  { type: "function", function: { name: "open_site", description: "Open the site's 3D twin, where the Expert Operator there carries out `instruction` (or a full review when it is omitted) and simulates the fix. Use when the engineer wants to fix, simulate, change or inspect a site in 3D.", parameters: { type: "object", properties: { site_id: { type: "string" }, instruction: { type: "string", description: "What to do on the twin, in the engineer's language, e.g. 'fix the school conflict' or 'add 5G on sector 2'" } }, required: ["site_id"] } } },
];

const chat = initConversation({
  onBusy: (on) => voice.setRunning(on),
  onComplete: () => { if (pendingOpen && pageActive) location.href = pendingOpen; },
  speak: (text) => voice.speak(text),
  transcriptKey: absoluteUrl(indexUrl),
});
const mapAgent = createAgent({
  definitions: MAP_TOOLS,
  handlers: {
    list_sites: ({ level } = {}) => [...sites].sort((a, b) => LEVELS[b.a.level].rank - LEVELS[a.a.level].rank || b.a.score - a.a.score).filter((s) => !level || s.a.level === level).map((s) => ({
      site_id: s.entry.site_id, level: LEVELS[s.a.level].label, regime: REGIMES[s.regime].name, assessment: s.planInfo, structure: s.entry.structure,
      technology: s.entry.technology, people_nearby_estimated: s.a.people, issues: s.a.issues.slice(0, 4),
    })),
    focus_site: ({ site_id }) => {
      const s = findSite(site_id);
      if (!s) return { error: `no site ${site_id}` };
      select(s);
      logAction(`Showed ${s.entry.site_id}: ${LEVELS[s.a.level].label}`);
      return { focused: s.entry.site_id, level: LEVELS[s.a.level].label, issues: s.a.issues };
    },
    fix_sites: ({ site_ids }) => {
      // Most urgent first, whatever order the model listed them in.
      const picked = [...new Set((site_ids ?? []).map(findSite).filter(Boolean))]
        .sort((a, b) => LEVELS[b.a.level].rank - LEVELS[a.a.level].rank || b.a.score - a.a.score);
      if (!picked.length) return { error: "none of these sites is on the map" };
      // Each twin gets a one-site instruction; "fix all sites" there would send its agent elsewhere.
      const ask = document.documentElement.lang === "tr" ? "Bu sahadaki en önemli sorunu en küçük değişiklikle düzelt." : "Fix the most important problem on this site with the smallest change.";
      const stops = picked.map((s) => ({ site_id: s.entry.site_id, url: `${twinUrl(s, ask, mapAgent.voice)}&tour=1` }));
      startTour(stops, `${location.pathname}${location.search}`);
      select(picked[0]);
      pendingOpen = stops[0].url;
      saveMapState();
      logAction(`Fixing ${picked.length} sites in turn: ${picked.map((s) => s.entry.site_id).join(", ")}`);
      return { fixing: picked.map((s) => s.entry.site_id), instruction: ask };
    },
    open_site: ({ site_id, instruction }) => {
      const s = findSite(site_id);
      if (!s) return { error: `no site ${site_id}` };
      select(s);
      pendingOpen = twinUrl(s, instruction, mapAgent.voice);
      saveMapState();
      logAction(`Opening ${s.entry.site_id} in 3D: ${instruction ?? "full review"}`);
      return { opening: s.entry.site_id, instruction: instruction ?? "full review" };
    },
  },
  systemPrompt: ({ voice } = {}) => `You are the Expert Operator on the SiteTwin portfolio map: a senior RF and site engineer who helps
an operator or vendor decide which base-station sites need attention and what to do.
${voice ? "The engineer is speaking: answer in 1-3 short spoken sentences, no lists." : "The engineer is typing: answer in at most 3 short lines, plain sentences, no headings."}
Answer in the engineer's language (Turkish if they speak Turkish). When you open a site, pass the instruction in the engineer's own language.
${document.documentElement.lang === "tr" ? "The engineer's screen is in Turkish: say the urgency levels and structure types in Turkish too (Critical = Kritik, Action needed = Aksiyon gerekli, Review = İnceleme, Change planned = Değişiklik planlandı, OK = Uygun; rooftop = çatı, ground = zemin)." : ""}
Sites are ranked by automatic checks: Critical = an EMF zone reaches a sensitive building (school, kindergarten, hospital);
Action needed = a zone reaches another building, or a cell is full (85% PRB or more in the busy hour, measured); Review = roof safety or a busy sector; Change planned = the engineer applied a change in SiteTwin 3D that is not built yet. Each site is assessed as it stands, the result of its latest SiteTwin application.
Capacity issues marked "measured" come from the operator's network KPIs; "estimated" ones only from the people around the site.
Call a cell full only at 85% PRB or more; 70-85% is busy. When the plan already adds capacity on a busy sector, say so.
Call list_sites before talking about sites; never invent sites or numbers. Site names may be spoken loosely ("Ankara", "the Izmir one"):
match them to site_id. To show a site, use focus_site. To fix several or all problem sites, use fix_sites (most urgent first; skip OK sites). To fix, simulate, change or inspect one in 3D, use open_site with an instruction
that carries over exactly what the engineer asked; then say in one sentence what will happen there.`,
  ui: chat,
});
if (homeView || !$("chatLog").children.length) showBriefing({ fresh: homeView });
const voice = initVoice({
  button: $("micButton"),
  status: (t) => { $("chatBusy").hidden = !t; if (t) $("chatBusy").textContent = t; },
  onText: (t) => mapAgent.ask(t, { voice: true }),
});
const send = () => {
  if ($("chatInput").disabled) return;
  const text = $("chatInput").value.trim();
  if (!text) return;
  $("chatInput").value = "";
  mapAgent.ask(text);
};
$("chatSend").onclick = send;
for (const c of document.querySelectorAll(".suggest")) c.onclick = () => mapAgent.ask(c.textContent);

// Back from a portfolio tour: one action plan for every site that was fixed.
const tour = readTour();
if (tour && !tour.stops.length) {
  endTour();
  if (tour.plans.length) {
    logAction(`Tour finished: action plan for ${tour.plans.length} sites`);
    openActionPlan(combinePlans(tour.plans));
  }
}
$("chatInput").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };

$("upload").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  // Progress goes to the chat: the right panel only opens for the site once it is on the map.
  chat.say("tool", "Importing and fetching surrounding buildings…");
  try {
    // Checked here first, so a wrong file gets a plain answer instead of a parser message.
    let doc;
    try { doc = JSON.parse(await file.text()); } catch { throw new Error("This file is not JSON. Choose a SiteTwin site file (.json)."); }
    if (!doc || typeof doc !== "object" || Array.isArray(doc) || !doc.site_id) throw new Error("This is not a SiteTwin site file: it has no site_id.");
    const res = await fetch("api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(doc) });
    if (!res.ok) {
      const detail = await res.json().then((b) => (typeof b.detail === "string" ? b.detail : null)).catch(() => null);
      throw new Error(detail ? `This is not a usable SiteTwin site file: ${detail.replace(/^not a usable SiteTwin file: /, "")}` : `Import failed (HTTP ${res.status})`);
    }
    const entry = await res.json();
    const replaced = sites.some((x) => x.entry.site_id === entry.site_id);
    const s = await add(entry);
    rememberUpload(indexUrl, entry);
    chat.say("tool", `${replaced ? "Updated" : "Added"} ${s.entry.site_id}`);
    logAction(`Loaded SiteTwin file ${s.entry.site_id}: ${LEVELS[s.a.level].label}`);
    renderBriefing();
    select(s);
  } catch (err) {
    chat.say("tool", `⚠️ ${String(err.message ?? err).slice(0, 240)}`);
  }
  e.target.value = "";
};

window.addEventListener("pageshow", async (event) => {
  if (!event.persisted) return;
  for (const s of sites) {
    try {
      const response = await fetch(s.entry.twin, { cache: "no-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      s.source = await response.json();
      const saved = reassess(s);
      if (saved.status === "restored") recordProposal(s, saved);
      updateMarker(s);
      if (saved.status === "stale") logAction(`${s.entry.site_id}: ${saved.message}`);
    } catch (error) { logAction(`${s.entry.site_id}: reassessment unavailable (${error.message}); previous displayed assessment retained`); }
  }
  render(); renderBriefing(); saveMapState();
});
