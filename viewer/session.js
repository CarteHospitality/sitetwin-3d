// Display continuity and proposed plans only. Model execution history is never
// restored. Stored findings are never trusted: both pages rerun shared checks.
import { REGIMES } from "./emf.js";
const PREFIX = "sitetwin:";
export function readSession(key, fallback = null) {
  try { const value = sessionStorage.getItem(PREFIX + key); return value ? JSON.parse(value) : fallback; }
  catch { return fallback; }
}
export function writeSession(key, value) {
  try { sessionStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; }
  catch { return false; }
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export const sourceFingerprint = (twin) => canonical({ site: twin.site, baseline: twin.baseline ?? twin.site });
export function absoluteUrl(url) {
  return new URL(url, typeof location === "object" ? location.href : "http://localhost/").href;
}
const baseKey = (url, id) => `plan:${absoluteUrl(url)}:${id}`;
export function saveProposed(url, source, { site, regime, actions = [], view = {} }, fingerprint = sourceFingerprint(source)) {
  const key = baseKey(url, source.site.site_id);
  if (!REGIMES[regime]) return false;
  const saved = writeSession(`${key}:${regime}`, { version: 1, twinUrl: absoluteUrl(url), siteId: source.site.site_id,
    fingerprint, regime, site, actions, view, updated: new Date().toISOString() });
  return saved && writeSession(`${key}:active`, regime);
}
function validPlan(site, source) {
  if (!site || !Array.isArray(site.antennas)) return false;
  // Session changes can change antennas, never source geography/occupancy.
  if (canonical({ ...site, antennas: [] }) !== canonical({ ...source.site, antennas: [] })) return false;
  const ids = new Set();
  for (const antenna of site.antennas) {
    if (typeof antenna.id !== "string" || ids.has(antenna.id) || !Array.isArray(antenna.bands)) return false;
    ids.add(antenna.id);
    if (!["azimuth_deg", "mechanical_tilt_deg", "electrical_tilt_deg", "height_agl_m", "x_m", "z_m", "length_m"].every((key) => Number.isFinite(antenna[key]))) return false;
    if (antenna.height_agl_m <= 0 || antenna.length_m <= 0) return false;
    for (const band of antenna.bands) if (typeof band.name !== "string" ||
      !["frequency_mhz", "tx_power_w", "gain_dbi", "horizontal_beamwidth_deg", "vertical_beamwidth_deg"].every((key) => Number.isFinite(band[key])) || band.frequency_mhz < 400 || band.tx_power_w < 1) return false;
  }
  return true;
}
export function restoreProposed(url, source) {
  const original = { site: source.site, regime: "tr", actions: [], view: {}, status: "none", message: "Source assessment" };
  const key = baseKey(url, source.site.site_id), active = readSession(`${key}:active`);
  if (!active) return original;
  const saved = readSession(`${key}:${active}`);
  if (!saved || saved.version !== 1 || !REGIMES[active] || saved.regime !== active || saved.siteId !== source.site.site_id ||
      saved.twinUrl !== absoluteUrl(url) || saved.fingerprint !== sourceFingerprint(source) || !validPlan(saved.site, source)) {
    return { ...original, status: "stale", message: "Stored plan context changed or is unreadable. Original assessment loaded; no stored changes applied." };
  }
  return { site: saved.site, regime: saved.regime, actions: Array.isArray(saved.actions) ? saved.actions.filter((item) =>
    item && typeof item.time === "string" && Array.isArray(item.delta) && item.delta.every((value) => typeof value === "string")) : [],
    view: saved.view && typeof saved.view === "object" ? saved.view : {}, status: "restored", message: "Proposed plan restored for this source and regime · source file unchanged" };
}
export function handoffId() {
  return typeof crypto === "object" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
export function consumeHandoff(params, url = location.href) {
  if (!params.get("ask") && params.get("auto") !== "review") return null;
  const current = new URL(url);
  let id = params.get("handoff");
  if (!id) { id = handoffId(); current.searchParams.set("handoff", id); }
  const key = `handoff:${absoluteUrl(params.get("twin") || "data/site.twin.json")}:${id}`;
  if (readSession(key)) return null;
  const instruction = params.get("ask") || "Review this site like an operator: what is the most important problem, what would you change and why? Apply the best fix and give the before/after numbers.";
  // Consume before the first network call. If storage is disabled, removing the
  // command from this history entry still prevents a refresh from replaying it.
  if (!writeSession(key, { consumed: new Date().toISOString() })) {
    current.searchParams.delete("ask"); current.searchParams.delete("auto");
  }
  history.replaceState(history.state, "", current.href);
  return { id, instruction, voice: params.get("voice") === "1" };
}

// Sites loaded with "Load file" during this session, kept per portfolio so the
// map and the 3D page (action plan address, list of sites) still know them.
const uploadsKey = (indexUrl) => `uploads:${absoluteUrl(indexUrl)}`;
export function rememberUpload(indexUrl, entry) {
  const list = readSession(uploadsKey(indexUrl), []).filter((e) => e.site_id !== entry.site_id);
  return writeSession(uploadsKey(indexUrl), [...list, entry]);
}
export function withUploads(indexUrl, index) {
  const known = new Set(index.sites.map((s) => s.site_id));
  const extra = readSession(uploadsKey(indexUrl), []).filter((e) => e && typeof e.twin === "string" && !known.has(e.site_id));
  return { ...index, sites: [...index.sites, ...extra] };
}
