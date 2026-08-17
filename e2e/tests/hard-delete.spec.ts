import { test, expect, type Page, type Route } from '@playwright/test';
import { injectAudioMocks } from '../helpers/audio';
import {
  FAKE_USER_ID,
  injectFakeSession,
  mockSupabaseRoutes,
} from '../helpers/supabase';

const ACTIVE_ID = 'import-hard-delete-active';
const FALLBACK_ID = 'import-hard-delete-fallback';

function filterById(route: Route, rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const idFilter = new URL(route.request().url()).searchParams.get('id');
  if (!idFilter?.startsWith('eq.')) return rows;
  const id = decodeURIComponent(idFilter.slice(3));
  return rows.filter((row) => row.id === id);
}

async function prepareHardDeleteState(page: Page) {
  const imports: Array<Record<string, unknown>> = [
    {
      id: ACTIVE_ID,
      user_id: FAKE_USER_ID,
      status: 'completed',
      source_filename: 'active-library.db',
      source_type: 'onelibrary',
      source_bundle_type: 'usb_folder',
      device_name: 'USB ACTIVE',
      track_count: 20,
      playlist_count: 2,
      imported_at: '2026-08-16T14:00:00Z',
      library_ready_at: '2026-08-16T14:01:00Z',
      analysis_status: 'completed',
      retryable: false,
    },
    {
      id: FALLBACK_ID,
      user_id: FAKE_USER_ID,
      status: 'completed',
      source_filename: 'older-library.db',
      source_type: 'onelibrary',
      source_bundle_type: 'usb_folder',
      device_name: 'USB OLDER',
      track_count: 10,
      playlist_count: 1,
      imported_at: '2026-08-16T12:00:00Z',
      library_ready_at: '2026-08-16T12:01:00Z',
      analysis_status: 'completed',
      retryable: false,
    },
  ];
  let activeImportId: string | null = ACTIVE_ID;
  let deleteCalls = 0;

  await injectFakeSession(page);
  await injectAudioMocks(page);
  await mockSupabaseRoutes(page, { imports: imports as never });

  // Registered after the shared mocks so these mutable handlers take priority.
  await page.route('**/rest/v1/rekordbox_imports*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(filterById(route, imports)),
    });
  });
  await page.route('**/rest/v1/rekordbox_user_settings*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ user_id: FAKE_USER_ID, active_import_id: activeImportId }]),
    });
  });
  await page.route(`http://localhost:8000/api/rekordbox/import/${ACTIVE_ID}*`, async (route) => {
    if (route.request().method() !== 'DELETE') {
      await route.fallback();
      return;
    }

    deleteCalls += 1;
    const url = new URL(route.request().url());
    expect(url.searchParams.get('active_strategy')).toBe('start_over');
    const active = imports.find((row) => row.id === ACTIVE_ID);
    if (active) {
      active.status = 'stopping';
      active.analysis_status = 'stopping';
      active.delete_active_strategy = 'start_over';
      active.retryable = false;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        import_id: ACTIVE_ID,
        status: 'stopping',
        source_filename: 'active-library.db',
        source_bundle_type: 'usb_folder',
        error_code: null,
        error_message: null,
        retryable: false,
        analysis_status: 'stopping',
        worker_status: 'stopping',
        worker_stopped_acknowledged: false,
      }),
    });

    setTimeout(() => {
      const index = imports.findIndex((row) => row.id === ACTIVE_ID);
      if (index >= 0) imports.splice(index, 1);
      activeImportId = null;
    }, 2500);
  });

  return { getDeleteCalls: () => deleteCalls };
}

test.describe('Rekordbox hard-delete lifecycle', () => {
  test('real Settings path preserves delayed Start Over and reconciles hard-delete disappearance', async ({ page }) => {
    const state = await prepareHardDeleteState(page);
    await page.goto('/settings');

    const activeRow = page.getByTestId(`import-history-row-${ACTIVE_ID}`);
    const fallbackRow = page.getByTestId(`import-history-row-${FALLBACK_ID}`);
    await expect(activeRow).toContainText('Active');
    await expect(fallbackRow).not.toContainText('Active');

    await activeRow.getByRole('button', { name: 'Delete', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const confirm = dialog.getByRole('button', { name: 'Delete Active Library', exact: true });
    const confirmationInput = dialog.getByLabel(/Type DELETE exactly to confirm/i);

    await expect(confirm).toBeDisabled();
    await confirmationInput.fill('delete');
    await expect(confirm).toBeDisabled();
    await confirmationInput.fill('Delete');
    await expect(confirm).toBeDisabled();
    await confirmationInput.fill('DELETE ');
    await expect(confirm).toBeDisabled();

    await dialog.locator('button').filter({ hasText: 'Delete & Start Over' }).first().click();
    const startOverConfirm = dialog.getByRole('button', { name: 'Delete & Start Over', exact: true });
    await expect(startOverConfirm).toBeDisabled();
    await confirmationInput.fill('DELETE');
    await expect(startOverConfirm).toBeEnabled();
    await startOverConfirm.click();

    expect(state.getDeleteCalls()).toBe(1);

    // While the active row is still stopping, explicit Start Over suppresses
    // generic fallback to the older usable snapshot.
    await expect(page.getByText('No import found', { exact: true })).toBeVisible({ timeout: 1500 });
    await expect(fallbackRow).not.toContainText('Active');

    // The parent row then disappears. That exact pending delete is success,
    // polling/list state converges, and the older snapshot remains historical.
    await expect(activeRow).toHaveCount(0, { timeout: 7000 });
    await expect(page.getByTestId(`import-history-row-${FALLBACK_ID}`)).toBeVisible();
    await expect(page.getByTestId(`import-history-row-${FALLBACK_ID}`)).not.toContainText('Active');
    await expect(page.getByText('No import found', { exact: true })).toBeVisible();
    await expect(page.getByText(/ready to start over/i)).toBeVisible();
  });
});
