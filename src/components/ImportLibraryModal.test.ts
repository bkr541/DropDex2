import { describe, expect, it, vi } from 'vitest';
import { selectRekordboxUsbDatabase } from './ImportLibraryModal';

describe('ImportLibraryModal production USB selection path', () => {
  it('selects the canonical USB root then resolves only PIONEER/rekordbox/exportLibrary.db', async () => {
    const dbFile = new File(['db'], 'exportLibrary.db', { type: 'application/octet-stream' });
    const resolveImportFile = vi.fn(async (segments: string[]) => {
      expect(segments).toEqual(['PIONEER', 'rekordbox', 'exportLibrary.db']);
      return { ok: true as const, file: dbFile };
    });
    const usb = {
      selectUsbRoot: vi.fn(async () => ({ cancelled: false, volumeName: 'TESTUSB' })),
      resolveImportFile,
    };

    const result = await selectRekordboxUsbDatabase(usb);

    expect(usb.selectUsbRoot).toHaveBeenCalledTimes(1);
    expect(resolveImportFile).toHaveBeenCalledTimes(1);
    expect(result.dbFile).toBe(dbFile);
    expect(result.folderName).toBe('TESTUSB');
    expect(result.resolver).toBe(resolveImportFile);
  });

  it('does not resolve the database after the user cancels USB selection', async () => {
    const resolveImportFile = vi.fn();
    const usb = {
      selectUsbRoot: vi.fn(async () => ({ cancelled: true, volumeName: null })),
      resolveImportFile,
    };

    const result = await selectRekordboxUsbDatabase(usb);

    expect(result.cancelled).toBe(true);
    expect(resolveImportFile).not.toHaveBeenCalled();
  });
});
