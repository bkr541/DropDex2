import { describe, it, expect } from 'vitest';
import { UploadAccumulator, isTransientFileFailure } from './analysisUploadResults';
import type { BatchUploadResponse, BatchFileResult } from '../api/rekordboxImport';
import type { MatchedAnalysisFile } from './analysisPaths';

function makeFile(size: number): File {
  return new File([new Uint8Array(size)], 'test.dat', { type: 'application/octet-stream' });
}

function makeMatchedFile(size: number, canonicalPath: string): MatchedAnalysisFile {
  return {
    file: makeFile(size),
    canonicalPath,
    originalBrowserPath: canonicalPath,
    assetType: canonicalPath.toUpperCase().endsWith('.DAT') ? 'DAT'
      : canonicalPath.toUpperCase().endsWith('.EXT') ? 'EXT' : '2EX',
    trackId: 'track-0001',
  };
}

function makeResp(overrides: Partial<BatchUploadResponse> = {}): BatchUploadResponse {
  return {
    import_id: 'imp-1',
    received_count: 0,
    already_received_count: 0,
    rejected_count: 0,
    error_count: 0,
    received_bytes: 0,
    files: [],
    ...overrides,
  };
}

function makeFr(overrides: Partial<BatchFileResult> & { canonical_path: string }): BatchFileResult {
  return {
    status: 'received',
    sha256: null,
    file_size: null,
    reject_reason: null,
    ...overrides,
  };
}

// ── isTransientFileFailure ────────────────────────────────────────────────────

describe('isTransientFileFailure', () => {
  it('returns false for received', () => {
    expect(isTransientFileFailure(makeFr({ canonical_path: 'A.DAT', status: 'received' }))).toBe(false);
  });

  it('returns false for already_received', () => {
    expect(isTransientFileFailure(makeFr({ canonical_path: 'A.DAT', status: 'already_received' }))).toBe(false);
  });

  it('returns true for error status regardless of reason', () => {
    expect(isTransientFileFailure(makeFr({ canonical_path: 'A.DAT', status: 'error', reject_reason: null }))).toBe(true);
    expect(isTransientFileFailure(makeFr({ canonical_path: 'A.DAT', status: 'error', reject_reason: 'storage_failure' }))).toBe(true);
    expect(isTransientFileFailure(makeFr({ canonical_path: 'A.DAT', status: 'error', reject_reason: 'path_mismatch' }))).toBe(true);
  });

  it('returns true for rejected with "Upload failed. Please try again." (the documented case)', () => {
    expect(isTransientFileFailure(makeFr({
      canonical_path: 'A.DAT',
      status: 'rejected',
      reject_reason: 'Upload failed. Please try again.',
    }))).toBe(true);
  });

  it('returns true for rejected with other transient patterns', () => {
    const transientReasons = [
      'storage failure occurred',
      'Request timeout',
      'temporary error, retry later',
      'upload failed',
    ];
    for (const r of transientReasons) {
      expect(isTransientFileFailure(makeFr({ canonical_path: 'A.DAT', status: 'rejected', reject_reason: r })))
        .toBe(true);
    }
  });

  it('returns false for rejected with permanent reasons', () => {
    const permanentReasons = [
      'path_mismatch',
      'invalid_extension',
      'path_traversal',
      'file_too_large',
      'invalid_path',
      'duplicate',
      'unauthorized',
      'wrong_import',
    ];
    for (const r of permanentReasons) {
      expect(isTransientFileFailure(makeFr({ canonical_path: 'A.DAT', status: 'rejected', reject_reason: r })))
        .toBe(false);
    }
  });

  it('returns false for rejected with null reject_reason (conservative)', () => {
    expect(isTransientFileFailure(makeFr({ canonical_path: 'A.DAT', status: 'rejected', reject_reason: null }))).toBe(false);
  });

  it('returns false for rejected with empty string reject_reason', () => {
    expect(isTransientFileFailure(makeFr({ canonical_path: 'A.DAT', status: 'rejected', reject_reason: '' }))).toBe(false);
  });

  it('returns true for failed status with transient reason', () => {
    expect(isTransientFileFailure(makeFr({
      canonical_path: 'A.DAT',
      status: 'failed',
      reject_reason: 'upload failed',
    }))).toBe(true);
  });

  it('returns false for unknown status', () => {
    expect(isTransientFileFailure(makeFr({ canonical_path: 'A.DAT', status: 'unknown_future_status' }))).toBe(false);
  });
});

