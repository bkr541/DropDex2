/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Track {
  id: string; // Internal unique ID or TrackID from XML
  rekordboxId: string;
  title: string;
  artist: string;
  album: string;
  remixer?: string;
  bpm: number;
  key: string;
  genre: string;
  rating: number;
  duration: number; // in seconds
  comments: string;
  location: string;
  dateAdded: string;
  cuePoints: CuePoint[];
}

export interface CuePoint {
  name: string;
  type: 'hot' | 'memory';
  time: number; // in seconds
  order: number;
}

export interface PlaylistNode {
  id: string;
  name: string;
  type: 'folder' | 'playlist';
  children?: PlaylistNode[];
  trackIds?: string[]; // TrackIDs from XML
}

export interface AppState {
  lastImportDate?: string;
  version: string;
}
