// The decision card's fixed rule, so the same options always come out in the same order: sensitive
// buildings in a zone, then other buildings, a 3 V/m distance past the checked radius (a health
// facility there would go unseen), heavy coverage loss (how many bands, how much), any coverage loss,
// roof restrictions, the field work (remote before a site visit, fewer people-days), then the smaller change. evaluate_change returns its options in this order too (viewer/agent.js),
// so the operator's "first option" is the card's first.

// Coverage an option loses (every band's lost share, in points) and gains (good-signal km²).
const coverageLost = (r) => (r.coverage_change ?? r.heavy_coverage_loss ?? []).reduce((s, c) => s + Math.max(0, -(c.change_pct ?? 0)), 0);
const coverageGained = (r) => (r.coverage_change ?? []).reduce((s, c) => s + Math.max(0, c.after_km2 - c.before_km2), 0);
function optionScore(r) {
  const sensitive = r.neighbour_conflicts.filter((t) => t.includes("SENSITIVE")).length;
  const loss = r.heavy_coverage_loss ?? [];
  // No visit (a remote change, or no change at all) is no field work.
  const work = !r.field_work?.people || r.field_work.remote ? 0 : r.field_work.people * Math.max(1, r.field_work.days);
  // Heavy losses first, then any loss.
  return [sensitive, r.neighbour_conflicts.length - sensitive, r.health_beyond_check_m ? 1 : 0, loss.length, coverageLost(r), r.roof_restrictions.length, work];
}
// Sorts options ({ label, changes, result }) by the rule; one that failed goes last.
export function byScore(p, q) {
  const bad = (o) => Boolean(o.result?.errors?.length);
  if (bad(p) !== bad(q)) return bad(p) ? 1 : -1;
  if (bad(p)) return 0;
  const a = optionScore(p.result), b = optionScore(q.result);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  // On a tie the smaller change goes first, as the card's rule says (and the operator is told); between
  // changes of one size, the one that adds more area; then the label keeps one order whatever order they came in.
  return changeSize(p) - changeSize(q) || coverageGained(q.result) - coverageGained(p.result) || p.label.localeCompare(q.label);
}
// The size of an option: every parameter it sets (a height, a tilt, a band's power, a band added or
// removed), an added or removed antenna counting one more. Raising alone is smaller than raising and
// lowering the power of three bands, though both are one change of one antenna.
const PARAMS = ["azimuth_deg", "mechanical_tilt_deg", "electrical_tilt_deg", "height_agl_m", "x_m", "z_m"];
export function changeSize(o) {
  return (o.changes ?? []).reduce((n, c) => n + (c.action === "modify" ? 0 : 1) + PARAMS.filter((k) => typeof c[k] === "number").length
    + (c.add_bands?.length ?? 0) + (c.remove_bands?.length ?? 0) + Object.keys(c.band_power_w ?? {}).length, 0);
}
