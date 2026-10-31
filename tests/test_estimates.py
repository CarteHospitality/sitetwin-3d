"""The indicative figures behave as their comments say: load growth, people per building, coverage."""

import json
import math
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")


def run(script: str) -> dict:
    head = """
import { pathToFileURL } from "node:url";
const root = process.argv[1];
const load = (name) => import(pathToFileURL(`${root}/viewer/${name}`).href);
"""
    out = subprocess.run(["node", "--input-type=module", "-e", head + script, str(ROOT)], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def test_load_growth_months():
    r = run("""
const { monthsUntil } = await load("kpi.js");
console.log(JSON.stringify({ idle: monthsUntil(0, 70), half: monthsUntil(50, 70), there: monthsUntil(85, 70) }));
""")
    # An idle cell counts as 1%: a finite, long time, never Infinity.
    assert r["idle"] == round(12 * math.log(70) / math.log(1.2))
    assert r["half"] == round(12 * math.log(70 / 50) / math.log(1.2))
    assert r["there"] == 0


def test_people_come_from_the_footprint_polygon_not_its_rectangle():
    r = run("""
const { occupancy } = await load("population.js");
// An L-shaped block: 20 x 20 m bounding box, 300 m² footprint, three storeys.
const L = [[0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]];
const n = { use: "residential", width_m: 20, depth_m: 20, height_m: 9 };
console.log(JSON.stringify({ polygon: occupancy({ ...n, footprint: L }).people, rectangle: occupancy(n).people, known: occupancy({ ...n, population: 7 }) }));
""")
    per_person = 100 / 3.1
    assert r["polygon"] == round(300 * 0.8 * 3 / per_person)
    assert r["rectangle"] == round(400 * 0.8 * 3 / per_person)
    assert r["known"] == {"people": 7, "estimated": False}


def test_coverage_falls_with_distance_and_off_the_beam():
    r = run("""
const { rsrpAt } = await load("coverage.js");
const { azimuthTo } = await load("emf.js");
const at = { x_m: 0, z_m: 0, height_agl_m: 30, mechanical_tilt_deg: 0, electrical_tilt_deg: 4 };
const antenna = { ...at, azimuth_deg: azimuthTo(at, 0, 500) };   // looking at +z
const band = (f) => ({ name: "B", frequency_mhz: f, tx_power_w: 40, gain_dbi: 17, horizontal_beamwidth_deg: 65, vertical_beamwidth_deg: 7 });
// From where the tilted main beam meets the ground (about 200 m here) outwards; closer in, the
// ground lies under the beam and is weaker, as on a real site.
const along = [200, 300, 400, 600, 800, 1200].map((d) => rsrpAt(antenna, band(1800), 0, d));
const underBeam = rsrpAt(antenna, band(1800), 0, 100) < along[0];
const side = rsrpAt(antenna, band(1800), 400, 0);
// Just below and at 3 GHz: the 5G mid-band carrier spreads its power over 3276 subcarriers, not 1200.
const reShare = rsrpAt(antenna, band(2999), 0, 400) - rsrpAt(antenna, band(3000), 0, 400);
console.log(JSON.stringify({ along, underBeam, side, ahead: rsrpAt(antenna, band(1800), 0, 400), reShare }));
""")
    along = r["along"]
    assert all(a > b for a, b in zip(along, along[1:]))
    assert r["underBeam"]
    assert r["ahead"] - r["side"] > 10
    assert abs(r["reShare"] - 10 * math.log10(3276 / 1200)) < 0.05