// ── UploadAccumulator (existing tests) ───────────────────────────────────────

describe('UploadAccumulator', () => {
  it('starts empty with no blocking', () => {
    const acc = new UploadAccumulator();
    const s = acc.summary;
    expect(s.receivedFiles).toBe(0);
    expect(s.receivedBytes).toBe(0);
    expect(s.rejectedFiles).toBe(0);
    expect(s.rejectedDatFiles).toBe(0);
    expect(s.failedBatchCount).toBe(0);
    expect(s.completionBlocked).toBe(false);
    expect(s.blockReason).toBeNull();
    expect(acc.confirmedFiles).toBe(0);
    expect(acc.confirmedBytes).toBe(0);
  });

  it('accumulates received counts and bytes', () => {
    const acc = new UploadAccumulator();
    const batch = [
      makeMatchedFile(1000, 'PIONEER/USBANLZ/P001/ANLZ0000.DAT'),
      makeMatchedFile(2000, 'PIONEER/USBANLZ/P001/ANLZ0000.EXT'),
    ];
    acc.addBatchResponse(
      makeResp({ received_count: 2, received_bytes: 3000, files: [] }),
      batch,
    );
    expect(acc.summary.receivedFiles).toBe(2);
    expect(acc.summary.receivedBytes).toBe(3000);
    expect(acc.summary.attemptedFiles).toBe(2);
    expect(acc.summary.attemptedBytes).toBe(3000);
    expect(acc.confirmedFiles).toBe(2);
    expect(acc.confirmedBytes).toBe(3000);
  });

  it('accumulates already_received and computes their bytes from files array', () => {
    const acc = new UploadAccumulator();
    const batch = [makeMatchedFile(500, 'PIONEER/USBANLZ/P001/ANLZ0000.DAT')];
    acc.addBatchResponse(
      makeResp({
        already_received_count: 1,
        files: [
          { canonical_path: 'PIONEER/USBANLZ/P001/ANLZ0000.DAT', status: 'already_received', sha256: 'abc', file_size: 500, reject_reason: null },
        ],
      }),
      batch,
    );
    expect(acc.summary.alreadyReceivedFiles).toBe(1);
    expect(acc.summary.alreadyReceivedBytes).toBe(500);
    expect(acc.confirmedFiles).toBe(1);
    expect(acc.confirmedBytes).toBe(500);
  });

  it('tracks rejected DAT files in rejectedDatFiles counter; does not block completion', () => {
    const acc = new UploadAccumulator();
    const batch = [
      makeMatchedFile(100, 'PIONEER/USBANLZ/P001/ANLZ0000.DAT'),
      makeMatchedFile(200, 'PIONEER/USBANLZ/P001/ANLZ0000.EXT'),
    ];
    acc.addBatchResponse(
      makeResp({
        rejected_count: 2,
        files: [
          { canonical_path: 'PIONEER/USBANLZ/P001/ANLZ0000.DAT', status: 'rejected', sha256: null, file_size: 100, reject_reason: 'path_mismatch' },
          { canonical_path: 'PIONEER/USBANLZ/P001/ANLZ0000.EXT', status: 'rejected', sha256: null, file_size: 200, reject_reason: 'path_mismatch' },
        ],
      }),
      batch,
    );
    expect(acc.summary.rejectedFiles).toBe(2);
    expect(acc.summary.rejectedDatFiles).toBe(1);
    // Upload failures never block completion — the backend handles missing DATs gracefully.
    expect(acc.summary.completionBlocked).toBe(false);
    expect(acc.summary.blockReason).toBeNull();
  });

  it('rejected EXT/2EX files do not block completion', () => {
    const acc = new UploadAccumulator();
    const batch = [makeMatchedFile(200, 'PIONEER/USBANLZ/P001/ANLZ0000.EXT')];
    acc.addBatchResponse(
      makeResp({
        rejected_count: 1,
        files: [
          { canonical_path: 'PIONEER/USBANLZ/P001/ANLZ0000.EXT', status: 'rejected', sha256: null, file_size: 200, reject_reason: 'path_mismatch' },
        ],
      }),
      batch,
    );
    expect(acc.summary.rejectedDatFiles).toBe(0);
    expect(acc.summary.completionBlocked).toBe(false);
  });

  it('recordFailedBatch increments failedBatchCount and tracks attempted bytes', () => {
    const acc = new UploadAccumulator();
    const batch = [makeMatchedFile(1000, 'PIONEER/USBANLZ/P001/ANLZ0000.DAT')];
    acc.recordFailedBatch(batch);
    expect(acc.summary.failedBatchCount).toBe(1);
    // Batch failures are informational; they never block /complete.
    expect(acc.summary.completionBlocked).toBe(false);
    expect(acc.summary.blockReason).toBeNull();
    expect(acc.summary.attemptedFiles).toBe(1);
    expect(acc.summary.attemptedBytes).toBe(1000);
  });

  it('blockReason is always null regardless of failure combination', () => {
    const acc = new UploadAccumulator();
    acc.addBatchResponse(
      makeResp({
        rejected_count: 1,
        files: [{ canonical_path: 'A.DAT', status: 'rejected', sha256: null, file_size: 100, reject_reason: null }],
      }),
      [makeMatchedFile(100, 'A.DAT')],
    );
    acc.recordFailedBatch([makeMatchedFile(100, 'B.DAT')]);
    expect(acc.summary.blockReason).toBeNull();
    expect(acc.summary.completionBlocked).toBe(false);
  });

  it('accumulates correctly across many small batches', () => {
    const acc = new UploadAccumulator();
    const BATCHES = 133;
    const FILES_PER_BATCH = 50;
    const FILE_SIZE = 1024;

    for (let i = 0; i < BATCHES; i++) {
      const batch = Array.from({ length: FILES_PER_BATCH }, (_, j) =>
        makeMatchedFile(FILE_SIZE, `PIONEER/USBANLZ/P${String(i).padStart(3, '0')}/ANLZ${String(j).padStart(4, '0')}.DAT`),
      );
      acc.addBatchResponse(
        makeResp({ received_count: FILES_PER_BATCH, received_bytes: FILES_PER_BATCH * FILE_SIZE }),
        batch,
      );
    }
    expect(acc.summary.receivedFiles).toBe(BATCHES * FILES_PER_BATCH);
    expect(acc.summary.receivedBytes).toBe(BATCHES * FILES_PER_BATCH * FILE_SIZE);
    expect(acc.summary.completionBlocked).toBe(false);
  });

  it('error status DAT files increment errorFiles and rejectedDatFiles; completion not blocked', () => {
    const acc = new UploadAccumulator();
    const batch = [makeMatchedFile(100, 'PIONEER/USBANLZ/P001/ANLZ0000.DAT')];
    acc.addBatchResponse(
      makeResp({
        error_count: 1,
        files: [
          { canonical_path: 'PIONEER/USBANLZ/P001/ANLZ0000.DAT', status: 'error', sha256: null, file_size: null, reject_reason: 'storage_failure' },
        ],
      }),
      batch,
    );
    expect(acc.summary.errorFiles).toBe(1);
    expect(acc.summary.rejectedDatFiles).toBe(1);
    // Backend handles missing DATs gracefully; no front-end blocking.
    expect(acc.summary.completionBlocked).toBe(false);
  });
});

