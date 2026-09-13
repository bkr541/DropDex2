import { describe, expect, it, vi } from 'vitest';
import type { BatchUploadResponse } from '../api/rekordboxImport';
import type { MatchedAnalysisFile } from './analysisPaths';
import { runTargetedAnalysisTransfer } from './targetedAnalysisTransfer';
import type { AnalysisFileRequest, UsbFileResolver } from './usbTargetedDiscovery';

function request(path: string, assetType: 'DAT' | 'EXT' = 'DAT', trackId = path): AnalysisFileRequest {
  return { canonicalPath: path, assetType, trackId };
}

function successResponse(batch: MatchedAnalysisFile[]): BatchUploadResponse {
  return {
    import_id: 'import-1',
    received_count: batch.length,
    already_received_count: 0,
    rejected_count: 0,
    error_count: 0,
    received_bytes: batch.reduce((sum, item) => sum + item.file.size, 0),
    files: batch.map((item) => ({
      canonical_path: item.canonicalPath,
      status: 'received',
      sha256: 'sha',
      file_size: item.file.size,
      reject_reason: null,
    })),
  };
}

function notFound(segments: string[]) {
  return {
    ok: false as const,
    error: {
      kind: 'not_found' as const,
      path: segments.join('/'),
      message: 'not found',
    },
  };
}

function baseOptions(
  resolver: UsbFileResolver,
  requests: AnalysisFileRequest[],
  uploadBatch: (batch: MatchedAnalysisFile[], maxAttempts: number) => Promise<BatchUploadResponse | null>,
) {
  return {
    resolver,
    requests,
    signal: new AbortController().signal,
    sourceRootName: 'TESTUSB',
    maxFilesPerBatch: 2,
    maxBytesPerBatch: 50 * 1024 * 1024,
    maxConcurrent: 1,
    resolveWindowSize: 2,
    uploadBatch,
    fileRetryDelaysMs: [] as number[],
  };
}

