# Rekordbox Bridge

A local Python bridge that reads Related Tracks data from the desktop Rekordbox
`master.db` SQLite database and exports it as a versioned JSON payload or uploads
it directly to the DropDex backend.

## What it does

1. Locates `master.db` on your machine (or accepts a path you provide).
2. Creates a read-only temporary copy of the database (the original is never touched).
3. Reads all **Related Tracks** lists — folders, criteria-based lists, and their
   member tracks — using [pyrekordbox](https://pypi.org/project/pyrekordbox/).
4. Serialises the data into a versioned JSON payload.
5. Either writes the payload to a local file (`export`) or uploads it to the
   DropDex backend (`upload`).
6. Deletes the temporary copy before exiting.

The raw database file is **never uploaded**. Only the extracted JSON payload
reaches the DropDex server.

## Requirements

- Python 3.11+
- [pyrekordbox](https://pypi.org/project/pyrekordbox/) >= 0.4
- [httpx](https://www.python-httpx.org/) >= 0.27 (upload subcommand only)

## Installation

```bash
pip install rekordbox-bridge
```

Or install from source:

```bash
cd bridge
pip install -e .
```

## Usage

### Export to a local JSON file

```bash
rekordbox-bridge export --output related-tracks.json
```

Specify the database path manually if auto-discovery fails:

```bash
rekordbox-bridge export \
  --db-path ~/Library/Pioneer/rekordbox/master.db \
  --output related-tracks.json
```

Dry-run (extract and summarise but write nothing):

```bash
rekordbox-bridge export --dry-run --verbose
```

### Upload to DropDex

```bash
export DROPDEX_ACCESS_TOKEN="your-token-here"

rekordbox-bridge upload \
  --api-url https://api.dropdex.app \
  --import-id <your-import-session-id>
```

The token is **always read from the `DROPDEX_ACCESS_TOKEN` environment variable**
and is never passed as a command-line argument.

Dry-run (extract and report, but do not upload):

```bash
rekordbox-bridge upload \
  --api-url https://api.dropdex.app \
  --import-id <id> \
  --dry-run
```

## Why master.db stays local

`master.db` contains your full library metadata. Uploading it would be slow,
unnecessary, and a privacy risk. The bridge extracts only the Related Tracks
structure (list names, ordering, and track IDs) and sends that compact payload
instead.

## Token setup

1. Log in to [dropdex.app](https://dropdex.app) and obtain an access token from
   your account settings.
2. Set the environment variable before running the bridge:

   ```bash
   export DROPDEX_ACCESS_TOKEN="ey..."
   ```

   On Windows (PowerShell):

   ```powershell
   $env:DROPDEX_ACCESS_TOKEN = "ey..."
   ```

The token is never written to disk by the bridge and never appears in log output.

## Before running

**Close Rekordbox before running the bridge.** Rekordbox holds a write lock on
`master.db` while it is open; running the bridge while Rekordbox is active may
result in an incomplete or corrupted snapshot.

The bridge will remind you of this at startup:

```
Please close Rekordbox before running the bridge.
```

## Auto-discovery paths

| Platform | Path |
|----------|------|
| macOS    | `~/Library/Pioneer/rekordbox/master.db` |
| Windows  | `%LOCALAPPDATA%\Pioneer\rekordbox\master.db` |

## Development

```bash
pip install -e ".[dev]"
pytest
```

Tests do not require pyrekordbox or a real Rekordbox database — all external
dependencies are mocked.
