import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SoundCloudTab } from './SoundCloudTab';

vi.mock('../../lib/api/soundcloud', () => ({ fetchSoundCloudFavoriteArtists: vi.fn(() => new Promise(() => undefined)), fetchSoundCloudArtistTrackTitles: vi.fn() }));

const source = readFileSync(resolve(__dirname, 'SoundCloudTab.tsx'), 'utf8');

describe('SoundCloud favorite artists', () => {
  it('opens on the artist level: a Back to External Music control and a loading state, with no search started', () => {
    const markup = renderToStaticMarkup(createElement(SoundCloudTab, { accessToken: 't', onBackToServices: vi.fn() }));
    expect(markup).toContain('aria-label="Back to External Music"');
    expect(markup).toContain('Your Favorite Artists');
    expect(markup).toContain('Loading your favorite artists');
    expect(markup).not.toContain('Back to Artists');
  });

  it('has an artist card per artist, a results level with Back to Artists, and every state', () => {
    expect(source).toContain('artists.map((artist) =>');
    expect(source).toContain('aria-label="Back to Artists"');
    expect(source).toContain('onClick={() => setSelected(null)}');
    expect(source).toContain('SoundCloud / {selected.name}');
    for (const state of ['No favorite artists yet', 'No tracks found', 'SoundCloud search failed', 'Favorite artists failed to load', 'Retry']) expect(source).toContain(state);
  });

  it('searches only the opened artist, lazily, cancels it on leaving or switching, and reuses results', () => {
    expect(source).toContain('if (!selected || !accessToken) return undefined;');
    expect(source).toContain('fetchSoundCloudArtistTrackTitles(accessToken, selected.id, controller.signal)');
    expect(source).toContain('if (controller.signal.aborted) return;');
    expect(source).toContain('return () => controller.abort();');
    expect(source).toContain('cache.current.get(selected.id)');
    expect(source).not.toMatch(/Promise\.all|artists\.forEach/);
    expect(source.toLowerCase()).not.toContain('illenium');
  });
});
