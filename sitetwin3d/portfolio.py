"""Build a portfolio of site twins for the map view.

    python -m sitetwin3d.portfolio SITE_MODEL.json [...] --out viewer/data/private
    python -m sitetwin3d.portfolio --scan DIR --limit 10 --out viewer/data/private

Each SiteTwin file is imported with its real surroundings and written as
`sites/<id>.twin.json`; `portfolio.json` lists the sites with their position
for the map. The checks that colour the map run in the browser (viewer/checks.js),
the same code the 3D planner uses.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from .btk_photo import from_sitetwin as btk_general_view
from .export import build_twin
from .importers.sitetwin import GROUND_STRUCTURES, from_sitetwin, network_kpi
from .osm import context_buildings, dms_to_deg, surroundings


def slug(site_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "_", site_id).strip("_").lower()


def import_site(doc: dict, out_dir: Path, web_root: Path = Path("viewer"), with_surroundings: bool = True,
                anonymize_names: bool = False) -> dict:
    """Import one SiteTwin document, write its twin, return its portfolio entry."""
    site = doc.get("site") or {}
    lat, lon = dms_to_deg(site["latitude_dms"]), dms_to_deg(site["longitude_dms"])
    host, neighbours, notes = surroundings(lat, lon) if with_surroundings else (None, [], [])
    if host is not None and (doc.get("structure") or {}).get("kind") in GROUND_STRUCTURES:
        neighbours.append(host)
        host = None
    if anonymize_names:
        # Public demos should not tie a real, named school or clinic to a fictional EMF problem.
        for i, n in enumerate(neighbours, 1):
            if not re.fullmatch(r"B\d{3}", n.id):
                n.id = f"{n.use.capitalize()} {i}"
    existing, proposed = from_sitetwin(doc, neighbours, host, notes)
    twin = build_twin(proposed)
    twin["baseline"] = existing.model_dump()
    if kpi := network_kpi(doc):
        twin["network_kpi"] = kpi
    # The general-view photo from the site's BTK report; never in public samples (a real site).
    if not anonymize_names and (photo := btk_general_view(doc)):
        twin["overview_photo"] = photo
    if with_surroundings:
        # Lighter buildings around the analysed ones, for the 3D view only.
        twin["context"] = context_buildings(lat, lon)
    path = out_dir / "sites" / f"{slug(doc['site_id'])}.twin.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(twin, ensure_ascii=False), encoding="utf-8")
    actions: dict[str, int] = {}
    for a in doc.get("antennas") or []:
        actions[a.get("action", "?")] = actions.get(a.get("action", "?"), 0) + 1
    app = doc.get("application") or {}
    # The address goes only into the portfolio index, for the field crew's action plan;
    # real portfolios stay in git-ignored folders.
    address = ", ".join(str(site[k]) for k in ("address", "district", "province") if site.get(k))
    return {
        "site_id": doc["site_id"], "lat": round(lat, 6), "lon": round(lon, 6), **({"address": address} if address else {}),
        "structure": proposed.structure, "technology": app.get("technology"), "reason": app.get("reason"),
        "antenna_actions": actions, "twin": path.resolve().relative_to(web_root.resolve()).as_posix(),
    }


def latest_per_site(root: Path) -> list[Path]:
    best: dict[str, Path] = {}
    for p in root.glob("r*/*/site_model/SITE_MODEL.json"):
        try:
            site_id = json.loads(p.read_text(encoding="utf-8"))["site_id"]
        except (ValueError, KeyError):
            continue
        if site_id not in best or p.stat().st_mtime > best[site_id].stat().st_mtime:
            best[site_id] = p
    return sorted(best.values(), key=lambda p: -p.stat().st_mtime)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("files", nargs="*", type=Path)
    p.add_argument("--scan", type=Path, help="SiteTwin work folder to search for SITE_MODEL.json files")
    p.add_argument("--limit", type=int, default=10)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--anonymize-names", action="store_true", help="replace OSM building names (for public sample data)")
    args = p.parse_args()

    files = list(args.files) + (latest_per_site(args.scan) if args.scan else [])
    entries = []
    for f in files[: args.limit]:
        doc = json.loads(f.read_text(encoding="utf-8"))
        try:
            entries.append(import_site(doc, args.out, anonymize_names=args.anonymize_names))
            print(f"{doc['site_id']}: ok ({entries[-1]['structure']})", flush=True)
        except Exception as e:  # one bad file must not stop the portfolio
            print(f"{doc.get('site_id', f)}: FAILED {e}", flush=True)
    (args.out / "portfolio.json").write_text(json.dumps({"sites": entries}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(entries)} sites -> {args.out / 'portfolio.json'}")


if __name__ == "__main__":
    main()