// ── UploadAccumulator file-level retry corrections ────────────────────────────

describe('UploadAccumulator.correctFileRetrySuccess', () => {
  it('transitions error → received and decrements rejectedDatFiles counter', () => {
    const acc = new UploadAccumulator();
    const batch = [makeMatchedFile(1000, 'PIONEER/USBANLZ/P001/ANLZ0000.DAT')];
    acc.addBatchResponse(
      makeResp({
        error_count: 1,
        files: [makeFr({ canonical_path: 'PIONEER/USBANLZ/P001/ANLZ0000.DAT', status: 'error', reject_reason: 'storage_failure' })],
      }),
      batch,
    );

    expect(acc.summary.completionBlocked).toBe(false);
    expect(acc.summary.errorFiles).toBe(1);
    expect(acc.summary.rejectedDatFiles).toBe(1);
    expect(acc.summary.receivedFiles).toBe(0);

    acc.correctFileRetrySuccess('PIONEER/USBANLZ/P001/ANLZ0000.DAT', 'received', 1000);

    expect(acc.summary.errorFiles).toBe(0);
    expect(acc.summary.rejectedDatFiles).toBe(0);
    expect(acc.summary.receivedFiles).toBe(1);
    expect(acc.summary.receivedBytes).toBe(1000);
    expect(acc.summary.completionBlocked).toBe(false);
    expect(acc.confirmedFiles).toBe(1);
    expect(acc.confirmedBytes).toBe(1000);
  });

  it('transitions rejected → received (transient rejection) and decrements rejectedDatFiles', () => {
    const acc = new UploadAccumulator();
    const path = 'PIONEER/USBANLZ/P001/ANLZ0000.DAT';
    const batch = [makeMatchedFile(500, path)];
    acc.addBatchResponse(
      makeResp({
        rejected_count: 1,
        files: [makeFr({ canonical_path: path, status: 'rejected', reject_reason: 'Upload failed. Please try again.' })],
      }),
      batch,
    );

    expect(acc.summary.completionBlocked).toBe(false);
    expect(acc.summary.rejectedFiles).toBe(1);
    expect(acc.summary.rejectedDatFiles).toBe(1);

    acc.correctFileRetrySuccess(path, 'received', 500);

    expect(acc.summary.rejectedFiles).toBe(0);
    expect(acc.summary.rejectedDatFiles).toBe(0);
    expect(acc.summary.receivedFiles).toBe(1);
    expect(acc.summary.receivedBytes).toBe(500);
    expect(acc.summary.completionBlocked).toBe(false);
  });

  it('falls back to clientSize when serverFileSize is null', () => {
    const acc = new UploadAccumulator();
    const path = 'PIONEER/USBANLZ/P001/ANLZ0000.DAT';
    acc.addBatchResponse(
      makeResp({
        error_count: 1,
        files: [makeFr({ canonical_path: path, status: 'error', file_size: null })],
      }),
      [makeMatchedFile(4096, path)],
    );

    acc.correctFileRetrySuccess(path, 'received', null);

    expect(acc.summary.receivedBytes).toBe(4096); // falls back to clientSize
  });

  it('transitions error → already_received', () => {
    const acc = new UploadAccumulator();
    const path = 'PIONEER/USBANLZ/P001/ANLZ0000.EXT';
    acc.addBatchResponse(
      makeResp({
        error_count: 1,
        files: [makeFr({ canonical_path: path, status: 'error' })],
      }),
      [makeMatchedFile(200, path)],
    );

    acc.correctFileRetrySuccess(path, 'already_received', 200);

    expect(acc.summary.errorFiles).toBe(0);
    expect(acc.summary.alreadyReceivedFiles).toBe(1);
    expect(acc.summary.alreadyReceivedBytes).toBe(200);
    expect(acc.confirmedFiles).toBe(1);
  });

  it('is idempotent — calling twice for the same path is a no-op the second time', () => {
    const acc = new UploadAccumulator();
    const path = 'PIONEER/USBANLZ/P001/ANLZ0000.DAT';
    acc.addBatchResponse(
      makeResp({
        error_count: 1,
        files: [makeFr({ canonical_path: path, status: 'error' })],
      }),
      [makeMatchedFile(100, path)],
    );

    acc.correctFileRetrySuccess(path, 'received', 100);
    acc.correctFileRetrySuccess(path, 'received', 100); // second call — should be no-op

    expect(acc.summary.receivedFiles).toBe(1); // not 2
    expect(acc.summary.receivedBytes).toBe(100); // not 200
    expect(acc.summary.errorFiles).toBe(0); // not -1
    expect(acc.confirmedFiles).toBe(1);
  });

  it('is a no-op for an unknown path', () => {
    const acc = new UploadAccumulator();
    acc.correctFileRetrySuccess('UNKNOWN/PATH.DAT', 'received', 100);
    expect(acc.summary.receivedFiles).toBe(0); // no change
  });

  it('does not affect attempted/attempted-bytes counts (unique file tracking)', () => {
    const acc = new UploadAccumulator();
    const path = 'PIONEER/USBANLZ/P001/ANLZ0000.DAT';
    acc.addBatchResponse(
      makeResp({
        error_count: 1,
        files: [makeFr({ canonical_path: path, status: 'error' })],
      }),
      [makeMatchedFile(100, path)],
    );

    const beforeAttempted = acc.summary.attemptedFiles;
    acc.correctFileRetrySuccess(path, 'received', 100);

    expect(acc.summary.attemptedFiles).toBe(beforeAttempted); // unchanged — no double-count
  });

  it('a DAT-error retry success reduces rejectedDatFiles to zero', () => {
    const acc = new UploadAccumulator();
    const datPath = 'PIONEER/USBANLZ/P001/ANLZ0000.DAT';
    acc.addBatchResponse(
      makeResp({
        error_count: 1,
        files: [makeFr({ canonical_path: datPath, status: 'error', reject_reason: 'storage_failure' })],
      }),
      [makeMatchedFile(100, datPath)],
    );
    expect(acc.summary.rejectedDatFiles).toBe(1);
    expect(acc.summary.blockReason).toBeNull(); // always null now

    acc.correctFileRetrySuccess(datPath, 'received', 100);

    expect(acc.summary.rejectedDatFiles).toBe(0);
    expect(acc.summary.completionBlocked).toBe(false);
    expect(acc.summary.blockReason).toBeNull();
  });
});

