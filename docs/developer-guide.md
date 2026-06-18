# DropDex Developer Guide

Technical reference for the Rekordbox import, waveform, USB playback, and audio player systems.

---

## Import lifecycle

A complete import runs as follows:

1. **User selects `exportLibrary.db`** from the USB drive via `<input type="file">` in `ImportLibraryModal`.
2. **Python importer** (`importer/import_export_library.py`) reads the SQLite database and writes all tracks, playlists, cues, and recommendation edges to Supabase via the service-role key. The import row in `rekordbox_imports` is created first (status `processing`) and updated last (status `completed` or `failed`).
3. **ANLZ manifest upload** — the frontend scans the USB for ANLZ analysis files matching the manifest returned by `/api/rekordbox/import/complete`. Files are uploaded in batches of 10 (`WAVEFORM_CHUNK_SIZE`) via the `/upload` API route, with request-level exponential back-off (3 attempts, base 1 s).
4. **`/complete` call** — always called after all uploads are attempted, regardless of partial failure. The backend Python importer receives the uploaded files, parses them, and writes analysis data (waveforms, beat grids, cues, phrases) to the database.

### File-level retries

The `UploadAccumulator` in `analysisUploadResults.ts` tracks per-file success. The `successfullyUploadedPaths` getter exposes the set of paths that succeeded; the `ResumeAnalysisModal` uses `manifestReconciliation.ts` to exclude those from the retry list.

### Partial completion

If some ANLZ files are missing or fail to upload, the import row is marked `analysis_status = 'partial'`. The `AnalysisBanner` in `LibraryView` shows a warning with a "Resume Analysis" button.

### Resume Analysis

1. User clicks "Resume Analysis" from the library banner.
2. `ResumeAnalysisModal` calls `/api/rekordbox/import/complete?importId=…` to get the server-side manifest.
3. The frontend compares the manifest against locally found files, excluding those already successfully uploaded (`successfullyUploadedPaths`).
4. Only the unresolved delta is uploaded. If nothing is missing, the modal shows a "nothing to upload" state.

### Idempotent completion

`/complete` is idempotent:
- ANLZ Storage uploads use `upsert: true` — re-uploading a file replaces it safely.
- Analysis rows in the database have `unique (track_id)` constraints on waveform, beat grid, and cue tables; the parser uses `ON CONFLICT DO UPDATE` where applicable.
- Duplicate re-imports create a new `rekordbox_imports` row but leave existing analysis data untouched.

---

## Required vs optional ANLZ types

| Type | Extension | Required | Content |
|---|---|---|---|
| DAT | `.DAT` | **Yes** | Beat grid, cue points, monochrome PWAV waveform |
| EXT | `.EXT` | Optional | Color PWV4 waveform, extra hot cues |
| 2EX | `.2EX` | Optional | Color PWV4 for certain older Rekordbox versions |

When an EXT or 2EX file is present, its color waveform (`PWV4`) is used in preference to the DAT monochrome waveform (`PWAV`). A missing EXT is not an error.

### Preview format priority

```
PWV4 (color, EXT/2EX) > PWAV (mono, DAT) > PWV2 (mono fallback)
```

The `waveform_parser.py` implements this priority in `select_best_waveform_bundle()`.

---

## Waveform rendering

### Formats

| Format | Height field | Color | Source |
|---|---|---|---|
| PWV4 | `h ∈ [0,127]` (d5 & 0x7F) | r,g,b from d3/d4/d5 | EXT / 2EX |
| PWAV | `h ∈ [0,31]` (bv & 0x1F) | Monochrome via intensity `i ∈ [0,7]` | DAT |
| PWV2 | Same as PWAV | Same | DAT fallback |

### Canvas rendering pipeline

1. `normalizeWaveform()` — convert raw columns to `NormalizedCol[]` once (memoized).
2. `buildDisplayBuckets()` — peak-preserving downsampling to display pixel width (memoized).
3. `drawWaveform()` — one `<canvas>` element, symmetric bars around vertical midline. Lower half at 65% of upper alpha for depth effect.
4. **Progress overlay** — NOT drawn in canvas. Two absolutely-positioned `<div>`s handle progress:
   - Left overlay: `background-color: var(--color-background); opacity: 0.65` — dims played region.
   - Playhead: `background-color: var(--color-foreground); opacity: 0.9; width: 1px`.

