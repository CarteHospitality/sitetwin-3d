"""EMF safety-distance estimate for base-station antennas.

Written from scratch for this module. Method: far-field point-source model,

    S(r) = EIRP / (4 * pi * r^2)              [W/m^2]

and for several bands on the same antenna the exposure ratios add up:

    sum_i S_i(r) / L_i <= 1   =>   r = sqrt( sum_i (EIRP_i / L_i) / (4 * pi) )

where L_i is the power-density reference level at the band's frequency.
This is a conservative screening estimate, not a replacement for an
accredited on-site measurement.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .schema import Antenna, Band, SiteModel


def icnirp_public_power_density(frequency_mhz: float) -> float:
    """ICNIRP general-public reference level for power density, W/m^2.

    Valid for the far-field mobile bands this tool deals with (400 MHz - 300 GHz).
    """
    if frequency_mhz < 400:
        raise ValueError("bands below 400 MHz are out of scope")
    if frequency_mhz <= 2000:
        return frequency_mhz / 200.0
    return 10.0


@dataclass(frozen=True)
class LimitRegime:
    name: str
    # Fraction of the ICNIRP *electric field* level allowed for this source.
    # Power density scales with E^2, so the power-density fraction is its square.
    field_fraction: float = 1.0

    def power_density_limit(self, frequency_mhz: float) -> float:
        return icnirp_public_power_density(frequency_mhz) * self.field_fraction**2


ICNIRP_PUBLIC = LimitRegime("ICNIRP general public")
# Turkish regulation applies a quarter of the field-strength limit to a single
# device. Confirm against the current BTK regulation before relying on it.
TR_SINGLE_DEVICE = LimitRegime("TR single device (1/4 field)", field_fraction=0.25)


def eirp_w(band: Band) -> float:
    return band.tx_power_w * 10 ** ((band.gain_dbi - band.feeder_loss_db) / 10)


@dataclass(frozen=True)
class SafetyZone:
    antenna_id: str
    regime: str
    front_m: float
    back_m: float
    horizontal_beamwidth_deg: float
    vertical_beamwidth_deg: float
    # Vertical half-extent of the main-lobe zone at its far end.
    half_height_m: float

    def as_dict(self) -> dict:
        return self.__dict__.copy()


def _distance(terms: list[float]) -> float:
    return math.sqrt(sum(terms) / (4 * math.pi)) if terms else 0.0


def safety_zone(antenna: Antenna, regime: LimitRegime = TR_SINGLE_DEVICE) -> SafetyZone:
    front, back = [], []
    for band in antenna.bands:
        limit = regime.power_density_limit(band.frequency_mhz)
        ratio = eirp_w(band) / limit
        front.append(ratio)
        back.append(ratio * 10 ** (-band.front_to_back_db / 10))

    hbw = max((b.horizontal_beamwidth_deg for b in antenna.bands), default=0.0)
    vbw = max((b.vertical_beamwidth_deg for b in antenna.bands), default=0.0)
    front_m = _distance(front)
    return SafetyZone(
        antenna_id=antenna.id,
        regime=regime.name,
        front_m=round(front_m, 2),
        back_m=round(_distance(back), 2),
        horizontal_beamwidth_deg=hbw,
        vertical_beamwidth_deg=vbw,
        half_height_m=round(front_m * math.tan(math.radians(vbw / 2)) + antenna.length_m / 2, 2),
    )


def site_zones(site: SiteModel, regime: LimitRegime = TR_SINGLE_DEVICE) -> list[SafetyZone]:
    return [safety_zone(a, regime) for a in site.antennas if a.bands]
