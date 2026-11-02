import { cn } from '../../lib/utils';
import type { DropLabCandidate } from '../../hooks/useDropLabFlipPicks';
import { dropLabKeyLabel } from '../../hooks/useDropLabFlipPicks';
import type { DropLabTrackAnalysis } from '../../hooks/useDropLabAnalysis';
import { CheckmarkFilled, WarningAlt } from '@carbon/icons-react';
import { Artwork } from '../ui/display';
import { camelotKeyColor } from '../ui/display/camelotKey';

export const CANDIDATE_COLUMNS = 'minmax(0,1.6fr) 64px 70px 120px minmax(0,1.1fr) 170px 28px';

interface CandidateRowProps {
  candidate: DropLabCandidate;
  analysis?: DropLabTrackAnalysis;
  active: boolean;
  onSelect: () => void;
}

export function CandidateRow({ candidate, analysis, active, onSelect }: CandidateRowProps) {
  const track = candidate.track;
  const key = dropLabKeyLabel(track);
  const hasDrop = Boolean(analysis?.dropPoints.length);
  const waveformStatus = analysis?.waveformState.status ?? 'idle';
  const hasWaveform = waveformStatus === 'loaded';
  const ready = hasDrop && hasWaveform;
  const problem = !hasWaveform
    ? waveformStatus === 'error' ? 'Waveform failed'
      : waveformStatus === 'invalid' ? 'Invalid waveform'
        : waveformStatus === 'loading' ? 'Loading waveform'
          : 'Missing waveform'
    : 'Missing drop';

  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onSelect}
      className={cn(
        'relative grid h-[58px] w-full items-center border-b border-[var(--color-border-faint)] px-5 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        active && 'bg-primary/[0.07]',
      )}
      style={{ gridTemplateColumns: CANDIDATE_COLUMNS }}
    >
      {active && <span className="absolute inset-y-0 left-0 w-[3px] bg-primary" />}
      <div className="flex min-w-0 items-center gap-3">
        <Artwork src={track.artwork_path ?? null} alt="" fallbackTitle="No artwork" className="h-10 w-10 shrink-0 rounded-md" />
        <div className="min-w-0">
          <div className={cn('truncate text-[13px] font-bold', active && 'text-primary')}>{track.title}</div>
          <div className="truncate text-[11px] text-muted-foreground">{track.artist ?? 'Artist not stored'}</div>
        </div>
      </div>
      <span className="font-mono text-[13px] font-bold tabular-nums">{track.bpm != null ? track.bpm.toFixed(1) : '--'}</span>
      <span className="font-mono text-[13px] font-bold" style={{ color: camelotKeyColor(key) }}>{key}</span>
      <span className="text-[11px] font-bold uppercase tracking-wider text-primary">{candidate.matchLabel}</span>
      <span className="flex flex-wrap gap-1">
        {candidate.reasons.slice(0, 2).map((reason) => (
          <span key={reason.label} className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-muted-foreground">{reason.label}</span>
        ))}
      </span>
      {ready
        ? <span className="flex items-center gap-1.5 text-[11px] text-emerald-400"><CheckmarkFilled size={12} /> Ready to preview</span>
        : <span className="flex items-center gap-1.5 text-[11px] text-amber-400"><WarningAlt size={12} /> {problem}</span>}
      <span aria-hidden="true">{active ? <CheckmarkFilled size={16} className="text-primary" /> : <span className="block h-3.5 w-3.5 rounded-full border border-white/25" />}</span>
    </button>
  );
}
