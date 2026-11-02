import { Star, StarFilled } from '@carbon/icons-react';
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
        ? <span className="inline-flex items-center gap-0.5"><StarFilled size={9} />{rating}/5</span>
        : <span className="inline-flex items-center gap-0.5"><Star size={9} />—</span>,
    },
    { label: 'Drop', value: dropPoint ? `${dropPoint.label} · ${dropPoint.confidence}` : 'Unavailable' },
  ];
}
