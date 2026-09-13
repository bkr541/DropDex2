import { describe, expect, it, vi } from 'vitest';
import { resolveDesktopImportFile } from './UsbConnectionContext';

describe('Electron targeted import file resolution', () => {
  it('delegates the exact path segments to the existing native USB resolver', async () => {
    const resolveTrackSource = vi.fn(async () => ({
      ok: true as const,
      source: { kind: 'url' as const, url: 'app://usb/token', size: 2 },
    }));
    const fetchFile = vi.fn(async () => new Response(new Blob(['db']), { status: 200 }));

    const result = await resolveDesktopImportFile(
      { resolveTrackSource },
      ['PIONEER', 'rekordbox', 'exportLibrary.db'],
      {},
      fetchFile as typeof fetch,
    );

    expect(resolveTrackSource).toHaveBeenCalledTimes(1);
    expect(resolveTrackSource).toHaveBeenCalledWith(['PIONEER', 'rekordbox', 'exportLibrary.db']);
    expect(fetchFile).toHaveBeenCalledWith('app://usb/token', { cache: 'no-store' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.file.name).toBe('exportLibrary.db');
  });
});
