# LMC vs Milky Way — Interactive Web Visualisation

**Goal.** Turn the classifier into something a person can *see*: a 3D, animated,
scroll-driven experience where you look at the same patch of sky Gaia looks at, watch
two galaxies separate out of one flat starfield, and understand *why* a model can tell
them apart — ending with the model making live predictions in your browser.

**What it has to prove.** Not just "I trained XGBoost." It has to show ML judgement
(honest metrics, deliberate feature choices, real-sky validation) *and* front-end
engineering (large-data rendering, GPU shaders, real-time inference, considered UX).

---

## Part 1 — Stack

Researched August 2026. Versions verified against npm/PyPI on the day of writing.

### The decisions, and why

| Layer | Choice | Why this, not the alternative |
|---|---|---|
| Framework | **Next.js 16.2** (App Router) + **React 19.2** + **TypeScript 7** | Static export to Vercel, zero server cost. The whole thing is precomputed data + client rendering. |
| 3D | **three.js r185** via **React Three Fiber 9.7** + **drei 10.7** | R3F for scene graph/composition; drop to raw three.js for the hot path (the point cloud is one imperative `THREE.Points`, *not* 250k React components). |
| Renderer | **WebGL2 first**, WebGPU as a later swap | See "Why not WebGPU yet" below. |
| Big-data render | **One `THREE.Points` + custom `ShaderMaterial`** | Not deck.gl — see below. |
| State | **Zustand 5.0** | Keeps scroll/UI state *out* of React re-renders; R3F reads it inside `useFrame`. The standard fix for R3F re-render storms. |
| Transitions | Scroll progress → shader uniforms (custom), **GSAP 3.15** for DOM/UI only | Uniform-driven morphs must not go through React state. |
| 2D charts | **Observable Plot 0.6** (+ D3 where custom) | Confusion matrix, ROC/PR curves, feature importance. Plot is 10 lines per chart. |
| In-browser ML | **onnxruntime-web 1.27**, WASM backend | Live "what-if" inference. Critical conversion gotcha below. |
| Data transport | **Custom packed binary** (quantised typed arrays) | Not Parquet — see below. |
| Python export | polars 1.42, numpy 2.5, xgboost 3.3 (already installed) + `onnxmltools`, `onnx` (to install) | Reuses the notebook environment. |

### Why not deck.gl

deck.gl renders millions of points beautifully and is the right tool for *geospatial
scatterplots*. But this project is a **cinematic narrative**: a satellite model, camera
choreography, particles morphing between coordinate systems, custom depth reveals.
That's three.js territory. deck.gl would fight us on camera control and force a
basemap-shaped mental model onto data that isn't geographic. One stack, not two.

### Why not WebGPU (yet)

WebGPU hit Baseline in January 2026 — Chrome, Edge, Firefox, Safari 26+, ~85% global
support. It's tempting and it's a great line on a portfolio.

**But the honest engineering read:** WebGPU's win is *compute* and *millions* of points.
We're rendering **250k points with a static vertex buffer** — that's unremarkable for
WebGL2, which will hold 60fps without breathing hard. Our real bottlenecks are network
payload and picking, and WebGPU fixes neither.

**Plan:** build on WebGL2, but keep all shader logic in `lib/shaders/` behind a thin
material factory. If we later want the WebGPU headline, port to TSL (three's node
system, compiles to both WGSL and GLSL) — a contained change, not a rewrite. Ship the
working thing first; upgrade if there's a reason beyond the buzzword.

### Why not Parquet / DuckDB-WASM

Both are excellent — DuckDB-WASM queries Parquet in-browser at near-native speed. But
they solve *ad-hoc analytics on unknown queries*. Our queries are known at build time,
so we precompute everything and ship the answers.

A packed binary of quantised typed arrays parses in **zero** time — `new Int16Array(buf)`
is a cast, not a parse. Parquet would add a ~1MB WASM decoder to first load to
decompress data we already knew the shape of.

**Keep in the back pocket:** if we add a "query the catalogue yourself" panel (SQL box
over the full 1.27M rows), DuckDB-WASM is exactly right and slots in independently.

---

## Part 2 — Data pipeline

### The budget problem

The training set is **1,269,704 rows** — 263 MB of CSV. That cannot go to a browser.

**Solution: stratified downsample + quantise.** 250,000 stars preserves every visual
structure (the proper-motion clump, the CMD sequences, the sky concentration) at
plotting densities where 1.27M would just be overplotted mush anyway.

