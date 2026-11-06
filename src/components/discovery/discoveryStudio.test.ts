import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DiscoveryFeed } from '../../hooks/useDiscoveryFeed';
import type { FeedArtist } from '../../types';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const studioCss = read('../ui/studio.css');
const auditionCss = read('../audition/AuditionView.css');
const discoveryCss = read('./DiscoveryView.css');
const view = read('./DiscoveryView.tsx');

const artist = (id: string, name: string, over: Partial<FeedArtist> = {}): FeedArtist => ({
  id, name, normalized_name: name.toLowerCase(), profile_image_url: null, setlist_count: 1234,
  genres: [{ id: 'g1', name: 'Melodic Dubstep' }, { id: 'g2', name: 'Future Bass' }], ...over,
});

describe('Discovery uses the Audition look', () => {
  it('shares the Audition panel: same palette, gradient, radius and fonts', () => {
    for (const declaration of [
      '--color-primary: #f56b70;', '--color-ring: #f78361;', '--color-surface: #2b313e;', '--color-background: #1b1f28;',
      "font-family: 'Helvetica Neue', 'Segoe UI', Arial, sans-serif;",
      'background: linear-gradient(165deg, #292d37 0%, #20242e 36%, #191d25 100%);',
      'border-radius: 24px;', 'border: 1px solid #ffffff13;',
      'box-shadow: inset 0 1px 0 #ffffff06, 0 16px 40px #00000026;',
    ]) {
      expect(studioCss).toContain(declaration);
      expect(auditionCss).toContain(declaration);
    }
  });

  it('never goes below 9px type, like Audition', () => {
    for (const css of [studioCss, discoveryCss]) {
      const sizes = [...css.matchAll(/font-size: (\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1]));
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(9);
    }
  });

  it('is one panel: header band, genre band, then a body that scrolls', () => {
    expect(view).toContain('className="studio discovery-studio');
    expect(view.indexOf('data-testid="discovery-header"')).toBeLessThan(view.indexOf('<GenreBrowser'));
    expect(view.indexOf('<GenreBrowser')).toBeLessThan(view.indexOf('data-testid="discovery-body"'));
    expect(studioCss).toMatch(/\.studio-body \{[^}]*overflow-y: auto/);
  });

  it('fits the window like Audition and keeps the scrollbar inside the panel', () => {
    expect(studioCss).toMatch(/\.studio \{[^}]*height: calc\(100vh - 3rem - var\(--page-header-height, 0px\)\)/);
    expect(read('../../App.tsx')).toContain("currentView === 'discovery') && 'scrollbar-none'");
  });

  it('shows totals as figures over labels, like the Audition header', () => {
    expect(view).toContain('<div className="studio-stat"><span>');
    for (const label of ['Genres', 'Top artists', 'Sets']) expect(view).toContain(`<small>${label}</small>`);
    expect(studioCss).toMatch(/\.studio-stat > span \{[^}]*font-size: 20px[^}]*font-weight: 300/);
  });

  it('uses no filled pills or cards for genres: underlined tabs with a coral underline when picked', () => {
    const genres = read('./GenreBrowser.tsx');
    expect(genres).not.toContain('rounded-full');
    expect(discoveryCss).toMatch(/\.discovery-genre-tab\[aria-pressed="true"\] \{[^}]*border-bottom-color: #f56b70/);
  });
});

