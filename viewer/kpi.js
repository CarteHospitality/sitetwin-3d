// Measured network load from an operator's performance export (CSV from the
// OSS: Huawei MAE/U2020, Ericsson ENM, Nokia NetAct, ...), matched to this site's
// sectors and bands. Parsed in the browser only: the file is never uploaded.

// Busy-hour PRB utilisation at which operators typically act (indicative, operator-specific).
export const PRB_BALANCE = 70;
export const PRB_EXPAND = 85;

// Header -> field, first match wins; headers are compared lower-case, Turkish letters
// folded, without punctuation, so English and Turkish exports both work.
const FIELDS = [
  ["prb", (h) => h.includes("prb")],
  ["users", (h) => ["user", "rrc", "kullanici"].some((k) => h.includes(k))],
  ["traffic", (h) => ["traffic", "volume", "trafik"].some((k) => h.includes(k))],
  ["time", (h) => ["time", "hour", "date", "period", "saat", "tarih", "zaman"].some((k) => h.includes(k))],
  ["sector", (h) => h.includes("sector") || h.includes("sektor")],
  ["band", (h) => h.includes("band") || h.includes("layer")],
  ["site", (h) => h.startsWith("site") || h.startsWith("saha")],
  ["cell", (h) => h.includes("cell") || h.includes("hucre")],
];
const fold = (h) => h.toLowerCase().replace(/[çğıöşü]/g, (c) => "cgiosu"["çğıöşü".indexOf(c)]).replace(/[^a-z0-9]/g, "");
// Short band codes common in cell names (L18 = L1800).
const SHORT_BANDS = { L8: "L800", L9: "L900", L18: "L1800", L21: "L2100", L26: "L2600", N7: "N700", N34: "N3400", N35: "N3500", N36: "N3600" };

function splitLine(line, sep) {
  const out = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted; }
    else if (c === sep && !quoted) { out.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function bandOf(text) {
  for (const m of [...String(text).toUpperCase().matchAll(/(?:^|[^A-Z0-9])([LN])(\d{1,4})(?![0-9])/g)].reverse()) {
    const code = `${m[1]}${m[2]}`;
    if (SHORT_BANDS[code]) return SHORT_BANDS[code];
    if (m[2].length >= 3) return code;
  }
  return null;
}
// "S2", "Sector 2", "..._S2_L1800", or a bare trailing digit as in "ADN042_L18_2".
function sectorOf(text) {
  const s = String(text).toUpperCase().trim();
  const m = s.match(/(?:^|[^A-Z0-9])S(?:ECTOR)?[ _-]?(\d)(?![0-9])/) ?? s.match(/^(\d)$/) ?? s.match(/[_-](\d)$/);
  return m ? `S${m[1]}` : null;
}
function number(text, decimalComma) {
  const s = String(text ?? "").replace("%", "").trim();
  if (!s) return null;
  const v = Number(decimalComma ? s.replace(",", ".") : s);
  return Number.isFinite(v) ? v : null;
}

// -> { cells: [{ sector, band, prb_dl_pct, users, traffic_gb, time }], rows, skipped, site_checked }.
// site_checked is false when nothing in the file names this site: matched by sector only.
// One cell per sector and band: its busiest row (the busy hour) when the file is hourly.
export function parseKpi(text, site) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error("The KPI file is empty");
  const sep = [";", "\t", ","].map((s) => [s, lines[0].split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const header = splitLine(lines[0], sep).map(fold);
  const col = {};
  header.forEach((h, i) => { const f = FIELDS.find(([name, test]) => col[name] === undefined && test(h)); if (f) col[f[0]] = i; });
  if (col.prb === undefined) throw new Error("No PRB column in the KPI file: it needs PRB utilisation (%) per cell");
  if (col.cell === undefined && (col.sector === undefined || col.band === undefined)) throw new Error("No cell column in the KPI file: it needs a cell name, or sector and band columns");
  const sectors = new Set(site.antennas.map((a) => a.id.split("-")[0]));
  const id = site.site_id.toUpperCase();
  const body = lines.slice(1).map((line) => splitLine(line, sep));
  // Without a site column, cell names that carry the site id pick this site's rows out of a
  // multi-site export; when no cell name mentions it, the file may belong to another site.
  const named = col.site === undefined && col.cell !== undefined && body.some((v) => String(v[col.cell]).toUpperCase().includes(id));
  const busiest = new Map();
  let rows = 0, skipped = 0;
  for (const v of body) {
    rows++;
    const cellName = col.cell !== undefined ? v[col.cell] : "";
    const siteName = col.site !== undefined ? String(v[col.site]).toUpperCase() : "";
    if (siteName && !(siteName.includes(id) || id.includes(siteName))) { skipped++; continue; }
    if (named && !String(cellName).toUpperCase().includes(id)) { skipped++; continue; }
    const sector = col.sector !== undefined ? sectorOf(v[col.sector]) : sectorOf(cellName);
    const band = col.band !== undefined ? bandOf(v[col.band]) ?? String(v[col.band]).toUpperCase() : bandOf(cellName);
    const prb = number(v[col.prb], sep !== ",");
    if (!sector || !band || !sectors.has(sector) || prb === null || prb < 0 || prb > 100) { skipped++; continue; }
    const key = `${sector} ${band}`;
    if (busiest.has(key) && busiest.get(key).prb_dl_pct >= prb) continue;
    busiest.set(key, { sector, band, prb_dl_pct: Math.round(prb),
      users: col.users !== undefined ? number(v[col.users], sep !== ",") : null,
      traffic_gb: col.traffic !== undefined ? number(v[col.traffic], sep !== ",") : null,
      time: col.time !== undefined ? v[col.time] : null });
  }
  if (!busiest.size) throw new Error(`No row in the KPI file matches this site's sectors (${[...sectors].join(", ")})`);
  const cells = [...busiest.values()].sort((a, b) => b.prb_dl_pct - a.prb_dl_pct);
  return { cells, rows, skipped, site_checked: col.site !== undefined || named };
}

// Cells at or above the load-balancing threshold, busiest first.
export const busyCells = (kpi) => (kpi?.cells ?? []).filter((c) => c.prb_dl_pct >= PRB_BALANCE);
