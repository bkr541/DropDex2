import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadRekordboxDb } from './rekordboxImport';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Rekordbox import upload requests', () => {
  it('passes the AbortSignal and pre-created import ID to the database upload', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      expect(init?.body).toBeInstanceOf(FormData);
      const form = init?.body as FormData;
      expect(form.get('import_id')).toBe('job-123');
      expect((form.get('file') as File).name).toBe('exportLibrary.db');
      return new Response(JSON.stringify({
        import_id: 'job-123',
        status: 'completed',
        source_filename: 'exportLibrary.db',
        track_count: 1,
        playlist_count: 0,
        playlist_track_count: 0,
        playlists: [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    await uploadRekordboxDb(
      new File(['database'], 'exportLibrary.db'),
      'token',
      { importId: 'job-123', signal: controller.signal },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
