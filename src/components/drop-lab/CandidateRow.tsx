import { CheckCircle2, Circle, AlertTriangle } from 'lucide-react';
import { cn, formatKey } from '../../lib/utils';
import type { DropLabCandidate } from '../../hooks/useDropLabCandidates';
import type { DropLabTrackAnalysis } from '../../hooks/useDropLabAnalysis';

interface CandidateRowProps {
  candidate: DropLabCandidate;
  analysis?: DropLabTrackAnalysis;
  active: boolean;
  onSelect: () => void;
}

export function CandidateRow({ candidate, analysis, active, onSelect }: CandidateRowProps) {
  const track = candidate.track;
  const bpm = track.bpm != null ? track.bpm.toFixed(1) : '--';
  const key = formatKey(track.musical_key);
  const initials = `${track.artist?.[0] ?? track.title[0] ?? '?'}${track.title[0] ?? '?'}`.toUpperCase();
  const hasDrop = Boolean(analysis?.dropPoints.length);
  const waveformStatus = analysis?.waveformState.status ?? 'idle';
  const hasWaveform = waveformStatus === 'loaded';
  const ready = hasDrop && hasWaveform;
  const reasons = candidate.reasons.slice(0, 2).map((reason) => reason.label);

  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onSelect}
      className={cn(
        'w-full grid grid-cols-[44px_1fr_auto] gap-3 items-center p-3 rounded-xl border text-left transition-all focus:outline-none focus:ring-2 focus:ring-primary/50',
        active
          ? 'bg-primary/10 border-primary/40 shadow-[0_8px_24px_rgba(207,107,101,0.12)]'
          : 'bg-[var(--color-surface)] border-[var(--color-border-faint)] hover:bg-[var(--color-surface-hover)]',
      )}
    >
      <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center text-xs font-black', active ? 'brand-gradient text-white' : 'bg-[var(--color-avatar-bg)] text-muted-foreground')}>
        {initials}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <h4 className="text-sm font-bold truncate">{track.title}</h4>
          <span className="shrink-0 text-[9px] font-bold uppercase tracking-widest text-primary">{candidate.matchLabel}</span>
        </div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-tighter truncate">{track.artist ?? 'Artist not stored'}</p>
        <div className="flex flex-wrap gap-1 mt-1">
          <span className="text-[9px] font-mono text-[var(--color-text-subdued)]">{bpm} BPM</span>
          <span className="text-[9px] font-mono text-secondary">{key}</span>
          {reasons.map((reason) => (
            <span key={reason} className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-surface-hover)] text-muted-foreground">
              {reason}
            </span>
          ))}
          {!ready && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-400 flex items-center gap-1">
              <AlertTriangle size={10} />
              {!hasWaveform
                ? waveformStatus === 'error'
                  ? 'Waveform failed'
                  : waveformStatus === 'invalid'
                    ? 'Invalid waveform'
                    : waveformStatus === 'loading'
                      ? 'Loading waveform'
                      : 'Missing waveform'
                : 'Missing drop'}
            </span>
          )}
        </div>
      </div>
      <div className="text-primary">
        {active ? <CheckCircle2 size={18} /> : <Circle size={18} className="text-muted-foreground" />}
      </div>
    </button>
  );
}

