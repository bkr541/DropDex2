# Rekordbox USB and analysis-worker safety

DropDex treats local USB access and cloud analysis as two independent lifecycles. A green USB release acknowledgement proves that Electron and the browser have stopped reading the selected drive. A paused worker acknowledgement proves that the backend has stopped producing analysis writes. Neither acknowledgement implies the other.

## Safety states shown to users

During a USB-folder import, the UI reports these gates separately:

1. **Stopping local USB reads**
2. **USB access released**
3. **Stopping cloud analysis** or **Stopping worker before delete**

Rekordbox must remain closed only while local USB activity is non-zero. Once **USB access released** is shown, DropDex is operating from uploaded cloud assets and the user may open Rekordbox or eject the drive even if cloud analysis is still stopping.

## Browser-side USB release

The browser import path is read-only. It receives `File` objects from the folder picker and never requests a writable handle. Before cloud parsing starts, one idempotent cleanup routine:

- aborts local upload requests;
- closes the upload scheduler so no undispatched batch can start;
- cancels retry timers;
- clears database, ANLZ, matched-file, batch, and retry-map references;
- resets file inputs and import-local directory handles;
- revokes import-owned object URLs.

The browser release handshake verifies that each resource count is zero before it reports release.

## Electron active-stream lifecycle

Every Electron `createReadStream` used by the `dropdex-media://` protocol is registered in the main-process `UsbStreamRegistry` before it is returned to Chromium. The registry tracks:

- active streams;
- active playback streams;
- protocol requests still resolving or opening a stream;
- release-in-progress and released flags;
- the last stream error.

Streams unregister on close, end, or error. Explicit destruction is also tracked. A throwing `destroy()` call is recorded as an error but is not treated as proof that the operating-system handle closed.

### Release and disconnect sequence

`releaseUsb` and `disconnectUsb` use the same bounded shutdown barrier:

1. Stop accepting new media-token and protocol requests.
2. Invalidate every media token.
3. Ask registered renderer playback owners to pause, clear their active source, revoke owned object URLs, and abort outstanding range fetches.
4. Destroy every registered stream independently.
5. Wait for active streams and pending requests to reach zero, up to the configured timeout.
6. Return a structured result with `allStreamsClosed`, `timedOut`, destroyed and remaining stream counts, pending requests, and the current activity snapshot.
7. For disconnect, clear the selected root and persisted connection state after the bounded wait.

One failing stream cannot prevent destruction of the others. The result remains unsuccessful until all handles and pending requests are gone.

### USB activity IPC

The preload bridge exposes:

- `getUsbActivityState()`
- `releaseUsb()`
- `disconnectUsb()`

The activity payload includes `connected`, `activeStreamCount`, `pendingRequestCount`, `activePlaybackCount`, `releasing`, `released`, and `lastError`. The renderer uses the structured release result, not a spinner timeout, as the proof that Electron USB activity reached zero.

### Path containment

USB media resolution remains rooted at the user-selected real path. Requests reject empty, dot, traversal, slash-containing, backslash-containing, and NUL-containing path segments. Each resolved path must remain inside the selected root both before and after `realpath`, which blocks normalization and symlink escapes. Media tokens store only previously validated contained paths.

## Pause Analysis versus Delete Import

### Pause Analysis

Pause is the default action during cloud parsing. It:

- records `pause_requested`;
- signals the active worker;
- stops scheduling a new track;
- stops the current track at the next safe checkpoint;
- waits for the worker's stopped acknowledgement;
- preserves uploaded assets, completed tracks, and progress;
- stores `paused` and allows resume after a reload.

A bounded API wait may return `stopping` if the current stage has not reached a checkpoint yet. That timeout never authorizes cleanup. The worker finalizes the durable paused state when it later acknowledges stop.

### Delete Import

Delete is a separate destructive action with stronger confirmation. It:

1. records the delete request;
2. signals the worker, with delete taking precedence over pause;
3. waits for a stopped acknowledgement;
4. transitions to `deleting` only after acknowledgement;
5. removes DropDex cloud assets and import child records idempotently;
6. stores `cancelled` after cleanup.

