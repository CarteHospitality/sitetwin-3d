"""Neighbouring buildings from OpenStreetMap (Overpass API).

Real footprints, storeys and uses (schools, hospitals...) around a site, in the
twin's local frame: metres from the site, x = East, z = South. Heights come from
`height` or `building:levels`; when OSM has neither, a typical urban value is
assumed and marked. Responses are cached under output/cache/osm/.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from pathlib import Path

import httpx

from .schema import Neighbour

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
CACHE_DIR = Path("output/cache/osm")
STOREY_M = 3.0
ASSUMED_STOREYS = 5  # typical Turkish urban apartment block when OSM has no levels

USE_TAGS = {
    "school": "school", "college": "school", "university": "school",
    "kindergarten": "kindergarten", "childcare": "kindergarten",
    "hospital": "hospital", "clinic": "hospital", "doctors": "hospital",
    "office": "office", "commercial": "commercial", "retail": "commercial",
    "apartments": "residential", "residential": "residential", "house": "residential", "detached": "residential",
}


def dms_to_deg(dms: str) -> float:
    """'N 36° 59' 12,34''' -> 36.986..."""
    m = re.match(r"\s*([NSEW])\s*(\d+)\s*°\s*(\d+)\s*'\s*([\d.,]+)", dms)
    if not m:
        raise ValueError(f"unrecognised DMS: {dms!r}")
    hemi, d, mnt, s = m.groups()
    deg = int(d) + int(mnt) / 60 + float(s.replace(",", ".")) / 3600
    return -deg if hemi in "SW" else deg


def _query(lat: float, lon: float, radius_m: int) -> dict:
    q = f"""[out:json][timeout:25];
way["building"](around:{radius_m},{lat:.6f},{lon:.6f});
out tags geom;"""
    key = hashlib.sha1(q.encode()).hexdigest()
    cache = CACHE_DIR / f"{key}.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    r = httpx.post(OVERPASS_URL, data={"data": q}, timeout=60, headers={"User-Agent": "sitetwin-3d (hackathon prototype)"})
    r.raise_for_status()
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(r.text, encoding="utf-8")
    return r.json()


def _point_in_polygon(x: float, z: float, poly: list[tuple[float, float]]) -> bool:
    inside = False
    for (x1, z1), (x2, z2) in zip(poly, poly[1:] + poly[:1]):
        if (z1 > z) != (z2 > z) and x < (x2 - x1) * (z - z1) / (z2 - z1) + x1:
            inside = not inside
    return inside


def _use(tags: dict) -> str:
    for key in ("amenity", "building", "healthcare"):
        if tags.get(key) in USE_TAGS:
            return USE_TAGS[tags[key]]
    return "residential" if tags.get("building") in ("yes", None) else "other"


def buildings_around(lat: float, lon: float, radius_m: int = 150) -> tuple[Neighbour | None, list[Neighbour], list[str]]:
    """Return (the building the site stands on, its neighbours, notes)."""
    data = _query(lat, lon, radius_m)
    kx = 111_320 * math.cos(math.radians(lat))
    kz = 110_540
    host, others, assumed = None, [], 0
    for el in data.get("elements", []):
        geom = el.get("geometry") or []
        if len(geom) < 3:
            continue
        poly = [((g["lon"] - lon) * kx, -(g["lat"] - lat) * kz) for g in geom]
        if poly[0] == poly[-1]:
            poly = poly[:-1]
        tags = el.get("tags", {})
        storeys = None
        if tags.get("building:levels", "").strip().isdigit():
            storeys = int(tags["building:levels"])
        height = None
        try:
            height = float(str(tags.get("height", "")).replace("m", "").strip())
        except ValueError:
            pass
        if height is None:
            if storeys is None:
                storeys, assumed = ASSUMED_STOREYS, assumed + 1
            height = storeys * STOREY_M
        xs, zs = [p[0] for p in poly], [p[1] for p in poly]
        n = Neighbour(
            id=tags.get("name") or f"OSM {el['id']}",
            x_m=round(sum(xs) / len(xs), 1), z_m=round(sum(zs) / len(zs), 1),
            width_m=round(max(xs) - min(xs), 1), depth_m=round(max(zs) - min(zs), 1),
            height_m=round(height, 1), use=_use(tags), storeys=storeys,
            footprint=[(round(x, 2), round(z, 2)) for x, z in poly],
        )
        if host is None and _point_in_polygon(0.0, 0.0, poly):
            host = n
        else:
            others.append(n)
    notes = [f"Neighbouring buildings from OpenStreetMap ({len(others)} within {radius_m} m)."]
    if assumed:
        notes.append(f"{assumed} OSM buildings have no height or levels; {ASSUMED_STOREYS} storeys assumed.")
    return host, others, notes
