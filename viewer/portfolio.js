// Portfolio map: every site, checked with the same code as the 3D planner,
// ranked by how urgently it needs attention.

import { siteZones, REGIMES } from "./emf.js";
import { checkSite } from "./checks.js";
import { populationContext } from "./population.js";
import { createAgent } from "./agent.js";
import { initVoice } from "./voice.js";
import { initConversation } from "./conversation.js";
import { readSession, writeSession, restoreProposed, canonical, handoffId, absoluteUrl } from "./session.js";
import { $, el, token, initShell, reducedMotion } from "./ui.js";

initShell();
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

const indexUrl = new URLSearchParams(location.search).get("portfolio") || "data/private/portfolio.json";
const mapKey = `map:${absoluteUrl(indexUrl)}`;
const storedMap = readSession(mapKey, {}) || {};
const mapActions = Array.isArray(storedMap.actions) ? storedMap.actions.filter((a) => a && typeof a.text === "string" && typeof a.time === "string") : [];
const seenProposals = storedMap.proposals && typeof storedMap.proposals === "object" ? storedMap.proposals : {};
const index = await fetch(indexUrl).then((r) => (r.ok ? r.json() : fetch("data/samples/portfolio.json").then((s) => s.json())))
  .catch((e) => { $("loading").textContent = `Portfolio unavailable: ${e.message}`; throw e; });

const map = L.map("map", { zoomControl: true, fadeAnimation: !reducedMotion.matches,
  zoomAnimation: !reducedMotion.matches, markerZoomAnimation: !reducedMotion.matches });
// Standard OSM tiles, darkened with a CSS filter to match the app.
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>', maxZoom: 19,
}).addTo(map);

function assess(entry, twin, regime = "tr", proposed = false) {
  const site = twin.site;
  const { findings, hit } = checkSite(site, siteZones(site, REGIMES[regime]));
  const pop = populationContext(site);
  const issues = [];
  const bad = findings.filter((f) => f.level === "bad");
  const sensitive = bad.filter((f) => f.sensitive);
  for (const f of sensitive) issues.push(`Sensitive building inside an EMF zone: ${f.text}`);
  for (const f of bad.filter((f) => !f.sensitive)) issues.push(f.text);
  for (const f of findings.filter((f) => f.level === "warn")) issues.push(f.text);
  const busiest = Object.entries(pop.people_per_antenna).sort((a, b) => b[1] - a[1])[0];
  const capacity = busiest && busiest[1] > CAPACITY_PEOPLE_PER_ANTENNA;
  if (capacity) issues.push(`Capacity: ${busiest[0]} serves ~${busiest[1]} people in its main lobe (estimated)`);
  const planned = Object.entries(entry.antenna_actions ?? {}).filter(([k]) => k !== "retain");
  if (planned.length) issues.push(`SiteTwin plan: ${planned.map(([k, v]) => `${v} ${k}`).join(", ")}${entry.reason ? ` (${entry.reason})` : ""}`);
  if (proposed) issues.push("Session proposal · applied to plan; source file unchanged");
  const level = sensitive.length ? "critical" : bad.length ? "high" : findings.some((f) => f.level === "warn") || capacity ? "medium" : planned.length || proposed ? "planned" : "ok";
  const score = 100 * sensitive.length + 30 * bad.length + 5 * findings.filter((f) => f.level === "warn").length + (capacity ? 10 : 0) + planned.length;
  return { level, score, issues, hitBuildings: hit.size, findingCount: bad.length, people: pop.total_people_nearby, buildings: site.neighbours.length };
}

const sites = [];
const markers = {};
let selectedSite = null;
let statusFilter = LEVELS[storedMap.filter] ? storedMap.filter : null;
let attentionCount = 0;
let pageActive = true;
window.addEventListener("pagehide", () => { pageActive = false; });
window.addEventListener("pageshow", () => { pageActive = true; });

function pinIcon(level, selected = false, attention = false) {
  const pin = el("div", { className: `pin ${level}${selected ? " selected" : ""}${attention ? " attention" : ""}` }, el("span", { textContent: LEVELS[level].glyph }));
  pin.style.color = token(level);
  return L.divIcon({ className: "map-pin", html: pin, iconSize: [32, 32], iconAnchor: [16, 16] });
}

