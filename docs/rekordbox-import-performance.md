# Rekordbox import fast path and background analysis

This document describes the productionized Rekordbox USB import pipeline introduced by the third performance patch. It supplements the USB worker-safety contract in `rekordbox-usb-import-safety.md`.

## Product readiness contract

DropDex treats library readiness and deep-analysis completion as separate milestones.

1. **Database import** reads `exportLibrary.db`, validates it, and bulk-writes tracks, playlists, playlist membership, and database cues.
2. **Library metadata ready** publishes the import as the active library. Track lists and detail pages may be used immediately.
3. **Required asset staging** reads only manifest-requested DAT and EXT files from the selected USB folder. Local USB references are released after the upload dispatcher and retries have stopped.
4. **Background analysis** parses affected tracks with bounded concurrency and writes normalized features in batches.
5. **Raw archival** runs on a separate trailing worker after analysis completes. Compression and Storage upload never block another track from becoming ready.
6. **Optional archival** may archive `.2EX` in a later job when explicitly enabled. It never participates in readiness or track success.

The readiness stages stored on `rekordbox_imports` are:

- `metadata_pending`
- `library_metadata_ready`
- `analysis_processing`
- `analysis_paused`
- `analysis_complete`
- `analysis_partial`

The frontend may background the blocking modal after metadata is ready, including while required DAT/EXT files are still transferring. The library remains browseable. Until USB release is verified, the background safety panel is non-dismissible, keeps a prominent keep-connected warning, links back to the local upload controls, and withholds cloud pause/delete actions that cannot safely stop browser-side reads. After release, it becomes dismissible and exposes track counts, measured throughput, pause/resume, deletion, verified USB release, and trailing raw archival state.

## Required and optional artifacts

### Blocking fast path

- DAT is required when a manifest entry requests new analysis.
- EXT is requested when present or when the manifest specifically reports `needs_ext`.
- `.2EX` is not uploaded or parsed by the initial fast path.

The current parser deliberately does not decode PWV6, PWV7, or PWVC into meaningful user-visible features. Therefore `.2EX` absence does not make a track incomplete and an existing `.2EX` row does not make an old import invalid.

### Optional `.2EX` archival

`ANALYSIS_ARCHIVE_2EX=false` is the default. When enabled for an explicit later archival upload:

- the manifest and batch API recognize `.2EX` as optional archival work
- the initial browser USB fast path still does not retain or upload `.2EX` handles
- a later client/API upload or an existing retained `.2EX` object can be archived without reopening analysis readiness
- track readiness does not wait for it
- parsing does not consume it
- missing or failed optional files do not change the track result
- already-uploaded legacy `.2EX` objects remain readable and count as durable archival

If the flag is enabled but optional files have not been supplied, the job reports archival as `queued`, not falsely `completed`.

ZIP bundle imports also omit `.2EX` parsing. The raw ZIP may physically contain `.2EX` bytes, but they are not extracted into the blocking parse path.

## Incremental manifest rules

The manifest is authoritative. The browser does not infer work from every sibling path.

| Manifest status | USB upload | Background parse |
| --- | --- | --- |
| `reused` | none | none |
| `metadata_only` | none | none |
| `needs_dat` | DAT and explicitly requested EXT | yes |
| `needs_ext` | EXT only | yes |
| `needs_analysis` | requested DAT/EXT | yes |
| `reparse_from_retained` | none | yes, from staging/archive/legacy storage |
| `unavailable` | none | skipped with reason |

Only affected track IDs are sent to completion and resume endpoints. A metadata-only change does not schedule the rest of the library.

Normalized rows reused from a prior import are copied by table and bounded batch instead of four reads and writes per track. Beat grids, waveform metadata, phrases, and cues retain independent reuse flags.

## Fingerprints

Track and source-asset decisions preserve stable provenance using appropriate combinations of:

- Rekordbox content identity and master identity
- normalized analysis path
- update counters from Rekordbox
- source file size
- source modification time when supplied and trustworthy
- stored SHA-256
- parser version
- feature schema version

The batch endpoint first compares stored size and modification time with a retained staged, archived, or legacy object. It avoids reading and hashing the browser upload when those values prove the asset unchanged. SHA-256 remains the fallback when metadata is insufficient.

