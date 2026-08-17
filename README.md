# Separating the Large Magellanic Cloud from the Milky Way

A membership classifier for stars observed by ESA's *Gaia* satellite: given a source's
astrometry and photometry, decide whether it belongs to the Large Magellanic Cloud —
a satellite galaxy 50 kpc away — or to the Milky Way foreground scattered in front of it.

The model is trained on a **simulation**. It is validated on the **real sky**. The gap
between those two things is what this project is actually about.

---

## The short version

Notebook 02 trains XGBoost on eleven tabular features and reports **PR-AUC 0.9992** and
**99.58% recall** on a held-out split. The methodology behind that number is sound: the split
is stratified, the 78/22 class imbalance is handled, recall and purity are reported rather
than accuracy, and sky position is deliberately excluded — with the exclusion *demonstrated*
rather than asserted, by training the cheating model anyway and showing it learned a
rectangle.

Then notebook 03 runs that model against 4,485 Cepheids and 22,006 RR Lyrae from real Gaia
EDR3, confirmed as LMC members by variability — a method that shares no feature with the
model.

It recovers **24% of the Cepheids**.

The remaining notebooks find out why, fix it, and measure the fix on data that was sealed
before any decision was made.

| | trained on simulation | real Cepheids | real RR Lyrae |
|---|---|---|---|
| **v1** — 11 features | PR-AUC 0.9992 | 24.5% | 77.3% |
| **v2** — 4 features | PR-AUC 0.9950 | **96.0%** | **79.2%** |

Real-sky figures are from the **sealed half**, with 95% Wilson intervals:
Cepheids 96.02% [95.13, 96.76], RR Lyrae 79.19% [78.41, 79.95].

---

## What went wrong, and how we know

Two properties of the simulation caused the failure, and neither is visible from inside it.

**Its LMC is faint.** The median simulated member sits at G = 18.98 and almost none of it is
as bright as a Cepheid, so in the training data *bright and precisely measured* means
foreground. The region of feature space real Cepheids occupy — G 15–17, `pmra_error`
0.02–0.06 — contains 173,784 training rows, 13.7% of the dataset, of which only **7.3%** are
LMC. The model is not extrapolating into the unknown; it is confidently interpolating into a
densely-populated region the simulation mislabels.

**Its LMC does not move.** Fitting the intrinsic proper-motion dispersion by requiring
χ² to follow χ²(2) gives **s = 0.0000 mas/yr** for the simulated LMC, against **0.385** for
the real one. Every simulated member sits at one velocity plus measurement noise. So "deviate
by more than your error bar and you are foreground" is the *optimal* rule on the training
data — and a real Cepheid measured to 0.039 mas/yr sits 0.375 from the mean, which is ten
sigma by that rule and unremarkable in a galaxy that rotates.

Together these explain the symptom notebook 03 measured: the model's tolerance in
proper-motion space was **0.2 mas/yr for Cepheids and 0.6–1.0 for RR Lyrae** — a factor of
three to five, between two populations of the same galaxy.

**Feature importance could not have caught it.** Gain is a sum over *training* rows, so it
measures contribution to training loss and knows nothing about deployment distributions. The
three measurement-error columns held 1.6% of the importance and most of the failure.
Adversarial validation — train a classifier to tell simulated LMC from real LMC; it scores
ROC-AUC 1.0000 and names the offending columns unprompted — is the tool that measures the
other property, and it is ten lines.

Two plausible explanations were tested and **rejected**: that gradient-boosted trees could not
extrapolate below their lowest split threshold, and that a derived dimensionless χ² feature
would repair the transfer. Both are kept in the record, because the reasoning that killed them
is the part that generalises.

---

## The notebooks

Each follows the same rhythm — *question → what I expect and why → code → what actually
happened → what it means*. Formulas are derived in the markdown, reimplemented in ~10 lines of
numpy, and asserted equal to the library's answer in the same cell.

