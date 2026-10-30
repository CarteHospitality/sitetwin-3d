// Portfolio map: every site, checked with the same code as the 3D planner,
// ranked by how urgently it needs attention.

import { siteZones } from "./emf.js";
import { checkSite } from "./checks.js";
import { populationContext } from "./population.js";
import { createAgent } from "./agent.js";
import { initVoice } from "./voice.js";

const LEVELS = {
  critical: { label: "Critical", color: "var(--critical)", hex: "#ff4d4f", rank: 4 },
  high: { label: "Action needed", color: "var(--high)", hex: "#fa8c16", rank: 3 },
  medium: { label: "Review", color: "var(--medium)", hex: "#fadb14", rank: 2 },
  planned: { label: "Change planned", color: "var(--planned)", hex: "#4096ff", rank: 1 },
  ok: { label: "OK", color: "var(--ok)", hex: "#52c41a", rank: 0 },
};
// Indicative: people in the main lobes of one antenna above which capacity is worth a look.
const CAPACITY_PEOPLE_PER_ANTENNA = 1500;

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};

const indexUrl = new URLSearchParams(location.search).get("portfolio") || "data/private/portfolio.json";
const index = await fetch(indexUrl).then((r) => (r.ok ? r.json() : fetch("data/samples/portfolio.json").then((s) => s.json())));

const map = L.map("map", { zoomControl: true });
// Standard OSM tiles, darkened with a CSS filter to match the app.
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors", maxZoom: 19, className: "dark-tiles",
}).addTo(map);

function assess(entry, twin) {
  const site = twin.site;
  const { findings } = checkSite(site, siteZones(site));
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
  const level = sensitive.length ? "critical" : bad.length ? "high" : findings.some((f) => f.level === "warn") || capacity ? "medium" : planned.length ? "planned" : "ok";
  const score = 100 * sensitive.length + 30 * bad.length + 5 * findings.filter((f) => f.level === "warn").length + (capacity ? 10 : 0) + planned.length;
  return { level, score, issues, people: pop.total_people_nearby, buildings: site.neighbours.length };
}

const sites = [];
const markers = {};

