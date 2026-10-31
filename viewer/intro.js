// Opening: the site is built in front of the engineer. The site building rises first,
// then its neighbours from the nearest outwards and the context around them, then the
// tower and antennas, last the EMF zones. Under two seconds; skipped with reduced motion.

const ease = (t) => 1 - (1 - t) ** 3;

// parts: [{ object, kind, delay, duration }], kind says how the object grows from the ground:
//   "extrude": an extrusion turned upright (height along its local z)
//   "box":     a mesh centred at half its height (grows from its base)
//   "up":      geometry already standing on y = 0 (grows along y)
//   "lift":    keeps its size, rises to its height
//   "grow":    scales up as a whole
export function createIntro(parts, { reducedMotion, onFrame }) {
  for (const p of parts) p.base = { y: p.object.position.y, scale: p.object.scale.clone() };
  function set(p, s) {
    const { object, base } = p, k = Math.max(0.001, s);
    if (p.kind === "extrude") object.scale.z = base.scale.z * k;
    else if (p.kind === "box") { object.scale.y = base.scale.y * k; object.position.y = base.y * k; }
    else if (p.kind === "up") object.scale.y = base.scale.y * k;
    else if (p.kind === "lift") object.position.y = base.y * k;
    else if (p.kind === "grow") object.scale.copy(base.scale).multiplyScalar(k);
  }
  function apply(elapsed) {
    let done = true;
    for (const p of parts) {
      const t = Math.min(1, Math.max(0, (elapsed - p.delay) / p.duration));
      set(p, ease(t));
      if (t < 1) done = false;
    }
    return done;
  }
  return {
    // Before the first frame, so nothing shows at full height and then drops.
    hide: () => apply(-Infinity),
    play() {
      if (reducedMotion.matches) { apply(Infinity); onFrame(); return; }
      const start = performance.now();
      const step = (now) => { const done = apply(now - start); onFrame(); if (!done) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    },
  };
}
