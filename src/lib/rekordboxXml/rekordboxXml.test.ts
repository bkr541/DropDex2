import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../supabase', () => ({ supabase: {} }));
vi.mock('../../hooks/useRekordboxXmlFiles', () => ({
  useRekordboxXmlFiles: () => ({
    files: [{ id: 'x1', fileName: 'rekordbox.xml', storagePath: 'u/a.xml', sizeBytes: 5_242_880, trackCount: 2283, rekordboxVersion: '6.7.7', sourceModifiedAt: null, createdAt: '2026-11-06T00:00:00Z' }],
    loading: false, loadFailed: false, saving: false, reload: vi.fn(), save: vi.fn(), remove: vi.fn(), downloadUrl: vi.fn(),
  }),
}));

import { checkRekordboxXmlFile, friendlyXmlUploadError, NOT_REKORDBOX_XML, parseRekordboxXmlHeader } from './xmlHeader';

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0">
  <PRODUCT Name="rekordbox" Version="6.7.7" Company="AlphaTheta"/>
  <COLLECTION Entries="2283">
`;
const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');

describe('parseRekordboxXmlHeader', () => {
  it('accepts a Rekordbox XML export and reads its track count and version', () => {
    expect(parseRekordboxXmlHeader(SAMPLE)).toEqual({ ok: true, header: { trackCount: 2283, rekordboxVersion: '6.7.7' } });
  });

  it('still accepts a file that does not say how many tracks it has', () => {
    expect(parseRekordboxXmlHeader('<DJ_PLAYLISTS Version="1.0.0"></DJ_PLAYLISTS>')).toEqual({ ok: true, header: { trackCount: null, rekordboxVersion: null } });
  });

  it('rejects other XML and other files, in plain language', () => {
    for (const text of ['<?xml version="1.0"?><feed></feed>', 'hello', '']) {
      expect(parseRekordboxXmlHeader(text)).toEqual({ ok: false, problem: NOT_REKORDBOX_XML });
    }
    expect(NOT_REKORDBOX_XML).not.toMatch(/schema|parse|bucket/i);
  });

  it('checks only the start of the file, so a very large export is not read into memory', async () => {
    const slice = vi.fn().mockReturnValue({ text: async () => SAMPLE });
    const result = await checkRekordboxXmlFile({ slice } as unknown as Blob);
    expect(slice).toHaveBeenCalledWith(0, 64 * 1024);
    expect(result.ok).toBe(true);
  });

  it('says so plainly when the file cannot be read', async () => {
    const result = await checkRekordboxXmlFile({ slice: () => ({ text: async () => { throw new Error('EACCES'); } }) } as unknown as Blob);
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toContain('EACCES');
  });
});

describe('friendlyXmlUploadError', () => {
  it('explains a file that is too big, and keeps the raw reason for the log only', () => {
    expect(friendlyXmlUploadError('The object exceeded the maximum allowed size')).toContain('bigger');
    expect(friendlyXmlUploadError('Payload too large')).toContain('bigger');
    expect(friendlyXmlUploadError('network down')).toContain('try again');
  });
});

describe('Rekordbox group in the Library tab', () => {
  it('is its own group labelled "Rekordbox", with a Sync Rekordbox XML switch that starts off', async () => {
    const { RekordboxXmlGroup } = await import('../../components/profile/RekordboxXmlGroup');
    const markup = renderToStaticMarkup(createElement(RekordboxXmlGroup, { userId: 'u1' }));
    expect(markup).toContain('data-testid="rekordbox-xml-group"');
    expect(markup).toMatch(/<\/svg>Rekordbox<\/h2>/);
    expect(markup).toContain('Sync Rekordbox XML');
    expect(markup).toContain('data-testid="rekordbox-xml-toggle"');
    expect(markup).toContain('aria-checked="false"');
    // Off: no file chooser and no saved list.
    expect(markup).not.toContain('rekordbox-xml-panel');
    expect(markup).not.toContain('rekordbox-xml-saved');
  });

  it('with the switch on, shows a file location, a Browse button and a save button, and the saved copies', async () => {
    vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'dropdex:rekordbox:xml-sync-enabled' ? '1' : null), setItem: vi.fn() });
    const { RekordboxXmlGroup } = await import('../../components/profile/RekordboxXmlGroup');
    const markup = renderToStaticMarkup(createElement(RekordboxXmlGroup, { userId: 'u1' }));
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain('data-testid="rekordbox-xml-path"');
    expect(markup).toContain('placeholder="No file chosen"');
    expect(markup).toContain('Browse…');
    expect(markup).toContain('Save to DropDex');
    // Nothing is chosen yet, so saving is switched off.
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*data-testid="rekordbox-xml-save"|<button[^>]*data-testid="rekordbox-xml-save"[^>]*disabled/);
    expect(markup).toContain('accept=".xml,text/xml,application/xml"');
    // More than one file can be kept: a list, not a single slot.
    expect(markup).toContain('Saved copies · 1');
    expect(markup).toContain('rekordbox.xml');
    expect(markup).toContain('2,283 tracks · Rekordbox 6.7.7');
    expect(markup).toContain('Download');
    vi.unstubAllGlobals();
  });

  it('sits in the Library tab of the profile, after Streaming', () => {
    const app = read('../../App.tsx');
    expect(app.indexOf('<StreamingSyncGroup')).toBeLessThan(app.indexOf('<RekordboxXmlGroup'));
    expect(app.indexOf('<RekordboxXmlGroup')).toBeLessThan(app.indexOf('Library Snapshots by USB'));
  });
});

describe('storing the files', () => {
  const queries = read('../queries/rekordboxXml.ts');
  const migration = readFileSync(resolve(__dirname, '../../../supabase/migrations/20261106030000_rekordbox_xml_files.sql'), 'utf8');

  it('saves every file as a new copy in the user\'s own folder, never overwriting, and cleans up if recording fails', () => {
    expect(queries).toContain('`${userId}/${crypto.randomUUID()}.xml`');
    expect(queries).toContain('upsert: false');
    expect(queries).toContain('.remove([storagePath])');
  });

  it('keeps the files private to their owner in the database', () => {
    expect(migration).toContain("'rekordbox-xml',\n  false,");
    expect(migration).toContain("(storage.foldername(name))[1] = auth.uid()::text");
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).not.toMatch(/public\.rekordbox_xml_files[^;]*FOR UPDATE/);
  });

  it('logs every step under the Rekordbox prefix, and the desktop app can show a file\'s full location', () => {
    const hook = read('../../hooks/useRekordboxXmlFiles.ts');
    for (const event of ['save_started', 'saved', 'save_failed', 'load_failed', 'remove_failed', 'download_failed']) expect(hook).toContain(`'rekordbox.xml.${event}'`);
    expect(read('../../components/profile/DeveloperTab.tsx')).toContain("message.startsWith('rekordbox.')");
    expect(readFileSync(resolve(__dirname, '../../../electron/preload.cjs'), 'utf8')).toContain('webUtils.getPathForFile(file)');
  });
});
