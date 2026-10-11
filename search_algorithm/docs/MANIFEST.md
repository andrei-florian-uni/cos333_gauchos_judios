# MANIFEST — Name-search instrument experiments (Gauchos Judíos)

You are running the experiments that will select the name-search instrument for the Gauchos Judíos cemetery archive (COS 333). The authoritative specification is the experiment design PDF at `docs/name_search/experiment_design.pdf`. This manifest turns that design into concrete steps, file formats and deliverables. Read the PDF first. Where this manifest and the PDF disagree, follow this manifest and log the difference in the report's deviations section.

Work on a branch called `name-search-experiments` and open a pull request at the end. Never push to `main`.

---

## 0. Ground rules

1. **The test split stays sealed until Experiment 4.**
   - Preparation writes the test person IDs to `search_eval/eval/splits.csv`.
   - Code for Experiments 1–3 must load only development persons, and must `assert` that no test ID appears in any index, dictionary or query file.
   - Experiment 4 may read the test split only after `results/frozen_config.json` has been committed.
2. **Determinism.**
   - Use seed `333` for every random step: splits, typos, sampling, bootstrap.
   - Every run must be reproducible from one command: `python -m search_eval.run --stage all`.
3. **Unavailable components are recorded and skipped.**
   - If a model, weights file, API key or system package cannot be obtained, don't substitute an alternative silently.
   - Write a `status = not_run:<reason>` row for each affected configuration in `metrics.csv` and continue.
4. **Never modify `ocr_pipeline/extracted_text.csv`.** Treat it as read-only input.
5. **Never commit secrets.**
   - The only key used is the optional `ANTHROPIC_API_KEY` (§4.5, QS2), read from the environment.
6. **Human-review hand-offs.**
   - Some steps need a person: plausibility of generated spellings, quality of dictionary links, and the curated dictionary.
   - Write review files to `search_eval/review/`, then proceed with the unreviewed versions.
   - The report must state that these files await human review.

---

## 1. Inputs

| Path (repo-relative) | What it is |
|---|---|
| `ocr_pipeline/extracted_text.csv` | **Evaluation data.** Gemini transcription output, one row per person commemorated. |
| `docs/name_search/experiment_design.pdf` | The experiment design (specification). |
| `docs/name_search/design_template.html` | HTML/CSS source of the design PDF. **Use its `<style>` block verbatim for the report** (§8.2). |
| `docs/name_search/literature_review.pdf` | Background on the methods (optional reading). |

If `ocr_pipeline/extracted_text.csv` is missing, stop and ask for it. Don't fetch data from anywhere else.

**Schema of `extracted_text.csv`.** Columns:

- `section` (women / children), `row`, `stone`, `extract_time`, `all_text`
- `given_name_es`, `given_name_he`, `surname_es`, `surname_he`
- `father_name_es`, `father_name_he`, `mother_name_es`, `mother_name_he`
- `birth_day`, `birth_month`, `birth_year`
- `death_day`, `death_month`, `death_year`, `death_date_he`
- `epitaph`, `confidence` (0–100)

A grave is identified by (`section`, `row`, `stone`), and several rows can share one grave. The figures quoted in the design come from an older extraction: 828 rows, 668 rows with a given name and a surname, 657 of those with confidence ≥ 85. Recompute them on the current file and report the new values.

---

## 2. Environment and external assets

Use Python ≥ 3.11 and record `pip freeze` in `results/environment.txt`. Before anything else, run a **preflight**: try to obtain every asset below and write `results/preflight.json` with each asset's status.

