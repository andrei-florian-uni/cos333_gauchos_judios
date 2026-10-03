# CLAUDE.md

## 1. How to Use This Document

This file gives Claude (and anyone else working in the repository) the context needed to work on the project. It has four sections:

1. **How to Use This Document** (this section): the structure of the file and the rules for editing it.
2. **Project Design**: the agreed design of the project, mirrored from the *Project Design* section of the team's Notion "Semester Project" page. Treat it as the reference for what to build. Change it only when the design itself changes, and keep it in step with Notion.
3. **Code Style**: the rules all code in the repository must follow, including the checks to run before shipping any change.
4. **Additional Context**: a running set of notes that anyone can read and add to. Conventions, decisions, gotchas and other things learned while building go here.

When adding to **Additional Context**:

- Add notes under the existing subsection that fits, or start a new `###` subsection if none does.
- Keep each note short and factual, and date it (`YYYY-MM-DD`) when it records a decision or a change.
- Update or remove a note when it stops being true, rather than adding a new note that contradicts it.
- Don't repeat what the code, git history or the Project Design section already says.

---

## 2. Project Design

> Source: Notion › Semester Project › Project Design. The figures referenced below are on the Notion page.

Gauchos Judíos is a public web archive of the Jewish agricultural-colony cemetery in Entre Ríos, Argentina, with complete photographic coverage. It is built from roughly 4,000 field photographs of 1,047 gravestones taken with the Effron Center and PIIRS. Visitors arrive on a landing page that introduces the community and the fieldwork, then explore the cemetery on an interactive aerial map. There they can find relatives by name, even where Spanish and Hebrew spellings diverge. The MVP is read-only and open to everyone. Stretch goals add Google sign-in, virtual stones and candles with AI-moderated messages, yahrzeit reminders, an admin interface, and a trilingual, mobile-friendly interface. An offline pipeline prepares the data beforehand: it transcribes the photographs with Gemini, measures accuracy on a hand-checked sample and loads the results into PostgreSQL.

Items marked `stretch` are stretch goals, and everything else is MVP.

### OCR and DB Ingestion

**Ingestion deliverables**

- **Populated archive database:** the four MVP tables in PostgreSQL, holding every grave and person with normalised names and Daitch–Mokotoff codes for search, photo references and map placements.
  - *Process:* `import.py`, the single loader, validates and normalises the checked CSV and upserts it keyed on each grave's card number, so a corrected CSV reloads safely.
