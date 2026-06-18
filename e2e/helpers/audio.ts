/**
 * Audio mock helpers.
 *
 * Overrides HTMLMediaElement play/pause so tests never trigger real audio
 * decoding. Also stubs URL.createObjectURL / revokeObjectURL to return
 * traceable fake URLs.
 */

import type { Page } from '@playwright/test';

/**
 * Inject a silent HTMLMediaElement stub and fake Object URL handling before
 * the page loads.
 *
 * After this, playback calls succeed immediately without real media decoding.
 * `URL.createObjectURL` returns a synthetic `blob:test/...` URL that the
 * app treats as a valid src but the browser will not actually play.
 */
export async function injectAudioMocks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Stub HTMLMediaElement.play / pause so they resolve instantly.
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: function () {
        this.dispatchEvent(new Event('play'));
        return Promise.resolve();
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
      configurable: true,
      value: function () {
        this.dispatchEvent(new Event('pause'));
      },
    });
    // Stub duration so seek calculations don't return NaN.
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      get() {
        return 360;
      },
    });
    // Stub readyState so the player doesn't wait for canplaythrough.
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get() {
        return 4; // HAVE_ENOUGH_DATA
      },
    });

    // Fake Object URL — synthetic but distinct per blob.
    let urlCounter = 0;
    const revokedUrls = new Set<string>();
    (window as unknown as Record<string, unknown>).URL = {
      ...URL,
      createObjectURL: (blob: Blob) => {
        const url = `blob:test/${++urlCounter}-${(blob as File).name ?? 'audio'}`;
        return url;
      },
      revokeObjectURL: (url: string) => {
        revokedUrls.add(url);
      },
    };

    // Expose revoked URLs so tests can assert revocation.
    (window as unknown as Record<string, unknown>).__revokedObjectUrls = revokedUrls;
  });
}
