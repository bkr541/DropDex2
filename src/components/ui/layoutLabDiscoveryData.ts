// Sample data for the Layout Lab Discovery tab. Nothing here is read from the app.

export const GENRES: { name: string; count: number }[] = [
  { name: 'Melodic Dubstep', count: 8 },
  { name: 'Future Bass', count: 62 },
  { name: 'Dubstep', count: 244 },
  { name: 'Riddim', count: 118 },
  { name: 'Hybrid Trap', count: 36 },
  { name: 'Bass House', count: 74 },
  { name: 'Drum & Bass', count: 131 },
  { name: 'Trap', count: 97 },
  { name: 'Halftime', count: 29 },
];

export type CardKind = 'artist' | 'genre' | 'set' | 'artists' | 'genres';
/** Left to right: an artist, a genre, a DJ set, the artist count and the genre count. */
export const CARD_KINDS: CardKind[] = ['artist', 'genre', 'set', 'artists', 'genres'];

export const SAMPLE = {
  artist: { name: 'ILLENIUM', initials: 'IL', genres: 'Melodic Dubstep · Future Bass', sets: 214, hue: ['#e0524a', '#5a2336'] as const },
  genre: { name: 'Melodic Dubstep', artists: 8, hue: ['#6b7bff', '#27305f'] as const },
  set: { title: 'Lost Lands 2025 · Main Stage', artist: 'ILLENIUM', date: '2025-09-21', identified: 82, hue: ['#f0b35a', '#4a2a2a'] as const },
  artists: { value: '1,420', label: 'Artists', note: '+38 this week' },
  genres: { value: '849', label: 'Genres', note: '7,880 artist tags' },
};

export const SEARCH_SCOPES = ['Artists', 'Sets', 'Genres', 'Tracks'] as const;
export const RECENT_SEARCHES = ['ILLENIUM', 'peak-time melodic', 'Lost Lands 2025', 'riddim 150'];
export const COMPATIBLE_KEYS: { key: string; color: string; note: string }[] = [
  { key: '7A', color: '#8c63ff', note: 'Same key' },
  { key: '6A', color: '#35d7ce', note: 'Down a step' },
  { key: '8A', color: '#ee4aa5', note: 'Up a step' },
  { key: '7B', color: '#f0b35a', note: 'Relative major' },
];
export const WEEK_SETS = [4, 7, 5, 9, 6, 11, 5];
export const WEEK_DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
/** Au5's sets by year, for the Picked for You header's chart. */
export const PICK_YEAR_SETS = [3, 6, 9, 14, 18, 13];
export const PICK_YEARS = ['21', '22', '23', '24', '25', '26'];