## Durable staging and resume

New DAT/EXT bytes are atomically written beneath `ANALYSIS_STAGING_ROOT`. Database rows store opaque relative staging keys, never absolute server paths.

Production startup fails unless `DROPDEX_ANALYSIS_STAGING_ROOT` is explicitly configured and passes an fsync write probe. Mount this directory on durable storage shared at the same path by every API/worker instance. The `/tmp` fallback is development-only.

The flow is:

```text
browser File read
  -> bounded upload request
  -> atomic durable staging
  -> parser input preparation
  -> bounded CPU parser pool
  -> bounded result queue
  -> single bulk writer
  -> normalized features ready
  -> analysis worker completes and releases ownership
  -> separate raw-archive worker compresses/uploads staged bytes
```

Newly staged files are parsed directly. There is no required upload-to-Supabase-Storage followed by immediate download. Retained archives or legacy individual objects are restored during the controlled input-preparation stage, before parser workers start.

For `reparse_from_retained`, the restored DAT/EXT bytes are copied into the new import's durable staging area and checkpointed as new asset rows with `retained_from_asset_id` provenance. The new import can therefore resume independently and does not lose its parser source if an older import is later deleted.

Staging and archive metadata preserve parser-version reprocessing. Delete Import removes database children, cloud objects, and the durable staging subtree only after the Patch 2 worker-stop acknowledgement.

## Bounded parsing and writing

Defaults:

- `ANALYSIS_PARSER_WORKERS=4`
- `ANALYSIS_RESULT_QUEUE_SIZE=16`
- `ANALYSIS_WRITER_BATCH_SIZE=32`

The parser coordinator keeps at most the configured worker count of futures in flight. Results cross a bounded queue, which applies backpressure while the writer is busy. Parser failures are converted to per-track failures and do not terminate the import.

Parser workers perform local decoding and feature extraction. Cloud restoration occurs before the pool. One writer performs bounded upserts for:

- beat grids
- waveform metadata
- cues after one bounded preload query
- phrase rows
- source asset parse state
- track analysis state
- progress checkpoints

Detailed waveform payloads remain individual compressed storage objects because the existing waveform loader addresses them by track. Raw Rekordbox source assets are archived in bounded groups by a separate trailing worker rather than as thousands of individual objects. Archive uploads stream from disk and do not call `Path.read_bytes()`.

Pause and delete use the local worker signal for hot-path checks. Database heartbeats and persisted progress are updated at queueing and writer checkpoints rather than before and after every small parser operation.

## Progressive feature behavior

Track rows expose one of:

- Metadata ready
- Analysis queued
- Analysis running
- Analysis partial
- Analysis complete
- Analysis failed
- Analysis reused
- Source file missing

Library queries allow an owned import with `library_ready_at` even while its job status is still processing. Missing waveform or phrase rows are treated as temporary states. Existing waveform queries can refetch as each writer batch lands, without a full-page reload.

The background panel reports file and track counts separately. Examples:

- `Uploading 3,704 required analysis files for 1,852 tracks`
- `Processing track 412 of 1,852`
- `1,700 tracks reused, 152 tracks updated`
- `Raw DAT/EXT archive running`
- `Operator-enabled .2EX archival skipped`

An ETA is shown only after measured throughput exists. The UI does not invent a completion time from an empty sample.

## Metrics

`performance_metrics` stores structured `timings_ms`, `counts`, and `bytes` maps. Numeric values accumulate across upload and writer batches, so later checkpoints neither erase nor hide earlier work.

Instrumented stages include:

- database import and database bytes
- manifest generation
- USB file matching measured in the browser and submitted as aggregate-only telemetry
- file transfer across all upload batches and staged bytes
- temporary staging or retained-object restoration
- asset parsing
- feature writing
- trailing raw archival
- time to library ready
- total time to full analysis

Counts include selected tracks, staged/reused assets, upload batches, feature-write batches, track-map builds, processed tracks, and archived raw assets. Logs avoid track titles and paths except where an explicit per-track failure must be diagnosed.

## Operation-count tests