| ID | Asset | How to obtain | If unavailable |
|---|---|---|---|
| — | PostgreSQL ≥ 16 with `fuzzystrmatch` and `pg_trgm` | `apt-get install postgresql-16 postgresql-contrib-16` (or the distro equivalent); run a local cluster on a Unix socket | Use the Abydos `DaitchMokotoff` class and a Python trigram function that reproduces `pg_trgm.similarity` (lower-case; pad each word with two leading spaces and one trailing space; Jaccard over trigram sets). Log the substitution |
| E1 | Byte-level encoder | `git clone --depth 1 https://github.com/vedant-jumle/cross-language-phonetic-text-alignment`; checkpoint at `checkpoints/best_v2/model.safetensors` | `not_run` |
| E2 | Symphonym | Hugging Face `docuracy/symphonym-v7` (mirror on Zenodo, DOI 10.5281/zenodo.18682017); follow the model card for loading | `not_run` (if not loadable after a reasonable attempt) |
| E3a | LaBSE | `sentence-transformers/LaBSE` via `sentence-transformers` | `not_run` |
| E3b | multilingual-e5-small | `intfloat/multilingual-e5-small`; prefix every input with `"query: "` | `not_run` |
| E4 | E1 fine-tuned (optional) | Requires PyTorch | `not_run` |
| L4 | Beider–Morse | `pip install --no-deps abydos` then `pip install numpy deprecation`; Hebrew-value patch in Appendix B | must run |
| — | AnyAscii | `pip install anyascii` | must run |
| — | Report rendering | `pip install playwright` and its Chromium; fonts TeX Gyre Pagella, Inter, Liberation Serif (`apt-get install fonts-texgyre fonts-inter fonts-liberation`) | If fonts are missing, fall back to the CSS font stacks and log it |

PyTorch is not needed for E1. Appendix A gives a NumPy port of its forward pass, which is also how E1 would run in production. Exact (brute-force) cosine search is fine at this scale, so no vector database is needed for the experiments.

---

## 3. Repository layout to create

```
search_eval/
  __init__.py
  run.py                 # CLI: --stage prep|exp1|exp2|exp3|freeze|exp4|report|all
  config.py              # all constants: seed, thresholds grids, paths
  normalise.py           # §4.2 — the single normalisation function, shared with import.py later
  data.py                # loading, eligibility, dedup, splits, person index
  queries.py             # QS1–QS5 generation, masking
  generators/            # e1.py e2.py e3.py l1.py l2.py l3.py l4.py (common interface, §5.1)
  dictionaries/          # d1_curated.csv (hand-built), build_d2.py, links.py, d4.py
  ranking.py             # K1–K4, aggregation
  metrics.py             # R@10, MRR, unrelated@10, empty rate, bootstrap, McNemar, latency
  eval/                  # generated: profile.json, splits.csv, queries_*.csv
  review/                # generated: qs2_sample.csv, link_sample.csv, d1_review.csv
results/                 # metrics.csv, per_query/*.csv, frozen_config.json, preflight.json, …
reports/                 # name_search_experiment_results.html + .pdf, figures/*.svg
tests/                   # unit tests for normalise, masking, metrics, test-split guard
```

---

## 4. Preparation: building the evaluation set

This is a preparation stage. Do **not** label it an experiment anywhere, in code output or in the report.

### 4.1 Eligibility

A row is eligible when all three hold:
- (`given_name_es` or `given_name_he`) is non-empty;
- (`surname_es` or `surname_he`) is non-empty;
- `confidence` ≥ 85.

### 4.2 Normalisation (`normalise.py`)

Write this as one function per script, so `import.py` can reuse it later.

- **Latin script:** NFKD, strip combining marks, lower-case, keep letters, replace `-` with a space, collapse whitespace.
- **Hebrew script:**
  - Strip niqqud and cantillation (U+0591–U+05C7).
  - Map final forms to medial forms (ך→כ, ם→מ, ן→נ, ף→פ, ץ→צ).
  - Map Yiddish ligatures to their letter pairs: װ→וו, ױ→וי, ײ→יי.
  - Remove geresh, gershayim and quotation marks.
- **Surname tokens:**
  - Split on whitespace.
  - Drop the particle `de` and the Hebrew particle `דע`.
  - Drop single-letter initials (with or without a full stop).
  - Every remaining token is indexed. For example, "S. de Blejer" → [`blejer`]; "Sabbah de Cohen" → [`sabbah`, `cohen`].
