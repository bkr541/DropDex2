# DropDex Developer Guide

Technical reference for the Rekordbox import, waveform, USB playback, and audio player systems.

---

## Import lifecycle

A complete import runs as follows:

1. **User selects `exportLibrary.db`** from the USB drive via `<input type="file">` in `ImportLibraryModal`.
2. **Python importer** (`importer/import_export_library.py`) reads the SQLite database and writes all tracks, playlists, cues, and recommendation edges to Supabase via the service-role key. The import row in `rekordbox_imports` is created first (status `processing`) and updated last (status `completed` or `failed`).
3. **POST `/api/rekordbox/import/start`** — called after the database import completes. Returns a manifest of expected ANLZ file paths per track (`ImportStartResponse.manifest`).
4. **POST `/api/rekordbox/import/{id}/analysis-batch`** — the frontend scans the USB for ANLZ files matching the manifest, then uploads them in batches of up to **50 files or 50 MB**, whichever limit is reached first (`BATCH_SIZE = 50`, `MAX_BYTES_PER_BATCH = 50 MB`; see `ImportLibraryModal.tsx`). Each batch is retried up to 3 times with exponential back-off.
5. **POST `/api/rekordbox/import/{id}/complete`** — always called after all uploads are attempted, regardless of partial failure. The backend parses all uploaded ANLZ files and writes analysis data (waveforms, beat grids, cues, phrases) to the database. Accepts an optional JSON body `{ "affected_track_ids": [...] }` for selective reprocessing (see Resume Analysis).

> **`WAVEFORM_CHUNK_SIZE = 200`** is the maximum number of track IDs per Supabase waveform query in `analysisData.ts`. It is unrelated to upload batch sizing.

### Upload batch limits

| Constant | Value | Source |
|---|---|---|
| `BATCH_SIZE` | 50 files | `ImportLibraryModal.tsx`, `ResumeAnalysisModal.tsx` |
| `MAX_BYTES_PER_BATCH` | 50 MB | `ImportLibraryModal.tsx`, `ResumeAnalysisModal.tsx` |
| `WAVEFORM_CHUNK_SIZE` | 200 track IDs | `src/lib/queries/analysisData.ts` — **waveform queries only** |

### File-level retries

`UploadAccumulator` in `analysisUploadResults.ts` tracks per-file success and failure. Each batch is retried up to 3 times. Files reported as `already_received` by the backend are counted as success — re-uploading an already-stored file is safe.

### Partial completion

If required DAT files are missing or fail to upload, the import row is marked `analysis_status = 'partial'`. Optional EXT or 2EX absence never marks an import as partial. The `AnalysisBanner` in `LibraryView` shows a warning with a "Resume Analysis" button.

### Resume Analysis

1. User clicks "Resume Analysis" from the library banner.
2. `ResumeAnalysisModal` calls **GET `/api/rekordbox/import/{id}/analysis-status`** to get the current server-side unresolved target list.
3. The response includes structured `unresolved_targets` (per-track, with `track_id`, `asset_type`, `status`, and `reason`) and top-level summary counts (`missing_required_count`, `failed_upload_count`, `failed_parse_count`, `affected_track_count`). If the backend is older, the legacy `missing_required_paths` / `missing_optional_ext` / `missing_optional_2ex` flat arrays are used instead.
4. The frontend matches found USB files against unresolved targets (case-insensitive, per-segment URL-decoded paths).
5. Only unresolved files are uploaded via `analysis-batch`.
6. **POST `/api/rekordbox/import/{id}/complete`** is called with `{ "affected_track_ids": [...] }` so the backend reparses only the tracks that received new files, not the entire library.
7. If nothing is missing, `/complete` is called immediately with no body to allow the backend to retry any parse failures.

### Idempotent completion

`/complete` is idempotent:
- ANLZ Storage uploads use `upsert: true` — re-uploading a file replaces it safely.
- Analysis rows use `ON CONFLICT DO UPDATE` semantics on `unique (track_id)` constraints (waveform, beat grid, cue tables).
- When `affected_track_ids` is provided and non-empty, only those tracks are reparsed; all other completed tracks are left unchanged.

---

## Required vs optional ANLZ types

| Type | Extension | Required | Content |
|---|---|---|---|
| DAT | `.DAT` | **Yes** | Beat grid, cue points, PWAV and PWV2 monochrome preview waveforms |
| EXT | `.EXT` | Optional | PWV4 color preview, PWV5 color detail, PWV3 monochrome detail, extra hot cues |
| 2EX | `.2EX` | Optional | Uploaded and stored; **PWV6/PWV7/PWVC tags are not decoded** — see waveform section |