// ── UploadAccumulator.retryableFilePaths ─────────────────────────────────────

describe('UploadAccumulator.retryableFilePaths', () => {
  it('returns empty when no files have been added', () => {
    expect(new UploadAccumulator().retryableFilePaths).toHaveLength(0);
  });

  it('returns paths of error files (always transient)', () => {
    const acc = new UploadAccumulator();
    const path = 'PIONEER/USBANLZ/P001/ANLZ0000.DAT';
    acc.addBatchResponse(
      makeResp({
        error_count: 1,
        files: [makeFr({ canonical_path: path, status: 'error', reject_reason: 'storage_failure' })],
      }),
      [makeMatchedFile(100, path)],
    );
    expect(acc.retryableFilePaths).toHaveLength(1);
    expect(acc.retryableFilePaths[0]).toBe(path.toLowerCase());
  });

  it('returns paths of transiently-rejected files', () => {
    const acc = new UploadAccumulator();
    const path = 'PIONEER/USBANLZ/P001/ANLZ0000.DAT';
    acc.addBatchResponse(
      makeResp({
        rejected_count: 1,
        files: [makeFr({ canonical_path: path, status: 'rejected', reject_reason: 'Upload failed. Please try again.' })],
      }),
      [makeMatchedFile(100, path)],
    );
    expect(acc.retryableFilePaths).toHaveLength(1);
  });

  it('excludes permanently-rejected files', () => {
    const acc = new UploadAccumulator();
    acc.addBatchResponse(
      makeResp({
        rejected_count: 1,
        files: [makeFr({ canonical_path: 'A.DAT', status: 'rejected', reject_reason: 'path_mismatch' })],
      }),
      [makeMatchedFile(100, 'A.DAT')],
    );
    expect(acc.retryableFilePaths).toHaveLength(0);
  });

  it('excludes received and already_received files', () => {
    const acc = new UploadAccumulator();
    acc.addBatchResponse(
      makeResp({
        received_count: 1,
        already_received_count: 1,
        files: [
          makeFr({ canonical_path: 'A.DAT', status: 'received', file_size: 100 }),
          makeFr({ canonical_path: 'B.EXT', status: 'already_received', file_size: 200 }),
        ],
      }),
      [makeMatchedFile(100, 'A.DAT'), makeMatchedFile(200, 'B.EXT')],
    );
    expect(acc.retryableFilePaths).toHaveLength(0);
  });

  it('removes a path from retryableFilePaths after a successful correction', () => {
    const acc = new UploadAccumulator();
    const path = 'PIONEER/USBANLZ/P001/ANLZ0000.DAT';
    acc.addBatchResponse(
      makeResp({
        error_count: 1,
        files: [makeFr({ canonical_path: path, status: 'error', reject_reason: 'storage_failure' })],
      }),
      [makeMatchedFile(100, path)],
    );

    expect(acc.retryableFilePaths).toHaveLength(1);

    acc.correctFileRetrySuccess(path, 'received', 100);

    expect(acc.retryableFilePaths).toHaveLength(0);
  });

  it('returns mixed DAT/EXT/2EX transient failures', () => {
    const acc = new UploadAccumulator();
    const files = [
      makeMatchedFile(100, 'PIONEER/USBANLZ/P001/ANLZ0000.DAT'),
      makeMatchedFile(200, 'PIONEER/USBANLZ/P001/ANLZ0000.EXT'),
      makeMatchedFile(300, 'PIONEER/USBANLZ/P001/ANLZ0000.2EX'),
    ];
    acc.addBatchResponse(
      makeResp({
        error_count: 3,
        files: [
          makeFr({ canonical_path: 'PIONEER/USBANLZ/P001/ANLZ0000.DAT', status: 'error', reject_reason: 'storage_failure' }),
          makeFr({ canonical_path: 'PIONEER/USBANLZ/P001/ANLZ0000.EXT', status: 'error', reject_reason: 'storage_failure' }),
          makeFr({ canonical_path: 'PIONEER/USBANLZ/P001/ANLZ0000.2EX', status: 'error', reject_reason: 'storage_failure' }),
        ],
      }),
      files,
    );
    expect(acc.retryableFilePaths).toHaveLength(3);
  });
});

