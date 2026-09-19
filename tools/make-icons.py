#!/usr/bin/env python3
"""Render the app icons in icons/*.svg to the PNGs the manifest asks for.

Run from the repo root:  python tools/make-icons.py

The SVGs are the source of truth. They only use the handful of things this
renderer understands - a filled <rect> (with optional rx) and stroked <path>
elements made of straight M/L/H/V/Z segments - which is all a bin glyph needs.
Pillow is the only dependency.
"""

import math
import os
import re
import sys
import xml.etree.ElementTree as ET

from PIL import Image, ImageDraw

SVG_NS = "{http://www.w3.org/2000/svg}"
SS = 4  # supersampling factor, for clean edges

OUTPUTS = [
    ("icons/icon.svg", "icons/icon-192.png", 192),
    ("icons/icon.svg", "icons/icon-512.png", 512),
    ("icons/icon-maskable.svg", "icons/icon-maskable-512.png", 512),
    ("icons/icon-square.svg", "icons/apple-touch-icon.png", 180),
]


def tag(el):
    return el.tag.replace(SVG_NS, "")


def color(value, default=None):
    if not value or value == "none":
        return default
    value = value.strip()
    if value.startswith("#"):
        h = value[1:]
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (255,)
    raise ValueError("only #rgb / #rrggbb colours are supported, got %r" % value)


def parse_path(d):
    """Straight-line subset of the path grammar -> list of point lists."""
    tokens = re.findall(r"[MmLlHhVvZz]|-?\d*\.?\d+", d)
    subpaths, current = [], []
    x = y = 0.0
    cmd = None
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if re.match(r"[A-Za-z]", t):
            cmd = t
            i += 1
            if cmd in "Zz":
                if current:
                    current.append(current[0])
                    subpaths.append(current)
                    x, y = current[0]
                    current = []
                continue
        if cmd is None:
            raise ValueError("path data starts without a command: %r" % d)

        def num():
            nonlocal i
            v = float(tokens[i])
            i += 1
            return v

        if cmd in "Mm":
            nx, ny = num(), num()
            x, y = (x + nx, y + ny) if cmd == "m" else (nx, ny)
            if current:
                subpaths.append(current)
            current = [(x, y)]
            cmd = "l" if cmd == "m" else "L"  # extra pairs after M are lineto
        elif cmd in "Ll":
            nx, ny = num(), num()
            x, y = (x + nx, y + ny) if cmd == "l" else (nx, ny)
            current.append((x, y))
        elif cmd in "Hh":
            nx = num()
            x = x + nx if cmd == "h" else nx
            current.append((x, y))
        elif cmd in "Vv":
            ny = num()
            y = y + ny if cmd == "v" else ny
            current.append((x, y))
        else:
            raise ValueError("unsupported path command %r - keep the glyph straight-lined" % cmd)
    if current:
        subpaths.append(current)
    return subpaths


def stroke(draw, points, width, fill, round_caps):
    pts = [(round(px), round(py)) for px, py in points]
    if len(pts) == 1:
        pts = pts * 2
    draw.line(pts, fill=fill, width=int(round(width)), joint="curve")
    # Pillow has no cap style; paint the joins and ends as discs.
    r = width / 2.0
    ends = pts if round_caps else []
    for px, py in ends:
        draw.ellipse([px - r, py - r, px + r, py + r], fill=fill)


def inherited(el, parents, name, default=None):
    for node in [el] + parents[::-1]:
        v = node.get(name)
        if v is not None:
            return v
    return default


def render(svg_path, size):
    root = ET.parse(svg_path).getroot()
    vb = [float(v) for v in re.split(r"[ ,]+", root.get("viewBox").strip())]
    scale = size * SS / vb[2]
    img = Image.new("RGBA", (size * SS, size * SS), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    def walk(el, parents):
        for child in el:
            name = tag(child)
            if name == "g":
                walk(child, parents + [child])
                continue
            if name == "rect":
                x = float(child.get("x", 0)) * scale
                y = float(child.get("y", 0)) * scale
                w = float(child.get("width")) * scale
                h = float(child.get("height")) * scale
                rx = float(child.get("rx", 0)) * scale
                fill = color(inherited(child, parents, "fill"), (0, 0, 0, 255))
                if rx:
                    draw.rounded_rectangle([x, y, x + w, y + h], radius=rx, fill=fill)
                else:
                    draw.rectangle([x, y, x + w, y + h], fill=fill)
            elif name == "path":
                sc = color(inherited(child, parents, "stroke"))
                if not sc:
                    continue
                sw = float(inherited(child, parents, "stroke-width", "1")) * scale
                caps = inherited(child, parents, "stroke-linecap", "butt") == "round"
                for sub in parse_path(child.get("d")):
                    stroke(draw, [(px * scale, py * scale) for px, py in sub], sw, sc, caps)
            elif name in ("title", "desc", "metadata"):
                continue

    walk(root, [root])
    return img.resize((size, size), Image.LANCZOS)


def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(here)
    for src, dest, size in OUTPUTS:
        if not os.path.exists(src):
            print("missing %s" % src, file=sys.stderr)
            return 1
        img = render(src, size)
        img.save(dest, "PNG", optimize=True)
        print("%-34s %4dx%-4d %6d bytes" % (dest, size, size, os.path.getsize(dest)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
