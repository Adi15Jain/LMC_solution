# Data Exploration Plan — 01

A map for exploring `LMC+MW_GOG_trainingset_frac=0.2.csv` before any modelling.
The goal of notebook 01 is **not** to model anything — it's to _see_ whether the
physics that separates LMC from Milky Way stars is actually visible in the data.
If it is, notebook 02's classifier is justified. If it isn't, we stop and rethink.

Work top-to-bottom; each step answers one question and sets up the next.

---

## 0. Load cleanly — and don't trust the first load

**Question:** did the data come in as numbers?

Load with Polars (`pl.read_csv`). Then immediately check the dtypes — do **not**
assume they're numeric.

> ⚠️ **The trap in this file.** Row 11 has `pmra = 1.8598455n11059828` — a stray
> `n` where an `e`/`-` belongs. One bad character forces Polars to read the whole
> `pmra` column as **string**, which silently breaks every calculation and every
> plot that touches proper motion. Your current first cell prints `pmra` — you're
> looking at text, not floats, right now.

**Do this:** cast every column except `Type` to `Float64` with `strict=False`
(an unparseable value becomes null), then `drop_nulls`. You'll drop exactly 1 row
of 1.27M. Print how many you dropped and confirm every dtype is now numeric — that
line is the evidence you cleaned it, not a silent fix.

---

## 1. Shape and columns

**Question:** what are we working with?

- Print `df.shape` — expect ~1,269,704 rows × 12 columns.
- List each column with its dtype, and say in one line what each _means_ physically:
  position (`ra`, `dec`), proper motion + errors (`pmra`, `pmdec`, and `_error`),
  three-band photometry (`phot_g/bp/rp_mean_mag`), parallax + error, and the label
  `Type`.

This is orientation, not analysis — but it's where you catch a wrong column or a
misread dtype early.

---

## 2. Label balance

**Question:** how lopsided are the classes?

Count `Type == 0` (Milky Way) vs `Type == 1` (LMC), as raw counts **and** percentages.

Expect **~78% Milky Way / ~22% LMC**. This matters later: a model that always
guesses "Milky Way" is 78% accurate while catching zero LMC stars. Note the
imbalance here so notebook 02's `scale_pos_weight` isn't a surprise.

---

## 3. Summary statistics

**Question:** are the value ranges physically sane?

Run `.describe()` on the numeric features, but read it with intent — look at:

- **`parallax`** — mean should sit near 0 (the LMC is far), with a spread.
- **proper motion** — check the range of `pmra`/`pmdec`; note that the error
  columns are much smaller than the values (measurements are trustworthy).
- **magnitudes** — should fall in a believable Gaia band (~roughly 10–21).

You're building a gut feel for "normal" so an outlier later is obvious.

---

## 4. Missing values

**Question:** is anything actually missing?

Run a per-column null count.

> Note the honesty point: **after** the step-0 cast, the data is genuinely clean.
> Don't repeat the reference's "no missing values" claim on the _raw_ load — that's
> only true because the bad `pmra` hid as text. The clean bill of health is earned
> _after_ you coerce and drop.

---

## 5. THE key plot — proper motion (pmra vs pmdec)

**Question:** does the LMC move as one coherent blob?

This is the single most important view in the whole notebook. Scatter `pmra` vs
`pmdec`, colouring LMC over Milky Way.

- **Sample first** — 1.27M points is unreadable and slow. Take a random ~60k rows
  with a _seeded_ RNG (`np.random.default_rng(0)`) so the plot is reproducible.
- Plot Milky Way underneath (grey, low alpha), LMC on top (orange).
- **What you're hoping to see:** the orange LMC points form a _tight, distinct
  clump_ (the galaxy's shared bulk motion) while grey MW points scatter broadly.

If that clump is there, you've visually proven the strongest signal in the data —
this is why the eventual model leans ~85% on proper motion.

---

## 6. Parallax distribution

**Question:** is the LMC "far" in the way physics predicts?

Overlaid histograms of `parallax`, one per class, density-normalised, on a sensible
x-range (roughly -2 to 4).

- **Expect:** LMC = a sharp spike at ~0 (so distant its parallax is unmeasurable);
  Milky Way = a broader distribution leaking toward positive values (nearer stars).
- Reality check: the overlap is large and parallax errors are big at this distance,
  so this is a _weaker_ separator than proper motion. Good to see that now — it
  explains why parallax barely registers in feature importance later.

---

## 7. Colour–magnitude diagram

**Question:** do the two populations trace different stellar sequences?

Form `bp_rp = phot_bp_mean_mag - phot_rp_mean_mag` (blue − red, a temperature proxy)
and plot it against `phot_g_mean_mag` on the same 60k sample.

- **Invert the y-axis** — astronomical magnitudes run backwards (smaller = brighter).
- Look for the two classes tracing visibly different tracks. It's extra signal
  beyond motion and distance, even if subtler.

---

## 8. On-sky map (ra vs dec)

**Question:** is the LMC concentrated on the sky?

Scatter `ra` vs `dec` for both classes (reuse the 60k sample).

- **Expect:** LMC = a concentrated clump; Milky Way = spread more evenly.
- **Important caveat to write down:** this is exactly _why we will NOT feed
  `ra`/`dec` to the model._ Position lets a classifier memorise a sky box —
  great scores, zero physics, and it fails on real LMC stars in the outskirts.
  Look at the clump here, then deliberately leave it out of the features.

---

## 9. Conclusions

Close with 3–5 bullets stating what you _actually saw_ (not what you expected):

- Dataset is large (~1.27M rows) and clean _after_ fixing the one corrupt value.
- Classes are imbalanced ~78/22 — account for it when training.
- Proper motion is the strong, obvious separator (the clump is real).
- Parallax and colour add weaker, secondary signal.
- The LMC is spatially concentrated — noted, and deliberately excluded as a feature.

End with the handoff: _these features should separate the classes → notebook 02
trains and measures a baseline on them._

---

### Practical notes

- **One sample, reused.** Draw the ~60k index once (seeded) and reuse it for every
  scatter plot — consistent, fast, reproducible.
- **Say what you expect before each plot, then whether you saw it.** That framing
  is what turns "I made a chart" into "I confirmed the physics."
- **Don't over-plot.** Low alpha + small point size; put the majority class
  underneath the minority.
- Features that will matter downstream: `pmra`, `pmdec`, `pm_total` (derived),
  `parallax`, the three `_error`s, three magnitudes, `bp_rp` (derived). `ra`/`dec`
  are explored here but **not** used as model inputs.
