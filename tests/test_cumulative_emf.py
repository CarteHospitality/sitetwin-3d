"""Antennas that each stay below the limit at a building can exceed it together: their ratios add up."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")


def run(script: str) -> dict:
    out = subprocess.run(["node", "--input-type=module", "-e", script, str(ROOT)], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


HEAD = """
import { pathToFileURL } from "node:url";
const root = process.argv[1];
const emf = await import(pathToFileURL(root + "/viewer/emf.js").href);
const { checkSite } = await import(pathToFileURL(root + "/viewer/checks.js").href);
const band = { name: "L1800", frequency_mhz: 1800, tx_power_w: 40, gain_dbi: 17.5, horizontal_beamwidth_deg: 65, vertical_beamwidth_deg: 7, front_to_back_db: 25 };
const antenna = (id, x) => ({ id, x_m: x, z_m: 0, height_agl_m: 30, azimuth_deg: 90, length_m: 1.5, bands: [band] });
const site = (antennas, x) => ({ building: { width_m: 20, depth_m: 16, height_m: 28 }, antennas,
  neighbours: [{ id: "B1", use: "residential", x_m: x, z_m: 0, width_m: 4, depth_m: 4, height_m: 36 }] });
"""


def test_two_antennas_below_the_limit_alone_exceed_it_together():
    # Under ICNIRP one limit holds for the total: two antennas at 0.64 each are over it together.
    # Under the Turkish rule each device has 20% of the ICNIRP field but all together 70%
    # (BTK Güvenlik Sertifikası Yönetmeliği, Madde 16(2)): the same pair stays well inside it.
    result = run(HEAD + """
const out = {};
for (const key of ["icnirp", "tr"]) {
  const regime = emf.REGIMES[key];
  const front = emf.safetyZone(antenna("S1-1", 0), regime).front_m;
  // The building's near face at 1.25 x the single zone: each antenna gives (1/1.25)^2 = 0.64 there.
  const x = 1.25 * front + 2;
  for (const [name, antennas] of [["one", [antenna("S1-1", 0)]], ["two", [antenna("S1-1", 0), antenna("S1-2", 0.4)]]]) {
    const s = site(antennas, x);
    out[`${key}-${name}`] = checkSite(s, emf.siteZones(s, regime)).findings.filter((f) => f.level === "bad").map((f) => ({ combined: Boolean(f.combined), text: f.text }));
  }
}
console.log(JSON.stringify(out));
""")
    assert result["icnirp-one"] == [] and result["tr-one"] == [] and result["tr-two"] == []
    assert len(result["icnirp-two"]) == 1 and result["icnirp-two"][0]["combined"]
    assert " together reach B1 " in result["icnirp-two"][0]["text"]


def test_small_shares_from_far_antennas_count_in_the_sum():
    # One antenna gives 0.8 of the limit at the building, three farther ones 0.21 each: each far one is
    # under 1/N of the limit, yet together they push the building past it (0.8 + 3 x 0.21 = 1.42).
    result = run(HEAD + """
const strong = { ...band, tx_power_w: 200 };
const at = (id, x) => ({ id, x_m: x, z_m: 0, height_agl_m: 30, azimuth_deg: 90, length_m: 1.5, bands: [strong] });
const regime = emf.REGIMES.icnirp;
const front = emf.safetyZone(at("S1-1", 0), regime).front_m;
const face = 1.118 * front;                     // the near antenna's distance to the building's face
const x = face + 2;                             // the building is 4 m wide
const near = at("S1-1", 0), far = [1, 2, 3].map((i) => at(`S2-${i}`, face - 2.2 * front));
const out = {};
for (const [name, antennas] of [["alone", [near]], ["together", [near, ...far]]]) {
  const s = site(antennas, x);
  out[name] = checkSite(s, emf.siteZones(s, regime)).findings.filter((f) => f.level === "bad").map((f) => ({ combined: Boolean(f.combined), text: f.text }));
}
console.log(JSON.stringify(out));
""")
    assert result["alone"] == []
    assert len(result["together"]) == 1 and result["together"][0]["combined"]
    assert "S1-1" in result["together"][0]["text"] and "S2-1" in result["together"][0]["text"]


def test_exposure_ratio_agrees_with_the_drawn_zone():
    result = run(HEAD + """
const a = antenna("S1-1", 0), zone = emf.safetyZone(a);
let disagree = 0, n = 0;
for (let x = -60; x <= 60; x += 1.5) for (let z = -60; z <= 60; z += 1.5) for (const y of [29, 30, 31]) {
  const r = Math.hypot(x, z);
  if (Math.abs(r - zone.front_m) < 0.3 || Math.abs(r - zone.back_m) < 0.3) continue;  // on the edge itself
  n++;
  if (emf.insideZone(a, zone, x, y, z) !== (emf.exposureRatio(a, zone, x, y, z) >= 1)) disagree++;
}
console.log(JSON.stringify({ n, disagree }));
""")
    assert result["n"] > 1000 and result["disagree"] == 0


def test_checks_stay_fast_on_a_sample_site():
    result = run(HEAD + """
import { readFileSync } from "node:fs";
const twin = JSON.parse(readFileSync(root + "/viewer/data/samples/sites/sample-05_bursa.twin.json", "utf8"));
const zones = emf.siteZones(twin.site);
const started = performance.now();
for (let i = 0; i < 20; i++) checkSite(twin.site, zones);
console.log(JSON.stringify({ ms: (performance.now() - started) / 20 }));
""")
    assert result["ms"] < 150