describe('runTargetedAnalysisTransfer production path', () => {
  it('resolves and uploads only the exact requested DAT and EXT paths', async () => {
    const files = new Map<string, File>([
      ['PIONEER/USBANLZ/P001/ANLZ0001.DAT', new File(['dat'], 'ANLZ0001.DAT')],
      ['PIONEER/USBANLZ/P001/ANLZ0001.EXT', new File(['ext'], 'ANLZ0001.EXT')],
    ]);
    const resolver: UsbFileResolver = vi.fn(async (segments) => {
      const path = segments.join('/');
      if (path.startsWith('Contents/') || path.startsWith('Music/')) {
        throw new Error('audio branch must not be touched');
      }
      const file = files.get(path);
      return file ? { ok: true, file } : notFound(segments);
    });
    const uploadBatch = vi.fn(async (batch: MatchedAnalysisFile[]) => successResponse(batch));

    const result = await runTargetedAnalysisTransfer(baseOptions(
      resolver,
      [
        request('PIONEER/USBANLZ/P001/ANLZ0001.DAT', 'DAT', 'track-1'),
        request('PIONEER/USBANLZ/P001/ANLZ0001.EXT', 'EXT', 'track-1'),
      ],
      uploadBatch,
    ));

    expect(resolver).toHaveBeenCalledTimes(2);
    expect(resolver).toHaveBeenNthCalledWith(
      1,
      ['PIONEER', 'USBANLZ', 'P001', 'ANLZ0001.DAT'],
      expect.any(Object),
    );
    expect(resolver).toHaveBeenNthCalledWith(
      2,
      ['PIONEER', 'USBANLZ', 'P001', 'ANLZ0001.EXT'],
      expect.any(Object),
    );
    expect(uploadBatch).toHaveBeenCalledTimes(1);
    expect(uploadBatch.mock.calls[0][0].map((item) => item.canonicalPath)).toEqual([
      'PIONEER/USBANLZ/P001/ANLZ0001.DAT',
      'PIONEER/USBANLZ/P001/ANLZ0001.EXT',
    ]);
    expect(result.matchedCount).toBe(2);
    expect(result.missingCount).toBe(0);
  });

  it('does not resolve unrelated DAT/EXT or audio files merely because they exist', async () => {
    const requestedPath = 'PIONEER/USBANLZ/P001/REQUESTED.DAT';
    const resolver: UsbFileResolver = vi.fn(async (segments) => {
      expect(segments.join('/')).toBe(requestedPath);
      return { ok: true, file: new File(['requested'], 'REQUESTED.DAT') };
    });
    const uploadBatch = vi.fn(async (batch: MatchedAnalysisFile[]) => successResponse(batch));

    await runTargetedAnalysisTransfer(baseOptions(
      resolver,
      [request(requestedPath)],
      uploadBatch,
    ));

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(uploadBatch).toHaveBeenCalledTimes(1);
  });

  it('keeps File objects bounded to the current resolution/upload window', async () => {
    const requests = Array.from({ length: 7 }, (_, index) => request(
      `PIONEER/USBANLZ/P${String(index + 1).padStart(3, '0')}/ANLZ0001.DAT`,
      'DAT',
      `track-${index + 1}`,
    ));
    const resolver: UsbFileResolver = vi.fn(async (segments) => ({
      ok: true,
      file: new File([segments.join('/')], segments.at(-1) ?? 'ANLZ.DAT'),
    }));
    const resolverCountsAtUpload: number[] = [];
    const uploadBatch = vi.fn(async (batch: MatchedAnalysisFile[]) => {
      resolverCountsAtUpload.push(vi.mocked(resolver).mock.calls.length);
      expect(batch.length).toBeLessThanOrEqual(2);
      return successResponse(batch);
    });

    const result = await runTargetedAnalysisTransfer(baseOptions(resolver, requests, uploadBatch));

    expect(resolverCountsAtUpload).toEqual([2, 4, 6, 7]);
    expect(result.matchedCount).toBe(7);
    expect(result.matchedPaths.size).toBe(7);
  });

  it('marks missing DAT without recursively searching for a replacement', async () => {
    const resolver: UsbFileResolver = vi.fn(async (segments) => notFound(segments));
    const uploadBatch = vi.fn(async (batch: MatchedAnalysisFile[]) => successResponse(batch));

    const result = await runTargetedAnalysisTransfer(baseOptions(
      resolver,
      [request('PIONEER/USBANLZ/P001/MISSING.DAT')],
      uploadBatch,
    ));

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(uploadBatch).not.toHaveBeenCalled();
    expect(result.missingCount).toBe(1);
    expect(result.matchedPaths.size).toBe(0);
  });

  it('marks missing EXT without recursively searching for a replacement', async () => {
    const resolver: UsbFileResolver = vi.fn(async (segments) => notFound(segments));
    const uploadBatch = vi.fn(async (batch: MatchedAnalysisFile[]) => successResponse(batch));

    const result = await runTargetedAnalysisTransfer(baseOptions(
      resolver,
      [request('PIONEER/USBANLZ/P001/MISSING.EXT', 'EXT')],
      uploadBatch,
    ));

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(uploadBatch).not.toHaveBeenCalled();
    expect(result.missingCount).toBe(1);
  });

  it('re-resolves only the failed exact path for file-level retry', async () => {
    const path = 'PIONEER/USBANLZ/P001/ANLZ0001.DAT';
    const resolver: UsbFileResolver = vi.fn(async (segments) => ({
      ok: true,
      file: new File(['dat'], segments.at(-1) ?? 'ANLZ0001.DAT'),
    }));
    let attempt = 0;
    const uploadBatch = vi.fn(async (batch: MatchedAnalysisFile[]) => {
      attempt += 1;
      if (attempt === 1) {
        return {
          import_id: 'import-1',
          received_count: 0,
          already_received_count: 0,
          rejected_count: 0,
          error_count: 1,
          received_bytes: 0,
          files: [{
            canonical_path: batch[0].canonicalPath,
            status: 'error',
            sha256: null,
            file_size: batch[0].file.size,
            reject_reason: 'storage failure',
          }],
        };
      }
      return successResponse(batch);
    });

    const result = await runTargetedAnalysisTransfer({
      ...baseOptions(resolver, [request(path)], uploadBatch),
      fileRetryDelaysMs: [0],
      waitForRetryDelay: async () => undefined,
    });

    expect(resolver).toHaveBeenCalledTimes(2);
    expect(vi.mocked(resolver).mock.calls[0][0]).toEqual(['PIONEER', 'USBANLZ', 'P001', 'ANLZ0001.DAT']);
    expect(vi.mocked(resolver).mock.calls[1][0]).toEqual(['PIONEER', 'USBANLZ', 'P001', 'ANLZ0001.DAT']);
    expect(uploadBatch).toHaveBeenCalledTimes(2);
    expect(uploadBatch.mock.calls[0][1]).toBe(3);
    expect(uploadBatch.mock.calls[1][1]).toBe(1);
    expect(result.accumulator.successfullyUploadedPaths).toEqual(new Set([path.toLowerCase()]));
  });

  it('rejects malformed traversal paths locally without probing the USB', async () => {
    const resolver: UsbFileResolver = vi.fn(async (segments) => ({
      ok: true,
      file: new File(['wrong'], segments.at(-1) ?? 'wrong.DAT'),
    }));
    const uploadBatch = vi.fn(async (batch: MatchedAnalysisFile[]) => successResponse(batch));

    const result = await runTargetedAnalysisTransfer(baseOptions(
      resolver,
      [request('PIONEER/USBANLZ/../secret.DAT')],
      uploadBatch,
    ));

    expect(resolver).not.toHaveBeenCalled();
    expect(uploadBatch).not.toHaveBeenCalled();
    expect(result.missingCount).toBe(1);
  });
});
