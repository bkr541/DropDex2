import type { ElementType } from 'react';
import { LIBRARY_TABS, SPOTIFY_TAB } from './LibraryView';

export type ArtistLibraryTab = 'playlists' | 'recently-added' | 'tracks' | 'genres' | 'artists' | 'spotify';

/** The Library page's tabs, without Overview and Analysis Incomplete, which Review does not have. */
const ARTIST_LIBRARY_TAB_IDS: ReadonlyArray<ArtistLibraryTab> = ['playlists', 'recently-added', 'tracks', 'genres', 'artists'];

export function artistLibraryTabs(spotifyAvailable: boolean | null): Array<{ id: ArtistLibraryTab; label: string; icon: ElementType }> {
  const base = LIBRARY_TABS.filter((tab) => (ARTIST_LIBRARY_TAB_IDS as ReadonlyArray<string>).includes(tab.id)) as Array<{ id: ArtistLibraryTab; label: string; icon: ElementType }>;
  return spotifyAvailable ? [...base, SPOTIFY_TAB as { id: ArtistLibraryTab; label: string; icon: ElementType }] : base;
}
