"""Health facilities are checked against 3 V/m, which reaches far beyond the single-device zone."""

import json
import math
import shutil
import subprocess
from pathlib import Path

import pytest

from sitetwin3d.emf import HEALTH_FACILITY, TR_SINGLE_DEVICE, site_zones
from sitetwin3d.schema import SiteModel

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "samples" / "demo-site" / "site.json"
node = pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")


def run_js(script: str, *args: str) -> object:
    out = subprocess.run(["node", "--input-type=module", "-e", script, *args], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def test_health_zone_is_the_3_v_per_m_distance():
    site = SiteModel.model_validate_json(SITE.read_text(encoding="utf-8"))
    for health, device in zip(site_zones(site, HEALTH_FACILITY), site_zones(site, TR_SINGLE_DEVICE)):
        antenna = next(a for a in site.antennas if a.id == health.antenna_id)
        # Far field: E = sqrt(30 * EIRP) / r, summed over bands as power.
        eirp = sum(b.tx_power_w * 10 ** ((b.gain_dbi - b.feeder_loss_db) / 10) for b in antenna.bands)
        assert health.front_m == pytest.approx(math.sqrt(30 * eirp) / 3.0, rel=0.002)
        assert health.front_m > 3 * device.front_m


@node
def test_js_health_zone_matches_python():
    site = SiteModel.model_validate_json(SITE.read_text(encoding="utf-8"))
    js = run_js("""
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const { siteZones, HEALTH } = await import(pathToFileURL(process.argv[1]).href);
console.log(JSON.stringify(siteZones(JSON.parse(readFileSync(process.argv[2], "utf8")), HEALTH)));
""", str(ROOT / "viewer" / "emf.js"), str(SITE))
    for a, b in zip(js, [z.as_dict() for z in site_zones(site, HEALTH_FACILITY)]):
        assert a["front_m"] == pytest.approx(b["front_m"], abs=0.011)


@node
def test_hospital_outside_the_drawn_zone_but_above_3_v_per_m_is_flagged():
    # One antenna pointing east; a hospital 3x the device zone away, in the beam at panel height.
    script = """
import { pathToFileURL } from "node:url";
const root = process.argv[1];
const { siteZones, safetyZone, HEALTH } = await import(pathToFileURL(root + "/viewer/emf.js").href);
const { checkSite, headline } = await import(pathToFileURL(root + "/viewer/checks.js").href);
const antenna = { id: "S1-1", x_m: 0, z_m: 0, height_agl_m: 30, azimuth_deg: 90, length_m: 1.5,
  bands: [{ name: "L1800", frequency_mhz: 1800, tx_power_w: 40, gain_dbi: 17.5, horizontal_beamwidth_deg: 65, vertical_beamwidth_deg: 7, front_to_back_db: 25 }] };
const site = (use, x) => ({ building: { width_m: 20, depth_m: 16, height_m: 28 }, antennas: [antenna],
  neighbours: [{ id: "H1", use, x_m: x, z_m: 0, width_m: 10, depth_m: 10, height_m: 36 }] });
const zone = siteZones(site("hospital", 0))[0], health = safetyZone(antenna, HEALTH);
const x = 3 * zone.front_m + 5;
const out = {};
for (const use of ["hospital", "residential"]) {
  const s = site(use, x), checks = checkSite(s, siteZones(s));
  out[use] = { bad: checks.findings.filter((f) => f.level === "bad").map((f) => ({ health: Boolean(f.health), text: f.text })), headline: headline(checks).text };
}
console.log(JSON.stringify({ zone: zone.front_m, health: health.front_m, x, ...out }));
"""
    result = run_js(script, str(ROOT))
    assert result["zone"] < result["x"] - 5 < result["health"]
    hospital = result["hospital"]
    assert [f["health"] for f in hospital["bad"]] == [True]
    assert hospital["headline"] == "Hospital above the 3 V/m health limit"
    assert "field above 3 V/m at H1" in hospital["bad"][0]["text"]
    # The same building used as housing is outside the device zone: nothing to flag.
    assert result["residential"]["bad"] == []
