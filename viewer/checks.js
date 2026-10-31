// Site checks shared by the 3D planner and the portfolio map: which EMF zones
// reach neighbouring buildings (and whether those are sensitive), and how much
// walkable roof sits inside a zone at head height.

import { insideZone, safetyZone, exposureRatio, HEALTH } from "./emf.js";
import { occupancy, SENSITIVE_USES } from "./population.js";

const HEAD_HEIGHT_M = 1.7;

export function pointInPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function roofOf(building) {
  const fp = building.footprint;
  const bounds = fp
    ? { x0: Math.min(...fp.map((p) => p[0])), x1: Math.max(...fp.map((p) => p[0])), z0: Math.min(...fp.map((p) => p[1])), z1: Math.max(...fp.map((p) => p[1])) }
    : { x0: -building.width_m / 2, x1: building.width_m / 2, z0: -building.depth_m / 2, z1: building.depth_m / 2 };
  const contains = (x, z) => (fp ? pointInPolygon(x, z, fp) : x >= bounds.x0 && x <= bounds.x1 && z >= bounds.z0 && z <= bounds.z1);
  return { bounds, contains };
}

// The ground box a building's checks scan: its footprint's bounds when it has one (the importer's
// x_m/z_m is the mean of the corners, which on an irregular block is not the box centre), else the
// centre and size it gives.
function extent(n) {
  if (n.footprint?.length >= 3) {
    const xs = n.footprint.map((p) => p[0]), zs = n.footprint.map((p) => p[1]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  }
  return { x0: n.x_m - n.width_m / 2, x1: n.x_m + n.width_m / 2, z0: n.z_m - n.depth_m / 2, z1: n.z_m + n.depth_m / 2 };
}
// Horizontal distance from a point to the nearest point of that box.
const boxDistance = (e, x, z) => Math.hypot(Math.max(e.x0 - x, 0, x - e.x1), Math.max(e.z0 - z, 0, z - e.z1));
// Sample positions from lo to hi, both edges included, at most 1 m apart.
function samples(lo, hi) {
  const steps = Math.max(1, Math.ceil(hi - lo));
  return Array.from({ length: steps + 1 }, (_, i) => lo + ((hi - lo) * i) / steps);
}
// The points of a building to test, in its footprint when it has one.
function* groundPoints(n) {
  const e = extent(n);
  for (const x of samples(e.x0, e.x1))
    for (const zz of samples(e.z0, e.z1))
      if (!n.footprint || pointInPolygon(x, zz, n.footprint)) yield [x, zz];
}

// The nearest point of a building inside an antenna's zone, in metres from the antenna, or Infinity.
function closestInside(a, z, n) {
  const yLow = a.height_agl_m - z.half_height_m;
  // Skip buildings that are too far away or too low to touch the zone slab.
  if (n.height_m < yLow || boxDistance(extent(n), a.x_m, a.z_m) > z.front_m) return Infinity;
  let closest = Infinity;
  for (const [x, zz] of groundPoints(n))
    for (let y = Math.max(0, Math.floor(yLow)); y <= n.height_m; y += 1)
      if (insideZone(a, z, x, y, zz)) closest = Math.min(closest, Math.hypot(x - a.x_m, y - a.height_agl_m, zz - a.z_m));
  return closest;
}
// Health facilities have their own, stricter limit (3 V/m, see emf.js).
const HEALTH_USES = new Set(["hospital"]);

// Several antennas can each stay below their own limit at a building and still exceed the limit for
// all of them together: their exposure ratios add up, each scaled to that combined limit (in Turkey 70%
// of the ICNIRP field for the total against 20% for one device; one limit under ICNIRP and at 3 V/m).
// The worst point of the building where the sum reaches 1, or null. Of N antennas at the building's
// height, the sum can reach 1 only if one of them gives at least 1/N of it, that is one lies within
// its front x sqrt(N x scale): with none that close the building is skipped. Otherwise all N are
// summed, the far ones too, as their small shares can add up past the limit.
function combinedAt(pairs, n) {
  const near = pairs.filter(({ a, z }) => n.height_m >= a.height_agl_m - z.half_height_m);
  const e = extent(n);
  const close = ({ a, z }) => boxDistance(e, a.x_m, a.z_m) <= z.front_m * Math.sqrt(near.length * (z.combined_scale ?? 1));
  if (near.length < 2 || !near.some(close)) return null;
  const yLow = Math.max(0, Math.floor(Math.min(...near.map(({ a, z }) => a.height_agl_m - z.half_height_m))));
  let worst = 0, at = null;
  for (const [x, zz] of groundPoints(n))
    for (let y = yLow; y <= n.height_m; y += 1) {
      let sum = 0;
      for (const { a, z } of near) sum += exposureRatio(a, z, x, y, zz) * (z.combined_scale ?? 1);
      if (sum > worst) { worst = sum; at = { x, y, z: zz }; }
    }
  if (worst < 1) return null;
  const shares = near.map(({ a, z }) => ({ id: a.id, share: exposureRatio(a, z, at.x, at.y, at.z) * (z.combined_scale ?? 1) })).filter((s) => s.share > 0.02).sort((p, q) => q.share - p.share);
  return { worst, ids: shares.map((s) => s.id) };
}

export function checkSite(s, zones) {
  const byId = Object.fromEntries(s.antennas.map((a) => [a.id, a]));
  const roof = roofOf(s.building);
  const findings = [];
  const hit = new Set();
  for (const z of zones) {
    const a = byId[z.antenna_id];
    for (const n of s.neighbours ?? []) {
      const closest = closestInside(a, z, n);
      if (closest < Infinity) {
        hit.add(n.id);
        const occ = occupancy(n);
        const sensitive = SENSITIVE_USES.has(n.use);
        const who = `${sensitive ? `SENSITIVE ${n.use}, ` : ""}${occ.estimated ? "~" : ""}${occ.people} people`;
        findings.push({ level: "bad", sensitive, use: n.use, antenna: a.id, building: n.id, text: `${a.id} zone reaches ${n.id} [${who}] (${closest.toFixed(1)} m from antenna, zone ${z.front_m} m)` });
      }
    }
    let roofCells = 0;
    const step = 0.5;
    const yHead = s.building.height_m + HEAD_HEIGHT_M;
    const { x0, x1, z0, z1 } = roof.bounds;
    for (let x = x0; x < x1; x += step)
      for (let zz = z0; zz < z1; zz += step)
        if (roof.contains(x + step / 2, zz + step / 2) && insideZone(a, z, x + step / 2, yHead, zz + step / 2)) roofCells++;
    if (roofCells) findings.push({ level: "warn", antenna: a.id, text: `${a.id}: restrict roof access, ${(roofCells * step * step).toFixed(1)} m² of roof is inside the zone at head height` });
  }
  // Antennas together: a building no single zone reaches can still be over the limit.
  const pairs = zones.map((z) => ({ a: byId[z.antenna_id], z }));
  for (const n of (s.neighbours ?? []).filter((b) => !hit.has(b.id))) {
    const combined = combinedAt(pairs, n);
    if (!combined) continue;
    hit.add(n.id);
    const occ = occupancy(n);
    const sensitive = SENSITIVE_USES.has(n.use);
    const who = `${sensitive ? `SENSITIVE ${n.use}, ` : ""}${occ.estimated ? "~" : ""}${occ.people} people`;
    findings.push({ level: "bad", sensitive, combined: true, use: n.use, antenna: combined.ids[0], building: n.id,
      text: `${combined.ids.join(" + ")} together reach ${n.id} [${who}] (${combined.worst.toFixed(2)}x the limit at the worst point, each antenna below it alone)` });
  }
  // A health facility the device zones do not reach can still be above 3 V/m, alone or together.
  const health = s.antennas.filter((x) => x.bands.length).map((a) => ({ a, z: safetyZone(a, HEALTH) }));
  for (const n of (s.neighbours ?? []).filter((b) => HEALTH_USES.has(b.use) && !hit.has(b.id))) {
    const occ = occupancy(n);
    const who = `SENSITIVE ${n.use}, ${occ.estimated ? "~" : ""}${occ.people} people`;
    const single = health.map(({ a, z }) => ({ a, z, closest: closestInside(a, z, n) })).find((h) => h.closest < Infinity);
    // A hospital above 3 V/m counts as a hit building like any other: coloured, counted, labelled.
    if (single) {
      hit.add(n.id);
      findings.push({ level: "bad", sensitive: true, health: true, use: n.use, antenna: single.a.id, building: n.id,
        text: `${single.a.id} field above 3 V/m at ${n.id} [${who}] (${single.closest.toFixed(1)} m from antenna, 3 V/m up to ${single.z.front_m} m)` });
      continue;
    }
    const combined = combinedAt(health, n);
    if (combined) hit.add(n.id);
    if (combined) findings.push({ level: "bad", sensitive: true, health: true, combined: true, use: n.use, antenna: combined.ids[0], building: n.id,
      text: `${combined.ids.join(" + ")} together above 3 V/m at ${n.id} [${who}] (${combined.worst.toFixed(2)}x the 3 V/m level at the worst point, each antenna below it alone)` });
  }
  if (!findings.some((f) => f.level === "bad")) findings.unshift({ level: "ok", text: "No neighbouring building found in an EMF zone" });
  return { findings, hit };
}

// The site's state in one sentence, for card headers and the portfolio list.
export function headline({ findings, hit }) {
  const sensitive = findings.find((f) => f.sensitive);
  if (sensitive?.health) return { level: "bad", text: "Hospital above the 3 V/m health-facility level (screening)" };
  if (sensitive) return { level: "bad", text: `${sensitive.use[0].toUpperCase()}${sensitive.use.slice(1)} inside an EMF zone` };
  if (hit.size) return { level: "bad", text: `EMF zone reaches ${hit.size} building(s)` };
  if (findings.some((f) => f.level === "warn")) return { level: "warn", text: "Roof access must be restricted" };
  return { level: "ok", text: "No building found in an EMF zone" };
}
