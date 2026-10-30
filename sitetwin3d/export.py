"""Turn a site model into the twin file the viewer loads (site + EMF zones).

    python -m sitetwin3d.export samples/demo-site/site.json -o viewer/data/site.twin.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .emf import ICNIRP_PUBLIC, TR_SINGLE_DEVICE, site_zones
from .schema import SiteModel

REGIMES = {"tr": TR_SINGLE_DEVICE, "icnirp": ICNIRP_PUBLIC}


def build_twin(site: SiteModel, regime_key: str = "tr") -> dict:
    regime = REGIMES[regime_key]
    return {
        "site": site.model_dump(),
        "regime": regime.name,
        "zones": [z.as_dict() for z in site_zones(site, regime)],
    }


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("site", type=Path)
    p.add_argument("-o", "--out", type=Path, default=Path("viewer/data/site.twin.json"))
    p.add_argument("--regime", choices=REGIMES, default="tr")
    args = p.parse_args()

    site = SiteModel.model_validate_json(args.site.read_text(encoding="utf-8"))
    twin = build_twin(site, args.regime)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(twin, indent=2), encoding="utf-8")
    for z in twin["zones"]:
        print(f"{z['antenna_id']}: front {z['front_m']} m, back {z['back_m']} m")


if __name__ == "__main__":
    main()
