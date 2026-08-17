import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import type { DropPoint } from '../../lib/music/dropPointResolver';
import type { DropLabPreviewPhase } from '../../hooks/useDropLabPreview';
import type { DropLabBarCount, DropLabBeatOffset } from '../../lib/music/dropLabSegments';
import { ArrowRight, CircleDash, Document, Play, RotateCounterclockwise, Stop } from '@carbon/icons-react';

interface DropLabControlsProps {
  beatOffset: DropLabBeatOffset;
  barCount: DropLabBarCount;
  sourceDropPoints: DropPoint[];
  candidateDropPoints: DropPoint[];
  sourceDropId: string | null;
  candidateDropId: string | null;
  previewLabel: string;
  previewDisabled: boolean;
  previewPlaying: boolean;
  previewLoading: boolean;
  previewError: boolean;
  previewProgress: number;
  previewPhase: DropLabPreviewPhase;
  disabledReason: string | null;
  onSourceDropChange: (dropId: string) => void;
  onCandidateDropChange: (dropId: string) => void;
  onBeatOffsetChange: (offset: DropLabBeatOffset) => void;
  onBarCountChange: (count: DropLabBarCount) => void;
  onPreview: () => void;
  onTrackDetails: () => void;
  trackDetailsDisabled: boolean;
}

function ToggleButton({ active, children, onClick, ariaLabel }: { active: boolean; children: ReactNode; onClick: () => void; ariaLabel?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        'min-h-9 px-3 py-2 rounded-lg border text-[11px] font-bold transition-all focus:outline-none focus:ring-2 focus:ring-primary/50',
        active
          ? 'bg-primary/15 border-primary/55 text-primary shadow-primary-card'
          : 'bg-[var(--color-surface)] border-[var(--color-border-subtle)] text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface-hover)]',
      )}
    >
      {children}
    </button>
  );
}

function formatCueTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function CueSelect({
  label,
  helper,
  points,
  value,
  onChange,
}: {
  label: string;
  helper: string;
  points: DropPoint[];
  value: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block min-w-0">
      <span className="block text-[10px] font-black uppercase tracking-[0.18em] text-foreground">{label}</span>
      <span className="mt-0.5 block text-[10px] leading-tight text-muted-foreground">{helper}</span>
      <select
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        disabled={points.length === 0}
        className="mt-2 h-10 w-full min-w-0 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-panel)] px-3 text-xs font-bold text-foreground outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {points.length === 0 ? (
          <option value="">No detected cue</option>
        ) : (
          points.map((point, index) => (
            <option key={point.id} value={point.id}>
              {index + 1}. {point.label} · {formatCueTime(point.dropMs)} · {point.confidence}
            </option>
          ))
        )}
      </select>
    </label>
  );
}

function phaseLabel(phase: DropLabPreviewPhase, playing: boolean): string {
  if (!playing) return 'Ready to audition';
  return phase === 'drop' ? 'Playing candidate drop' : 'Playing selected build';
}

