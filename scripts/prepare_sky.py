#!/usr/bin/env python3
"""
Fetch and process the real sky assets the cinematic needs.

    python scripts/prepare_sky.py

Produces (into web/public/sky/):
    milkyway_4k.webp        equirectangular Milky Way panorama for the skybox
    brightstars.bin         real catalogued stars, packed for the GPU
    brightstars.meta.json   ranges + the named-star index for labels
    CREDITS.md              attribution, which both sources require

Both sources are real astronomical data, not decoration:

  Milky Way panorama - ESO/S. Brunier, GigaGalaxy Zoom project.
    6000x3000 equirectangular, CC BY 4.0. https://www.eso.org/public/images/eso0932a/

  Bright stars - HYG database v4.1 (Hipparcos + Yale BSC + Gliese), CC BY-SA 4.0.
    https://github.com/astronexus/HYG-Database

This matters for the project's credibility: the LMC field itself uses the simulated
GOG catalogue, and that is where the classification happens. Everything *around* it
- the galaxy backdrop, the named foreground stars - is real observational data. The
two are never mixed, and the UI says which is which.
"""

from __future__ import annotations

import csv
import gzip
import json
import math
import urllib.request
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "public" / "sky"
CACHE = ROOT / "assets" / "sky_cache"

ESO_PANORAMA = "https://cdn.eso.org/images/large/eso0932a.jpg"
HYG_URL = ("https://raw.githubusercontent.com/astronexus/HYG-Database/"
           "main/hyg/CURRENT/hygdata_v40.csv.gz")

SKYBOX_WIDTH = 4096          # 4096x2048 equirect: ample for a full-screen backdrop
MAG_LIMIT = 6.5              # naked-eye limit — beyond this nothing is individually visible
NAMED_MAG_LIMIT = 3.2        # only label stars a person could actually pick out


