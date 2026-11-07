// Sample tracks for the Layout Lab Waveform Preview tab. Nothing here is read from the app.

export interface PreviewCue { pct: number; color: string; letter: string }
export interface PreviewTrack {
  /** The analysis status the green dot stands for: ready, partial (warning), failed (error) or not analysed yet (none). */
  status: 'ready' | 'warning' | 'error' | 'none';
  id: string; title: string; artist: string; bpm: number; key: string; genre: string; format: string; playlists: number; duration: string; seed: number;
  /** Where the drop sits, as a share of the track, or null when it has none. */
  drop: [number, number] | null;
  cues: PreviewCue[];
}

// The cue colours the Audition page uses for hot cues A to D.
const RED = '#ff4e4f';
const BLUE = '#2aa8ff';
const GREEN = '#35e04a';
const PURPLE = '#7a4dff';

export const PREVIEW_TRACKS: PreviewTrack[] = [
  { status: 'ready', id: 't1', title: 'CID - Fancy. $hit (KALYP Remix) - Final 2026', artist: 'Artist Not Available', bpm: 140, key: '04A', genre: '—', format: 'WAV', playlists: 1, duration: '2:31', seed: 3, drop: [0.62, 0.7], cues: [{ pct: 4, color: BLUE, letter: 'B' }, { pct: 24, color: GREEN, letter: 'C' }, { pct: 47, color: PURPLE, letter: 'D' }] },
  { status: 'ready', id: 't2', title: 'Stevie Wonder - Superstition (WBBL Remix)', artist: 'WBBL', bpm: 176, key: '02A', genre: '—', format: 'WAV', playlists: 1, duration: '3:59', seed: 7, drop: [0.5, 0.58], cues: [{ pct: 14, color: RED, letter: 'A' }, { pct: 31, color: BLUE, letter: 'B' }, { pct: 49, color: GREEN, letter: 'C' }, { pct: 68, color: PURPLE, letter: 'D' }] },
  { status: 'warning', id: 't3', title: "SOMEBODY'S WATCHING ME - ROCKWELL (K3ONI REMIX)", artist: 'Artist Not Available', bpm: 128, key: '11A', genre: '—', format: 'WAV', playlists: 1, duration: '3:59', seed: 11, drop: null, cues: [{ pct: 8, color: RED, letter: 'A' }, { pct: 27, color: BLUE, letter: 'B' }, { pct: 52, color: GREEN, letter: 'C' }, { pct: 71, color: PURPLE, letter: 'D' }] },
  { status: 'error', id: 't4', title: 'Big Sean - Dance (A$$) [Levity x Justin Jay Remix] final EXTENDED', artist: 'Artist Not Available', bpm: 160, key: '05B', genre: '—', format: 'WAV', playlists: 1, duration: '3:11', seed: 5, drop: [0.4, 0.5], cues: [{ pct: 12, color: BLUE, letter: 'B' }, { pct: 36, color: GREEN, letter: 'C' }, { pct: 58, color: PURPLE, letter: 'D' }] },
  { status: 'none', id: 't5', title: 'movement 67', artist: 'Artist Not Available', bpm: 135, key: '07A', genre: '—', format: 'MP3', playlists: 2, duration: '3:56', seed: 13, drop: null, cues: [] },
];

/** A repeatable pattern of bar heights (0.12 to 1) for a track, quiet at the start and end and busy in the middle. */
export function waveformAmplitudes(seed: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => {
    const t = i / count;
    const envelope = 0.3 + 0.7 * Math.abs(Math.sin(t * Math.PI * (1.5 + (seed % 3)))) * Math.min(1, t * 8) * Math.min(1, (1 - t) * 8 + 0.2);
    const detail = Math.abs(Math.sin(i * 0.9 + seed) * 0.55 + Math.sin(i * 0.31 + seed * 2) * 0.45);
    return Math.max(0.12, Math.min(1, envelope * 0.55 + detail * 0.5));
  });
}
