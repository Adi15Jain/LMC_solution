# Sky asset credits

Both sources require attribution. This file is served with the app and the
credits are also shown in the cinematic's end card.

## Milky Way panorama
`milkyway_4k.webp` — 360-degree equirectangular panorama of the Milky Way.
**Credit: ESO/S. Brunier**, GigaGalaxy Zoom project. Licensed CC BY 4.0.
<https://www.eso.org/public/images/eso0932a/>
Downscaled from 6000x3000 to 4096x2048 and re-encoded as WebP. No other changes.

## Bright stars
`brightstars.bin` — real catalogued stars brighter than magnitude 6.5, with
IAU proper names for the brightest.
**Credit: HYG Database v4.0** (Hipparcos, Yale Bright Star, Gliese), by David
Nash / Astronomy Nexus. Licensed CC BY-SA 4.0.
<https://github.com/astronexus/HYG-Database>

## Gaia spacecraft model
See `web/public/models/` — ESA SCIFLEET. Licence terms unconfirmed; a
procedurally-built fallback ships as `gaia.glb`.

## The LMC star field
NOT from these sources. It is the simulated Gaia Object Generator catalogue
used to train the classifier. The distinction is stated in the UI: real sky
for the backdrop, simulation for the science.
