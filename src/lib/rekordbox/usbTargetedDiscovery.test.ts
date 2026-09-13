import { describe, expect, it, vi } from 'vitest';
import { resolveUsbFile } from '../usb/resolveUsbFile';
import {
  resolveRekordboxDatabase,
  resolveRequestedAnalysisFilesWithResolver,
  type UsbFileResolver,
} from './usbTargetedDiscovery';

describe('targeted Rekordbox USB discovery', () => {

  it('uses browser directory handles without enumerating unrelated branches', async () => {
    const db = new File(['db'], 'exportLibrary.db', { type: 'application/octet-stream' });
    const fileHandle = {
      kind: 'file',
      name: 'exportLibrary.db',
      getFile: vi.fn(async () => db),
    } as unknown as FileSystemFileHandle;
    const rekordbox = {
      kind: 'directory',
      name: 'rekordbox',
      getFileHandle: vi.fn(async (name: string) => {
        if (name === 'exportLibrary.db') return fileHandle;
        throw new DOMException('not found', 'NotFoundError');
      }),
      [Symbol.asyncIterator]: vi.fn(async function* () {
        throw new Error('rekordbox directory should not be enumerated on exact lookup');
      }),
    } as unknown as FileSystemDirectoryHandle;
    const pioneer = {
      kind: 'directory',
      name: 'PIONEER',
      getDirectoryHandle: vi.fn(async (name: string) => {
        if (name === 'rekordbox') return rekordbox;
        throw new DOMException('not found', 'NotFoundError');
      }),
      [Symbol.asyncIterator]: vi.fn(async function* () {
        throw new Error('PIONEER directory should not be enumerated on exact lookup');
      }),
    } as unknown as FileSystemDirectoryHandle;
    const root = {
      kind: 'directory',
      name: 'TESTUSB',
      getDirectoryHandle: vi.fn(async (name: string) => {
        if (name === 'PIONEER') return pioneer;
        throw new Error(`unrelated branch opened: ${name}`);
      }),
      [Symbol.asyncIterator]: vi.fn(async function* () {
        throw new Error('USB root should not be enumerated on exact lookup');
      }),
    } as unknown as FileSystemDirectoryHandle;

    const result = await resolveRekordboxDatabase((segments, options) => (
      resolveUsbFile(root, segments, options)
    ));

    expect(result).toBe(db);
    expect(root.getDirectoryHandle).toHaveBeenCalledTimes(1);
    expect(root.getDirectoryHandle).toHaveBeenCalledWith('PIONEER');
    expect(rekordbox.getFileHandle).toHaveBeenCalledWith('exportLibrary.db');
  });
  it('resolves only the canonical exportLibrary.db path', async () => {
    const db = new File(['db'], 'exportLibrary.db', { type: 'application/octet-stream' });
    const resolver: UsbFileResolver = vi.fn(async (segments) => {
      if (segments[0] === 'Contents' || segments[0] === 'Music') {
        throw new Error('unrelated media branch was touched');
      }
      expect(segments).toEqual(['PIONEER', 'rekordbox', 'exportLibrary.db']);
      return { ok: true, file: db };
    });

    await expect(resolveRekordboxDatabase(resolver)).resolves.toBe(db);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('returns missing database without falling back to a recursive search', async () => {
    const resolver: UsbFileResolver = vi.fn(async (segments) => ({
      ok: false,
      error: {
        kind: 'not_found',
        path: segments.join('/'),
        message: 'not found',
      },
    }));

    await expect(resolveRekordboxDatabase(resolver)).resolves.toBeNull();
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledWith(['PIONEER', 'rekordbox', 'exportLibrary.db']);
  });

  it('does not open unrelated media while resolving manifest-requested analysis files', async () => {
    const requested = new File(['dat'], 'ANLZ0000.DAT');
    const resolver: UsbFileResolver = vi.fn(async (segments) => {
      expect(segments[0]).toBe('PIONEER');
      expect(segments[1]).toBe('USBANLZ');
      return { ok: true, file: requested };
    });

    const result = await resolveRequestedAnalysisFilesWithResolver(resolver, [{
      canonicalPath: 'PIONEER/USBANLZ/P001/ANLZ0000.DAT',
      assetType: 'DAT',
      trackId: 'track-1',
    }]);

    expect(result.matched).toHaveLength(1);
    expect(result.missing).toEqual([]);
    expect(resolver).toHaveBeenCalledTimes(1);
  });
});
