/**
 * Supabase mock helpers.
 *
 * These route all Supabase REST / Auth API calls to in-memory handlers,
 * so tests never reach production infrastructure.
 */

import type { Page, Route } from '@playwright/test';

// ── Fake session ──────────────────────────────────────────────────────────────

export const FAKE_USER_ID = 'test-user-00000000-0000-0000-0000-000000000001';
export const FAKE_USER_EMAIL = 'e2e@dropdex.test';
export const FAKE_ACCESS_TOKEN = 'fake-access-token-for-e2e-tests';
export const FAKE_IMPORT_ID = 'import-00000000-0000-0000-0000-000000000001';

export const FAKE_SESSION = {
  access_token: FAKE_ACCESS_TOKEN,
  refresh_token: 'fake-refresh-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: {
    id: FAKE_USER_ID,
    email: FAKE_USER_EMAIL,
    role: 'authenticated',
    aud: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: '2024-01-01T00:00:00Z',
  },
};

// ── Mock data ─────────────────────────────────────────────────────────────────

export const FAKE_IMPORT = {
  id: FAKE_IMPORT_ID,
  user_id: FAKE_USER_ID,
  status: 'completed',
  source_filename: 'exportLibrary.db',
  track_count: 2,
  playlist_count: 1,
  imported_at: '2025-01-01T00:00:00Z',
  analysis_status: 'completed',
  analysis_expected_track_count: 2,
  analysis_matched_track_count: 2,
  analysis_parsed_track_count: 2,
  analysis_failed_track_count: 0,
  analysis_asset_count: 4,
};

export const FAKE_TRACKS = [
  {
    id: 'track-00000000-0000-0000-0000-000000000001',
    import_id: FAKE_IMPORT_ID,
    rekordbox_content_id: '1001',
    title: 'Night Drive',
    artist: 'Artist One',
    genre: 'Techno',
    bpm: 138.0,
    musical_key: 'C',
    camelot_key: '8B',
    date_added: '2025-01-01',
    duration_seconds: 360,
    file_path: '/Contents/Techno/NightDrive.mp3',
    file_format: 'MP3',
  },
  {
    id: 'track-00000000-0000-0000-0000-000000000002',
    import_id: FAKE_IMPORT_ID,
    rekordbox_content_id: '1002',
    title: 'Sunrise Set',
    artist: 'Artist Two',
    genre: 'House',
    bpm: 124.0,
    musical_key: 'Am',
    camelot_key: '8A',
    date_added: '2025-01-02',
    duration_seconds: 420,
    file_path: '/Contents/House/SunriseSet.mp3',
    file_format: 'MP3',
  },
];

export const FAKE_PLAYLISTS = [
  {
    id: 'pl-00000000-0000-0000-0000-000000000001',
    import_id: FAKE_IMPORT_ID,
    name: 'Peak Time',
    is_folder: false,
    parent_playlist_id: null,
    position: 1,
  },
];

function filterRowsById<T extends { id: string }>(route: Route, rows: T[]): T[] {
  const idFilter = new URL(route.request().url()).searchParams.get('id');
  if (!idFilter) return rows;
  if (idFilter.startsWith('eq.')) {
    const id = decodeURIComponent(idFilter.slice(3));
    return rows.filter((row) => row.id === id);
  }
  const inMatch = idFilter.match(/^in\.\((.*)\)$/);
  if (inMatch) {
    const ids = inMatch[1].split(',').map((id) => decodeURIComponent(id.replace(/^"|"$/g, '')));
    return rows.filter((row) => ids.includes(row.id));
  }
  return rows;
}

// ── Route setup ───────────────────────────────────────────────────────────────

/**
 * Inject a fake Supabase session into localStorage before the page loads.
 * This bypasses the AuthGate without touching the network.
 */
export async function injectFakeSession(page: Page): Promise<void> {
  await page.addInitScript(
    ({ session, projectRef }: { session: typeof FAKE_SESSION; projectRef: string }) => {
      const key = `sb-${projectRef}-auth-token`;
      const value = JSON.stringify(session);
      // Override localStorage before the Supabase client reads it.
      Object.defineProperty(window, 'localStorage', {
        value: new Proxy(window.localStorage, {
          get(target, prop) {
            if (prop === 'getItem') {
              return (k: string) => (k === key ? value : target.getItem(k));
            }
            return typeof target[prop as keyof Storage] === 'function'
              ? (target[prop as keyof Storage] as Function).bind(target)
              : target[prop as keyof Storage];
          },
        }),
        configurable: true,
      });
    },
    { session: FAKE_SESSION, projectRef: 'fakeproject' },
  );
}