// ── UploadAccumulator.successfullyUploadedPaths ───────────────────────────────

describe('UploadAccumulator.successfullyUploadedPaths', () => {
  it('returns empty when no files added', () => {
    expect(new UploadAccumulator().successfullyUploadedPaths.size).toBe(0);
  });

  it('includes received and already_received paths (lowercase)', () => {
    const acc = new UploadAccumulator();
    acc.addBatchResponse(
      makeResp({
        received_count: 1,
        already_received_count: 1,
        files: [
          makeFr({ canonical_path: 'PIONEER/USBANLZ/P001/ANLZ0000.DAT', status: 'received', file_size: 100 }),
          makeFr({ canonical_path: 'PIONEER/USBANLZ/P001/ANLZ0000.EXT', status: 'already_received', file_size: 200 }),
        ],
      }),
      [
        makeMatchedFile(100, 'PIONEER/USBANLZ/P001/ANLZ0000.DAT'),
        makeMatchedFile(200, 'PIONEER/USBANLZ/P001/ANLZ0000.EXT'),
      ],
    );
    const paths = acc.successfullyUploadedPaths;
    expect(paths.size).toBe(2);
    expect(paths.has('pioneer/usbanlz/p001/anlz0000.dat')).toBe(true);
    expect(paths.has('pioneer/usbanlz/p001/anlz0000.ext')).toBe(true);
  });

  it('excludes error and rejected paths', () => {
    const acc = new UploadAccumulator();
    acc.addBatchResponse(
      makeResp({
        error_count: 1,
        rejected_count: 1,
        files: [
          makeFr({ canonical_path: 'A.DAT', status: 'error', reject_reason: 'storage_failure' }),
          makeFr({ canonical_path: 'B.EXT', status: 'rejected', reject_reason: 'path_mismatch' }),
        ],
      }),
      [makeMatchedFile(100, 'A.DAT'), makeMatchedFile(200, 'B.EXT')],
    );
    expect(acc.successfullyUploadedPaths.size).toBe(0);
  });

  it('includes a path after correctFileRetrySuccess transitions it to received', () => {
    const acc = new UploadAccumulator();
    const path = 'PIONEER/USBANLZ/P001/ANLZ0000.DAT';
    acc.addBatchResponse(
      makeResp({
        error_count: 1,
        files: [makeFr({ canonical_path: path, status: 'error', reject_reason: 'storage_failure' })],
      }),
      [makeMatchedFile(100, path)],
    );
    expect(acc.successfullyUploadedPaths.size).toBe(0);

    acc.correctFileRetrySuccess(path, 'received', 100);

    expect(acc.successfullyUploadedPaths.size).toBe(1);
    expect(acc.successfullyUploadedPaths.has(path.toLowerCase())).toBe(true);
  });
});

