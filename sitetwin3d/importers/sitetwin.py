"""Read a SiteTwin site file (schema `jevbtk-digital-site@1`) into a twin.

    python -m sitetwin3d.importers.sitetwin SITE_MODEL.json [--draft PHOTO_DRAFT.json] -o viewer/data/x.twin.json

SiteTwin is the private engineering system that produces this file: sectors,
antennas with their planned action (retain / add / remove / replace), heights,
azimuths, tilts and per-band power, plus the supporting structure. This module
only consumes that file; it does not contain or call SiteTwin.

What the file does not give is filled with stated defaults and listed in the
twin's notes: roof footprint, antenna position on the roof, antenna gain and
beamwidths when missing. Address and coordinates are deliberately dropped.
Neighbouring buildings can be added from a photo draft (see build_site.py).
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from ..export import REGIMES, build_twin
from ..osm import context_buildings, dms_to_deg, surroundings
from ..schema import Antenna, Band, Building, Neighbour, SiteModel

SCHEMA = "jevbtk-digital-site@1"
DEFAULT_FOOTPRINT_M = (20.0, 16.0)
DEFAULT_BUILDING_HEIGHT_M = 15.0
# Typical values when the file has no gain or pattern data (macro panels and massive-MIMO AAUs).
DEFAULT_RF = [
    # (max MHz, gain dBi, horizontal bw, vertical bw, front-to-back dB)
    (1000, 15.5, 65, 12, 25),
    (2700, 18.0, 65, 6, 28),
    (6000, 24.0, 65, 6, 30),
]
GROUND_STRUCTURES = {"lattice_tower", "monopole", "pole"}
COMPOUND_M = 8.0
EXISTING = {"retain", "remove", "replace"}
PROPOSED = {"retain", "add", "replace"}


def _rf_defaults(f_mhz: float) -> tuple[float, float, float, float]:
    for max_f, gain, hbw, vbw, fb in DEFAULT_RF:
        if f_mhz <= max_f:
            return gain, hbw, vbw, fb
    return DEFAULT_RF[-1][1:]


def _band_name(f_mhz: float, technology: str | None) -> str:
    nr = f_mhz >= 3000 or (technology == "5G" and 694 <= f_mhz <= 790)
    return f"{'N' if nr else 'L'}{f_mhz:g}"


def _antenna(a: dict, building: Building, technology: str | None, assumed: set[str]) -> Antenna:
    bands = []
    for b in a.get("bands") or []:
        f = float(b["frequency_mhz"])
        gain, hbw, vbw, fb = _rf_defaults(f)
        if b.get("gain_dbi") is None:
            assumed.add("antenna gain and beamwidths (typical values by band)")
        bands.append(Band(
            name=_band_name(f, technology), frequency_mhz=f,
            tx_power_w=float(b.get("operating_power_w") or 0),
            gain_dbi=float(b["gain_dbi"]) if b.get("gain_dbi") is not None else gain,
            horizontal_beamwidth_deg=hbw, vertical_beamwidth_deg=vbw, front_to_back_db=fb,
        ))
    e_tilts = [b.get("electrical_tilt_deg") for b in a.get("bands") or [] if b.get("electrical_tilt_deg") is not None]
    az = float(a["azimuth_deg"])
    # Mount each sector on the roof edge it faces; slots side by side along that edge.
    side = (int(a.get("slot") or 1) - 1) * 0.8
    r = math.radians(az)
    cx, cz = _roof_centre(building)
    x = cx + 0.4 * building.width_m * math.sin(r) + side * math.cos(r)
    z = cz - 0.4 * building.depth_m * math.cos(r) + side * math.sin(r)
    assumed.add("antenna positions on the roof (sector edge)")
    is_aau = any(bd.frequency_mhz >= 3000 for bd in bands)
    return Antenna(
        id=f"S{a['sector']}-{a.get('slot') or 1}", sector=str(a["sector"]), azimuth_deg=az,
        mechanical_tilt_deg=float(a.get("mechanical_tilt_deg") or 0),
        electrical_tilt_deg=float(max(e_tilts)) if e_tilts else 0.0,
        height_agl_m=float(a["height_m"]), x_m=round(x, 1), z_m=round(z, 1),
        model=a.get("model"), length_m=0.9 if is_aau else 1.9, bands=bands,
    )


def _roof_centre(building: Building) -> tuple[float, float]:
    if not building.footprint:
        return 0.0, 0.0
    xs, zs = zip(*building.footprint)
    return (max(xs) + min(xs)) / 2, (max(zs) + min(zs)) / 2


def from_sitetwin(doc: dict, neighbours: list[Neighbour] | None = None, host: Neighbour | None = None,
                  extra_notes: list[str] | None = None) -> tuple[SiteModel, SiteModel]:
    """Return (existing, proposed) site models from one SiteTwin file.

    `host` is the outline of the building the site stands on (e.g. from OSM);
    without it a default roof footprint is assumed.
    """
    if doc.get("schema") != SCHEMA:
        raise ValueError(f"expected schema {SCHEMA}, got {doc.get('schema')}")
    assumed: set[str] = set()
    structure = doc.get("structure") or {}
    kind = structure.get("kind")
    height = structure.get("building_height_m")
    if kind in GROUND_STRUCTURES:
        # Towers and poles stand in a fenced ground compound, not on a roof.
        building = Building(width_m=COMPOUND_M, depth_m=COMPOUND_M, height_m=0.5)
        assumed.add(f"ground compound ({COMPOUND_M:g} x {COMPOUND_M:g} m) around the {kind.replace('_', ' ')}")
    elif host is not None:
        if height is None:
            assumed.add(f"building height ({DEFAULT_BUILDING_HEIGHT_M} m)")
            height = DEFAULT_BUILDING_HEIGHT_M
        building = Building(width_m=host.width_m, depth_m=host.depth_m, height_m=float(height), footprint=host.footprint)
    else:
        if height is None:
            assumed.add(f"building height ({DEFAULT_BUILDING_HEIGHT_M} m)")
            height = DEFAULT_BUILDING_HEIGHT_M
        assumed.add(f"roof footprint ({DEFAULT_FOOTPRINT_M[0]:g} x {DEFAULT_FOOTPRINT_M[1]:g} m)")
        building = Building(width_m=DEFAULT_FOOTPRINT_M[0], depth_m=DEFAULT_FOOTPRINT_M[1], height_m=float(height))
    app = doc.get("application") or {}
    technology = app.get("technology")

    def model(actions: set[str]) -> SiteModel:
        antennas = [_antenna(a, building, technology, assumed) for a in doc.get("antennas") or [] if a.get("action") in actions]
        return SiteModel(site_id=doc["site_id"], name=f"SiteTwin {app.get('type') or 'site'}: {technology or ''}".strip(),
                         structure=kind or "rooftop", building=building, antennas=antennas, neighbours=neighbours or [])

    existing, proposed = model(EXISTING), model(PROPOSED)
    if kind in GROUND_STRUCTURES:
        # On a tower or a mast the antennas hang on its sides, not on a roof edge.
        assumed.discard("antenna positions on the roof (sector edge)")
        assumed.add(f"antenna positions on the {kind.replace('_', ' ')} (one side per sector)")
    notes = [f"Imported from SiteTwin ({SCHEMA})."]
    if app.get("reason"):
        notes.append(f"SiteTwin application: {app['reason']}")
    notes += extra_notes or []
    notes.append("Assumed, not in the SiteTwin file: " + "; ".join(sorted(assumed)) + ".")
    for m in (existing, proposed):
        m.notes = notes
    return existing, proposed


def network_kpi(doc: dict) -> dict | None:
    """Measured busy-hour load per cell, if the site file carries it (optional `network_kpi`).

    Each cell: sector (1 or "S1"), band ("L1800"), prb_dl_pct (0-100), optionally busy_hour,
    rrc_users and traffic_gb. Returned in the viewer's form, busiest cell first; unusable
    cells are dropped, and a block without any usable cell is ignored.
    """
    block = doc.get("network_kpi")
    if not isinstance(block, dict) or not isinstance(block.get("cells"), list):
        return None
    cells = []
    for c in block["cells"]:
        if not isinstance(c, dict):
            continue
        sector = str(c.get("sector", "")).upper().removeprefix("S")
        band, prb = c.get("band"), c.get("prb_dl_pct")
        if not sector.isdigit() or not isinstance(band, str) or not isinstance(prb, (int, float)) or not 0 <= prb <= 100:
            continue
        users, traffic = c.get("rrc_users"), c.get("traffic_gb")
        cells.append({"sector": f"S{int(sector)}", "band": band.upper(), "prb_dl_pct": round(prb),
                      "users": users if isinstance(users, (int, float)) else None,
                      "traffic_gb": traffic if isinstance(traffic, (int, float)) else None, "time": c.get("busy_hour")})
    if not cells:
        return None
    cells.sort(key=lambda c: -c["prb_dl_pct"])
    return {"source": block.get("source"), "period": block.get("period"), "cells": cells}


def neighbours_from_draft(path: Path) -> list[Neighbour]:
    draft = json.loads(path.read_text(encoding="utf-8"))
    fields = Neighbour.model_fields
    return [Neighbour(**{k: v for k, v in n.items() if k in fields}) for n in draft.get("neighbours", [])]


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("site_model", type=Path)
    p.add_argument("--draft", type=Path, help="photo draft with neighbouring buildings (build_site.py output)")
    p.add_argument("-o", "--out", type=Path, required=True)
    p.add_argument("--osm", action="store_true", help="fetch the roof outline, neighbouring buildings and their uses (Microsoft footprints + OpenStreetMap)")
    p.add_argument("--regime", choices=REGIMES, default="tr")
    args = p.parse_args()

    doc = json.loads(args.site_model.read_text(encoding="utf-8"))
    neighbours = neighbours_from_draft(args.draft) if args.draft else []
    host, notes = None, []
    if args.osm:
        lat, lon = dms_to_deg(doc["site"]["latitude_dms"]), dms_to_deg(doc["site"]["longitude_dms"])
        host, osm_neighbours, notes = surroundings(lat, lon)
        neighbours += osm_neighbours
        if host is not None and (doc.get("structure") or {}).get("kind") in GROUND_STRUCTURES:
            neighbours.append(host)  # a tower next to a building: that building is a neighbour
            host = None
    existing, proposed = from_sitetwin(doc, neighbours, host, notes)
    twin = build_twin(proposed, args.regime)
    twin["baseline"] = existing.model_dump()
    if kpi := network_kpi(doc):
        twin["network_kpi"] = kpi
    if args.osm:
        twin["context"] = context_buildings(lat, lon)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(twin, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"{proposed.site_id}: {len(existing.antennas)} existing -> {len(proposed.antennas)} proposed antennas")
    for z in twin["zones"]:
        print(f"  {z['antenna_id']}: front {z['front_m']} m, back {z['back_m']} m")


if __name__ == "__main__":
    main()
