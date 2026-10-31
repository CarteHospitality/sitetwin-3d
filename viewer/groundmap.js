// The ground under the 3D twin: the site from the air (Esri World Imagery) in grey and pale,
// so buildings, EMF zones and coverage stay readable on top. A street map's names grow huge
// and blurred when it lies in 3D; a photo has none. Where a photo tile is missing the
// OpenStreetMap tile is used. Placed in the importer's local frame (sitetwin3d/osm.py
// _Frame): x East, z South, metres from the site.

const ZOOM = 17;   // about 1 m per pixel in Turkey: streets and blocks, no clutter
const SPAN = 5;    // tiles per side, about 1.2 km around the site

const tileLon = (x, n) => (x / n) * 360 - 180;
const tileLat = (y, n) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;

const AERIAL = (x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${ZOOM}/${y}/${x}`;
const STREET = (x, y) => `https://tile.openstreetmap.org/${ZOOM}/${x}/${y}.png`;
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";   // the canvas becomes a WebGL texture: it must stay untainted
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
const loadTile = (x, y) => loadImage(AERIAL(x, y)).catch(() => loadImage(STREET(x, y)));

// -> { canvas, width, depth, x, z } in metres, or null when no tile could be loaded.
export async function groundMap({ lat, lon, wash }) {
  const n = 2 ** ZOOM, rad = (lat * Math.PI) / 180;
  const fx = ((lon + 180) / 360) * n;
  const fy = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  const tx0 = Math.floor(fx) - (SPAN >> 1), ty0 = Math.floor(fy) - (SPAN >> 1);
  const canvas = Object.assign(document.createElement("canvas"), { width: 256 * SPAN, height: 256 * SPAN });
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.filter = "grayscale(1) contrast(0.8) brightness(1.18)";
  const loaded = await Promise.all(Array.from({ length: SPAN * SPAN }, (_, k) => {
    const i = k % SPAN, j = Math.floor(k / SPAN);
    return loadTile(tx0 + i, ty0 + j).then((img) => { ctx.drawImage(img, i * 256, j * 256); return true; }).catch(() => false);
  }));
  if (!loaded.some(Boolean)) return null;
  // Pale wash over the map, in the ground colour: context, not the subject.
  ctx.filter = "none";
  ctx.globalAlpha = 0.5;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const kx = 111_320 * Math.cos(rad), kz = 110_540;
  const x0 = (tileLon(tx0, n) - lon) * kx, x1 = (tileLon(tx0 + SPAN, n) - lon) * kx;
  const zNorth = -(tileLat(ty0, n) - lat) * kz, zSouth = -(tileLat(ty0 + SPAN, n) - lat) * kz;
  return { canvas, width: x1 - x0, depth: zSouth - zNorth, x: (x0 + x1) / 2, z: (zNorth + zSouth) / 2 };
}