function renderActions() {
  $("actions").replaceChildren(...mapActions.map((action) => el("li", {}, el("time", { textContent: new Date(action.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }), action.text)));
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
  writeSession(mapKey, { selected: selectedSite?.entry.site_id, filter: statusFilter,
    bounds: [[bounds.getSouth(), bounds.getWest()], [bounds.getNorth(), bounds.getEast()]],
    actions: mapActions, proposals: seenProposals });
}
map.on("moveend", saveMapState);
window.addEventListener("pagehide", saveMapState);
renderActions();

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

const siteRows = new Map(), statButtons = new Map();
let hoveredRow = null, rankPending = false, focusRequest = 0, focusedTarget = null;
const rankingNotice = el("button", { textContent: "Ranking updated", hidden: true });
$("list").before(rankingNotice);
const rankingLocked = () => Boolean(hoveredRow || document.activeElement?.closest(".site"));
function releaseRanking() { if (rankPending && !rankingLocked()) render(selectedSite, true); }
rankingNotice.onclick = () => render(selectedSite, true);
function render(selected = selectedSite, force = false) {
  selectedSite = selected;
  const ranked = [...sites].sort((a, b) => LEVELS[b.a.level].rank - LEVELS[a.a.level].rank || b.a.score - a.a.score);
  const locked = !force && rankingLocked();
  if (!locked) sites.splice(0, sites.length, ...ranked);
  rankPending = locked && ranked.some((s, i) => sites[i] !== s);
  rankingNotice.hidden = !rankPending;
  const counts = Object.fromEntries(Object.keys(LEVELS).map((k) => [k, sites.filter((s) => s.a.level === k).length]));
  for (const [key, config] of [["all", { label: "Total sites" }], ...Object.entries(LEVELS)]) {
    let button = statButtons.get(key);
    if (!button) {
      button = el("button", { className: "stat" }, el("b"), el("span", { textContent: config.label }));
      if (key !== "all") button.style.borderLeft = `3px solid ${token(key)}`;
      button.onclick = () => { statusFilter = key === "all" || statusFilter === key ? null : key; render(); };
      statButtons.set(key, button); $("stats").append(button);
    }
    button.firstChild.textContent = key === "all" ? sites.length : counts[key];
    button.setAttribute("aria-pressed", String(key === "all" ? !statusFilter : statusFilter === key));
  }
  $("filterStatus").textContent = statusFilter ? `Filter: ${LEVELS[statusFilter].label}` : "All sites";
  $("clearFilter").hidden = !statusFilter;
  const list = $("list"), panel = list.closest(".panel");
  const before = new Map([...siteRows].map(([id, row]) => [id, row.getBoundingClientRect().top]));
  const anchor = [...list.children].find((row) => !row.hidden && row.getBoundingClientRect().bottom > panel.getBoundingClientRect().top + 240);
  const anchorTop = anchor?.getBoundingClientRect().top;
  for (const s of sites) {
    const id = s.entry.site_id, lv = LEVELS[s.a.level];
    let row = siteRows.get(id);
    if (!row) {
      row = el("div", { className: "site", tabIndex: 0, role: "group" });
      row.onclick = () => select(s);
      row.onkeydown = (event) => { if (event.target === row && ["Enter", " "].includes(event.key)) { event.preventDefault(); select(s); } };
      row.onpointerenter = () => { hoveredRow = id; };
      row.onpointerleave = () => { if (hoveredRow === id) hoveredRow = null; releaseRanking(); };
      row.onfocusout = () => queueMicrotask(releaseRanking);
      siteRows.set(id, row);
    }
    const signature = JSON.stringify([s.a, s.regime, s.planInfo, s === selected]);
    if (row.dataset.signature !== signature) {
      const restoreActionFocus = document.activeElement !== row && row.contains(document.activeElement);
      row.dataset.signature = signature;
      row.replaceChildren(
        el("div", { className: "head" }, el("span", { className: "dot", style: `background:${token(s.a.level)}`, textContent: lv.glyph }), el("span", { className: "id", textContent: id })),
        el("div", { className: "tag", textContent: `${s.entry.structure.replaceAll("_", " ")} · ${lv.label} · ${s.regime === "tr" ? "TR 20%" : "ICNIRP"}` }),
        el("div", { className: "muted", textContent: `${s.a.buildings} buildings · ~${s.a.people} people nearby (estimated)` }),
        el("div", { className: "issue", textContent: s.a.issues[0] ?? "No issues found" }));
      if (s === selected) row.append(
        el("div", { className: "muted", textContent: `${s.a.findingCount} conflict findings · ${s.a.hitBuildings} unique affected buildings` }),
        el("ul", {}, ...s.a.issues.slice(1).map((text) => el("li", { textContent: text }))),
        Object.assign(el("button", { className: "primary", textContent: "Open 3D twin →" }), { onclick: (event) => { event.stopPropagation(); openTwin(s); } }));
      if (restoreActionFocus) (row.querySelector("button") ?? row).focus({ preventScroll: true });
    }
    row.onclick = () => select(s);
    row.onkeydown = (event) => { if (event.target === row && ["Enter", " "].includes(event.key)) { event.preventDefault(); select(s); } };
    row.classList.toggle("sel", s === selected);
    row.title = `${REGIMES[s.regime].name} · ${s.planInfo}`;
    row.setAttribute("aria-label", `${id}, ${lv.label}`); row.setAttribute("aria-expanded", String(s === selected));
    row.hidden = Boolean(statusFilter && s.a.level !== statusFilter);
    if (!row.isConnected) list.append(row);
    markers[id]?.getElement()?.querySelector(".pin")?.classList.toggle("selected", s === selected);
  }
  if (!locked) {
    const active = document.activeElement;
    for (let i = 0; i < sites.length; i++) {
      const row = siteRows.get(sites[i].entry.site_id);
      if (list.children[i] !== row) list.insertBefore(row, list.children[i] ?? null);
    }
    if (anchor?.isConnected && !anchor.hidden) panel.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
    if (active?.isConnected && document.activeElement !== active) active.focus({ preventScroll: true });
    if (!reducedMotion.matches) for (const [id, row] of siteRows) {
      const from = before.get(id), delta = from - row.getBoundingClientRect().top;
      if (!row.hidden && Number.isFinite(delta) && Math.abs(delta) > 1) row.animate([{ transform: `translateY(${delta}px)` }, { transform: "none" }], { duration: 240, easing: "cubic-bezier(.2,0,0,1)" });
    }
  }
}
$("clearFilter").onclick = () => { statusFilter = null; render(); };
function select(s, { inspect = false, travel = true } = {}) {
  const same = selectedSite === s;
  render(s); saveMapState();
  if (!travel || same && !inspect) { if (travel && !focusedTarget) markers[s.entry.site_id]?.openPopup(); return; }
  const request = ++focusRequest;
  map.stop();
  focusedTarget = { s, zoom: inspect ? 17 : 15 };
  const reveal = () => { if (request === focusRequest) { focusedTarget = null; markers[s.entry.site_id]?.openPopup(); } };
  if (reducedMotion.matches) { map.setView([s.entry.lat, s.entry.lon], focusedTarget.zoom, { animate: false }); reveal(); }
  else { map.once("moveend", reveal); map.flyTo([s.entry.lat, s.entry.lon], focusedTarget.zoom, { duration: 1.15 }); }
}
function stopFollowing() { focusRequest++; focusedTarget = null; map.stop(); }
map.on("dragstart", stopFollowing);
$("map").addEventListener("wheel", stopFollowing, { passive: true });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") map.closePopup(); });
reducedMotion.addEventListener("change", () => {
  map.options.fadeAnimation = map.options.zoomAnimation = map.options.markerZoomAnimation = !reducedMotion.matches;
  for (const row of siteRows.values()) for (const animation of row.getAnimations()) animation.cancel();
  if (reducedMotion.matches && focusedTarget) { const { s, zoom } = focusedTarget; map.stop(); map.setView([s.entry.lat, s.entry.lon], zoom, { animate: false }); }
});
function siteCard(s) {
  const card = el("div", {}, el("strong", { textContent: s.entry.site_id }),
    el("div", { textContent: LEVELS[s.a.level].label }), el("p", { textContent: s.a.issues[0] ?? "No issues found" }));
  card.append(Object.assign(el("button", { textContent: "Open 3D twin", className: "primary" }), { onclick: () => openTwin(s) }),
    Object.assign(el("button", { textContent: "Inspect surroundings" }), { onclick: () => select(s, { inspect: true }) }));
  return card;
}
function recordProposal(s, saved) {
  const latest = saved.actions.at(-1);
  if (!latest || seenProposals[s.entry.site_id] === latest.time) return;
  seenProposals[s.entry.site_id] = latest.time;
  logAction(`${s.entry.site_id} · Applied to plan · ${latest.delta.join("; ")} · ${latest.result ?? "Reassessed"}`);
}

async function add(entry) {
  const twin = await fetch(entry.twin).then((r) => r.json());
  const saved = restoreProposed(entry.twin, twin);
  const proposed = saved.status === "restored" && canonical(saved.site) !== canonical(twin.site);
  const s = { entry, source: twin, regime: saved.regime, planInfo: saved.message, a: assess(entry, { ...twin, site: saved.site }, saved.regime, proposed) };
  if (saved.status === "stale") logAction(`${entry.site_id}: ${saved.message}`);
  if (proposed) recordProposal(s, saved);

  const existing = sites.findIndex((x) => x.entry.site_id === entry.site_id);
  if (existing >= 0) sites.splice(existing, 1, s); else sites.push(s);
  markers[entry.site_id]?.remove();
  markers[entry.site_id] = L.marker([entry.lat, entry.lon], { icon: pinIcon(s.a.level, false, s.a.level === "critical" && attentionCount++ < 3), title: `${entry.site_id}: ${LEVELS[s.a.level].label}`, alt: `${entry.site_id}: ${LEVELS[s.a.level].label}` })
    .addTo(map).on("click", () => select(s))
    .bindPopup(() => siteCard(s), { autoPan: false, maxWidth: 240 });
  const marker = markers[entry.site_id];
  let hoverTimer;
  marker.on("mouseover", () => { hoverTimer = setTimeout(() => marker.openPopup(), 150); });
  marker.on("mouseout", () => clearTimeout(hoverTimer));
  marker.getElement()?.addEventListener("focus", () => { hoverTimer = setTimeout(() => marker.openPopup(), 150); });
  marker.getElement()?.addEventListener("blur", () => clearTimeout(hoverTimer));
  return s;
}

await Promise.all(index.sites.map(add)).catch((e) => { $("loading").textContent = `Site assessment failed: ${e.message}`; throw e; });
const validBounds = Array.isArray(storedMap.bounds) && storedMap.bounds.length === 2 && storedMap.bounds.every((pair) => Array.isArray(pair) && pair.length === 2 && pair.every(Number.isFinite));
if (validBounds) map.fitBounds(storedMap.bounds, { animate: false });
else map.fitBounds(L.latLngBounds(index.sites.map((s) => [s.lat, s.lon])).pad(0.2), { animate: false });
render(sites.find((s) => s.entry.site_id === storedMap.selected) ?? null);
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
${voice ? "The engineer is speaking: answer in 1-3 short spoken sentences, no lists." : "The engineer is typing: answer in short text; a short list is fine."}
Answer in the engineer's language (Turkish if they speak Turkish).
Sites are ranked by automatic checks: Critical = an EMF zone reaches a sensitive building (school, kindergarten, hospital);
Action needed = a zone reaches another building; Review = roof safety or capacity; Change planned = SiteTwin has pending antenna changes.
Call list_sites before talking about sites; never invent sites or numbers. Site names may be spoken loosely ("Ankara", "the Izmir one"):
match them to site_id. To show a site, use focus_site. To fix, simulate, change or inspect one in 3D, use open_site with an instruction
that carries over exactly what the engineer asked; then say in one sentence what will happen there.`,
  ui: chat,
});
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
$("chatInput").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };

$("upload").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $("uploadStatus").textContent = "Importing and fetching surrounding buildings…";
  try {
    const res = await fetch("api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: await file.text() });
    if (!res.ok) throw new Error(await res.text());
    const s = await add(await res.json());
    $("uploadStatus").textContent = `Added ${s.entry.site_id}`;
    logAction(`Loaded SiteTwin file ${s.entry.site_id}: ${LEVELS[s.a.level].label}`);
    select(s);
  } catch (err) {
    $("uploadStatus").textContent = `⚠️ ${String(err.message ?? err).slice(0, 200)}`;
  }
  e.target.value = "";
};

window.addEventListener("pageshow", async (event) => {
  if (!event.persisted) return;
  for (const s of sites) {
    try {
      const response = await fetch(s.entry.twin, { cache: "no-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const source = await response.json(), saved = restoreProposed(s.entry.twin, source);
      s.source = source; s.regime = saved.regime; s.planInfo = saved.message;
      s.a = assess(s.entry, { ...source, site: saved.site }, saved.regime, saved.status === "restored" && canonical(saved.site) !== canonical(source.site));
      if (saved.status === "restored") recordProposal(s, saved);
      const marker = markers[s.entry.site_id];
      marker.options.title = marker.options.alt = `${s.entry.site_id}: ${LEVELS[s.a.level].label}`;
      marker.setIcon(pinIcon(s.a.level, s === selectedSite));
      marker.getElement()?.setAttribute("aria-label", marker.options.title);
      if (saved.status === "stale") logAction(`${s.entry.site_id}: ${saved.message}`);
    } catch (error) { logAction(`${s.entry.site_id}: reassessment unavailable (${error.message}); previous displayed assessment retained`); }
  }
  render(); saveMapState();
});
