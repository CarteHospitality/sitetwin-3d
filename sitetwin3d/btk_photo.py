"""The site's general view from its BTK report: the photo on the page headed GENEL GÖRÜNÜM.

A site's previous BTK report (a PDF) has one page headed "GENEL GÖRÜNÜM" with a photo of the
whole site. The page is found by its heading, not by its number (the number differs between
reports); its largest image is the photo. It goes into the twin as a small JPEG data URL, so
the photo travels with the file and the portfolio shows it without asking.
"""

from __future__ import annotations

import base64
import io
import re
from pathlib import Path

HEADING = re.compile(r"GENEL\s+G[ÖO]R[ÜU]N[ÜU]M", re.IGNORECASE)
MAX_SIDE_PX = 640
MIN_SIDE_PX = 200  # smaller images on the page are logos and stamps, not the site


def general_view(pdf: Path) -> dict | None:
    """{source, data} for the report's general-view photo, or None if the report has none."""
    try:
        import pymupdf
    except ImportError:  # optional: without it, imports simply carry no photo
        return None
    from PIL import Image

    with pymupdf.open(pdf) as doc:
        for page in doc:
            if not HEADING.search(page.get_text()):
                continue
            images = [im for im in page.get_image_info(xrefs=True) if min(im["width"], im["height"]) >= MIN_SIDE_PX]
            if not images:
                continue
            # Rendered as the report shows it: photos are often stored sideways and turned on the page.
            box = pymupdf.Rect(max(images, key=lambda im: pymupdf.Rect(im["bbox"]).get_area())["bbox"])
            zoom = MAX_SIDE_PX / max(box.width, box.height)
            pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=box, alpha=False)
            photo = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            photo.thumbnail((MAX_SIDE_PX, MAX_SIDE_PX))  # the clip can round up a pixel
            out = io.BytesIO()
            photo.save(out, "JPEG", quality=80, optimize=True)
            return {
                "source": f"{pdf.name}, page {page.number + 1}: GENEL GÖRÜNÜM",
                "data": "data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode("ascii"),
            }
    return None


def first_general_view(pdfs: list[Path]) -> dict | None:
    """The photo from the first report that has one; BTK reports are tried before the others."""
    for pdf in sorted(pdfs, key=lambda p: "BTK" not in p.name.upper()):
        if pdf.suffix.lower() == ".pdf" and pdf.is_file() and (photo := general_view(pdf)):
            return photo
    return None


def from_sitetwin(doc: dict) -> dict | None:
    """The photo from the previous BTK report a SiteTwin document names, when that file is on this machine."""
    sources = (doc.get("sources") or {}).values()
    return first_general_view([Path(s["path"]) for s in sources
                               if isinstance(s, dict) and s.get("kind") == "previous_report" and s.get("path")])
