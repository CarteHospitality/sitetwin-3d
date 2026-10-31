"""Write synthetic network KPI exports for two sample sites, to try "Load network KPIs".

    python scripts/make_kpi_samples.py   # -> samples/kpi/*.csv

One day of hourly rows per cell, shaped like a PM export from an operator's OSS
(cell name, time, DL PRB utilisation, RRC users, traffic). All values are
invented. The Ankara file is saved the way Turkish Excel saves CSV
(semicolons, decimal commas), so both layouts are covered.
"""

import math
import random
from pathlib import Path

OUT = Path("samples/kpi")
DAY = "2026-10-28"

# Busy-hour PRB per cell (sector, band) -> peak %.
SITES = {
    "SAMPLE-04_ADANA": dict(sep=",", peaks={("S1", "L800"): 48, ("S1", "L1800"): 55, ("S2", "L800"): 76, ("S2", "L1800"): 91,
                                            ("S3", "L800"): 39, ("S3", "L1800"): 44}),
    "SAMPLE-01_ANKARA": dict(sep=";", peaks={("S1", "L800"): 52, ("S1", "L1800"): 58, ("S1", "L2100"): 47, ("S2", "L800"): 45,
                                             ("S2", "L1800"): 50, ("S2", "L2100"): 41, ("S3", "L800"): 68, ("S3", "L1800"): 84,
                                             ("S3", "L2100"): 71}),
}


def daily(hour: int) -> float:
    """Share of the busy-hour load: quiet at night, peak around 21:00."""
    return 0.18 + 0.82 * math.exp(-((hour - 21) % 24 - (24 if (hour - 21) % 24 > 12 else 0)) ** 2 / 30)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    rnd = random.Random(7)
    for site_id, cfg in SITES.items():
        sep = cfg["sep"]
        num = (lambda v: f"{v:.1f}".replace(".", ",")) if sep == ";" else (lambda v: f"{v:.1f}")
        rows = [sep.join(["Start Time", "Cell Name", "DL PRB Usage Rate (%)", "RRC Connected Users", "Traffic Volume (GB)"])]
        for hour in range(24):
            for (sector, band), peak in cfg["peaks"].items():
                prb = min(99.0, peak * daily(hour) * (1 if hour == 21 else rnd.uniform(0.94, 1.0)))
                users = prb * 2.6 * rnd.uniform(0.9, 1.1)
                traffic = prb * 0.47 * rnd.uniform(0.9, 1.1)
                rows.append(sep.join([f"{DAY} {hour:02d}:00", f"{site_id}_{sector}_{band}", num(prb), f"{users:.0f}", num(traffic)]))
        path = OUT / f"{site_id.lower()}.kpi.csv"
        path.write_text("\n".join(rows) + "\n", encoding="utf-8")
        print(path)


if __name__ == "__main__":
    main()
