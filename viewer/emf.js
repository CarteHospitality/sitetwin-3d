// Browser port of sitetwin3d/emf.py so zones update live while planning.
// Same model: far-field point source, exposure ratios summed over bands.
// tests/test_emf_parity.py checks both give the same numbers.

// BTK, Elektronik Haberleşme Cihazları Güvenlik Sertifikası Yönetmeliği, Madde 16(2): each device
// may reach 20% of the ICNIRP field strength (b), all of them together 70% (a, the environment limit).
// ICNIRP itself is one limit for the total.
export const REGIMES = {
  tr: { name: "TR single device (20% field)", fieldFraction: 0.2, environmentFraction: 0.7 },
  icnirp: { name: "ICNIRP general public", fieldFraction: 1.0 },
};
// Same regulation, Madde 6(8): devices installed at health facilities must keep the field there below
// 3 V/m so medical devices are not affected. Applied here to health facilities near the site too, as
// a conservative screen. Whatever the band (plane
// wave: S = E² / 377 Ω). The field falls with distance, so this reaches two to four times as far
// as the single-device zone, depending on the band: a hospital outside the drawn zone can still be above it.
export const HEALTH = { name: "Health facility (3 V/m)", fieldVm: 3 };

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
    const limit = regime.fieldVm ? regime.fieldVm ** 2 / 377 : icnirpPublicPowerDensity(band.frequency_mhz) * regime.fieldFraction ** 2;
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
    // What one unit of this zone's exposure ratio is worth against the limit for all antennas together.
    combined_scale: regime.environmentFraction ? (regime.fieldFraction / regime.environmentFraction) ** 2 : 1,
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

// The share of the limit one antenna's field takes at a point (1 = at the limit), in the same
// geometry as insideZone: the main lobe falls off as (front / r)², elsewhere in the slab as
// (back / r)², nothing above or below the slab. Summed over antennas it gives the combined field.
export function exposureRatio(antenna, zone, x, y, z) {
  if (Math.abs(y - antenna.height_agl_m) > zone.half_height_m) return 0;
  const r = Math.max(0.5, Math.hypot(x - antenna.x_m, z - antenna.z_m));
  const diff = ((azimuthTo(antenna, x, z) - antenna.azimuth_deg + 540) % 360) - 180;
  const reach = Math.abs(diff) <= zone.horizontal_beamwidth_deg / 2 ? zone.front_m : zone.back_m;
  return (reach / r) ** 2;
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
