import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDiscoveryScrapeJob, searchDiscoveryArtists } from './discovery';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('discovery API contracts', () => {
  it('forwards cancellation signals to discovery requests', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      return new Response(JSON.stringify([{
        id: 'artist-1',
        name: 'Artist',
        normalized_name: 'artist',
        matched_alias: null,
        profile_image_url: null,
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchDiscoveryArtists('Artist', 'token', controller.signal))
      .resolves.toHaveLength(1);
  });

  it('rejects malformed successful responses before they reach UI state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      job_id: 'job-1',
      artist_id: 'artist-1',
      artist_name: null,
      source: '1001tracklists',
      status: 'teleporting',
      pages_scraped: 0,
      results_found: 0,
      total_results_reported: null,
      error_message: null,
      created_at: null,
      started_at: null,
      completed_at: null,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    await expect(fetchDiscoveryScrapeJob('job-1', 'token'))
      .rejects.toThrow('unexpected scrape job response');
  });
});