### Binary format (`stars.bin`)

Planar layout — each attribute is a contiguous block, uploaded straight to a GPU
attribute buffer with no restructuring.

| Block | Type | Bytes/star | Contents |
|---|---|---|---|
| sky | `int16 × 2` | 4 | `ra`, `dec` |
| pm | `int16 × 2` | 4 | `pmra`, `pmdec` |
| cmd | `int16 × 2` | 4 | `bp_rp`, `phot_g_mean_mag` |
| plx | `int16 × 1` | 2 | `parallax` (for tooltips) |
| depth | `int16 × 1` | 2 | log distance from measured parallax |
| type | `uint8` | 1 | 0 = MW, 1 = LMC (truth) |
| prob | `uint8` | 1 | predicted P(LMC) × 255 |
| | | **18 B** | |

**250,000 × 18 B = 4.5 MB**, ~3 MB over the wire with Brotli.

`depth` is precomputed rather than derived in the shader because roughly half the
LMC stars have *negative* measured parallax — the flooring and log-scaling needed to
make that plottable is messy branching that belongs in Python, not a vertex shader.

Each block ships a `{min, max}` in a JSON sidecar (`stars.meta.json`). Dequantise **on
the GPU** — declare attributes `normalized: true` and apply `value * uScale + uOffset`
in the vertex shader. Zero CPU cost. int16 across the LMC field gives ~0.0008° in
position and ~0.0002 mas/yr in proper motion — far below Gaia's own measurement error,
so the quantisation is scientifically invisible.

### Progressive loading

Ship **two tiers**: `stars.preview.bin` (25k stars, ~400 KB) and `stars.bin` (250k).
Preview paints in well under a second; the full set streams in behind it and swaps.
The user never sees a spinner over an empty canvas.

### Predictions are precomputed, inference is interactive

An important split:

- **Every displayed star's probability is precomputed in Python** and baked into the
  `prob` byte. Colouring 250k stars by confidence is then a uniform flip — instant.
- **ONNX in the browser is only for the interactive probe**: the user drags one
  synthetic star through feature space, or moves sliders, and gets a live probability.
  One inference call on one row — milliseconds.

Doing it the other way round (250k live inferences on load) would be slow and pointless.

### ⚠️ Act 7 must show *held-out* errors, not training-set errors

A dry run of the export exposed this. Predicting over all 1.27M rows gives 99.57%
accuracy and 99.84% LMC recall — visibly better than the honest held-out numbers
(99.47% / 99.58%), because ~80% of those rows are ones the model trained on.

For most acts that's harmless. But Act 7 is *"where the model is wrong"* — and
showing training-set errors would understate the error rate in the one place we
explicitly claim to be honest. That would undercut the whole point of the act.

**Fix, and it has to happen in notebook 02:** save the test-split indices alongside
the model —

```python
np.save(OUT / "test_idx.npy", test_idx)   # from the same train_test_split
```

— then have the export sample **only from the test split** for the error view, and
label it "held-out test set (254k stars)" in the UI. Cheap to do at training time,
awkward to reconstruct afterwards, so do it while writing notebook 02.

### ⚠️ The ONNX conversion gotcha — verified, will cost you a day if missed

Converting XGBoost with default settings produces a model that **fails in the browser**
with the cryptic `Non tensor type is temporarily not supported`. The classifier's ZipMap
output node emits a map type that onnxruntime-web cannot handle.

**You must disable zipmap at conversion time:**

```python
onnx_model = convert_xgboost(
    clf,
    initial_types=[("input", FloatTensorType([None, 11]))],
    options={id(clf): {"zipmap": False}},   # ← without this, it dies in the browser
)
```

Tree ensembles work fine in onnxruntime-web's WASM backend otherwise (all `ai.onnx.ml`
operators are supported there — but *not* on the WebGL/WebGPU backends, so pin the
session to WASM explicitly).

### ⚠️ .gitignore will silently swallow the exported data

Current `.gitignore` line 7 is bare `data` — that pattern matches a directory named
`data` **at any depth**, so `web/public/data/` gets ignored and your exported binaries
never commit. Git also cannot re-include files inside an excluded directory, so a `!`
negation won't rescue it.

**Fix:** change `data` to `/data/` (anchored to repo root) before the first export.

---

## Part 3 — The experience

Nine acts, scroll-driven. The through-line: *you can't tell them apart → here's what the
satellite measures → in the right coordinate system they separate → a model learns that
boundary → it works on the real sky.*

