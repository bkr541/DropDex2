import { test, expect } from '../fixtures';
import {
  injectFakeSession,
  mockSupabaseRoutes,
  FAKE_TRACKS,
} from '../helpers/supabase';
import { injectAudioMocks } from '../helpers/audio';

function waveformRow(trackIndex: number, overrides: Record<string, unknown> = {}) {
  const track = FAKE_TRACKS[trackIndex];
  return {
    id: `wave-${trackIndex + 1}`,
    track_id: track.id,
    import_id: track.import_id,
    preview_format: 'color',
    preview_column_count: 3,
    preview_columns: [
      { h: 20, r: 30, g: 100, b: 220 },
      { h: 80, r: 80, g: 180, b: 240 },
      { h: 45, r: 40, g: 120, b: 230 },
    ],
    detail_format: null,
    detail_column_count: null,
    detail_storage_bucket: null,
    detail_storage_path: null,
    parser_version: '1.0',
    ...overrides,
  };
}

async function setupPage(page: Parameters<typeof injectFakeSession>[0], waveforms: Record<string, unknown>[] = []) {
  await injectFakeSession(page);
  await injectAudioMocks(page);
  await mockSupabaseRoutes(page, { tracks: FAKE_TRACKS, waveforms });
}

test.describe('Waveform loading and error states', () => {
  test('a valid waveform reaches loaded state', async ({ page }) => {
    await setupPage(page, [waveformRow(0), waveformRow(1)]);
    await page.goto('/');

    await expect(page.getByText('Night Drive')).toBeVisible({ timeout: 5000 });
    for (const track of FAKE_TRACKS) {
      await expect(
        page.locator(`[data-waveform-status="loaded"][data-waveform-track-id="${track.id}"]:visible`),
      ).toHaveCount(1);
    }
  });

  test('a track with no waveform record reaches unavailable state', async ({ page }) => {
    await setupPage(page, []);
    await page.goto('/');

    await expect(page.getByText('Night Drive')).toBeVisible({ timeout: 5000 });
    for (const track of FAKE_TRACKS) {
      await expect(
        page.locator(`[data-waveform-status="unavailable"][data-waveform-track-id="${track.id}"]:visible`),
      ).toHaveCount(1);
    }
  });

  test('invalid waveform schema is presented separately from unavailable', async ({ page }) => {
    await setupPage(page, [
      waveformRow(0, { preview_column_count: 1, preview_columns: [{ broken: true }] }),
      waveformRow(1),
    ]);
    await page.goto('/');

    await expect(
      page.locator(`[data-waveform-status="invalid"][data-waveform-track-id="${FAKE_TRACKS[0].id}"]:visible`),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator(`[data-waveform-status="unavailable"][data-waveform-track-id="${FAKE_TRACKS[0].id}"]:visible`),
    ).toHaveCount(0);
  });

  test('network failure shows Retry and retry can load the waveform', async ({ page }) => {
    await setupPage(page, []);
    let waveformRequests = 0;
    await page.route('**/rest/v1/rekordbox_track_waveforms*', async (route) => {
      waveformRequests += 1;
      if (waveformRequests === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'waveform service unavailable' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([waveformRow(0), waveformRow(1)]),
      });
    });
    await page.goto('/');

    const trackRow = page.getByRole('button', { name: /open Night Drive/i }).first();
    await expect(trackRow).toBeVisible({ timeout: 5000 });
    await trackRow.click();

    const retry = page.getByRole('button', { name: 'Retry waveform' });
    await expect(retry).toBeVisible({ timeout: 5000 });
    await retry.click();

    await expect(
      page.getByRole('img', { name: 'Waveform for Night Drive' }),
    ).toBeVisible({ timeout: 5000 });
    expect(waveformRequests).toBeGreaterThanOrEqual(2);
  });

  test('late Track A response cannot replace selected Track B waveform', async ({ page }) => {
    await setupPage(page, []);
    const trackA = FAKE_TRACKS[0];
    const trackB = FAKE_TRACKS[1];

    await page.route('**/rest/v1/rekordbox_track_waveforms*', async (route) => {
      const decodedUrl = decodeURIComponent(route.request().url());
      const hasA = decodedUrl.includes(trackA.id);
      const hasB = decodedUrl.includes(trackB.id);

      if (hasA && hasB) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([waveformRow(0), waveformRow(1)]),
        });
        return;
      }

      if (hasA) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([waveformRow(0)]),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(hasB ? [waveformRow(1)] : []),
      });
    });

    await page.goto('/');
    await expect(page.getByRole('button', { name: /open Night Drive/i }).first()).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: /open Night Drive/i }).first().click();
    await expect(page.getByRole('heading', { name: 'Night Drive' })).toBeVisible();
    await expect(
      page.locator(`[data-waveform-status="loading"][data-waveform-track-id="${trackA.id}"]:visible`),
    ).toBeVisible();
    await page.getByRole('heading', { name: 'Track Intelligence' }).locator('..').getByRole('button').click();

    await page.getByRole('button', { name: /open Sunrise Set/i }).first().click();
    await expect(page.getByRole('heading', { name: 'Sunrise Set' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Waveform for Sunrise Set' })).toBeVisible({ timeout: 5000 });

    await page.waitForTimeout(1400);
    await expect(page.getByRole('heading', { name: 'Sunrise Set' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Waveform for Sunrise Set' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Waveform for Night Drive' })).toHaveCount(0);
  });
});
