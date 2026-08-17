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
  return page.locator(`[data-stage3-card="${label}"]`);
}

const STAGE3_LABELS = [
  'Play / Pause Button',
  'Stop Playback Button',
  'Mute / Unmute Button',
  'Media Transport Control Group',
  'Waveform — Decorative (Primary)',
  'Waveform — Decorative (Secondary)',
  'Waveform — With Visualizer Label',
  'Rekordbox Waveform — Loading',
  'Rekordbox Waveform — Unavailable',
  'Rekordbox Waveform — Error',
  'Rekordbox Waveform — Invalid / Unsupported',
  'Interactive / Seekable Waveform',
  'Playback Progress Waveform',
  'Hover Track Row',
  'Active Track Row',
  'Selectable Listbox / Option Row',
  'Data Table / Track Table',
  'Table Header / Column Header Row',
  'Load More Button',
  'External Link Icon Action',
  'Sticky Action / Transport Dock',
] as const;

test.describe('Reusable Components Stage 3', () => {
  test.beforeEach(async ({ page }) => {
    await prepare(page);
    await page.goto('/reusable-components');
    await expect(page.getByTestId('stage3-component-board')).toBeVisible();
  });

  test('real production route preserves Stage 1/2 and renders every Stage 3 family', async ({ page }) => {
    await expect(page).toHaveURL('/reusable-components');
    await expect(page.getByTestId('stage1-component-board')).toBeVisible();
    await expect(page.getByTestId('stage2-component-board')).toBeVisible();
    await expect(page.getByTestId('stage3-component-board')).toBeVisible();

    for (const label of STAGE3_LABELS) {
      await expect(card(page, label)).toBeVisible();
    }
  });

  test('play, rapid toggle, stop, mute, and transport actions keep one local showcase state', async ({ page }) => {
    const playCard = card(page, 'Play / Pause Button');
    const playButton = playCard.locator('.dd-media-button').first();
    await expect(playButton).toHaveAttribute('aria-label', 'Play showcase playback');

    await playButton.click();
    await expect(playButton).toHaveAttribute('aria-label', 'Pause showcase playback');
    await expect(playButton).toHaveAttribute('data-active', 'true');

    for (let index = 0; index < 4; index += 1) await playButton.click();
    await expect(playButton).toHaveAttribute('aria-label', 'Pause showcase playback');

    const seek = card(page, 'Interactive / Seekable Waveform').getByRole('slider', { name: 'Seek interactive showcase waveform' });
    await seek.press('End');
    await expect(seek).toHaveAttribute('aria-valuenow', '100');
    await card(page, 'Stop Playback Button').getByRole('button', { name: 'Stop playback' }).click();
    await expect(playButton).toHaveAttribute('aria-label', 'Play showcase playback');
    await expect(seek).toHaveAttribute('aria-valuenow', '0');

    const muteCard = card(page, 'Mute / Unmute Button');
    const mute = muteCard.getByRole('button', { name: 'Mute' });
    const unmute = muteCard.getByRole('button', { name: 'Unmute' });
    await expect(unmute).toHaveAttribute('data-active', 'true');
    await mute.click();
    await expect(mute).toHaveAttribute('data-active', 'true');
    await expect(unmute).toHaveAttribute('data-active', 'false');
    await unmute.click();
    await expect(unmute).toHaveAttribute('data-active', 'true');

    const transport = card(page, 'Media Transport Control Group').getByRole('group', { name: 'Media transport controls' });
    await transport.getByRole('button', { name: 'Play' }).click();
    await expect(transport.getByRole('button', { name: 'Pause' })).toBeVisible();
    await transport.getByRole('button', { name: 'Fast forward' }).click();
    await expect(seek).toHaveAttribute('aria-valuenow', '10');
    await transport.getByRole('button', { name: 'Rewind' }).click();
    await expect(seek).toHaveAttribute('aria-valuenow', '0');
  });

  test('seek semantics and all waveform failure contracts remain distinguishable', async ({ page }) => {
    const seek = card(page, 'Interactive / Seekable Waveform').getByRole('slider', { name: 'Seek interactive showcase waveform' });
    await seek.focus();
    await seek.press('Home');
    await expect(seek).toHaveAttribute('aria-valuenow', '0');
    await seek.press('End');
    await expect(seek).toHaveAttribute('aria-valuenow', '100');
    await seek.press('ArrowLeft');
    await expect(seek).toHaveAttribute('aria-valuenow', '99');

    await expect(card(page, 'Rekordbox Waveform — Loading').locator('[data-waveform-status="loading"]')).toBeAttached();
    await expect(card(page, 'Rekordbox Waveform — Unavailable').locator('[data-waveform-status="unavailable"]')).toBeAttached();
    await expect(card(page, 'Rekordbox Waveform — Error').locator('[data-waveform-status="error"]')).toBeAttached();
    await expect(card(page, 'Rekordbox Waveform — Invalid / Unsupported').locator('[data-waveform-status="invalid"]')).toBeAttached();

    await expect(card(page, 'Rekordbox Waveform — Error').getByText('Failed to load waveform')).toBeVisible();
    await expect(card(page, 'Rekordbox Waveform — Invalid / Unsupported').getByText('Unsupported file format')).toBeVisible();
  });

  test('active track rows, keyboard listbox, table selection, missing artwork, and sorting remain functional', async ({ page }) => {
    const activeRow = card(page, 'Active Track Row').getByRole('button');
    await expect(activeRow).toHaveAttribute('aria-pressed', 'true');
    await activeRow.click();
    await expect(activeRow).toHaveAttribute('aria-pressed', 'false');
    await activeRow.click();
    await expect(activeRow).toHaveAttribute('aria-pressed', 'true');

    const genre = card(page, 'Selectable Listbox / Option Row').getByRole('combobox', { name: 'Track genre' });
    await genre.focus();
    await genre.press('ArrowDown');
    await expect(genre).toHaveAttribute('aria-expanded', 'true');
    await genre.press('Enter');
    await expect(genre).toContainText('Tech House');
    await expect(genre).toHaveAttribute('aria-expanded', 'false');
    await genre.press('End');
    await genre.press('Enter');
    await expect(genre).toContainText('Trance');

    const tableCard = card(page, 'Data Table / Track Table');
    await expect(tableCard.getByRole('table')).toBeVisible();
    const caveRow = tableCard.getByRole('row').filter({ hasText: 'The Cave' });
    await expect(caveRow.locator('.dd-stage3-artwork--fallback')).toHaveCount(1);
    await caveRow.click();
    await expect(caveRow).toHaveAttribute('data-selected', 'true');

    const midnightRow = tableCard.getByRole('row').filter({ hasText: 'Midnight Roller' });
    await midnightRow.focus();
    await midnightRow.press('Enter');
    await expect(midnightRow).toHaveAttribute('data-selected', 'true');
    await midnightRow.press(' ');
    await expect(midnightRow).toHaveAttribute('data-selected', 'true');

    const firstTitleBefore = await tableCard.locator('tbody tr').first().locator('td').nth(1).innerText();
    await tableCard.getByRole('button', { name: 'Sort by track name' }).click();
    const firstTitleAfter = await tableCard.locator('tbody tr').first().locator('td').nth(1).innerText();
    expect(firstTitleAfter).not.toBe(firstTitleBefore);
    await expect(tableCard.getByText('Innerbloom (Extended Mix)')).toBeVisible();
  });

  test('load-more, external-link, and sticky dock callbacks are live without creating production playback', async ({ page }) => {
    const loadMore = card(page, 'Load More Button').getByRole('button', { name: 'LOAD MORE' });
    await loadMore.click();
    await expect(page.getByRole('status').filter({ hasText: 'Load more callback invoked (1)' })).toBeAttached();
    await loadMore.click();
    await expect(page.getByRole('status').filter({ hasText: 'Load more callback invoked (2)' })).toBeAttached();

    await card(page, 'External Link Icon Action').getByRole('button', { name: 'Open external track link' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'External link action activated' })).toBeAttached();

    const dock = card(page, 'Sticky Action / Transport Dock');
    const dockTransport = dock.getByRole('group', { name: 'Sticky dock transport controls' });
    await dockTransport.getByRole('button', { name: 'Play' }).click();
    await expect(dockTransport.getByRole('button', { name: 'Pause' })).toBeVisible();

    const dockPosition = dock.getByRole('slider', { name: 'Dock playback position' });
    await dockPosition.press('Home');
    await expect(dockPosition).toHaveValue('0');
    await dockPosition.press('End');
    await expect(dockPosition).toHaveValue('1');

    const dockMute = dock.getByRole('button', { name: 'Mute dock' });
    await dockMute.click();
    await expect(dock.getByRole('button', { name: 'Unmute dock' })).toBeVisible();
  });

  test('navigation away/back unmounts and remounts waveform surfaces without page errors', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/library');
    await expect(page).toHaveURL('/library');
    await page.goBack();
    await expect(page).toHaveURL('/reusable-components');
    await expect(page.getByTestId('stage1-component-board')).toBeVisible();
    await expect(page.getByTestId('stage2-component-board')).toBeVisible();
    await expect(page.getByTestId('stage3-component-board')).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
