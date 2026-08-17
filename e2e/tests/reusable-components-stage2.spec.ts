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
  return page.locator(`[data-stage2-card="${label}"]`);
}

test.describe('Reusable Components Stage 2', () => {
  test.beforeEach(async ({ page }) => {
    await prepare(page);
    await page.goto('/reusable-components');
    await expect(page.getByTestId('stage2-component-board')).toBeVisible();
  });

  test('real route renders Stage 1 and every Stage 2 component family', async ({ page }) => {
    await expect(page).toHaveURL('/reusable-components');
    await expect(page.getByTestId('stage1-component-board')).toBeVisible();
    await expect(page.getByTestId('stage2-component-board')).toBeVisible();

    for (const label of [
      'Status Badge', 'Analysis Status Badge', 'Status Dot', 'Progress Bar', 'Spinner / Loader',
      'Toast / Notification', 'Import Activity Banner', 'Warning / Alert Banner', 'Error / Empty State',
      'Background Import Panel / Floating Activity Panel', 'Progress / Status Modal', 'File Upload Button',
      'Upload Dropzone', 'Modal / Dialog', 'Destructive Confirmation Modal', 'Selectable Option Card',
      'Skeleton Row', 'Skeleton Card', 'Skeleton Chip',
    ]) {
      await expect(card(page, label)).toBeVisible();
    }
  });

  test('progress values and representative semantic states are accurate', async ({ page }) => {
    const progress = card(page, 'Progress Bar').getByRole('progressbar');
    await expect(progress).toHaveCount(6);
    await expect(progress.nth(0)).toHaveAttribute('aria-valuenow', '20');
    await expect(progress.nth(2)).toHaveAttribute('aria-valuenow', '68');
    await expect(progress.nth(3)).toHaveAttribute('aria-valuenow', '100');

    const badges = card(page, 'Status Badge');
    await expect(badges.getByText('Active', { exact: true })).toBeVisible();
    await expect(badges.getByText('Warning', { exact: true })).toBeVisible();
    await expect(badges.getByText('Error', { exact: true })).toBeVisible();
    await expect(badges.getByText('Offline', { exact: true })).toBeVisible();
  });

  test('toast dismissal, alert action, and background activity controls stay functional', async ({ page }) => {
    const toastCard = card(page, 'Toast / Notification');
    for (let i = 0; i < 4; i += 1) {
      await toastCard.getByRole('button', { name: /^Dismiss .* notification$/ }).first().click();
    }
    await expect(toastCard.getByRole('button', { name: 'Restore toast examples' })).toBeVisible();
    await toastCard.getByRole('button', { name: 'Restore toast examples' }).click();
    await expect(toastCard.getByRole('button', { name: /^Dismiss .* notification$/ })).toHaveCount(4);

    await card(page, 'Warning / Alert Banner').getByRole('button', { name: 'MANAGE' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Storage manager opened' }).first()).toBeAttached();

    const activity = card(page, 'Background Import Panel / Floating Activity Panel');
    await activity.getByRole('button', { name: 'PAUSE' }).click();
    await expect(activity.getByRole('button', { name: 'RESUME' })).toBeVisible();
    await activity.getByRole('button', { name: 'Collapse activity panel' }).click();
    await expect(activity.getByRole('button', { name: 'Expand activity panel' })).toBeVisible();
  });

  test('dialog cancel/confirm, upload selection, and selectable cards behave safely', async ({ page }) => {
    const dialogCard = card(page, 'Modal / Dialog');
    await dialogCard.getByRole('button', { name: 'CANCEL' }).click();
    await expect(dialogCard.getByRole('dialog')).toHaveCount(0);
    await dialogCard.getByRole('button', { name: 'Open dialog preview' }).click();
    await expect(dialogCard.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialogCard.getByRole('dialog')).toHaveCount(0);
    await dialogCard.getByRole('button', { name: 'Open dialog preview' }).click();
    await dialogCard.getByRole('button', { name: 'IMPORT' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Playlist import confirmed' }).first()).toBeAttached();

    const destructiveCard = card(page, 'Destructive Confirmation Modal');
    await destructiveCard.getByRole('button', { name: 'CANCEL' }).click();
    await destructiveCard.getByRole('button', { name: 'Open destructive preview' }).click();
    await destructiveCard.getByRole('button', { name: 'DELETE' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Safe demo delete confirmed' }).first()).toBeAttached();

    const uploadButtonCard = card(page, 'File Upload Button');
    await uploadButtonCard.locator('input[type="file"]').first().setInputFiles({ name: 'button-track.wav', mimeType: 'audio/wav', buffer: Buffer.from('RIFF') });
    await expect(uploadButtonCard.getByText('Selected: button-track.wav')).toBeVisible();

    const dropzoneCard = card(page, 'Upload Dropzone');
    const dropzone = dropzoneCard.locator('.dd-dropzone');
    await dropzone.dispatchEvent('dragenter');
    await expect(dropzone).toHaveClass(/dd-dropzone--dragging/);
    await dropzone.dispatchEvent('dragleave');
    await expect(dropzone).not.toHaveClass(/dd-dropzone--dragging/);
    const dropInput = dropzoneCard.locator('input[type="file"]');
    await dropInput.setInputFiles({ name: 'test-track.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('ID3') });
    await expect(dropzoneCard.getByText('Selected: test-track.mp3')).toBeVisible();
    await dropInput.setInputFiles([]);
    await expect(dropzoneCard.getByText('Selected: test-track.mp3')).toBeVisible();

    const options = card(page, 'Selectable Option Card');
    await options.getByRole('radio', { name: /Space Saver/ }).click();
    await options.getByRole('radio', { name: /High Quality/ }).click();
    const balanced = options.getByRole('radio', { name: /Balanced/ });
    await balanced.click();
    await expect(balanced).toHaveAttribute('aria-checked', 'true');
  });

  test('skeletons do not shift interaction state and the route restores after navigation', async ({ page }) => {
    await expect(card(page, 'Skeleton Row').locator('.dd-skeleton-row')).toHaveCount(4);
    await expect(card(page, 'Skeleton Card').locator('.dd-skeleton-card')).toHaveCount(3);
    await expect(card(page, 'Skeleton Chip').locator('.dd-skeleton-chip')).toHaveCount(6);

    await page.goto('/library');
    await page.goBack();
    await expect(page).toHaveURL('/reusable-components');
    await expect(page.getByTestId('stage2-component-board')).toBeVisible();
    await expect(page.getByTestId('stage1-component-board')).toBeVisible();
  });
});
