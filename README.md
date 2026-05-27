# DropDex

DJ library companion for rekordbox USB collections. Upload your USB database, browse playlists, inspect track metadata, and manage multiple import snapshots from the cloud.

## What it does

- Import your rekordbox USB database (`exportLibrary.db`) into a personal cloud library
- Browse all playlists with ordered track positions, BPM statistics, and total duration
- View full track metadata: BPM, key, genre, album, label, comments, file path
- See every playlist a track appears in, with its position in each
- Search across all tracks by title, artist, or genre
- Maintain multiple import snapshots and switch the active library
- Review mode for scanning your collection track by track

## Discovery

The **Discover** tab lets you search the DropDex artist catalog and pull their
setlists from 1001Tracklists.

- Search by artist name — only artists already in the DropDex catalog appear
- Click **Find Setlists** to start a background scrape job for the selected artist
- Watch live progress (queued → running → completed/failed)
- Browse saved setlist cards with artwork, date, track IDs, genre chips, and
  view/like counts
- Click the 1001Tracklists link on any card to open the original set page
- Re-run the scrape at any time via **Refresh Results** to pick up new sets

**Implementation note:** All scraping runs in the FastAPI backend (Playwright +
Chromium). The frontend never contacts 1001Tracklists.com directly — it only
talks to the DropDex backend API. The scraper uses the public rendered search
page; it does not capture or replay any `acc` tokens, session cookies, or
private API calls.

**Rate guidance:** The scraper introduces a configurable delay between
pagination requests (`TRACKLISTS_SCRAPER_DELAY_MS`, default 1 s). Avoid
triggering repeated rapid scrapes for the same artist. One scrape per artist
per session is the expected usage pattern.

**Current limitation:** Individual track extraction from a selected setlist is
not yet implemented. The `Select Set` button stores the selection and shows a
placeholder — full track scraping is the next planned phase.

## Architecture

| Layer | Technology |
|-------|------------|
| Frontend | React 19 + TypeScript 5.8 + Vite 6 + Tailwind CSS v4 |
| Auth & DB | Supabase (Auth, Postgres, Row Level Security) |
| Import backend | Python 3.11+ / FastAPI / uvicorn |
| Library parser | pyrekordbox + sqlcipher3 |
| Discovery scraper | Playwright + Chromium + selectolax |

### Import pipeline

```
USB drive: PIONEER/rekordbox/exportLibrary.db
    │  (uploaded from browser)
    ▼
FastAPI backend
  ├─ Validates Bearer JWT (SUPABASE_JWT_SECRET → user_id from sub claim)
  ├─ Writes bytes to private temp file
  ├─ Parses with pyrekordbox (DeviceLibraryPlus)
  ├─ Validates referential integrity
  ├─ Writes snapshot to Supabase (service-role key, bypasses RLS)
  ├─ Marks snapshot as the user's active import
  └─ Deletes temp file (always, even on failure)
    │
    ▼
Supabase Postgres (per-user, RLS enforced)
  ├─ rekordbox_imports          — one row per snapshot
  ├─ rekordbox_tracks           — track metadata
  ├─ rekordbox_playlists        — playlist tree
  ├─ rekordbox_playlist_tracks  — ordered track placements
  └─ rekordbox_user_settings    — active import pointer
```

## Local development

### Prerequisites

- Node.js ≥ 20
- Python ≥ 3.11
- A Supabase project with the schema migrations applied
- SQLCipher native library (required by `sqlcipher3`)

On macOS:
```bash
brew install sqlcipher
```

### 1. Frontend

```bash
npm install
cp .env.example .env        # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev                 # http://127.0.0.1:3000
```

### 2. Parser package

```bash
cd importer
pip install -e .
```

### 3. Backend

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env        # fill in SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_JWT_SECRET
uvicorn app.main:app --reload   # http://localhost:8000
```

### 4. Apply database migrations

Run in order against your Supabase project (SQL editor or `supabase db push`):

1. `supabase/migrations/20260526120000_rekordbox_schema.sql` — rekordbox tables and RLS
2. `supabase/migrations/20260526130000_user_settings.sql` — active import management
3. `supabase/migrations/20260527010000_create_genres_and_artist_genres.sql` — genres catalog
4. `supabase/migrations/20260527020000_backfill_artists_genres_from_site_db.sql` — genre backfill
5. `supabase/migrations/20260527030000_create_discovery_scrape_job_support.sql` — discovery tables, artists, scrape jobs, setlist results

## Environment variables

### Frontend (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | Yes | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Yes | Anon/publishable key — safe to expose |
| `VITE_IMPORT_API_URL` | Yes | Backend base URL (default: `http://localhost:8000`) |