/**
 * Route all Supabase REST and auth API calls to local handlers.
 * Must be called before `page.goto()`.
 */
export async function mockSupabaseRoutes(
  page: Page,
  overrides: {
    tracks?: typeof FAKE_TRACKS;
    playlists?: typeof FAKE_PLAYLISTS;
    imports?: typeof FAKE_IMPORT[];
    waveforms?: Record<string, unknown>[];
  } = {},
): Promise<void> {
  const tracks = overrides.tracks ?? FAKE_TRACKS;
  const playlists = overrides.playlists ?? FAKE_PLAYLISTS;
  const imports = overrides.imports ?? [FAKE_IMPORT];
  const waveforms = overrides.waveforms ?? [];

  // Register the broad fallback first. Playwright evaluates page routes in
  // reverse registration order, so the specific handlers below take priority.
  await page.route('**/fakeproject.supabase.co/**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  // Auth: getSession — return the fake session token validation
  await page.route('**/auth/v1/token*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(FAKE_SESSION),
    });
  });

  // Auth: user endpoint
  await page.route('**/auth/v1/user*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(FAKE_SESSION.user),
    });
  });

  // Imports table
  await page.route('**/rest/v1/rekordbox_imports*', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(filterRowsById(route, imports)),
    });
  });

  // Tracks table
  await page.route('**/rest/v1/rekordbox_tracks*', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(filterRowsById(route, tracks)),
    });
  });

  // Playlists table
  await page.route('**/rest/v1/rekordbox_playlists*', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(filterRowsById(route, playlists)),
    });
  });

  // Playlist tracks join table
  await page.route('**/rest/v1/rekordbox_playlist_tracks*', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  // Waveform data
  await page.route('**/rest/v1/rekordbox_track_waveforms*', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(waveforms),
    });
  });

  // User settings
  await page.route('**/rest/v1/rekordbox_user_settings*', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  // RPC calls
  await page.route('**/rest/v1/rpc/**', async (route: Route) => {
    const functionName = new URL(route.request().url()).pathname.split('/').pop();
    const requestBody = route.request().postDataJSON?.() as Record<string, unknown> | undefined;
    let body: unknown = null;

    if (functionName === 'get_rekordbox_playlists_with_counts') {
      body = playlists.map((playlist) => ({ ...playlist, track_count: tracks.length }));
    } else if (functionName === 'get_rekordbox_library_track_page') {
      const offset = Number(requestBody?.p_offset ?? 0);
      const limit = Number(requestBody?.p_limit ?? 200);
      body = { items: tracks.slice(offset, offset + limit), total: tracks.length, offset, limit };
    } else if (functionName === 'get_rekordbox_playlist_track_page') {
      const offset = Number(requestBody?.p_offset ?? 0);
      const limit = Number(requestBody?.p_limit ?? 200);
      const items = tracks.map((track, index) => ({ position: index + 1, track }));
      body = { items: items.slice(offset, offset + limit), total: items.length, offset, limit };
    } else if (functionName === 'get_rekordbox_playlist_stats') {
      body = { track_count: tracks.length, total_duration_seconds: 780, average_bpm: 131, most_common_key: '8A' };
    } else if (functionName === 'get_rekordbox_library_stats') {
      body = {
        total_track_count: tracks.length,
        total_duration_seconds: 780,
        average_bpm: 131,
        most_common_bpm: 138,
        most_common_key: '8A',
        genre_totals: [{ name: 'Techno', count: 1 }, { name: 'House', count: 1 }],
        artist_totals: [{ name: 'Artist One', count: 1 }, { name: 'Artist Two', count: 1 }],
        bpm_totals: [{ bpm: 138, count: 1 }, { bpm: 124, count: 1 }],
        key_totals: [{ name: '8A', count: 1 }, { name: '8B', count: 1 }],
      };
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

}
