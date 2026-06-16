# DropDex Rekordbox Integration

## Overview

DropDex imports Rekordbox library data through a staged pipeline with three distinct phases:

1. **Start import** — upload `exportLibrary.db`, receive the ANLZ manifest
2. **Batch upload** — upload DAT, EXT, and 2EX analysis files
3. **Complete** — server parses and persists all analysis features

---

## Import Modes

### Database-only import

Upload only `exportLibrary.db`. Track metadata (title, artist, BPM, key, playlists) is imported. ANLZ analysis data (beat grids, waveforms, cues, phrases) is not collected.

```
POST /api/rekordbox/import
```

### USB folder import

Select the USB drive folder containing `exportLibrary.db` and the `PIONEER/USBANLZ/` tree. DropDex finds the database file, starts the import to get the manifest, then uploads ANLZ files that match the manifest in concurrent batches.

### ZIP bundle import

Upload a ZIP archive containing `exportLibrary.db` at the root and a `PIONEER/USBANLZ/` tree alongside it.

```
POST /api/rekordbox/import/bundle
```

---

## Supported ANLZ Data

All analysis data is extracted from Rekordbox `.DAT`, `.EXT`, and `.2EX` files.

| Feature | Tags read | Stored in |
|---|---|---|
| Beat grids | PQTZ (DAT), PQT2 (EXT) | `rekordbox_track_beat_grids` |
| Preview waveforms | PWV4 (EXT), PWAV/PWV2 (DAT) | `rekordbox_track_waveforms.preview_columns` |
| Detail waveforms | PWV5 (EXT), PWV3 (EXT) | Storage (gzip JSON) |
| Hot cues + memory cues | PCO2 (EXT), PCOB (DAT/EXT) | `rekordbox_cues` |
| Phrase analysis | PSSI (EXT) | `rekordbox_track_phrases` |
| recommendedLike edges | DB table `djmdSongRelatedLink` | `rekordbox_recommendation_edges` |

### Preserved but unsupported tags

Tags not yet decoded are preserved in `rekordbox_analysis_assets.unknown_tag_types`. The `.2EX` file format (PWV6, PWV7, PWVC) is uploaded and stored but not decoded; the asset `parse_status` is set to `partial`. Future parser upgrades can reparse retained assets without re-upload.

### Parser version

`DROPDEX_ANLZ_PARSER_VERSION` is stored on every analysis asset row and on the import row. Bumping this version enables targeted reparse of older assets via the reparse command.

---

## recommendedLike Behavior

Rekordbox stores track-to-track recommendation links in its Device Library Plus database table `djmdSongRelatedLink` (imported as `rekordbox_recommendation_edges`). These edges have a direction (`source_track_id → target_track_id`) and an optional integer rating.

**What DropDex calls this:** `Rekordbox recommendedLike` — or in UI: `Rekordbox match`.

**What it is not:** This data is not labeled as Collection Radar, Streaming Radar, Rekordbox AI, or an Official Rekordbox similarity score. The underlying Rekordbox feature behavior is not publicly documented and its semantics are not overstated.

Direction is preserved:

- **Outgoing**: track A has an edge to track B
- **Incoming**: track B has an edge back to track A
- **Reciprocal**: edges exist in both directions (strongest relationship)

---

## Similar Vibes Scoring

Similar Vibes queries two sources and merges them:

1. **`rekordbox_recommendation_edges`** — direct Rekordbox relationships
2. **Camelot-compatible tracks** — DB query filtered by Camelot wheel position and BPM range

### Score constants

| Signal | Score |
|---|---|
| Reciprocal recommendedLike edge | +40 |
| Outgoing recommendedLike edge | +25 |
| Incoming recommendedLike edge | +10 |
| Rating per point (1–5) | +3 each |
| Same Camelot key | +30 |
| Relative major/minor (same number, opposite mode) | +25 |
| Adjacent Camelot position (±1) | +20 |
| Energy boost (+2 positions) | +12 |
| BPM proximity (up to tolerance) | +10 scaled |
| Same genre | +5 |
| Same label | +3 |

