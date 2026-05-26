import Dexie, { type Table } from 'dexie';
import { Track, PlaylistNode } from '../types';

export class DropDexDatabase extends Dexie {
  tracks!: Table<Track>;
  playlists!: Table<any>;

  constructor() {
    super('DropDexDB');
    this.version(1).stores({
      tracks: '++id, rekordboxId, title, artist, bpm, key, genre',
      playlists: 'id, name, type'
    });
  }
}

export const db = new DropDexDatabase();
