import type { DragEvent, MouseEvent } from 'react';
import { CheckmarkFilled, WarningAlt } from '@carbon/icons-react';
import type { DropLabCandidate } from '../../hooks/useDropLabFlipPicks';
import { dropLabKeyLabel } from '../../hooks/useDropLabFlipPicks';
import type { DropLabTrackAnalysis } from '../../hooks/useDropLabAnalysis';
import { durationMsForTrack } from '../../lib/music/trackTiming';
import { KeyBadge, TrackNameCell, TrackTableRow } from '../ui/display';
import { StatusBadge } from '../ui/feedback';
import { TrackWaveformPreview } from '../ui/media';
import { candidateStatus, matchTone } from './candidateStatus';
import { DROP_LAB_TRACK_MIME } from './dropLabDrag';

interface CandidateRowProps {
  candidate: DropLabCandidate;
  analysis?: DropLabTrackAnalysis;
  active: boolean;
  usbReady: boolean;
  onLoadAsDrop: () => void;
  onContextMenu: (event: MouseEvent<HTMLTableRowElement>) => void;
}

export function CandidateRow({ candidate, analysis, active, usbReady, onLoadAsDrop, onContextMenu }: CandidateRowProps) {
  const track = candidate.track;
  const status = candidateStatus(analysis, usbReady);

  function handleDragStart(event: DragEvent<HTMLTableRowElement>) {
    event.dataTransfer.setData(DROP_LAB_TRACK_MIME, track.id);
    event.dataTransfer.setData('text/plain', track.title);
    event.dataTransfer.effectAllowed = 'copy';
  }

  return (
    <TrackTableRow
      data-testid="drop-lab-candidate-row"
      selected={active}
      draggable
      title="Drag onto the timeline, or right-click to load this track"
      onDragStart={handleDragStart}
      onClick={onLoadAsDrop}
      onContextMenu={onContextMenu}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onLoadAsDrop();
        }
      }}
    >
      <TrackNameCell
        title={track.title}
        artist={track.artist}
        artworkSrc={track.artwork_path}
        selected={active}
        status={status.tone}
        nameClassName="w-[260px] shrink-0"
      >
        <TrackWaveformPreview
          className="w-[128px] shrink-0"
          waveformState={analysis?.waveformState ?? { status: 'idle', trackId: track.id }}
          durationMs={analysis?.durationMs ?? durationMsForTrack(track, null)}
          height={26}
          ariaLabel={`Waveform for ${track.title}`}
        />
      </TrackNameCell>
      <td className="px-3 py-1.5 font-mono text-[13px] font-bold tabular-nums">{track.bpm != null ? track.bpm.toFixed(1) : '—'}</td>
      <td className="px-3 py-1.5"><KeyBadge camelotKey={dropLabKeyLabel(track)} variant="badge" /></td>
      <td className="px-3 py-1.5">
        <StatusBadge tone={matchTone(candidate.matchLabel)}>{candidate.matchLabel}</StatusBadge>
        {candidate.reasons.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-1">
            {candidate.reasons.slice(0, 2).map((reason) => (
              <span key={reason.label} className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-muted-foreground">{reason.label}</span>
            ))}
          </span>
        )}
      </td>
      <td className="px-3 py-1.5">
        {status.tone === 'ready'
          ? <span className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-emerald-400"><CheckmarkFilled size={12} /> {status.text}</span>
          : <span className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-amber-400"><WarningAlt size={12} /> {status.text}</span>}
      </td>
    </TrackTableRow>
  );
}
