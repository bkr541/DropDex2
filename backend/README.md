# DropDex Backend

FastAPI backend that accepts authenticated rekordbox `exportLibrary.db` uploads
and imports them into the user's Supabase-backed DropDex library.

## Why secrets stay here and never in the frontend

| Secret | Where | Why |
|---|---|---|
| `SUPABASE_SECRET_KEY` (service_role) | Backend `.env` only | Bypasses RLS — if exposed, anyone can read or write any user's data |
| `SUPABASE_JWT_SECRET` | Backend `.env` only | Used to verify user tokens — if exposed, anyone can forge authentication |
| `VITE_SUPABASE_ANON_KEY` | Frontend `.env` | Safe to expose; RLS limits what it can access |

`VITE_` variables are bundled into browser JavaScript and are publicly visible.
Never put `SUPABASE_SECRET_KEY` or `SUPABASE_JWT_SECRET` in a `VITE_` variable.

## Required environment variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable | Where to find it |
|---|---|
| `SUPABASE_URL` | Supabase Dashboard → Settings → API → Project URL |
| `SUPABASE_SECRET_KEY` | Supabase Dashboard → Settings → API → Project API Keys → `service_role` |
| `SUPABASE_JWT_SECRET` | Supabase Dashboard → Settings → API → JWT Settings → JWT Secret |
| `FRONTEND_ORIGIN` | URL of the Vite dev server or production frontend (default: `http://127.0.0.1:3000`) |
| `MAX_UPLOAD_BYTES` | Upload size cap in bytes (default: 52428800 = 50 MB) |
| `TRACKLISTS_SCRAPER_HEADLESS` | Run Chromium headless (default: `true`; set `false` to debug visually) |
| `TRACKLISTS_SCRAPER_NAVIGATION_TIMEOUT_MS` | Playwright wait timeout in ms (default: `30000`) |
| `TRACKLISTS_SCRAPER_DELAY_MS` | Delay between pagination clicks in ms (default: `1000`) |
| `TRACKLISTS_SCRAPER_MAX_PAGES` | Hard ceiling on pages scraped per artist (default: `50`) |

## Local setup

### 1. System dependency (macOS)

SQLCipher is required to decrypt `exportLibrary.db`:

```bash
brew install sqlcipher
```

### 2. Python virtual environment

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
```

### 3. Install the shared importer package

The parser and Supabase writer live in `importer/dropdex_importer/`.
Install them as an editable package so the backend can import them:

```bash
pip install -e ../importer
```

This also installs `pyrekordbox` (git-pinned build with `DeviceLibraryPlus`),
`sqlcipher3`, and the `supabase` client.

### 4. Install backend dependencies

```bash
pip install -r requirements.txt
```

### 4a. Install Playwright browser binaries

The discovery scraper uses Playwright's Chromium browser:

```bash
playwright install chromium
```

Only needed for local development or when running the scraper directly.
The CI/CD environment must also run this command if scraping is exercised.

**Scraping implementation note:** The scraper navigates the public
1001Tracklists search results page using a rendered browser session (Playwright
+ Chromium). It does **not** capture, store, or replay `acc` request tokens,
session cookies, or any other private API credentials. HTML is parsed in-memory
with `selectolax`; full HTML bodies are **not** persisted to Supabase.

**Rate guidance:** A configurable delay (`TRACKLISTS_SCRAPER_DELAY_MS`,
default 1 000 ms) is applied between pagination requests. Do not reduce this
below 500 ms in production. One scrape per artist per session is the intended
usage pattern — triggering repeated rapid scrapes for the same artist is
outside the designed use case.

### 4b. Background-task durability note

Discovery scrape jobs run as FastAPI in-process background tasks.
This is sufficient for local / single-instance development but is **not
durable across process restarts**.  A job whose status is `running` when the
process exits will be orphaned in `public.scrape_jobs` with no automatic
recovery.

For production, migrate `app.discovery.service.run_discovery_for_artist` to a
durable worker (Celery, ARQ, or a Supabase Edge Function).  The orchestration
logic is worker-agnostic; only `job_runner.py` changes.  On worker startup,
poll for jobs stuck in `running` status and reset them to `queued` for retry.

### 5. Configure environment

```bash
cp .env.example .env
# Edit .env and fill in SUPABASE_SECRET_KEY and SUPABASE_JWT_SECRET
```

### 6. Start the server

```bash
uvicorn app.main:app --reload --port 8000
```

The frontend Vite dev server runs on port 3000 by default. CORS is configured
to allow only `FRONTEND_ORIGIN`.

## Running tests

```bash
cd backend
pytest tests/ -v
```

Tests mock the parser and Supabase writer so they run without a real database
or credentials.

## Developer fixture script

Parse a saved HTML file from a 1001Tracklists search results page without
launching Chromium or writing to Supabase:

```bash
# Summary output
python scripts/parse_fixture.py path/to/page.html

