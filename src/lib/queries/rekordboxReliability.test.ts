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
  fetchAllImports,
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
});