// ── Duplicate response entry deduplication ────────────────────────────────────

describe('UploadAccumulator duplicate response entry handling', () => {
  it('does not double-count rejectedDatFiles when the same path appears twice in resp.files', () => {
    const acc = new UploadAccumulator();
    const path = 'PIONEER/USBANLZ/P001/ANLZ0000.DAT';
    acc.addBatchResponse(
      makeResp({
        error_count: 2, // server aggregate (bug upstream)
        files: [
          makeFr({ canonical_path: path, status: 'error', reject_reason: 'storage_failure' }),
          makeFr({ canonical_path: path, status: 'error', reject_reason: 'storage_failure' }), // duplicate
        ],
      }),
      [makeMatchedFile(100, path)],
    );

    expect(acc.summary.rejectedDatFiles).toBe(1); // counted only once
    expect(acc.retryableFilePaths).toHaveLength(1); // path appears once
  });

  it('does not double-count alreadyReceivedBytes for duplicate already_received entries', () => {
    const acc = new UploadAccumulator();
    const path = 'PIONEER/USBANLZ/P001/ANLZ0000.EXT';
    acc.addBatchResponse(
      makeResp({
        already_received_count: 2, // server aggregate
        files: [
          makeFr({ canonical_path: path, status: 'already_received', file_size: 500 }),
          makeFr({ canonical_path: path, status: 'already_received', file_size: 500 }), // duplicate
        ],
      }),
      [makeMatchedFile(500, path)],
    );

    expect(acc.summary.alreadyReceivedBytes).toBe(500); // counted once
  });
});

