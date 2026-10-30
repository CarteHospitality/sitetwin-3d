"""Merge per-photo observations into a draft site model.

    python -m sitetwin3d.build_site OBS.jsonl --site-id ID -o DRAFT.json

Two parts:
  - Neighbouring buildings come from drone photos, deterministically: compass
    heading + the model's bearing offset + distance give a position; sightings
    of the same building from several photos are merged.
  - The equipment inventory is a text-only reasoning job over all observations,
    done by Muse Spark Open, which also lists what the photos cannot tell us
    (azimuths, heights, power) as questions for the engineer.
"""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI
from pydantic import BaseModel, Field

from .extract import PROVIDERS, PhotoRecord
from .schema import Neighbour

MERGE_RADIUS_M = 12.0
NEIGHBOUR_FOOTPRINT_M = 12.0  # photos give no footprint; a typical block side


class Sighting(BaseModel):
    x_m: float
    z_m: float
    height_m: float
    description: str
    photo: str


def sightings(records: list[PhotoRecord]) -> list[Sighting]:
    out = []
    for r in records:
        if r.heading_deg is None:
            continue
        for s in r.observation.visible_structures:
            bearing = math.radians((r.heading_deg + s.bearing_offset_deg) % 360)
            out.append(Sighting(
                x_m=s.approx_distance_m * math.sin(bearing),
                z_m=-s.approx_distance_m * math.cos(bearing),
                height_m=s.approx_height_m, description=s.description, photo=r.photo,
            ))
    return out


def merge_neighbours(found: list[Sighting]) -> list[tuple[Neighbour, list[Sighting]]]:
    clusters: list[list[Sighting]] = []
    for s in sorted(found, key=lambda s: math.hypot(s.x_m, s.z_m)):
        for c in clusters:
            cx = sum(t.x_m for t in c) / len(c)
            cz = sum(t.z_m for t in c) / len(c)
            if math.hypot(s.x_m - cx, s.z_m - cz) < MERGE_RADIUS_M:
                c.append(s)
                break
        else:
            clusters.append([s])
    out = []
    for i, c in enumerate(clusters, 1):
        n = len(c)
        out.append((Neighbour(
            id=f"B{i:02d}", x_m=round(sum(t.x_m for t in c) / n, 1), z_m=round(sum(t.z_m for t in c) / n, 1),
            width_m=NEIGHBOUR_FOOTPRINT_M, depth_m=NEIGHBOUR_FOOTPRINT_M,
            height_m=round(sorted(t.height_m for t in c)[n // 2], 1),
        ), c))
    return out


class InventoryItem(BaseModel):
    kind: str
    count: int
    manufacturer: str | None = None
    model: str | None = None
    where: str | None = None
    evidence_photos: list[str] = Field(default_factory=list)


class Inventory(BaseModel):
    building_storeys_estimate: int | None = None
    roof_description: str
    antennas: list[InventoryItem]
    other_equipment: list[InventoryItem]
    safety_notes: list[str]
    questions_for_engineer: list[str] = Field(description="Facts the photos cannot give: sector azimuths, antenna heights, bands and power, building height")


INVENTORY_PROMPT = """You are a telecom site engineer. Below are machine observations of every photo from one rooftop
site survey (one JSON object per photo). The same equipment appears in many photos: count each physical
item once. Build the site inventory: antennas (panel antennas and 5G AAUs, with how many sectors you can
infer), other equipment (radio units, cabinets, power, batteries, microwave dishes), safety notes, and the
questions an engineer must answer before the site can be modelled. Cite the photo files that show each item.
Return JSON that matches the schema.

Observations:
"""


def inventory(records: list[PhotoRecord], provider: str = "baseten") -> Inventory:
    compact = [
        {"photo": r.photo, "kind": r.observation.photo_kind, "summary": r.observation.summary,
         "items": [i.model_dump(exclude_none=True) for i in r.observation.items],
         "hints": r.observation.direction_hints, "safety": r.observation.safety_notes}
        for r in records if r.observation.photo_kind != "aerial_drone"
    ]
    cfg = PROVIDERS[provider]
    client = OpenAI(base_url=cfg["base_url"], api_key=os.environ[cfg["key_env"]])
    response = client.chat.completions.create(
        model=cfg["model"],
        messages=[{"role": "user", "content": INVENTORY_PROMPT + "\n".join(json.dumps(c, ensure_ascii=False) for c in compact)}],
        response_format={"type": "json_schema", "json_schema": {"name": "inventory", "schema": Inventory.model_json_schema()}},
        temperature=0.1,
    )
    return Inventory.model_validate_json(response.choices[0].message.content)


def main() -> None:
    load_dotenv(".env")
    p = argparse.ArgumentParser()
    p.add_argument("observations", type=Path)
    p.add_argument("--site-id", required=True)
    p.add_argument("-o", "--out", type=Path, required=True)
    p.add_argument("--provider", choices=PROVIDERS, default="baseten")
    args = p.parse_args()

    records = [PhotoRecord.model_validate_json(line) for line in args.observations.read_text(encoding="utf-8").splitlines() if line.strip()]
    neighbours = merge_neighbours(sightings(records))
    inv = inventory(records, args.provider)
    draft = {
        "site_id": args.site_id,
        "photos": len(records),
        "inventory": inv.model_dump(exclude_none=True),
        "neighbours": [
            {**n.model_dump(), "seen_in": sorted({s.photo for s in c}), "descriptions": [s.description for s in c][:3]}
            for n, c in neighbours
        ],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(draft, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"{len(records)} photos -> {len(inv.antennas)} antenna groups, {len(neighbours)} neighbouring buildings")
    print("Questions:", *inv.questions_for_engineer, sep="\n - ")


if __name__ == "__main__":
    main()
