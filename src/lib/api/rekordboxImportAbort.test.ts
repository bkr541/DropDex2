import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  startRekordboxImport,
  uploadRekordboxAnalysisBatch,
  uploadRekordboxDb,
  uploadRekordboxZipBundle,
} from './rekordboxImport';

function abortedSignal(): AbortSignal {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
}

describe('Rekordbox upload API cancellation gates', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not start any fetch when an upload signal is already aborted', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['db'], 'exportLibrary.db');
    const signal = abortedSignal();

    await expect(uploadRekordboxDb(file, 'token', { signal })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(startRekordboxImport(file, 'token', signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(uploadRekordboxAnalysisBatch('import-1', [{
      file: new File(['anlz'], 'ANLZ0000.DAT'),
      canonicalPath: 'PIONEER/USBANLZ/P001/ANLZ0000.DAT',
    }], 'token', signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(uploadRekordboxZipBundle(
      new File(['zip'], 'rekordbox.zip'),
      'token',
      undefined,
      signal,
    )).rejects.toMatchObject({ name: 'AbortError' });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
