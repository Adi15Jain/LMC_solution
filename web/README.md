# LMC Visualiser

Interactive 3D walkthrough of the LMC vs Milky Way classifier.
Full design rationale: [`../docs/WEB_VISUALIZATION_PLAN.md`](../docs/WEB_VISUALIZATION_PLAN.md).

## Setup

```bash
# 1. Export the data (from the project root, with .venv active)
python scripts/export_web_data.py

# 2. Export the model for in-browser inference (needed from Act 6 on)
pip install onnxmltools onnx onnxruntime
python scripts/export_onnx.py

# 3. Run the app
cd web && npm install && npm run dev
```

The export step writes into `web/public/`, which the app fetches at runtime:

```
public/data/stars.bin           250k stars, 4.5 MB
public/data/stars.preview.bin    25k stars, 0.45 MB  (paints first)
public/data/stars.meta.json      column ranges, counts
public/model/xgb_lmc.onnx        for the interactive probe only
```

## Architecture in one page

**The core mechanic.** One `THREE.Points` object holds all 250k stars. Each star
carries four positions as vertex attributes — sky, depth, proper-motion,
colour–magnitude — and a `uSpaceWeights` uniform blends between them in the vertex
shader. Morphing the entire field between coordinate systems is one lerp per vertex
and zero CPU work. See [`lib/shaders/starfield.ts`](lib/shaders/starfield.ts).

**Quantisation is free.** Position attributes are `int16` declared `normalized: true`,
so the GPU rescales to `[-1, 1]` in hardware — and that range *is* the plotting
coordinate. Nothing is dequantised in the hot path; `dequantise()` exists only for
tooltips.

**React owns the page, not the particles.** The point cloud is imperative. Scroll
position goes into Zustand and is read inside `useFrame` via `useStore.getState()`,
never through the subscribing hook — a `setState` per frame would re-render the tree
60×/sec.

```
app/page.tsx          scroll shell -> writes progress into the store
components/Scene.tsx  canvas host, two-tier progressive loading
components/StarField  the imperative point cloud + per-frame uniform easing
lib/spaces.ts         the four coordinate spaces and the nine acts
lib/loadStars.ts      zero-copy binary loader (mirrors export_web_data.py exactly)
lib/shaders/          GLSL for the morph
lib/onnx.ts           lazy-loaded single-star inference
lib/store.ts          Zustand
```

## Rules that keep it at 60fps

1. No per-star data in React.
2. No allocation inside `useFrame` — scratch objects live at module scope.
3. Uniforms, not props.
4. `onnxruntime-web` (~2 MB WASM) is dynamically imported, so it costs nothing
   until the user reaches Act 6.
5. `frustumCulled={false}` on the points — the bounding box is meaningless when
   the vertex shader computes position.

## Gotchas already handled

- **ONNX + browser:** the model must be converted with `zipmap: False` or
  onnxruntime-web throws `Non tensor type is temporarily not supported`. It works
  fine in Python either way, so this only ever fails in the browser. Handled in
  `scripts/export_onnx.py`. Session is pinned to the `wasm` backend — WebGL/WebGPU
  don't implement the `ai.onnx.ml` tree operators.
- **`.gitignore`:** the root pattern is anchored (`/data/`). A bare `data` would
  also match `web/public/data/` and silently swallow the exported binaries.
- **GPU picking:** `THREE.Points` + `setViewOffset` with a 1×1 render target picks
  incorrectly ([three.js #17257](https://github.com/mrdoob/three.js/issues/17257)).
  Read a 32×32 region around the cursor and take the nearest hit instead — which
  also makes single-pixel stars far less finicky to hover.

## Setup, step 2b

`scripts/export_analysis.py` produces `public/data/analysis.json` (~21 KB): the
threshold sweep, ROC/PR curves, feature importances and per-feature class
histograms. Run it whenever the model changes.

## Status

**Built:** nine acts with scroll-driven space morphing; interactive confusion matrix
over the held-out split with quadrant→cloud highlighting; threshold slider; feature
importances; per-feature class distributions ranked by Cohen's d; sandbox controls.

**Not built yet:** the ONNX probe (Act 6 interactivity — `lib/onnx.ts` is written but
unused), GPU picking / hover tooltips, camera choreography, the Gaia spacecraft model,
and the real-sky Cepheid/RR Lyrae act (blocked on notebook 03).