When an EXT file is present, its color waveform (PWV4) is preferred over the DAT monochrome waveform (PWAV). A missing EXT or 2EX is not treated as an error.

### Preview format priority

```
PWV4 (color, from EXT) → PWAV (monochrome, from DAT) → PWV2 (tiny mono, from DAT)
```

### Detail format priority

```
PWV5 (color, from EXT) → PWV3 (monochrome, from EXT)
```

Both priorities are implemented in `importer/dropdex_importer/waveform_parser.py`::`extract_waveforms()`.

**Not decoded:** PWV6, PWV7, and PWVC tags found in `.2EX` files are intentionally skipped. The 2EX file is uploaded and stored, but its waveform tags are not parsed in the current implementation.

---

## Waveform rendering

### Formats

| Format | Height field | Color | Source |
|---|---|---|---|
| PWV4 | `h ∈ [0,127]` (`d5 & 0x7F`) | r, g, b from `d3`/`d4`/`d5` | EXT |
| PWAV | `h ∈ [0,31]` (`bv & 0x1F`) | Monochrome via intensity `i ∈ [0,7]` | DAT |
| PWV2 | Same as PWAV | Monochrome | DAT (last resort) |
| PWV5 | Color detail columns | r, g, b per column | EXT |
| PWV3 | Monochrome detail | Monochrome | EXT |

### Canvas rendering pipeline

1. `normalizeWaveform()` — convert raw columns to `NormalizedCol[]` once (memoized).
2. `buildDisplayBuckets()` — peak-preserving downsampling to display pixel width (memoized).
3. `drawDropDexWaveform()` or `drawRekordboxWaveform()` — render one symmetric `<canvas>` waveform using the resolved theme appearance.
4. Playback progress controls played/unplayed alpha inside the renderer, and the playhead is drawn as a precise one-pixel canvas line.

### Retina/DPR

`canvas.width = Math.round(cssWidth * devicePixelRatio)`. The context is scaled `ctx.scale(dpr, dpr)` so all coordinates remain in CSS logical pixels.

### Theme support

`ThemeProvider` owns the validated `dark | light | cdj` theme state, persists it under `dropdex-theme`, and applies it to `document.documentElement[data-theme]`. The inline bootstrap script in `index.html` validates and applies the stored value before React loads, preventing a theme flash on authentication and startup screens.

The CDJ theme automatically selects the existing `rekordbox` waveform appearance unless a caller explicitly supplies `appearance`. Monochrome PWAV/PWV2 data renders in deck cyan, while PWV4 color data keeps the RGB values supplied by Rekordbox analysis. Dark and Light continue using the original DropDex waveform presentation.

### Playback redraws

Waveform geometry is normalized and bucketed with `useMemo`. Playback progress and the playhead are rendered in the canvas, so an active waveform performs a lightweight canvas redraw as progress changes without re-normalizing or re-bucketing the source data.

---

## USB directory handle storage

### What is stored in IndexedDB

`dropdex-usb-v1` / `usb-handles` / key `'primary'`:

```typescript
{
  handle: FileSystemDirectoryHandle,  // WICG File System Access API
  metadata: { volumeName: string; connectedAt: string }
}
```

**Nothing else.** No audio Blobs, ArrayBuffers, Base64, or track data are ever written to IndexedDB.

### Permission revalidation

On page load, `UsbConnectionContext` reads the stored handle and calls `handle.queryPermission({ mode: 'read' })`. If the result is `'prompt'`, the status becomes `'permission-required'` and a user gesture is needed to call `requestPermission()`. If the result is `'denied'`, status becomes `'unavailable'`.

On `window` focus, the same check re-runs. This handles the case where a USB drive was temporarily unplugged and reinserted while the app was in the background — the OS may re-grant permission without a new picker dialog.

**Physical unplug detection limitation:** The File System Access API does not provide a disconnect event. If a drive is physically unplugged while the browser tab is active, the app only discovers this when the next file access attempt throws a `SecurityError`, `AbortError`, or similar I/O exception. Until that happens, the status remains `'connected'`. The `checkRekordboxStructure()` call on focus change can detect a gone drive earlier.

### Reconnect vs Select USB Again

Two distinct recovery actions are exposed:

| Action | When used | Implementation |
|---|---|---|
| **Reconnect** (`reconnect()`) | Drive was physically unplugged and reinserted; same handle may still work | Re-verifies stored handle via `queryPermission` without opening a picker |
| **Select USB Again** (`selectNewUsb()`) | Wrong folder was selected; different drive needed | Opens `showDirectoryPicker` and replaces the stored handle |