// ── Acceptance scenarios ──────────────────────────────────────────────────────

describe('Acceptance criteria scenarios', () => {
  it('HTTP 200 with all files successful — no blocking, no retryable paths', () => {
    const acc = new UploadAccumulator();
    const batch = [
      makeMatchedFile(100, 'PIONEER/USBANLZ/P001/ANLZ0000.DAT'),
      makeMatchedFile(200, 'PIONEER/USBANLZ/P001/ANLZ0000.EXT'),
    ];
    acc.addBatchResponse(
      makeResp({
        received_count: 2,
        received_bytes: 300,
        files: [
          makeFr({ canonical_path: 'PIONEER/USBANLZ/P001/ANLZ0000.DAT', status: 'received', file_size: 100 }),
          makeFr({ canonical_path: 'PIONEER/USBANLZ/P001/ANLZ0000.EXT', status: 'received', file_size: 200 }),
        ],
      }),
      batch,
    );
    expect(acc.summary.completionBlocked).toBe(false);
    expect(acc.retryableFilePaths).toHaveLength(0);
  });

  it('HTTP 200 with one failed DAT that succeeds on retry — rejectedDatFiles cleared', () => {
    const acc = new UploadAccumulator();
    const datPath = 'PIONEER/USBANLZ/P001/ANLZ0000.DAT';
    const extPath = 'PIONEER/USBANLZ/P001/ANLZ0000.EXT';

    // Initial upload: EXT received, DAT errored.
    acc.addBatchResponse(
      makeResp({
        received_count: 1,
        received_bytes: 200,
        error_count: 1,
        files: [
          makeFr({ canonical_path: extPath, status: 'received', file_size: 200 }),
          makeFr({ canonical_path: datPath, status: 'error', reject_reason: 'storage_failure' }),
        ],
      }),
      [makeMatchedFile(100, datPath), makeMatchedFile(200, extPath)],
    );

    // completionBlocked is never true — backend handles the missing DAT gracefully.
    expect(acc.summary.completionBlocked).toBe(false);
    expect(acc.summary.rejectedDatFiles).toBe(1);
    expect(acc.retryableFilePaths).toHaveLength(1);

    // Retry: DAT now received.
    acc.correctFileRetrySuccess(datPath, 'received', 100);

    expect(acc.summary.completionBlocked).toBe(false);
    expect(acc.summary.rejectedDatFiles).toBe(0);
    expect(acc.summary.receivedFiles).toBe(2); // EXT + DAT
    expect(acc.summary.errorFiles).toBe(0);
    expect(acc.retryableFilePaths).toHaveLength(0);
    expect(acc.summary.attemptedFiles).toBe(2); // unique, not 3 (2 + 1 retry)
  });

  it('HTTP 200 with one DAT that fails all retries — rejectedDatFiles persists but completion not blocked', () => {
    const acc = new UploadAccumulator();
    const datPath = 'PIONEER/USBANLZ/P001/ANLZ0000.DAT';
    acc.addBatchResponse(
      makeResp({
        error_count: 1,
        files: [makeFr({ canonical_path: datPath, status: 'error', reject_reason: 'storage_failure' })],
      }),
      [makeMatchedFile(100, datPath)],
    );

    // All retries exhausted — correctFileRetrySuccess is never called.
    // The frontend still calls /complete; the backend marks this track missing_required.
    expect(acc.summary.completionBlocked).toBe(false);
    expect(acc.summary.rejectedDatFiles).toBe(1);
    expect(acc.summary.errorFiles).toBe(1);
    expect(acc.retryableFilePaths).toHaveLength(1);
  });

  it('mixed DAT, EXT, and 2EX results with partial success', () => {
    const acc = new UploadAccumulator();
    const datPath = 'PIONEER/USBANLZ/P001/ANLZ0000.DAT';
    const extPath = 'PIONEER/USBANLZ/P001/ANLZ0000.EXT';
    const twoExPath = 'PIONEER/USBANLZ/P001/ANLZ0000.2EX';

    acc.addBatchResponse(
      makeResp({
        received_count: 1,
        received_bytes: 100,
        error_count: 1,
        rejected_count: 1,
        files: [
          makeFr({ canonical_path: datPath, status: 'received', file_size: 100 }),
          makeFr({ canonical_path: extPath, status: 'error', reject_reason: 'storage_failure' }),
          makeFr({ canonical_path: twoExPath, status: 'rejected', reject_reason: 'path_mismatch' }),
        ],
      }),
      [makeMatchedFile(100, datPath), makeMatchedFile(200, extPath), makeMatchedFile(300, twoExPath)],
    );

    // EXT error is retryable; 2EX path_mismatch is not; DAT is received.
    expect(acc.retryableFilePaths).toHaveLength(1);
    expect(acc.retryableFilePaths[0]).toBe(extPath.toLowerCase());
    // DAT received so no DAT block.
    expect(acc.summary.rejectedDatFiles).toBe(0);
    expect(acc.summary.completionBlocked).toBe(false);
  });

  it('unique received and failed counts are correct after a retry resolves one of two failures', () => {
    const acc = new UploadAccumulator();
    const dat1 = 'PIONEER/USBANLZ/P001/ANLZ0000.DAT';
    const dat2 = 'PIONEER/USBANLZ/P002/ANLZ0000.DAT';

    acc.addBatchResponse(
      makeResp({
        error_count: 2,
        files: [
          makeFr({ canonical_path: dat1, status: 'error', reject_reason: 'storage_failure' }),
          makeFr({ canonical_path: dat2, status: 'error', reject_reason: 'storage_failure' }),
        ],
      }),
      [makeMatchedFile(100, dat1), makeMatchedFile(100, dat2)],
    );

    expect(acc.summary.errorFiles).toBe(2);
    expect(acc.summary.rejectedDatFiles).toBe(2);

    // First DAT succeeds on retry; second does not.
    acc.correctFileRetrySuccess(dat1, 'received', 100);

    expect(acc.summary.errorFiles).toBe(1); // one still failing
    expect(acc.summary.rejectedDatFiles).toBe(1); // one DAT failure remains
    expect(acc.summary.receivedFiles).toBe(1); // one now received
    expect(acc.summary.completionBlocked).toBe(false); // never blocks — backend handles gracefully
    expect(acc.summary.attemptedFiles).toBe(2); // still 2 unique files
  });
});
