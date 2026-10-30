// Who is around the site: occupancy per neighbouring building and which
// sector serves it. Used by the Expert Operator for EMF sensitivity and
// capacity reasoning. Estimates are labelled as such everywhere they appear.

import { azimuthTo } from "./emf.js";

// Floor area per person by building use (m² of usable floor area per occupant).
// Residential: ~100 m² flat and ~3.1 people per household (TÜİK average).
const AREA_PER_PERSON = { residential: 100 / 3.1, office: 12, commercial: 10, school: 5, kindergarten: 6, hospital: 15, other: 40 };
const USABLE_SHARE = 0.8;
export const SENSITIVE_USES = new Set(["school", "kindergarten", "hospital"]);

export function occupancy(n) {
  if (n.population != null) return { people: n.population, estimated: false };
  const storeys = n.storeys ?? Math.max(1, Math.round(n.height_m / 3));
  const area = n.width_m * n.depth_m * USABLE_SHARE * storeys;
  return { people: Math.round(area / AREA_PER_PERSON[n.use ?? "residential"]), estimated: true };
}

// Serving antenna per building: the one whose main lobe points closest at it.
function servingAntenna(site, n) {
  let best = null;
  for (const a of site.antennas) {
    if (!a.bands.length) continue;
    const off = Math.abs(((azimuthTo(a, n.x_m, n.z_m) - a.azimuth_deg + 540) % 360) - 180);
    if (!best || off < best.off) best = { id: a.id, off };
  }
  return best && best.off <= 90 ? best.id : null;
}

export function populationContext(site) {
  const buildings = (site.neighbours ?? []).map((n) => {
    const occ = occupancy(n);
    return {
      id: n.id, use: n.use ?? "residential", sensitive: SENSITIVE_USES.has(n.use),
      people: occ.people, estimated: occ.estimated,
      distance_m: Math.round(Math.hypot(n.x_m, n.z_m)), height_m: n.height_m,
      served_by: servingAntenna(site, n),
    };
  });
  const perAntenna = {};
  for (const b of buildings) if (b.served_by) perAntenna[b.served_by] = (perAntenna[b.served_by] ?? 0) + b.people;
  return {
    total_people_nearby: buildings.reduce((s, b) => s + b.people, 0),
    people_per_antenna: perAntenna,
    buildings,
    note: "Occupancy is estimated from floor area and building use unless a known figure is given.",
  };
}
