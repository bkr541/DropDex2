import { expect, test, type Page } from '@playwright/test';
import { injectAudioMocks } from '../helpers/audio';
import { FAKE_TRACKS, injectFakeSession, mockSupabaseRoutes } from '../helpers/supabase';

async function prepare(page: Page): Promise<void> {
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
  await injectFakeSession(page);
  await injectAudioMocks(page);
  await mockSupabaseRoutes(page, { tracks: FAKE_TRACKS });
}

test.describe('Stage 1 reusable controls', () => {
  test.beforeEach(async ({ page }) => {
    await prepare(page);
    await page.goto('/reusable-components');
    await expect(page.getByTestId('stage1-component-board')).toBeVisible();
  });

  test('renders through the production route and exposes the Stage 1 families', async ({ page }) => {
    for (const label of [
      'Primary Button',
      'Secondary Button',
      'Danger / Ghost Button',
      'Icon Button',
      'Action Row Button',
      'Disabled Button',
      'Back Button / Breadcrumb',
      'USB Connection Button',
      'Segmented / Toggle Row',
      'Settings Row',
      'Text Input',
      'Search Input',
      'Textarea',
      'URL Input',
      'Select / Dropdown',
      'Searchable Combobox / Autocomplete',
      'Multi-Select / Removable Chips',
      'Number Input',
      'Range Slider',
      'Form Field With Label',
      'Form Field With Helper Text',
      'Required Field Indicator',
      'Inline Field Error',
      'Accent Palette',
    ]) {
      await expect(page.locator(`[data-stage1-card="${label}"]`)).toBeVisible();
    }
  });

  test('keeps selection, form, combobox, chip, numeric, slider, disabled, and keyboard behavior functional', async ({ page }) => {
    const board = page.getByTestId('stage1-component-board');

    const grid = board.getByRole('button', { name: 'GRID', exact: true });
    const waveform = board.getByRole('button', { name: 'WAVEFORM', exact: true });
    await expect(grid).toHaveAttribute('aria-pressed', 'true');
    await waveform.click();
    await expect(waveform).toHaveAttribute('aria-pressed', 'true');

    const deck2 = board.getByRole('button', { name: 'DECK 2' });
    await deck2.click();
    await expect(deck2).toHaveAttribute('aria-pressed', 'true');

    const trackTitle = board.getByRole('textbox', { name: 'Track title' });
    await trackTitle.fill('A very long track title used to verify the control remains editable and stable');
    await expect(trackTitle).toHaveValue('A very long track title used to verify the control remains editable and stable');
    await board.getByRole('button', { name: 'Clear text' }).click();
    await expect(trackTitle).toHaveValue('');

    const genre = board.getByRole('combobox', { name: 'Genre' });
    await genre.selectOption('Deep House');
    await expect(genre).toHaveValue('Deep House');

    const autocomplete = board.getByRole('combobox', { name: 'Search genres' });
    await autocomplete.fill('Deep');
    await autocomplete.press('ArrowDown');
    await autocomplete.press('Enter');
    await expect(autocomplete).not.toHaveValue('');
    await autocomplete.press('Escape');

    for (const chip of ['Tech House', 'Melodic Techno', 'Minimal', 'Deep House']) {
      await board.getByRole('button', { name: `Remove ${chip}` }).click();
    }
    await expect(board.getByRole('button', { name: /^Remove / })).toHaveCount(0);

    const bpm = board.getByRole('spinbutton', { name: 'BPM' });
    await bpm.fill('');
    await expect(bpm).toHaveValue('');
    await board.getByRole('button', { name: 'Increase BPM' }).click();
    await expect(bpm).toHaveValue('1');
    await board.getByRole('button', { name: 'Decrease BPM' }).click();
    await expect(bpm).toHaveValue('0');

    const slider = board.getByRole('slider', { name: 'BPM range' });
    await slider.focus();
    await slider.press('Home');
    await expect(slider).toHaveValue('0');
    await slider.press('End');
    await expect(slider).toHaveValue('200');

    const disabledPlay = board.locator('[data-stage1-card="Disabled Button"]').getByRole('button', { name: /PLAY/ });
    await expect(disabledPlay).toBeDisabled();

    const errorInput = board.locator('[data-stage1-card="Inline Field Error"]').getByRole('textbox');
    await expect(errorInput).toHaveAttribute('aria-invalid', 'true');
    await expect(board.getByText('Please enter a valid number.')).toBeVisible();

  });

  test('survives rapid toggles, dropdown open-close, navigation away/back, and remount', async ({ page }) => {
    const board = page.getByTestId('stage1-component-board');
    const deck1 = board.getByRole('button', { name: 'DECK 1' });
    const deck4 = board.getByRole('button', { name: 'DECK 4' });
    for (let i = 0; i < 4; i += 1) {
      await deck4.click();
      await deck1.click();
    }
    await expect(deck1).toHaveAttribute('aria-pressed', 'true');

    const autocomplete = board.getByRole('combobox', { name: 'Search genres' });
    for (let i = 0; i < 3; i += 1) {
      await autocomplete.focus();
      await autocomplete.press('Escape');
    }

    await page.goto('/library');
    await expect(page).toHaveURL('/library');
    await page.goBack();
    await expect(page).toHaveURL('/reusable-components');
    await expect(page.getByTestId('stage1-component-board')).toBeVisible();
  });
});
