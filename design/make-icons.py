#!/usr/bin/env python3
"""Render the Longshot app icon to icons/*.png.

The mark is FixedShot's closed viewfinder, colourway included: four brackets,
same geometry, cream on the accent tile. The two apps share one mark — the icon
sits inside Longshot's own orange UI far more often than it sits next to
FixedShot, and matching the product it belongs to won that trade.

Geometry is authored on a 32-unit grid; FixedShot's 1024-unit source divided by
32 gives the bracket coordinates and the 1.7 stroke. Small sizes get their own
drawing (wider brackets, heavier stroke) rather than a shrunk copy.

    python3 design/make-icons.py        # writes icons/*.png and icons/mark.svg
"""

import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, "icons")

TILE = "#ff4f00"      # --accent, flat, exactly as FixedShot draws it
STROKE = "#fffefb"    # --bg, the same cream FixedShot draws with
RADIUS = 7.7          # 24% of the tile, as FixedShot's 246/1024

BIG = ["M8.7 18.6V23.3H13.4", "M18.6 23.3H23.3V18.6",
       "M23.3 13.4V8.7H18.6", "M13.4 8.7H8.7V13.4"]
SMALL = ["M8.4 18.8V23.6H13.2", "M18.8 23.6H23.6V18.8",
         "M23.6 13.2V8.4H18.8", "M13.2 8.4H8.4V13.2"]

# px -> (paths, stroke width in grid units)
SIZES = {
    512: (BIG, 1.7),
    128: (BIG, 1.7),
    48: (BIG, 2.0),
    32: (BIG, 2.3),
    16: (SMALL, 3.0),
}


def svg(paths, width, px=32):
    """The mark as SVG. Geometry stays on the 32-unit grid; `px` only sizes the
    viewport, so the tile and the brackets always scale together."""
    body = "".join('<path d="%s"/>' % d for d in paths)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="%d" height="%d">'
        '<rect width="32" height="32" rx="%s" fill="%s"/>'
        '<g fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round" '
        'stroke-linejoin="round">%s</g></svg>'
        % (px, px, RADIUS, TILE, STROKE, width, body))


CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
FRAME = 640  # Chrome clamps very small windows, so always shoot big and crop


def render(markup, px, dest):
    """Rasterise one SVG through headless Chrome (no libcairo on this machine).

    The SVG is drawn at its true pixel size in the corner of a large window and
    the corner is cropped out, so every size is a 1:1 render of its own drawing
    rather than a resample of a bigger one.
    """
    from PIL import Image

    page = os.path.join(ICONS, "_tmp.html")
    shot = os.path.join(ICONS, "_tmp.png")
    with open(page, "w") as f:
        f.write("<!doctype html><html><head><meta charset='utf-8'>"
                "<style>html,body{margin:0;padding:0;background:transparent}"
                "svg{display:block}</style></head><body>%s</body></html>" % markup)
    subprocess.run([CHROME, "--headless", "--disable-gpu", "--hide-scrollbars",
                    "--force-device-scale-factor=1",
                    "--default-background-color=00000000",
                    "--window-size=%d,%d" % (FRAME, FRAME),
                    "--screenshot=" + shot, "file://" + page],
                   check=True, capture_output=True)
    Image.open(shot).convert("RGBA").crop((0, 0, px, px)).save(dest)
    os.remove(page)
    os.remove(shot)


def main():
    out = []
    for px, (paths, width) in sorted(SIZES.items(), reverse=True):
        name = "mark512.png" if px == 512 else "icon%d.png" % px
        render(svg(paths, width, px), px, os.path.join(ICONS, name))
        out.append("%s (%dpx, stroke %s)" % (name, px, width))

    # keep the large form as an editable source next to the bitmaps
    with open(os.path.join(ICONS, "mark.svg"), "w") as f:
        f.write(svg(BIG, 1.7))
    out.append("mark.svg")
    print("\n".join(out))


if __name__ == "__main__":
    main()
