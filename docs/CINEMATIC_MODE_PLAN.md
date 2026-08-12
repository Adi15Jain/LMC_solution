# Cinematic Mode — Plan

A directed, play-through sequence: the camera starts at Gaia in deep space, follows the
telescope's line of sight out to the Large Magellanic Cloud, and watches the classifier
resolve one flat smear of light into two galaxies at two distances.

Separate route (`/cinematic`) with a **timeline**, not scroll. The existing scroll
explorer stays exactly as it is — this is the guided cut, that's the sandbox.

**Ground rule for this document:** every number on screen is either a measured value from
the dataset, a published measurement with a citation, or a model output labelled as an
inference. Nothing is invented for looks.

---

## Part 0 — The one problem that decides the whole design

You want stars "marked in space as per the distance." Before anything else is built, this
has to be settled honestly, because **we do not have distances for the LMC.**

I measured it on the actual data:

| | Milky Way | LMC |
|---|---|---|
| Stars | 992,527 | 277,177 |
| **Negative** measured parallax | 11.6% | **46.9%** |
| Parallax SNR > 3 (usable) | **43.3%** | **0.2%** |
| Usable distance range | 0.33 – 2.73 kpc | — |

The LMC's true parallax at 49.59 kpc is **0.0202 mas**. The median parallax error in this
dataset is **0.2876 mas**. The signal is **14× smaller than its own error bar** — SNR ≈ 0.07.
Nearly half the LMC's measured parallaxes come out *negative*, which would place those
stars behind the observer.

So: placing every star at `1/parallax` produces garbage, and quietly faking LMC distances
would be exactly the kind of thing that gets a portfolio project dismissed.

### The fix — and it's better than the naive version

Turn the problem into the story. Three beats:

1. **Place by measurement.** Every star at `1/parallax`. The Milky Way foreground resolves
   beautifully — 430,000 stars with real, honest distances from 0.3 to 2.7 kpc. The LMC
   explodes into noise, half of it flying behind the camera. Caption: *this is what
   measurement alone gives you.*
2. **The model looks elsewhere.** Proper motion and photometry only — never position,
   never parallax as a primary. The LMC's stars are revealed to share one bulk motion.
