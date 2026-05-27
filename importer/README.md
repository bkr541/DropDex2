# DropDex — rekordbox Importer

Standalone Python tool that reads a rekordbox USB export database
(`exportLibrary.db`) and inserts the library metadata into the DropDex
Supabase project.

---

## Purpose

rekordbox's Device Library Plus format stores your library in a SQLite
database called `exportLibrary.db` on the USB drive.  This importer
extracts tracks, playlists, and ordered playlist-track placements from
that file and writes them into the four Supabase tables defined in the
project migration:

- `rekordbox_imports`
- `rekordbox_tracks`
- `rekordbox_playlists`
- `rekordbox_playlist_tracks`

The source database is **never modified**.

---

## Dependency decision: pyrekordbox

The stable PyPI release of pyrekordbox (`0.4.4` as of 2025-08-17) does
**not** include `DeviceLibraryPlus`.  Support for `exportLibrary.db`
was added to the `main` branch but has not yet been tagged as a release.

`requirements.txt` therefore pins the exact git commit where this support
was merged:

```
pyrekordbox @ git+https://github.com/dylanljones/pyrekordbox.git@f695541827cc488af267d6ca8a8e0052598d85a0
```

Once a PyPI release that includes `DeviceLibraryPlus` ships, `requirements.txt`
should be updated to use a version specifier instead.

---

## Requirements

- **Python 3.9 or later** (tested on 3.13)
- **pip** 22+
- A rekordbox USB drive with an `exportLibrary.db` file (Device Library Plus
  format; produced by Pioneer hardware such as OPUS-QUAD, OMNIS-DUO, XDJ-AZ)

---

## Installation

### 1 — Create a virtual environment (recommended)

```bash
cd importer/
python3 -m venv .venv
source .venv/bin/activate        # macOS / Linux
# .venv\Scripts\activate         # Windows
```

### 2 — Install dependencies

```bash
pip install -r requirements.txt
```

`requirements.txt` installs:
- `pyrekordbox` from the pinned git commit (includes `DeviceLibraryPlus`)
- `sqlcipher3-binary` — pre-compiled SQLCipher library for opening the
  encrypted database
- `supabase` — Python client for the Supabase REST API
- `python-dotenv` — loads `.env` at startup

#### Troubleshooting: sqlcipher3-binary

If `pip install sqlcipher3-binary` fails because no wheel is available for
your platform:

**macOS (Homebrew):**
```bash
brew install sqlcipher
pip install sqlcipher3
```

**Ubuntu / Debian:**
```bash
sudo apt-get install libsqlcipher-dev
pip install sqlcipher3
```

**Windows:** Download a pre-built SQLCipher DLL and follow the
[sqlcipher3 build instructions](https://github.com/rigglemania/pysqlcipher3).

---

## Environment variables

Copy `.env.example` to `.env` and fill in the three required values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | Yes | Project URL (same as `VITE_SUPABASE_URL` in the frontend) |
| `SUPABASE_SECRET_KEY` | Yes | **service_role** key — bypasses RLS for server-side inserts |
| `DROPDEX_OWNER_USER_ID` | Yes | Supabase Auth UUID of the user who will own this import |
| `EXPORT_LIBRARY_PATH` | Optional | Path to `exportLibrary.db`; can be supplied via `--file` instead |

**Security:** `SUPABASE_SECRET_KEY` is the service-role key.  It must
**never** appear in frontend source files, environment variables with a
`VITE_` prefix, or any file committed to version control.

---

## Usage

### Dry run (parse only, no writes)

```bash
python import_export_library.py \
    --file /Volumes/MyUSB/PIONEER/rekordbox/exportLibrary.db \
    --dry-run
```

Dry-run output includes:
- Track count, playlist count, placement count
- First 10 playlists with their track counts
- 5-track metadata sample
- Warnings for missing artist / BPM / key values

Exit code `0` on success, `1` on parser failure or validation errors.

### Import to Supabase

```bash
python import_export_library.py \
    --file /Volumes/MyUSB/PIONEER/rekordbox/exportLibrary.db \
    --import-to-supabase
```

### Remove a previous failed test import, then re-import

```bash
python import_export_library.py \
    --file /Volumes/MyUSB/PIONEER/rekordbox/exportLibrary.db \
    --import-to-supabase \
    --replace-latest-failed
```

`--replace-latest-failed` deletes only the **most recent** import row for
your user ID that has `status = failed`.  Completed imports are never
touched automatically.

### Verbose output

```bash
python import_export_library.py --file ... --dry-run --verbose
```

---

## Expected validation counts (test database)

| Metric | Expected |
|---|---|
| Tracks | 2,192 |
| Playlists | 12 |
| Playlist-track placements | 3,965 |

If your dry-run output matches these counts the parser is working correctly.

---

## Security warnings

1. **`SUPABASE_SECRET_KEY` is a service-role key.**  It bypasses all Row
   Level Security policies and has full read/write access to your database.
   Treat it like a database root password.

2. **Never add `SUPABASE_SECRET_KEY` to any file with a `VITE_` prefix.**
   Vite bundles `VITE_*` variables into the browser JavaScript bundle, where
   they are publicly visible to anyone who inspects the page source.

3. **Never commit `importer/.env` to git.**  The `.gitignore` at the repo
   root already excludes `.env*` files (with an exception for `.env.example`).

4. **`exportLibrary.db` contains your private library metadata.**  Do not
   commit it to version control or share it publicly.  The `.gitignore` at
   the repo root excludes `*.db` and `exportLibrary.db` to prevent accidental
   commits.
