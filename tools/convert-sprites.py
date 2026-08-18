"""Convert generated chassis sprites into the form the renderer wants.

Run after dropping PNGs into `src/render/sprites/`:

    python tools/convert-sprites.py

Every `.png` in that folder is cropped, resized, saved as `.webp` beside it, and the original
is MOVED to `ChatGPT Graphics/Chassis/` rather than deleted. Already-converted `.webp` files
are left alone, so it is safe to re-run.

The archive step is not tidiness. An earlier version of this script simply deleted the PNG,
and doing that to the Tower and Square generations threw away the only full-resolution copies
of them — the shipped 768px WebP was fine, but re-cropping or re-exporting at a larger size
would have meant generating the art again. The source is the expensive part here and the
conversion is the cheap part, so the conversion never destroys the source.

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

ROOT = Path(__file__).resolve().parent.parent
SPRITES = ROOT / "src" / "render" / "sprites"
# Where the full-resolution generations are kept. Outside `src/`, because they are source
# material rather than something the site loads.
ARCHIVE_ROOT = ROOT / "ChatGPT Graphics"

# Two sprites are generated LYING DOWN and mounted upright, so the converter turns them.
#
# This is a fix for a prompt, not a quirk of the art. `docs/weapon-sprite-prompts.md` asks for
# the spinning bar and the ram plate horizontally, because a long thin subject fills a wide
# frame far better than a tall sliver of one — but both are mounted across the front of a bot,
# vertically, in the renderer's local space. Asking for them one way and using them the other
# needs exactly one rotation somewhere, and here is the only place it happens once rather than
# every time somebody regenerates them.
#
# COUNTER-clockwise, which is what puts the ram plate's heavy leading edge — along the bottom
# of the generated image — on the RIGHT, where the bot is facing. The bar is symmetric and does
# not care.
ROTATE_CCW = {"weapon-spinning-bar", "weapon-ram-plate"}
LONG_EDGE = 768
QUALITY = 90
# Target mean luminance of the visible hull, 0-255.
#
# Generated chassis art comes back dark — the first five measured 106-117 — and that is a
# problem twice over, because everything downstream can only make it darker. `tint` multiplies
# by the member's colour and the armour material multiplies again, so the brightest possible
# bot on the reveal is the sprite itself. Vin is #FFFFFF, the maximum, and his machine rendered
# at a mean of 76 out of 255: a dark grey bot where the palette says white.
#
# Normalising here rather than asking the generator for brighter art, because "brighter" is not
# a thing a prompt can hit repeatably, and a set whose members disagree on brightness looks
# worse than one that is uniformly wrong.
TARGET_LUMINANCE = 172
# Anything below this is antialiasing at the hull's edge rather than art, and including it in
# the crop would re-introduce the margin this is here to remove.
ALPHA_FLOOR = 10


def mean_luminance(im: Image.Image) -> float:
    """Mean luminance of the pixels that are actually drawn, ignoring the transparent field."""
    px = im.load()
    w, h = im.size
    total = 0.0
    count = 0
    for y in range(0, h, 3):
        for x in range(0, w, 3):
            r, g, b, a = px[x, y]
            if a <= 128:
                continue
            total += 0.2126 * r + 0.7152 * g + 0.0722 * b
            count += 1
    return total / count if count else 0.0


def normalise_brightness(im: Image.Image) -> Image.Image:
    """Lift the hull to `TARGET_LUMINANCE` with a gamma curve, leaving alpha alone.

    Gamma rather than a linear scale on purpose: scaling brightens by clipping, and the
    highlights on brushed metal are the first thing to go: a bot whose armour has turned into a
    flat white sheet has lost the surface the sprite was for. A gamma curve cannot clip, and it
    lifts the midtones — the flat plate faces — hardest, which is exactly where the member's
    colour needs room to show through.

    Solved by bisection rather than derived, because the mean is taken over an irregular
    silhouette and is not worth deriving in closed form.
    """
    current = mean_luminance(im)
    if current <= 0 or abs(current - TARGET_LUMINANCE) < 1:
        return im

    lo, hi = 0.05, 1.0 if current > TARGET_LUMINANCE else 0.05
    lo, hi = (1.0, 4.0) if current > TARGET_LUMINANCE else (0.05, 1.0)

    best = im
    for _ in range(18):
        gamma = (lo + hi) / 2
        table = [round(255 * ((i / 255) ** gamma)) for i in range(256)]
        r, g, b, a = im.split()
        trial = Image.merge("RGBA", (r.point(table), g.point(table), b.point(table), a))
        got = mean_luminance(trial)
        best = trial
        if got < TARGET_LUMINANCE:
            hi = gamma
        else:
            lo = gamma
    return best


def convert(png: Path) -> None:
    im = Image.open(png).convert("RGBA")
    before = png.stat().st_size

    if png.stem in ROTATE_CCW:
        im = im.rotate(90, expand=True, resample=Image.BICUBIC)

    im = normalise_brightness(im)

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

    # Archive the original before removing it from the sprite folder. Never `unlink` — see
    # the module docstring for the generations that taught us that. The archive mirrors the
    # sprite folder's own shape, so weapons do not land in with the chassis.
    archive = ARCHIVE_ROOT / (png.parent.name.capitalize() if png.parent != SPRITES else "Chassis")
    archive.mkdir(parents=True, exist_ok=True)
    kept = archive / png.name
    if kept.exists():
        kept.unlink()
    png.replace(kept)

    after = out.stat().st_size
    print(
        f"  {png.name} -> {out.name}  {im.size[0]}x{im.size[1]}  "
        f"{before / 1024:.0f} KB -> {after / 1024:.0f} KB "
        f"({100 * (1 - after / before):.1f}% smaller); "
        f"luminance {mean_luminance(Image.open(out).convert('RGBA')):.0f}; "
        f"original kept in {archive.relative_to(ROOT)}"
    )


def main() -> None:
    if not SPRITES.is_dir():
        sys.exit(f"no sprite folder at {SPRITES}")

    pngs = sorted(SPRITES.rglob("*.png"))
    if not pngs:
        print("Nothing to convert — no .png files in src/render/sprites/")
        return

    print(f"Converting {len(pngs)} sprite(s) in {SPRITES}:")
    for png in pngs:
        convert(png)


if __name__ == "__main__":
    main()
