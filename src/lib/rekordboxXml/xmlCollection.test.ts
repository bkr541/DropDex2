import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { filterXmlCollection, parseRekordboxXmlCollection, xmlTrackLocation } from './xmlCollection';
import { RekordboxXmlViewer } from '../../components/profile/RekordboxXmlViewer';
import { readRekordboxXml, type RekordboxXmlRecord } from '../queries/rekordboxXml';

const storage = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { storage: { from: () => ({ download: storage.download }) } } }));
beforeAll(() => { vi.stubGlobal('DOMParser', XmlDomParser); });
afterAll(() => { vi.unstubAllGlobals(); });

const sample = `<?xml version="1.0"?><DJ_PLAYLISTS Version="1.0.0">
<COLLECTION Entries="3">
  <TRACK TrackID="1" Name="A &amp; B &quot;Remix&quot;" Artist="Artist One" DateAdded="2026-10-25"
    Location="file://localhost/Users/me/Music/Caf%C3%A9%20Remix.mp3" Kind="MP3" AverageBpm="140.00" CustomField="Original value">
    <TEMPO Inizio="0.0" Bpm="140.00"/><POSITION_MARK Name="A" Start="12.34"/>
  </TRACK>
  <TRACK TrackID="2" Name="Older Track" Artist="Artist Two" DateAdded="2020-01-01" Kind="MP3"/>
  <TRACK TrackID="3" Name="No Date" Kind="AIFF"/>
</COLLECTION>
<PLAYLISTS><NODE Name="Example"><TRACK Key="1"/></NODE></PLAYLISTS>
</DJ_PLAYLISTS>`;

const collection = () => parseRekordboxXmlCollection(sample);

describe('Rekordbox XML Collection reference data', () => {
  it('reads Collection tracks without treating playlist references, tempo or cues as records', () => {
    const tracks = collection();
    expect(tracks).toHaveLength(3);
    expect(tracks[0].values).toMatchObject({ TrackID: '1', Name: 'A & B "Remix"', AverageBpm: '140.00', CustomField: 'Original value' });
    expect(tracks[0].values.Location).toBe('file://localhost/Users/me/Music/Caf%C3%A9%20Remix.mp3');
    expect(tracks[2].values.DateAdded).toBeUndefined();
  });

  it('supports empty collections and refuses non-Collection files or document type declarations', () => {
    expect(parseRekordboxXmlCollection('<DJ_PLAYLISTS><COLLECTION Entries="0"/></DJ_PLAYLISTS>')).toEqual([]);
    for (const text of ['<Other/>', '<DJ_PLAYLISTS/>', '<DJ_PLAYLISTS><parsererror>Broken XML</parsererror></DJ_PLAYLISTS>', '<!DOCTYPE DJ_PLAYLISTS><DJ_PLAYLISTS/>']) {
      expect(() => parseRekordboxXmlCollection(text)).toThrow();
    }
  });

  it('decodes file locations for reference without changing their raw XML values', () => {
    expect(xmlTrackLocation(collection()[0].values.Location)).toBe('/Users/me/Music/Café Remix.mp3');
    expect(xmlTrackLocation('file://localhost/C:/Music/One%20Track.wav')).toBe('C:/Music/One Track.wav');
    expect(xmlTrackLocation('file://server/Music/Track.mp3')).toBe('//server/Music/Track.mp3');
    expect(xmlTrackLocation('bad%path')).toBe('bad%path');
    expect(xmlTrackLocation(undefined)).toBe('');
  });

  it('searches every raw field and decoded paths, and combines search with file type', () => {
    const tracks = collection();
    expect(filterXmlCollection(tracks, ' CAFÉ REMIX ', 'MP3', 'xml').map(({ values }) => values.TrackID)).toEqual(['1']);
    expect(filterXmlCollection(tracks, 'original value', '', 'xml')).toHaveLength(1);
    expect(filterXmlCollection(tracks, 'original value', 'AIFF', 'xml')).toEqual([]);
  });

  it('sorts dates with undated tracks last and preserves original ordering and values', () => {
    const tracks = collection();
    expect(filterXmlCollection(tracks, '', '', 'newest').map(({ values }) => values.TrackID)).toEqual(['1', '2', '3']);
    expect(filterXmlCollection(tracks, '', '', 'oldest').map(({ values }) => values.TrackID)).toEqual(['2', '1', '3']);
    expect(tracks.map(({ values }) => values.TrackID)).toEqual(['1', '2', '3']);
  });
});

describe('XML viewer without a USB or audio player', () => {
  it('renders saved metadata and file paths using labeled search and filters', () => {
    const markup = renderToStaticMarkup(createElement(RekordboxXmlViewer, { tracks: collection() }));
    expect(markup).toContain('aria-label="Rekordbox XML Collection"');
    expect(markup).toContain('aria-label="Search xml collection"');
    expect(markup).toContain('Café Remix.mp3');
    expect(markup).toContain('2026-10-25');
    expect(markup).not.toContain('CustomField');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain('track-listing-wave');
  });

  it('limits rendering to 50 records per page for a large collection', () => {
    const tracks = Array.from({ length: 120 }, (_, index) => ({ index, values: { Name: `Track ${index}` } }));
    const markup = renderToStaticMarkup(createElement(RekordboxXmlViewer, { tracks }));
    expect(markup.match(/class="profile-xml-summary"/g)).toHaveLength(50);
    expect(markup).toContain('Page 1 of 3');
    expect(markup).not.toContain('>Track 50<');
  });
});

describe('saved XML access', () => {
  const record = { storagePath: 'user/snapshot.xml' } as RekordboxXmlRecord;
  it('reads the private saved snapshot without resolving any source audio locations', async () => {
    storage.download.mockResolvedValue({ data: new Blob([sample]), error: null });
    expect(await readRekordboxXml(record)).toBe(sample);
    expect(storage.download).toHaveBeenCalledWith('user/snapshot.xml');
  });
  it('reports an unavailable saved copy', async () => {
    storage.download.mockResolvedValue({ data: null, error: { message: 'not found' } });
    await expect(readRekordboxXml(record)).rejects.toThrow('saved XML file could not be read');
  });
});
