// Evaluate the specified CSS timing curves in the single scene animation loop.
export function bezier(x1, y1, x2, y2) {
  const at = (t, a, b) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 14; i++) { if (at(t, x1, x2) < x) lo = t; else hi = t; t = (lo + hi) / 2; }
    return at(t, y1, y2);
  };
}
export const standardEase = bezier(.2, 0, 0, 1);
export const travelEase = bezier(.22, 1, .36, 1);
export const shortestAngle = (from, to) => (((to - from) % 360 + 540) % 360) - 180;