### Retina/DPR

`canvas.width = Math.round(cssWidth * devicePixelRatio)`. The context is scaled `ctx.scale(dpr, dpr)` so all coordinates remain in CSS logical pixels.

### Theme support

`useDocumentTheme()` watches `document.documentElement[data-theme]` via `MutationObserver`. On change, the canvas re-renders with the updated monochrome base color. Color (PWV4) waveforms are unaffected — their RGB values come from Rekordbox analysis data and are theme-independent.

### No-redraw during playback

The canvas `useEffect` explicitly excludes `activeProgress` from its dependency array. Only the CSS overlay divs update during playback — no waveform geometry is rebuilt per frame.

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

On page load, `UsbConnectionContext` reads the stored handle and calls `handle.queryPermission({ mode: 'read' })`. If the result is `'prompt'`, the status becomes `'permission-required'` and a user gesture is needed to call `requestPermission()`. If `'denied'`, status becomes `'unavailable'`.

On `window` focus, the same check re-runs to detect a USB drive that was unplugged and re-inserted.

### Unsupported browser

`isFileSystemAccessSupported()` checks `'showDirectoryPicker' in window`. If false, status is `'unsupported'` and the UI shows a persistent message directing the user to Chrome/Edge.

### Wrong folder selected

If the user picks a directory that does not contain `PIONEER/`, `Contents/`, or `Music/`, `checkRekordboxStructure()` returns a partial or empty `found` list. The `UsbConnectionButton` shows a structure warning badge in expanded mode.

### No full-drive scanning

`showDirectoryPicker` gives access only to the selected directory and its descendants. The app only traverses the path segments required to reach a specific track file. There is no directory enumeration during playback.

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
- `FileSystemDirectoryHandle` (opaque browser object — no audio data)
- USB volume display name (string)
- Connection metadata (timestamp)
- Non-audio diagnostic information (error messages)

---

## Object URL lifecycle

```
playTrack(track)
 → resetAudioElement(prev objectUrl)   // pause + removeAttribute("src") + load()
 → URL.revokeObjectURL(prevUrl)        // previous URL released
 → File resolved from USB handle (transient — never stored)
 → URL.createObjectURL(file)           // new in-memory URL
 → audio.src = objectUrl              // set on element
 → audio.play()

stop() / USB disconnect / provider unmount
 → audio.pause() + removeAttribute("src") + load()
 → URL.revokeObjectURL(currentUrl)     // released

Playback error after URL creation
 → URL.revokeObjectURL(failedUrl)      // released even on error
```

The object URL lives in browser memory only between `createObjectURL` and the next revoke call. It is never assigned to a persistent variable, written to storage, or sent over the network.

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

**Firefox and Safari do not support `showDirectoryPicker`.** The USB feature degrades gracefully: status becomes `'unsupported'` and the connect button shows a message directing the user to Chrome or Edge.

---

## Known limitations

1. **Firefox/Safari**: File System Access API is not supported. Audio playback from USB is unavailable. All other app features work normally.
2. **DRM audio**: Files protected by DRM (AAC with FairPlay, etc.) will fail with `MEDIA_ERR_SRC_NOT_SUPPORTED`. The error message prompts the user to re-export without DRM.
3. **Unsupported codecs**: Some AIFF, M4A, or FLAC files may not play depending on browser codec support. The error message suggests converting to MP3 or AAC in Rekordbox.
4. **Large libraries**: The waveform batch query is limited to 200 visible rows at a time. Libraries with thousands of tracks require scrolling or pagination to load all waveforms. This is intentional — it prevents N+1 database requests.
5. **USB re-plug after revocation**: If the operating system revokes the directory handle (USB unplugged, permissions reset), the user must re-authorise. This is a browser security constraint, not a DropDex limitation.
6. **Analysis file scanning**: The ANLZ manifest is built from the Rekordbox database manifest, not from a live filesystem scan. If ANLZ files exist on disk but are not referenced in the database, they are not uploaded.