Each score contribution produces a human-readable reason badge in the UI (e.g. "Rekordbox match", "Same Camelot key", "±0.8 BPM", "Same genre").

### Normalized key matching

Camelot queries use the `camelot_key` field (normalized, e.g. `8A`) rather than the raw `musical_key` string. This means "A minor", "Am", and "8A" all match as the same key.

### Backward compatibility

If the recommendation-edge query fails, Similar Vibes falls back to Camelot + BPM results only. The section never goes blank due to an edge fetch failure.

---

## Related Tracks Bridge

The desktop Rekordbox Related Tracks data is not reliably exported in `exportLibrary.db`. The `rekordbox-bridge` CLI tool reads `master.db` locally and uploads a structured JSON payload to DropDex.

### Why master.db stays local

`master.db` is never uploaded. The bridge:

1. Locates `master.db` automatically or accepts `--db-path`
2. Copies the database to a private temporary snapshot
3. Opens the snapshot read-only
4. Extracts only Related Tracks lists and their ordered members
5. Deletes the snapshot in a `finally` block
6. Uploads the extracted JSON (not the database)

### Commands

```bash
# Export to a local JSON file
python -m rekordbox_bridge export --output related-tracks.json

# Upload directly to the DropDex backend
python -m rekordbox_bridge upload \
  --api-url http://localhost:8000 \
  --import-id <uuid>
```

The access token is read from the `DROPDEX_ACCESS_TOKEN` environment variable. It is never accepted as a CLI argument.

### Payload schema

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-06-16T00:00:00Z",
  "source": {
    "rekordboxDatabaseId": "...",
    "rekordboxVersion": "...",
    "deviceName": "..."
  },
  "lists": [
    {
      "sourceListId": "1",
      "parentSourceListId": null,
      "name": "Warm Up",
      "sortOrder": 1,
      "isFolder": false,
      "attribute": 0,
      "criteriaRaw": {},
      "members": [
        { "masterContentId": "123", "position": 1, "sourcePayload": {} }
      ]
    }
  ]
}
```

**Lists remain lists.** A 2,000-track criteria list is stored as one list with its criteria preserved, not expanded into 2,000 × 1,999 direct edges.

### Privacy model

- `master.db` never leaves the local machine.
- Only the extracted JSON (track IDs and list structure) is sent over the network.
- The bridge token is read from the environment only; it is not logged.
- Uploads go to the authenticated user's own import — cross-user upload is rejected by the backend.

---

## Track Matching (Related Tracks)

When the backend receives a Related Tracks payload, it matches `masterContentId` values to `rekordbox_tracks` rows:

1. **Primary**: `master_content_id` exact match
2. **Secondary**: `rekordbox_content_id` exact match

Ambiguous matches (multiple candidates) are skipped. Sole-title matches are never used. Unmatched members are counted and reported in the response.

---

## Incremental Rescan

When a new import is started from the same device, DropDex compares the new tracks against the most recent completed import for the same user.

### Track identity order

1. `master_db_id + master_content_id` — strongest, stable across exports
2. `rekordbox_content_id` alone — same device, different DB snapshot

Cross-user reuse is impossible — the prior-import query is scoped to `user_id`.

### Reuse rules

| Condition | What is reused |
|---|---|
| Stable identity + same `analysis_data_update_count` | Beat grid, waveforms, phrases |
| Stable identity + same `cue_update_count` | Reconciled cues |
| `information_update_count` changed only | Metadata refresh; analysis preserved |
| `analysis_data_file_path` changed | New ANLZ upload required |
| Missing update counters | Assume unchanged (conservative) |

Each new import owns its own normalized rows — data is copied, not shared. The `analysis_reused_from_track_id` column preserves provenance.

### Frontend display

The import modal shows a Reuse Summary when incremental reuse occurs:

- **Reused unchanged** — tracks fully reused (no upload required)
- **Uploaded** — tracks that required new ANLZ files
- **Reparsed from retained** — tracks re-parsed from already-stored assets after a parser upgrade
- **Metadata refreshed** — tracks where only metadata changed

---

## Raw Asset Retention

ANLZ files uploaded to Storage are retained indefinitely (until the import is deleted). This enables:

- **Parser reparsing**: when `DROPDEX_ANLZ_PARSER_VERSION` is bumped, retained assets can be re-parsed without re-upload.
- **Feature recovery**: if a feature (e.g. phrase analysis) failed originally but a bug was fixed, reparse restores it from the stored file.

### Shared blob deduplication (same-user)

When two imports by the same user contain identical ANLZ files (same SHA-256 and size), the backend stores only one Storage object (`rekordbox_analysis_blobs`) referenced by both imports (`rekordbox_analysis_asset_references`). This saves Storage space on repeated imports of the same USB.

**Cross-user deduplication is not implemented.** Each user's blobs are private to that user.

A blob is deleted from Storage only after its last reference is removed.

---

## Reparse Command

```bash
# Reparse all tracks in one import
python -m dropdex_importer reparse --import-id <uuid>

