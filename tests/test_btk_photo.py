import base64
import io

import pytest
from PIL import Image

from sitetwin3d.btk_photo import from_sitetwin, general_view

pymupdf = pytest.importorskip("pymupdf")


def _png(w: int, h: int, colour: str) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (w, h), colour).save(out, "PNG")
    return out.getvalue()


def _report(path, general_view_page: bool = True):
    doc = pymupdf.open()
    cover = doc.new_page()
    cover.insert_text((72, 72), "KAPAK")
    cover.insert_image(pymupdf.Rect(72, 100, 272, 300), stream=_png(300, 300, "red"))
    if general_view_page:
        page = doc.new_page()
        page.insert_text((72, 72), "GENEL GORUNUM")
        page.insert_image(pymupdf.Rect(72, 80, 120, 128), stream=_png(60, 60, "blue"))  # a logo
        page.insert_image(pymupdf.Rect(72, 140, 372, 540), stream=_png(450, 600, "green"))
    doc.save(path)


def test_general_view_is_the_large_photo_on_the_headed_page(tmp_path):
    pdf = tmp_path / "12345N_SAMPL_5G_NEW_BTK.pdf"
    _report(pdf)
    photo = general_view(pdf)
    assert photo["source"] == "12345N_SAMPL_5G_NEW_BTK.pdf, page 2: GENEL GÖRÜNÜM"
    image = Image.open(io.BytesIO(base64.b64decode(photo["data"].split(",", 1)[1])))
    assert image.format == "JPEG" and max(image.size) <= 640
    r, g, b = image.convert("RGB").getpixel((image.width // 2, image.height // 2))
    assert g > 100 and r < 60 and b < 60  # the green site photo, not the red cover or the blue logo


def test_no_general_view_page_gives_no_photo(tmp_path):
    pdf = tmp_path / "report.pdf"
    _report(pdf, general_view_page=False)
    assert general_view(pdf) is None


def test_sitetwin_document_points_to_its_report(tmp_path):
    pdf = tmp_path / "previous BTK.pdf"
    _report(pdf)
    doc = {"sources": {"D1": {"kind": "previous_report", "path": str(pdf)}, "R": {"kind": "request", "path": "x.json"}}}
    assert from_sitetwin(doc)["source"].startswith("previous BTK.pdf, page 2")
    assert from_sitetwin({"sources": {"D1": {"kind": "previous_report", "path": str(tmp_path / "missing.pdf")}}}) is None
