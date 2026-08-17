import { expect, test, type Locator, type Page } from '@playwright/test';
import { injectAudioMocks } from '../helpers/audio';
import { FAKE_TRACKS, injectFakeSession, mockSupabaseRoutes } from '../helpers/supabase';

async function prepare(page: Page): Promise<void> {
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
  await injectFakeSession(page);
  await injectAudioMocks(page);
  await mockSupabaseRoutes(page, { tracks: FAKE_TRACKS });
}

async function gridColumnCount(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const columns = getComputedStyle(element).gridTemplateColumns.trim();
    return columns ? columns.split(/\s+/).length : 0;
  });
}

test.describe('Reusable Components catalogue layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await prepare(page);
    await page.goto('/reusable-components');
    await expect(page.getByTestId('stage1-component-board')).toBeVisible();
  });

  test('uses the app canvas instead of white reference-board backgrounds', async ({ page }) => {
    for (const testId of [
      'stage1-component-board',
      'stage2-component-board',
      'stage3-component-board',
      'stage4-component-board',
    ]) {
      const background = await page.getByTestId(testId).evaluate((element) => getComputedStyle(element).backgroundColor);
      expect(background).toBe('rgba(0, 0, 0, 0)');
    }
  });

  test('keeps every showcase family inside a three-column desktop grid without horizontal board overflow', async ({ page }) => {
    const grids = page.locator([
      '.dd-stage1-grid',
      '.dd-stage2-grid',
      '.dd-stage3-layout',
      '.dd-stage4-grid',
    ].join(', '));

    const count = await grids.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      expect(await gridColumnCount(grids.nth(index))).toBe(3);
    }

    for (const testId of [
      'stage1-component-board',
      'stage2-component-board',
      'stage3-component-board',
      'stage4-component-board',
    ]) {
      const overflows = await page.getByTestId(testId).evaluate((element) => element.scrollWidth > element.clientWidth + 1);
      expect(overflows).toBe(false);
    }
  });

  test('does not stretch standard reusable controls to catalogue-column width', async ({ page }) => {
    const primaryButton = page.locator('[data-stage1-card="Primary Button"] .dd-control-button').first();
    const textInput = page.locator('[data-stage1-card="Text Input"] .dd-text-control');
    const iconButton = page.locator('[data-stage1-card="Icon Button"] .dd-icon-button').first();
    const transportButton = page.locator('[data-stage3-card="Play / Pause Button"] .dd-media-button').first();

    const primaryBox = await primaryButton.boundingBox();
    const inputBox = await textInput.boundingBox();
    const iconBox = await iconButton.boundingBox();
    const transportBox = await transportButton.boundingBox();

    expect(primaryBox?.width ?? Infinity).toBeLessThanOrEqual(301);
    expect(inputBox?.width ?? Infinity).toBeLessThanOrEqual(301);
    expect(iconBox?.width).toBeCloseTo(48, 0);
    expect(transportBox?.width).toBeCloseTo(54, 0);
  });
});
