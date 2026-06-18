import { describe, expect, it, vi } from 'vitest';
import {
  isFileSystemAccessSupported,
  queryPermission,
  requestPermission,
  ensureReadPermission,
} from './usbPermissions';

// ── helpers ────────────────────────────────────────────────────────────────────

function makeHandle(
  queryResult: PermissionState,
  requestResult: PermissionState = queryResult,
): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name: 'TEST_USB',
    queryPermission: vi.fn().mockResolvedValue(queryResult),
    requestPermission: vi.fn().mockResolvedValue(requestResult),
    isSameEntry: vi.fn(),
    getDirectoryHandle: vi.fn(),
    getFileHandle: vi.fn(),
    removeEntry: vi.fn(),
    resolve: vi.fn(),
    [Symbol.asyncIterator]: vi.fn(),
    entries: vi.fn(),
    keys: vi.fn(),
    values: vi.fn(),
  } as unknown as FileSystemDirectoryHandle;
}

// ── isFileSystemAccessSupported ────────────────────────────────────────────────

describe('isFileSystemAccessSupported', () => {
  it('returns false when showDirectoryPicker is absent', () => {
    const orig = (globalThis as Record<string, unknown>).showDirectoryPicker;
    delete (globalThis as Record<string, unknown>).showDirectoryPicker;
    expect(isFileSystemAccessSupported()).toBe(false);
    if (orig !== undefined) {
      (globalThis as Record<string, unknown>).showDirectoryPicker = orig;
    }
  });

  it('returns true when showDirectoryPicker is present', () => {
    const stub = vi.fn();
    (globalThis as Record<string, unknown>).showDirectoryPicker = stub;
    // In Node, `window` is undefined — test via the globalThis path used in browser
    // The function checks `typeof window !== 'undefined'` — simulate browser env
    // by stubbing both
    Object.defineProperty(globalThis, 'window', {
      value: { showDirectoryPicker: stub },
      writable: true,
      configurable: true,
    });
    expect(isFileSystemAccessSupported()).toBe(true);
    delete (globalThis as Record<string, unknown>).showDirectoryPicker;
    delete (globalThis as Record<string, unknown>).window;
  });
});

// ── queryPermission ────────────────────────────────────────────────────────────

describe('queryPermission', () => {
  it('calls handle.queryPermission with mode: read', async () => {
    const handle = makeHandle('granted');
    const result = await queryPermission(handle);
    expect(result).toBe('granted');
    expect(handle.queryPermission).toHaveBeenCalledWith({ mode: 'read' });
  });

  it('returns prompt when permission not yet granted', async () => {
    const handle = makeHandle('prompt');
    expect(await queryPermission(handle)).toBe('prompt');
  });

  it('returns denied when permission denied', async () => {
    const handle = makeHandle('denied');
    expect(await queryPermission(handle)).toBe('denied');
  });
});

// ── requestPermission ──────────────────────────────────────────────────────────

describe('requestPermission', () => {
  it('calls handle.requestPermission with mode: read', async () => {
    const handle = makeHandle('prompt', 'granted');
    const result = await requestPermission(handle);
    expect(result).toBe('granted');
    expect(handle.requestPermission).toHaveBeenCalledWith({ mode: 'read' });
  });

  it('returns denied when user declines', async () => {
    const handle = makeHandle('prompt', 'denied');
    expect(await requestPermission(handle)).toBe('denied');
  });
});

// ── ensureReadPermission ───────────────────────────────────────────────────────

describe('ensureReadPermission', () => {
  it('returns granted immediately without requesting when already granted', async () => {
    const handle = makeHandle('granted');
    const result = await ensureReadPermission(handle);
    expect(result).toBe('granted');
    expect(handle.requestPermission).not.toHaveBeenCalled();
  });

  it('returns denied immediately without requesting when already denied', async () => {
    const handle = makeHandle('denied');
    const result = await ensureReadPermission(handle);
    expect(result).toBe('denied');
    expect(handle.requestPermission).not.toHaveBeenCalled();
  });

  it('calls requestPermission when state is prompt and returns granted', async () => {
    const handle = makeHandle('prompt', 'granted');
    const result = await ensureReadPermission(handle);
    expect(result).toBe('granted');
    expect(handle.requestPermission).toHaveBeenCalledOnce();
  });

  it('calls requestPermission when state is prompt and returns denied', async () => {
    const handle = makeHandle('prompt', 'denied');
    const result = await ensureReadPermission(handle);
    expect(result).toBe('denied');
    expect(handle.requestPermission).toHaveBeenCalledOnce();
  });
});
