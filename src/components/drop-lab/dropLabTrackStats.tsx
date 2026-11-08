import { Star } from 'iconoir-react/regular';
import type { DropPoint } from '../../lib/music/dropPointResolver';
import type { RekordboxTrack } from '../../types';
import type { TrackIdentityStat } from '../ui/display';
import { camelotKeyColor } from '../ui/display/camelotKey';
import { dropLabKeyLabel } from '../../hooks/useDropLabFlipPicks';

export function dropLabTrackStats(track: RekordboxTrack, dropPoint: DropPoint | null): TrackIdentityStat[] {
  const key = dropLabKeyLabel(track);
  const rating = track.rating ?? 0;
  return [
    { label: 'BPM', value: track.bpm != null ? track.bpm.toFixed(2) : '—' },
    { label: 'Key', value: key, color: camelotKeyColor(key) },
    {
      label: 'Rating',
      value: rating > 0
        ? <span className="inline-flex items-center gap-0.5"><Star width={9} height={9} aria-hidden="true" />{rating}/5</span>
        : <span className="inline-flex items-center gap-0.5"><Star width={9} height={9} aria-hidden="true" />—</span>,
    },
    { label: 'Drop', value: dropPoint ? `${dropPoint.label} · ${dropPoint.confidence}` : 'Unavailable' },
  ];
}
