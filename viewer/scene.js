// Persistent visual objects. Final model/check results enter sync(); animation
// only changes displayed transforms, never the model or the checker's inputs.
import { el, token, reducedMotion } from "./ui.js";
import { standardEase, travelEase, shortestAngle } from "./motion.js";

// A change applied for the engineer to watch takes this long to move into place.
const SLOW_MS = 2800;
// The scan while the operator works: how far either side it sweeps, its size, one round trip.
const SCAN_REACH_M = 140, SCAN_SPAN_M = 320, SCAN_HEIGHT_M = 45, SCAN_TRAIL_M = 36, SCAN_PERIOD_MS = 4200;
const SCAN_COLOR = "#22D3EE", SCAN_EDGE_COLOR = "#0891B2";

export function createSceneMotion({ THREE: T, scene, renderer, camera, controls, host, building, antennaGroup, zoneGroup, baselineGroup, neighbourMeshes, onEditFrame = () => {} }) {
  const antennas = new Map(), zones = new Map(), baseline = new Map(), tweens = new Map();
  const clearings = new Map();
  let cameraTween = null, selected = null, located = null, finalHit = new Set();
  let looping = false, editPending = false, disposed = false, dirtyShadow = true;
  // Halos around antennas that just changed: { mesh, started, ms }.
  const halos = new Set();
  // The scan sweeping over the site while the operator examines it: { group, started, stopping }.
  let scanner = null;
  let framing = false, profile = null, refreshAfterProfile = false, reducedEffects = false;
  const neighbourOutlines = new Map();
  const panelMaterial = new T.MeshStandardMaterial({ color: token("scene-antenna"), roughness: .8 });
  const poleMaterial = new T.MeshStandardMaterial({ color: token("scene-pole"), roughness: .93 });
  const selectionMaterial = new T.LineBasicMaterial({ color: token("accent") });
  for (const material of [panelMaterial, poleMaterial, selectionMaterial]) material.userData.shared = true;
  const label = el("div", { className: "scene-label", hidden: true });
  const status = el("div", { className: "hud view-status", textContent: "Updating view", hidden: true });
  const tools = el("div", { className: "hud stage-tools" });
  const north = el("span", { className: "north-arrow", textContent: "↑" });
  const scaleLine = el("span", { className: "scale-line" });
  const scaleLabel = el("span");
  const reference = el("div", { className: "hud scene-reference" }, el("div", {}, "N ", north),
    scaleLine, el("div", {}, scaleLabel), el("div", { className: "muted", textContent: "At target plane" }));
  const overview = el("button", { textContent: "Overview" });
  const selection = el("button", { textContent: "Selected antenna", disabled: true });
  tools.append(overview, selection); host.append(label, status, tools, reference);
  status.style.top = "72px";
  controls.minPolarAngle = T.MathUtils.degToRad(25);
  controls.maxPolarAngle = T.MathUtils.degToRad(55);
  controls.enableDamping = false;

  const dispose = (object) => {
    object.removeFromParent();
    object.traverse((node) => {
      node.geometry?.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) if (material && !material.userData.shared) material.dispose();
    });
  };
  function boundary(width, full = false) {
    const points = [], start = full ? 0 : -width / 2, span = full ? Math.PI * 2 : width;
    const count = full ? 48 : Math.max(2, Math.ceil(width / (Math.PI * 2) * 96));
    const point = (angle, y) => new T.Vector3(Math.sin(angle), y, Math.cos(angle));
    for (const y of [-1, 1]) {
      for (let i = 0; i < count; i++) points.push(point(start + span * i / count, y), point(start + span * (i + 1) / count, y));
      if (!full) for (const angle of [start, start + span]) points.push(new T.Vector3(0, y, 0), point(angle, y));
    }
    for (const angle of full ? [0, Math.PI / 2, Math.PI, Math.PI * 1.5] : [start, start + span]) points.push(point(angle, -1), point(angle, 1));
    if (!full) points.push(new T.Vector3(0, -1, 0), new T.Vector3(0, 1, 0));
    return new T.BufferGeometry().setFromPoints(points);
  }
  function envelopeMaterial(back = false) {
    return new T.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: true,
      side: T.DoubleSide, forceSinglePass: true, toneMapped: false,
      uniforms: { tint: { value: new T.Color(token(back ? "emf-back" : "emf-front")) },
        bodyAlpha: { value: back ? .07 : .10 }, edgeAlpha: { value: back ? .22 : .34 } },
      vertexShader: `varying vec3 vNormalView, vEye;
        void main() {
          vec4 p = modelViewMatrix * vec4(position, 1.0);
          vNormalView = normalMatrix * normal; vEye = -p.xyz;
          gl_Position = projectionMatrix * p;
        }`,
      fragmentShader: `uniform vec3 tint; uniform float bodyAlpha, edgeAlpha;
        varying vec3 vNormalView, vEye;
        void main() {
          float f = pow(1.0 - abs(dot(normalize(vNormalView), normalize(vEye))), 2.2);
          gl_FragColor = vec4(tint, mix(bodyAlpha, edgeAlpha, f));
          #include <colorspace_fragment>
        }`,
    });
  }
  function makeZone(width, wire = false, target = false) {
    const group = new T.Group();
    const hbw = T.MathUtils.degToRad(width);
    const lineMat = new T.LineBasicMaterial({ color: token(target ? "accent" : "baseline-wire"), transparent: true, opacity: target ? .65 : .30, depthWrite: false, toneMapped: false });
    const front = wire ? new T.LineSegments(boundary(hbw), lineMat)
      : new T.Mesh(new T.CylinderGeometry(1, 1, 2, 48, 1, false, -hbw / 2, hbw), envelopeMaterial());
    const back = wire ? new T.LineSegments(boundary(hbw, true), lineMat.clone())
      : new T.Mesh(new T.CylinderGeometry(1, 1, 2, 24), envelopeMaterial(true));
    if (!wire) lineMat.dispose();
    group.add(front, back); group.userData = { front, back, width };
    return group;
  }
  function poseZone(group, value) {
    group.position.set(value.x_m, value.height_agl_m, value.z_m);
    group.rotation.y = Math.PI - T.MathUtils.degToRad(value.azimuth_deg);
    group.userData.front.scale.set(value.front_m, value.half_height_m, value.front_m);
    group.userData.back.scale.set(value.back_m, value.half_height_m, value.back_m);
  }
  function makeAntenna(id) {
    const group = new T.Group();
    const pole = new T.Mesh(new T.CylinderGeometry(.06, .06, 1, 8), poleMaterial);
    const panel = new T.Mesh(new T.BoxGeometry(.35, 1, .14), panelMaterial);
    const edge = new T.LineSegments(new T.EdgesGeometry(panel.geometry), selectionMaterial);
    panel.add(edge); edge.visible = false;
    for (const y of [-.32, .32]) {
      const bracket = new T.Mesh(new T.BoxGeometry(.28, .04, .24), poleMaterial);
      bracket.position.set(0, y, -.12); panel.add(bracket);
    }
    const cap = new T.Mesh(new T.BoxGeometry(.35, .025, .14), panelMaterial);
    cap.position.y = .48; panel.add(cap);
    panel.userData.antennaId = id;
    panel.traverse((part) => { if (part.isMesh) { part.castShadow = true; part.userData.antennaId = id; } });
    pole.castShadow = true;
    group.add(pole, panel); group.userData = { pole, panel, edge };
    antennaGroup.add(group); return group;
  }
  function poseAntenna(group, value) {
    const { pole, panel } = group.userData;
    const length = Math.max(.01, value.height_agl_m - building.height_m + value.length_m / 2);
    group.position.set(value.x_m, 0, value.z_m);
    pole.scale.y = length; pole.position.y = building.height_m + length / 2;
    const angle = Math.PI - T.MathUtils.degToRad(value.azimuth_deg);
    panel.position.set(Math.sin(angle) * .2, value.height_agl_m, Math.cos(angle) * .2);
    panel.rotation.set(-T.MathUtils.degToRad(value.mechanical_tilt_deg), angle, 0, "YXZ");
    panel.scale.y = value.length_m;
  }
  const valueOf = (a, z = {}) => ({ x_m: a.x_m, z_m: a.z_m, height_agl_m: a.height_agl_m,
    azimuth_deg: a.azimuth_deg, mechanical_tilt_deg: a.mechanical_tilt_deg, length_m: a.length_m,
    front_m: z.front_m ?? 0, back_m: z.back_m ?? 0, half_height_m: z.half_height_m ?? 0,
    horizontal_beamwidth_deg: z.horizontal_beamwidth_deg ?? 0 });
  function display(id, value) {
    const node = antennas.get(id);
    if (!node) return;
    node.displayed = value; poseAntenna(node.group, value);
    const zone = zones.get(id); if (zone) poseZone(zone.group, value);
  }
  // `slow`: a change applied for the engineer to watch (from the agent or a choice): it moves at a
  // readable pace, and a new antenna comes down from above into its place.
  function sync(site, results, checks, layers, baselineSite, baselineZones, selectedId, { animate = false, slow = false } = {}) {
    selected = selectedId;
    if (!selectedId) located = null;
    selection.disabled = !selected;
    const byId = new Map(results.map((z) => [z.antenna_id, z]));
    const ids = new Set(site.antennas.map((a) => a.id));
    for (const [id, node] of antennas) if (!ids.has(id)) {
      dispose(node.group); antennas.delete(id); tweens.delete(id);
      if (zones.has(id)) { dispose(zones.get(id).group); dispose(zones.get(id).outline); zones.delete(id); }
    }
    for (const a of site.antennas) {
      const value = valueOf(a, byId.get(a.id));
      let node = antennas.get(a.id);
      const fresh = !node;
      if (!node) {
        node = { group: makeAntenna(a.id), displayed: value }; antennas.set(a.id, node);
        if (slow && !reducedMotion.matches) {
          const above = { ...value, height_agl_m: value.height_agl_m + 25 };
          display(a.id, above);
          tweens.set(a.id, { from: above, to: value, started: performance.now(), duration: SLOW_MS });
          node.signature = JSON.stringify(value); node.target = value;
        }
      }
      node.group.userData.edge.visible = a.id === selected;
      let zone = zones.get(a.id);
      if (zone && zone.group.userData.width !== value.horizontal_beamwidth_deg) {
        dispose(zone.group); dispose(zone.outline); zones.delete(a.id); zone = null;
      }
      if (!zone && value.front_m) {
        zone = { group: makeZone(value.horizontal_beamwidth_deg), outline: makeZone(value.horizontal_beamwidth_deg, true, true) };
        zones.set(a.id, zone); zoneGroup.add(zone.group, zone.outline);
      }
      if (zone) {
        zone.group.visible = layers.zones && Boolean(value.front_m);
        // With an antenna selected its zone stays clear and the others fade, so overlapping sectors read apart.
        const faded = selected && a.id !== selected;
        const { front, back } = zone.group.userData;
        front.material.uniforms.bodyAlpha.value = faded ? .025 : a.id === selected ? .12 : .10;
        front.material.uniforms.edgeAlpha.value = faded ? .08 : a.id === selected ? .48 : .34;
        back.material.uniforms.bodyAlpha.value = faded ? .015 : .07;
        back.material.uniforms.edgeAlpha.value = faded ? .05 : .22;
        poseZone(zone.outline, value); zone.outline.visible = false;
      }
      const signature = JSON.stringify(value);
      if (node.signature !== signature) {
        node.signature = signature; node.target = value;
        if (!fresh && animate && !reducedMotion.matches) {
          tweens.set(a.id, { from: { ...node.displayed }, to: value, started: performance.now(), duration: slow ? SLOW_MS : 320 });
        } else { tweens.delete(a.id); display(a.id, value); }
        dirtyShadow = true;
      } else if (fresh) display(a.id, value);
      if (zone) zone.outline.visible = layers.zones && tweens.has(a.id);
    }
    const baseById = new Map(baselineSite.antennas.map((a) => [a.id, a]));
    const baseIds = new Set(baselineZones.map((z) => z.antenna_id));
    for (const [id, group] of baseline) if (!baseIds.has(id)) { dispose(group); baseline.delete(id); }
    for (const z of baselineZones) {
      let group = baseline.get(z.antenna_id);
      if (group && group.userData.width !== z.horizontal_beamwidth_deg) { dispose(group); baseline.delete(z.antenna_id); group = null; }
      if (!group) { group = makeZone(z.horizontal_beamwidth_deg, true); baseline.set(z.antenna_id, group); baselineGroup.add(group); }
      poseZone(group, valueOf(baseById.get(z.antenna_id), z));
    }
    baselineGroup.visible = layers.baseline;
    for (const [id, mesh] of Object.entries(neighbourMeshes)) {
      if (checks.hit.has(id)) {
        clearings.get(id)?.label?.remove(); clearings.delete(id);
        mesh.material.color.set(token("building-hit"));
      } else if (finalHit.has(id)) {
        const old = clearings.get(id); old?.label?.remove();
        clearings.set(id, { started: null, from: mesh.material.color.clone(), label: null });
      }
    }
    finalHit = new Set(checks.hit);
    syncOutlines();
    status.hidden = !tweens.size;
    invalidate();
  }
  function syncOutlines() {
    const affected = [...new Set([located, ...finalHit, ...clearings.keys()].filter((id) => id && neighbourMeshes[id]))].slice(0, 8);
    for (const [id, edge] of neighbourOutlines) if (!affected.includes(id)) { dispose(edge); neighbourOutlines.delete(id); }
    for (const id of affected) {
      let edge = neighbourOutlines.get(id);
      if (!edge) {
        const mesh = neighbourMeshes[id];
        edge = new T.LineSegments(new T.EdgesGeometry(mesh.geometry, 30), new T.LineBasicMaterial({ color: token("building-hit-edge"), toneMapped: false }));
        edge.position.copy(mesh.position); edge.rotation.copy(mesh.rotation);
        scene.add(edge); neighbourOutlines.set(id, edge);
      }
      const clearing = clearings.get(id);
      const settling = clearing && !reducedMotion.matches && (clearing.started === null || performance.now() - clearing.started < 480);
      edge.material.color.set(token(finalHit.has(id) || settling ? "building-hit-edge" : id === located ? "accent" : "scene-edge"));
      edge.visible = !reducedEffects || id === located;
    }
  }
  function project(element, point) {
    const vector = point.clone().project(camera);
    element.hidden = vector.z < -1 || vector.z > 1 || Math.abs(vector.x) > 1 || Math.abs(vector.y) > 1;
    if (element.hidden) return;
    const x = Math.max(8, Math.min(host.clientWidth - element.offsetWidth - 8, (vector.x + 1) / 2 * host.clientWidth));
    const y = Math.max(8, Math.min(host.clientHeight - element.offsetHeight - 8, (1 - vector.y) / 2 * host.clientHeight - 30));
    element.style.transform = `translate(${x}px, ${y}px)`;
  }
  function updateLabels() {
    const origin = controls.target.clone().project(camera);
    const northPoint = controls.target.clone().add(new T.Vector3(0, 0, -10)).project(camera);
    north.style.transform = `rotate(${Math.atan2((northPoint.x - origin.x) * host.clientWidth, (northPoint.y - origin.y) * host.clientHeight) * 180 / Math.PI}deg)`;
    const right = new T.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    right.y = 0; right.normalize();
    const metre = controls.target.clone().add(right).project(camera);
    const pixels = Math.hypot((metre.x - origin.x) * host.clientWidth / 2, (metre.y - origin.y) * host.clientHeight / 2);
    const distance = [.1, .2, .5, 1, 2, 5, 10, 20, 50, 100].reduce((best, value) => Math.abs(value * pixels - 72) < Math.abs(best * pixels - 72) ? value : best, 10);
    scaleLine.style.width = `${distance * pixels}px`; scaleLabel.textContent = `${distance} m`;
    const node = antennas.get(selected);
    if (located && neighbourMeshes[located]) {
      label.textContent = `${located} · ${finalHit.has(located) ? "Conflict" : "No current conflict"}`;
      const box = new T.Box3().setFromObject(neighbourMeshes[located]);
      const point = box.getCenter(new T.Vector3()); point.y = box.max.y;
      project(label, point);
    } else if (node) {
      label.textContent = selected;
      project(label, new T.Vector3(node.displayed.x_m, node.displayed.height_agl_m + node.displayed.length_m / 2, node.displayed.z_m));
    } else label.hidden = true;
    for (const [id, change] of clearings) if (change.label) {
      const box = new T.Box3().setFromObject(neighbourMeshes[id]);
      const point = box.getCenter(new T.Vector3()); point.y = box.max.y;
      project(change.label, point);
    }
  }
  function settleClearing(now) {
    let moving = false;
    for (const [id, change] of clearings) {
      if (tweens.size) { moving = true; continue; }
      if (change.started === null) {
        change.started = now;
      }
      const t = reducedMotion.matches ? 1 : Math.min(1, (now - change.started) / 480);
      neighbourMeshes[id].material.color.copy(change.from).lerp(new T.Color(token("scene-building")), standardEase(t));
      const edge = neighbourOutlines.get(id);
      if (edge) edge.material.color.set(token("building-hit-edge")).lerp(new T.Color(token(id === located ? "accent" : "scene-edge")), standardEase(t));
      if (t === 1 && !change.label) {
        change.label = el("div", { className: "scene-label cleared", textContent: `✓ ${id} · Modelled conflict cleared` });
        host.append(change.label);
      }
      if (reducedMotion.matches) { if (id !== located) change.label.hidden = false; continue; }
      if (now - change.started >= 1380) { change.label.remove(); clearings.delete(id); syncOutlines(); }
      else moving = true;
    }
    return moving;
  }
  function frame(now) {
    if (document.hidden || disposed) { renderer.setAnimationLoop(null); looping = false; return; }
    refreshAfterProfile = false;
    if (editPending) { editPending = false; onEditFrame(); }
    for (const [id, tween] of tweens) {
      const t = reducedMotion.matches ? 1 : Math.min(1, (now - tween.started) / (tween.duration ?? 320)), ease = standardEase(t);
      const value = {};
      for (const key of Object.keys(tween.to)) value[key] = key === "azimuth_deg"
        ? tween.from[key] + shortestAngle(tween.from[key], tween.to[key]) * ease
        : tween.from[key] + (tween.to[key] - tween.from[key]) * ease;
      display(id, t === 1 ? tween.to : value);
      if (t === 1) { tweens.delete(id); if (zones.has(id)) zones.get(id).outline.visible = false; }
      dirtyShadow = true;
    }
    status.hidden = !tweens.size;
    if (cameraTween) {
      const t = reducedMotion.matches ? 1 : Math.min(1, (now - cameraTween.started) / 800), ease = travelEase(t);
      const target = cameraTween.target0.clone().lerp(cameraTween.target1, ease);
      const spherical = new T.Spherical(
        T.MathUtils.lerp(cameraTween.s0.radius, cameraTween.s1.radius, ease),
        T.MathUtils.lerp(cameraTween.s0.phi, cameraTween.s1.phi, ease),
        cameraTween.s0.theta + Math.atan2(Math.sin(cameraTween.s1.theta - cameraTween.s0.theta), Math.cos(cameraTween.s1.theta - cameraTween.s0.theta)) * ease);
      camera.position.copy(target).add(new T.Vector3().setFromSpherical(spherical)); controls.target.copy(target);
      if (t === 1) cameraTween = null;
    }
    const clearing = settleClearing(now);
    for (const halo of halos) {
      const t = (now - halo.started) / halo.ms;
      if (t >= 1) { dispose(halo.mesh); halos.delete(halo); continue; }
      const pulse = (Math.sin(t * Math.PI * 6) + 1) / 2;
      halo.mesh.scale.setScalar(1 + pulse * 0.5);
      halo.mesh.material.opacity = 0.55 * (1 - t) * (0.5 + pulse / 2);
    }
    if (scanner) {
      // Back and forth across the site; fades in, and out once stopped.
      const phase = (now - scanner.started) / SCAN_PERIOD_MS;
      scanner.group.position.x = SCAN_REACH_M * Math.sin(phase * Math.PI * 2);
      // The trail lies behind the line, whichever way it is going.
      scanner.trail.scale.x = Math.cos(phase * Math.PI * 2) >= 0 ? 1 : -1;
      const fade = scanner.stopping ? 1 - (now - scanner.stopping) / 500 : Math.min(1, (now - scanner.started) / 400);
      if (fade <= 0) { for (const t of scanner.textures) t.dispose(); dispose(scanner.group); scanner = null; }
      else { scanner.wall.material.opacity = 0.55 * fade; scanner.trail.material.opacity = 0.5 * fade; scanner.line.material.opacity = 0.95 * fade; }
    }
    framing = true; controls.update(); framing = false;
    // Opaque depth testing remains authoritative. Transparent ordering is approximate.
    const ordered = [...zones.values()].flatMap((zone) => [zone.group.userData.front, zone.group.userData.back])
      .sort((a, b) => b.getWorldPosition(new T.Vector3()).distanceToSquared(camera.position) - a.getWorldPosition(new T.Vector3()).distanceToSquared(camera.position));
    ordered.forEach((mesh, index) => { mesh.renderOrder = index + 1; });
    if (dirtyShadow) { renderer.shadowMap.needsUpdate = true; dirtyShadow = false; }
    renderer.render(scene, camera); updateLabels();
    if (profile) {
      if (profile.previous !== null) profile.frames.push(now - profile.previous);
      profile.previous = now;
      profile.calls = Math.max(profile.calls, renderer.info.render.calls);
      profile.triangles = Math.max(profile.triangles, renderer.info.render.triangles);
      if (now - profile.started >= 20000) finishProfile();
    }
    if (!tweens.size && !halos.size && !scanner && !cameraTween && !clearing && !editPending && !profile && !refreshAfterProfile) { renderer.setAnimationLoop(null); looping = false; }
  }
  function invalidate() { if (!looping && !document.hidden && !disposed) { looping = true; renderer.setAnimationLoop(frame); } }
  function focus(id = null, buildingId = null, snap = false) {
    located = buildingId;
    syncOutlines();
    const bounds = new T.Box3();
    const node = antennas.get(id);
    if (node) {
      bounds.setFromObject(node.group);
      const zone = zones.get(id); if (zone) bounds.union(new T.Box3().setFromObject(zone.outline));
      if (buildingId && neighbourMeshes[buildingId]) bounds.union(new T.Box3().setFromObject(neighbourMeshes[buildingId]));
    } else {
      const roof = building.footprint;
      const width = roof ? Math.max(...roof.map((p) => p[0])) - Math.min(...roof.map((p) => p[0])) : building.width_m;
      const depth = roof ? Math.max(...roof.map((p) => p[1])) - Math.min(...roof.map((p) => p[1])) : building.depth_m;
      bounds.setFromCenterAndSize(new T.Vector3(building.x_m ?? 0, building.height_m / 2, building.z_m ?? 0), new T.Vector3(width, building.height_m, depth));
      for (const object of antennas.values()) bounds.union(new T.Box3().setFromObject(object.group));
      for (const zone of zones.values()) bounds.union(new T.Box3().setFromObject(zone.outline));
    }
    const sphere = bounds.getBoundingSphere(new T.Sphere());
    const vfov = T.MathUtils.degToRad(camera.fov) / 2;
    const fov = Math.min(vfov, Math.atan(Math.tan(vfov) * camera.aspect));
    const distance = Math.max(8, sphere.radius * 1.2 / Math.sin(fov));
    const offset = camera.position.clone().sub(controls.target);
    const s0 = new T.Spherical().setFromVector3(offset);
    const s1 = new T.Spherical(distance, T.MathUtils.degToRad(40), s0.theta);
    cameraTween = { target0: controls.target.clone(), target1: sphere.center, s0, s1, started: performance.now() };
    if (snap || reducedMotion.matches) {
      camera.position.copy(sphere.center).add(new T.Vector3().setFromSpherical(s1)); controls.target.copy(sphere.center); cameraTween = null;
    }
    invalidate();
  }
  function cancelCamera() { cameraTween = null; }
  function finishProfile() {
    if (!profile) return;
    const run = profile; profile = null;
    const sorted = run.frames.sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)] : null;
    const textures = new Set(); let bytes = renderer.shadowMap.enabled ? 1024 * 1024 * 8 : 0;
    scene.traverse((object) => {
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        const texture = material?.map;
        if (texture && !textures.has(texture)) {
          textures.add(texture); const image = texture.image;
          bytes += (image?.width ?? 0) * (image?.height ?? 0) * 4 * (texture.generateMipmaps ? 4 / 3 : 1);
        }
      }
    });
    const report = { frames: sorted.length, p95FrameMs: p95 === null ? null : +p95.toFixed(2),
      peakDrawCalls: run.calls, peakTriangles: run.triangles, estimatedTextureMiB: +(bytes / 1048576).toFixed(2),
      pixelRatio: renderer.getPixelRatio(), complete: performance.now() - run.started >= 19950 };
    if (report.complete && p95 > 22) {
      if (renderer.getPixelRatio() > 1) {
        renderer.setPixelRatio(1); renderer.setSize(host.clientWidth, host.clientHeight);
        report.nextRunPixelRatio = 1;
      } else {
        reducedEffects = true; renderer.shadowMap.enabled = false; syncOutlines();
        report.nextRunEffects = "Shadows and unselected neighbour outlines disabled";
      }
      refreshAfterProfile = true;
    }
    run.resolve(report);
  }
  function startProfile() {
    if (profile) return profile.promise;
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    profile = { promise, resolve, started: performance.now(), previous: null, frames: [], calls: 0, triangles: 0 };
    invalidate(); return promise;
  }
  overview.onclick = () => focus(); selection.onclick = () => focus(selected);
  renderer.domElement.addEventListener("pointerdown", cancelCamera);
  renderer.domElement.addEventListener("wheel", cancelCamera, { passive: true });
  controls.addEventListener("start", cancelCamera);
  controls.addEventListener("change", () => { if (!framing) invalidate(); });
  reducedMotion.addEventListener("change", () => { invalidate(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) finishProfile(); else invalidate(); });
  window.addEventListener("pagehide", (event) => { finishProfile(); if (!event.persisted) { disposed = true; renderer.setAnimationLoop(null); } });
  // A glowing, pulsing halo around each antenna's panel for `ms`: "this is what just changed".
  function highlight(ids, color, ms = 3600) {
    for (const id of ids) {
      const node = antennas.get(id);
      if (!node || reducedMotion.matches) continue;
      const mesh = new T.Mesh(new T.SphereGeometry(3.5, 24, 16), new T.MeshBasicMaterial({ color, transparent: true, opacity: .5, depthWrite: false, toneMapped: false }));
      node.group.userData.panel.add(mesh);
      halos.add({ mesh, started: performance.now(), ms });
    }
    invalidate();
  }
  // A wall of light sweeping over the site, a bright line where it meets the ground and a fading
  // trail behind it: "the site is being examined". Normal blending: added light would vanish on
  // the light ground and buildings of this scene.
  function scan(on) {
    if (!on || reducedMotion.matches) { if (scanner && !scanner.stopping) scanner.stopping = performance.now(); return; }
    if (scanner) { scanner.stopping = null; return; }
    // Cyan, a colour no coverage sector or EMF zone uses, so the scan never reads as part of them.
    const color = new T.Color(SCAN_COLOR), edge = new T.Color(SCAN_EDGE_COLOR);
    // A white-to-clear ramp, drawn along y (the wall: solid at the ground) or x (the trail: solid at the line).
    const ramp = (vertical) => {
      const canvas = document.createElement("canvas");
      canvas.width = vertical ? 2 : 64; canvas.height = vertical ? 64 : 2;
      const paint = canvas.getContext("2d");
      const gradient = vertical ? paint.createLinearGradient(0, 64, 0, 0) : paint.createLinearGradient(64, 0, 0, 0);
      gradient.addColorStop(0, "rgba(255,255,255,1)"); gradient.addColorStop(1, "rgba(255,255,255,0)");
      paint.fillStyle = gradient; paint.fillRect(0, 0, canvas.width, canvas.height);
      return new T.CanvasTexture(canvas);
    };
    const textures = [ramp(true), ramp(false)];
    const glow = (extra = {}) => new T.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: T.DoubleSide, ...extra });
    const wall = new T.Mesh(new T.PlaneGeometry(SCAN_SPAN_M, SCAN_HEIGHT_M), glow({ map: textures[0] }));
    wall.rotation.y = Math.PI / 2;
    wall.position.y = SCAN_HEIGHT_M / 2;
    const line = new T.Mesh(new T.PlaneGeometry(2.4, SCAN_SPAN_M), glow({ color: edge }));
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.6;
    // The trail's own origin sits at the line, so flipping its x scale turns it to the other side.
    const trailGeometry = new T.PlaneGeometry(SCAN_TRAIL_M, SCAN_SPAN_M).translate(-SCAN_TRAIL_M / 2, 0, 0);
    const trail = new T.Mesh(trailGeometry, glow({ map: textures[1] }));
    trail.rotation.x = -Math.PI / 2;
    trail.position.y = 0.5;
    const group = new T.Group();
    group.add(trail, wall, line);
    group.renderOrder = 999;
    for (const mesh of [trail, wall, line]) mesh.renderOrder = 999;
    scene.add(group);
    scanner = { group, wall, line, trail, textures, started: performance.now(), stopping: null };
    invalidate();
  }
  return { sync, focus, invalidate, startProfile, highlight, scan, queueEdit: () => { editPending = true; invalidate(); },
    changedGeometry: () => { dirtyShadow = true; invalidate(); },
    get selectedBuilding() { return located; },
    get animating() { return Boolean(tweens.size || cameraTween); },
    get metrics() { return { drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries, pixelRatio: renderer.getPixelRatio(), rendering: looping }; },
  };
}
