import { describe, expect, it } from 'vitest';
import { homeFeedState } from './homeFeedState';

const artists = [{ id: 'a' }, { id: 'b' }] as never[];
const feed = (over: Record<string, unknown> = {}) => ({ loading: false, error: null, artists, setlistsByArtist: new Map([['a', []], ['b', []]]), ...over }) as never;

describe('Discovery home settles in one step', () => {
  it('waits for the feed, the genre catalog and the personal rows', () => {
    expect(homeFeedState(feed({ loading: true }), { loading: false }, false, 5).pending).toBe(true);
    expect(homeFeedState(feed(), { loading: false }, true, 0).pending).toBe(true);
    expect(homeFeedState(feed(), { loading: true }, false, 5).pending).toBe(true);
    expect(homeFeedState(feed(), { loading: false }, false, 5).pending).toBe(false);
  });

  it('keeps waiting while the catalog is still on its way, even though the personal rows have not started', () => {
    // The feed often arrives first. Without this the feed would show, then the personal rows would push it down.
    expect(homeFeedState(feed(), { loading: true }, true, 0).pending).toBe(true);
  });

  it('does not wait forever for personal rows that cannot start because the catalog is empty', () => {
    expect(homeFeedState(feed(), { loading: true }, false, 0).pending).toBe(false);
  });

  it('knows when a top artist\'s latest sets are still arriving', () => {
    expect(homeFeedState(feed({ setlistsByArtist: new Map([['a', []]]) }), { loading: false }, false, 5).setlistsPending).toBe(true);
    expect(homeFeedState(feed(), { loading: false }, false, 5).setlistsPending).toBe(false);
    expect(homeFeedState(feed({ error: 'x', setlistsByArtist: new Map() }), { loading: false }, false, 5).setlistsPending).toBe(false);
  });
});
