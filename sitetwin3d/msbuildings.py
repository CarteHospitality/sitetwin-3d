"""Building footprints from Microsoft's Global ML Building Footprints (open data, ODbL).

Footprints are detected from satellite imagery and cover Turkish cities far
better than OpenStreetMap; some carry an estimated height. The dataset is split
into zoom-9 quadkey tiles; the tile around a site is downloaded once and cached
under output/cache/msbuildings/.
"""

from __future__ import annotations

import csv
import gzip
import json
import math
from pathlib import Path

import httpx

INDEX_URL = "https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv"
CACHE_DIR = Path("output/cache/msbuildings")
ZOOM = 9


def quadkey(lat: float, lon: float, zoom: int = ZOOM) -> str:
    n = 2**zoom
    x = int((lon + 180) / 360 * n)
    s = math.sin(math.radians(lat))
    y = int((0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n)
    key = ""
    for i in range(zoom, 0, -1):
        digit = 0
        mask = 1 << (i - 1)
        if x & mask:
            digit += 1
        if y & mask:
            digit += 2
        key += str(digit)
    return key


def _get(url: str, dest: Path) -> Path:
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        with httpx.stream("GET", url, timeout=600, follow_redirects=True) as r:
            r.raise_for_status()
            with dest.open("wb") as f:
                for chunk in r.iter_bytes():
                    f.write(chunk)
    return dest


def tile_urls(qk: str) -> list[str]:
    index = _get(INDEX_URL, CACHE_DIR / "dataset-links.csv")
    with index.open(encoding="utf-8") as f:
        return [row["Url"] for row in csv.DictReader(f) if row["QuadKey"] == qk]


def footprints_around(lat: float, lon: float, radius_m: float) -> list[dict]:
    """Features ({'polygon': [(lon, lat), ...], 'height': float | None}) near a point."""
    dlat = radius_m / 110_540
    dlon = radius_m / (111_320 * math.cos(math.radians(lat)))
    out = []
    qk = quadkey(lat, lon)
    for url in tile_urls(qk):
        path = _get(url, CACHE_DIR / qk / url.rsplit("/", 1)[-1])
        with gzip.open(path, "rt", encoding="utf-8") as f:
            for line in f:
                feat = json.loads(line)
                geom = feat["geometry"]
                ring = geom["coordinates"][0] if geom["type"] == "Polygon" else geom["coordinates"][0][0]
                lo, la = ring[0]
                if abs(la - lat) > dlat or abs(lo - lon) > dlon:
                    continue
                h = (feat.get("properties") or {}).get("height")
                out.append({"polygon": [tuple(p) for p in ring], "height": h if h and h > 0 else None})
    return out