### Backend (`backend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Yes | Service-role key — server-side only, never in frontend |
| `SUPABASE_JWT_SECRET` | Yes | JWT secret for token validation |
| `FRONTEND_ORIGIN` | No | Allowed CORS origin (default: `http://127.0.0.1:3000`) |
| `MAX_UPLOAD_BYTES` | No | Max upload size in bytes (default: 52 428 800 / 50 MB) |
| `TRACKLISTS_SCRAPER_HEADLESS` | No | Run Chromium headless (default: `true`) |
| `TRACKLISTS_SCRAPER_NAVIGATION_TIMEOUT_MS` | No | Playwright wait timeout in ms (default: `30000`) |
| `TRACKLISTS_SCRAPER_DELAY_MS` | No | Delay between pagination clicks in ms (default: `1000`) |
| `TRACKLISTS_SCRAPER_MAX_PAGES` | No | Hard ceiling on pages scraped per artist (default: `50`) |

## Security rules

- **Frontend uses the anon key only.** Never add a `service_role` or any secret key to a `VITE_`-prefixed variable — these are bundled into public JavaScript.
- **Backend secret key never enters frontend code.** `SUPABASE_SECRET_KEY` is strictly server-side.
- **User identity comes from the JWT only.** The backend validates the `sub` claim from the Bearer token; no `user_id` is accepted from form data or URL parameters.
- **Uploaded `exportLibrary.db` files are temporary.** Each upload is written to a private temp path, parsed, then deleted — whether the import succeeds or fails.
- **RLS is active on all tables.** Authenticated users can only read and delete their own rows.
- **`*.db` and `.env*` files are gitignored.** Neither database files nor secret environment files should ever be committed.

## Finding exportLibrary.db

On a rekordbox USB drive, the database is located at:

```
<drive>/PIONEER/rekordbox/exportLibrary.db
```

On macOS the drive appears under `/Volumes/<name>/`. On Windows it appears as a drive letter.

> The XML export (`rekordboxLibrary.xml`) is **not** used by DropDex. Select the `.db` file.

## Imports as snapshots

Each upload creates an independent snapshot row in `rekordbox_imports`. Playlists and tracks are linked exclusively to that snapshot. Deleting a snapshot cascades and removes all its playlists and tracks.

### Switching the active import

The active import is stored in `rekordbox_user_settings.active_import_id`. From **Settings → USB Library Snapshots**, each snapshot has a **Make Active** button. After deletion of the active snapshot the system automatically falls back to the next most recent completed import.

## Smoke-test checklist

- [ ] Sign in with email/password via the Supabase Auth UI
- [ ] Upload `exportLibrary.db` from the import modal
- [ ] Success summary shows expected track and playlist counts
- [ ] New import appears as Active in Settings → USB Library Snapshots
- [ ] All playlists appear in the Library view
- [ ] Open a playlist — tracks are ordered by playlist position
- [ ] Open a track — metadata (BPM, key, genre, label, file path) is populated
- [ ] Appears In section lists the correct playlists for that track
- [ ] Upload a second snapshot
- [ ] Make the first snapshot active — Library view reloads with it
- [ ] Delete the inactive snapshot — it disappears from Settings
- [ ] Verify a second user account cannot see the first user's imports

## Running tests

```bash
# Frontend type-check and build
npm run lint
npm run build

# Backend unit tests
cd backend
source .venv/bin/activate
python -m pytest tests/ -v
```

## Known technical debt

- The bundle exceeds 500 KB (gzip: ~181 KB). Code-splitting via `React.lazy` or Vite `manualChunks` would reduce initial load time but has not been implemented.
- `fetchTrackPlaylists` filters by `import_id` in JavaScript after fetching all rows for a track across all imports. A PostgREST join filter on the playlists table would be more efficient for users with many imports.
- The backend sets `active_import_id` via a direct REST call after writing the import. If this call fails (non-fatal), the user sees the fallback (newest import) on next load — functionally correct but the explicit setting is silently skipped.