3. **Re-place by inference.** The classified LMC stars collapse onto a shell at
   **49.59 ± 0.09 (stat) ± 0.54 (sys) kpc** ([Pietrzyński et al. 2019, *Nature*](https://arxiv.org/abs/1903.08096)),
   while Milky Way stars keep their measured parallax distances. Caption, permanently
   on screen during this beat: *LMC depth is inferred from classification, not measured.*

That sequence is dramatic **and** true. The mess in beat 1 is the reason the model exists,
and it's why parallax scores 0.003 feature importance — a fact the visual now earns rather
than asserts.

---

## Part 1 — Shot list

Nine shots, ~3m40s at default pace. Every shot is skippable and scrubbable.

### Shot 1 — L2 (0:00–0:25)
Gaia against the star field, sunshield edge-on, rim-lit by a distant Sun. Slow camera
orbit. HUD fades in with real spacecraft facts: 10 m sunshield, 2,029 kg at launch,
1.5 million km from Earth at the L2 Lagrange point.

### Shot 2 — The scan (0:25–0:55)
Gaia spins on its axis — **one revolution per 6 hours**, spin axis precessing around the
Sun every **63 days**, sunshield locked at 45° to the Sun. Two translucent view cones
emerge from the payload, **106.5° apart**. As they sweep, faint stars flare where the
fields cross them. This is the actual survey strategy, animated.

### Shot 3 — Down the boresight (0:55–1:15)
Camera pushes into one aperture and keeps going — through the optics, out along the line
of sight. Star field streaks past. A distance ticker runs up in parsecs. The transition
sells the physical connection between instrument and data.

### Shot 4 — The flat field (1:15–1:35)
Arrival. The LMC field as Gaia records it: 250,000 stars, all one colour, no depth.
Indistinguishable. Same view as the explorer's opening act.

### Shot 5 — Depth by measurement (1:35–2:05) **← the honest mess**
Stars pull out along the line of sight at `1/parallax`. The Milky Way resolves into a real
foreground. The LMC shatters — a smear from near-field to nonsense, 47% of it inverted
behind the camera. Readout: *LMC parallax SNR = 0.07. The measurement cannot see this far.*

### Shot 6 — Proper motion (2:05–2:40) **← the money shot**
Every star grows a short vector showing its **actual measured `pmra`/`pmdec`**, scaled and
exaggerated for legibility (scale factor stated on screen). The Milky Way's arrows point
every direction. The LMC's arrows are **all parallel** — one galaxy, one bulk motion,
visible as pure geometry. No model, no labels, just the data.

### Shot 7 — Classification (2:40–3:05)
A sweep passes through the field. Star by star, the 11 features feed the classifier and a
probability comes back; stars ignite blue (Milky Way) or orange (LMC). The telemetry table
(Part 3) streams real records as they're processed.

### Shot 8 — Resolution (3:05–3:25)
The classified LMC contracts onto the 49.59 kpc shell; the Milky Way holds its measured
foreground. For the first time the scene is two clean, separated structures. Persistent
label: *LMC depth inferred from classification.*

### Shot 9 — The verdict (3:25–3:40)
Camera pulls back. Held-out metrics resolve on screen: 253,941 test stars, recall 99.58%,
precision 98.04%, contamination 0.56%. The 1,106 false positives light up red *in place* —
Milky Way stars sitting inside the LMC's motion clump. Ends on the interactive confusion
matrix, handing off to the explorer.

---

## Part 2 — Blender

### Status: built and verified

Running on **Blender 5.3.0 Alpha** (build 2026-08-04). The whole 5.x API surface this
script touches turned out unchanged — `Base Color` / `Metallic` / `Roughness` /
`Emission Color` / `Emission Strength` all still exist on Principled BSDF, and every
Draco export flag is present. The script introspects both anyway
(`--dump-api` prints what a given build actually exposes), so a future rename degrades
to a warning instead of a crash.

One deprecation to watch: `Material.use_nodes` and `World.use_nodes` are flagged for
removal in Blender 6.0.

**Exported: `web/public/models/gaia.glb` — 386 KB**, Draco-compressed, 102 meshes,
7 materials, single `Gaia` root node so the app can drive the 6-hour spin from one
transform and precess its parent.

The model is built to match ESA reference photography, not to a mental image: a
*silver crinkled MLI* dodecagon carrying 12 gold thermal panels and 36 radial ribs,
under a *dark* payload tent with gold trim rings, a flared skirt, an overhanging pale
cap, and telescope apertures **boolean-cut** through the hull. Layering dark panels
over a closed shell never reads as an opening — the geometry has to be absent.

The payload tent carries the detail that makes it read as hardware rather than a can:
a polished band under the cap, gold trim and panel seams, an ornate gold surround with
a protruding instrument bay at each aperture, and seeded foil patches and equipment
boxes. The cap is a 16-facet cone with an apex mast — its low facet count is deliberate,
since the seams *are* the radial panel joins.

Preview renders: `blender --background --python scripts/blender/preview_gaia.py -- --out <path>`
Add `--space` for the dark-scene lighting the cinematic will actually use — Principled metals have no diffuse response, so `metallic = 1.0` surfaces render black in a void unless the scene gives them something to reflect. Budget an environment map for Shots 1-3.

### Do NOT model the stars in Blender

Worth stating plainly because it's the expensive mistake here: the stars stay as GPU
points in the existing shader. 250,000 meshes would be four orders of magnitude beyond
what a browser can draw. **Blender is for the spacecraft and set pieces only.**

### The ESA model (now in use)

Downloaded from [scifleet.esa.int](https://scifleet.esa.int): `gaia.fbx` (29 MB) plus a
4K PBR texture set (43 MB). Converted by `scripts/blender/convert_esa_gaia.py` to
**`web/public/models/gaia_esa.glb` — 1.27 MB**.

It is a game-ready low-poly asset: **45,634 triangles** with the detail baked into
normal maps, so no decimation was needed. The converter rebuilds materials from the
delivered maps (BaseColor / Metallic / Roughness / Normal / Emissive), downscales
4K → 2K, exports Draco + WebP, strips the authoring leftovers the FBX ships (a camera,
a sky and a render rig), and normalises the arbitrary 197-unit authoring scale to a
10 m sunshield with the origin on the spin axis — the same convention `build_gaia.py`
uses, so the two models are interchangeable in the scene.

Watch for this if you re-run it: the FBX importer wraps the meshes in empties carrying
a -90° X axis conversion. Re-parenting without `CLEAR_KEEP_TRANSFORM` drops that and
lays the spacecraft on its side.

**Licence is still unconfirmed** — the SCIFLEET pages state no terms. `build_gaia.py`
remains committed as a licence-clean fallback (386 KB, one command to regenerate) in
case reuse rights don't come through.

Source assets live in `assets/` and are gitignored (73 MB); the 1.27 MB `.glb` is what
ships.

### Build it procedurally, as a script

`scripts/blender/build_gaia.py` (written, see below) generates the model from primitives
and exports glTF. Run headless:

```bash
blender --background --python scripts/blender/build_gaia.py -- \
        --out web/public/models/gaia.glb
```

Why a script rather than a `.blend`:

- **Reproducible** — regenerate identically, tweak one constant and re-export.
- **Git-friendly** — a 12 KB diffable `.py` instead of a binary blob.
- **Unambiguously yours** — no licence question.
- **Parameterised by real specs** — the dimensions in the file are the published ones.

### What gets modelled, from published specs

| Part | Spec | Source |
|---|---|---|
| Deployable Sunshield Assembly | 10 m diameter, 12-sided, 45° to Sun | ESA/Wikipedia |
| Service module | 4.6 m × 2.3 m envelope, hexagonal | ESA |
| Payload thermal tent | hexagonal dome housing the optical bench | ESA |
| Telescope apertures | 2, separated by **106.5°** | ESA |
| Primary mirrors | 1.45 × 0.5 m each | ESA |
| Focal plane | 1.0 × 0.5 m, 106 CCDs, 937.8 megapixels | ESA |

### Budget

| Asset | Target | Actual |
|---|---|---|
| `gaia.glb` (Draco-compressed) | < 800 KB | **386 KB** |
| Triangles | < 60k | ~11k |
| Textures | prefer none | none — pure PBR materials |

Prefer **no textures at all** — flat PBR materials (gold foil = metallic 1.0 / roughness
0.35, solar cells = dark blue, rough 0.2). Saves the entire texture budget and reads
cleanly at the distances the camera actually uses.

---

## Part 3 — The data readout ("the matrix of actual values")

Two surfaces, both showing real values only.

### A. Star inspector (hover / click)

Requires GPU picking. Panel shows that star's actual record:

```
STAR #147,203                          ● LMC   P = 0.9971
─────────────────────────────────────────────────────────
POSITION      ra          81.4472°     dec       −69.8103°
MOTION        pmra        1.8412 ± 0.1133 mas/yr
              pmdec       0.4127 ± 0.1011 mas/yr
              pm_total    1.8868 mas/yr
DISTANCE      parallax   −0.0943 ± 0.2038 mas    SNR −0.46
              → unusable; depth inferred, not measured
PHOTOMETRY    G  13.3949    BP 13.8422    RP 12.7582
              BP−RP  1.0840
─────────────────────────────────────────────────────────
TRUTH  LMC          PREDICTED  LMC          ✓ correct
```

Note the SNR line: it tells the truth per star rather than hiding it. On a star whose
parallax *is* usable it flips to `→ 1.07 kpc (measured)`.

**Picking gotcha** (already logged in the main plan): `THREE.Points` + `setViewOffset` with
a 1×1 render target picks wrong ([three.js #17257](https://github.com/mrdoob/three.js/issues/17257)).
Read a 32×32 region around the cursor and take the nearest hit.

### B. Live telemetry (Shot 7)

A mission-control style table streaming ~12 rows/sec during the classification sweep —
real records, not decoration. Columns: `id · pmra · pmdec · parallax · G · BP−RP · P(LMC) · class`.
Rows tint blue/orange as they resolve. Running counters for processed / LMC / MW.

The whole point: it demonstrates the model consuming actual feature vectors, not a
progress bar pretending to be one.

---

## Part 4 — Technical build

### Route and structure

```
app/cinematic/page.tsx          timeline shell, transport controls
components/cinematic/
  Timeline.ts                   shot definitions, keyframes, easing
  CameraRig.tsx                 keyframed camera, damped follow
  Gaia.tsx                      glTF load, spin + precession animation
  ScanCones.tsx                 the two 106.5° view volumes
  MotionVectors.tsx             per-star proper-motion streaks
  Telemetry.tsx                 streaming record table
  Inspector.tsx                 per-star readout (needs picking)
lib/picking.ts                  GPU picking, 32×32 readback
lib/cinematicTimeline.ts        time -> uniform/camera state
```

### The timeline is the camera, not the scroll

One `time` value in seconds drives everything. Shots declare keyframes; a pure function
maps `time → {camera pose, space weights, colour weights, depth mode, star scale}`. That
function is testable in isolation, and scrubbing is free because it's stateless.

Transport: play/pause, scrub bar, per-shot chapter marks, speed (0.5× / 1× / 2×), and a
**skip to explorer** button on every frame.

### Proper-motion vectors without a second draw call

Reuse the existing point cloud. Add a second `THREE.LineSegments` sharing the same
attribute buffers, where the vertex shader places vertex A at the star and vertex B at
`star + pm * uVectorScale`. Same data, no duplication, one extra draw call for all 250k
vectors. Fade in via `uVectorScale` from 0.

For legibility, only draw vectors for a **stratified 20k subset** — 250k arrows is soup.
State the subset size and the exaggeration factor on screen.

### Depth placement, in code

```
distance_kpc =
  if mode == "measured":          1 / max(parallax, floor)     # honest, messy
  if mode == "inferred":
      predicted == LMC  ->        49.59                        # Pietrzyński 2019
      predicted == MW   ->        1 / parallax  if SNR > 3      # real measurement
                                  else schematic foreground     # labelled
```

Precompute both depths into the binary as two more `int16` blocks (+4 bytes/star,
250k → +1 MB). Blend between them with a uniform, exactly like the space morph.

### Performance

Cinematic mode is heavier than the explorer — a glTF model, view cones, 20k line
segments, streaming DOM. Budget:

| | Target |
|---|---|
| Frame rate during shots | 60 fps |
| `gaia.glb` | < 800 KB |
| Added data (depth blocks) | < 1 MB |
| Telemetry DOM rows retained | 40 max (recycle, never grow) |

The telemetry table is the sneaky risk: appending 12 rows/sec for 25 seconds unbounded is
300 nodes and layout thrash. Cap it, recycle nodes, and never animate `height`.

---

## Part 5 — Phases

| Phase | Deliverable | Blocks on |
|---|---|---|
| **C0** | Install Blender; run `build_gaia.py`; inspect `gaia.glb` | Blender install |
| **C1** | `/cinematic` route, timeline engine, transport UI | — |
| **C2** | Camera rig + Shots 4–6 (reuses existing point cloud) | C1 |
| **C3** | Gaia model, spin/precession, scan cones — Shots 1–3 | C0, C2 |
| **C4** | Dual-depth export + Shots 5 & 8 (measured ↔ inferred) | C2 |
| **C5** | GPU picking + star inspector | C2 |
| **C6** | Telemetry stream + Shot 7 | C5 |
| **C7** | Shot 9, handoff to explorer, polish, reduced-motion cut | all |

**Start at C1/C2, not C0.** Shots 4–6 need no new assets at all — they run on the point
cloud that already works. Get the timeline and the proper-motion vectors feeling right
first; if the motion-vector shot doesn't land, no amount of spacecraft modelling saves the
sequence. Blender work is Phase C3 and can happen in parallel with someone else's time.

### Risks

| Risk | Mitigation |
|---|---|
| Motion-vector shot reads as noise | Prototype at 20k first; tune exaggeration before committing to the shot |
| Blender model eats a week | Script is written and parameterised; timebox to one day, fall back to primitives in Three.js |
| Cinematic diverges from explorer | Both read the same store and the same shader — one source of truth for colour/space |
| 3m40s is too long | Every shot skippable; chapter marks; explorer reachable from any frame |
| Reduced-motion users | Provide a static keyframe gallery with the same captions |

---

## Part 6 — What must stay on screen

Non-negotiable captions, because they're what separate this from a pretty tech demo:

1. **"LMC depth inferred from classification, not measured"** — during Shots 8–9.
2. **"Proper motion exaggerated ×N for visibility"** — during Shot 6.
3. **"Held-out test set — 253,941 stars"** — during Shot 9.
4. **"ra/dec excluded from features"** — wherever the model is described.

Each one is a place where a viewer could reasonably assume something false. Saying it
plainly costs a line of text and buys the entire project credibility.
