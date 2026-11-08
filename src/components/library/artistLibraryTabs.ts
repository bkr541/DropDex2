import type { ElementType } from 'react';
import { LIBRARY_TABS } from './LibraryView';

export type ArtistLibraryTab = 'playlists' | 'recently-added' | 'tracks' | 'genres' | 'artists';
const ARTIST_LIBRARY_TAB_IDS: ReadonlyArray<ArtistLibraryTab> = ['playlists', 'recently-added', 'tracks', 'genres', 'artists'];

export function artistLibraryTabs(): Array<{ id: ArtistLibraryTab; label: string; icon: ElementType }> {
  return LIBRARY_TABS.filter((tab) => (ARTIST_LIBRARY_TAB_IDS as ReadonlyArray<string>).includes(tab.id)) as Array<{ id: ArtistLibraryTab; label: string; icon: ElementType }>;
}
