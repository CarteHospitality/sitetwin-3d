"""The optional network_kpi block of a SiteTwin file becomes the twin's measured load."""

import json
from pathlib import Path

from sitetwin3d.importers.sitetwin import network_kpi

SAMPLES = Path(__file__).resolve().parents[1] / "samples" / "sitetwin"


def test_cells_are_normalised_and_busiest_first():
    kpi = network_kpi({"network_kpi": {"source": "OSS", "cells": [
        {"sector": 1, "band": "l800", "prb_dl_pct": 40.4},
        {"sector": "S2", "band": "L1800", "prb_dl_pct": 91, "rrc_users": 252, "busy_hour": "21:00"},
    ]}})
    assert [(c["sector"], c["band"], c["prb_dl_pct"]) for c in kpi["cells"]] == [("S2", "L1800", 91), ("S1", "L800", 40)]
    assert kpi["cells"][0]["users"] == 252 and kpi["cells"][1]["users"] is None
    assert kpi["file"] == "site file" and kpi["site_checked"] is True


def test_unusable_cells_and_blocks_are_ignored():
    assert network_kpi({}) is None
    assert network_kpi({"network_kpi": {"cells": "not a list"}}) is None
    assert network_kpi({"network_kpi": {"cells": [{"sector": "x", "band": "L800", "prb_dl_pct": 50},
                                                  {"sector": 1, "band": "L800", "prb_dl_pct": 140}]}}) is None


def test_every_sample_carries_measured_load_for_its_current_cells():
    for path in sorted(SAMPLES.glob("*.json")):
        doc = json.loads(path.read_text(encoding="utf-8"))
        kpi = network_kpi(doc)
        assert kpi, path.name
        current = {(f"S{a['sector']}", f"{'N' if b['frequency_mhz'] >= 3000 else 'L'}{b['frequency_mhz']:g}")
                   for a in doc["antennas"] if a["action"] != "add" for b in a["bands"]}
        assert {(c["sector"], c["band"]) for c in kpi["cells"]} == current, path.name
