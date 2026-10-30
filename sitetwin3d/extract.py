"""Per-photo extraction: one survey photo -> structured observation (JSON).

    python -m sitetwin3d.extract PHOTO [PHOTO ...] --provider meta|baseten

Results are cached under output/cache/ by image hash, so a photo is never
paid for twice.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from openai import OpenAI
from PIL import Image, ImageOps
from pydantic import BaseModel, Field

CACHE_DIR = Path("output/cache")
MAX_SIDE = 1600

PROVIDERS = {
    "meta": dict(base_url="https://api.meta.ai/v1", key_env="MODEL_API_KEY", model="muse-spark-1.3"),
    "baseten": dict(base_url="https://inference.baseten.co/v1", key_env="BASETEN_API_KEY", model="meta-models/muse-spark-open"),
}


class SeenItem(BaseModel):
    kind: Literal["panel_antenna", "aau_5g", "microwave_dish", "radio_unit", "cabinet", "power_unit", "battery", "cable_tray", "mast_or_pole", "other"]
    count: int = 1
    manufacturer: str | None = None
    model: str | None = None
    label_text: str | None = Field(default=None, description="Text read from labels or nameplates, verbatim")
    position: str | None = Field(default=None, description="Where it is: rooftop corner, wall, inside cabinet...")


class PhotoObservation(BaseModel):
    photo_kind: Literal["rooftop_overview", "aerial_drone", "antenna_closeup", "equipment_closeup", "cabinet_interior", "label_or_nameplate", "access_path", "other"]
    summary: str = Field(description="One sentence describing the photo")
    items: list[SeenItem] = Field(default_factory=list)
    direction_hints: list[str] = Field(default_factory=list, description="Anything that hints at azimuth or orientation: compass, sector labels, shadows")
    safety_notes: list[str] = Field(default_factory=list, description="Access, ladders, signage, exclusion markings")
    confidence: float = Field(ge=0, le=1)


PROMPT = """You are a telecom site engineer reviewing one site-survey photo of a mobile base station.
List every piece of telecom equipment you can see in `items` (antennas, radio units, cabinets,
power units, batteries, cable trays, masts), one entry per type with a count, even when the
manufacturer is unknown. Read label text verbatim. Leave manufacturer and model null unless
you can actually read them. `summary` is one plain sentence about this photo.
Return JSON that matches the schema."""


def _encode(path: Path) -> tuple[str, str]:
    img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85)
    data = buf.getvalue()
    return hashlib.sha1(data).hexdigest(), base64.b64encode(data).decode()


def extract(path: Path, provider: str = "meta") -> PhotoObservation:
    digest, b64 = _encode(path)
    cache = CACHE_DIR / provider / f"{digest}.json"
    if cache.exists():
        return PhotoObservation.model_validate_json(cache.read_text(encoding="utf-8"))

    cfg = PROVIDERS[provider]
    client = OpenAI(base_url=cfg["base_url"], api_key=os.environ[cfg["key_env"]])
    response = client.chat.completions.create(
        model=cfg["model"],
        # Instructions go in the user turn: the open-weight model follows them
        # there more reliably than in a system message.
        messages=[
            {"role": "user", "content": [
                {"type": "text", "text": f"{PROMPT}\n\nPhoto file: {path.name}"},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
            ]},
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "photo_observation", "schema": PhotoObservation.model_json_schema()},
        },
    )
    obs = PhotoObservation.model_validate_json(response.choices[0].message.content)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(obs.model_dump_json(indent=2), encoding="utf-8")
    return obs


def main() -> None:
    load_dotenv()
    p = argparse.ArgumentParser()
    p.add_argument("photos", nargs="+", type=Path)
    p.add_argument("--provider", choices=PROVIDERS, default="meta")
    args = p.parse_args()
    for photo in args.photos:
        obs = extract(photo, args.provider)
        print(f"== {photo.name}")
        print(json.dumps(obs.model_dump(exclude_none=True), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
