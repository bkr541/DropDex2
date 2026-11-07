import type { ElementType } from 'react';
import { LIBRARY_TABS, SPOTIFY_TAB } from './LibraryView';

export type ReviewTab = 'playlists' | 'recently-added' | 'tracks' | 'genres' | 'artists' | 'spotify';

/** The Library page's tabs, without Overview and Analysis Incomplete, which Review does not have. */
const REVIEW_TAB_IDS: ReadonlyArray<ReviewTab> = ['playlists', 'recently-added', 'tracks', 'genres', 'artists'];

export function reviewTabs(spotifyAvailable: boolean | null): Array<{ id: ReviewTab; label: string; icon: ElementType }> {
  const base = LIBRARY_TABS.filter((tab) => (REVIEW_TAB_IDS as ReadonlyArray<string>).includes(tab.id)) as Array<{ id: ReviewTab; label: string; icon: ElementType }>;
  return spotifyAvailable ? [...base, SPOTIFY_TAB as { id: ReviewTab; label: string; icon: ElementType }] : base;
}