`UsbConnectionButton` shows "Select USB Again" when `status === 'wrong_root'` or `status === 'unavailable'`.

### USB root check — discriminated result

`checkRekordboxStructure(handle)` returns a `UsbRootCheck` discriminated union:

```typescript
type UsbRootCheck =
  | { status: 'available';           foundFolders: string[]; missingFolders: string[] }
  | { status: 'permission_required' }
  | { status: 'unavailable';         errorCode: string; message: string }
  | { status: 'wrong_root';          foundFolders: string[]; missingFolders: string[] };
```

- `NotFoundError` → `foundFolders` / `missingFolders` (folder genuinely absent)
- `NotAllowedError` → `permission_required`
- `SecurityError` → `unavailable` (errorCode: `'security'`)
- Any other DOMException (e.g. `AbortError`) → `unavailable` (errorCode: the exception name)
- Non-DOMException → `unavailable` (errorCode: `'io_error'`)

Prior to this implementation, `AbortError` and `SecurityError` were incorrectly counted as missing folders, causing a physically unplugged drive to appear as `SET_CONNECTED` with a structure warning.

### Wrong folder selected

If the user picks a directory that does not contain any of `PIONEER/`, `Contents/`, or `Music/`, `checkRekordboxStructure()` returns `{ status: 'wrong_root', foundFolders: [], missingFolders: [...] }`. The context dispatches `SET_WRONG_ROOT`, which sets `status: 'wrong_root'` and shows a banner: "Select the USB root folder, not PIONEER or a subfolder."

### Unsupported browser

`isFileSystemAccessSupported()` checks `'showDirectoryPicker' in window`. If false, status is `'unsupported'` and the UI shows a persistent message directing the user to Chrome or Edge.

Full filesystem integration (USB playback) requires a Chromium-based desktop browser (Chrome 86+ or Edge 86+). Firefox and Safari do not support `showDirectoryPicker`.

### No full-drive scanning

`showDirectoryPicker` gives access only to the selected directory and its descendants. The app only traverses the path segments required to reach a specific track file. There is no directory enumeration during playback, except for the case-insensitive fallback which enumerates one directory level at a time only when an exact-name lookup fails.

### Path normalization

`resolveUsbPath()` in `src/lib/rekordbox/usbPathResolver.ts` normalizes raw Rekordbox file paths to USB-relative segment arrays. It handles:

- Windows drive letter paths (`E:\Contents\...`)
- macOS `/Volumes/{name}/` prefix (records `strippedVolume` for optional mismatch detection)
- `file://` URLs with per-segment `decodeURIComponent` (NOT whole-path decode, to prevent `%2F` separator injection)
- Traversal rejection: both literal `..`/`.` and encoded equivalents (`%2E%2E`) are rejected with `status: 'unsafe_path'`
- Invalid %-sequences return `status: 'invalid_encoding'` with the `badSegment` field populated

Status codes: `'ok'`, `'empty_path'`, `'unsafe_path'`, `'no_filename'`, `'unsupported_scheme'`, `'invalid_encoding'`, `'volume_mismatch'`.

`resolveUsbFile()` in `src/lib/usb/resolveUsbFile.ts` performs case-insensitive fallback traversal when an exact directory or file name lookup fails. If exactly one case-insensitive match exists, it is used. If two or more entries match the same lowercased segment, an `ambiguous_case_match` error is returned.

---

## Audio privacy model

**DropDex must not persist:**
- Audio Blobs
- Audio ArrayBuffers
- Base64-encoded audio
- Audio data in Supabase Storage
- Audio data in IndexedDB
- Copies of track files

**DropDex may persist:**
- `FileSystemDirectoryHandle` (opaque browser object — no audio data content)
- USB volume display name (string)
- Connection metadata (timestamp)
- Non-audio diagnostic information (error messages, file paths)

---

## Object URL lifecycle

```
playTrack(track)
 → safeResetAudio(prev objectUrl)      // pause + removeAttribute("src") + load()
 → URL.revokeObjectURL(prevUrl)        // previous URL released
 → resolveUsbFile(handle, segments)    // transient File — never stored
 → URL.createObjectURL(file)           // new in-memory URL
 → audio.src = objectUrl              // set on element
 → audio.play()

stop() / USB disconnect / context unmount
 → audio.pause() + removeAttribute("src") + load()
 → URL.revokeObjectURL(currentUrl)     // released

Playback error after URL creation
 → URL.revokeObjectURL(failedUrl)      // released even on error

Rapid track switch (generation counter)
 → Each playTrack() call increments playRequestIdRef
 → After every await, the current generation is checked
 → If a newer request has started, the stale request aborts without setting src
```

