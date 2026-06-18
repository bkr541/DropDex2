/**
 * USB mock helpers.
 *
 * Injects a fake `window.showDirectoryPicker` that returns an in-memory
 * FileSystemDirectoryHandle stub without touching the real filesystem.
 */

import type { Page } from '@playwright/test';

/**
 * Inject a fake directory picker before the page loads.
 *
 * The fake handle:
 * - Responds to `queryPermission` / `requestPermission` with 'granted'
 * - Has a `name` of `volumeName`
 * - Contains `files` entries keyed by their path segments
 *
 * `files` is a flat map of `"segment1/segment2/file.mp3"` → base64 file content.
 * An empty `files` map produces an accessible but empty USB drive.
 */
export async function injectFakeUsb(
  page: Page,
  options: {
    volumeName?: string;
    structure?: 'rekordbox' | 'empty' | 'wrong_dir';
    files?: Record<string, string>;
  } = {},
): Promise<void> {
  const volumeName = options.volumeName ?? 'TESTUSB';
  const structure = options.structure ?? 'rekordbox';
  const files = options.files ?? {};

  await page.addInitScript(
    ({
      volumeName,
      structure,
      files,
    }: {
      volumeName: string;
      structure: string;
      files: Record<string, string>;
    }) => {
      /**
       * Build a fake FileSystemDirectoryHandle that satisfies the DropDex
       * USB context's permission + structure checks.
       */
      function makeFakeDir(name: string, subDirs: string[], fileMap: Record<string, string>): FileSystemDirectoryHandle {
        const handle: FileSystemDirectoryHandle = {
          kind: 'directory' as const,
          name,
          isSameEntry: async () => false,
          queryPermission: async () => 'granted' as PermissionState,
          requestPermission: async () => 'granted' as PermissionState,
          getDirectoryHandle: async (seg: string) => {
            if (subDirs.includes(seg)) {
              return makeFakeDir(seg, [], fileMap);
            }
            throw new DOMException(`${seg} not found`, 'NotFoundError');
          },
          getFileHandle: async (seg: string) => {
            const fullKey = fileMap[seg] !== undefined ? seg : null;
            if (fullKey) {
              return {
                kind: 'file',
                name: seg,
                isSameEntry: async () => false,
                queryPermission: async () => 'granted' as PermissionState,
                requestPermission: async () => 'granted' as PermissionState,
                getFile: async () => new File([fileMap[fullKey] ?? ''], seg, { type: 'audio/mpeg' }),
              } as FileSystemFileHandle;
            }
            throw new DOMException(`${seg} not found`, 'NotFoundError');
          },
          removeEntry: async () => {},
          resolve: async () => null,
          [Symbol.asyncIterator]: async function* () {
            for (const dir of subDirs) {
              yield [dir, makeFakeDir(dir, [], fileMap)];
            }
          },
          entries: async function* () {},
          keys: async function* () {},
          values: async function* () {},
        } as unknown as FileSystemDirectoryHandle;
        return handle;
      }

      const rekordboxDirs = structure === 'rekordbox'
        ? ['PIONEER', 'Contents', 'Music']
        : structure === 'wrong_dir'
        ? ['Documents', 'Downloads']
        : [];

      const fakeHandle = makeFakeDir(volumeName, rekordboxDirs, files);

      // Override showDirectoryPicker
      (window as unknown as Record<string, unknown>).showDirectoryPicker = async () => fakeHandle;
    },
    { volumeName, structure, files },
  );
}

/**
 * Inject a showDirectoryPicker that always throws AbortError (user cancelled).
 */
export async function injectCancelledPicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).showDirectoryPicker = async () => {
      throw new DOMException('User cancelled', 'AbortError');
    };
  });
}
