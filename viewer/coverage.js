// Indicative coverage: approximate RSRP on the ground around the site.
// Okumura-Hata below 1500 MHz, COST-231 Hata above (extrapolated past 2 GHz),
// 3GPP-style parabolic antenna patterns. Good for comparing plans side by side,
// not a substitute for a planning tool with terrain and clutter data.

import { azimuthTo } from "./emf.js";

const MOBILE_HEIGHT_M = 1.5;
// Total power -> per-resource-element power for a 20 MHz LTE carrier (1200 subcarriers).
const RE_SHARE_DB = 10 * Math.log10(1200);

function pathLossDb(fMhz, hb, dKm) {
  const lf = Math.log10(fMhz);
  const ahm = (1.1 * lf - 0.7) * MOBILE_HEIGHT_M - (1.56 * lf - 0.8);
  const slope = (44.9 - 6.55 * Math.log10(hb)) * Math.log10(dKm);
  if (fMhz < 1500) return 69.55 + 26.16 * lf - 13.82 * Math.log10(hb) - ahm + slope;
  return 46.3 + 33.9 * lf - 13.82 * Math.log10(hb) - ahm + slope;
}

function patternLossDb(antenna, band, x, z, dM) {
  const off = ((azimuthTo(antenna, x, z) - antenna.azimuth_deg + 540) % 360) - 180;
  const h = Math.min(12 * (off / band.horizontal_beamwidth_deg) ** 2, 25);
  const elevation = (Math.atan2(antenna.height_agl_m - MOBILE_HEIGHT_M, dM) * 180) / Math.PI;
  const tilt = antenna.mechanical_tilt_deg + antenna.electrical_tilt_deg;
  const v = Math.min(12 * ((elevation - tilt) / band.vertical_beamwidth_deg) ** 2, 20);
  return Math.min(h + v, 25);
}

export function rsrpAt(antenna, band, x, z) {
  const dM = Math.max(Math.hypot(x - antenna.x_m, z - antenna.z_m), 20);
  const txDbm = 10 * Math.log10(band.tx_power_w * 1000);
  return (
    txDbm - RE_SHARE_DB + band.gain_dbi - (band.feeder_loss_db ?? 0) -
    patternLossDb(antenna, band, x, z, dM) -
    pathLossDb(band.frequency_mhz, antenna.height_agl_m, dM / 1000)
  );
}

// Best-server RSRP for one band (by name) on an n x n grid of `size` metres, and in
// `server` the index (in site.antennas) of the antenna that gives it.
function coverageRow(antenna, band, j, size, n, grid, server, index) {
  const step = size / n;
  const z = -size / 2 + (j + 0.5) * step;
  for (let i = 0; i < n; i++) {
    const x = -size / 2 + (i + 0.5) * step;
    const v = rsrpAt(antenna, band, x, z);
    if (v > grid[j * n + i]) { grid[j * n + i] = v; server[j * n + i] = index; }
  }
}
export function coverageGrid(site, bandName, size = 600, n = 150) {
  const grid = new Float32Array(n * n).fill(-Infinity), server = new Uint8Array(n * n);
  site.antennas.forEach((a, index) => {
    const band = a.bands.find((b) => b.name === bandName);
    if (band) for (let j = 0; j < n; j++) coverageRow(a, band, j, size, n, grid, server, index);
  });
  return { grid, server, n, size };
}

// Display-only scheduling: identical row routine, antenna order, Float32 writes
// and thresholds. Yield between antenna rows; obsolete requests are cancelled.
export async function coverageGridAsync(site, bandName, size = 600, n = 150, { signal } = {}) {
  const grid = new Float32Array(n * n).fill(-Infinity), server = new Uint8Array(n * n);
  let started = performance.now();
  for (const [index, a] of site.antennas.entries()) {
    const band = a.bands.find((b) => b.name === bandName);
    if (!band) continue;
    for (let j = 0; j < n; j++) {
      if (signal?.aborted) throw Object.assign(new Error("Coverage cancelled"), { name: "AbortError" });
      coverageRow(a, band, j, size, n, grid, server, index);
      if (performance.now() - started >= 3) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        started = performance.now();
      }
    }
  }
  return { grid, server, n, size };
}

export const RSRP_BINS = [
  { min: -80, token: "coverage-excellent", label: "≥ −80 dBm · excellent" },
  { min: -90, token: "coverage-good", label: "−90 to <−80 dBm · good" },
  { min: -100, token: "coverage-fair", label: "−100 to <−90 dBm · fair" },
  { min: -110, token: "coverage-weak", label: "−110 to <−100 dBm · weak" },
];

// Who serves where: each cell in the colour of its best server's sector, stronger signal
// more opaque, below the weakest bin transparent. `focus` (an antenna index) shows only
// the area that antenna serves.
const BIN_ALPHA = [0.55, 0.42, 0.28, 0.15];
export function paintBestServer(canvas, { grid, server, n }, colorOf, focus = null) {
  if (canvas.width !== n || canvas.height !== n) throw new Error(`coverage canvas must be ${n}x${n}`);
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(n, n);
  for (let k = 0; k < n * n; k++) {
    const bin = RSRP_BINS.findIndex((b) => grid[k] >= b.min);
    if (bin < 0) continue;
    if (focus !== null && server[k] !== focus) continue;
    const alpha = BIN_ALPHA[bin];
    img.data.set([...colorOf(server[k]), Math.round(255 * alpha)], k * 4);
  }
  ctx.putImageData(img, 0, 0);
}