# Full JSON dump of all parsed fields
python scripts/parse_fixture.py path/to/page.html --json
```

Useful for iterating on `parser.py` or `selectors.py` changes against a known
HTML snapshot.

## Discovery API endpoints

All four endpoints require a valid Supabase Bearer token derived from the
frontend `supabase.auth.getSession()` call.  `user_id` is **never** accepted
from the request body — it is always extracted from the JWT.

Individual set-page track scraping is **not** included in this phase.

### `GET /api/discovery/artists/search?q=<query>`

Search the DropDex artist catalog (`public.artists` + `public.artist_aliases`).
This is **not** a call to 1001Tracklists.

Queries shorter than 2 characters return an empty list.  Up to 20 candidates
are returned; alias matches include the `matched_alias` field.

**Request**

```
GET /api/discovery/artists/search?q=illenium
Authorization: Bearer <supabase_access_token>
```

**Response (200)**

```json
[
  {
    "id": "aaaaaaaa-0000-0000-0000-000000000001",
    "name": "ILLENIUM",
    "normalized_name": "illenium",
    "matched_alias": null
  },
  {
    "id": "bbbbbbbb-0000-0000-0000-000000000002",
    "name": "ILLENIUM b2b Feed Me",
    "normalized_name": "illenium b2b feed me",
    "matched_alias": "illenium b2b"
  }
]
```

---

### `POST /api/discovery/artists/{artist_id}/setlists/scrape`

Queue a 1001Tracklists discovery scrape for a known DropDex artist.
Returns **202 Accepted** immediately; poll the job-status endpoint for progress.

- `artist_id` must be a UUID present in `public.artists`.
- The canonical artist name is resolved from the database; **no freeform artist
  string is accepted in the request body**.
- Discovery runs as an in-process background task (see durability note in the
  [Background-task durability note](#4b-background-task-durability-note) section).

**Request**

```
POST /api/discovery/artists/aaaaaaaa-0000-0000-0000-000000000001/setlists/scrape
Authorization: Bearer <supabase_access_token>
```

**Response (202)**

```json
{
  "job_id": "cccccccc-0000-0000-0000-000000000003",
  "artist_id": "aaaaaaaa-0000-0000-0000-000000000001",
  "artist_name": "ILLENIUM",
  "status": "queued"
}
```

**Error responses**

| Status | Meaning |
|---|---|
| 401 | Missing, invalid, or expired Bearer token |
| 404 | `artist_id` not found in the DropDex catalog |

---

### `GET /api/discovery/scrape-jobs/{job_id}`

Poll the status of a previously queued scrape job.

- A user may only retrieve jobs they requested.  Jobs belonging to other users
  return **404** (not 403) to avoid leaking job existence.

**Request**

```
GET /api/discovery/scrape-jobs/cccccccc-0000-0000-0000-000000000003
Authorization: Bearer <supabase_access_token>
```

**Response (200)**

```json
{
  "job_id": "cccccccc-0000-0000-0000-000000000003",
  "artist_id": "aaaaaaaa-0000-0000-0000-000000000001",
  "artist_name": "ILLENIUM",
  "source": "1001tracklists",
  "status": "completed",
  "pages_scraped": 4,
  "results_found": 80,
  "total_results_reported": 85,
  "error_message": null,
  "created_at": "2026-05-27T10:00:00+00:00",
  "started_at": "2026-05-27T10:00:01+00:00",
  "completed_at": "2026-05-27T10:00:45+00:00"
}
```

`error_message` is non-null only when `status` is `"failed"`.

**Error responses**

| Status | Meaning |
|---|---|
| 401 | Missing, invalid, or expired Bearer token |
| 404 | Job not found or does not belong to the requesting user |

---

### `GET /api/discovery/artists/{artist_id}/setlists`

Retrieve stored setlist results already in DropDex for the given artist.
**Does not trigger a new scrape** — use the scrape endpoint for that.

Results are ordered by `set_date DESC NULLS LAST`.

**Query parameters**

| Parameter | Default | Max | Description |
|---|---|---|---|
| `limit` | 20 | 100 | Number of results per page |
| `offset` | 0 | — | Zero-based row offset |

**Request**

```
GET /api/discovery/artists/aaaaaaaa-0000-0000-0000-000000000001/setlists?limit=10&offset=0
Authorization: Bearer <supabase_access_token>
```

**Response (200)**

```json
{
  "artist_id": "aaaaaaaa-0000-0000-0000-000000000001",
  "total": 85,
  "limit": 10,
  "offset": 0,
  "results": [
    {
      "id": "eeeeeeee-0000-0000-0000-000000000005",
      "source_tracklist_id": "tl001",
      "source_url": "https://www.1001tracklists.com/tracklist/tl001/illenium-edc-2026.html",
      "title": "ILLENIUM @ EDC Las Vegas 2026",
      "artwork_url": "https://cdn.1001tracklists.com/images/...",
      "set_date": "2026-05-18",
      "ided_tracks": 20,
      "total_tracks": 20,
      "completion_pct": 100.0,
      "duration_text": "1h 30min",
      "duration_seconds": 5400,
      "music_styles": ["Melodic Dubstep", "Future Bass"],
      "listen_sources": [{"name": "SoundCloud", "url": "https://soundcloud.com/..."}],
      "views": 12500,
      "likes": 340,
      "creator_username": "illenium",
      "creator_profile_url": "https://www.1001tracklists.com/dj/illenium/",
      "updated_at": "2026-05-27T08:30:00+00:00"
    }
  ]
}
```

**Error responses**

| Status | Meaning |
|---|---|
| 401 | Missing, invalid, or expired Bearer token |
| 404 | `artist_id` not found in the DropDex catalog |
| 422 | `limit` out of range (1–100) or `offset` negative |

---

## API endpoint

### `POST /api/rekordbox/import`

Upload a rekordbox `exportLibrary.db` file and create a new import snapshot.

**Request**

```
POST /api/rekordbox/import
Authorization: Bearer <supabase_access_token>
Content-Type: multipart/form-data

