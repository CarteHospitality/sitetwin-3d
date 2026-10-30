// Browser port of sitetwin3d/emf.py so zones update live while planning.
// Same model: far-field point source, exposure ratios summed over bands.
// tests/test_emf_parity.py checks both give the same numbers.

export const REGIMES = {
  tr: { name: "TR single device (20% field)", fieldFraction: 0.2 },
  icnirp: { name: "ICNIRP general public", fieldFraction: 1.0 },
};

export function icnirpPublicPowerDensity(frequencyMhz) {
  if (frequencyMhz < 400) throw new Error("bands below 400 MHz are out of scope");
  return frequencyMhz <= 2000 ? frequencyMhz / 200 : 10;
}

export function eirpW(band) {
  return band.tx_power_w * 10 ** ((band.gain_dbi - (band.feeder_loss_db ?? 0)) / 10);
}

const round2 = (x) => Math.round(x * 100) / 100;
const distance = (terms) => Math.sqrt(terms.reduce((s, t) => s + t, 0) / (4 * Math.PI));

export function safetyZone(antenna, regime = REGIMES.tr) {
  const front = [];
  const back = [];
  for (const band of antenna.bands) {
    const limit = icnirpPublicPowerDensity(band.frequency_mhz) * regime.fieldFraction ** 2;
    const ratio = eirpW(band) / limit;
    front.push(ratio);
    back.push(ratio * 10 ** (-(band.front_to_back_db ?? 25) / 10));
  }
  const hbw = Math.max(0, ...antenna.bands.map((b) => b.horizontal_beamwidth_deg ?? 65));
  const vbw = Math.max(0, ...antenna.bands.map((b) => b.vertical_beamwidth_deg ?? 7));
  const frontM = distance(front);
  return {
    antenna_id: antenna.id,
    regime: regime.name,
    front_m: round2(frontM),
    back_m: round2(distance(back)),
    horizontal_beamwidth_deg: hbw,
    vertical_beamwidth_deg: vbw,
    half_height_m: round2(frontM * Math.tan(((vbw / 2) * Math.PI) / 180) + (antenna.length_m ?? 1.5) / 2),
  };
}

export function siteZones(site, regime = REGIMES.tr) {
  return site.antennas.filter((a) => a.bands.length).map((a) => safetyZone(a, regime));
}

// Azimuth of point (x, z) seen from the antenna; north is -z, east is +x.
export function azimuthTo(antenna, x, z) {
  const deg = (Math.atan2(x - antenna.x_m, -(z - antenna.z_m)) * 180) / Math.PI;
  return (deg + 360) % 360;
}

// Same volume the viewer draws: a horizontal sector slab in front, a small cylinder behind.
export function insideZone(antenna, zone, x, y, z) {
  if (Math.abs(y - antenna.height_agl_m) > zone.half_height_m) return false;
  const r = Math.hypot(x - antenna.x_m, z - antenna.z_m);
  if (r <= zone.back_m) return true;
  if (r > zone.front_m) return false;
  const diff = ((azimuthTo(antenna, x, z) - antenna.azimuth_deg + 540) % 360) - 180;
  return Math.abs(diff) <= zone.horizontal_beamwidth_deg / 2;
}