### The core mechanic: one particle system, four coordinate spaces

This is the single most important idea in the build. **The same 250,000 particles never
get destroyed or recreated.** Each star carries all four of its positions as vertex
attributes, and a `uSpaceWeights` uniform blends between them in the vertex shader:

| Space | X, Y, Z | What it reveals |
|---|---|---|
| **Sky** | `ra`, `dec`, 0 | The observed view. Indistinguishable. |
| **Depth** | `ra`, `dec`, distance | The LMC recedes. The money shot. |
| **Proper motion** | `pmra`, `pmdec`, 0 | The LMC collapses into a tight clump. **The aha.** |
| **Colour–magnitude** | `bp_rp`, `g_mag` (inverted), 0 | Two different stellar sequences. |

Because it's a weight *vector* (not a scalar), any two spaces can cross-fade, and the
transition is a continuous physical morph — stars fly from their position on the sky to
their position in motion-space. **That flight is the entire argument of the project made
visible**, and it costs one lerp in a vertex shader.

### Act-by-act

**1. The hook — "which of these is not from around here?"**
The LMC field as Gaia sees it. Every star the same dim white. The user genuinely cannot
tell. Slow drift, no UI. One line of text: *~22% of these stars are in a different galaxy.*

**2. Gaia, and what it measures**
The spacecraft model appears, scanning. Callouts for the five measurements per star:
position, parallax, proper motion (×2), photometry. Establishes that the model gets
*measurements*, not labels.

**3. The depth reveal**
Camera pulls back; the flat starfield explodes into 3D as the sky space morphs to depth
space. The LMC pulls away to ~50 kpc.

> **Scientific honesty requirement.** We have no true Milky Way distances — only `Type`.
> So this act ships a **toggle**: *"Truth (schematic)"* places LMC on a far plane and MW
> on near planes and must be **labelled schematic in the UI**; *"What Gaia measures"*
> uses real `1/parallax`, which is a noisy mess with negative values. Showing that mess
> is a feature — it's why parallax scores 0.003 feature importance later. Do not let the
> pretty version imply we measured something we didn't.

**4. The aha — proper motion space**
Stars fly from sky coordinates into `pmra`/`pmdec`. The LMC collapses into a tight,
obvious clump. This is the emotional peak; hold it, let the user orbit it.

**5. Colour–magnitude**
Another morph. Two sequences, secondary signal. Y-axis inverted (magnitudes run backwards).

**6. The model learns the boundary**
Feature-importance bars animate in (`pm_total` 0.68, `pmdec` 0.17, `pmra` 0.09 — motion
is everything). A draggable probe star in pm-space with a live ONNX probability readout,
over a decision-boundary heatmap.

**7. The verdict**
Recolour all 250k by predicted probability. Interactive confusion matrix — click a cell,
those stars ignite in the 3D scene. **Click the false positives and watch exactly which
Milky Way stars sit inside the LMC's motion clump.** That's the most intellectually
honest moment in the piece and it's the one that'll get remembered.

**8. The real-sky test**
Swap the simulated stars for **4,485 Cepheids and 22,006 RR Lyrae** — confirmed LMC
members from actual Gaia observations. The model was trained on simulation; here it
meets real data. Show the recall. This is the act that separates the project from a
Kaggle notebook.

**9. Sandbox**
Free camera, space switcher, probability-threshold slider (watch precision/recall trade
off live), feature toggles, link back to the notebooks.

---

## Part 4 — Performance budget

Non-negotiable targets, measured on a mid-range laptop:

| Metric | Target |
|---|---|
| First contentful paint | < 1.5 s |
| Preview cloud interactive | < 2 s |
| Full 250k cloud loaded | < 5 s |
| Frame rate during morphs | 60 fps |
| Total JS (gzipped) | < 400 KB (excl. ORT WASM, lazy-loaded) |
| Total data | < 4 MB |

**Rules that keep us there:**

1. **Never put per-star data in React.** The point cloud is one imperative object,
   mutated in `useFrame`. React manages the *page*, not the particles.
2. **No allocation in the frame loop.** Preallocate vectors/matrices at module scope.
3. **Uniforms, not props.** Scroll drives a Zustand store read inside `useFrame`; it must
   not trigger a re-render.
4. **Lazy-load ORT.** The WASM runtime (~2 MB) loads only when the user reaches Act 6.
5. **Respect `prefers-reduced-motion`** — offer a click-through mode instead of scroll morphs.

