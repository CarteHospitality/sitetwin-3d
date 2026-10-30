"""Per-photo extraction: one survey photo -> structured observation (JSON).

    python -m sitetwin3d.extract PHOTO_OR_DIR [...] --provider meta|baseten --out obs.jsonl

Drone photos carry height and compass heading in their metadata; it is passed
to the model so surrounding buildings get a real bearing. Results are cached
under output/cache/ by image hash and prompt version, so a photo is never
paid for twice.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from openai import OpenAI
from PIL import Image, ImageOps
from pydantic import BaseModel, Field

CACHE_DIR = Path("output/cache")
MAX_SIDE = 1600
PROMPT_VERSION = "2"

PROVIDERS = {
    "meta": dict(base_url="https://api.meta.ai/v1", key_env="MODEL_API_KEY", model="muse-spark-1.3"),
    "baseten": dict(base_url="https://inference.baseten.co/v1", key_env="BASETEN_API_KEY", model="meta-models/muse-spark-open-1026"),
}


class SeenItem(BaseModel):
    kind: Literal["panel_antenna", "aau_5g", "microwave_dish", "radio_unit", "cabinet", "power_unit", "battery", "cable_tray", "mast_or_pole", "other"]
    count: int = 1
    manufacturer: str | None = None
    model: str | None = None
    label_text: str | None = Field(default=None, description="Text read from labels or nameplates, verbatim")
    position: str | None = Field(default=None, description="Where it is: rooftop corner, wall, inside cabinet...")


class VisibleStructure(BaseModel):
    description: str = Field(description="e.g. '6-storey apartment block with balconies'")
    bearing_offset_deg: float = Field(description="Horizontal angle from the image centre, negative = left, roughly -40..40")
    approx_distance_m: float
    approx_height_m: float
    storeys: int | None = None


class PhotoObservation(BaseModel):
    photo_kind: Literal["rooftop_overview", "aerial_drone", "antenna_closeup", "equipment_closeup", "cabinet_interior", "label_or_nameplate", "access_path", "other"]
    summary: str = Field(description="One sentence describing the photo")
    items: list[SeenItem] = Field(default_factory=list)
    visible_structures: list[VisibleStructure] = Field(default_factory=list, description="Only for outward views: buildings within about 60 m")
    direction_hints: list[str] = Field(default_factory=list, description="Anything that hints at azimuth or orientation: compass, sector labels, shadows")
    safety_notes: list[str] = Field(default_factory=list, description="Access, ladders, signage, exclusion markings")
    confidence: float = Field(ge=0, le=1)


class PhotoRecord(BaseModel):
    """What the rest of the pipeline sees: file name, camera metadata and the observation."""

    photo: str
    taken_at: str | None = None
    drone_height_m: float | None = None
    heading_deg: float | None = Field(default=None, description="Camera compass heading, 0 = North, clockwise")
    pitch_deg: float | None = None
    observation: PhotoObservation


PROMPT = """You are a telecom site engineer reviewing one site-survey photo of a mobile base station.
List every piece of telecom equipment you can see in `items` (antennas, radio units, cabinets,
power units, batteries, cable trays, masts), one entry per type with a count, even when the
manufacturer is unknown. Read label text verbatim. Leave manufacturer and model null unless
you can actually read them. `summary` is one plain sentence about this photo.
If the photo looks outward from the site (drone or rooftop view of the surroundings), list the
buildings within about 60 m in `visible_structures` with rough distance and height; a storey is
about 3 m. Otherwise leave it empty.
Return JSON that matches the schema."""


def camera_metadata(path: Path) -> dict:
    img = Image.open(path)
    exif = img.getexif()
    meta: dict = {"taken_at": exif.get(0x0132)}
    raw = path.read_bytes()[:200_000]
    i = raw.find(b"drone-dji:")
    if i >= 0:
        xmp = raw[max(0, i - 4000) : i + 6000].decode("latin1")
        for key, field in [("RelativeAltitude", "drone_height_m"), ("GimbalYawDegree", "gimbal_yaw"),
                           ("FlightYawDegree", "flight_yaw"), ("GimbalPitchDegree", "pitch_deg")]:
            m = re.search(key + r'="([^"]+)"', xmp)
            if m:
                meta[field] = float(m.group(1))
        # Some DJI cameras report gimbal yaw relative to the aircraft as 0; then the aircraft heading is the camera heading.
        yaw = meta.pop("gimbal_yaw", None)
        flight = meta.pop("flight_yaw", None)
        heading = yaw if yaw not in (None, 0.0) else flight
        if heading is not None:
            meta["heading_deg"] = heading % 360
    return meta


def _encode(path: Path) -> tuple[str, str]:
    img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85)
    data = buf.getvalue()
    return hashlib.sha1(data).hexdigest(), base64.b64encode(data).decode()


def extract(path: Path, provider: str = "meta") -> PhotoRecord:
    meta = camera_metadata(path)
    digest, b64 = _encode(path)
    cache = CACHE_DIR / provider / f"{digest}-v{PROMPT_VERSION}.json"
    if cache.exists():
        obs = PhotoObservation.model_validate_json(cache.read_text(encoding="utf-8"))
        return PhotoRecord(photo=path.name, observation=obs, **meta)

    context = f"Photo file: {path.name}."
    if "heading_deg" in meta:
        context += f" Drone photo at {meta.get('drone_height_m')} m above take-off, camera heading {meta['heading_deg']:.0f} degrees."
    cfg = PROVIDERS[provider]
    client = OpenAI(base_url=cfg["base_url"], api_key=os.environ[cfg["key_env"]])
    response = client.chat.completions.create(
        model=cfg["model"],
        # Instructions go in the user turn: the open-weight model follows them
        # there more reliably than in a system message.
        messages=[
            {"role": "user", "content": [
                {"type": "text", "text": f"{PROMPT}\n\n{context}"},
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
    return PhotoRecord(photo=path.name, observation=obs, **meta)


def collect(paths: list[Path]) -> list[Path]:
    photos: list[Path] = []
    for p in paths:
        photos += sorted(q for q in p.iterdir() if q.suffix.lower() in (".jpg", ".jpeg")) if p.is_dir() else [p]
    return photos


def main() -> None:
    load_dotenv(".env")
    p = argparse.ArgumentParser()
    p.add_argument("photos", nargs="+", type=Path)
    p.add_argument("--provider", choices=PROVIDERS, default="meta")
    p.add_argument("--out", type=Path, help="write one PhotoRecord per line (JSONL)")
    p.add_argument("--workers", type=int, default=6)
    args = p.parse_args()

    photos = collect(args.photos)
    records: dict[str, PhotoRecord] = {}
    with ThreadPoolExecutor(args.workers) as pool:
        futures = {pool.submit(extract, ph, args.provider): ph for ph in photos}
        for n, fut in enumerate(as_completed(futures), 1):
            ph = futures[fut]
            try:
                records[ph.name] = fut.result()
                print(f"[{n}/{len(photos)}] {ph.name}: {records[ph.name].observation.summary}", flush=True)
            except Exception as e:  # keep going; a failed photo can be retried, the cache keeps the rest
                print(f"[{n}/{len(photos)}] {ph.name}: FAILED {e}", flush=True)

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        with args.out.open("w", encoding="utf-8") as f:
            for ph in photos:
                if ph.name in records:
                    f.write(records[ph.name].model_dump_json(exclude_none=True) + "\n")
        print(f"wrote {len(records)}/{len(photos)} records to {args.out}")
    elif len(photos) <= 3:
        for ph in photos:
            print(json.dumps(records[ph.name].model_dump(exclude_none=True), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
