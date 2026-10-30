import math

import pytest

from sitetwin3d.emf import (
    ICNIRP_PUBLIC,
    TR_SINGLE_DEVICE,
    eirp_w,
    icnirp_public_power_density,
    safety_zone,
)
from sitetwin3d.schema import Antenna, Band


def band(**kw):
    defaults = dict(name="L1800", frequency_mhz=1800, tx_power_w=40, gain_dbi=17.0)
    return Band(**{**defaults, **kw})


def test_reference_levels():
    assert icnirp_public_power_density(900) == pytest.approx(4.5)
    assert icnirp_public_power_density(1800) == pytest.approx(9.0)
    assert icnirp_public_power_density(3500) == 10.0
    with pytest.raises(ValueError):
        icnirp_public_power_density(100)


def test_eirp():
    assert eirp_w(band(tx_power_w=10, gain_dbi=10)) == pytest.approx(100)
    assert eirp_w(band(tx_power_w=10, gain_dbi=13, feeder_loss_db=3)) == pytest.approx(100, rel=1e-3)


def test_single_band_matches_closed_form():
    ant = Antenna(id="A1", azimuth_deg=0, height_agl_m=20, bands=[band()])
    z = safety_zone(ant, ICNIRP_PUBLIC)
    expected = math.sqrt(eirp_w(band()) / (4 * math.pi * 9.0))
    assert z.front_m == pytest.approx(expected, abs=0.01)


def test_tr_single_device_is_five_times_icnirp_distance():
    ant = Antenna(id="A1", azimuth_deg=0, height_agl_m=20, bands=[band()])
    assert safety_zone(ant, TR_SINGLE_DEVICE).front_m == pytest.approx(
        5 * safety_zone(ant, ICNIRP_PUBLIC).front_m, abs=0.02
    )


def test_tr_limit_is_12_3_v_per_m_above_2ghz():
    # E = sqrt(30 * EIRP) / d  ->  at the zone edge E equals the limit
    ant = Antenna(id="A1", azimuth_deg=0, height_agl_m=20, bands=[band(frequency_mhz=3500)])
    d = safety_zone(ant, TR_SINGLE_DEVICE).front_m
    assert math.sqrt(30 * eirp_w(band(frequency_mhz=3500))) / d == pytest.approx(12.3, rel=0.01)


def test_bands_combine_and_back_lobe_is_smaller():
    one = Antenna(id="A", azimuth_deg=0, height_agl_m=20, bands=[band()])
    two = Antenna(id="B", azimuth_deg=0, height_agl_m=20, bands=[band(), band()])
    z1, z2 = safety_zone(one), safety_zone(two)
    assert z2.front_m == pytest.approx(z1.front_m * math.sqrt(2), abs=0.02)
    assert z1.back_m < z1.front_m / 10
