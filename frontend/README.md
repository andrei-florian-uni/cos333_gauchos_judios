# Gauchos Judíos · frontend

The public website of the archive: a React 19 single-page app built with Vite
and styled with react-bootstrap (Bootstrap 5.3).

| Route | Page |
| --- | --- |
| `/` | Landing page (`src/LandingPage.jsx`) |
| `/explore?q=…` | Name search and results (`src/ExplorePage.jsx`) |
| `/record/:ref` | Placeholder for a grave's record, e.g. `/record/W-12-4` |

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run lint     # before every change
npm run build    # production bundle in dist/
```

Searches go to the Flask API through `src/api.js`, at the address in
`VITE_API_URL`:

- `npm run dev` reads `.env.development`, which points at a local API
  (`python app.py` from `backend/`, port 5001). That API uses the database in
  `backend/.env` (the shared one) unless `DATABASE_URL` is set in the shell.
- The API accepts browser requests only from the origins in its `CORS_ORIGINS`
  setting, by default `http://localhost:5173`. If Vite starts on another port,
  searches fail until that port is added.
- `npm run build` does not read `.env.development`: set `VITE_API_URL` for the
  build (Render does so from its environment settings), or the built site
  sends its searches to itself and every search fails.
