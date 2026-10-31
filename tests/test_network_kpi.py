"""The optional network_kpi block of a SiteTwin file becomes the twin's measured load."""

import json
from pathlib import Path

from sitetwin3d.importers.sitetwin import _band_name, network_kpi

SAMPLES = Path(__file__).resolve().parents[1] / "samples" / "sitetwin"


def test_cells_are_normalised_and_busiest_first():
    kpi = network_kpi({"network_kpi": {"source": "OSS", "cells": [
        {"sector": 1, "band": "l800", "prb_dl_pct": 40.4},
        {"sector": "S2", "band": "L1800", "prb_dl_pct": 91, "rrc_users": 252, "busy_hour": "21:00"},
    ]}})
    assert [(c["sector"], c["band"], c["prb_dl_pct"]) for c in kpi["cells"]] == [("S2", "L1800", 91), ("S1", "L800", 40)]
    assert kpi["cells"][0]["users"] == 252 and kpi["cells"][1]["users"] is None
    assert kpi["source"] == "OSS"


def test_unusable_cells_and_blocks_are_ignored():
    assert network_kpi({}) is None
    assert network_kpi({"network_kpi": {"cells": "not a list"}}) is None
    assert network_kpi({"network_kpi": {"cells": [{"sector": "x", "band": "L800", "prb_dl_pct": 50},
                                                  {"sector": 1, "band": "L800", "prb_dl_pct": 140}]}}) is None


def test_every_sample_carries_measured_load_for_its_current_cells():
    # The site as it stands is the SiteTwin result: every antenna its application keeps or adds.
    for path in sorted(SAMPLES.glob("*.json")):
        doc = json.loads(path.read_text(encoding="utf-8"))
        kpi = network_kpi(doc)
        assert kpi, path.name
        technology = doc["application"].get("technology")
        current = {(f"S{a['sector']}", _band_name(float(b["frequency_mhz"]), technology))
                   for a in doc["antennas"] if a["action"] != "remove" for b in a["bands"]}
        assert {(c["sector"], c["band"]) for c in kpi["cells"]} == current, path.name