The object URL lives in browser memory only between `createObjectURL` and the next revoke call. It is never assigned to a persistent variable, written to storage, or sent over the network.

---

## Cue persistence

Cue points are read from DAT/EXT ANLZ tags by `waveform_parser.py` and written to `rekordbox_cues` via `analysis_feature_writer.py`:

- First import: plain `INSERT` for cues not yet in the database.
- Re-import / resume: the writer checks for existing cue rows by `(track_id, cue_type, position_ms)`. New cues are inserted; existing cues with the same key are updated via `ON CONFLICT DO UPDATE`.

> Plain `INSERT` is NOT the behavior for all cues. Cue rows that already exist (same `track_id` + `cue_type` + `position_ms`) are upserted via conflict resolution.

---

## Supported browser expectations

| Feature | Minimum requirement |
|---|---|
| File System Access API | Chrome 86+, Edge 86+ |
| `showDirectoryPicker` | Chrome 86+, Edge 86+ |
| `FileSystemHandle.queryPermission` | Chrome 86+, Edge 86+ |
| `HTMLAudioElement` | All modern browsers |
| `URL.createObjectURL` | All modern browsers |
| IndexedDB | All modern browsers |
| `ResizeObserver` | Chrome 64+, Firefox 69+, Safari 13.1+ |

Firefox and Safari do not support `showDirectoryPicker`. The USB feature degrades gracefully: status becomes `'unsupported'` and the connect button shows a message directing the user to Chrome or Edge. All library, discovery, and playlist features remain available without USB.

---

## Testing

### Unit tests (Vitest)

```bash
npm test           # run once
npm run test:watch # watch mode
```

Tests live in `src/**/*.test.ts`. No Supabase environment variables are required — pure utility functions (path resolution, waveform parsing, track mapping) are isolated in dependency-free modules:

- `src/lib/rekordbox/trackMappers.ts` — `trackStatRowToTrack`, `TrackStatRow` (no Supabase import)
- `src/lib/rekordbox/usbPathResolver.ts` — `resolveUsbPath` (no browser APIs)
- `src/lib/usb/resolveUsbFile.ts` — `resolveUsbFile`, `checkRekordboxStructure` (FileSystem handles are mocked)

Supabase-dependent query modules (`src/lib/queries/*.ts`) are never imported in pure-utility test files.

### E2E tests (Playwright)

```bash
npm run test:e2e          # run headless
npm run test:e2e:ui       # interactive mode
npm run test:e2e:report   # open last report
```

Tests live in `e2e/tests/`. They use:
- `page.route()` to intercept all Supabase REST and auth API calls
- `page.addInitScript()` to inject a fake session into localStorage, mock `showDirectoryPicker`, and stub `HTMLMediaElement.play`
- Fake `.env.e2e` credentials (valid format, never reach production)

No physical USB, no real audio, and no production Supabase credentials are required for E2E tests.

### Backend tests

```bash
cd backend
pytest
```

Backend tests require a live Supabase project or a local Supabase stack. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `backend/.env` before running.

---

## Known limitations

1. **Firefox/Safari**: The File System Access API (`showDirectoryPicker`) is not supported. USB playback is unavailable. All library, discovery, and playlist features work normally.
2. **Unsupported or corrupt audio**: Files with unsupported codecs, truncated data, or native DRM protection may fail browser playback with a media error. The error message describes the failure without assuming a specific cause.
3. **Physical unplug detection**: The browser does not fire a disconnect event. The app detects a missing drive on the next file access attempt or on window focus via `checkRekordboxStructure()`. There is an inherent delay between physical unplug and status update.
4. **Large libraries**: The waveform batch query fetches up to 200 track IDs per request. Libraries with thousands of tracks trigger multiple requests as rows scroll into view. This is intentional — it prevents one massive query.
5. **2EX waveform decoding**: `.2EX` files are uploaded and stored in Supabase Storage, but their PWV6/PWV7/PWVC waveform tags are not decoded. Only DAT and EXT waveform data is currently used for preview/detail rendering.
6. **Analysis file scanning**: The ANLZ manifest is built from the Rekordbox database, not from a live filesystem scan. ANLZ files that exist on disk but are not referenced in the manifest are not uploaded.
7. **Ambiguous case-insensitive paths**: If a directory contains two entries that differ only in case (e.g. `track.mp3` and `Track.mp3`) and the stored path matches both, an `ambiguous_case_match` error is returned rather than guessing.