def download(url: str, dest: Path) -> Path:
    """Fetch once and cache. These are 8-13 MB; re-downloading on every run is rude."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        print(f"  cached {dest.name} ({dest.stat().st_size/1e6:.1f} MB)")
        return dest
    print(f"  downloading {url.rsplit('/', 1)[-1]} ...")
    req = urllib.request.Request(url, headers={"User-Agent": "LMC-Solution/1.0"})
    with urllib.request.urlopen(req, timeout=180) as r, open(dest, "wb") as f:
        f.write(r.read())
    print(f"  saved {dest.name} ({dest.stat().st_size/1e6:.1f} MB)")
    return dest


def build_skybox() -> None:
    from PIL import Image

    src = download(ESO_PANORAMA, CACHE / "eso0932a.jpg")
    img = Image.open(src).convert("RGB")
    print(f"  source {img.width}x{img.height}")

    # Equirectangular must stay exactly 2:1 or the projection shears.
    img = img.resize((SKYBOX_WIDTH, SKYBOX_WIDTH // 2), Image.LANCZOS)

    OUT.mkdir(parents=True, exist_ok=True)
    dst = OUT / "milkyway_4k.webp"
    img.save(dst, "WEBP", quality=88, method=6)
    print(f"  wrote {dst.relative_to(ROOT)} ({dst.stat().st_size/1e6:.2f} MB)")


def build_stars() -> None:
    src = download(HYG_URL, CACHE / "hygdata_v40.csv.gz")

    # csv.reader, not split(",") — the header is quoted ("id","hip",...) and several
    # columns contain quoted values, so naive splitting yields keys like '"ra"'.
    with gzip.open(src, "rt", encoding="utf-8", errors="replace", newline="") as f:
        reader = csv.DictReader(f)
        need = ("ra", "dec", "mag", "ci", "proper")
        missing = [c for c in need if c not in (reader.fieldnames or [])]
        if missing:
            raise SystemExit(f"HYG schema changed — missing {missing}\n"
                             f"got: {reader.fieldnames}")

        ras, decs, mags, cis, names = [], [], [], [], []
        for row in reader:
            try:
                mag = float(row["mag"])
            except (TypeError, ValueError):
                continue
            if mag > MAG_LIMIT:
                continue
            try:
                ra = float(row["ra"])     # hours
                dec = float(row["dec"])   # degrees
            except (TypeError, ValueError):
                continue
            try:
                ci = float(row["ci"])     # B-V colour index
            except (TypeError, ValueError):
                ci = 0.0

            # Row 0 is the Sun at the origin — meaningless as a background star.
            if row.get("proper", "").strip() == "Sol":
                continue

            ras.append(ra); decs.append(dec); mags.append(mag); cis.append(ci)
            proper = (row.get("proper") or "").strip()
            names.append(proper if (proper and mag <= NAMED_MAG_LIMIT) else "")

    ra = np.array(ras) * 15.0                    # hours -> degrees
    dec = np.array(decs)
    mag = np.array(mags, dtype=np.float32)
    ci = np.clip(np.array(cis, dtype=np.float32), -0.4, 2.0)
    print(f"  {len(mag):,} stars brighter than mag {MAG_LIMIT}")

    # Unit sphere. The skybox is infinitely far away, so direction is all that matters.
    ra_r, dec_r = np.radians(ra), np.radians(dec)
    x = (np.cos(dec_r) * np.cos(ra_r)).astype(np.float32)
    y = (np.cos(dec_r) * np.sin(ra_r)).astype(np.float32)
    z = np.sin(dec_r).astype(np.float32)

    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / "brightstars.bin", "wb") as f:
        for block in (x, y, z, mag, ci):
            f.write(block.tobytes())

    labelled = [
        {"name": n, "ra": round(float(ra[i]), 4), "dec": round(float(dec[i]), 4),
         "mag": round(float(mag[i]), 2),
         "xyz": [round(float(x[i]), 5), round(float(y[i]), 5), round(float(z[i]), 5)]}
        for i, n in enumerate(names) if n
    ]
    labelled.sort(key=lambda s: s["mag"])
    print(f"  {len(labelled)} named stars brighter than mag {NAMED_MAG_LIMIT}")
    print("  brightest:", ", ".join(s["name"] for s in labelled[:8]))

    meta = {
        "count": int(len(mag)),
        "blocks": ["x", "y", "z", "mag", "ci"],
        "dtype": "float32",
        "bytesPerStar": 20,
        "magLimit": MAG_LIMIT,
        "named": labelled,
        "source": "HYG Database v4.0 (Hipparcos/Yale/Gliese), CC BY-SA 4.0",
    }
    (OUT / "brightstars.meta.json").write_text(json.dumps(meta, separators=(",", ":")))
    size = (OUT / "brightstars.bin").stat().st_size
    print(f"  wrote brightstars.bin ({size/1e6:.2f} MB) + meta")


def write_credits() -> None:
    (OUT / "CREDITS.md").write_text(
        "# Sky asset credits\n\n"
        "Both sources require attribution. This file is served with the app and the\n"
        "credits are also shown in the cinematic's end card.\n\n"
        "## Milky Way panorama\n"
        "`milkyway_4k.webp` — 360-degree equirectangular panorama of the Milky Way.\n"
        "**Credit: ESO/S. Brunier**, GigaGalaxy Zoom project. Licensed CC BY 4.0.\n"
        "<https://www.eso.org/public/images/eso0932a/>\n"
        "Downscaled from 6000x3000 to 4096x2048 and re-encoded as WebP. No other changes.\n\n"
        "## Bright stars\n"
        "`brightstars.bin` — real catalogued stars brighter than magnitude 6.5, with\n"
        "IAU proper names for the brightest.\n"
        "**Credit: HYG Database v4.0** (Hipparcos, Yale Bright Star, Gliese), by David\n"
        "Nash / Astronomy Nexus. Licensed CC BY-SA 4.0.\n"
        "<https://github.com/astronexus/HYG-Database>\n\n"
        "## Gaia spacecraft model\n"
        "See `web/public/models/` — ESA SCIFLEET. Licence terms unconfirmed; a\n"
        "procedurally-built fallback ships as `gaia.glb`.\n\n"
        "## The LMC star field\n"
        "NOT from these sources. It is the simulated Gaia Object Generator catalogue\n"
        "used to train the classifier. The distinction is stated in the UI: real sky\n"
        "for the backdrop, simulation for the science.\n"
    )
    print(f"  wrote {(OUT / 'CREDITS.md').relative_to(ROOT)}")


def main() -> None:
    print("Milky Way skybox...")
    build_skybox()
    print("\nBright stars...")
    build_stars()
    print("\nCredits...")
    write_credits()
    print("\ndone.")


if __name__ == "__main__":
    main()