- **Given-name tokens:** split on whitespace and hyphen. Hebrew double names give two tokens.
- **Script detection, per token:** Hebrew if any character is in U+0590–U+05FF, otherwise Latin.

### 4.3 Duplicate persons

Merge rows into one **target person** when either of these holds:
- normalised (`given_name_es`, last Latin surname token, `death_year`) are equal and non-empty; or
- normalised (`given_name_he`, Hebrew surname, `death_year`) are equal and non-empty.

The target person keeps every grave as a correct answer and the union of the merged rows' name tokens. Write a `merged_from` list to `eval/persons.csv`.

### 4.4 Splits

- **Family key:** the last Latin surname token (for "X de Y", the token after `de`), else the last Hebrew surname token.
- **Test split:** draw 20 % of persons, stratified by section × script coverage (Latin only / Hebrew only / both), keeping whole family-key groups together.
- **Development folds:** split the remaining 80 % into five folds with the same grouping. Use stratified group k-fold with seed 333.
- Write `eval/splits.csv` with columns `person_id, split (dev|test), fold (1–5 or blank)`.

### 4.5 Query sets

Write one row per query to `eval/queries.csv` with columns:
- `query_id, set, query_text, query_script, target_person_ids, relevant_person_ids, masked_fields, source_fields, split, fold`

The five sets:

- **QS1 — Latin name with typing errors.** One query per person with a Latin given name and surname.
  - Start from "given surname" (or "surname given", each with probability 0.5).
  - Apply edits to one token, chosen at random: one edit if the token has ≤ 5 characters, two otherwise.
  - Each edit is chosen uniformly from deletion, adjacent transposition, and substitution with a QWERTY neighbour.
- **QS2 — Diaspora spelling.** One query per person with a Latin given name and surname.
  - Rewrite the surname, and the given name where applicable, with the substitution rules in Appendix C, choosing one applicable rule per token at random.
  - If no rule applies to either token, and `ANTHROPIC_API_KEY` is set, ask the model for one plausible English, German or Polish spelling, and record `generator = llm:<model>`. Otherwise drop the person from QS2 and count the drops.
  - Write 50 random QS2 rows to `review/qs2_sample.csv` for human review.
- **QS3 — Hebrew → Latin record.** One query per person with a Hebrew given name and surname *and* a Latin given name and surname.
  - Query text: the recorded Hebrew "given surname".
  - `masked_fields = given_name_he, surname_he`: the target's Hebrew tokens are removed from the index for this query only.