### Picking (hover a star, see its values)

GPU picking: render star IDs as colours to an offscreen target, read back the pixel
under the cursor. **Known three.js bug** (issue #17257): `THREE.Points` + `setViewOffset`
with a 1×1 render target picks incorrectly. **Workaround:** read a 32×32 region around
the cursor and take the nearest non-empty hit — which also makes hovering single-pixel
stars far less finicky. Throttle to ~15 Hz; `readRenderTargetPixels` stalls the pipeline.

---

## Part 5 — Build phases

Sequenced so there's something demoable early and nothing is blocked on the ML.

| Phase | Deliverable | Depends on |
|---|---|---|
| **0** | Finish notebook 01 (exploration) | — |
| **1** | Notebook 02: train XGBoost, write `outputs/` | 0 |
| **2** | Notebook 03: validate on Cepheids/RR Lyrae | 1 |
| **3** | Export scripts: `stars.bin` + `model.onnx` | 1, 2 |
| **4** | Scaffold runs; 250k stars render in sky space at 60fps | 3 |
| **5** | The four-space morph shader | 4 |
| **6** | Scroll choreography, Acts 1–5 | 5 |
| **7** | ONNX probe + confusion matrix + Acts 6–7 | 3, 6 |
| **8** | Real-sky act (8) + sandbox (9) | 2, 7 |
| **9** | Polish: mobile, reduced-motion, a11y, deploy | 8 |

**Phase 5 is the risk.** Everything else is conventional work; the morph shader is where
the project either sings or falls flat. Prototype it in isolation with 10k random points
*before* wiring real data — if the morph doesn't feel good with fake data, real data
won't save it.

### Honest risk register

| Risk | Mitigation |
|---|---|
| Morph looks chaotic, not revealing | Prototype early (above). Stagger by index for a wave effect; ease per-star, not globally. |
| Mobile GPUs choke on 250k | Detect and drop to the 25k preview tier permanently on mobile. |
| ONNX zipmap failure | Already solved above — convert with `zipmap: False`, pin WASM backend. |
| Scroll-jacking feels awful | Every act reachable by direct nav; sandbox skippable from act 1. |
| Scope creep sinks it | Acts 1–5 + 7 are the core. Acts 8–9 are cuttable if time runs out. |

---

## Part 6 — What "good" looks like

If someone technical spends four minutes here, they should come away knowing:

- You understand the **astrophysics** (why proper motion separates and parallax doesn't).
- You made a **defensible modelling choice** (excluding `ra`/`dec` so the model learns
  physics rather than memorising a sky box) and can explain the trade-off.
- You report **honest metrics** — including where the model is wrong, clickable.
- You validated on **real observations**, not just a held-out split of simulated data.
- You can build a **performant, large-data 3D interface** — quantised binary formats,
  custom GLSL, GPU picking, in-browser inference — not just a chart library wrapper.

That combination is rare. The visualisation isn't decoration on the ML; it's the
argument that you understood the ML well enough to show it.

---

### Sources

- [Three.js in 2026: WebGPU, new workflows](https://www.utsubo.com/blog/threejs-2026-what-changed)
- [WebGPU is now supported in major browsers — web.dev](https://web.dev/blog/webgpu-supported-major-browsers)
- [deck.gl performance optimisation](https://deck.gl/docs/developer-guide/performance)
- [Three.js vs deck.gl](https://aircada.com/blog/three-js-vs-deck-gl)
- [onnxruntime-web: sklearn classifiers in the browser (zipmap fix)](https://github.com/microsoft/onnxruntime/discussions/9688)
- [ONNX Runtime Web tutorials](https://onnxruntime.ai/docs/tutorials/web/)
- [Convert a pipeline with an XGBoost model — sklearn-onnx](https://onnx.ai/sklearn-onnx/auto_tutorial/plot_gexternal_xgboost.html)
- [three.js GPU picking with 1×1 render target — issue #17257](https://github.com/mrdoob/three.js/issues/17257)
- [React Three Fiber + Next.js performance playbook](https://medium.com/@divyanshsharma0631/unlocking-the-third-dimension-building-immersive-3d-experiences-with-react-three-fiber-in-next-js-153397f27802)
- [High-performance data viz with DuckDB + Parquet](https://travishorn.com/high-performance-data-visualization-in-the-browser-with-duckdb-and-parquet/)
