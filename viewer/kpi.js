// Measured network load: the busy hour of each cell (sector + band), carried in the
// site file as `network_kpi` and copied into the twin by the importer.

// Busy-hour PRB utilisation at which operators typically act (indicative, operator-specific).
export const PRB_BALANCE = 70;
export const PRB_EXPAND = 85;
// Indicative: mobile data traffic per site grows about 20% a year (operator and industry outlooks
// give roughly 15-30%). Used for "what if nothing changes".
export const TRAFFIC_GROWTH = 0.2;
// Months until a load grows from `now` to `target` (0 if it is already there). A load below 1 counts
// as 1: an idle cell would otherwise never grow, and the plan would say "in Infinity years".
export const monthsUntil = (now, target) => (now >= target ? 0 : Math.round((12 * Math.log(target / Math.max(now, 1))) / Math.log(1 + TRAFFIC_GROWTH)));

// How a load figure is labelled: "measured" for an operator export, "sample data" for the synthetic
// demo sites (their source says so), so an invented figure never reads as a measurement.
export const loadTag = (kpi) => (/synthetic/i.test(kpi?.source ?? "") ? "sample data" : "measured");

// The twin's load, busiest cell first, each cell carrying its tag; null when the site file has none.
export function twinKpi(twin) {
  const cells = (twin?.network_kpi?.cells ?? []).filter((c) => typeof c?.sector === "string" && typeof c.band === "string" && Number.isFinite(c.prb_dl_pct));
  const tag = loadTag(twin?.network_kpi);
  return cells.length ? { ...twin.network_kpi, cells: [...cells].sort((a, b) => b.prb_dl_pct - a.prb_dl_pct).map((c) => ({ ...c, tag })) } : null;
}

// Cells at or above the load-balancing threshold, busiest first.
export const busyCells = (kpi) => (kpi?.cells ?? []).filter((c) => c.prb_dl_pct >= PRB_BALANCE);
