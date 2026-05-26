import convert from 'xml-js';
import { db } from './db';
import { Track, PlaylistNode, CuePoint } from '../types';

export async function parseRekordboxXml(xmlString: string) {
  const result: any = convert.xml2js(xmlString, { compact: true });
  const djPlaylists = result.DJ_PLAYLISTS;
  if (!djPlaylists) throw new Error('Invalid Rekordbox XML');

  const collection = djPlaylists.COLLECTION?.TRACK || [];
  const tracks: Track[] = (Array.isArray(collection) ? collection : [collection]).map((t: any) => {
    const attr = t._attributes;
    
    // Parse cues
    const cuePoints: CuePoint[] = [];
    const positions = t.POSITION_MARK || [];
    const cues = Array.isArray(positions) ? positions : [positions];
    cues.forEach((p: any, index: number) => {
      const pAttr = p._attributes;
      if (pAttr) {
        cuePoints.push({
          name: pAttr.Name || `Cue ${index + 1}`,
          type: parseInt(pAttr.Num) >= 0 ? 'hot' : 'memory',
          time: parseFloat(pAttr.Start) || 0,
          order: index
        });
      }
    });

    return {
      rekordboxId: attr.TrackID,
      title: attr.Name || 'Unknown Title',
      artist: attr.Artist || 'Unknown Artist',
      album: attr.Album || '',
      remixer: attr.Remixer || '',
      bpm: parseFloat(attr.AverageBpm) || 0,
      key: attr.Tonality || '',
      genre: attr.Genre || '',
      rating: parseInt(attr.Rating) || 0,
      duration: parseFloat(attr.TotalTime) || 0,
      comments: attr.Comments || '',
      location: attr.Location || '',
      dateAdded: attr.DateAdded || '',
      cuePoints: cuePoints.sort((a, b) => a.time - b.time)
    } as Track;
  });

  const playlistsRoot = djPlaylists.PLAYLISTS?.NODE || {};
  const playlists: PlaylistNode[] = [];

  function parseNode(node: any): PlaylistNode | null {
    const attr = node._attributes;
    if (!attr) return null;

    const newNode: PlaylistNode = {
      id: Math.random().toString(36).substr(2, 9),
      name: attr.Name || 'Unnamed',
      type: attr.Type === '0' ? 'folder' : 'playlist',
    };

    if (newNode.type === 'folder') {
      const children = node.NODE;
      if (children) {
        newNode.children = (Array.isArray(children) ? children : [children])
          .map(parseNode)
          .filter(Boolean) as PlaylistNode[];
      }
    } else {
      const tracksRef = node.TRACK;
      if (tracksRef) {
        const trackRefs = Array.isArray(tracksRef) ? tracksRef : [tracksRef];
        newNode.trackIds = trackRefs.map((tr: any) => tr._attributes.Key);
      }
    }

    return newNode;
  }

  const parsedPlaylists = (Array.isArray(playlistsRoot) ? playlistsRoot : [playlistsRoot])
    .map(parseNode)
    .filter(Boolean) as PlaylistNode[];

  // Save to DB
  await db.transaction('rw', [db.tracks, db.playlists], async () => {
    await db.tracks.clear();
    await db.playlists.clear();
    await db.tracks.bulkAdd(tracks);
    await db.playlists.bulkAdd(parsedPlaylists as any);
  });

  return { trackCount: tracks.length, playlistCount: parsedPlaylists.length };
}
