/**
 * USB connection E2E tests.
 *
 * Tests 1–6 from Prompt 10.
 * Physical USB is not required — the fake showDirectoryPicker is injected via
 * addInitScript before each test.
 */

import { test, expect } from '../fixtures';
import { injectFakeUsb, injectCancelledPicker } from '../helpers/usb';
import { injectFakeSession, mockSupabaseRoutes } from '../helpers/supabase';
import { injectAudioMocks } from '../helpers/audio';

// ── Test 1: Connect USB ────────────────────────────────────────────────────────

test.describe('USB connect', () => {
  test('shows connected state after selecting a valid USB folder', async ({ page }) => {
    await injectFakeSession(page);
    await injectAudioMocks(page);
    await mockSupabaseRoutes(page);
    await injectFakeUsb(page, { volumeName: 'PIONEER_USB', structure: 'rekordbox' });
    await page.goto('/');

    // Click the Connect USB button (aria-label from UsbConnectionButton)
    const connectBtn = page.getByRole('button', { name: /connect a rekordbox usb/i });
    await connectBtn.click();

    // Should transition to connected state — aria-label changes to "Connected: PIONEER_USB"
    await expect(
      page.getByRole('button', { name: /connected.*PIONEER_USB/i }),
    ).toBeVisible({ timeout: 5000 });
  });

  test('shows wrong root warning when PIONEER folder is absent', async ({ page }) => {
    await injectFakeSession(page);
    await injectAudioMocks(page);
    await mockSupabaseRoutes(page);
    await injectFakeUsb(page, { volumeName: 'Downloads', structure: 'wrong_dir' });
    await page.goto('/');

    const connectBtn = page.getByRole('button', { name: /connect a rekordbox usb/i });
    await connectBtn.click();

    // wrong_root warning text appears
    await expect(
      page.getByText(/select the usb root folder/i),
    ).toBeVisible({ timeout: 5000 });
  });

  test('picker cancellation leaves the button in disconnected state', async ({ page }) => {
    await injectFakeSession(page);
    await injectAudioMocks(page);
    await mockSupabaseRoutes(page);
    await injectCancelledPicker(page);
    await page.goto('/');

    const connectBtn = page.getByRole('button', { name: /connect a rekordbox usb/i });
    await connectBtn.click();

    // Should remain in disconnected state (button label unchanged)
    await expect(connectBtn).toBeVisible({ timeout: 3000 });
  });
});

// ── Test 5: USB disconnect ─────────────────────────────────────────────────────

test.describe('USB disconnect', () => {
  test('shows disconnect button when connected and allows disconnecting', async ({ page }) => {
    await injectFakeSession(page);
    await injectAudioMocks(page);
    await mockSupabaseRoutes(page);
    await injectFakeUsb(page, { volumeName: 'TESTUSB', structure: 'rekordbox' });
    await page.goto('/');

    // Connect
    const connectBtn = page.getByRole('button', { name: /connect a rekordbox usb/i });
    await connectBtn.click();
    await expect(
      page.getByRole('button', { name: /connected.*TESTUSB/i }),
    ).toBeVisible({ timeout: 5000 });

    // Disconnect
    const disconnectBtn = page.getByRole('button', { name: /disconnect usb/i });
    await disconnectBtn.click();

    // Should return to disconnected state
    await expect(
      page.getByRole('button', { name: /connect a rekordbox usb/i }),
    ).toBeVisible({ timeout: 3000 });
  });
});

// ── Test 6: Missing track file ─────────────────────────────────────────────────

test.describe('USB error recovery', () => {
  test('Select USB Again button appears when USB is unavailable', async ({ page }) => {
    await injectFakeSession(page);
    await injectAudioMocks(page);
    await mockSupabaseRoutes(page);

    // First connect successfully, then simulate an unavailable handle by
    // overriding the picker after connect to return a handle that throws SecurityError.
    await page.addInitScript(() => {
      let callCount = 0;
      (window as unknown as Record<string, unknown>).showDirectoryPicker = async () => {
        callCount++;
        if (callCount === 1) {
          // First call: return a handle that queries fine but then fails structure check
          return {
            kind: 'directory',
            name: 'TESTUSB',
            queryPermission: async () => 'granted',
            requestPermission: async () => 'granted',
            getDirectoryHandle: async () => {
              throw new DOMException('Drive gone', 'SecurityError');
            },
          } as unknown as FileSystemDirectoryHandle;
        }
        throw new DOMException('Unavailable', 'AbortError');
      };
    });
    await page.goto('/');

    const connectBtn = page.getByRole('button', { name: /connect a rekordbox usb/i });
    await connectBtn.click();

    // Should show unavailable state with "Select USB Again" option
    await expect(
      page.getByRole('button', { name: /select a different usb drive/i }),
    ).toBeVisible({ timeout: 5000 });
  });
});
