import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TrackListing } from './TrackListing';

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');

describe('track details window', () => {
  const tracks = [{ id: 't1', title: 'Pop Lock And Drop It' }];
  const base = { tracks, columns: [], getTitle: (t: { title: string }) => t.title, getArtist: () => 'Sidequest', getStatus: () => 'none' as const };

  it('puts the Actions column in and shows the leading icon first, even when a screen turns its own actions off', () => {
    const html = renderToStaticMarkup(createElement(TrackListing as unknown as React.ComponentType<Record<string, unknown>>, { ...base, actions: false, leadingActions: () => createElement('button', { 'data-testid': 'lead' }, 'i') }));
    expect(html).toContain('Actions');
    expect(html).toContain('data-testid="lead"');
  });

  it('keeps a screen\'s own action icons after the leading one', () => {
    const html = renderToStaticMarkup(createElement(TrackListing as unknown as React.ComponentType<Record<string, unknown>>, { ...base, actions: () => createElement('button', { 'data-testid': 'own' }, 'x'), leadingActions: () => createElement('button', { 'data-testid': 'lead' }, 'i') }));
    expect(html.indexOf('data-testid="lead"')).toBeLessThan(html.indexOf('data-testid="own"'));
  });

  it('is opened from every RecordTrackListing and slides in from the right of the app', () => {
    const listing = read('./RecordTrackListing.tsx');
    expect(listing).toContain('<TrackDetailsSheet');
    expect(listing).toContain('aria-label={`Details for ${track.title}`}');
    const sheet = read('./TrackDetailsSheet.tsx');
    expect(sheet).toContain('placement="right"');
    expect(sheet).toContain('createPortal(');
    for (const part of ['fetchTrackCues', 'fetchTrackPlaylists', 'fetchTrackBeatGrid', 'fetchTrackPhrases']) expect(sheet).toContain(part);
    expect(sheet).toContain('logger.error(`library.trackdetails.');
  });
});