function pinIcon(level) {
  return L.divIcon({ className: "", html: `<div class="pin ${level}" style="background:${LEVELS[level].hex}"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] });
}

function logAction(text) {
  const list = $("actions");
  if (list.querySelector(".muted")) list.replaceChildren();
  list.prepend(el("li", {}, el("time", { textContent: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }), text));
}

function twinUrl(s, instruction) {
  const ask = instruction ? `&ask=${encodeURIComponent(instruction)}` : "&auto=review";
  return `index.html?twin=${encodeURIComponent(s.entry.twin)}${ask}&from=${encodeURIComponent(location.pathname + location.search)}`;
}
function openTwin(s) {
  logAction(`Opened ${s.entry.site_id} in 3D for a full review`);
  location.href = twinUrl(s);
}

function render(selected) {
  sites.sort((a, b) => LEVELS[b.a.level].rank - LEVELS[a.a.level].rank || b.a.score - a.a.score);
  const counts = Object.fromEntries(Object.keys(LEVELS).map((k) => [k, sites.filter((s) => s.a.level === k).length]));
  $("stats").replaceChildren(
    el("div", { className: "stat" }, el("b", { textContent: sites.length }), "sites"),
    ...Object.entries(LEVELS).filter(([k]) => counts[k]).map(([k, v]) => el("div", { className: "stat", style: `border-left:3px solid ${v.hex}` }, el("b", { textContent: counts[k] }), v.label)),
  );
  $("list").replaceChildren(...sites.map((s) => {
    const lv = LEVELS[s.a.level];
    const row = el("div", { className: `site${s === selected ? " sel" : ""}` },
      el("div", { className: "head" },
        el("span", { className: "dot", style: `background:${lv.hex}` }),
        el("span", { className: "id", textContent: s.entry.site_id }),
        el("span", { className: "tag", textContent: s.entry.structure.replace("_", " ") }),
        el("span", { className: "tag", textContent: lv.label }),
      ),
      el("div", { className: "muted", textContent: `${s.a.buildings} buildings around, ~${s.a.people} people nearby (estimated)` }),
    );
    if (s === selected) {
      row.append(
        el("ul", {}, ...(s.a.issues.length ? s.a.issues : ["No issues found"]).map((t) => el("li", { textContent: t }))),
        el("div", { style: "margin-top:8px" }, Object.assign(el("button", { className: "primary", textContent: "Open 3D twin and simulate the fix →" }), { onclick: (e) => { e.stopPropagation(); openTwin(s); } })),
      );
    }
    row.onclick = () => select(s);
    return row;
  }));
}

function select(s) {
  map.setView([s.entry.lat, s.entry.lon], Math.max(map.getZoom(), 15));
  render(s);
}

async function add(entry) {
  const twin = await fetch(entry.twin).then((r) => r.json());
  const s = { entry, a: assess(entry, twin) };
  sites.push(s);
  markers[entry.site_id]?.remove();
  markers[entry.site_id] = L.marker([entry.lat, entry.lon], { icon: pinIcon(s.a.level), title: entry.site_id })
    .addTo(map).on("click", () => select(s))
    .bindTooltip(`${entry.site_id}: ${LEVELS[s.a.level].label}`);
  return s;
}

await Promise.all(index.sites.map(add));
map.fitBounds(L.latLngBounds(index.sites.map((s) => [s.lat, s.lon])).pad(0.2));
render();
new ResizeObserver(() => map.invalidateSize()).observe($("map"));
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

const mapAgent = createAgent({
  definitions: MAP_TOOLS,
  handlers: {
    list_sites: ({ level } = {}) => sites.filter((s) => !level || s.a.level === level).map((s) => ({
      site_id: s.entry.site_id, level: LEVELS[s.a.level].label, structure: s.entry.structure,
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
      pendingOpen = twinUrl(s, instruction);
      logAction(`Opening ${s.entry.site_id} in 3D: ${instruction ?? "full review"}`);
      return { opening: s.entry.site_id, instruction: instruction ?? "full review" };
    },
  },
  systemPrompt: () => `You are the Expert Operator on the SiteTwin portfolio map: a senior RF and site engineer who helps
an operator or vendor decide which base-station sites need attention and what to do. The engineer is often speaking by voice:
answer in 1-3 short, spoken-friendly sentences, in the engineer's language (Turkish if they speak Turkish).
Sites are ranked by automatic checks: Critical = an EMF zone reaches a sensitive building (school, kindergarten, hospital);
Action needed = a zone reaches another building; Review = roof safety or capacity; Change planned = SiteTwin has pending antenna changes.
Call list_sites before talking about sites; never invent sites or numbers. Site names may be spoken loosely ("Ankara", "the Izmir one"):
match them to site_id. To show a site, use focus_site. To fix, simulate, change or inspect one in 3D, use open_site with an instruction
that carries over exactly what the engineer asked; then say in one sentence what will happen there.`,
  ui: {
    user: (t) => say("user", t),
    assistant: (t) => say("assistant", t),
    model: (m) => ($("chatModel").textContent = m),
    busy: (on) => {
      $("chatSend").disabled = on;
      $("chatInput").disabled = on;
      $("chatBusy").textContent = "Thinking…";
      $("chatBusy").hidden = !on;
      if (!on && pendingOpen) setTimeout(() => (location.href = pendingOpen), 2500);
    },
    tool: (name, args, result) => say("tool", result.error ? `✖ ${result.error}`
      : name === "list_sites" ? `🔎 Checking ${result.length} sites…`
      : name === "focus_site" ? `📍 ${result.focused}`
      : `🧭 Opening ${result.opening} in 3D…`),
    speak: (t) => voice.speak(t),
  },
});
function say(cls, text) {
  $("chatLog").append(el("div", { className: `msg ${cls}`, textContent: text }));
  $("chatLog").scrollTop = $("chatLog").scrollHeight;
}
const voice = initVoice({
  button: $("micButton"),
  status: (t) => { $("chatBusy").hidden = !t; if (t) $("chatBusy").textContent = t; },
  onText: (t) => mapAgent.ask(t),
  speakToggle: $("speakReplies"),
});
const send = () => {
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
