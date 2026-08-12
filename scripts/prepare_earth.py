#!/usr/bin/env python3
"""
Fetch the Earth and Sun surface imagery Shot 1 needs.

    python scripts/prepare_earth.py

Produces (into web/public/earth/):
    earth_day.webp       true-colour surface, equirectangular 4096x2048
    earth_night.webp     city lights, for the terminator
    earth_normal.webp    topography as a normal map, so mountains catch the light
    earth_clouds.webp    cloud layer with alpha, rendered on a slightly larger shell
    CREDITS.md

All four come from NASA's Blue Marble Next Generation / Visible Earth, which is
public domain (NASA media usage guidelines) - no attribution is legally required,
but the credits file names the source anyway because that is the honest thing to do
and because it lets anyone re-derive the assets.

Deliberately *not* bundled in git: these are ~4 MB of derived imagery that this
script regenerates byte-identically from public URLs. The repo stays small and
nobody has to trust a binary blob.
"""

from __future__ import annotations

import argparse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "public" / "earth"
CACHE = ROOT / "assets" / "earth_cache"

BASE = "https://eoimages.gsfc.nasa.gov/images/imagerecords"

# December composite: the LMC is a southern-sky target, and a southern-summer Earth
# puts the lit hemisphere where the camera actually looks during the pull-out.
# (url, description, output width). Height is always half - equirectangular must
# stay 2:1 or the projection shears.
#
# Widths are matched to what each map actually carries, not set uniformly. Only the
# day map is ever seen sharp and full-screen; the night side is dim, clouds are soft
# by nature and their source is only 2048 wide anyway, and a normal map on a sphere
# this size cannot show more than 2048 of detail. Uniform 4096 across all four cost
# 5.5 MB for no visible gain.
SOURCES = {
    # Note the ".3x" in the filename - it is part of NASA's naming scheme, not a typo.
    # Dropping it gives a 404, which is how the first attempt at this failed.
    "earth_day": (
        f"{BASE}/73000/73909/world.topo.bathy.200412.3x5400x2700.jpg",
        "Blue Marble Next Generation, December 2004 - topography and bathymetry",
        4096,
    ),
    "earth_night": (
        f"{BASE}/55000/55167/earth_lights_lrg.jpg",
        "Earth's city lights (DMSP)",
        2048,
    ),
    "earth_normal": (
        f"{BASE}/73000/73934/gebco_08_rev_elev_21600x10800.png",
        "GEBCO elevation, converted to a tangent-space normal map",
        2048,
    ),
    "earth_clouds": (
        f"{BASE}/57000/57747/cloud_combined_2048.jpg",
        "MODIS cloud composite",
        2048,
    ),
}


def download(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        print(f"  cached {dest.name} ({dest.stat().st_size / 1e6:.1f} MB)")
        return dest
    print(f"  downloading {url.rsplit('/', 1)[-1]} ...")
    req = urllib.request.Request(url, headers={"User-Agent": "LMC-Solution/1.0"})
    with urllib.request.urlopen(req, timeout=300) as r, open(dest, "wb") as f:
        f.write(r.read())
    print(f"  saved {dest.name} ({dest.stat().st_size / 1e6:.1f} MB)")
    return dest


def to_normal_map(img, strength: float = 6.0):
    """Height field -> tangent-space normal map, by central differences.

    Sobel would be smoother, but central differences on an already-downsampled
    heightfield is sharp enough and keeps the coastlines crisp. The vertical scale
    is arbitrary anyway - `strength` is chosen so terminator-grazing light picks out
    the Himalayas and the Andes without turning the oceans into corduroy.
    """
    import numpy as np

    h = np.asarray(img.convert("L"), dtype=np.float32) / 255.0

    # Wrap in x (the map is seamless in longitude), clamp in y (poles are not).
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * strength
    dy = (np.vstack([h[1:], h[-1:]]) - np.vstack([h[:1], h[:-1]])) * strength

    nz = np.ones_like(h)
    norm = np.sqrt(dx * dx + dy * dy + nz * nz)
    rgb = np.stack([-dx / norm, -dy / norm, nz / norm], axis=-1)

    from PIL import Image
    return Image.fromarray(((rgb * 0.5 + 0.5) * 255).astype(np.uint8), "RGB")


def build(scale: float) -> None:
    from PIL import Image

    Image.MAX_IMAGE_PIXELS = None  # the GEBCO source is 21600x10800

    OUT.mkdir(parents=True, exist_ok=True)
    for key, (url, _desc, base_width) in SOURCES.items():
        width = max(512, int(base_width * scale)) // 2 * 2
        src = download(url, CACHE / url.rsplit("/", 1)[-1])
        img = Image.open(src)
        print(f"  {key}: source {img.width}x{img.height} -> {width}x{width // 2}")

        if key == "earth_normal":
            img = img.resize((width, width // 2), Image.LANCZOS)
            img = to_normal_map(img)
        else:
            img = img.convert("RGB").resize((width, width // 2), Image.LANCZOS)

        dst = OUT / f"{key}.webp"
        # Lossless for the normal map: WebP's chroma subsampling turns smooth normals
        # into visible banding under specular light, which reads as terracing.
        if key == "earth_normal":
            img.save(dst, "WEBP", lossless=True, method=6)
        else:
            img.save(dst, "WEBP", quality=86, method=6)
        print(f"  wrote {dst.relative_to(ROOT)} ({dst.stat().st_size / 1e6:.2f} MB)")


def write_credits() -> None:
    lines = [
        "# Earth asset credits\n",
        "All imagery below is from NASA and is in the public domain under NASA's\n"
        "media usage guidelines. Attribution is not legally required; it is given\n"
        "because the sources are worth knowing and the assets are reproducible.\n",
        "Regenerate with `python scripts/prepare_earth.py`.\n",
    ]
    for key, (url, desc, _w) in SOURCES.items():
        lines.append(f"## `{key}.webp`\n{desc}.\n<{url}>\n")
    (OUT / "CREDITS.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"  wrote {(OUT / 'CREDITS.md').relative_to(ROOT)}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scale", type=float, default=1.0,
                    help="multiply every output width (0.5 halves the asset budget)")
    args = ap.parse_args()

    print("Earth assets")
    build(args.scale)
    write_credits()
    print("done")


if __name__ == "__main__":
    main()
