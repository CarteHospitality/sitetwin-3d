"""Invented network KPIs for the sample sites, used by make_samples.py.

One day of hourly load per cell of the current network, as an operator's OSS
would record it (DL PRB utilisation, RRC users, traffic); each sample site file
carries the busiest hour of each cell as its `network_kpi` block.
"""

import math
import random

DAY = "2026-10-28"

# Busy-hour PRB per cell (sector, band) -> peak %. Adana's S2 is full although few people
# live in its lobe; Izmir's S3 is full where SiteTwin already plans 5G.
SITES = {
    "SAMPLE-01_ANKARA": {("S1", "L800"): 52, ("S1", "L1800"): 58, ("S1", "L2100"): 47, ("S2", "L800"): 45, ("S2", "L1800"): 50,
                         ("S2", "L2100"): 41, ("S3", "L800"): 68, ("S3", "L1800"): 84, ("S3", "L2100"): 71},
    "SAMPLE-02_IZMIR": {("S1", "L1800"): 61, ("S2", "L1800"): 57, ("S3", "L1800"): 93},
    "SAMPLE-03_ISTANBUL": {("S1", "L800"): 44, ("S1", "L1800"): 52, ("S1", "L2600"): 38, ("S2", "L800"): 49, ("S2", "L1800"): 62,
                           ("S2", "L2600"): 41, ("S3", "L800"): 36, ("S3", "L1800"): 47, ("S3", "L2600"): 33},
    "SAMPLE-04_ADANA": {("S1", "L800"): 48, ("S1", "L1800"): 55, ("S2", "L800"): 76, ("S2", "L1800"): 91, ("S3", "L800"): 39,
                        ("S3", "L1800"): 44},
    "SAMPLE-05_BURSA": {("S1", "L800"): 63, ("S1", "L1800"): 69, ("S1", "L2100"): 78, ("S2", "L800"): 42, ("S2", "L1800"): 48,
                        ("S2", "L2100"): 40, ("S3", "L800"): 35, ("S3", "L1800"): 46, ("S3", "L2100"): 37},
}


def daily(hour: int) -> float:
    """Share of the busy-hour load: quiet at night, peak around 21:00."""
    d = (hour - 21) % 24
    d = d - 24 if d > 12 else d
    return 0.18 + 0.82 * math.exp(-d * d / 30)


def rows(site_id: str, rnd: random.Random) -> list[list[float | str]]:
    """Hourly rows: time, cell name, PRB %, RRC users, traffic GB."""
    out = []
    for hour in range(24):
        for (sector, band), peak in SITES[site_id].items():
            prb = min(99.0, peak * daily(hour) * (1 if hour == 21 else rnd.uniform(0.94, 1.0)))
            out.append([f"{DAY} {hour:02d}:00", f"{site_id}_{sector}_{band}", prb, prb * 2.6 * rnd.uniform(0.9, 1.1), prb * 0.47 * rnd.uniform(0.9, 1.1)])
    return out


def busy_hour(site_id: str) -> dict:
    """The `network_kpi` block of a site file: each cell's busiest hour."""
    best: dict[str, list] = {}
    for row in rows(site_id, random.Random(site_id)):
        if row[1] not in best or row[2] > best[row[1]][2]:
            best[row[1]] = row
    cells = [{"cell": cell, "sector": int(cell.split("_S")[-1].split("_")[0]), "band": cell.rsplit("_", 1)[1], "busy_hour": t,
              "prb_dl_pct": round(prb, 1), "rrc_users": round(users), "traffic_gb": round(traffic, 1)}
             for t, cell, prb, users, traffic in best.values()]
    return {"source": "OSS PM export, busy hour per cell (synthetic sample)", "period": DAY, "cells": cells}
