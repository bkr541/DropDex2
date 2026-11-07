import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LibraryTabBar } from './LibraryTabBar';
import { ArtistsPanel, GenresPanel, PlaylistsPanel } from './LibraryTabPanels';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
const reviewSource = read('./ReviewView.tsx');
const libraryViewSource = read('./LibraryView.tsx');
const appSource = read('../../App.tsx');
const cueSource = read('../cues/CuePointsView.tsx');

describe('Review tabs', () => {
  it('offers the Library tabs in the same order, without Overview and Analysis Incomplete', async () => {
    const { reviewTabs } = await import('./reviewTabs');
    expect(reviewTabs(false).map((tab) => tab.label)).toEqual(['Playlists', 'Recently Added', 'Tracks', 'Genres', 'Artists']);
  });

  it('adds Spotify after Artists only when the account can show playlists', async () => {
    const { reviewTabs } = await import('./reviewTabs');
    expect(reviewTabs(true).map((tab) => tab.label)).toEqual(['Playlists', 'Recently Added', 'Tracks', 'Genres', 'Artists', 'Spotify']);
    expect(reviewTabs(null).map((tab) => tab.id)).not.toContain('spotify');
  });

  it('starts on Tracks, and keeps the Tracks table mounted so its filters survive a tab change', () => {
    expect(reviewSource).toContain("useState<ReviewTab>('tracks')");
    expect(reviewSource).toContain('data-testid="review-tracks-panel"');
    expect(reviewSource).toContain("activeTab === 'tracks' ? undefined : 'hidden'");
  });

  it('shows each tab with its own panel; the Library page no longer has these tabs', () => {
    expect(reviewSource).toContain('<PlaylistsPanel');
    expect(reviewSource).toContain('<GenresPanel');
    expect(reviewSource).toContain('<ArtistsPanel');
    expect(reviewSource).toContain('<RecentlyAddedPanel');
    expect(reviewSource).toContain('<SpotifyLibraryTab');
    expect(libraryViewSource).not.toContain('<PlaylistsPanel');
    expect(libraryViewSource).not.toContain('<GenresPanel');
    expect(libraryViewSource).not.toContain('<ArtistsPanel');
    expect(libraryViewSource).not.toContain('<RecentlyAddedPanel');
    expect(libraryViewSource).not.toContain('<LibraryTabBar');
    expect(reviewSource).toContain('<LibraryTabBar');
  });

  it('falls back to Tracks if the Spotify tab disappears while it is open', () => {
    expect(reviewSource).toContain("if (spotifyAvailable === false && activeTab === 'spotify') setActiveTab('tracks')");
  });
});

describe('Review page name and header row', () => {
  it('is named after the artist, with a plain fallback', () => {
    expect(appSource).toContain("case 'review': return titledPage(`${userProfile?.display_name?.trim() || 'My'} Library`);");
    expect(appSource).not.toContain("titledPage('Review')");
  });

  it('no longer has the Tracks heading and count row inside the Review table', () => {
    expect(cueSource).not.toContain('<Music size={13} /> Tracks</h2>');
  });

  it('passes the Library data the new tabs need', () => {
    for (const prop of ['playlistsLoading', 'playlistProfilesByRbId', 'recentTracks', 'recentTracksLoading', 'spotifyAccessToken', 'onPlaylistClick', 'onEditPlaylist']) {
      expect(appSource).toMatch(new RegExp(`<ReviewView[\\s\\S]*?${prop}=\\{`));
    }
  });
});

describe('LibraryTabBar', () => {
  const tabs = [
    { id: 'a', label: 'Alpha' },
    { id: 'b', label: 'Bravo' },
    { id: 'c', label: 'Charlie', disabled: true },
  ];
  const render = () => renderToStaticMarkup(createElement(LibraryTabBar<string>, { tabs, activeTab: 'b', onChange: vi.fn() }));

  it('renders the underlined tab row with a coral underline on the active tab', () => {
    const markup = render();
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('class="lib-tabs"');
    expect(markup.match(/role="tab"/g)).toHaveLength(3);
    expect(markup).toMatch(/aria-selected="true"[^>]*>Bravo/);
    expect(markup).toMatch(/class="lib-tab"[^>]*aria-selected="true"[^>]*>Bravo|aria-selected="true"[^>]*class="lib-tab"[^>]*>Bravo/);
    expect(markup).toMatch(/aria-selected="false"[^>]*>Alpha/);
  });

  it('dims and disables a tab that cannot be opened', () => {
    expect(render()).toMatch(/disabled=""[^>]*>Charlie/);
    expect(readFileSync(resolve(__dirname, 'library-studio.css'), 'utf8')).toMatch(/\.lib-tab:disabled \{[^}]*cursor: not-allowed/);
  });
});

describe('Library tab icons', () => {
  it('shows an icon to the left of each tab label', () => {
    const markup = renderToStaticMarkup(createElement(LibraryTabBar<string>, {
      tabs: [{ id: 'a', label: 'Alpha', icon: () => createElement('svg', { 'data-testid': 'icon-a' }) }, { id: 'b', label: 'Bravo' }],
      activeTab: 'a', onChange: vi.fn(),
    }));
    expect(markup.indexOf('data-testid="icon-a"')).toBeGreaterThan(-1);
    expect(markup.indexOf('data-testid="icon-a"')).toBeLessThan(markup.indexOf('Alpha'));
    expect(markup).toContain('class="lib-tab"');
  });

  it('gives every Library and Review tab its own icon', async () => {
    const { LIBRARY_TABS, SPOTIFY_TAB } = await import('./LibraryView');
    const { reviewTabs } = await import('./reviewTabs');
    for (const tab of [...LIBRARY_TABS, SPOTIFY_TAB]) expect(tab.icon, tab.id).toBeTruthy();
    expect(new Set([...LIBRARY_TABS, SPOTIFY_TAB].map((tab) => tab.icon)).size).toBe(LIBRARY_TABS.length + 1);
    for (const tab of reviewTabs(true)) expect(tab.icon, tab.id).toBeTruthy();
  });
});

describe('Library tab panels', () => {
  it('shows the Genres tab with its count and a bar for each genre', () => {
    const markup = renderToStaticMarkup(createElement(GenresPanel, { genreStats: [['House', 40], ['Techno', 20]], loading: false }));
    expect(markup).toContain('2 genres');
    expect(markup).toContain('House');
    expect(markup).toContain('width:100%');
    expect(markup).toContain('width:50%');
  });

  it('shows the Artists tab with its count and each artist\'s initial', () => {
    const markup = renderToStaticMarkup(createElement(ArtistsPanel, { artistStats: [['Nurko', 12]], loading: false }));
    expect(markup).toContain('1 artists');
    expect(markup).toContain('Nurko');
    expect(markup).toContain('>N<');
  });

  it('shows plain loading and empty messages', () => {
    expect(renderToStaticMarkup(createElement(GenresPanel, { genreStats: [], loading: true }))).toContain('Loading…');
    expect(renderToStaticMarkup(createElement(GenresPanel, { genreStats: [], loading: false }))).toContain('No genre data in this library.');
    expect(renderToStaticMarkup(createElement(ArtistsPanel, { artistStats: [], loading: false }))).toContain('No artist data in this library.');
    expect(renderToStaticMarkup(createElement(PlaylistsPanel, { playlists: [], loading: false, profilesByRbId: new Map(), onPlaylistClick: vi.fn(), onEditPlaylist: vi.fn() })))
      .toContain('No playlists in this import.');
  });
});
