"""The browser EMF code (viewer/emf.js) must agree with sitetwin3d/emf.py."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from sitetwin3d.emf import site_zones
from sitetwin3d.schema import SiteModel

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "samples" / "demo-site" / "site.json"

JS = """
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const { siteZones } = await import(pathToFileURL(process.argv[1]).href);
const site = JSON.parse(readFileSync(process.argv[2], "utf8"));
console.log(JSON.stringify(siteZones(site)));
"""


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_js_matches_python():
    site = SiteModel.model_validate_json(SITE.read_text(encoding="utf-8"))
    out = subprocess.run(
        ["node", "--input-type=module", "-e", JS, str(ROOT / "viewer" / "emf.js"), str(SITE)],
        capture_output=True, text=True, check=True,
    ).stdout
    js_zones = json.loads(out)
    py_zones = [z.as_dict() for z in site_zones(site)]
    assert len(js_zones) == len(py_zones)
    for js, py in zip(js_zones, py_zones):
        for key in ("front_m", "back_m", "half_height_m"):
            assert js[key] == pytest.approx(py[key], abs=0.011), (py["antenna_id"], key)