Synthetic tests cover:

- 100-track initial import
- 2,000-track initial work plan
- 2,000-track no-change repeat import
- 2,000-track repeat import with 5 percent changed

Assertions focus on architecture rather than unstable wall-clock numbers:

- no-change repeat work plans contain zero required uploads
- 5 percent change selects only 100 of 2,000 tracks
- `.2EX` contributes only to optional archival counts
- writer calls scale with `ceil(changed_tracks / writer_batch_size)`
- path-map construction is cached once per import across upload batches
- staged assets resolve locally without a storage download
- malformed parser input is isolated to one track

No real-world performance result is claimed by this patch. The available development environment does not include a representative USB, production Supabase latency, or deployment volume. Product targets remain benchmark goals:

- metadata visible near 60 seconds for roughly 2,000 tracks
- initial DAT/EXT work trending below 5 to 10 minutes
- no-change repeat import trending below 1 minute
- small-change repeat import trending below 2 minutes

## Deployment and tuning

Environment variables:

```text
ANALYSIS_PARSER_WORKERS=4
ANALYSIS_WRITER_BATCH_SIZE=32
ANALYSIS_RESULT_QUEUE_SIZE=16
DROPDEX_ANALYSIS_STAGING_ROOT=/var/lib/dropdex/analysis-staging
ANALYSIS_WORKER_LEASE_SECONDS=45
ANALYSIS_WORKER_LEASE_REFRESH_SECONDS=1.0
ANALYSIS_ARCHIVE_RAW_ASSETS=true
ANALYSIS_ARCHIVE_2EX=false
ANALYSIS_FEATURE_SCHEMA_VERSION=2026.07.fast-path.v1
```

Operational guidance:

- Keep parser workers conservative on small instances. Increase only after measuring CPU, memory, and database write latency.
- Make `DROPDEX_ANALYSIS_STAGING_ROOT` durable, writable, and shared by every process that may own a lease.
- Apply the worker-lease migration before running more than one Uvicorn worker or container. The database lease prevents duplicate ownership and makes remote Pause/Delete visible at checkpoints.
- Ensure enough free space for the largest active import plus one compressed archive group.
- Monitor staging cleanup after completed and deleted jobs.
- Keep writer batches small enough for PostgREST payload limits.
- Do not enable `.2EX` archival until a separate capacity plan exists.

## Migration notes

Migration `20260725010000_rekordbox_import_fast_path.sql`:

- adds progressive readiness and performance fields
- adds track manifest, fingerprint, schema, failure, and timestamp fields
- allows analysis assets to be staged or archive-backed without an individual storage path
- adds archive provenance fields and status constraints
- adds direct `(import_id, relative_path)` uniqueness for bulk PostgREST upserts while retaining the older case-insensitive uniqueness rule
- adds bounded bulk track-state and nested metric-merge RPCs using invoker security
- expands legacy status constraints without deleting old DAT, EXT, or `.2EX` rows


Migration `20260725020000_rekordbox_import_remaining_safety.sql`:

- adds atomic database-backed ownership leases for analysis and raw-archive workers
- prevents multi-process startup recovery or Delete Import from racing a valid remote worker
- adds independent `raw_archival_status` that never gates library readiness
- adds the truthful `analysis_processing` readiness stage

Apply migrations in timestamp order before deploying the backend. Existing imports remain readable. The migration does not delete or rewrite raw objects.

## Known limitations

- PWV6, PWV7, and PWVC are still not decoded.
- Browser folder selection initially enumerates the folder supplied by the operating system, but React state retains only DAT/EXT file handles after scanning.
- ZIP bundle import still transfers the caller-provided ZIP as one object. `.2EX` inside that ZIP is ignored by parsing, but removing it from network transfer requires a bundle-packaging change outside this patch.
- Detailed waveform blobs remain per-track storage objects.
- Worker execution still uses in-process threads, but ownership and stop intent are database-backed. Every process must see the same durable staging mount. A dedicated external queue remains a future operational upgrade, not a safety prerequisite after the lease migration.
- `.2EX` archival has no normal end-user upload control. It remains operator-enabled plumbing and is hidden when skipped.
