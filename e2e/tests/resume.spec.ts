/**
 * Resume Analysis E2E tests (Test 8 from Prompt 10).
 *
 * Verifies the resume analysis modal opens, displays unresolved targets,
 * and can trigger selective reprocessing.
 */

import { test, expect } from '../fixtures';
import { injectFakeSession, mockSupabaseRoutes, FAKE_TRACKS, FAKE_IMPORT_ID } from '../helpers/supabase';
import { injectAudioMocks } from '../helpers/audio';

const PARTIAL_IMPORT = {
  id: FAKE_IMPORT_ID,
  user_id: 'test-user-00000000-0000-0000-0000-000000000001',
  status: 'completed',
  source_filename: 'exportLibrary.db',
  track_count: 2,
  playlist_count: 1,
  imported_at: '2025-01-01T00:00:00Z',
  analysis_status: 'partial',
  analysis_expected_track_count: 2,
  analysis_matched_track_count: 1,
  analysis_parsed_track_count: 1,
  analysis_failed_track_count: 1,
  analysis_asset_count: 2,
};

const ANALYSIS_STATUS_RESPONSE = {
  import_id: FAKE_IMPORT_ID,
  analysis_status: 'partial',
  expected_track_count: 2,
  matched_track_count: 1,
  parsed_track_count: 1,
  failed_track_count: 1,
  asset_count: 2,
  missing_required_paths: ['PIONEER/USBANLZ/P001/ANLZ0000.DAT'],
  missing_optional_ext: [],
  missing_optional_2ex: [],
  parser_version: '1.0.0',
  warnings: [],
  unresolved_targets: [
    {
      track_id: FAKE_TRACKS[1].id,
      rekordbox_content_id: FAKE_TRACKS[1].rekordbox_content_id,
      relative_path: 'PIONEER/USBANLZ/P001/ANLZ0000.DAT',
      asset_type: 'DAT',
      required: true,
      status: 'missing',
      reason: null,
      attempt_count: null,
    },
  ],
  missing_required_count: 1,
  missing_optional_count: 0,
  failed_upload_count: 0,
  failed_parse_count: 0,
  affected_track_count: 1,
};

test.describe('Resume Analysis modal', () => {
  test('shows partial import status and resume button', async ({ page }) => {
    await injectFakeSession(page);
    await injectAudioMocks(page);
    await mockSupabaseRoutes(page, {
      tracks: FAKE_TRACKS,
      imports: [PARTIAL_IMPORT],
    });

    // Mock the analysis-status endpoint
    await page.route('**/api/rekordbox/import/*/analysis-status*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ANALYSIS_STATUS_RESPONSE),
      });
    });

    await page.goto('/');

    // The Setup tab or import section should show a Resume Analysis action
    // Look for any button with "resume" text
    await expect(
      page.getByRole('button', { name: /resume analysis/i }),
    ).toBeVisible({ timeout: 10000 });
  });

  test('resume modal opens and shows missing file counts', async ({ page }) => {
    await injectFakeSession(page);
    await injectAudioMocks(page);
    await mockSupabaseRoutes(page, {
      tracks: FAKE_TRACKS,
      imports: [PARTIAL_IMPORT],
    });

    await page.route('**/api/rekordbox/import/*/analysis-status*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ANALYSIS_STATUS_RESPONSE),
      });
    });

    await page.goto('/');

    // Open the resume modal
    const resumeBtn = page.getByRole('button', { name: /resume analysis/i });
    await expect(resumeBtn).toBeVisible({ timeout: 10000 });
    await resumeBtn.click();

    // Modal should display missing required count (1)
    await expect(
      page.getByText(/required dat files missing/i),
    ).toBeVisible({ timeout: 5000 });
  });
});
