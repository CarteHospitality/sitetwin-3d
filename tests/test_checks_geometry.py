"""The checks scan a building's whole footprint, and a hospital above 3 V/m counts as a hit building."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")


def run(script: str) -> dict:
    head = """
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
const root = process.argv[1];
const emf = await import(pathToFileURL(root + "/viewer/emf.js").href);
const { checkSite } = await import(pathToFileURL(root + "/viewer/checks.js").href);
"""
    out = subprocess.run(["node", "--input-type=module", "-e", head + script, str(ROOT)], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def test_the_whole_footprint_is_scanned_when_its_corners_crowd_one_end():
    # A long block whose corners crowd its far end: the mean of the corners lies 5 m past the
    # middle, so a scan centred on it started beyond the zone and missed the near end, the only
    # part inside the zone.
    result = run("""
const band = { name: "L1800", frequency_mhz: 1800, tx_power_w: 40, gain_dbi: 17.5, horizontal_beamwidth_deg: 65, vertical_beamwidth_deg: 7, front_to_back_db: 25 };
const at = { x_m: 0, z_m: 0, height_agl_m: 30, length_m: 1.5, bands: [band] };
const antenna = { id: "S1-1", ...at, azimuth_deg: emf.azimuthTo(at, 50, 0) };   // looking along +x
const front = emf.safetyZone(antenna).front_m;
const x0 = front - 3, x1 = front + 20;
const footprint = [[x0, -2], [x1, -2], [x1, -1], [x1, 0], [x1, 1], [x1, 2], [x0, 2]];
const xs = footprint.map((p) => p[0]);
const b = { id: "B1", use: "residential", height_m: 36, footprint,
  x_m: xs.reduce((s, x) => s + x, 0) / xs.length, z_m: 0, width_m: x1 - x0, depth_m: 4 };
const site = { building: { width_m: 20, depth_m: 16, height_m: 28 }, antennas: [antenna], neighbours: [b] };
const checks = checkSite(site, emf.siteZones(site));
console.log(JSON.stringify({ centredScanStart: b.x_m - b.width_m / 2, front, hit: [...checks.hit] }));
""")
    assert result["centredScanStart"] > result["front"]  # a scan centred on the mean never reached the zone
    assert result["hit"] == ["B1"]


def test_a_hospital_above_3_v_per_m_is_a_hit_building():
    result = run("""
const twin = JSON.parse(readFileSync(root + "/viewer/data/samples/sites/sample-05_bursa.twin.json", "utf8"));
const checks = checkSite(twin.site, emf.siteZones(twin.site));
const health = checks.findings.filter((f) => f.health).map((f) => f.building);
console.log(JSON.stringify({ health, hit: [...checks.hit] }));
""")
    assert result["health"] == ["Hospital 2"]
    assert "Hospital 2" in result["hit"]