- **QS4 — Latin → Hebrew record.** The mirror of QS3: the query is the Latin name, and the target's Latin tokens are masked.
- **QS5 — Partial name.** A sample of 300 queries drawn from QS1–QS4 (seed 333).
  - Keep a single token: the surname (probability 0.6) or the given name (0.4).
  - For women whose Latin surname has the form "X de Y", the surname token is Y (the husband's surname).
  - `relevant_person_ids` lists every development or test person (within the query's own split) whose normalised token in the same field and script equals the source token, plus the target.
  - The masking rules of the parent set still apply.

For QS1–QS4, `relevant_person_ids = target_person_ids`.

---

## 5. Shared components

### 5.1 Generator interface

Every generator implements:

```python
class Generator:
    id: str                                   # "E1", "L3", …
    def index(self, tokens: list[Token]) -> None   # Token = (person_id, field, script, text_norm, text_display)
    def match(self, q: str, mask: set[tuple[person_id, field]]) -> list[tuple[Token, float]]
```

`match` returns the person tokens matching one query token, with a similarity in [0, 1]:

| Generator | Similarity |
|---|---|
| L1 | 1 if the normalised strings are equal |
| L2 | `pg_trgm` similarity, same script only |
| L3 | 1 if the Daitch–Mokotoff code sets intersect. Hebrew tokens are romanised with AnyAscii first |
| L4 | 1 if the BMPM approximate tokens intersect **or** the Hebrew-value tokens intersect (Ashkenazic rules, Appendix B) |
| E\* | Cosine of the embeddings. Embed the display form, i.e. the original casing |

For embedding generators:
- keep tokens with cosine ≥ the cut-off `c`, capped at 50 per query token;
- tune `c` on each fold's training data over `{0.70, 0.75, …, 0.95}`.

### 5.2 Person scoring

For a query with tokens `t1…tn`:
- `g_i` = the best similarity of `t_i` to any of the person's **given-name** tokens;
- `s_i` = the best similarity of `t_i` to any of the person's **surname** tokens.

Then:
- one-token query: score = max(g, s);
- multi-token query: score = max over i ≠ j of `agg(g_i, s_j)`.

`agg` is the mean in Experiments 1–2; Experiment 3 compares sum and product. This enforces the full-name constraint described in the design.

### 5.3 Display cut-off and metrics

- **Display cut-off.** Each configuration has a display threshold `τ_d` on the person score, tuned on the training folds. Choose the `τ_d` that maximises R@10 subject to mean unrelated@10 ≤ 3. The displayed list is the persons with score ≥ `τ_d`, sorted descending, ties broken by `person_id`.
- **R@10** = |relevant ∩ displayed top 10| / min(10, |relevant|).
- **MRR** = 1 / (rank of the first relevant person in the displayed list), or 0 if none appears.
- **unrelated@10** = the number of non-relevant persons in the displayed top 10.
- **empty_rate** = the share of queries with an empty displayed list.
- **Primary score** = the macro-average of R@10 over QS1–QS5, each set weighted equally.
- **Latency.** Time each query in-process (warm), end to end: query embedding, generator matching, dictionary steps, scoring and sorting. Report p50 and p95. Experiment 4 also reports cold start. Record the CPU model in `environment.txt`.
- **Confidence intervals.** Use a paired bootstrap with 1,000 resamples of queries, clustered by target person (seed 333), giving 95 % percentile intervals.
- **Exp 4 comparison.** Compare the winner with the runner-up on per-query R@10 hits using an exact McNemar test.

### 5.4 Dictionaries

- **D1 (curated).** Build it **before reading any data row**, from general knowledge of Hebrew, Yiddish and Spanish given-name equivalences.
  - Aim for about 100 groups, each listing the Hebrew-script forms, Yiddish Latin forms and Spanish forms.
  - Include translation pairs such as Zeev/Wolf/Velvel, Aryeh/Leib, Dov/Ber, Tzvi/Hirsch, Reyzl/Rosa.
  - Columns: `group_id, form, script, kind (cognate|yiddish|translation|hypocoristic), source`.
  - Write a copy to `review/d1_review.csv`.
- **D2 (archive-derived), rebuilt per fold from training persons only.**
  - Given names: every pair (Latin given token, Hebrew given token) recorded on the same person.
  - Surnames: every pair (Latin surname token, Hebrew surname token) recorded on the same person.
  - Keep pairs with support ≥ 2 and merge them into groups by connected components.
  - For Experiment 4, rebuild D2 from the whole development split.
- **D3** = the union of D1 and D2, with groups merged where they share a form.
- **Ingestion-time links.**
  - Link every indexed token to dictionary groups: by exact normalised form, else by its nearest dictionary form under the generator's cosine if that is ≥ `τ_link`.
  - `τ_link` is tuned over {0.80, 0.85, 0.90}.
  - Write 100 random non-exact links to `review/link_sample.csv`.
- **D4 (initial-sound rule).** Two tokens agree when the first digit of their D–M codes agrees, with Hebrew romanised first. D4 is used only as a K4 feature.

### 5.5 Dictionary placements (Experiment 2)

- **P1 — dictionary only.** Exact lookup of each query token in the dictionary → the group's forms → persons indexed under those forms or linked to the group. Each dictionary-derived match has similarity λ.
- **P2 — dictionary first.** Expand each query token into its group's forms, embed every form, and take the best similarity per person token.
- **P3 — embedding first.** Find the query token's neighbours (cut-off `c`) in a search vocabulary V, collect the dictionary groups of the neighbours and of the query itself, and return the persons linked to those groups. A dictionary-derived match scores λ × the neighbour's cosine; a direct match scores its cosine. Two settings vary:
  - V = archive tokens, or archive tokens ∪ dictionary forms;
  - retrieval by cut-off `c`, or by fixed top-k (k = 5).

λ is 0.9 in Experiment 2 and is tuned in Experiment 3.

---

## 6. Experiments

Each experiment varies one component. It carries forward the **top 2 configurations by primary score** on the development folds (the mean over the 5 folds); Experiment 1 also carries forward the best lexical baseline.

### Experiment 1 — Candidate generators (RQ1)

- **Configurations:** E1, E2, E3a, E3b, E4 (optional), L1, L2, L3, L4.
- **Fixed:** no dictionary (D0); K1 ranking with mean aggregation.
- **For E4:** fine-tune within each fold on that fold's D2 training pairs only. Use InfoNCE with in-batch negatives, at most 5 epochs, and early stopping on a held-out 10 % of the training pairs.
- **Carry forward:** the 2 best embedding generators and the best lexical generator.

### Experiment 2 — Dictionary source and placement (RQ2)

Run these configurations, using the carried generators:

1. P1 × {D1, D2, D3}. This uses no generator.
2. P2 × {2 carried embeddings} × {D1, D2, D3}.
3. P3 with the best embedding and D3, varying V ∈ {archive, archive ∪ dict} × retrieval ∈ {cut-off, top-5}. Then fix the best (V, retrieval).
4. P3 × {2 carried embeddings} × {D1, D2, D3}, at that best setting.

For every D2 configuration, report the link count and the share of non-exact links. Report QS3 and QS4 separately for given-name-only and surname-only matches (`metrics.csv` columns `subset = given|surname|all`).

**Carry forward:** the top 2 configurations.

### Experiment 3 — Ranking and fusion (RQ3)

- **Candidates:** the union of the two carried Experiment 2 configurations and the best lexical generator.
- **Rankers:** K1, K2 (λ ∈ {0.6, 0.7, 0.8, 0.9}), K3 (RRF with k = 60 over the component lists), K4.
- **K4 = logistic regression.** One row per (query, candidate person), trained on the training folds, standardised features, L2 regularisation with C tuned over {0.1, 1, 10}. Features:
  - max cosine for each embedding;
  - trigram similarity;
  - D–M agreement;
  - BMPM agreement;
  - route (direct or dictionary);
  - D4 initial-sound agreement;
  - field type of the best match;
  - query token length;
  - whether both the given and the surname component matched.
- **Aggregation:** cross every ranker with agg ∈ {sum, product}.
- Save the K4 coefficients to `results/k4_coefficients.csv`.

**Freeze.**
- Pick the configuration by the design's rule: the **simplest** configuration whose primary score lies within the 95 % CI of the best and whose p95 latency is < **500 ms**.
- Simplicity order, simplest first:
  1. lexical only;
  2. one local embedding;
  3. embedding + dictionary;
  4. fusion (K3);
  5. learned scorer (K4).
- Write `results/frozen_config.json` with every parameter, its config hash and the runner-up's config, then commit it.

### Experiment 4 — Confirmation on the test split

1. Rebuild D2 and the links from the whole development split.
2. Run three configurations once on the test queries:
   - the frozen configuration;
   - the runner-up;
   - the **reference**, i.e. the current design: L3 with K1.
3. Report every metric with bootstrap CIs, plus McNemar winner vs runner-up.
4. Break results down by query set, section, script direction, name length (≤ 4 vs > 4 characters) and confidence band (85–94 vs 95–100).
5. Export every failed QS3 and QS4 query to `results/exp4_failures.csv` with columns `query_id, query_text, target_names, top3_returned, cause`. `cause` is one of `missing_equivalence | transcription_error | ranking_error | other`, assigned by heuristic and flagged for human review.
6. Measure cold and warm latency.

---

## 7. Outputs

### 7.1 `results/metrics.csv` — one row per configuration × query set × subset × fold

| Column | Content |
|---|---|
| `experiment` | `exp1` … `exp4` |
| `config_id` | Short readable ID, e.g. `exp2_P3_E1_D3_union_cut` |
| `config_hash` | Hash of the full parameter dict |
| `generator`, `dictionary`, `placement`, `vocab`, `retrieval`, `ranker`, `aggregation` | Component settings (blank where not applicable) |
| `params` | JSON of tuned values (`c`, `τ_d`, `τ_link`, λ, C) |
| `split`, `fold` | `dev` with fold 1–5 or `mean`; `test` with blank fold |
| `query_set`, `subset` | `QS1`…`QS5` or `macro`; `all`, `given`, `surname` |
| `n_queries` | Count |
| `r_at_10`, `r_at_10_lo`, `r_at_10_hi` | Value and 95 % CI (CIs on `fold = mean` and test rows) |
| `mrr`, `mrr_lo`, `mrr_hi` | Same |
| `unrelated_at_10`, `empty_rate` | Means |
| `latency_p50_ms`, `latency_p95_ms` | Warm, in-process |
| `carried_forward` | `true` / `false` |
| `status` | `ok` or `not_run:<reason>` |
| `notes` | Free text |

### 7.2 Supporting files

- `results/per_query/<config_id>.csv`: one row per query, holding the rank of the first relevant person, the R@10 hit, unrelated@10, latency, and the top 10 person IDs with scores.
- `results/preflight.json`, `environment.txt`, `frozen_config.json`, `k4_coefficients.csv`, `exp4_failures.csv`.
- `search_eval/eval/profile.json`: recomputed dataset profile. Include the given-name relation split from the design's Figure 1, using its classification rule: phonetic if D–M, BMPM or E1 cosine ≥ 0.85 links any Hebrew token to the first Spanish token; else initial-sound if the first D–M digits agree; else neither.
- `search_eval/review/*`: the human-review files.

### 7.3 The results report

`reports/name_search_experiment_results.pdf`, rendered from `reports/name_search_experiment_results.html`. About 6–8 A4 pages, with these sections:

0. **Kicker:** "Gauchos Judíos · COS 333 · Name Search Algorithm Development, step 5". **Title:** "Selecting the archive's name-search instrument: results". **Summary box:** the selected instrument, its test R@10 with CI against the reference, and one sentence on the main trade-off.
1. **What was run.** Data profile on the current file; the preflight table (what ran and what didn't); a numbered list of deviations from the design.
2. **Experiment 1.** Figure: R@10 with 95 % CI per generator (dot-and-whisker), plus small multiples per query set. Short text on which generators were carried forward and why.
3. **Experiment 2.** Figure: R@10 by dictionary × placement. Table: P3 settings. Given-name vs surname breakdown for QS3–QS4.
4. **Experiment 3.** Figure: rankers × aggregation. K4 coefficient table. The freeze decision, showing the decision rule applied step by step.
5. **Confirmation.** Table: winner, runner-up and reference on the test split, with all metrics and CIs; McNemar result; stratified breakdown; latency.
6. **Error analysis.** Counts by cause, with three to five illustrative failures.
7. **Conclusions and recommended instrument.** The operational specification for the app:
   - which columns `import.py` must add to `person` (e.g. token arrays, BMPM codes, embedding vectors, group IDs);
   - which indexes (GIN, pgvector HNSW);
   - which model files ship with the Flask service, with their sizes;
   - the thresholds (`c`, `τ_d`, `τ_link`, λ);
   - the expected latency.
8. **Limitations.**
9. **References,** numbered.

---

## 8. Report style

### 8.1 Writing rules

These are the author's standing preferences, and they apply to all prose in the report.

- **Language and register.** British English (normalise, colour, analyse). Academic register, with no first person and no "we want to know".
- **No contrastive-negation constructions:** no "X rather than Y", no "the reason is not A but B".
- **Every sentence must carry information.** No rhetorical flourishes and no padding.
- **Sentences flow and connect.** Avoid strings of short choppy declaratives.
- **References.** No trailing references that hang on the previous sentence. Never stack pronouns with different referents; name the nouns instead.
- **Numbers.** Report n with every percentage, and CIs with every headline metric.

### 8.2 Visual style

Copy the `<style>` block of `docs/name_search/design_template.html` **verbatim**. That gives:
- A4 with margins of 17/18/16/18 mm and centred page numbers;
- body in TeX Gyre Pagella 9.7 pt, headings, tables and captions in Inter;
- Hebrew in Liberation Serif via `<span class="he">`;
- the kicker, title, subtitle and "Summary" box layout;
- numbered `h2` headings with a muted number;
- tables with a header rule and light row rules;
- grey group rows (`tr.grp`) and bold IDs (`td.id`);
- figure captions in Inter 7.6 pt beginning "**Figure n.**".

Copy the template's SVG conventions for process diagrams: rounded boxes, grey arrows with arrowheads, blue fills for generators, orange for dictionary steps and outputs.

Charts:
- Draw them with matplotlib to SVG, font Inter, `svg.fonttype = "path"`.
- Palette: blue `#2a78d6`, orange `#eb6834`, aqua `#1baf7a`, grey `#8a8984`, ink `#141414`, secondary text `#52514e`, gridlines `#e6e5e1`.
- At most three colours per chart.
- One y-axis per chart.
- Thin marks, recessive grid, direct labels where they fit.
- Text in ink colours, never in series colours.
- Hebrew labels in matplotlib need `python-bidi` (`get_display`).

Rendering:
- Use Playwright Chromium: `page.pdf(path=…, format="A4", print_background=True, prefer_css_page_size=True)`.
- Render the pages to PNG and inspect them for overflow, clipped labels and widowed headings before finishing.

---

## 9. Acceptance checklist

- [ ] `python -m search_eval.run --stage all` reproduces every output from a clean checkout.
- [ ] Unit tests pass, including the test-split guard and the masking test (a QS3 query can never match its target's masked Hebrew tokens).
- [ ] `metrics.csv` has a row for every configuration in §6, including `not_run` rows.
- [ ] `frozen_config.json` was committed before any test-split file was read; the git log shows the order.
- [ ] Review files exist and the report lists them as pending human review.
- [ ] The report PDF follows §8, cites the design PDF, and states the selected instrument with its operational specification.
- [ ] The pull request description summarises the selected instrument, its test R@10 against the reference, and the deviations list.

---

## Appendix A — NumPy forward pass for E1

```python
"""NumPy port of ByteLevelEncoder (vedant-jumle/cross-language-phonetic-text-alignment, best_v2).
Mirrors torch TransformerEncoderLayer(norm_first=True, activation=relu) in eval mode, then mean
pooling and L2 normalisation. Input: raw UTF-8 bytes, no tokeniser, max 256."""
import numpy as np
from safetensors.numpy import load_file

class ByteEncoder:
    D, H, NL = 256, 8, 6
    def __init__(self, ckpt_path):
        self.W = load_file(ckpt_path)
    @staticmethod
    def _ln(x, g, b, eps=1e-5):
        m = x.mean(-1, keepdims=True); v = ((x - m) ** 2).mean(-1, keepdims=True)
        return (x - m) / np.sqrt(v + eps) * g + b
    def encode(self, text: str) -> np.ndarray:
        W, D, H = self.W, self.D, self.H
        ids = list(text.encode("utf-8"))[:256]; L = len(ids); dh = D // H
        x = W["embedding.weight"][ids] + W["pos_embedding.weight"][:L]
        for i in range(self.NL):
            p = f"transformer.layers.{i}."
            h = self._ln(x, W[p + "norm1.weight"], W[p + "norm1.bias"])
            q, k, v = np.split(h @ W[p + "self_attn.in_proj_weight"].T + W[p + "self_attn.in_proj_bias"], 3, -1)
            q, k, v = (t.reshape(L, H, dh).transpose(1, 0, 2) for t in (q, k, v))
            a = q @ k.transpose(0, 2, 1) / np.sqrt(dh)
            a = np.exp(a - a.max(-1, keepdims=True)); a /= a.sum(-1, keepdims=True)
            o = (a @ v).transpose(1, 0, 2).reshape(L, D)
            x = x + o @ W[p + "self_attn.out_proj.weight"].T + W[p + "self_attn.out_proj.bias"]
            h = self._ln(x, W[p + "norm2.weight"], W[p + "norm2.bias"])
            f = np.maximum(0, h @ W[p + "linear1.weight"].T + W[p + "linear1.bias"])
            x = x + f @ W[p + "linear2.weight"].T + W[p + "linear2.bias"]
        pooled = x.mean(0)
        return pooled / np.linalg.norm(pooled)
```

Sanity check: cosine("Schwarzenegger", "שוורצנגר") ≈ 0.84, and cosine("חיים", "Haim") ≈ 0.90. Unoptimised CPU encoding takes about 13 ms per name. Cache embeddings of all indexed tokens.

## Appendix B — Beider–Morse with the Hebrew-value pass (Abydos)

Abydos ships the Hebrew-value rules, but its engine coerces the match mode to `approx`. This patch exposes the pass for both rule sets:

```python
import abydos.phonetic as P
from abydos.phonetic._beider_morse_data import BMDATA

def bmpm_encoders(name_mode="ash"):
    h = BMDATA[name_mode]["hebrew"]
    for k in BMDATA[name_mode]["approx"]:
        if k != "common" and k not in h:
            h[k] = ()                      # language-specific Hebrew rules are empty
    approx = P.BeiderMorse(name_mode=name_mode)
    heb = P.BeiderMorse(name_mode=name_mode); heb._match_mode = "hebrew"
    return approx, heb

approx, heb = bmpm_encoders("ash")
set(heb.encode("סערעברינסקי").split()) & set(heb.encode("Serebrinsky").split())   # → {'srbrinski', 'srvrinski'}
```

Two tokens agree under L4 when their `approx` token sets or their `heb` token sets intersect.

For Latin input, pass a fixed language set as a comma-separated string, for example `P.BeiderMorse(language_arg="spanish,german,polish,russian,english", name_mode="ash")`. This matters because automatic detection classes Spanish adaptations such as "Svarc" as Hungarian or Czech. Hebrew-script input keeps automatic detection, which resolves to `hebrew`.

## Appendix C — QS2 substitution rules (Latin → diaspora spelling)

Apply one applicable rule per token, chosen at random. Matching is case-insensitive, and the output keeps the token's capitalisation pattern.

| Pattern | Replacements |
|---|---|
| `sch` / `sz` / `sh` / `ch` (at the start of a word, or before a consonant) | each other |
| `j` (as /x/, in Spanish forms) | `ch`, `kh`, `h` |
| `v` ↔ `w` | — |
| `y` / `i` / `j` (at the start of a word, before a vowel) | each other |
| `tz` / `ts` / `z` / `c` (before e or i) | each other |
| `k` ↔ `c` (before a, o, u) ↔ `q` | — |
| `-sky` / `-ski` / `-skiy` | each other |
| `-man` ↔ `-mann` | — |
| `-berg` ↔ `-burg` | — |
| `-stein` / `-shtein` / `-stain` / `-shtain` | each other |
| `ei` / `ey` / `ai` | each other |
| `u` ↔ `oo` | — |
| `f` ↔ `ph` | — |
| Doubled consonant | the single consonant (and vice versa) |

Record the rule used in a `rule` column of `queries.csv`.
