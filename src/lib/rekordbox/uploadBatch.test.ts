import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchedAnalysisFile } from './analysisPaths';
import { AbortableTimerRegistry } from './abortableRetry';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  uploadRekordboxAnalysisBatch: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: { auth: { getSession: mocks.getSession } },
}));

vi.mock('../api/rekordboxImport', () => ({
  uploadRekordboxAnalysisBatch: mocks.uploadRekordboxAnalysisBatch,
}));

import { uploadBatchWithRetry } from './uploadBatch';

const batch: MatchedAnalysisFile[] = [{
  file: new File(['anlz'], 'ANLZ0000.DAT'),
  canonicalPath: 'PIONEER/USBANLZ/P001/ANLZ0000.DAT',
  originalBrowserPath: 'USB/PIONEER/USBANLZ/P001/ANLZ0000.DAT',
  assetType: 'DAT',
  trackId: 'track-1',
}];

describe('uploadBatchWithRetry cancellation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    mocks.getSession.mockReset();
    mocks.uploadRekordboxAnalysisBatch.mockReset();
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'fresh-token' } } });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('cancels a pending retry delay and never starts another request', async () => {
    const controller = new AbortController();
    const timers = new AbortableTimerRegistry();
    mocks.uploadRekordboxAnalysisBatch.mockRejectedValueOnce(new Error('temporary network failure'));

    const promise = uploadBatchWithRetry(
      'import-1',
      batch,
      'fallback-token',
      controller.signal,
      3,
      { retryTimers: timers },
    );

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.uploadRekordboxAnalysisBatch).toHaveBeenCalledTimes(1);
    expect(timers.activeCount).toBe(1);

    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    await vi.runAllTimersAsync();

    expect(mocks.uploadRekordboxAnalysisBatch).toHaveBeenCalledTimes(1);
    expect(mocks.getSession).toHaveBeenCalledTimes(1);
    expect(timers.activeCount).toBe(0);
  });

  it('does not record AbortError as an ordinary upload failure', async () => {
    const controller = new AbortController();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.uploadRekordboxAnalysisBatch.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));

    await expect(uploadBatchWithRetry(
      'import-1',
      batch,
      'fallback-token',
      controller.signal,
    )).rejects.toMatchObject({ name: 'AbortError' });

    expect(mocks.uploadRekordboxAnalysisBatch).toHaveBeenCalledTimes(1);
    expect(warning).not.toHaveBeenCalled();
  });
});
