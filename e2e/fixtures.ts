/**
 * Shared Playwright fixtures for DropDex E2E tests.
 *
 * All tests should use `dropdex` fixture which provides a page already set up
 * with mocked Supabase, fake session, and audio stubs.
 */

import { test as base } from '@playwright/test';
import { injectFakeSession, mockSupabaseRoutes, FAKE_TRACKS } from './helpers/supabase';
import { injectAudioMocks } from './helpers/audio';

export type DropDexFixtures = {
  /** Page with Supabase mocked, session injected, and audio stubbed. */
  dropdex: import('@playwright/test').Page;
};

export const test = base.extend<DropDexFixtures>({
  dropdex: async ({ page }, use) => {
    // Set up all mocks BEFORE page.goto() so they apply on first load.
    await injectFakeSession(page);
    await injectAudioMocks(page);
    await mockSupabaseRoutes(page, { tracks: FAKE_TRACKS });
    await page.goto('/');

    // Wait for the app shell to appear (bypasses loading spinner).
    await page.waitForSelector('body', { state: 'visible' });

    await use(page);
  },
});

export { expect } from '@playwright/test';