# Reparse one track
python -m dropdex_importer reparse --track-id <uuid>

# Reparse all tracks parsed before parser version 2.0.0
python -m dropdex_importer reparse --older-than-parser-version 1.0.0

# Dry run (describe what would happen, no writes)
python -m dropdex_importer reparse --dry-run --import-id <uuid>
```

Requirements:
- `SUPABASE_URL` and `SUPABASE_SECRET_KEY` must be set in the environment
- Existing valid data is preserved until replacement succeeds
- Failed reparse does not erase old normalized data
- Dry-run mode is always safe

---

## Feature-level Invalidation

The staged manifest marks each track with a `manifest_status`:

| Status | Meaning |
|---|---|
| `reused` | Analysis fully reused from prior import |
| `needs_dat` | DAT upload required (analysis changed or new) |
| `needs_ext` | Only EXT is needed |
| `needs_2ex` | Only 2EX is needed |
| `reparse_from_retained` | Re-parse from stored asset (no upload needed) |
| `metadata_only` | Only metadata changed; analysis data copied |
| `unavailable` | No prior data and no file provided |

This allows the client to skip unnecessary uploads. For example, when only cues changed, the waveform and beat grid files are not uploaded.

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/rekordbox/import` | Legacy database-only import |
| `POST` | `/api/rekordbox/import/start` | Start staged import, get manifest |
| `POST` | `/api/rekordbox/import/bundle` | ZIP bundle import |
| `POST` | `/api/rekordbox/import/{id}/analysis-batch` | Upload ANLZ batch |
| `POST` | `/api/rekordbox/import/{id}/complete` | Parse all uploaded ANLZ files |
| `GET` | `/api/rekordbox/import/{id}/analysis-status` | Poll analysis progress |
| `POST` | `/api/rekordbox/import/{id}/related-tracks` | Upload Related Tracks from bridge |

All endpoints require a valid Supabase Bearer token. `user_id` is derived from the JWT only — never from request body or URL parameters.

---

## Partial Import Troubleshooting

### Some tracks show `parse_status = failed`

- Check `analysis_parse_warnings` on the track row for specific error codes.
- Common codes: `SIBLING_MISSING` (no EXT alongside DAT), `PARSE_ERROR` (corrupt ANLZ), `TAG_UNSUPPORTED` (unknown tag in `.2EX`).
- If the DAT file is intact, EXT failures produce `partial` status.

### Beat grid is missing but waveform is present

- Beat grid requires PQTZ (DAT) or PQT2 (EXT). If both are absent, the grid is skipped.
- Waveforms have separate fallback paths (PWV4 → PWAV → PWV2).

### Related Tracks members show `unmatched_tracks: N`

- The `masterContentId` in the bridge payload did not match any `master_content_id` in `rekordbox_tracks`.
- This happens when Related Tracks reference content not present in the USB export. The lists are still imported; only those members are absent.

### Reparse command produces no output

- Ensure `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are set.
- Use `--verbose` for detailed logging.
- Use `--dry-run` first to confirm which tracks would be targeted.