export function DropLabControls({
  beatOffset,
  barCount,
  sourceDropPoints,
  candidateDropPoints,
  sourceDropId,
  candidateDropId,
  previewLabel,
  previewDisabled,
  previewPlaying,
  previewLoading,
  previewError,
  previewProgress,
  previewPhase,
  disabledReason,
  onSourceDropChange,
  onCandidateDropChange,
  onBeatOffsetChange,
  onBarCountChange,
  onPreview,
  onTrackDetails,
  trackDetailsDisabled,
}: DropLabControlsProps) {
  return (
    <section
      className="sticky bottom-40 z-30 mt-5 overflow-hidden rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-panel)]/95 shadow-2xl backdrop-blur-xl md:bottom-3"
      aria-label="Drop Lab audio dock"
      role="region"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border-faint)] px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-primary">Transition Transport</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-bold">
            <span>Selected build</span>
            <ArrowRight size={12} className="text-muted-foreground" />
            <span className="rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-primary">Swap at cue</span>
            <ArrowRight size={12} className="text-muted-foreground" />
            <span>Candidate drop</span>
          </div>
        </div>
        <span className={cn(
          'rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.16em]',
          previewPlaying
            ? 'border-primary/40 bg-primary/15 text-primary'
            : previewError
              ? 'border-amber-400/35 bg-amber-400/10 text-amber-300'
              : 'border-[var(--color-border-subtle)] bg-[var(--color-surface)] text-muted-foreground',
        )}>
          {previewLoading
            ? 'Preparing audio'
            : previewError
              ? 'Audio needs attention'
              : phaseLabel(previewPhase, previewPlaying)}
        </span>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(360px,1.35fr)_minmax(330px,1fr)_minmax(250px,0.72fr)] xl:items-end">
        <div className="grid gap-3 sm:grid-cols-2">
          <CueSelect
            label="1 · Source exit cue"
            helper="The selected track plays up to this line."
            points={sourceDropPoints}
            value={sourceDropId}
            onChange={onSourceDropChange}
          />
          <CueSelect
            label="2 · Candidate entry cue"
            helper="The new track begins from this detected drop."
            points={candidateDropPoints}
            value={candidateDropId}
            onChange={onCandidateDropChange}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em]">3 · Line up the entry</p>
            <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">Move the candidate start around its detected drop.</p>
            <div className="mt-2 flex flex-wrap gap-1" aria-label="Candidate drop alignment">
              <ToggleButton
                active={beatOffset === -1}
                onClick={() => onBeatOffsetChange(-1)}
                ariaLabel="Start candidate one beat before its drop"
              >
                -1 beat
              </ToggleButton>
              <ToggleButton
                active={beatOffset === 0}
                onClick={() => onBeatOffsetChange(0)}
                ariaLabel="Start candidate exactly on its drop"
              >
                On drop
              </ToggleButton>
              <ToggleButton
                active={beatOffset === 1}
                onClick={() => onBeatOffsetChange(1)}
                ariaLabel="Start candidate one beat after its drop"
              >
                +1 beat
              </ToggleButton>
            </div>
          </div>

          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em]">4 · Preview length</p>
            <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">Choose how much build and drop audio to hear.</p>
            <div className="mt-2 flex flex-wrap gap-1" aria-label="Comparison window">
              {[4, 8, 16].map((count) => (
                <ToggleButton
                  key={count}
                  active={barCount === count}
                  onClick={() => onBarCountChange(count as DropLabBarCount)}
                >
                  {count} bars
                </ToggleButton>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <button
            type="button"
            onClick={onPreview}
            disabled={previewDisabled}
            title={disabledReason ?? undefined}
            className={cn(
              'flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border px-5 py-3 text-sm font-black uppercase tracking-[0.12em] transition-all focus:outline-none focus:ring-2 focus:ring-primary/50',
              previewDisabled
                ? 'cursor-not-allowed border-[var(--color-border-subtle)] bg-[var(--color-surface)] text-muted-foreground opacity-70'
                : previewError
                  ? 'border-amber-400/45 bg-amber-400/10 text-amber-300 hover:bg-amber-400/15'
                  : 'border-primary bg-primary text-white shadow-primary-control hover:brightness-110 active:scale-[0.99]',
            )}
          >
            {previewLoading ? (
              <CircleDash size={18} className="animate-spin" />
            ) : previewPlaying ? (
              <Stop size={17} fill="currentColor" />
            ) : previewError ? (
              <RotateCounterclockwise size={18} />
            ) : (
              <Play size={19} fill="currentColor" />
            )}
            {previewLabel}
          </button>
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground" title={disabledReason ?? undefined}>
              {disabledReason ?? 'Press play to hear the build, then the automatic swap into the candidate drop.'}
            </p>
            <button
              type="button"
              onClick={onTrackDetails}
              disabled={trackDetailsDisabled}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[10px] font-bold text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Document size={12} />
              Candidate details
            </button>
          </div>
        </div>
      </div>

      <div className="relative h-1.5 bg-[var(--color-surface)]" aria-hidden="true">
        <div
          className="absolute inset-y-0 left-0 bg-primary transition-[width] duration-75"
          style={{ width: `${Math.max(0, Math.min(1, previewProgress)) * 100}%` }}
        />
        <div className="absolute inset-y-0 left-1/2 w-px bg-foreground/70" />
      </div>
    </section>
  );
}
