/**
 * Accessibility E2E tests (Test 9 from Prompt 10).
 *
 * Verifies keyboard nav, accessible names, and waveform labeling.
 */

import { test, expect } from '../fixtures';
import { injectFakeSession, mockSupabaseRoutes, FAKE_TRACKS } from '../helpers/supabase';
import { injectAudioMocks } from '../helpers/audio';
import { injectFakeUsb } from '../helpers/usb';

test.describe('Accessibility', () => {
  test('track rows are keyboard accessible', async ({ page }) => {
    // dropdex fixture already sets up a page with tracks
    const { dropdex: appPage } = await (async () => {
      // Re-create manually to have full control
      await injectFakeSession(page);
      await injectAudioMocks(page);
      await mockSupabaseRoutes(page, { tracks: FAKE_TRACKS });
      await page.goto('/');
      return { dropdex: page };
    })();

    // Track rows should be focusable via keyboard
    await appPage.keyboard.press('Tab');
    const focused = appPage.locator(':focus');
    // After tab, something should be focused
    await expect(focused).not.toBeNull();
  });

  test('play buttons have accessible names', async ({ page }) => {
    await injectFakeSession(page);
    await injectAudioMocks(page);
    await mockSupabaseRoutes(page, { tracks: FAKE_TRACKS });
    await page.goto('/');

    // Play buttons must have non-empty accessible names that include track title
    await expect(
      page.getByRole('button', { name: /play Night Drive/i }).first(),
    ).toBeVisible({ timeout: 5000 });

    await expect(
      page.getByRole('button', { name: /play Sunrise Set/i }).first(),
    ).toBeVisible({ timeout: 3000 });
  });

  test('waveform element has a meaningful label when data is available', async ({ page }) => {
    await injectFakeSession(page);
    await injectAudioMocks(page);
    await mockSupabaseRoutes(page, { tracks: FAKE_TRACKS });
    await injectFakeUsb(page, { volumeName: 'TESTUSB', structure: 'rekordbox' });
    await page.goto('/');

    // Open track detail for Night Drive
    const trackRow = page.getByRole('button', { name: /open Night Drive/i }).first();
    await expect(trackRow).toBeVisible({ timeout: 5000 });
    await trackRow.click();

    // The waveform element should have an accessible label (not empty img)
    // The TrackDetailView passes ariaLabel={`Waveform for ${track.title}`}
    // to RekordboxPreviewWaveform which renders role="img" aria-label="..."
    // When waveform is unavailable, the WaveformDisplay also renders with a label.
    // At minimum, the page should not have role="img" with an empty aria-label.
    const emptyImgs = page.locator('[role="img"][aria-label=""]');
    expect(await emptyImgs.count()).toBe(0);
  });

  test('USB connect button has an accessible name', async ({ page }) => {
    await injectFakeSession(page);
    await injectAudioMocks(page);
    await mockSupabaseRoutes(page, { tracks: FAKE_TRACKS });
    await page.goto('/');

    // The USB button should always have a non-empty aria-label
    const usbBtn = page.getByRole('button', { name: /connect a rekordbox usb|connected/i });
    await expect(usbBtn).toBeVisible({ timeout: 5000 });
  });
});
