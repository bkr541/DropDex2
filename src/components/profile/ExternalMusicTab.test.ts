import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ExternalMusicTab } from './ExternalMusicTab';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/api/externalAccounts', () => ({
  fetchSpotifyPlaylists: vi.fn(), fetchSpotifyPlaylistTracks: vi.fn(),
  beginSpotifyAccountLink: vi.fn(), fetchSpotifyAccountStatus: vi.fn(), unlinkSpotifyAccount: vi.fn(),
}));
vi.mock('../../lib/api/soundcloud', () => ({ fetchIlleniumTrackTitles: vi.fn() }));

describe('External Music', () => {
  it('starts with two accessible service cards instead of loading either data view', () => {
    const markup = renderToStaticMarkup(createElement(ExternalMusicTab, { accessToken: 'test-token' }));
    expect(markup).toContain('External Music services');
    expect(markup.match(/<button /g)).toHaveLength(2);
    expect(markup).toContain('aria-label="View SoundCloud information"');
    expect(markup).toContain('aria-label="View Spotify information"');
    expect(markup).not.toContain('Loading tracks');
    expect(markup).not.toContain('Your Spotify Playlists');
  });
});
