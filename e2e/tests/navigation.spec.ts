import { test, expect, type Page } from '@playwright/test';
import { injectAudioMocks } from '../helpers/audio';
import {
  FAKE_IMPORT_ID,
  FAKE_PLAYLISTS,
  FAKE_TRACKS,
  injectFakeSession,
  mockSupabaseRoutes,
} from '../helpers/supabase';

async function prepare(page: Page): Promise<void> {
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
  await injectFakeSession(page);
  await injectAudioMocks(page);
  await mockSupabaseRoutes(page, { tracks: FAKE_TRACKS });
}

const trackUrl = `/tracks/${FAKE_TRACKS[0].id}`;
const playlistUrl = `/playlists/${FAKE_PLAYLISTS[0].id}`;
const importUrl = `/imports/${FAKE_IMPORT_ID}`;
const dropLabUrl = `/drop-lab/${FAKE_TRACKS[0].id}?candidate=${FAKE_TRACKS[1].id}`;

test.describe('durable navigation and recovery', () => {
  test('refresh restores selected track, playlist, import, and Drop Lab routes', async ({ page }) => {
    await prepare(page);

    await page.goto(trackUrl);
    await expect(page.getByRole('heading', { name: 'Night Drive' }).first()).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(trackUrl);
    await expect(page.getByRole('heading', { name: 'Night Drive' }).first()).toBeVisible();

    await page.goto(playlistUrl);
    await expect(page.getByRole('heading', { name: 'Peak Time' }).first()).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(playlistUrl);
    await expect(page.getByRole('heading', { name: 'Peak Time' }).first()).toBeVisible();

    await page.goto(importUrl);
    await expect(page.getByTestId('import-status-screen')).toContainText('exportLibrary.db');
    await page.reload();
    await expect(page).toHaveURL(importUrl);
    await expect(page.getByTestId('import-status-screen')).toContainText('exportLibrary.db');

    await page.goto(dropLabUrl);
    await expect(page.getByRole('heading', { name: 'Drop Lab' })).toBeVisible();
    await expect(page.getByText('Night Drive', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Sunrise Set', { exact: true }).first()).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(dropLabUrl);
    await expect(page.getByRole('heading', { name: 'Drop Lab' })).toBeVisible();
    await expect(page.getByText('Night Drive', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Sunrise Set', { exact: true }).first()).toBeVisible();
  });

  test('browser Back and Forward restore multiple DropDex screens', async ({ page }) => {
    await prepare(page);
    await page.goto('/library');
    await expect(page.getByText('Night Drive', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Review', exact: true }).first().click();
    await expect(page).toHaveURL('/review');
    await expect(page.getByRole('heading', { name: 'Set Review Mode' })).toBeVisible();

    await page.getByRole('button', { name: 'Discover', exact: true }).first().click();
    await expect(page).toHaveURL('/discovery');
    await expect(page.getByRole('heading', { name: 'Artist Discovery' })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL('/review');
    await expect(page.getByRole('heading', { name: 'Set Review Mode' })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL('/library');
    await expect(page.getByText('Night Drive', { exact: true }).first()).toBeVisible();

    await page.goForward();
    await expect(page).toHaveURL('/review');
    await page.goForward();
    await expect(page).toHaveURL('/discovery');
    await expect(page.getByRole('heading', { name: 'Artist Discovery' })).toBeVisible();
  });

  test('direct navigation to a missing or unauthorized entity shows a recovery state', async ({ page }) => {
    await prepare(page);
    await page.goto('/tracks/missing-or-unauthorized-track');

    await expect(page.getByRole('heading', { name: 'This DropDex item is unavailable' })).toBeVisible();
    await expect(page.getByText(/deleted, belong to another account/i)).toBeVisible();
    await page.getByRole('button', { name: 'Return to Library' }).click();
    await expect(page).toHaveURL('/library');
    await expect(page.getByText('Night Drive', { exact: true }).first()).toBeVisible();
  });

  test('lazy screens show a visible Suspense fallback', async ({ page }) => {
    await prepare(page);
    await page.route('**/assets/DiscoveryView-*.js', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 900));
      await route.continue();
    });

    await page.goto('/discovery');
    await expect(page.getByRole('status')).toContainText('Loading Discovery…');
    await expect(page.getByRole('heading', { name: 'Artist Discovery' })).toBeVisible();
  });

  test('route render failures are contained and can return to the Library', async ({ page }) => {
    await prepare(page);
    await page.goto('/review?__testRouteError=1');

    await expect(page.getByRole('heading', { name: 'DropDex hit an unexpected error' })).toBeVisible();
    await page.getByRole('button', { name: 'Return to Library' }).click();
    await expect(page).toHaveURL('/library');
    await expect(page.getByText('Night Drive', { exact: true }).first()).toBeVisible();
  });

  test('root render failures are contained and can reload a working route', async ({ page }) => {
    await prepare(page);
    await page.goto('/library?__testRootError=1');

    await expect(page.getByRole('heading', { name: 'DropDex hit an unexpected error' })).toBeVisible();
    await page.getByRole('button', { name: 'Return to Library' }).click();
    await expect(page).toHaveURL('/library');
    await expect(page.getByText('Night Drive', { exact: true }).first()).toBeVisible();
  });

  test('a stale lazy chunk triggers at most one automatic reload and then offers recovery', async ({ page }) => {
    await prepare(page);
    let documentRequests = 0;
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        documentRequests += 1;
      }
    });
    await page.route('**/assets/DiscoveryView-*.js', async (route) => {
      await route.abort('failed');
    });

    await page.goto('/discovery');
    await expect(page.getByRole('heading', { name: 'This screen could not be updated' })).toBeVisible({ timeout: 15_000 });
    expect(documentRequests).toBe(2);

    await page.getByRole('button', { name: 'Return to Library' }).click();
    await expect(page).toHaveURL('/library');
    await expect(page.getByText('Night Drive', { exact: true }).first()).toBeVisible();
  });
});
