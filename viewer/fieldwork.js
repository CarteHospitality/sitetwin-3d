// Field work order: what a planned change means on the roof or tower.
// Derived from the difference between the baseline and the plan, antenna by
// antenna, plus the site-wide steps every change needs (permits, safety,
// re-measurement). Rules of thumb from site practice; quantities are estimates
// for the work order, not a bill of materials.

const CABLE_SLACK_M = 5;

function antennaWork(before, after) {
  const id = (after ?? before).id;
  const steps = [], materials = [], precautions = [];
  if (!before) {
    const isAau = after.bands.some((b) => b.frequency_mhz >= 3000);
    steps.push(`Install ${after.model ?? (isAau ? "5G AAU" : "antenna")} for ${id} at ${after.height_agl_m} m, azimuth ${after.azimuth_deg}°, tilt ${after.mechanical_tilt_deg}° mech / ${after.electrical_tilt_deg}° elec`);
    steps.push("Route and connect fibre and DC power, ground and weatherproof, commission and verify alarms");
    materials.push(`${isAau ? "AAU" : "Antenna"} (${after.bands.map((b) => b.name).join(", ")})`, "Mounting bracket and clamp kit (free pole position or new pole)",
      `Fibre (CPRI/eCPRI) and DC power cable, about ${Math.round(after.height_agl_m + CABLE_SLACK_M)} m each`, "Grounding kit, weatherproofing kit, cable clamps");
    if (!isAau) materials.push("Remote radio unit(s) and jumpers for the new bands");
    precautions.push("Structural and wind-load check for the added weight and area", "Check DC power, battery backup and transmission capacity for the new radio");
    return { antenna: id, change: "new antenna", steps, materials, precautions };
  }
  if (!after) {
    steps.push(`Lock out and power down ${id}, disconnect and remove antenna, radios and cabling, cap unused ports, update records`);
    precautions.push("Coordinate the RF shutdown with the network operations centre");
    return { antenna: id, change: "removal", steps, materials, precautions };
  }
  const changes = [];
  const dh = +(after.height_agl_m - before.height_agl_m).toFixed(1);
  if (dh > 0) {
    changes.push(`raise ${dh} m`);
    steps.push(`Raise ${id} from ${before.height_agl_m} m to ${after.height_agl_m} m`);
    materials.push(`Pole extension or taller support (+${dh} m) and clamps`, `Longer fibre/DC or feeder runs (about +${Math.ceil(dh + 1)} m per cable)`);
    precautions.push("Structural and wind-load check of the extended support", "Confirm the lightning rod still covers the antenna (protection angle)");
    if (after.height_agl_m > 45) precautions.push("Check civil-aviation height limits for the new top height");
  } else if (dh < 0) {
    changes.push(`lower ${-dh} m`);
    steps.push(`Lower ${id} from ${before.height_agl_m} m to ${after.height_agl_m} m and coil or shorten excess cable correctly`);
    materials.push("Clamps for the new mounting position");
  }
  if (after.azimuth_deg !== before.azimuth_deg) {
    changes.push(`azimuth ${before.azimuth_deg}° → ${after.azimuth_deg}°`);
    steps.push(`Loosen clamps, re-point ${id} to ${after.azimuth_deg}° (±2°) with an antenna alignment tool or digital compass, re-torque`);
  }
  if (after.mechanical_tilt_deg !== before.mechanical_tilt_deg) {
    changes.push(`mech. tilt ${before.mechanical_tilt_deg}° → ${after.mechanical_tilt_deg}°`);
    steps.push(`Set the tilt bracket of ${id} to ${after.mechanical_tilt_deg}° with a digital inclinometer`);
  }
  if (after.electrical_tilt_deg !== before.electrical_tilt_deg) {
    changes.push(`elec. tilt ${before.electrical_tilt_deg}° → ${after.electrical_tilt_deg}°`);
    steps.push(`Set electrical tilt of ${id} to ${after.electrical_tilt_deg}° remotely (RET) from the OSS; manual phase shifter only if there is no RET`);
  }
  if (after.x_m !== before.x_m || after.z_m !== before.z_m) {
    changes.push("move on the roof");
    steps.push(`Move ${id} to its new roof position: new pole base or ballast frame, re-route cables`);
    materials.push("Pole base / ballast frame, cable ladder and clamps for the new route");
    precautions.push("Roof load check at the new position; landlord approval for the new location");
  }
  const prevBands = Object.fromEntries(before.bands.map((b) => [b.name, b]));
  const nextBands = Object.fromEntries(after.bands.map((b) => [b.name, b]));
  for (const [name, b] of Object.entries(nextBands)) {
    if (!prevBands[name]) {
      changes.push(`add ${name}`);
      steps.push(`Add ${name} on ${id}: install and connect the radio or carrier, configure in the OSS`);
      materials.push(`${b.frequency_mhz >= 3000 ? "5G AAU" : "Remote radio unit"} for ${name}, jumpers, diplexer/combiner if ports are shared`);
      precautions.push("Spectrum licence for the band; DC power, battery backup and transmission capacity check");
    } else if (prevBands[name].tx_power_w !== b.tx_power_w) {
      changes.push(`${name} power ${prevBands[name].tx_power_w} → ${b.tx_power_w} W`);
      steps.push(`Change ${name} power on ${id} to ${b.tx_power_w} W in the OSS (no climb)`);
    }
  }
  for (const name of Object.keys(prevBands)) if (!nextBands[name]) {
    changes.push(`remove ${name}`);
    steps.push(`Remove ${name} from ${id}: lock the cells, disconnect or reconfigure the radio`);
  }
  if (!changes.length) return null;
  const climb = steps.some((s) => !/OSS|RET/.test(s));
  return { antenna: id, change: changes.join(", "), steps, materials, precautions, needs_climb: climb };
}

export function fieldWorkOrder(baseline, site, checks) {
  const prev = Object.fromEntries(baseline.antennas.map((a) => [a.id, a]));
  const next = Object.fromEntries(site.antennas.map((a) => [a.id, a]));
  const items = [];
  for (const a of site.antennas) { const w = antennaWork(prev[a.id], a); if (w) items.push(w); }
  for (const a of baseline.antennas) if (!next[a.id]) items.push(antennaWork(a, null));
  if (!items.length) return { items, general: [], summary: "No physical work: the plan equals the baseline." };

  const climb = items.some((i) => i.needs_climb !== false);
  const roof = (checks?.findings ?? []).filter((f) => f.level === "warn");
  const general = [
    "Work permit, landlord notification and access plan; PPE and fall-arrest for work at height",
    "Coordinate RF shutdown of nearby antennas (including other operators on a shared site) while people are in front of them",
    "After the change: update the BTK safety certificate with an on-site EMF measurement, and file as-built photos and parameters",
  ];
  if (!climb) general.splice(0, 2, "Remote change from the OSS; no site visit needed except for the EMF re-measurement");
  if (roof.length) general.push(`Barriers and EMF warning signs on the roof where access must be restricted (${roof.map((f) => f.antenna).join(", ")})`);
  return {
    items, general,
    summary: `${items.length} antenna change(s); ${climb ? "rigging team and site visit needed" : "remote only"}.`,
  };
}
