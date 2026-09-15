import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteAllRekordboxImports,
  deleteRekordboxImport,
  fetchRekordboxWorkerState,
  fetchRekordboxAnalysisStatus,
  isExpectedHardDeleteNotFound,
  isNotFoundRekordboxImportError,
  isUnauthorizedRekordboxImportError,
  pauseRekordboxAnalysis,
  resumeRekordboxAnalysis,
  uploadRekordboxAnalysisBatch,
  uploadRekordboxDb,
  uploadRekordboxZipBundle,
} from './rekordboxImport';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Rekordbox import API errors', () => {
  it('keeps 404 classification explicit for deletion-aware callers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ detail: 'Import not found.' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    )));

    let caught: unknown;
    try {
      await fetchRekordboxAnalysisStatus('missing-import', 'token');
    } catch (error) {
      caught = error;
    }

    expect(isNotFoundRekordboxImportError(caught)).toBe(true);
    expect(isExpectedHardDeleteNotFound(caught, true)).toBe(true);
    expect(isExpectedHardDeleteNotFound(caught, false)).toBe(false);
    expect(isUnauthorizedRekordboxImportError(caught)).toBe(false);
  });

  it('supports lightweight analysis progress polling without detailed projections', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ detail: 'Import not found.' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchRekordboxAnalysisStatus('job-123', 'token', undefined, false),
    ).rejects.toBeDefined();

    expect(String(fetchMock.mock.calls[0][0])).toContain('/analysis-status?details=false');
  });
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


  it('preserves HTTP 401 status so callers can refresh and retry once', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      detail: 'Invalid or expired token',
    }), { status: 401, headers: { 'Content-Type': 'application/json' } })));

    let caught: unknown;
    try {
      await fetchRekordboxAnalysisStatus('job-123', 'expired-token');
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ status: 401 });
    expect(isUnauthorizedRekordboxImportError(caught)).toBe(true);
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

