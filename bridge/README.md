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

## Internal Stage 5 writer foundation

Stage 5 adds a deliberately **non-public, staging-only** writer foundation under
`rekordbox_bridge.writer*`. It is not registered as a CLI command and is not
exposed through Electron or the renderer.

The write-capable path has stricter rules than the read-only export/upload path:

- the live target is always discovered internally; caller-supplied database paths are rejected by design,
- removable/USB targets, symlinks, traversal aliases, and unknown storage classifications fail closed,
- Rekordbox must be proven closed before backup or staging mutation,
- a collision-safe recovery backup is created before an isolated writable staging generation,
- only planned Rekordbox `ContentID` values are changed, with `ContentUUID` resolved from the current local DB,
- the committed staging DB is reopened and its writer-relevant `DjmdCue` fields are verified,
- the live local `master.db` is never replaced or opened for writing in Stage 5,
- ANLZ files are never modified.

The existing `export` and `upload` commands remain read-only and keep their
`--db-path` option. That option is intentionally **not** part of the writer
contract.

## Internal Stage 6 verified apply engine

Stage 6 builds on the Stage 4 saved-draft contract and the Stage 5 trusted-target,
process, backup, staging, and DjmdCue writer boundaries. The new
`rekordbox_bridge.apply_service` module remains internal and is not registered in
the CLI, Electron main process, preload bridge, or renderer.

The Stage 6 transition is deliberately two-phase:

1. `preflight_saved_cue_drafts(...)` adapts persisted saved revisions, discovers
   the trusted local database, proves Rekordbox is closed, rejects SQLite
   WAL/journal sidecars, reads current cues from a private snapshot, and returns
   an opaque short-lived single-use token bound to the observed local generation,
   per-track cue fingerprints, and saved-plan fingerprint.
2. `apply_saved_cue_drafts(token, same_saved_rows)` consumes that token, re-runs
   the Stage 5 safety guard, rejects stale local/saved state, creates the durable
   Stage 5 backup and complete staging generation, verifies every staged target,
   prepares rollback, and re-runs the deepest target/process guard immediately
   before the live handoff.
3. The normal path performs one same-filesystem `os.replace` of `master.db`,
   reopens a private copy of the live generation, and verifies all writer-relevant
   cue fields. A post-replacement verification failure atomically restores the
   prepared copy of the durable backup and reopens/re-verifies the old state.

The recovery backup is retained. Temporary staging/rollback candidates are
cleaned up without deleting that backup. USB/removable targets and ANLZ writes
remain forbidden, and Stage 6 still exposes no renderer writer API.

### Stage 1 cue-apply safety contract

Destructive cue replacement now requires two persisted values that are separate
from the editable cue document: `imported_baseline_local_cue_fingerprint`, a
canonical per-track fingerprint of the imported DB-backed cue set using the
same `DjmdCue` cue semantics as preflight. ANLZ-only or source-conflicting cue
imports are intentionally non-comparable and block apply. The imported track's
`master_db_id` /
`master_content_id` identity copied server-side from `rekordbox_tracks`. Legacy
drafts may still load, but preflight does not issue an apply token when this
baseline or strong identity is unavailable, ambiguous, stale, or mismatched.
The existing generation/per-track token check still protects the interval from
successful preflight through the final live handoff.