If the bounded wait expires, the API returns `stopping` and leaves all data intact. An in-process finalizer continues waiting, but it still cannot clean anything until the same worker has acknowledged that it stopped writing.

## Worker registry and durable state

The current implementation uses a thread-safe in-process registry behind a queue-neutral interface. It tracks the import ID, worker status, pause and delete signals, current track, current stage, heartbeat, error diagnostics, and stopped event. This contract can later be implemented by a durable external queue without changing the API semantics.

The durable import states are:

```text
created -> uploading -> queued -> processing/running
running -> pause_requested -> paused
running -> cancel_requested -> stopping -> deleting -> cancelled
paused/interrupted -> queued/processing -> running
running -> completed | failed | interrupted
```

Database constraints and the transition trigger reject invalid jumps. Terminal cancelled and failed jobs cannot be resurrected. A completed metadata snapshot may retain overall `completed` while its analysis sub-state is parsing, paused, or interrupted so the imported library remains visible.

## Safe checkpoints inside a track

The worker checks the stop signal:

- before loading retained asset metadata;
- before each track;
- before, during, and after asset downloads;
- before and after parsing;
- before and after beat-grid writes;
- before and after waveform writes;
- before and after cue writes;
- before and after phrase writes;
- before the final track-status write;
- after a track completes;
- before final import aggregation.

The final per-track status is written last. Therefore a track interrupted after one or more feature writes remains incomplete and is safely retried instead of being mistaken for finalized work.

## Cleanup and write-race prevention

Destructive cleanup requires both conditions:

- the in-process registry reports no active worker; and
- the stopped acknowledgement is present in memory or durable job state.

Child-table writes are rejected once the import reaches `deleting`, `cancelled`, or `failed`. They remain allowed during a cooperative stop request so the current atomic stage can finish before the next checkpoint. Cleanup is repeatable and storage removal tolerates already-removed objects.

## Resume behavior

Resume uses retained uploaded assets and does not require the USB when required files are already present. It selects only tracks whose final analysis status is absent or failed. Tracks marked `completed`, `partial`, `reused`, or `skipped` are not reprocessed unnecessarily. Progress uses the entire retained library, so completed work from before the pause remains counted.

When a track has partial feature rows but no final track-status write, resume re-runs that track. Feature writers use idempotent reconciliation or upsert behavior so a retry cannot create duplicate cue rows.

## App and backend restart recovery

On backend startup, jobs left in running, stopping, or pause-requested analysis states are converted to paused or interrupted resumable states. Their uploaded assets and parsed records are preserved. A restart never interprets stale work as permission to delete.

Electron reloads only the persisted selected root. Active streams cannot survive a process exit. The activity registry starts clean and validates the real root before serving new media requests.

## Control APIs

Backend endpoints:

- `POST /api/rekordbox/import/{id}/pause`
- `POST /api/rekordbox/import/{id}/resume`
- `DELETE /api/rekordbox/import/{id}`
- `GET /api/rekordbox/import/{id}/worker-state`
- `GET /api/rekordbox/import/{id}/analysis-status`

The legacy `POST .../cancel` route remains an alias for explicit destructive deletion. New UI paths use Pause Analysis or Delete Import directly.

## Performance fast path compatibility

Patch 3 preserves the worker-stop and USB-release contract while moving deep analysis behind metadata readiness. The browser retains only manifest-requested DAT/EXT `File` objects; optional `.2EX` handles are not kept in import state. Uploaded bytes are atomically staged on the backend and parsed after local USB requests, retry timers, and dispatch queues are drained.

The **USB access released** indicator therefore means the background worker is operating from durable staging, retained archives, or legacy cloud objects. Pause, resume, restart recovery, and Delete Import continue to use the Patch 2 local worker signal and stopped acknowledgement. See [Rekordbox import fast path and background analysis](rekordbox-import-performance.md) for staging, concurrency, batching, and readiness details.
