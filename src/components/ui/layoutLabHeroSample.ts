// Sample data shared by the Layout Lab hero mockups.

// Sample data mirroring the artist library hero (profile card + DesktopLibraryHero).
export const HERO = {
  name: 'DVYDRM',
  initials: 'DV',
  usb: 'DVYDRMNG',
  lastImport: 'Sep 29, 2026',
  tracks: 45,
  playlists: 8,
  largestPlaylist: 'Peak Time',
  analyzed: 45,
  progress: 100,
  status: 'Completed',
  bpm: 140,
  key: '7A',
  genre: 'Nasty',
};


// Sample insight data in the same shape the production hero receives.
export const SAMPLE_GENRES: readonly (readonly [string, number])[] = [['Nasty', 18], ['Dubstep', 11], ['Riddim', 9], ['Trap', 7], ['Bass House', 4], ['Other', 6]];
export const SAMPLE_BPM: readonly (readonly [string, number])[] = [['100–119', 3], ['120–139', 9], ['140–159', 22], ['160–179', 8], ['180–199', 3]];
export const SAMPLE_KEYS: readonly (readonly [string, number])[] = [['7A', 12], ['8A', 9], ['6A', 7], ['4A', 5], ['5A', 4]];

