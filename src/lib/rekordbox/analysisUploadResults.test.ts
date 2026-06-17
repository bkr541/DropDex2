import { describe, it, expect } from 'vitest';
import { UploadAccumulator } from './analysisUploadResults';
import type { BatchUploadResponse } from '../api/rekordboxImport';
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

  it('counts rejected DAT files as completion-blocking', () => {
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
    expect(acc.summary.completionBlocked).toBe(true);
    expect(acc.summary.blockReason).toMatch(/DAT/i);
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

  it('recordFailedBatch marks as blocked and counts bytes', () => {
    const acc = new UploadAccumulator();
    const batch = [makeMatchedFile(1000, 'PIONEER/USBANLZ/P001/ANLZ0000.DAT')];
    acc.recordFailedBatch(batch);
    expect(acc.summary.failedBatchCount).toBe(1);
    expect(acc.summary.completionBlocked).toBe(true);
    expect(acc.summary.blockReason).toMatch(/batch/i);
    expect(acc.summary.attemptedFiles).toBe(1);
    expect(acc.summary.attemptedBytes).toBe(1000);
  });

  it('failed batch reason takes priority over rejected DAT in blockReason', () => {
    const acc = new UploadAccumulator();
    // First add a rejected DAT
    acc.addBatchResponse(
      makeResp({
        rejected_count: 1,
        files: [{ canonical_path: 'A.DAT', status: 'rejected', sha256: null, file_size: 100, reject_reason: null }],
      }),
      [makeMatchedFile(100, 'A.DAT')],
    );
    // Then a failed batch
    acc.recordFailedBatch([makeMatchedFile(100, 'B.DAT')]);
    // Failed-batch reason should appear first since we check failedBatches > 0 first
    expect(acc.summary.blockReason).toMatch(/batch/i);
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

  it('error status files count as rejected, DAT errors block completion', () => {
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
    expect(acc.summary.completionBlocked).toBe(true);
  });
});
