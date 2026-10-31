// Measured network load: the busy hour of each cell (sector + band), carried in the
// site file as `network_kpi` and copied into the twin by the importer.

// Busy-hour PRB utilisation at which operators typically act (indicative, operator-specific).
export const PRB_BALANCE = 70;
export const PRB_EXPAND = 85;

// The twin's measured load, busiest cell first, or null when the site file has none.
export function twinKpi(twin) {
  const cells = (twin?.network_kpi?.cells ?? []).filter((c) => typeof c?.sector === "string" && typeof c.band === "string" && Number.isFinite(c.prb_dl_pct));
  return cells.length ? { ...twin.network_kpi, cells: [...cells].sort((a, b) => b.prb_dl_pct - a.prb_dl_pct) } : null;
}

// Cells at or above the load-balancing threshold, busiest first.
export const busyCells = (kpi) => (kpi?.cells ?? []).filter((c) => c.prb_dl_pct >= PRB_BALANCE);
