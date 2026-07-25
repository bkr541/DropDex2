export type UsbImportPhase =
  | 'idle'
  | 'scanning_usb'
  | 'database_selected'
  | 'uploading_usb_data'
  | 'stopping_usb_reads'
  | 'usb_released'
  | 'parsing_cloud_data'
  | 'cancelling_cloud_work'
  | 'cancelled'
  | 'completed'
  | 'partial_success'
  | 'failed';

export interface UsbReleaseSnapshot {
  activeUploadRequests: number;
  queuedBatches: number;
  retryTimerCount: number;
  controllerActive: boolean;
  databaseFileCount: number;
  analysisFileCount: number;
  matchedFileCount: number;
  batchFileCount: number;
  pathMapCount: number;
  objectUrlCount: number;
  directoryHandleCount: number;
}

export interface UsbReleaseVerification {
  released: boolean;
  blockers: string[];
}

export function verifyUsbReleased(snapshot: UsbReleaseSnapshot): UsbReleaseVerification {
  const blockers: string[] = [];
  if (snapshot.activeUploadRequests > 0) blockers.push('active upload requests remain');
  if (snapshot.queuedBatches > 0) blockers.push('queued upload batches remain');
  if (snapshot.retryTimerCount > 0) blockers.push('retry timers remain');
  if (snapshot.controllerActive) blockers.push('local AbortController is still active');
  if (snapshot.databaseFileCount > 0) blockers.push('database File references remain');
  if (snapshot.analysisFileCount > 0) blockers.push('analysis File references remain');
  if (snapshot.matchedFileCount > 0) blockers.push('matched File references remain');
  if (snapshot.batchFileCount > 0) blockers.push('batch File references remain');
  if (snapshot.pathMapCount > 0) blockers.push('File path map references remain');
  if (snapshot.objectUrlCount > 0) blockers.push('object URLs remain');
  if (snapshot.directoryHandleCount > 0) blockers.push('directory handles remain');
  return { released: blockers.length === 0, blockers };
}

/** Runs import-local cleanup once even when failure, close, cancel, and unmount race. */
export class IdempotentUsbCleanup {
  private completed = false;
  private _logicalRuns = 0;

  get logicalRuns(): number {
    return this._logicalRuns;
  }

  run(cleanup: () => void): boolean {
    if (this.completed) return false;
    this.completed = true;
    this._logicalRuns += 1;
    cleanup();
    return true;
  }
}

export interface CloudParsingContext {
  importId: string;
  expectedTrackCount: number;
}

/** Deliberately strips the File-bearing manifest before cloud parsing begins. */
export function createCloudParsingContext(
  importId: string,
  expectedTrackCount: number,
): CloudParsingContext {
  return {
    importId,
    expectedTrackCount: Math.max(0, expectedTrackCount),
  };
}
