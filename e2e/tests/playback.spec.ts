/**
 * Playback E2E tests.
 *
 * Tests 2–4 from Prompt 10: play, rapid switch, stop.
 * Audio element is stubbed so no real decoding occurs.
 */

import { test, expect } from '../fixtures';
import { injectFakeUsb } from '../helpers/usb';
import { injectFakeSession, mockSupabaseRoutes, FAKE_TRACKS } from '../helpers/supabase';
import { injectAudioMocks } from '../helpers/audio';

// Minimal MP3 content for the fake USB file (not real audio — just non-empty bytes).
const FAKE_AUDIO_CONTENT = 'ID3\x03\x00\x00\x00\x00\x00\x00';

/**
 * Set up a connected page with two fake tracks available on USB.
 * Both tracks' file paths are served via the fake USB handle.
 */
async function setupConnectedPage(page: import('@playwright/test').Page) {
  await injectFakeSession(page);
  await injectAudioMocks(page);
  await mockSupabaseRoutes(page, { tracks: FAKE_TRACKS });
  // Files keyed by just the filename (last segment) — simulates flat resolution
  await injectFakeUsb(page, {
    volumeName: 'TESTUSB',
    structure: 'rekordbox',
    files: {
      'NightDrive.mp3': FAKE_AUDIO_CONTENT,
      'SunriseSet.mp3': FAKE_AUDIO_CONTENT,
    },
  });
  await page.goto('/');

  // Connect USB
  const connectBtn = page.getByRole('button', { name: /connect a rekordbox usb/i });
  await connectBtn.click();
  await expect(
    page.getByRole('button', { name: /connected.*TESTUSB/i }),
  ).toBeVisible({ timeout: 5000 });
}

// ── Test 2: Play a track ───────────────────────────────────────────────────────

test.describe('Track playback', () => {
  test('clicking play on a track makes it active', async ({ page }) => {
    await setupConnectedPage(page);

    // Find and click the play button for the first track ("Night Drive")
    const playBtn = page.getByRole('button', { name: /play Night Drive/i }).first();
    await expect(playBtn).toBeVisible({ timeout: 5000 });
    await playBtn.click();

    // After clicking play, the row should enter an active state (aria-label changes to Pause)
    await expect(
      page.getByRole('button', { name: /pause Night Drive/i }),
    ).toBeVisible({ timeout: 3000 });
  });
});

// ── Test 3: Rapid track switching ─────────────────────────────────────────────

test.describe('Rapid track switching', () => {
  test('last-clicked track wins when switching quickly', async ({ page }) => {
    await setupConnectedPage(page);

    // Click Night Drive then immediately click Sunrise Set
    const playA = page.getByRole('button', { name: /play Night Drive/i }).first();
    const playB = page.getByRole('button', { name: /play Sunrise Set/i }).first();

    await expect(playA).toBeVisible({ timeout: 5000 });
    await expect(playB).toBeVisible({ timeout: 5000 });

    // Click both in rapid succession (no await between)
    await playA.click();
    await playB.click();

    // Sunrise Set should be the active track — Night Drive should not be playing
    await expect(
      page.getByRole('button', { name: /pause Sunrise Set/i }),
    ).toBeVisible({ timeout: 5000 });

    // Night Drive must not show "Pause" (i.e., it lost the race)
    await expect(
      page.getByRole('button', { name: /pause Night Drive/i }),
    ).not.toBeVisible();
  });
});

// ── Test 4: Stop playback ──────────────────────────────────────────────────────

test.describe('Stop playback', () => {
  test('pausing a track returns it to play state', async ({ page }) => {
    await setupConnectedPage(page);

    const playBtn = page.getByRole('button', { name: /play Night Drive/i }).first();
    await expect(playBtn).toBeVisible({ timeout: 5000 });
    await playBtn.click();

    // Should now show "Pause"
    const pauseBtn = page.getByRole('button', { name: /pause Night Drive/i });
    await expect(pauseBtn).toBeVisible({ timeout: 3000 });

    await pauseBtn.click();

    // Should return to "Play"
    await expect(
      page.getByRole('button', { name: /play Night Drive/i }).first(),
    ).toBeVisible({ timeout: 3000 });
  });
});
