import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { RekordboxImport, RekordboxTrack } from '../../types';

vi.mock('../../theme/ThemeProvider', () => ({ useTheme: () => ({ theme: 'dropdex', setTheme: vi.fn() }) }));
vi.mock('../../hooks/useAuthSession', () => ({
  useAuthSession: () => ({ status: 'unauthenticated', retry: vi.fn(), clearSession: vi.fn() }),
}));
vi.mock('../../contexts/UsbConnectionContext', () => ({
  useUsbConnection: () => ({ status: 'connected', connect: vi.fn(), ensurePermission: vi.fn(), resolveTrackSource: vi.fn() }),
}));
vi.mock('../../hooks/useRekordboxTracks', () => ({
  useLibraryStats: () => ({
    stats: { genreTotals: [{ name: 'House', count: 3 }], artistTotals: [{ name: 'Nurko', count: 2 }], keyTotals: [], bpmTotals: [], mostCommonBpm: 150, mostCommonKey: '2A' },
    loading: false, error: null, refresh: vi.fn(),
  }),
  useLibraryTracks: () => ({ tracks: [], total: 0, loading: false, loadingMore: false, error: null, hasMore: false, loadMore: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('../../hooks/useRekordboxPlaylists', () => ({ useRekordboxPlaylists: () => ({ playlists: [], loading: false, error: null }) }));
vi.mock('../../hooks/useRekordboxPlaylistTracks', () => ({
  useRekordboxPlaylistTracks: () => ({ tracks: [], total: 0, stats: null, loading: false, loadingMore: false, statsLoading: false, error: null, hasMore: false, loadMore: vi.fn() }),
}));
vi.mock('../../hooks/useRouteEntities', () => ({ useRouteImport: () => ({ data: null, loading: false, error: null }) }));
vi.mock('../../hooks/useTrackPreviewWaveforms', () => ({
  useTrackPreviewWaveforms: () => ({ states: new Map(), loadingBatchCount: 0, retry: vi.fn(), getState: (id: string | null | undefined) => ({ status: 'idle', trackId: id ?? 'none' }) }),
}));
vi.mock('../../hooks/useSpotifyAvailability', () => ({ useSpotifyAvailability: () => false }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));

let ReviewView: typeof import('./ReviewView').ReviewView;
let AudioPlayerProvider: typeof import('../../contexts/AudioPlayerContext').AudioPlayerProvider;

beforeAll(async () => {
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  ({ ReviewView } = await import('./ReviewView'));
  ({ AudioPlayerProvider } = await import('../../contexts/AudioPlayerContext'));
});

const render = () => renderToStaticMarkup(createElement(AudioPlayerProvider, {
  imports: [],
  children: createElement(ReviewView, {
    importId: 'import-1',
    latestImport: { id: 'import-1', status: 'completed', device_name: 'LUMA', analysis_status: 'completed', track_count: 3, analysis_expected_track_count: 3, analysis_parsed_track_count: 3, created_at: '2026-11-01T00:00:00Z' } as unknown as RekordboxImport,
    profile: null,
    playlists: [],
    playlistsLoading: false,
    playlistProfilesByRbId: new Map(),
    recentTracks: [{ id: 'r1', title: 'Fresh Track', artist: 'Someone', bpm: 150, musical_key: '2A', duration_ms: 200000 } as RekordboxTrack],
    recentTracksLoading: false,
    spotifyAccessToken: null,
    onPlaylistClick: vi.fn(),
    onEditPlaylist: vi.fn(),
    onImport: vi.fn(),
    onShowIncompleteAnalysis: vi.fn(),
    onTrackClick: vi.fn(),
  }),
}));

describe('Review page', () => {
  it('shows the Library tab row between the hero and the table, with Tracks selected', () => {
    const markup = render();
    const tabs = markup.indexOf('role="tablist"');
    const filters = markup.indexOf('data-testid="cue-browser-filters"');
    expect(tabs).toBeGreaterThan(-1);
    expect(filters).toBeGreaterThan(tabs);
    for (const label of ['Playlists', 'Recently Added', 'Tracks', 'Genres', 'Artists']) expect(markup).toContain(`${label}</button>`);
    expect(markup).not.toContain('Overview</button>');
    expect(markup).not.toContain('Analysis Incomplete</button>');
    expect(markup).not.toContain('Spotify</button>');
    expect(markup).toMatch(/aria-selected="true"[^>]*>(?:<svg[\s\S]*?<\/svg>)?Tracks<\/button>/);
    expect(markup.match(/role="tab"[^>]*>\s*<svg/g)).toHaveLength(5);
  });

  it('no longer has the Tracks heading and count row', () => {
    const markup = render();
    expect(markup).not.toMatch(/<h2[^>]*>[\s\S]*?Tracks<\/h2>/);
    expect(markup).not.toContain('tracks</span></div>');
  });

  it('keeps the search and filters of the Tracks table', () => {
    const markup = render();
    expect(markup).toContain('aria-label="Search review tracks"');
    expect(markup).toContain('data-testid="cue-browser-filters"');
  });
});
