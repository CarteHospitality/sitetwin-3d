"""Data model for a 3D site twin.

Coordinate convention (used by the viewer too):
  - Origin is the centre of the rooftop / ground plane at the site.
  - x points East, y points Up, z points South (three.js right-handed, north = -z).
  - Azimuth is degrees clockwise from true North.
  - All lengths are metres.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Building(BaseModel):
    width_m: float = Field(description="East-west extent of the roof")
    depth_m: float = Field(description="North-south extent of the roof")
    height_m: float = Field(description="Roof height above ground")


class Antenna(BaseModel):
    id: str
    sector: str | None = None
    azimuth_deg: float
    mechanical_tilt_deg: float = 0.0
    electrical_tilt_deg: float = 0.0
    height_agl_m: float = Field(description="Antenna centre height above ground level")
    x_m: float = 0.0
    z_m: float = 0.0
    manufacturer: str | None = None
    model: str | None = None
    length_m: float = 1.5
    # Radio parameters used for the EMF zone. Per band, because one panel
    # usually carries several technologies.
    bands: list["Band"] = Field(default_factory=list)
    source_photos: list[str] = Field(default_factory=list)
    confidence: float | None = Field(default=None, ge=0, le=1)


class Band(BaseModel):
    name: str = Field(description="e.g. 'L1800', 'N3500'")
    frequency_mhz: float
    tx_power_w: float = Field(description="Total power at the antenna port, all carriers")
    gain_dbi: float
    horizontal_beamwidth_deg: float = 65.0
    vertical_beamwidth_deg: float = 7.0
    front_to_back_db: float = 25.0
    feeder_loss_db: float = 0.0


class Equipment(BaseModel):
    id: str
    kind: Literal["radio_unit", "cabinet", "power", "mast", "dish", "other"]
    label: str | None = None
    x_m: float = 0.0
    z_m: float = 0.0
    height_agl_m: float = 0.0
    size_m: tuple[float, float, float] = (0.6, 1.8, 0.6)
    source_photos: list[str] = Field(default_factory=list)


class Neighbour(BaseModel):
    """A nearby building, as an axis-aligned box. Occupied, so EMF zones must not reach it."""

    id: str
    x_m: float
    z_m: float
    width_m: float
    depth_m: float
    height_m: float
    use: Literal["residential", "office", "commercial", "school", "kindergarten", "hospital", "other"] = "residential"
    storeys: int | None = None
    population: int | None = Field(default=None, description="Known occupancy; estimated from floor area when missing")


class SiteModel(BaseModel):
    site_id: str
    name: str | None = None
    building: Building
    antennas: list[Antenna] = Field(default_factory=list)
    equipment: list[Equipment] = Field(default_factory=list)
    neighbours: list[Neighbour] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


Antenna.model_rebuild()
