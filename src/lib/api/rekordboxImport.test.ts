import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadRekordboxDb, uploadRekordboxZipBundle } from './rekordboxImport';

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

  it('rejects malformed successful import responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      import_id: 'job-123',
      status: 'completed',
      source_filename: 'exportLibrary.db',
      playlists: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    await expect(uploadRekordboxDb(
      new File(['database'], 'exportLibrary.db'),
      'token',
    )).rejects.toThrow('unexpected import result response');
  });
});


class MockEventTarget {
  private listeners = new Map<string, Set<(event: Event) => void>>();

  addEventListener(type: string, listener: (event: Event) => void): void {
    const callbacks = this.listeners.get(type) ?? new Set<(event: Event) => void>();
    callbacks.add(listener);
    this.listeners.set(type, callbacks);
  }

  dispatch(type: string, event = new Event(type)): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class MockXMLHttpRequest extends MockEventTarget {
  static instances: MockXMLHttpRequest[] = [];

  readonly upload = new MockEventTarget();
  status = 0;
  responseText = '';
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  abort = vi.fn(() => this.dispatch('abort'));

  constructor() {
    super();
    MockXMLHttpRequest.instances.push(this);
  }
}

describe('Rekordbox bundle upload cancellation', () => {
  afterEach(() => {
    MockXMLHttpRequest.instances = [];
  });

  it('rejects immediately when the supplied signal is already aborted', async () => {
    vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest);
    const controller = new AbortController();
    controller.abort();

    await expect(uploadRekordboxZipBundle(
      new File(['bundle'], 'rekordbox.zip'),
      'token',
      undefined,
      controller.signal,
    )).rejects.toMatchObject({ name: 'AbortError' });

    expect(MockXMLHttpRequest.instances).toHaveLength(0);
  });

  it('aborts an active XHR and settles the Promise exactly once', async () => {
    vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest);
    const controller = new AbortController();

    const upload = uploadRekordboxZipBundle(
      new File(['bundle'], 'rekordbox.zip'),
      'token',
      undefined,
      controller.signal,
      'job-123',
    );
    const xhr = MockXMLHttpRequest.instances[0];

    expect(xhr.send).toHaveBeenCalledOnce();
    controller.abort();

    await expect(upload).rejects.toMatchObject({ name: 'AbortError' });
    expect(xhr.abort).toHaveBeenCalledOnce();
  });

  it('rejects a successful HTTP response with invalid JSON', async () => {
    vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest);

    const upload = uploadRekordboxZipBundle(
      new File(['bundle'], 'rekordbox.zip'),
      'token',
    );
    const xhr = MockXMLHttpRequest.instances[0];
    xhr.status = 200;
    xhr.responseText = '';
    xhr.dispatch('load');

    await expect(upload).rejects.toThrow('invalid response');
  });
});
