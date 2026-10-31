"""Context buildings: only those beyond the analysed neighbours, in the local frame, for display."""

from sitetwin3d import osm

LAT, LON = 40.0, 29.0
M_LAT, M_LON = 1 / 110_540, 1 / (111_320 * 0.766044)  # degrees per metre here (cos 40 deg)


def square(east_m, north_m, size_m=10.0, height=None):
    lo, la = LON + east_m * M_LON, LAT + north_m * M_LAT
    d_lo, d_la = size_m * M_LON, size_m * M_LAT
    return {"polygon": [(lo, la), (lo + d_lo, la), (lo + d_lo, la + d_la), (lo, la + d_la), (lo, la)], "height": height}


def test_only_buildings_beyond_the_analysed_ones(monkeypatch):
    near, far, far_tall = square(20, 20), square(250, 0), square(0, -300, height=42.0)
    monkeypatch.setattr(osm, "footprints_around", lambda lat, lon, radius_m: [near, far, far_tall])
    context = osm.context_buildings(LAT, LON)
    assert len(context) == 2
    first = context[0]
    assert first["height_m"] == osm.ASSUMED_STOREYS * osm.STOREY_M
    assert len(first["footprint"]) == 4  # the closing vertex is dropped
    x, z = first["footprint"][0]
    assert abs(x - 250) < 1 and abs(z) < 1  # metres East / South of the site
    assert context[1]["height_m"] == 42.0 and context[1]["footprint"][0][1] > 290  # 300 m South: z = +300