describe('Discovery pieces', () => {
  it('lists the top artists as a table with the Audition-style headings', async () => {
    const { DiscoveryHomeFeed } = await import('./DiscoveryHomeFeed');
    const feed: DiscoveryFeed = {
      artists: [artist('a1', 'Alpha Artist'), artist('a2', 'Beta Artist')],
      setlistsByArtist: new Map([['a1', [{ id: 's1', title: 'Main Stage 2025', set_date: '2025-06-01', completion_pct: 80.4 } as never]]]),
      loading: false, error: null, retry: vi.fn(),
    };
    const markup = renderToStaticMarkup(createElement(DiscoveryHomeFeed, { feed, onSelectArtist: vi.fn(), onOpenSetlist: vi.fn() }));
    expect(markup).toContain('class="studio-table"');
    for (const heading of ['Top artists', 'Sets', 'Latest setlists']) expect(markup).toContain(`>${heading}</th>`);
    // Genres sit under the artist's name, which is a large photo and a 14px name.
    expect(markup).toContain('studio-avatar studio-avatar--lg');
    expect(markup).toMatch(/class="discovery-feed-name">Alpha Artist<\/p><p class="discovery-feed-genres">Melodic Dubstep · Future Bass</);
    expect(markup.match(/data-testid="discovery-feed-row"/g)).toHaveLength(2);
    expect(markup).toContain('Melodic Dubstep · Future Bass');
    expect(markup).toContain('1,234');
    expect(markup).toContain('Main Stage 2025');
    expect(markup).toContain('2025-06-01 · 80%');
    // The second artist's setlists are still loading.
    expect(markup).toContain('discovery-skeleton');
  });

  it('says plainly when the top artists could not be loaded, and offers to try again', async () => {
    const { DiscoveryHomeFeed } = await import('./DiscoveryHomeFeed');
    const feed: DiscoveryFeed = { artists: [], setlistsByArtist: new Map(), loading: false, error: 'The top artists could not be loaded.', retry: vi.fn() };
    const markup = renderToStaticMarkup(createElement(DiscoveryHomeFeed, { feed, onSelectArtist: vi.fn(), onOpenSetlist: vi.fn() }));
    expect(markup).toContain('The top artists could not be loaded.');
    expect(markup).toContain('Try again');
  });

  it('shows genres as tabs with their artist counts, highlighted ones first', async () => {
    const { GenreBrowser } = await import('./GenreBrowser');
    const markup = renderToStaticMarkup(createElement(GenreBrowser, {
      genres: [{ id: '1', name: 'Trap', artistCount: 9 }, { id: '2', name: 'Future Bass', artistCount: 4 }],
      loading: false, error: null, onRetry: vi.fn(), selectedGenreId: '1', onSelectGenre: vi.fn(),
    }));
    expect(markup.indexOf('Future Bass')).toBeLessThan(markup.indexOf('Trap'));
    expect(markup).toContain('discovery-genre-tab discovery-genre-tab--highlight');
    expect(markup).toMatch(/aria-pressed="true"[^>]*>Trap<small>9<\/small>/);
  });

  it('puts every genre in one row that scrolls sideways, with All first and a Clear button while one is picked', async () => {
    const { GenreBrowser } = await import('./GenreBrowser');
    const props = { genres: [{ id: '1', name: 'Trap', artistCount: 9 }, { id: '2', name: 'House', artistCount: 4 }], loading: false, error: null, onRetry: vi.fn(), onSelectGenre: vi.fn() };
    const none = renderToStaticMarkup(createElement(GenreBrowser, { ...props, selectedGenreId: null }));
    expect(none).toContain('data-testid="genre-scroll-row"');
    expect(none).toMatch(/aria-pressed="true" class="discovery-genre-tab">All</);
    expect(none).not.toContain('Clear genre filter');
    expect(none).not.toContain('Show all');
    const picked = renderToStaticMarkup(createElement(GenreBrowser, { ...props, selectedGenreId: '2' }));
    expect(picked).toContain('aria-label="Clear genre filter"');
    expect(picked).toMatch(/aria-pressed="false" class="discovery-genre-tab">All</);
    const source = read('./GenreBrowser.tsx');
    expect(source).toContain("addEventListener('wheel'");
    expect(source).toContain('Scroll genres right');
    expect(discoveryCss).toMatch(/\.discovery-genre-tabs \{[^}]*overflow-x: auto/);
    expect(discoveryCss).not.toContain('--wrap');
  });

  it('has a Back to Artist Discovery button on the artist page that returns to where the artist was picked', () => {
    const page = read('./ArtistPage.tsx');
    expect(page).toContain('aria-label="Back to Artist Discovery"');
    expect(page.indexOf('data-testid="artist-back"')).toBeLessThan(page.indexOf('<ArtistHero'));
    expect(view).toContain('onBack={handleBackFromArtist}');
    expect(view).toContain('setSelectedGenreId(genreBeforeArtist)');
    expect(view).toContain('setGenreBeforeArtist(selectedGenreId)');
  });

  it('shows search results as rows, with the alias as supporting text', async () => {
    const { ArtistSearchResults } = await import('./ArtistSearchResults');
    const markup = renderToStaticMarkup(createElement(ArtistSearchResults, {
      results: [{ id: 'x', name: 'Xander', normalized_name: 'xander', matched_alias: 'X-Man', profile_image_url: null }],
      onSelect: vi.fn(), query: 'xa',
    }));
    expect(markup).toContain('discovery-row');
    expect(markup).toContain('aka X-Man');
    expect(markup).toContain('1 artist');
  });

  it('logs the feed failures under the Discovery prefix', () => {
    const hook = read('../../hooks/useDiscoveryFeed.ts');
    expect(hook).toContain("logger.error('discovery.feed.load_failed'");
    expect(hook).toContain("logger.warn('discovery.feed.setlists_failed'");
  });
});
