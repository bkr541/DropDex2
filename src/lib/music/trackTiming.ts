/** Shared track-timing helpers used by Cue Points and Audition. */

import type { BeatGridRow, PhraseRow } from '../queries/analysisData';
import type { RekordboxTrack } from '../../types';

export function durationMsForTrack(
  track: Pick<RekordboxTrack, 'duration_ms' | 'duration_seconds'> | null,
  beatGrid: BeatGridRow | null,
  phrases: PhraseRow[] = [],
): number | null {
  if (!track) return null;

  // Rekordbox Content.length is the single source of truth, stored as duration_ms.
  // Guard against the Device Library Plus unit bug where Content.length (seconds) was
  // stored verbatim as duration_ms — a 95-second track would show as 95 ms. Any stored
  // duration under 1,000 ms (1 s) is implausible for a DJ track and is treated as absent
  // so beat-grid and phrase fallbacks can supply the correct value.
  if (typeof track.duration_ms === 'number' && Number.isFinite(track.duration_ms) && track.duration_ms >= 1_000) {
    return track.duration_ms;
  }
  if (typeof track.duration_seconds === 'number' && Number.isFinite(track.duration_seconds) && track.duration_seconds > 0) {
    return track.duration_seconds * 1000;
  }

  // Stored duration absent — fall back to beat-grid, then phrases.
  const beats = beatGrid?.beats ?? [];
  const lastBeat = beats[beats.length - 1];
  if (lastBeat && Number.isFinite(lastBeat.ms) && lastBeat.ms > 0) {
    return lastBeat.ms + (lastBeat.bpm > 0 ? 60_000 / lastBeat.bpm : 500);
  }

  const phraseCandidates = phrases.flatMap((phrase) => {
    if (phrase.end_ms != null && Number.isFinite(phrase.end_ms) && phrase.end_ms > 0) return [phrase.end_ms];
    if (phrase.start_ms != null && Number.isFinite(phrase.start_ms) && phrase.start_ms > 0) return [phrase.start_ms];
    return [];
  });
  return phraseCandidates.length > 0 ? Math.max(...phraseCandidates) : null;
}

export function formatTime(milliseconds: number | null): string {
  if (milliseconds == null || !Number.isFinite(milliseconds) || milliseconds < 0) return '—';
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
