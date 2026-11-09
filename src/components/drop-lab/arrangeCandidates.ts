import { compareRecordValues } from '../ui/display/recordTrackSorting';
import type { DropLabCandidate } from '../../hooks/useDropLabFlipPicks';
import { formatCamelotCode } from '../ui/display/camelotKey';
import { durationMsForTrack } from '../../lib/music/trackTiming';
import type { TrackTableSort } from '../ui/display';

export type CandidateSortColumn = 'title' | 'bpm' | 'key' | 'match' | 'genre' | 'format' | 'length' | 'playlists' | 'date-added';

/** Search by title or artist, then order by a column. With no sort, the best match stays first. */
export function arrangeCandidates(
  candidates: readonly DropLabCandidate[],
  search: string,
  sort: TrackTableSort<CandidateSortColumn> | null,
  playlistCounts?: ReadonlyMap<string, number>,
): DropLabCandidate[] {
  const needle = search.trim().toLowerCase();
  const matches = needle
    ? candidates.filter(({ track }) => `${track.title} ${track.artist ?? ''}`.toLowerCase().includes(needle))
    : [...candidates];
  if (!sort) return matches;
  const value = (candidate: DropLabCandidate): string | number | null => {
    switch (sort.column) {
      case 'title': return candidate.track.title;
      case 'bpm': return candidate.track.bpm;
      case 'key': return formatCamelotCode(candidate.track.camelot_key || candidate.track.musical_key);
      case 'genre': return candidate.track.genre;
      case 'format': return candidate.track.file_format;
      case 'length': return durationMsForTrack(candidate.track, null);
      case 'date-added': return candidate.track.date_added;
      case 'playlists': return playlistCounts?.get(candidate.track.id) ?? null;
      case 'match': return candidate.score;
    }
  };
  return matches.sort((a, b) => compareRecordValues(value(a), value(b), sort.direction));
}
