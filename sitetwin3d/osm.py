"""What stands around a site: footprints, heights and uses of nearby buildings.

Footprints come from Microsoft's building footprints (msbuildings.py), which
cover Turkish cities well, with OpenStreetMap buildings as a fallback. Uses
(school, kindergarten, hospital...) come from OpenStreetMap tags and points of
interest. Everything is returned in the twin's local frame: metres from the
site, x = East, z = South. When neither source gives a height, a typical urban
value is assumed and the notes say how many.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from pathlib import Path

import httpx

from .msbuildings import footprints_around
from .schema import Neighbour

OVERPASS_URLS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
CACHE_DIR = Path("output/cache/osm")
STOREY_M = 3.0
ASSUMED_STOREYS = 5  # typical Turkish urban apartment block
POI_SNAP_M = 15.0

USE_TAGS = {
    "school": "school", "college": "school", "university": "school",
    "kindergarten": "kindergarten", "childcare": "kindergarten",
    "hospital": "hospital", "clinic": "hospital", "doctors": "hospital",
    "office": "office", "commercial": "commercial", "retail": "commercial",
    "apartments": "residential", "residential": "residential", "house": "residential", "detached": "residential",
}
SENSITIVE_AMENITIES = "school|college|university|kindergarten|childcare|hospital|clinic|doctors"


def dms_to_deg(dms: str) -> float:
    """'N 36° 59' 12,34''' -> 36.986..."""
    m = re.match(r"\s*([NSEW])\s*(\d+)\s*°\s*(\d+)\s*'\s*([\d.,]+)", dms)
    if not m:
        raise ValueError(f"unrecognised DMS: {dms!r}")
    hemi, d, mnt, s = m.groups()
    deg = int(d) + int(mnt) / 60 + float(s.replace(",", ".")) / 3600
    return -deg if hemi in "SW" else deg


def _overpass(query: str) -> dict:
    cache = CACHE_DIR / f"{hashlib.sha1(query.encode()).hexdigest()}.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    for url in OVERPASS_URLS:  # public mirrors are often busy; try the next one
        try:
            r = httpx.post(url, data={"data": query}, timeout=90, headers={"User-Agent": "sitetwin-3d/0.1 (hackathon prototype)", "Accept": "*/*"})
            r.raise_for_status()
            break
        except httpx.HTTPError:
            if url == OVERPASS_URLS[-1]:
                raise
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(r.text, encoding="utf-8")
    return r.json()


def _point_in_polygon(x: float, z: float, poly: list[tuple[float, float]]) -> bool:
    inside = False
    for (x1, z1), (x2, z2) in zip(poly, poly[1:] + poly[:1]):
        if (z1 > z) != (z2 > z) and x < (x2 - x1) * (z - z1) / (z2 - z1) + x1:
            inside = not inside
    return inside


class _Frame:
    def __init__(self, lat: float, lon: float):
        self.lat, self.lon = lat, lon
        self.kx = 111_320 * math.cos(math.radians(lat))
        self.kz = 110_540

    def xz(self, lon: float, lat: float) -> tuple[float, float]:
        return (lon - self.lon) * self.kx, -(lat - self.lat) * self.kz


def _osm_use(tags: dict) -> str | None:
    for key in ("amenity", "building", "healthcare"):
        if tags.get(key) in USE_TAGS:
            return USE_TAGS[tags[key]]
    return None


def _osm(frame: _Frame, radius_m: int) -> tuple[list[dict], list[dict]]:
    """OSM building outlines and points of interest with a use."""
    q = f"""[out:json][timeout:60];
way["building"](around:{radius_m},{frame.lat:.6f},{frame.lon:.6f});
out tags geom;
nwr["amenity"~"^({SENSITIVE_AMENITIES})$"](around:{radius_m},{frame.lat:.6f},{frame.lon:.6f});
out tags center;"""
    data = _overpass(q)
    outlines, pois = [], []
    for el in data.get("elements", []):
        tags = el.get("tags", {})
        if el.get("geometry") and "building" in tags:
            outlines.append({"polygon": [(g["lon"], g["lat"]) for g in el["geometry"]], "tags": tags, "id": el["id"]})
        if tags.get("amenity"):
            c = el.get("center") or ({"lat": el["lat"], "lon": el["lon"]} if "lat" in el else None)
            if c:
                pois.append({"xz": frame.xz(c["lon"], c["lat"]), "use": USE_TAGS.get(tags["amenity"], "other"), "name": tags.get("name")})
    return outlines, pois


CONTEXT_M = 400


def context_buildings(lat: float, lon: float, inner_m: int = 150, outer_m: int = CONTEXT_M) -> list[dict]:
    """Buildings between the analysed neighbours and `outer_m`, for the 3D view only.

    Footprints from the same Microsoft source, in the same local frame; each is
    {"footprint": [[x, z], ...], "height_m": h}. The checks never use them, so a
    site's EMF and occupancy results stay those of its `inner_m` neighbours.
    """
    frame = _Frame(lat, lon)
    inner_lat, inner_lon = inner_m / 110_540, inner_m / (111_320 * math.cos(math.radians(lat)))
    out = []
    for f in footprints_around(lat, lon, outer_m):
        lo, la = f["polygon"][0]
        if abs(la - lat) <= inner_lat and abs(lo - lon) <= inner_lon:
            continue  # an analysed neighbour (footprints_around keeps the same first-vertex box)
        poly = []
        for lo, la in f["polygon"]:
            x, z = (round(v * 2) / 2 for v in frame.xz(lo, la))  # half a metre is plenty at this distance
            if not poly or poly[-1] != [x, z]:
                poly.append([x, z])
        if len(poly) > 3 and poly[0] == poly[-1]:
            poly = poly[:-1]
        if len(poly) >= 3:
            out.append({"footprint": poly, "height_m": f["height"] or ASSUMED_STOREYS * STOREY_M})
    return out


def surroundings(lat: float, lon: float, radius_m: int = 150) -> tuple[Neighbour | None, list[Neighbour], list[str]]:
    """Return (the building the site stands on, its neighbours, notes)."""
    frame = _Frame(lat, lon)
    try:
        osm_outlines, pois = _osm(frame, radius_m)
    except httpx.HTTPError:
        osm_outlines, pois, osm_note = [], [], "OpenStreetMap unavailable; building uses unknown."
    else:
        osm_note = None
    ms = footprints_around(lat, lon, radius_m)
    source = "Microsoft building footprints" if ms else "OpenStreetMap"
    raw = [{"polygon": f["polygon"], "height": f["height"], "tags": {}, "id": None} for f in ms] or \
          [{"polygon": o["polygon"], "height": None, "tags": o["tags"], "id": o["id"]} for o in osm_outlines]

    host, others, assumed = None, [], 0
    for i, b in enumerate(raw, 1):
        poly = [frame.xz(lo, la) for lo, la in b["polygon"]]
        if len(poly) > 3 and poly[0] == poly[-1]:
            poly = poly[:-1]
        if len(poly) < 3:
            continue
        tags = b["tags"]
        storeys = int(tags["building:levels"]) if str(tags.get("building:levels", "")).isdigit() else None
        height = b["height"]
        if height is None and storeys is not None:
            height = storeys * STOREY_M
        height_assumed = height is None
        if height_assumed:
            storeys, height, assumed = ASSUMED_STOREYS, ASSUMED_STOREYS * STOREY_M, assumed + 1
        use, name = _osm_use(tags), tags.get("name")
        for p in pois:
            if _point_in_polygon(*p["xz"], poly) or min(math.dist(p["xz"], v) for v in poly) < POI_SNAP_M:
                use, name = p["use"], p["name"] or name
        xs, zs = [p[0] for p in poly], [p[1] for p in poly]
        n = Neighbour(
            id=name or f"B{i:03d}", x_m=round(sum(xs) / len(xs), 1), z_m=round(sum(zs) / len(zs), 1),
            width_m=round(max(xs) - min(xs), 1), depth_m=round(max(zs) - min(zs), 1), height_m=round(height, 1),
            use=use or "residential", storeys=storeys or max(1, round(height / STOREY_M)),
            footprint=[(round(x, 2), round(z, 2)) for x, z in poly], height_assumed=height_assumed,
        )
        if host is None and _point_in_polygon(0.0, 0.0, poly):
            host = n
        else:
            others.append(n)

    notes = [f"Neighbouring buildings: {len(others)} within {radius_m} m from {source}; uses from OpenStreetMap ({len(pois)} schools/health/childcare points)."]
    if assumed:
        notes.append(f"{assumed} buildings have no height in the data; {ASSUMED_STOREYS} storeys ({ASSUMED_STOREYS * STOREY_M:g} m) assumed.")
    if osm_note:
        notes.append(osm_note)
    return host, others, notes
