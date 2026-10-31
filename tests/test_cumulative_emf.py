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
    result = run(HEAD + """
const front = emf.safetyZone(antenna("S1-1", 0)).front_m;
// The building's near face at 1.25 x the single zone: each antenna gives (1/1.25)^2 = 0.64 there.
const x = 1.25 * front + 2;
const out = {};
for (const [name, antennas] of [["one", [antenna("S1-1", 0)]], ["two", [antenna("S1-1", 0), antenna("S1-2", 0.4)]]]) {
  const s = site(antennas, x);
  out[name] = checkSite(s, emf.siteZones(s)).findings.filter((f) => f.level === "bad").map((f) => ({ combined: Boolean(f.combined), text: f.text }));
}
console.log(JSON.stringify(out));
""")
    assert result["one"] == []
    assert len(result["two"]) == 1 and result["two"][0]["combined"]
    assert result["two"][0]["text"].startswith("S1-1 + S1-2 together reach B1") or result["two"][0]["text"].startswith("S1-2 + S1-1 together reach B1")


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