describe('Rekordbox analysis worker control requests', () => {
  const jobBody = {
    import_id: 'job-123',
    status: 'paused',
    source_filename: 'exportLibrary.db',
    source_bundle_type: 'usb_folder',
    error_code: null,
    error_message: null,
    retryable: true,
    analysis_status: 'paused',
    worker_status: 'paused',
    worker_stage: 'stopped',
    worker_current_track_id: null,
    worker_last_heartbeat: '2026-07-24T12:00:00Z',
    worker_stopped_acknowledged: true,
  };

  it('uses distinct pause and destructive delete endpoints', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(init?.signal).toBe(controller.signal);
      if (url.endsWith('/pause')) expect(init?.method).toBe('POST');
      else {
        expect(init?.method).toBe('DELETE');
        expect(url).toContain('active_strategy=activate_next');
      }
      return new Response(JSON.stringify(jobBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await pauseRekordboxAnalysis('job-123', 'token', controller.signal);
    await deleteRekordboxImport('job-123', 'token', controller.signal);

    expect(fetchMock.mock.calls[0]?.[0]).toContain('/job-123/pause');
    expect(fetchMock.mock.calls[1]?.[0]).toMatch(/\/job-123\?active_strategy=activate_next$/);
  });

  it('uses the dedicated destructive endpoint for deleting every snapshot', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toMatch(/\/api\/rekordbox\/imports$/);
      expect(init?.method).toBe('DELETE');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token');
      return new Response(JSON.stringify({
        status: 'completed',
        deleted_count: 3,
        remaining_count: 0,
        pending_import_ids: [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(deleteAllRekordboxImports('token')).resolves.toEqual({
      status: 'completed',
      deleted_count: 3,
      remaining_count: 0,
      pending_import_ids: [],
    });
  });

  it('sends the explicit Start Over strategy for destructive library deletion', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('active_strategy=start_over');
      return new Response(JSON.stringify(jobBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await deleteRekordboxImport('job-123', 'token', undefined, 'start_over');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('validates worker acknowledgement and stage polling data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      import_id: 'job-123',
      job_status: 'paused',
      analysis_status: 'paused',
      worker_status: 'paused',
      worker_active: false,
      current_track_id: null,
      processing_stage: 'stopped',
      last_heartbeat: '2026-07-24T12:00:00Z',
      stop_reason: 'pause',
      stopped_acknowledged: true,
      stopped_at: '2026-07-24T12:00:01Z',
      error: null,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    await expect(fetchRekordboxWorkerState('job-123', 'token')).resolves.toMatchObject({
      worker_active: false,
      processing_stage: 'stopped',
      stopped_acknowledged: true,
    });
  });

  it('resumes through the retained-assets endpoint without a USB payload', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(init?.body).toBeUndefined();
      return new Response(JSON.stringify({
        import_id: 'job-123',
        analysis_status: 'completed',
        total_tracks: 1,
        completed_count: 1,
        partial_count: 0,
        failed_count: 0,
        missing_required_count: 0,
        missing_optional_ext_count: 0,
        missing_optional_2ex_count: 0,
        parser_version: 'test',
        tracks: [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    await resumeRekordboxAnalysis('job-123', 'token');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/job-123/resume');
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

// ── Analysis batch timeout ────────────────────────────────────────────────────

const batchSuccessBody = {
  import_id: 'import-1',
  received_count: 1,
  already_received_count: 0,
  rejected_count: 0,
  error_count: 0,
  received_bytes: 4,
  files: [{
    canonical_path: 'PIONEER/USBANLZ/P001/ANLZ0000.DAT',
    status: 'received',
    sha256: 'a'.repeat(64),
    file_size: 4,
    reject_reason: null,
  }],
};

describe('uploadRekordboxAnalysisBatch request timeout', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  const file = { file: new File(['anlz'], 'ANLZ0000.DAT'), canonicalPath: 'PIONEER/USBANLZ/P001/ANLZ0000.DAT' };

  it('succeeds normally when the server responds before the timer fires', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify(batchSuccessBody), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    ));

    const result = await uploadRekordboxAnalysisBatch('import-1', [file], 'token');
    expect(result.import_id).toBe('import-1');
    expect(result.received_count).toBe(1);
  });

  it('throws ANALYSIS_BATCH_TIMEOUT (not AbortError) when the internal timer fires', async () => {
    // Signal-aware mock: rejects with AbortError when the fetch signal fires,
    // mirroring real browser fetch behaviour.
    vi.stubGlobal('fetch', vi.fn((_input: unknown, init?: RequestInit) =>
      new Promise<never>((_, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) { reject(new DOMException('aborted', 'AbortError')); return; }
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })
    ));

    const promise = uploadRekordboxAnalysisBatch('import-1', [file], 'token');
    // Attach catch before advancing timers to avoid an unhandled rejection warning
    // during the microtask gap between the abort cascade and the test assertion.
    const settled = promise.catch((e: unknown) => e);

    // Advance past the 65 s internal timeout.
    await vi.advanceTimersByTimeAsync(66_000);

    const err = await settled;
    expect((err as Error).message).toBe('ANALYSIS_BATCH_TIMEOUT');
    // Must NOT be an AbortError — the retry wrapper treats AbortError as user cancellation.
    expect((err as { name?: string }).name).not.toBe('AbortError');
  });

  it('propagates a caller AbortError (not ANALYSIS_BATCH_TIMEOUT) when the caller signal fires', async () => {
    const controller = new AbortController();
    // Signal-aware mock.
    vi.stubGlobal('fetch', vi.fn((_input: unknown, init?: RequestInit) =>
      new Promise<never>((_, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) { reject(new DOMException('aborted', 'AbortError')); return; }
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })
    ));

    const promise = uploadRekordboxAnalysisBatch('import-1', [file], 'token', controller.signal);

    controller.abort();
    // Do not advance timers — caller abort fires before any internal timeout.

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('clears the timer and removes the abort listener after a successful response', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const controller = new AbortController();
    const addEventSpy = vi.spyOn(controller.signal, 'addEventListener');
    const removeEventSpy = vi.spyOn(controller.signal, 'removeEventListener');

    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify(batchSuccessBody), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    ));

    await uploadRekordboxAnalysisBatch('import-1', [file], 'token', controller.signal);

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(addEventSpy).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(removeEventSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('clears the timer and removes the abort listener after a failed response', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const controller = new AbortController();
    const removeEventSpy = vi.spyOn(controller.signal, 'removeEventListener');

    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ detail: 'HTTP 500' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    ));

    await expect(
      uploadRekordboxAnalysisBatch('import-1', [file], 'token', controller.signal),
    ).rejects.toBeDefined();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(removeEventSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});
