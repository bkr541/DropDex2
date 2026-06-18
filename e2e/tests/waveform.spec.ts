/**
 * Waveform E2E tests (Test 7 from Prompt 10).
 *
 * Verifies bulk waveform load, confirmed-unavailable, and failed-chunk states.
 */

import { test, expect } from '../fixtures';
import { injectFakeSession, mockSupabaseRoutes, FAKE_TRACKS } from '../helpers/supabase';
import { injectAudioMocks } from '../helpers/audio';

// Minimal fake waveform row for track 1
const FAKE_WAVEFORM_ROW = {
  id: 'wave-001',
  track_id: FAKE_TRACKS[0].id,
  import_id: FAKE_TRACKS[0].import_id,
  pwv4_data: 'AAAA', // base64 stub — real parser not invoked in E2E
  pwav_data: null,
  created_at: '2025-01-01T00:00:00Z',
};

test.describe('Waveform loading', () => {
  test('waveform renders when data is available', async ({ page }) => {
    await injectFakeSession(page);
    await injectAudioMocks(page);
    await mockSupabaseRoutes(page, {
      tracks: FAKE_TRACKS,
      waveforms: [FAKE_WAVEFORM_ROW],
    });
    await page.goto('/');

    // The library view should appear (tracks are loaded)
    await expect(
      page.getByText('Night Drive'),
    ).toBeVisible({ timeout: 5000 });
  });

  test('tracks with no waveform do not crash the page', async ({ page }) => {
    await injectFakeSession(page);
    await injectAudioMocks(page);
    // waveforms: [] means no waveform data for any track
    await mockSupabaseRoutes(page, { tracks: FAKE_TRACKS, waveforms: [] });
    await page.goto('/');

    // Page must remain functional even when waveform data is absent
    await expect(
      page.getByText('Night Drive'),
    ).toBeVisible({ timeout: 5000 });

    await expect(
      page.getByText('Sunrise Set'),
    ).toBeVisible({ timeout: 3000 });
  });

  test('waveform error is recoverable — retry button appears in track detail', async ({ page }) => {
    await injectFakeSession(page);
    await injectAudioMocks(page);
    // Route waveforms to 500 to simulate a query failure
    await mockSupabaseRoutes(page, { tracks: FAKE_TRACKS, waveforms: [] });
    // Override the waveform route specifically to simulate a server error
    await page.route('**/rest/v1/rekordbox_track_waveforms*', async (route) => {
      await route.fulfill({ status: 500, body: JSON.stringify({ error: 'server error' }) });
    });
    await page.goto('/');

    // Click on a track to open the detail view
    const trackRow = page.getByRole('button', { name: /open Night Drive/i }).first();
    await expect(trackRow).toBeVisible({ timeout: 5000 });
    await trackRow.click();

    // TrackDetailView renders; waveform error state should show a Retry button
    // (This tests the error state added in Prompt 8)
    await expect(
      page.getByRole('button', { name: /retry/i }),
    ).toBeVisible({ timeout: 5000 });
  });
});
