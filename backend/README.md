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
