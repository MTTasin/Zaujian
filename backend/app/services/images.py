"""Shared Pillow helpers: normalize + downscale uploaded images (no upscaling)."""
import io

from django.core.files.base import ContentFile
from PIL import Image, ImageOps


def process_image(src, *, max_edge, quality=82, fmt="JPEG"):
    """Return a JPEG ContentFile: EXIF-normalized, RGB, longest edge <= max_edge."""
    try:
        img = Image.open(src)
        img.load()
    except Exception as exc:  # noqa: BLE001 - any Pillow failure = not a usable image
        raise ValueError("Uploaded file is not a valid image") from exc

    img = ImageOps.exif_transpose(img)
    if img.mode != "RGB":
        img = img.convert("RGB")

    longest = max(img.size)
    if longest > max_edge:
        scale = max_edge / longest
        img = img.resize(
            (round(img.width * scale), round(img.height * scale)),
            Image.LANCZOS,
        )

    buf = io.BytesIO()
    img.save(buf, format=fmt, quality=quality, optimize=True)
    buf.seek(0)
    name = getattr(src, "name", "image")
    base = name.rsplit(".", 1)[0] if "." in name else name
    return ContentFile(buf.read(), name=f"{base}.jpg")


def make_derivatives(src):
    """Return (display ~1600px, thumbnail ~400px) ContentFiles from one source."""
    display = process_image(src, max_edge=1600, quality=82)
    if hasattr(src, "seek"):
        src.seek(0)
    thumb = process_image(src, max_edge=400, quality=80)
    return display, thumb
