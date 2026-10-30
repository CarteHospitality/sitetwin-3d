"""List schools / health facilities in a bounding box (helper for picking sample-site locations).

    python scripts/find_pois.py SOUTH WEST NORTH EAST [amenity]
"""

import sys

import httpx

s, w, n, e = sys.argv[1:5]
amenity = sys.argv[5] if len(sys.argv) > 5 else "school"
q = f'[out:json][timeout:60];nwr["amenity"="{amenity}"]({s},{w},{n},{e});out center tags 20;'
r = httpx.post("https://overpass-api.de/api/interpreter", data={"data": q},
               headers={"User-Agent": "sitetwin-3d/0.1 (hackathon prototype)", "Accept": "*/*"}, timeout=90)
r.raise_for_status()
for el in r.json()["elements"]:
    c = el.get("center") or {"lat": el.get("lat"), "lon": el.get("lon")}
    print(el["type"], round(c["lat"], 5), round(c["lon"], 5), el.get("tags", {}).get("name"))
