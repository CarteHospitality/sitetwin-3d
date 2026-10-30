// Site checks shared by the 3D planner and the portfolio map: which EMF zones
// reach neighbouring buildings (and whether those are sensitive), and how much
// walkable roof sits inside a zone at head height.

import { insideZone } from "./emf.js";
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

export function checkSite(s, zones) {
  const byId = Object.fromEntries(s.antennas.map((a) => [a.id, a]));
  const roof = roofOf(s.building);
  const findings = [];
  const hit = new Set();
  for (const z of zones) {
    const a = byId[z.antenna_id];
    const yLow = a.height_agl_m - z.half_height_m;
    for (const n of s.neighbours ?? []) {
      // Skip buildings that are too far away or too low to touch the zone slab.
      if (n.height_m < yLow || Math.hypot(n.x_m - a.x_m, n.z_m - a.z_m) - Math.hypot(n.width_m, n.depth_m) / 2 > z.front_m) continue;
      let closest = Infinity;
      for (let x = n.x_m - n.width_m / 2; x <= n.x_m + n.width_m / 2; x += 1)
        for (let zz = n.z_m - n.depth_m / 2; zz <= n.z_m + n.depth_m / 2; zz += 1) {
          if (n.footprint && !pointInPolygon(x, zz, n.footprint)) continue;
          for (let y = Math.max(0, Math.floor(yLow)); y <= n.height_m; y += 1)
            if (insideZone(a, z, x, y, zz)) closest = Math.min(closest, Math.hypot(x - a.x_m, y - a.height_agl_m, zz - a.z_m));
        }
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
  if (!findings.some((f) => f.level === "bad")) findings.unshift({ level: "ok", text: "No EMF zone reaches a neighbouring building" });
  return { findings, hit };
}

// The site's state in one sentence, for card headers and the portfolio list.
export function headline({ findings, hit }) {
  const sensitive = findings.find((f) => f.sensitive);
  if (sensitive) return { level: "bad", text: `${sensitive.use[0].toUpperCase()}${sensitive.use.slice(1)} inside an EMF zone` };
  if (hit.size) return { level: "bad", text: `EMF zone reaches ${hit.size} building(s)` };
  if (findings.some((f) => f.level === "warn")) return { level: "warn", text: "Roof access must be restricted" };
  return { level: "ok", text: "No EMF zone reaches a building" };
}
