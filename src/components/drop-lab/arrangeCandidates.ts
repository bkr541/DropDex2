import type { DropLabCandidate } from '../../hooks/useDropLabFlipPicks';
import { dropLabKeyLabel } from '../../hooks/useDropLabFlipPicks';
import type { TrackTableSort } from '../ui/display';

export type CandidateSortColumn = 'title' | 'bpm' | 'key' | 'match';

/** Search by title or artist, then order by a column. With no sort, the best match stays first. */
export function arrangeCandidates(
  candidates: readonly DropLabCandidate[],
  search: string,
  sort: TrackTableSort<CandidateSortColumn> | null,
): DropLabCandidate[] {
  const needle = search.trim().toLowerCase();
  const matches = needle
    ? candidates.filter(({ track }) => `${track.title} ${track.artist ?? ''}`.toLowerCase().includes(needle))
    : [...candidates];
  if (!sort) return matches;
  const direction = sort.direction === 'asc' ? 1 : -1;
  const value = (candidate: DropLabCandidate): string | number | null => {
    switch (sort.column) {
      case 'title': return candidate.track.title;
      case 'bpm': return candidate.track.bpm;
      case 'key': return dropLabKeyLabel(candidate.track);
      case 'match': return candidate.score;
    }
  };
  return matches.sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * direction;
    return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' }) * direction;
  });
}