- **Photo library:** web-sized copies of every photograph (≤ 2,048 px, within Cloudinary's 10 MB and 25 MP upload limits), each identified by a public ID, with thumbnails generated on request.
  - *Process:* `media.py` resizes and uploads the originals, and the returned public IDs pass to `import.py`.
- **Aerial map tiles:** a tile pyramid of the aerial image for Leaflet (CRS.Simple), served as static files under `/tiles`.
  - *Process:* `media.py` cuts the tiles with vips dzsave, and they deploy with the app on the Render static site.
- **Grave placements:** the centroid and outline of every grave in image pixels (`placements.json`), which draw the outlines on the map.
  - *Process:* the team clicks each grave on a local Leaflet page, guided by the row labels, with optional AI pre-fill.
- `stretch` **Yahrzeit calendar:** ten years of Hebrew-calendar anniversaries for every person, which drive the reminder emails.
  - *Process:* pyluach converts each Hebrew date of death during import.
- The pipeline runs offline, before deployment, and takes no part in the live application.

**Transcription deliverables**

- **Checked transcription (CSV):** one row per person commemorated, with names in Latin and Hebrew script, parents, civil and Hebrew dates, epitaph and legibility, accompanied by a field-level accuracy report.
  - *Process:* the index card photographed at the start of each grave groups the ≈4,000 photos into a manifest of photo → grave, row and position.
  - *Process:* Gemini reads each grave's full set of photos in one call constrained by a JSON schema, and responses are cached per grave and prompt version.
  - *Process:* accuracy is measured on a ≈10% sample, stratified by legibility, transcribed by hand and compared field by field; an unacceptable score sends the batch back to extraction with a revised prompt.
- **Photo-only records:** the ≈20% of stones too worn to read, flagged illegible, which enter the archive with their photographs.
  - *Process:* legibility is assigned by Gemini at extraction.

### Application Data Structure

- PostgreSQL holds all tabular data, and photographs stay on Cloudinary, referenced by public ID.
- **MVP archive:** four read-only tables, which are all the application needs to run.
  - `cemetery`: name and location, aerial-image size in pixels, and tile path.
  - `grave`: row and position, unique card number, legibility, and centroid and outline polygon in pixels for the map.
  - `person`: names in Latin and Hebrew script, parents, civil and Hebrew dates with their precision, epitaphs, normalised names and Daitch–Mokotoff codes for search, and OCR confidence with a verified flag.
  - `photo`: kind (main or other), Cloudinary public ID, dimensions and display order.
- One cemetery has many graves, and each grave has one or more people (shared stones) and several photos.
- Indexes behind search and filters: GIN trigram on normalised name and surname, GIN on the Daitch–Mokotoff codes, and B-tree on death date and on cemetery and row.
- `stretch` **Interaction layer:** five tables for sign-in, tributes, reminders and administration.
  - `app_user`: Google subject ID, email, display name and admin flag.
  - `tribute`: stone or candle, optional relation and message, status (pending, approved, rejected, removed), and the AI label and reason.
  - `subscription`: a user's subscription to a person, with an unsubscribe token.
  - `yahrzeit`: each person's anniversary per Hebrew year, with the time its reminder was sent.
  - `record_edit`: every admin change to a field, with old and new values.
- No MVP table references a stretch table, so the interaction layer sits alongside the archive without altering it.

### Application Architecture

**Presentation tier**

- React 19 single-page app built with Vite and styled with react-bootstrap (Bootstrap 5.3), running in the visitor's browser.
- react-leaflet 5 and Leaflet 1.9.4 (CRS.Simple) draw the aerial map with grave outlines.
- `stretch` react-i18next for Spanish (default), English and Hebrew, with Bootstrap's RTL build for Hebrew.
- `stretch` Interface for sign-in, stones and candles, subscriptions and admin mode.
- Render Static Site (flow 1) serves the app bundle and the aerial tiles through a CDN and rewrites every path to `index.html`.
- Cloudinary (flow 2) serves gravestone photos, with thumbnails and full views generated on request, and the hero video.

**Processing tier**

- Flask 3.1 API on gunicorn, running as a Render web service and exchanging JSON with the app over HTTPS (flow 3).
- MVP routes: `/api/search`, `/api/persons/:id`, `/api/map/graves`.
- `stretch` Routes: `/auth/google` (session cookie), the tributes and subscriptions APIs, and `/admin/*` for editing records and removing tributes, with CSRF protection.
- `stretch` External services: Google OAuth for sign-in and verified email, the Anthropic API for Claude Haiku's pass-or-fail verdict on messages, Cloudflare Turnstile for bot checks on writes, and Resend for email over HTTPS.
- `stretch` Render cron job: runs daily on a UTC schedule (Argentina is UTC−3), finds the next day's yahrzeits and sends reminders through Resend.

**Data tier**

- PostgreSQL ≥ 16 on Render Postgres, queried by Flask with psycopg 3 (flow 4) and by the cron job.
- Extensions: pg_trgm and fuzzystrmatch (Daitch–Mokotoff), with pgvector if search uses embeddings.
- Four MVP tables and five stretch tables, described under Application Data Structure.

### Application Interface

**Landing page:** public; MVP apart from the language toggle

- **H1** Hero over a video or drone background, with the ES | EN | HE toggle (`stretch`).
- **H2** "Ver el mapa" and "Saber más" buttons, a name search box, and a pause control for the background video.
- **H3** The community's history, with a photo stack and text.
- **H4** A two-sided timeline.
- **H5** Footer with citation, contact, corrections and privacy links, and credits to the community, collaborators and funders.

**Cemetery explorer**

- The aerial map fills the page; the search and record panels float over its left two-thirds, and the map stays visible in the right third.
- The header holds "← Inicio", back to the landing page, and the language toggle (`stretch`), whose choice is kept in the URL (e.g. `?lang=he`) so shared links open in the sender's language.
- **N2** Filter chips for surname, death-year range and records with photos, under the name search box.
- **N3** Results list showing photo, name, dates and row, with the selected result highlighted.
- **N4** Map outlines show each grave's state (no record, documented, search match, selected), with a legend and zoom control.
- **N6** `stretch` "+ Piedra" and "+ Vela" buttons over a tribute feed; messages under review are visible only to their author.
- **N7** `stretch` Next yahrzeit date, with "Recordarme" to subscribe to email reminders.
- **N8** Record panel with portrait, name, dates and the Hebrew name set right to left, followed by photos and additional details.
- **N9** `stretch` "Iniciar sesión" with Google at the top right, required for every write action.

**Admin page:** `stretch`

- Appears after an admin signs in: the explorer with editing and moderation added.
- **A1** "Modo administrador" badge and the admin's session menu with sign-out.
- **A2** Filter for tributes pending review, with a count.
- **A3** Every grave and person field is editable: surname, first name, Hebrew name, civil and Hebrew dates, parents, row, position and epitaph.
- **A4** "Guardar cambios" and "Descartar", with the date and author of the last edit; every change is logged.
- **A5** Tribute moderation: remove any stone, candle or message, approve pending messages; removed items keep the status "removed".

### Application Features

| Feature | Type | Description |
| --- | --- | --- |
| **Landing Page** | `mvp` | Public homepage with a hero section introducing the project, followed by the history of the community, the cemetery and the team's fieldwork. |
| **Interactive Cemetery Map** | `mvp` | Aerial photograph of the cemetery rendered with Leaflet, with every grave outlined and synchronised with search results and the record view. |
| **Records Navigator** | `mvp` | Search and record panes that sit on top of the cemetery map, pairing a results list with a detail view of the selected gravestone. |
| **Fuzzy Name Search** | `mvp` | Name search that tolerates typos, transliteration variants and imperfect Spanish–Hebrew spellings, using phonetic or embedding-based matching. |
| **Search Filters** | `mvp` | Filters on date of death and other record attributes that narrow the search results. |
| **Gravestone Record View** | `mvp` | Detail panel showing a grave's names, dates, parents and inscription in Spanish and Hebrew, alongside its photographs. |
| **Multilingual Interface** | `stretch` | Interface toggle between Spanish (default), English and Hebrew, with a right-to-left layout for Hebrew. |
| **Google Authentication** | `stretch` | Google sign-in gating all interactive actions and supplying users' email addresses, with the rest of the site staying public. |
| **Stone and Candle Lighting Feature** | `stretch` | Signed-in users can lay a virtual stone or light a virtual candle on a grave, optionally accompanied by a message. |
| **AI Comment Checker** | `stretch` | Every message left with a stone or candle passes through Claude Haiku via the Anthropic API, which blocks hateful or inappropriate content before publication. |
| **Yahrzeit Reminders** | `stretch` | Users subscribe to a grave and receive an annual email on the Hebrew-calendar anniversary of the death, inviting them to light a candle. |
| **Admin Interface** | `stretch` | Authenticated moderator interface with write access to the database for removing harmful contributions the AI checker misses. |
| **Mobile-Friendly Layout** | `stretch` | Responsive layout that makes the full site usable on phones. |
| **Bot Prevention** | `stretch` | Cloudflare Turnstile verification on interactive actions to stop automated spam. |

---

## 3. Code Style

Every piece of code written for this project, by Claude Code or by a team member, must follow these rules.

1. **Readable by a student.** Code must be fully understandable by a person reading it, and in particular by a student who did not write it. Prefer simple, explicit code over clever or compact code: use descriptive names, short functions that each do one thing, and straightforward control flow.
2. **Commented.** All code must be commented. Every module, class and function has a docstring (or the equivalent in other languages) saying what it does, what it takes and what it returns, and comments explain the reasoning behind any step that isn't obvious from the code itself.
3. **Pylint-clean Python 3.14.** Python code must comply with Python 3.14 standards and pass pylint with no warnings. Run pylint on every edited Python file before shipping a change, and fix any issues it reports.
4. **Unit tested.** All code must have unit tests, and the tests must be run and pass before any change is shipped. New or changed behaviour needs new or updated tests.

---

## 4. Additional Context

> Readable and writable. Add notes here as the project evolves; see section 1 for the conventions.

### Workflow

- All changes are made on individual branches, which are merged every week.