| | | derivations verified against the library |
|---|---|---|
| **01** | Exploration — is the physics visible at all? | — |
| **02** | Baseline XGBoost, and proving sky position had to go | — |
| **03** | Real Gaia stars. The collapse. | average precision (incl. tied scores); Wilson interval, checked by coverage simulation |
| **04** | Diagnosis: three independent lines of evidence | XGBoost's leaf weight −G/(H+λ) and split gain, reproduced by hand from a stump |
| **05** | v2: what transfers and what does not | Mahalanobis → χ²(2); Brier/Murphy decomposition |
| **06** | The sealed half, error analysis, model card | — |

A detail worth the trouble: reproducing XGBoost's split gain by hand comes out **exactly half**
its reported value. Not an error — XGBoost drops the ½ from the paper's formula, and since it
drops it from every candidate split equally the arg-max is unaffected.

### The rule that makes the results mean something

The real catalogues were **halved into `dev` and `lock`** in notebook 03 §2, stratified on G
magnitude, *before anything was measured*. Every design decision — the diagnosis, the feature
set, the threshold — used `dev` only. `lock` was opened once, in notebook 06, and is the source
of every headline number.

This matters because the feature set was chosen by reading real-sky recall off a table, which
makes that recall a training signal. Without the sealed half, "96%" would be a training number
wearing a test number's clothes.

### Two things this project cannot tell you

- **Purity has never been measured against real foreground stars.** The validation catalogues
  contain only members, so recall is measurable and purity is not. Every purity figure here
  comes from a simulation now shown to be wrong in two specific ways.
- **Both validation catalogues are variable stars.** Performance on the LMC's ordinary stellar
  population is untested.

Both are in `outputs/v2_robust/card.json`.

---

## Layout

```
data/                       gitignored — the 251 MB training CSV and two Gaia catalogues
  processed/                parquet caches, built by scripts/build_cache.py
notebooks/                  01–06, executed with outputs
src/lmc/                    shared plumbing imported by notebooks AND export scripts
  io.py                     loading, cleaning, the whitespace-header repair, fingerprinting
  features.py               derived columns, pm_chi2, the candidate feature sets
  split.py                  train/test and dev/lock splits, saved with a label hash
  metrics.py                Wilson, average precision, Brier decomposition
  models.py                 the outputs/MODELS.json registry
outputs/
  v1_baseline/  v2_robust/  model, features, split, metrics, calibrator, model card
scripts/                    export_all.py and the individual exporters
web/                        Next.js + three.js visualiser (reads web/public/data/)
```

**The rule for `src/lmc/`:** if a reader would learn something from reading it, it stays in the
notebook; if a reader would only be annoyed by it, it lives in the package. Loading, splitting
and already-derived formulas live there — imported identically by the notebooks and the export
scripts, so the numbers on the website cannot drift from the numbers in the analysis. Every
model, every `.fit()`, every ablation and every derivation stays written out where it can be
read.

## Reproducing

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e .                       # pins polars 1.42, xgboost 3.3, sklearn 1.9, numpy 2.5
pip install -e ".[notebook]"

python scripts/build_cache.py          # 251 MB CSV -> parquet, once
jupyter lab                            # run notebooks 01 -> 06 in order

python scripts/export_all.py --skip-onnx     # regenerate everything web/ reads
```

Notebooks share no kernel, so state passes through **artifacts**: notebook 03 writes
`data/processed/real_lmc.parquet` with the dev/lock column, notebooks 02 and 05 write
`outputs/*/`, and `outputs/MODELS.json` is the registry every consumer resolves through.

`split.npz` carries a SHA-256 of the labels it was built from, and loading verifies it. The
export scripts used to re-derive the split from a seed, which reproduces the same rows only
while the row count *and* label ordering are byte-identical — change the cleaning step and the
app's "held-out" overlay silently becomes an arbitrary subset while every number on screen
still looks plausible. Three lines turn that into a stack trace.

## Data

- **Training** — Gaia Object Generator simulation, 1,269,704 rows after dropping one corrupted
  value (`pmra = "1.8598455n11059828"`, a stray `n` that types the whole column as text).
- **Validation** — Gaia EDR3 cross-matches for LMC Cepheids and RR Lyrae. The RR Lyrae export
  has eight whitespace-padded column names, one of which is `parallax_error`; 697 rows across
  both files lack an astrometric or photometric solution and are dropped explicitly rather than
  reaching XGBoost as untrained `NaN`s.
