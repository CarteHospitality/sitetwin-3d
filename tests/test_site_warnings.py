"""What the twin says about gaps in its data: a tower is not a roof, a file without a band or power
is flagged, and a site whose building uses are unknown gets no all-clear for schools and hospitals."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from sitetwin3d.importers.sitetwin import from_sitetwin

ROOT = Path(__file__).resolve().parents[1]
node = pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")


def run(script: str) -> dict:
    head = """
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
const root = process.argv[1];
const load = (name) => import(pathToFileURL(`${root}/viewer/${name}`).href);
const twin = JSON.parse(readFileSync(`${root}/viewer/data/samples/sites/sample-04_adana.twin.json`, "utf8"));
const checks = { findings: [], hit: new Set() }, population = { people_per_antenna: {} };
"""
    out = subprocess.run(["node", "--input-type=module", "-e", head + script, str(ROOT)], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def test_a_tower_site_places_its_antennas_on_the_tower_not_a_roof():
    doc = json.loads((ROOT / "samples" / "sitetwin" / "sample-04_adana.json").read_text(encoding="utf-8"))
    _, proposed = from_sitetwin(doc)
    assumed = next(n for n in proposed.notes if n.startswith("Assumed"))
    assert "antenna positions on the lattice tower (one side per sector)" in assumed
    assert "on the roof" not in assumed


@node
def test_a_file_gap_is_flagged_on_the_site_as_filed_only():
    r = run("""
const { statusLines } = await load("overview.js");
const site = structuredClone(twin.site);
site.antennas[0].bands = [];
site.antennas[1].bands[0].tx_power_w = 0;
site.neighbours = [];
const filed = statusLines(site, checks, population).map((l) => l.text);
const planned = statusLines(site, checks, population, { before: twin.site }).map((l) => l.text);
console.log(JSON.stringify({ filed, planned, first: site.antennas[0].id, second: `${site.antennas[1].id} ${site.antennas[1].bands[0].name}` }));
""")
    assert f"{r['first']} has no band in the site file: it radiates nothing here, check the file" in r["filed"]
    assert f"{r['second']} has no power in the site file (0 W): check the file" in r["filed"]
    assert "No building found within 150 m: check the coordinates, unless the site is rural" in r["filed"]
    # A plan may change bands: the warnings are about the file, so they stay off the plan's lines.
    assert not any("site file" in t or "coordinates" in t for t in r["planned"])


@node
def test_unknown_building_uses_give_no_all_clear_for_schools_and_hospitals():
    r = run("""
const { statusLines, usesUnknown, siteProblem } = await load("overview.js");
const site = structuredClone(twin.site);
site.notes = [...site.notes, "OpenStreetMap unavailable; building uses unknown."];
const hit = { findings: [{ level: "bad", building: "B001", sensitive: false, text: "zone reaches B001" }], hit: new Set(["B001"]) };
console.log(JSON.stringify({
  known: usesUnknown(twin.site), unknown: usesUnknown(site),
  lines: statusLines(site, hit, population).map((l) => l.text),
  problem: siteProblem(checks, population, { unknownUses: true }),
}));
""")
    assert r["known"] is False and r["unknown"] is True
    assert any(t.startswith("Building uses unknown") for t in r["lines"])
    assert not any("No school or hospital" in t for t in r["lines"])
    assert "schools and hospitals are not identified" in r["problem"]
