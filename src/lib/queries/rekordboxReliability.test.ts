import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rangeMock, inMock, rpcMock, fromMock } = vi.hoisted(() => {
  const range = vi.fn();
  const inQuery = vi.fn();
  const rpc = vi.fn();
  const from = vi.fn(() => {
    const builder = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      range,
      in: inQuery,
    };
    builder.select.mockReturnValue(builder);
    builder.eq.mockReturnValue(builder);
    builder.order.mockReturnValue(builder);
    return builder;
  });
  return { rangeMock: range, inMock: inQuery, rpcMock: rpc, fromMock: from };
});

vi.mock('../supabase', () => ({
  supabase: {
    from: fromMock,
    rpc: rpcMock,
  },
}));

import {
  fetchActiveImport,
  fetchAllImports,
  fetchLatestImport,
  fetchTrackPlaylists,
  fetchTracksByIds,
} from './rekordbox';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('large-library query reliability', () => {
  it('pages through every import instead of stopping at the PostgREST row cap', async () => {
    rangeMock
      .mockResolvedValueOnce({
        data: Array.from({ length: 500 }, (_, index) => ({ id: `import-${index}` })),
        error: null,
      })
      .mockResolvedValueOnce({
        data: Array.from({ length: 500 }, (_, index) => ({ id: `import-${index + 500}` })),
        error: null,
      })
      .mockResolvedValueOnce({ data: [{ id: 'import-1000' }], error: null });

    const imports = await fetchAllImports('user-1');

    expect(imports).toHaveLength(1001);
    expect(rangeMock.mock.calls).toEqual([[0, 499], [500, 999], [1000, 1499]]);
  });

  it('filters legacy cancelled tombstones out of library snapshots', async () => {
    rangeMock.mockResolvedValueOnce({
      data: [
        { id: 'usable', status: 'completed' },
        { id: 'deleted-tombstone', status: 'cancelled' },
      ],
      error: null,
    });

    const imports = await fetchAllImports('user-1');

    expect(imports.map((item) => item.id)).toEqual(['usable']);
  });

  it('requires the library-ready milestone when selecting the automatic latest fallback', async () => {
    const latestBuilder = {
      select: vi.fn(),
      eq: vi.fn(),
      in: vi.fn(),
      not: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: 'ready-import', status: 'interrupted', library_ready_at: '2026-08-16T12:00:00Z' },
        error: null,
      }),
    };
    latestBuilder.select.mockReturnValue(latestBuilder);
    latestBuilder.eq.mockReturnValue(latestBuilder);
    latestBuilder.in.mockReturnValue(latestBuilder);
    latestBuilder.not.mockReturnValue(latestBuilder);
    latestBuilder.order.mockReturnValue(latestBuilder);
    latestBuilder.limit.mockReturnValue(latestBuilder);
    fromMock.mockReturnValueOnce(latestBuilder as never);

    const latest = await fetchLatestImport('user-1');

    expect(latest?.id).toBe('ready-import');
    expect(latestBuilder.in).toHaveBeenCalledWith('status', [
      'completed',
      'paused',
      'interrupted',
    ]);
    expect(latestBuilder.not).toHaveBeenCalledWith('library_ready_at', 'is', null);
  });

  it('treats an explicit null active_import_id as the Start Over empty state', async () => {
    const settingsBuilder = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { active_import_id: null },
        error: null,
      }),
    };
    settingsBuilder.select.mockReturnValue(settingsBuilder);
    settingsBuilder.eq.mockReturnValue(settingsBuilder);
    fromMock.mockReturnValueOnce(settingsBuilder as never);

    await expect(fetchActiveImport('user-1')).resolves.toBeNull();
    expect(fromMock).toHaveBeenCalledTimes(1);
  });

  it('suppresses latest-library fallback while Start Over deletion is pending', async () => {
    const settingsBuilder = {
      select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({
        data: { active_import_id: 'active-delete' }, error: null,
      }),
    };
    settingsBuilder.select.mockReturnValue(settingsBuilder);
    settingsBuilder.eq.mockReturnValue(settingsBuilder);

    const importBuilder = {
      select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: 'active-delete', status: 'stopping', library_ready_at: '2026-08-16T12:00:00Z',
          delete_active_strategy: 'start_over',
        },
        error: null,
      }),
    };
    importBuilder.select.mockReturnValue(importBuilder);
    importBuilder.eq.mockReturnValue(importBuilder);

    fromMock
      .mockReturnValueOnce(settingsBuilder as never)
      .mockReturnValueOnce(importBuilder as never);

    await expect(fetchActiveImport('user-1')).resolves.toBeNull();
    expect(fromMock).toHaveBeenCalledTimes(2);
  });

  it('allows activate-next deletion to render the newest usable fallback while pending', async () => {
    const settingsBuilder = {
      select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({
        data: { active_import_id: 'active-delete' }, error: null,
      }),
    };
    settingsBuilder.select.mockReturnValue(settingsBuilder);
    settingsBuilder.eq.mockReturnValue(settingsBuilder);

    const importBuilder = {
      select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: 'active-delete', status: 'stopping', library_ready_at: '2026-08-16T12:00:00Z',
          delete_active_strategy: 'activate_next',
        },
        error: null,
      }),
    };
    importBuilder.select.mockReturnValue(importBuilder);
    importBuilder.eq.mockReturnValue(importBuilder);

    const latestBuilder = {
      select: vi.fn(), eq: vi.fn(), in: vi.fn(), not: vi.fn(), order: vi.fn(), limit: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: 'fallback', status: 'completed', library_ready_at: '2026-08-16T11:00:00Z' },
        error: null,
      }),
    };
    latestBuilder.select.mockReturnValue(latestBuilder);
    latestBuilder.eq.mockReturnValue(latestBuilder);
    latestBuilder.in.mockReturnValue(latestBuilder);
    latestBuilder.not.mockReturnValue(latestBuilder);
    latestBuilder.order.mockReturnValue(latestBuilder);
    latestBuilder.limit.mockReturnValue(latestBuilder);

    fromMock
      .mockReturnValueOnce(settingsBuilder as never)
      .mockReturnValueOnce(importBuilder as never)
      .mockReturnValueOnce(latestBuilder as never);

    await expect(fetchActiveImport('user-1')).resolves.toMatchObject({ id: 'fallback' });
  });

  // ── Browse-in-Background / processing import scenarios ──────────────────────

  it('returns a processing import as the active library once library_ready_at is set (Test 1)', async () => {
    const settingsBuilder = {
      select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({
        data: { active_import_id: 'import-a' }, error: null,
      }),
    };
    settingsBuilder.select.mockReturnValue(settingsBuilder);
    settingsBuilder.eq.mockReturnValue(settingsBuilder);

    const importBuilder = {
      select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({
        data: { id: 'import-a', status: 'processing', library_ready_at: '2026-08-16T12:01:00Z' },
        error: null,
      }),
    };
    importBuilder.select.mockReturnValue(importBuilder);
    importBuilder.eq.mockReturnValue(importBuilder);

    fromMock
      .mockReturnValueOnce(settingsBuilder as never)
      .mockReturnValueOnce(importBuilder as never);

    await expect(fetchActiveImport('user-1')).resolves.toMatchObject({
      id: 'import-a',
      status: 'processing',
    });
    expect(fromMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a processing import when library_ready_at is null — not yet browseable (Test 2)', async () => {
    const settingsBuilder = {
      select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({
        data: { active_import_id: 'import-a' }, error: null,
      }),
    };
    settingsBuilder.select.mockReturnValue(settingsBuilder);
    settingsBuilder.eq.mockReturnValue(settingsBuilder);

    const importBuilder = {
      select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({
        data: { id: 'import-a', status: 'processing', library_ready_at: null },
        error: null,
      }),
    };
    importBuilder.select.mockReturnValue(importBuilder);
    importBuilder.eq.mockReturnValue(importBuilder);

    const latestBuilder = {
      select: vi.fn(), eq: vi.fn(), in: vi.fn(), not: vi.fn(), order: vi.fn(), limit: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    latestBuilder.select.mockReturnValue(latestBuilder);
    latestBuilder.eq.mockReturnValue(latestBuilder);
    latestBuilder.in.mockReturnValue(latestBuilder);
    latestBuilder.not.mockReturnValue(latestBuilder);
    latestBuilder.order.mockReturnValue(latestBuilder);
    latestBuilder.limit.mockReturnValue(latestBuilder);

    fromMock
      .mockReturnValueOnce(settingsBuilder as never)
      .mockReturnValueOnce(importBuilder as never)
      .mockReturnValueOnce(latestBuilder as never);

    await expect(fetchActiveImport('user-1')).resolves.toBeNull();
  });

  it('returns processing new import over old completed library when new library is ready (Test 3)', async () => {
    const settingsBuilder = {
      select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({
        data: { active_import_id: 'import-b' }, error: null,
      }),
    };
    settingsBuilder.select.mockReturnValue(settingsBuilder);
    settingsBuilder.eq.mockReturnValue(settingsBuilder);

    // New import B is the active import: processing but library_ready_at is set
    const importBBuilder = {
      select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({
        data: { id: 'import-b', status: 'processing', library_ready_at: '2026-08-16T13:00:00Z' },
        error: null,
      }),
    };
    importBBuilder.select.mockReturnValue(importBBuilder);
    importBBuilder.eq.mockReturnValue(importBBuilder);

    fromMock
      .mockReturnValueOnce(settingsBuilder as never)
      .mockReturnValueOnce(importBBuilder as never);

    // Should return import-b, NOT fall back to the old completed library
    await expect(fetchActiveImport('user-1')).resolves.toMatchObject({ id: 'import-b' });
    // fetchLatestImport must NOT be called — old library must not silently take over
    expect(fromMock).toHaveBeenCalledTimes(2);
  });

  it('does not make processing imports eligible for the stable fallback query (fetchLatestImport)', async () => {
    const latestBuilder = {
      select: vi.fn(), eq: vi.fn(), in: vi.fn(), not: vi.fn(), order: vi.fn(), limit: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    latestBuilder.select.mockReturnValue(latestBuilder);
    latestBuilder.eq.mockReturnValue(latestBuilder);
    latestBuilder.in.mockReturnValue(latestBuilder);
    latestBuilder.not.mockReturnValue(latestBuilder);
    latestBuilder.order.mockReturnValue(latestBuilder);
    latestBuilder.limit.mockReturnValue(latestBuilder);
    fromMock.mockReturnValueOnce(latestBuilder as never);

    await fetchLatestImport('user-1');

    // Stable fallback must NOT include processing status
    expect(latestBuilder.in).toHaveBeenCalledWith('status', ['completed', 'paused', 'interrupted']);
  });

  it('returns a completed import as the active library — processing→completed transition keeps the same import (Test 7)', async () => {
    const settingsBuilder = {
      select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({
        data: { active_import_id: 'import-a' }, error: null,
      }),
    };
    settingsBuilder.select.mockReturnValue(settingsBuilder);
    settingsBuilder.eq.mockReturnValue(settingsBuilder);

    const importBuilder = {
      select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({
        data: { id: 'import-a', status: 'completed', library_ready_at: '2026-08-16T12:05:00Z' },
        error: null,
      }),
    };
    importBuilder.select.mockReturnValue(importBuilder);
    importBuilder.eq.mockReturnValue(importBuilder);

    fromMock
      .mockReturnValueOnce(settingsBuilder as never)
      .mockReturnValueOnce(importBuilder as never);

    // After status flips from processing → completed, fetchActiveImport still returns it
    await expect(fetchActiveImport('user-1')).resolves.toMatchObject({
      id: 'import-a',
      status: 'completed',
    });
    expect(fromMock).toHaveBeenCalledTimes(2);
  });

  it('returns a paused or interrupted import as the active library — still browseable (Test 8)', async () => {
    for (const status of ['paused', 'interrupted'] as const) {
      vi.clearAllMocks();

      const settingsBuilder = {
        select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({
          data: { active_import_id: 'import-a' }, error: null,
        }),
      };
      settingsBuilder.select.mockReturnValue(settingsBuilder);
      settingsBuilder.eq.mockReturnValue(settingsBuilder);

      const importBuilder = {
        select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'import-a', status, library_ready_at: '2026-08-16T12:05:00Z' },
          error: null,
        }),
      };
      importBuilder.select.mockReturnValue(importBuilder);
      importBuilder.eq.mockReturnValue(importBuilder);

      fromMock
        .mockReturnValueOnce(settingsBuilder as never)
        .mockReturnValueOnce(importBuilder as never);

      // eslint-disable-next-line no-await-in-loop
      await expect(fetchActiveImport('user-1')).resolves.toMatchObject({ id: 'import-a', status });
    }
  });

  it('does not return a failed or cancelled import — not browseable even if library_ready_at was set (Test 9)', async () => {
    for (const status of ['failed', 'cancelled'] as const) {
      vi.clearAllMocks();

      const settingsBuilder = {
        select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({
          data: { active_import_id: 'import-a' }, error: null,
        }),
      };
      settingsBuilder.select.mockReturnValue(settingsBuilder);
      settingsBuilder.eq.mockReturnValue(settingsBuilder);

      const importBuilder = {
        select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({
          // library_ready_at was set before it failed/was cancelled
          data: { id: 'import-a', status, library_ready_at: '2026-08-16T12:05:00Z' },
          error: null,
        }),
      };
      importBuilder.select.mockReturnValue(importBuilder);
      importBuilder.eq.mockReturnValue(importBuilder);

      const latestBuilder = {
        select: vi.fn(), eq: vi.fn(), in: vi.fn(), not: vi.fn(), order: vi.fn(), limit: vi.fn(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
      latestBuilder.select.mockReturnValue(latestBuilder);
      latestBuilder.eq.mockReturnValue(latestBuilder);
      latestBuilder.in.mockReturnValue(latestBuilder);
      latestBuilder.not.mockReturnValue(latestBuilder);
      latestBuilder.order.mockReturnValue(latestBuilder);
      latestBuilder.limit.mockReturnValue(latestBuilder);

      fromMock
        .mockReturnValueOnce(settingsBuilder as never)
        .mockReturnValueOnce(importBuilder as never)
        .mockReturnValueOnce(latestBuilder as never);

      // eslint-disable-next-line no-await-in-loop
      await expect(fetchActiveImport('user-1')).resolves.toBeNull();
    }
  });

  it('re-reads settings when the active row disappears across hard-delete finalization', async () => {
    const firstSettingsBuilder = {
      select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({
        data: { active_import_id: 'just-deleted' }, error: null,
      }),
    };
    firstSettingsBuilder.select.mockReturnValue(firstSettingsBuilder);
    firstSettingsBuilder.eq.mockReturnValue(firstSettingsBuilder);

    const missingImportBuilder = {
      select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    missingImportBuilder.select.mockReturnValue(missingImportBuilder);
    missingImportBuilder.eq.mockReturnValue(missingImportBuilder);

    const refreshedSettingsBuilder = {
      select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({
        data: { active_import_id: null }, error: null,
      }),
    };
    refreshedSettingsBuilder.select.mockReturnValue(refreshedSettingsBuilder);
    refreshedSettingsBuilder.eq.mockReturnValue(refreshedSettingsBuilder);

    fromMock
      .mockReturnValueOnce(firstSettingsBuilder as never)
      .mockReturnValueOnce(missingImportBuilder as never)
      .mockReturnValueOnce(refreshedSettingsBuilder as never);

    await expect(fetchActiveImport('user-1')).resolves.toBeNull();
    expect(fromMock).toHaveBeenCalledTimes(3);
  });

  it('chunks large track-id lookups and preserves requested order', async () => {
    const ids = Array.from({ length: 405 }, (_, index) => `track-${index}`);
    inMock.mockImplementation(async (_column: string, chunk: string[]) => ({
      data: [...chunk].reverse().map((id) => ({ id })),
      error: null,
    }));

    const tracks = await fetchTracksByIds(ids);

    expect(inMock).toHaveBeenCalledTimes(3);
    expect(inMock.mock.calls.map((call) => call[1].length)).toEqual([200, 200, 5]);
    expect(tracks.map((track) => track.id)).toEqual(ids);
  });

  it('uses the ownership-safe playlist membership RPC', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ position: 7, playlist: { id: 'playlist-1', name: 'Warmup' } }],
      error: null,
    });

    const memberships = await fetchTrackPlaylists('import-1', 'track-1');

    expect(rpcMock).toHaveBeenCalledWith('get_rekordbox_track_playlists', {
      p_import_id: 'import-1',
      p_track_id: 'track-1',
    });
    expect(memberships).toEqual([
      { position: 7, playlist: { id: 'playlist-1', name: 'Warmup' } },
    ]);
  });


  it('falls back to the ownership-filtered relation query when the RPC migration is missing', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function in the schema cache' },
    });
    const fallbackBuilder = {
      select: vi.fn(),
      eq: vi.fn(),
    };
    fallbackBuilder.select.mockReturnValue(fallbackBuilder);
    fallbackBuilder.eq
      .mockReturnValueOnce(fallbackBuilder)
      .mockResolvedValueOnce({
        data: [{ position: 3, playlist: { id: 'playlist-2', name: 'Peak Time' } }],
        error: null,
      });
    fromMock.mockReturnValueOnce(fallbackBuilder);

    const memberships = await fetchTrackPlaylists('import-1', 'track-1');

    expect(fromMock).toHaveBeenCalledWith('rekordbox_playlist_tracks');
    expect(memberships).toEqual([
      { position: 3, playlist: { id: 'playlist-2', name: 'Peak Time' } },
    ]);
  });
});
