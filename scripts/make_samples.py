"""Write five synthetic SiteTwin files (schema jevbtk-digital-site@1) for anyone to try.

    python scripts/make_samples.py   # -> samples/sitetwin/*.json

The antenna configurations are invented. The positions are ordinary dense
urban blocks in Turkish cities, chosen so that the real surrounding buildings
(Microsoft footprints, OpenStreetMap) make each site tell a different story.
They are not real base-station locations.
"""

import json
from pathlib import Path

OUT = Path("samples/sitetwin")


def dms(deg: float, pos: str, neg: str) -> str:
    h = pos if deg >= 0 else neg
    deg = abs(deg)
    d = int(deg)
    m = int((deg - d) * 60)
    s = (deg - d - m / 60) * 3600
    return f"{h} {d}° {m}' {s:05.2f}''".replace(".", ",")


def band(f, w, tilt):
    return {"frequency_mhz": f, "operating_power_w": w, "electrical_tilt_deg": tilt, "gain_dbi": None, "safety_distance_m": None}


def antenna(sector, slot, az, h, bands, action="retain", model="Panel 65deg", mtilt=0):
    return {"sector": sector, "slot": slot, "model": model, "action": action, "height_m": h,
            "azimuth_deg": az, "mechanical_tilt_deg": mtilt, "bands": bands}


SAMPLES = [
    dict(site_id="SAMPLE-01_ANKARA", lat=39.92150, lon=32.82300, kind="rooftop", bh=15.0,
         app=dict(type="revision", technology="4.5G", reason="Low poles on a dense block; the west sector was boosted to 40 W and now faces a school"),
         azimuths=[30, 150, 255],
         antennas=lambda az: [antenna(i + 1, 1, a, 17.5, [band(f, 40 if i == 2 else 20, 4) for f in (800, 1800, 2100)]) for i, a in enumerate(az)]),
    dict(site_id="SAMPLE-02_IZMIR", lat=38.43650, lon=27.14400, kind="rooftop", bh=18.0,
         app=dict(type="revision", technology="5G", reason="1800 removal, 700 and 3600 addition on all sectors"),
         azimuths=[20, 140, 250],
         antennas=lambda az: [a for i, x in enumerate(az) for a in (
             antenna(i + 1, 1, x, 24.0, [band(1800, 20, 4)], action="remove"),
             antenna(i + 1, 1, x, 24.5, [band(700, 40, 2)], action="add", model="Low-band panel"),
             antenna(i + 1, 2, x, 23.5, [band(3600, 3.5, 0)], action="add", model="64T64R AAU"))]),
    dict(site_id="SAMPLE-03_ISTANBUL", lat=40.98400, lon=29.02700, kind="rooftop", bh=21.0,
         app=dict(type="revision", technology="5G", reason="n78 AAU addition in a busy district"),
         azimuths=[0, 120, 240],
         antennas=lambda az: [a for i, x in enumerate(az) for a in (
             antenna(i + 1, 1, x, 24.0, [band(800, 20, 3), band(1800, 20, 3), band(2600, 20, 3)]),
             antenna(i + 1, 2, x, 24.0, [band(3600, 3.5, 0)], action="add", model="64T64R AAU"))]),
    dict(site_id="SAMPLE-04_ADANA", lat=36.99600, lon=35.30000, kind="lattice_tower", bh=None,
         app=dict(type="new", technology="4.5G", reason="Greenfield tower serving a residential edge"),
         azimuths=[60, 180, 300],
         antennas=lambda az: [antenna(i + 1, 1, x, 36.0, [band(800, 40, 6), band(1800, 40, 6)], model="Dual-band panel") for i, x in enumerate(az)]),
    dict(site_id="SAMPLE-05_BURSA", lat=40.19300, lon=29.06000, kind="rooftop", bh=24.0,
         app=dict(type="revision", technology="4.5G", reason="High-rise block with heavy evening traffic"),
         azimuths=[90, 210, 330],
         antennas=lambda az: [antenna(i + 1, 1, x, 28.0, [band(800, 20, 5), band(1800, 30, 5), band(2100, 30, 5)]) for i, x in enumerate(az)]),
]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for s in SAMPLES:
        doc = {
            "schema": "jevbtk-digital-site@1",
            "site_id": s["site_id"],
            "site": {"report_site_code": s["site_id"], "name": "Synthetic sample site", "operator": "DEMO",
                     "latitude_dms": dms(s["lat"], "N", "S"), "longitude_dms": dms(s["lon"], "E", "W")},
            "application": s["app"],
            "sectors": {str(i + 1): {"azimuth_deg": a} for i, a in enumerate(s["azimuths"])},
            "antennas": s["antennas"](s["azimuths"]),
            "structure": {"kind": s["kind"], "building_height_m": s["bh"]},
            "notes": ["Synthetic sample for SiteTwin 3D. Antenna data is invented; the location is an ordinary city block."],
        }
        path = OUT / f"{s['site_id'].lower()}.json"
        path.write_text(json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")
        print(path)


if __name__ == "__main__":
    main()
