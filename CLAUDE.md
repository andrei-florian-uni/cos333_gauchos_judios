# CLAUDE.md

## 1. How to Use This Document

This file gives Claude (and anyone else working in the repository) the context needed to work on the project. It has four sections:

1. **How to Use This Document** (this section): the structure of the file and the rules for editing it.
2. **Project Design**: the agreed design of the project, mirrored from the *Project Design* callout on the team's Notion "Semester Project" page. Treat it as the reference for what to build. Notion is the source of truth: this section changes only through the sync rules below.
3. **Code Style**: the rules all code in the repository must follow, including the checks to run before shipping any change, and the Notebook Style that every Jupyter notebook follows.
4. **Additional Context**: a running set of notes that anyone can read and add to. Conventions, decisions, gotchas and other things learned while building go here.

When adding to **Additional Context**:

- Add notes under the existing subsection that fits, or start a new `###` subsection if none does.
- Keep each note short and factual, and date it (`YYYY-MM-DD`) when it records a decision or a change.
- Update or remove a note when it stops being true, rather than adding a new note that contradicts it.
- Don't repeat what the code, git history or the Project Design section already says.

### Syncing Project Design with Notion

Section 2 mirrors exactly one Notion block: the **Project Design** callout in the right column of the [Semester Project](https://app.notion.com/p/3d21903c4ad280eb9cf7ee5c50f0b5ac) page. The rest of that page (Documents & Links, Project Tasks, Class Deliverables, Actions, Notes) and every other Notion page are out of scope: never sync them into this file and never edit them. The comment under the Section 2 heading records the sync state:

```
<!-- notion: <page URL> (<location>) | notion-edited: <page last-edited time, UTC> | synced: <time of the last sync, UTC> -->
```

**Pull: at the start of every session**, before any other work:

1. Fetch the Semester Project page with the Notion connector and read its `page_last_edited_at`.
2. If it equals `notion-edited`, Section 2 is current. Say nothing and carry on.
3. If it is later, compare the Project Design callout with Section 2. The timestamp covers the whole page, so an edit elsewhere on it (a ticked task, say) also moves it.
   - If the callout's content differs, rewrite Section 2 to match it, following the mirroring rules below, and tell the user in a few lines what changed.
   - Whether or not it differs, set `notion-edited` to the fetched time and `synced` to now.
4. If Notion can't be reached, tell the user and work from the local copy. Never rewrite Section 2 from memory.

**Push: when development forces a design change.** If work shows the design must change (a different library, table, column, route, process step, or a feature moved between `mvp` and `stretch`), do not edit Section 2 or Notion on your own:

1. Raise it with the user: what has to change, why, and the exact wording proposed for the Notion callout.
2. Only once the user approves, run the pull steps first, so the edit applies to the current Notion text. Then edit only the affected blocks inside the Project Design callout with the Notion connector.
3. Re-fetch the page, mirror the result into Section 2 and update both timestamps.
4. If the user declines, keep the implementation within the current design.

Minor implementation details that don't contradict the design go in Additional Context, not Notion.

**Mirroring rules**

- Copy the text verbatim, including British spelling and typographic quotes. Don't paraphrase or "improve" it locally.
- The callout's opening summary becomes the paragraph under the Section 2 heading. Each toggle becomes a `###` subsection with the same title, and bold lines inside toggles stay bold lines.
- Notion's coloured `mvp`/`stretch` tags become plain code spans. Tables become Markdown tables. Mentions and links keep their Notion URLs.
- Images (the design figures) are not copied. When Notion adds, removes or replaces a figure, mention it to the user.
- Text that exists only locally, such as reading aids for agents, goes in a block that starts with a `<!-- local-only: ... -->` comment. Local-only blocks are kept across syncs and never written to Notion.

---

## 2. Project Design

<!-- notion: https://app.notion.com/p/3d21903c4ad280eb9cf7ee5c50f0b5ac (Semester Project › right column › "Project Design" callout) | notion-edited: 2026-10-09T15:38:00Z | synced: 2026-10-10T23:30Z -->

Gauchos Judíos is a public web archive of the Jewish agricultural-colony cemetery in Entre Ríos, Argentina, with complete photographic coverage, built from roughly 4,000 field photographs of 1,047 gravestones taken with the Effron Center and PIIRS. Visitors arrive on a landing page that introduces the community and the fieldwork, then explore the cemetery on an interactive aerial map, finding relatives by name even where Spanish and Hebrew spellings diverge. The MVP is read-only and open to everyone; stretch goals add Google sign-in, virtual pebbles and candles with AI-checked messages, yahrzeit reminders, an admin interface, and a trilingual, mobile-friendly interface. An offline pipeline prepares the data beforehand, transcribing the photographs with Gemini, measuring accuracy on a hand-checked sample and loading the results into PostgreSQL. In the figures below, solid outlines mark MVP elements and dashed ochre outlines mark stretch goals.

<!-- local-only: reading aid for agents; never write it to Notion. -->
> The figures are on the Notion page and are not copied here. Items marked `stretch` are stretch goals, and everything else is MVP.

### OCR and DB Ingestion

**Ingestion deliverables**

- **Populated archive database:** the four MVP tables in PostgreSQL, holding every grave and person with normalised names and Daitch–Mokotoff codes for search, photo references and map placements.
  - *Process:* `import.py`, the single loader, validates and normalises the checked CSV and upserts it keyed on each grave’s row number and stone number, so a corrected CSV reloads safely.
- **Photo library:** web-sized copies of every photograph (≤ 2,048 px, within Cloudinary’s 10 MB and 25 MP upload limits), each identified by a public ID, with thumbnails generated on request.
  - *Process:* `media.py` resizes and uploads the originals, and the returned public IDs pass to `import.py`.
- **Aerial map tiles:** a tile pyramid of the aerial image for Leaflet (CRS.Simple), served as static files under `/tiles`.
  - *Process:* `media.py` cuts the tiles with vips dzsave, and they deploy with the app on the Render static site.
- **Grave placements:** the centroid and outline of every grave in image pixels (`placements.json`), which draw the outlines on the map. Plots with no gravestone photographs are placed as well and load as grave rows with no photos, which the map draws as missing records.
  - *Process:* the team clicks each grave on a local Leaflet page, guided by the row labels, with optional AI pre-fill.
- `stretch` **Yahrzeit calendar:** ten years of Hebrew-calendar anniversaries for every person, which drive the reminder emails.
  - *Process:* pyluach converts each Hebrew date of death during import.
- The pipeline runs offline, before deployment, and takes no part in the live application.
  - `stretch` The name-normalisation and yahrzeit functions sit in a module shared with the admin routes, which recompute a person’s derived columns when an admin saves an edit. CSV reloads end once admin editing is live, because a reload would overwrite admin corrections.

**Transcription deliverables**

- **Checked transcription (CSV):** one row per person commemorated, with first name and surname in Latin and Hebrew script, maiden name, father’s name and husband’s name in both scripts, birth date and civil and Hebrew death dates as day, month and year, age at death, the epitaph and legibility, accompanied by a field-level accuracy report.
  - *Process:* the index card photographed at the start of each grave groups the ≈4,000 photos into a manifest of photo → grave, row number and stone number.
  - *Process:* Gemini reads each grave’s full set of photos in one call constrained by a JSON schema, and responses are cached per grave and prompt version.
  - *Process:* accuracy is measured on a ≈10% sample, stratified by legibility, transcribed by hand and compared field by field; an unacceptable score sends the batch back to extraction with a revised prompt.
- **Photo-only records:** the ≈20% of stones too worn to read, flagged illegible, which enter the archive as grave rows with their photographs and no person row.
  - *Process:* legibility is assigned by Gemini at extraction.

### Application Data Structure

- PostgreSQL holds all tabular data, and photographs stay on Cloudinary, referenced by public ID.
- **MVP archive:** four read-only tables that the application runs on alone.
  - `cemetery`: name and location, aerial-image size in pixels, and tile path.
  - `grave`: row number and stone number (unique within a cemetery, and the key on which the import matches graves), legibility, and centroid and outline polygon in pixels for the map. The map state of a grave is derived when the map loads: a person row means documented, photos alone mean an incomplete record, and neither means a missing record.
  - `person`: first name and surname in Latin and Hebrew script; maiden name, father’s name and husband’s name, each in both scripts; birth date and civil and Hebrew death dates, each stored as day, month and year so that a partial date leaves the missing parts empty; age at death; one epitaph field holding the inscription in both languages; notes; normalised first names and surnames in each script and Daitch–Mokotoff codes for search; and OCR confidence.
  - `photo`: kind (main or other), Cloudinary public ID, dimensions and display order.
- One cemetery has many graves, and each grave has zero or more people (none for photo-only stones, several for shared stones) and several photos.
- Indexes behind search and filters: GIN trigram on the four normalised name columns, GIN on the Daitch–Mokotoff codes, B-tree on death year, and a unique index on cemetery, row number and stone number.
- `stretch` **Interaction layer:** four tables for sign-in, tributes and reminders.
  - `app_user`: Google subject ID, email, display name (the Google given name, shown beside the user’s pebbles) and admin flag.
  - `tribute`: pebble or candle, its signed-in author (required), an optional relation and an optional message of up to 500 characters on a pebble, and status (approved, rejected, removed). A moderator removes a tribute by setting its status to removed.
  - `subscription`: a user’s subscription to a person, with an unsubscribe token.
  - `yahrzeit`: each person’s anniversary per Hebrew year, with the time its reminder was sent.
- `stretch` Tribute rules, enforced by the API on each post: one pebble per user per person every 30 days, and one burning candle per user per person. A candle burns for 30 days from its creation and cannot be put out early by its author. Both rules derive from `created_at`, and a rejected pebble does not count towards the limit.
- No MVP table references a stretch table, so the interaction layer sits alongside the archive without altering it.

### Application Architecture

**Presentation tier**

- React 19 single-page app built with Vite and styled with react-bootstrap (Bootstrap 5.3), running in the visitor’s browser.
- react-leaflet 5 and Leaflet 1.9.4 (CRS.Simple) draw the aerial map with grave outlines.
- `stretch` react-i18next for English (default), Spanish and Hebrew, with Bootstrap’s RTL build for Hebrew.
- `stretch` Interface for sign-in, pebbles and candles, subscriptions and admin mode.
- Render Static Site (flow 1) serves the app bundle and the aerial tiles through a CDN and rewrites every path to `index.html`.
- Cloudinary (flow 2) serves gravestone photos, with thumbnails and full views generated on request, and the hero video.

**Processing tier**

- Flask 3.1 API on gunicorn, running as a Render web service and exchanging JSON with the app over HTTPS (flow 3).
- MVP routes: `/api/search`, `/api/persons/:id`, `/api/map/graves` and `/api/graves/:ref`.
  - `/api/map/graves` returns, for every grave, its outline, derived state, row number, stone number and the names of its people, which serves the hover tooltips and the shared-stone chooser in one request.
  - `/api/graves/:ref` takes a row-and-stone reference such as `B-14` and returns that grave with its people and photos. The one endpoint serves photo-only records and resolves shared links of the form `/record/B-14`.
- `stretch` Routes: `/auth/google` (session cookie; returns the visitor to the record and action they started from), `/api/me` (first name, masked email and admin flag of the signed-in user), the tributes and subscriptions APIs, `/api/unsubscribe/:token` (public, for the link in reminder emails), and `/admin/*` for editing records and removing tributes, with CSRF protection. Every tribute and subscription write requires a signed-in Google session and is refused without one. Users can delete their own pebbles.
- `stretch` External services: Google OAuth for sign-in, first name and verified email; the Anthropic API for Claude Haiku’s pass-or-fail verdict on messages, called inside the request that posts the message, so that a passing message is published at once and a failing one is refused (a call that errors or times out counts as a fail, and the verdict itself is not stored); Cloudflare Turnstile in its invisible mode for bot checks on writes; and Resend for email over HTTPS.
- `stretch` Render cron job: runs daily on a UTC schedule (Argentina is UTC−3), finds the next day’s yahrzeits and sends reminders through Resend. Each reminder carries its text in English and Spanish together.

**Data tier**

- PostgreSQL ≥ 16 on Render Postgres, queried by Flask with psycopg 3 (flow 4) and by the cron job.
- Extensions: pg_trgm and fuzzystrmatch (Daitch–Mokotoff), with pgvector if search uses embeddings.
- Four MVP tables and four stretch tables, described under Application Data Structure.

### Application Interface

The interface ships in English; Spanish and Hebrew arrive with the `stretch` language toggle.

**Landing page:** public; MVP apart from the language toggle

- **H1** Hero over a video or drone background, with the ES | EN | HE toggle (`stretch`).
- **H2** “Explore the cemetery map” and “Learn more” buttons, a name search box, and a pause control for the background video.
- **H3** The community’s history, as a photo carousel with a caption under each photo.
- **H4** A two-sided timeline.
- **H5** Footer with privacy and contact links, and credits to the community, collaborators and funders. Contact is a plain email link; the site has no contact form.

**Cemetery explorer**

- The aerial map fills the page; the search and record panels float over its left two-thirds, and the map stays visible in the right third.
- The header holds “← Home”, back to the landing page, and the language toggle (`stretch`), whose choice is kept in the URL (e.g. `?lang=he`) so shared links open in the sender’s language.
- **N2** A name search box that takes first and last names together, in either order and in either script, with a Filters button for birth-year range, death-year range and row. Active filters show as removable chips.
- **N3** Results list showing photo, name, dates and row, with the selected result highlighted.
- **N4** Map outlines show each grave’s state (missing record, incomplete record, documented, search match, selected), with a legend and zoom control. Missing records are not clickable.
- **N5** Share button on the record panel, which copies a link of the form `/record/B-14` that reopens the map with that grave selected.
- **N6** `stretch` “+ Pebble” and “Light a candle” buttons over a pebble feed that shows each author’s Google first name and, when given, their relationship to the person. Candles show as a count of those burning.
- **N7** `stretch` Next yahrzeit date, with “Remind me” to subscribe to an email the day before each anniversary. Unsubscribing removes the subscription.
- **N8** Record panel with portrait, name, dates and the Hebrew name set right to left, followed by photos and additional details (birth date, civil and Hebrew death dates, age at death, father’s name, husband’s name, maiden name, epitaph and location). Every grave uses the same layout, and a field with no value on record is shown redacted.
- **N9** `stretch` “Sign in” with Google at the top right. A Google sign-in is required to place a pebble, light a candle or set a reminder, and a signed-out visitor who tries is shown a sign-in prompt first.

**Admin page:** `stretch`

- Appears after an admin signs in: the explorer with editing and moderation added.
- **A1** “Admin mode” badge and the admin’s session menu with sign-out.
- **A3** Every person field is editable: first name and surname in both scripts, maiden name, father’s name and husband’s name, birth and death dates, age at death and the epitaph. A grave’s row number and stone number are shown and cannot be changed.
- **A4** “Save changes” and “Discard”. Edits are not logged, and the interface offers no history view, restore or undo.
- **A5** Tribute moderation: remove any pebble or candle. Removed items keep the status “removed”. Admins do not approve messages.

### Application Features

| Feature | Type | Description |
| --- | --- | --- |
| **Landing Page** | `mvp` | Public homepage with a hero section introducing the project, followed by the history of the community, the cemetery and the team's fieldwork. |
| **Interactive Cemetery Map** | `mvp` | Aerial photograph of the cemetery rendered with Leaflet, with every grave outlined and synchronised with search results and the record view. |
| **Records Navigator** | `mvp` | Search and record panes that sit on top of the cemetery map, pairing a results list with a detail view of the selected gravestone. |
| **Fuzzy Name Search** | `mvp` | Name search that tolerates typos, transliteration variants and imperfect Spanish–Hebrew spellings, using phonetic or embedding-based matching. |
| **Search Filters** | `mvp` | Filters on date of death and other record attributes that narrow the search results. |
| **Gravestone Record View** | `mvp` | Detail panel showing a person's names, dates, age at death, father's and husband's names, maiden name and inscription in Spanish and Hebrew, alongside the grave's photographs. |
| **Multilingual Interface** | `stretch` | Interface toggle between English (default), Spanish and Hebrew, with a right-to-left layout for Hebrew. |
| **Google Authentication** | `stretch` | Google sign-in, required to place a pebble, light a candle or set a reminder, and supplying users' first names and email addresses, with the rest of the site staying public. |
| **Pebble and Candle Lighting Feature** | `stretch` | Signed-in users can place a virtual pebble or light a virtual candle on a person's record. A pebble can carry the user's relationship to the person and a message, and appears under the user's Google first name; a candle burns for 30 days. |
| **AI Comment Checker** | `stretch` | Every message left with a pebble passes through Claude Haiku via the Anthropic API as it is posted. A message that passes is published at once, and one that fails is refused. |
| **Yahrzeit Reminders** | `stretch` | Users subscribe to a person's record and receive an annual email the day before the Hebrew-calendar anniversary of the death, inviting them to light a candle. |
| **Admin Interface** | `stretch` | Authenticated moderator interface with write access to the database for removing harmful contributions the AI checker misses. |
| **Mobile-Friendly Layout** | `stretch` | Responsive layout that makes the full site usable on phones. |
| **Bot Prevention** | `stretch` | Cloudflare Turnstile verification on interactive actions to stop automated spam. |

---

## 3. Code Style

Every piece of code written for this project, by Claude Code or by a team member, must follow these rules.

1. **Readable by a student.** Code must be fully understandable by a person reading it, and in particular by a student who did not write it. Prefer simple, explicit code over clever or compact code: use descriptive names, short functions that each do one thing, and straightforward control flow.
2. **Commented.** All code must be commented. Every module, class and function has a docstring (or the equivalent in other languages) saying what it does, what it takes and what it returns, and comments explain the reasoning behind any step that isn't obvious from the code itself.
3. **Pylint-clean Python 3.14.** Python code must comply with Python 3.14 standards and pass pylint with no warnings. Run pylint on every edited Python file before shipping a change, and fix any issues it reports. For a notebook, export its code cells in order to a single `.py` file outside the repository and lint that file with `--disable=missing-module-docstring`, since the notebook's opening markdown cell takes the place of a module docstring.
4. **Unit tested, tests not saved.** All code must be checked by unit tests that are run and pass before any change is shipped, and new or changed behaviour needs new or updated tests. The tests are written and run outside the repository (Claude uses its session scratchpad) and are never saved or committed: the repository holds no test files. To test a notebook, load its functions without running its cells, for example by executing only the function, class and import definitions of each code cell, so that tests never touch real data.

### Notebook Style

Every Jupyter notebook in the repository follows this style, modelled on the team's earlier analysis notebooks.

**Structure**

- The notebook is self-contained: all of its logic is defined in its own cells, and it imports no helper module from the repository.
- It opens with one markdown cell: a bold title (`**Title**`, not a `#` heading), then a paragraph saying what the notebook does, what it reads, what it outputs and what it never modifies, then a numbered list of its outputs.
- Every code cell is preceded by a markdown cell titled with its bold section number and name (`**1. Configuration and Helpers**`). The prose says what the cell takes, naming variables and paths in backticks, and what it does, followed by a numbered list of what it produces or checks.
- The first code cell holds all the imports, the configuration and the shared helper functions, and ends by printing a `✓ ... loaded (...)` line.
- The last code cell is a consistency check that rebuilds the expected result independently and compares it with what the notebook produced. It ends with a `✓ ... complete (...)` line followed by the check's result.
- Notebooks are saved with the outputs of a full top-to-bottom run.

**Code cells**

- Each code cell opens with a header comment framed by `# ───` rules, 79 characters wide. Its first line is `Name  —  short description`, followed by a blank comment line and an explanation of the method and the reasoning behind it, with `•` bullets where useful.
- Longer cells are divided by `# ═══` double rules with an UPPERCASE heading, e.g. `GLOBAL CONFIG` or `MERGE  —  copy keyed on relative path`. Smaller divisions use `# ── Name ───` single rules.
- Configuration is UPPER_CASE constants at the top of the cell that owns them, with the `=` signs aligned and a trailing comment giving each one's meaning or unit.
- A cell that depends on an earlier cell starts with a guard: `if "name" not in globals(): raise RuntimeError("Run the '<Section Name>' cell first.")`.
- Results kept for later cells get descriptive lower-case names (`merge_report`). Throwaway module-level names, such as loop variables, start with an underscore (`_batch`) so they never shadow function parameters.
- The Code Style rules above apply in full: every function has a docstring with its arguments and return value, and the exported code cells pass pylint.

**Printed output**

- Notebooks report in plain text. Each report is framed by `─` rules 72 characters wide, with a title line between the first two rules.
- Report rows are indented two spaces with aligned columns. Rows start with an `OK ` or `!! ` status marker where a check applies, `[WARN]` flags a skipped input, and problem details are listed below their row as `- ...` items.
- A summary line follows the closing rule, e.g. `2628 of 2628 photos in the output  (consistent)`.
- Prose uses British spelling (`normalise`, `colour`), as the rest of the project does.

---

## 4. Additional Context

> Readable and writable. Add notes here as the project evolves; see section 1 for the conventions.

### Workflow

- All changes are made on individual branches, which are merged every week.

### OCR pipeline

- Photo layout (2026-10-03): `ocr_pipeline/data/{Women,Children}/Row N/Stone M/<photo>`, merged from the three Google Drive download batches in `data/raw/` by `merge_batches.ipynb`. Photo names describe the view (`front`, `text`, `text2`, `portrait`, `back`, ...), and about 480 are HEIC/HEIF rather than JPEG. `ocr_pipeline/data/` is git-ignored.
- Tooling (2026-10-03): a Python 3.14 conda environment at `ocr_pipeline/.conda`, git-ignored and created from `ocr_pipeline/` with `conda env create -p .conda -f environment.yml` (conda-forge). It provides pylint, pytest and nbconvert for the checks in Code Style. Run a notebook end to end with `.conda/bin/python -m jupyter nbconvert --to notebook --execute --inplace <notebook>`, or select `.conda` as the kernel in an editor.
- Extraction (2026-10-04): `extract_text_gemini.ipynb` sends each stone folder to `gemini-3.1-pro-preview` as one Batch API request, with the photos uploaded to the Gemini File API, and writes `extracted_text.csv` (one row per person). Its git-ignored working folder `ocr_pipeline/extraction/` holds the upload record, the job awaiting collection (`active_job.json`) and the answer cache under `cache/<prompt version>/`; the prompt version hashes the model, thinking level, prompt and schema, so editing any of them re-extracts every grave. `google-genai` was added to `environment.yml`; update an existing environment with `conda env update -p .conda -f environment.yml`.
- Secrets (2026-10-04): API keys never appear in code or notebooks. They live in `ocr_pipeline/.env` (git-ignored), as lines such as `GEMINI_API_KEY=<key>`, loaded with python-dotenv's `load_dotenv`; a variable already set in the shell takes precedence.
- Notebook size (2026-10-06): pylint's 1,000-line module limit applies to a notebook's exported code, so a long notebook needs concise docstrings; `extract_text_gemini.ipynb` exports to 998 lines, so any addition must be offset by a trim.

### Name search experiments

- Layout (2026-10-10): `search_algorithm/` holds notebooks `step_1_preflight` to `step_8_export_result_tables`, run in numeric order. They hand results to each other through files (`eval/`, the git-ignored `cache/`, `results/`), since a notebook imports no repository module. Only the notebooks, `environment.yml`, `dictionaries/d1_curated.csv`, `eval/` and `results/` are tracked; the specification (experiment manifest and design PDF, read from a local `docs/`) and the human-review files the notebooks write to `review/` stay outside git.
- Tooling (2026-10-10): a separate conda environment at `search_algorithm/.conda`, created from `search_algorithm/` with `conda env create -p .conda -f environment.yml`, then `.conda/bin/pip install --no-deps abydos==0.5.0`. Run a notebook with `.conda/bin/python -m nbconvert --to notebook --execute --inplace --ExecutePreprocessor.timeout=-1 <notebook>`: `python -m jupyter nbconvert` dispatches to whichever `jupyter-nbconvert` is first on `PATH` (Anaconda's) and runs the notebook in the wrong kernel.
- Test split (2026-10-10): steps 4–6 never open `eval/*_test.csv`, and step 7 refuses to run unless `results/frozen_config.json` is committed and unchanged. The test split has been used once (commit `cb1edc8`); a new instrument needs a new freeze, and any further test run must be reported as such.
- PostgreSQL (2026-10-10): the experiments run a private cluster in `search_algorithm/cache/pgdata`, listening only on a Unix socket in a temporary folder. Its `en_US.UTF-8` locale is required: under the builtin `C.UTF-8` locale `pg_trgm` finds no trigrams in Hebrew text.
- Unicode (2026-10-10): some Hebrew names in `extracted_text.csv` use presentation forms (`וּ`, U+FB35); `normalise_hebrew` decomposes them with NFKD before removing points, or the letter would be lost.
- Models (2026-10-10): Symphonym v7's own `inference.py` cannot load its weights (its attention pooling differs from theirs). The notebooks swap in the maintainer's v8 definition of that layer.
