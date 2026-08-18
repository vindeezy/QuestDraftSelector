"""Convert generated chassis sprites into the form the renderer wants.

Run after dropping PNGs into `src/render/sprites/`:

    python tools/convert-sprites.py

Every `.png` in that folder is cropped, resized, saved as `.webp` beside it, and the PNG is
removed. Already-converted `.webp` files are left alone, so it is safe to re-run.

Three steps, and each one exists because of something that actually went wrong:

**Crop to the opaque bounds.** Generated art ships with a transparent margin — the first wedge
had 94px of empty space top and bottom. The renderer fits a sprite to its chassis's bounding
box, so an uncropped file draws the machine inset from its own outline, with the vector body
visible around it.

**Resize to 768.** That is the portrait's own size on a retina display, so nothing is discarded
that anyone could see. The first three arrived at 1254x1254.

**WebP at quality 90.** The first three totalled 6.5 MB as PNG, against 321 KB for every armour
and floor texture the site ships combined. The same three are 435 KB as WebP — 93.5% smaller —
at 40.6 dB PSNR measured over visible pixels only. (Measured across the whole image it looks
like 27.6 dB, but almost all of that difference is RGB noise underneath a zero alpha, where the
colour means nothing.)
"""

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required: python -m pip install Pillow")

SPRITES = Path(__file__).resolve().parent.parent / "src" / "render" / "sprites"
LONG_EDGE = 768
QUALITY = 90
# Anything below this is antialiasing at the hull's edge rather than art, and including it in
# the crop would re-introduce the margin this is here to remove.
ALPHA_FLOOR = 10


def convert(png: Path) -> None:
    im = Image.open(png).convert("RGBA")
    before = png.stat().st_size

    mask = im.getchannel("A").point(lambda v: 255 if v > ALPHA_FLOOR else 0)
    bbox = mask.getbbox()
    if bbox is None:
        print(f"  {png.name}: fully transparent, skipped")
        return
    im = im.crop(bbox)

    w, h = im.size
    scale = LONG_EDGE / max(w, h)
    if scale < 1:
        im = im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)

    out = png.with_suffix(".webp")
    im.save(out, "WEBP", quality=QUALITY, method=6)
    png.unlink()

    after = out.stat().st_size
    print(
        f"  {png.name} -> {out.name}  {im.size[0]}x{im.size[1]}  "
        f"{before / 1024:.0f} KB -> {after / 1024:.0f} KB "
        f"({100 * (1 - after / before):.1f}% smaller)"
    )


def main() -> None:
    if not SPRITES.is_dir():
        sys.exit(f"no sprite folder at {SPRITES}")

    pngs = sorted(SPRITES.glob("*.png"))
    if not pngs:
        print("Nothing to convert — no .png files in src/render/sprites/")
        return

    print(f"Converting {len(pngs)} sprite(s) in {SPRITES}:")
    for png in pngs:
        convert(png)


if __name__ == "__main__":
    main()