file: <exportLibrary.db binary>
```

The `Authorization` header must contain the signed-in user's Supabase access
token (available from `supabase.auth.getSession()` in the frontend). The user
identity is derived exclusively from this token — no `user_id` field in the
form is accepted or trusted.

**Response (200)**

```json
{
  "import_id": "uuid",
  "status": "completed",
  "source_filename": "exportLibrary.db",
  "track_count": 2192,
  "playlist_count": 12,
  "playlist_track_count": 3965,
  "playlists": [
    { "name": "DVYDRM DJ", "track_count": 1898 },
    { "name": "LUMA",      "track_count": 942  }
  ]
}
```

**Error responses**

| Status | Meaning |
|---|---|
| 401 | Missing, invalid, or expired Bearer token |
| 413 | File exceeds `MAX_UPLOAD_BYTES` |
| 422 | File is not a `.db` file, or parser/validation failed |
| 500 | Server-side error (import row marked `failed` in Supabase) |

Error details are intentionally vague for 500 responses to avoid leaking
internal information.

## How imports appear in the frontend

After a successful import the new row appears in `rekordbox_imports` with
`status = completed`. The frontend hook `useLatestRekordboxImport` fetches the
most recent completed import for the signed-in user, so the new library
snapshot is visible immediately on next page load or hook refetch.

Each upload creates an independent snapshot. Prior imports are not deleted
automatically; import history management is a planned future phase.

## Docker

Build context must be the **repository root** so both `importer/` and
`backend/` are available:

```bash
# From the repo root:
docker build -f backend/Dockerfile -t dropdex-backend .
docker run -p 8000:8000 --env-file backend/.env dropdex-backend
```
