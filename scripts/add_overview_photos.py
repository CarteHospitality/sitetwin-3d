"""Add the BTK general-view photo to twins that were imported without it.

    python scripts/add_overview_photos.py viewer/data/private/portfolio.json --reports C:/Projelerim/jevbtk/Veriler

Each site's BTK reports are found under --reports by the site code in the file name
(52094_KIRLS -> *KIRLS*.pdf; BTK reports first). Only the twin's `overview_photo` is written.
New imports get the photo by themselves, from the report their SiteTwin file names.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sitetwin3d.btk_photo import first_general_view  # noqa: E402


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("portfolio", type=Path, help="portfolio.json; twin paths in it are relative to viewer/")
    p.add_argument("--reports", type=Path, required=True, help="folder searched for the sites' BTK reports (PDF)")
    p.add_argument("--web-root", type=Path, default=Path("viewer"))
    args = p.parse_args()
    reports = list(args.reports.rglob("*.pdf"))
    for entry in json.loads(args.portfolio.read_text(encoding="utf-8"))["sites"]:
        code = entry["site_id"].split("_")[-1].upper()
        photo = first_general_view([r for r in reports if code in r.name.upper()])
        if not photo:
            print(f"{entry['site_id']}: no general-view photo found")
            continue
        path = args.web_root / entry["twin"]
        raw = path.read_text(encoding="utf-8")
        twin = json.loads(raw)
        twin["overview_photo"] = photo
        # Keep the file's own layout (compact from the portfolio importer, indented from the CLI).
        path.write_text(json.dumps(twin, ensure_ascii=False, indent=2 if raw.startswith("{\n") else None), encoding="utf-8")
        print(f"{entry['site_id']}: {photo['source']}")


if __name__ == "__main__":
    main()
