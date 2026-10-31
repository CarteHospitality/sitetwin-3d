"""Add the 3D context buildings (150-400 m) to twins that were imported without them.

    python scripts/add_context.py viewer/data/samples/portfolio.json
    python scripts/add_context.py viewer/data/private/portfolio.json

Only the twin's `context` block is written; the analysed neighbours, the plan and
every check stay as they were. Footprints come from the Microsoft dataset (cached
under data/cache after the first download).
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sitetwin3d.osm import context_buildings  # noqa: E402


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("portfolio", type=Path, help="portfolio.json; twin paths in it are relative to viewer/")
    p.add_argument("--web-root", type=Path, default=Path("viewer"))
    args = p.parse_args()
    for entry in json.loads(args.portfolio.read_text(encoding="utf-8"))["sites"]:
        path = args.web_root / entry["twin"]
        raw = path.read_text(encoding="utf-8")
        twin = json.loads(raw)
        twin["context"] = context_buildings(entry["lat"], entry["lon"])
        # Keep the file's own layout (compact from the portfolio importer, indented from the CLI).
        path.write_text(json.dumps(twin, ensure_ascii=False, indent=2 if raw.startswith("{\n") else None), encoding="utf-8")
        print(f"{entry['site_id']}: {len(twin['context'])} context buildings")


if __name__ == "__main__":
    main()
