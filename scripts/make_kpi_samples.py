"""Write synthetic network KPI exports for the sample sites, to try "Load KPIs".

    python scripts/make_kpi_samples.py   # -> samples/kpi/*.csv

One day of hourly rows per cell of the current network, shaped like a PM export
from an operator's OSS (cell name, time, DL PRB utilisation, RRC users, traffic).
All values are invented.

- portfolio.kpi.csv: all five sample sites in one file, for the portfolio map.
- sample-04_adana.kpi.csv, sample-01_ankara.kpi.csv: one site each, for the 3D page.
  The Ankara file is saved the way Turkish Excel saves CSV (semicolons, decimal
  commas), so both layouts are covered.
"""

import math
import random
from pathlib import Path

OUT = Path("samples/kpi")
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
HEADER = ["Start Time", "Cell Name", "DL PRB Usage Rate (%)", "RRC Connected Users", "Traffic Volume (GB)"]


def daily(hour: int) -> float:
    """Share of the busy-hour load: quiet at night, peak around 21:00."""
    d = (hour - 21) % 24
    d = d - 24 if d > 12 else d
    return 0.18 + 0.82 * math.exp(-d * d / 30)


def rows(site_id: str, rnd: random.Random) -> list[list[float | str]]:
    out = []
    for hour in range(24):
        for (sector, band), peak in SITES[site_id].items():
            prb = min(99.0, peak * daily(hour) * (1 if hour == 21 else rnd.uniform(0.94, 1.0)))
            out.append([f"{DAY} {hour:02d}:00", f"{site_id}_{sector}_{band}", prb, prb * 2.6 * rnd.uniform(0.9, 1.1), prb * 0.47 * rnd.uniform(0.9, 1.1)])
    return out


def busy_hour(site_id: str) -> dict:
    """The `network_kpi` block of a site file: each cell's busiest hour from the same rows."""
    best: dict[str, list] = {}
    for row in rows(site_id, random.Random(site_id)):
        if row[1] not in best or row[2] > best[row[1]][2]:
            best[row[1]] = row
    cells = [{"cell": cell, "sector": int(cell.split("_S")[-1].split("_")[0]), "band": cell.rsplit("_", 1)[1], "busy_hour": t,
              "prb_dl_pct": round(prb, 1), "rrc_users": round(users), "traffic_gb": round(traffic, 1)}
             for t, cell, prb, users, traffic in best.values()]
    return {"source": "OSS PM export, busy hour per cell (synthetic sample)", "period": DAY, "cells": cells}


def write(path: Path, data: list[list[float | str]], sep: str = ",") -> None:
    num = (lambda v: f"{v:.1f}".replace(".", ",")) if sep == ";" else (lambda v: f"{v:.1f}")
    lines = [sep.join(HEADER)] + [sep.join([t, cell, num(prb), f"{users:.0f}", num(traffic)]) for t, cell, prb, users, traffic in data]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(path)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    data = {site_id: rows(site_id, random.Random(site_id)) for site_id in SITES}
    write(OUT / "portfolio.kpi.csv", sorted((r for site in data.values() for r in site), key=lambda r: (r[0], r[1])))
    write(OUT / "sample-04_adana.kpi.csv", data["SAMPLE-04_ADANA"])
    write(OUT / "sample-01_ankara.kpi.csv", data["SAMPLE-01_ANKARA"], sep=";")


if __name__ == "__main__":
    main()
