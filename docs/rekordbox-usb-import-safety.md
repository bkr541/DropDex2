# Rekordbox USB import safety

## When DropDex accesses the USB

DropDex accesses the selected Rekordbox USB only during the local browser phase:

1. The folder picker returns read-only browser `File` objects.
2. DropDex locates `exportLibrary.db` and the ANLZ files beneath `PIONEER/USBANLZ`.
3. The database is uploaded to obtain a manifest.
4. Only ANLZ files named by that manifest are uploaded in bounded batches.

The frontend does not request writable File System Access API handles and does not write, rename, delete, or modify files on the USB. Rekordbox should remain closed during this phase so it does not open the device library while DropDex still has active reads in flight. The drive should not be ejected until DropDex confirms release.

## When the USB is released

Before cloud parsing begins, DropDex performs one idempotent cleanup routine. It aborts the local controller, stops the upload scheduler, cancels retry timers, clears selected database and ANLZ `File` references, clears matched-file arrays, batch arrays, and path maps, resets file inputs, revokes import object URLs, and drops import-local directory handles.

DropDex reports **USB access released** only after a release handshake verifies all of the following:

- no upload request is active;
- no retry timer remains;
- no queued batch can start;
- no active local `AbortController` remains;
- no import-local database, ANLZ, matched-file, batch, or path-map `File` reference remains;
- no import-local object URL remains;
- no import-local directory handle remains.

Cloud parsing receives only the import ID and normalized numeric metadata. It does not receive or depend on browser `File` objects.

## What Cancel does during USB upload

Cancel closes both scheduling gates immediately: the local aborted flag and the `AbortSignal`. Queued batches become `cancelled-before-start`; they are not counted as completed. Active requests receive abort and are allowed to settle. Abort-aware retry delays are cancelled immediately, and no retry can begin after cancellation.

The UI separately reports:

1. stopping local USB reads;
2. USB access released;
3. stopping cloud processing.

The modal remains visible until local USB access has stopped. Closing the modal during local reads uses the same cancellation and cleanup sequence.

## What Cancel does during cloud parsing

Once **USB access released** is shown, Cancel affects only backend/cloud processing. The frontend immediately reports that local USB access was already released. Closing the modal at this stage may leave cloud parsing running in the background; it does not reacquire or access the USB.


## Resume Analysis

The Resume Analysis flow follows the same read-only rules. Its upload dispatcher uses the same cancellation gates and retry timers, and it clears rescanned `File` objects, matched files, batches, and retry path maps before selective cloud reprocessing begins. Closing during a Resume Analysis upload requires confirmation and keeps the modal visible while active reads settle. The cloud reprocessing request receives only the import ID and affected track IDs.
