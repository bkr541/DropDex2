import { test, expect, type Page } from '@playwright/test';
import { injectAudioMocks } from '../helpers/audio';
import { FAKE_TRACKS, injectFakeSession, mockSupabaseRoutes } from '../helpers/supabase';

async function prepare(page: Page): Promise<void> {
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
  await injectFakeSession(page);
  await injectAudioMocks(page);
  await mockSupabaseRoutes(page, { tracks: FAKE_TRACKS });
}

function card(page: Page, label: string) {
  return page.locator(`[data-stage4-card="${label}"]`);
}

const STAGE4_LABELS = [
  'Glass Card',
  'Surface Card',
  'Stat Tile / KPI',
  'Playlist Card',
  'Artwork / Thumbnail',
  'Artwork With Fallback',
  'Avatar — Initials',
  'Avatar — Icon Fallback',
  'Avatar With Ring',
  'Image Avatar',
  'Headings',
  'Body & Muted Text',
  'Mono / Code Text',
  'Brand / Accent Text',
  'Brand Gradient Text',
  'Divider',
  'Sidebar Nav Items',
  'Tab Navigation',
] as const;

test.describe('Reusable Components Stage 4', () => {
  test.beforeEach(async ({ page }) => {
    await prepare(page);
    await page.goto('/reusable-components');
    await expect(page.getByTestId('stage4-component-board')).toBeVisible();
  });

  test('real application route renders all four accepted stages and every Stage 4 family', async ({ page }) => {
    await expect(page).toHaveURL('/reusable-components');
    await expect(page.getByTestId('stage1-component-board')).toBeVisible();
    await expect(page.getByTestId('stage2-component-board')).toBeVisible();
    await expect(page.getByTestId('stage3-component-board')).toBeVisible();
    await expect(page.getByTestId('stage4-component-board')).toBeVisible();
    await expect(page.locator('aside nav').getByRole('button', { name: 'Reusable Components' })).toHaveAttribute('aria-current', 'page');

    for (const label of STAGE4_LABELS) {
      await expect(card(page, label)).toBeVisible();
    }
  });

  test('artwork uses a real image, broken artwork becomes fallback, and avatar fallbacks remain safe', async ({ page }) => {
    const loadedArtwork = card(page, 'Artwork / Thumbnail').locator('.dd-artwork');
    await expect(loadedArtwork).toHaveAttribute('data-artwork-state', 'image');
    const image = loadedArtwork.getByRole('img', { name: 'Neon mountain artwork' });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);

    const brokenArtwork = card(page, 'Artwork With Fallback').locator('.dd-artwork');
    await expect(brokenArtwork).toHaveAttribute('data-artwork-state', 'fallback');
    await expect(brokenArtwork.getByText('No Artwork')).toBeVisible();
    await expect(brokenArtwork.getByText('Track unavailable')).toBeVisible();

    await expect(card(page, 'Avatar — Initials').locator('[data-avatar-state="initials"]')).toBeVisible();
    await expect(card(page, 'Avatar — Icon Fallback').locator('[data-avatar-state="icon"]')).toBeVisible();
    const imageAvatar = card(page, 'Image Avatar').locator('.dd-avatar');
    const avatarImage = imageAvatar.locator('img[alt="DJ profile avatar"]');
    await expect(avatarImage).toBeVisible();
    await avatarImage.evaluate((node: HTMLImageElement) => { node.src = '/artwork/__missing-stage4-avatar__.png'; });
    await expect(imageAvatar).toHaveAttribute('data-avatar-state', 'icon');
  });

  test('sidebar, primary tabs, filters, and view modes preserve controlled selection during repeated switching', async ({ page }) => {
    const sidebar = card(page, 'Sidebar Nav Items');
    await expect(sidebar.getByRole('button', { name: 'Collection' })).toHaveAttribute('aria-pressed', 'true');
    await sidebar.getByRole('button', { name: 'Tracks' }).click();
    await expect(sidebar.getByRole('button', { name: 'Tracks' })).toHaveAttribute('aria-pressed', 'true');
    await sidebar.getByRole('button', { name: 'Collection' }).click();
    await expect(sidebar.getByRole('button', { name: 'Collection' })).toHaveAttribute('aria-pressed', 'true');

    const nav = card(page, 'Tab Navigation');
    const primary = nav.getByRole('tablist', { name: 'Library sections' });
    for (const label of ['TRACKS', 'GENRES', 'ALBUMS', 'PLAYLISTS']) {
      await primary.getByRole('tab', { name: label }).click();
      await expect(primary.getByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true');
    }

    const filters = nav.getByRole('tablist', { name: 'Library filters' });
    for (const label of ['Downloaded', 'Recently Played', 'Favorites', 'Offline', 'All']) {
      await filters.getByRole('tab', { name: label }).click();
      await expect(filters.getByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true');
    }

    const views = nav.getByRole('radiogroup', { name: 'Library view mode' });
    for (const label of ['List', 'Compact', 'Cards', 'Waveform', 'Grid']) {
      await views.getByRole('radio', { name: label }).click();
      await expect(views.getByRole('radio', { name: label })).toHaveAttribute('aria-checked', 'true');
    }
  });

  test('tabs and view-mode controls support keyboard-only navigation with roving focus', async ({ page }) => {
    const nav = card(page, 'Tab Navigation');
    const primary = nav.getByRole('tablist', { name: 'Library sections' });
    const playlists = primary.getByRole('tab', { name: 'PLAYLISTS' });
    await playlists.focus();
    await playlists.press('ArrowRight');
    const tracks = primary.getByRole('tab', { name: 'TRACKS' });
    await expect(tracks).toBeFocused();
    await expect(tracks).toHaveAttribute('aria-selected', 'true');
    await tracks.press('End');
    const genres = primary.getByRole('tab', { name: 'GENRES' });
    await expect(genres).toBeFocused();
    await expect(genres).toHaveAttribute('aria-selected', 'true');
    await genres.press('Home');
    await expect(playlists).toBeFocused();

    const views = nav.getByRole('radiogroup', { name: 'Library view mode' });
    const grid = views.getByRole('radio', { name: 'Grid' });
    await grid.focus();
    await grid.press('ArrowRight');
    const list = views.getByRole('radio', { name: 'List' });
    await expect(list).toBeFocused();
    await expect(list).toHaveAttribute('aria-checked', 'true');
    await list.press('End');
    await expect(views.getByRole('radio', { name: 'Waveform' })).toBeFocused();
  });

  test('playlist/card actions stay live and representative Stage 1-3 interactions still work', async ({ page }) => {
    const playlist = card(page, 'Playlist Card');
    await playlist.getByRole('button', { name: 'VIEW PLAYLIST' }).click();
    await expect(page.getByRole('status')).toHaveText('Playlist action activated');

    await card(page, 'Glass Card').getByRole('button', { name: 'Play Midnight Drive' }).click();
    await expect(page.getByRole('status')).toHaveText('Play action: Midnight Drive');
    await card(page, 'Artwork / Thumbnail').getByRole('button', { name: 'Play artwork preview' }).click();
    await expect(page.getByRole('status')).toHaveText('Play artwork preview');

    const stage1Combo = page.locator('[data-stage1-card="Searchable Combobox / Autocomplete"]').getByRole('combobox');
    await stage1Combo.focus();
    await stage1Combo.press('ArrowDown');
    await stage1Combo.press('Enter');
    await expect(stage1Combo).toHaveAttribute('aria-expanded', 'false');

    await expect(page.locator('[data-stage2-card="Progress Bar"]').getByRole('progressbar')).toHaveCount(6);

    const stage3Play = page.locator('[data-stage3-card="Play / Pause Button"]').locator('.dd-media-button').first();
    await stage3Play.click();
    await expect(stage3Play).toHaveAttribute('data-active', 'true');
  });

  test('navigation away/back remounts Stage 4 cleanly without page errors', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const searchNav = page.locator('aside nav').getByRole('button', { name: 'Search' });
    await searchNav.click();
    await expect(page).toHaveURL('/search');
    await page.goBack();
    await expect(page).toHaveURL('/reusable-components');
    await expect(page.getByTestId('stage4-component-board')).toBeVisible();
    await expect(card(page, 'Sidebar Nav Items').getByRole('button', { name: 'Collection' })).toHaveAttribute('aria-pressed', 'true');
    expect(pageErrors).toEqual([]);
  });

  test('supported narrow desktop width does not introduce board-level horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 1000 });
    await page.reload();
    await expect(page.getByTestId('stage4-component-board')).toBeVisible();

    const overflow = await page.getByTestId('stage4-component-board').evaluate((node) => ({
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    await expect(card(page, 'Tab Navigation').getByRole('tablist', { name: 'Library sections' })).toBeVisible();
    await expect(card(page, 'Artwork / Thumbnail').locator('.dd-artwork')).toHaveCSS('aspect-ratio', '1 / 1');
  });
});
