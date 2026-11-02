import { cn } from '../../lib/utils';
import type { DropPoint } from '../../lib/music/dropPointResolver';
import type { DropLabPreviewPhase } from '../../hooks/useDropLabPreview';
import type { DropLabBarCount, DropLabBeatOffset } from '../../lib/music/dropLabSegments';
import { ArrowRight, CircleDash, Play, RotateCounterclockwise, Stop } from '@carbon/icons-react';
import { FilterDropdown } from '../ui/controls';
import { TabNavigation } from '../ui/display';
import { TransportButton } from '../ui/media';

function formatCueTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60).toString().padStart(2, '0')}`;
}

function phaseLabel(phase: DropLabPreviewPhase, playing: boolean): string {
  if (!playing) return 'Ready to audition';
  return phase === 'drop' ? 'Playing candidate drop' : 'Playing selected build';
}

interface DropLabDockProps {
  previewLabel: string;
  previewDisabled: boolean;
  previewPlaying: boolean;
  previewLoading: boolean;
  previewError: boolean;
  previewProgress: number;
  previewPhase: DropLabPreviewPhase;
  disabledReason: string | null;
  onPreview: () => void;
}

/** The audio dock row: transport, progress with the swap marker, and a status chip. */
export function DropLabDock({
  previewLabel, previewDisabled, previewPlaying, previewLoading, previewError, previewProgress, previewPhase, disabledReason, onPreview,
}: DropLabDockProps) {
  const progress = Math.max(0, Math.min(1, previewProgress));
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-4 border-y border-[var(--color-border-faint)] bg-[color-mix(in_srgb,var(--color-surface)_56%,var(--color-background))] px-4 py-2"
      role="region"
      aria-label="Drop Lab audio dock"
    >
      <div className="w-[230px] shrink-0">
        <p className="text-[9px] font-black uppercase tracking-[0.22em] text-primary">Transition transport</p>
        <p className="mt-1 flex items-center gap-1.5 text-[10px] font-semibold text-foreground/80">
          Selected build <ArrowRight size={10} className="text-muted-foreground" />
          <span className="rounded border border-primary/30 bg-primary/10 px-1 text-primary">Swap at cue</span>
          <ArrowRight size={10} className="text-muted-foreground" /> Candidate drop
        </p>
      </div>
      <TransportButton
        label={previewLabel}
        tone={previewPlaying ? 'stop' : 'play'}
        size="compact"
        onClick={onPreview}
        disabled={previewDisabled}
        title={disabledReason ?? previewLabel}
      >
        {previewLoading ? <CircleDash size={16} className="animate-spin" /> : previewPlaying ? <Stop size={14} /> : previewError ? <RotateCounterclockwise size={16} /> : <Play size={16} />}
      </TransportButton>
      <div className="flex min-w-[160px] flex-1 items-center gap-2" aria-hidden="true">
        <div className="relative h-1.5 flex-1 rounded-full bg-white/10">
          <div className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-75" style={{ width: `${progress * 100}%` }} />
          <span className="absolute inset-y-[-3px] left-1/2 w-px bg-foreground/70" />
        </div>
      </div>
      <span
        className={cn(
          'shrink-0 rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.16em]',
          previewPlaying
            ? 'border-primary/40 bg-primary/15 text-primary'
            : previewError
              ? 'border-amber-400/35 bg-amber-400/10 text-amber-300'
              : 'border-[var(--color-border-subtle)] text-muted-foreground',
        )}
      >
        {previewLoading ? 'Preparing audio' : previewError ? 'Audio needs attention' : phaseLabel(previewPhase, previewPlaying)}
      </span>
    </div>
  );
}

function CueSelect({
  label, helper, points, value, onChange,
}: { label: string; helper: string; points: DropPoint[]; value: string | null; onChange: (value: string) => void }) {
  const options = points.length === 0
    ? [{ value: '', label: 'No detected cue' }]
    : points.map((point, index) => ({ value: point.id, label: `${index + 1}. ${point.label} · ${formatCueTime(point.dropMs)} · ${point.confidence}` }));
  return (
    <div className="min-w-[220px]">
      <FilterDropdown label={label} value={value ?? options[0].value} onChange={onChange} className="w-full" options={options} />
      <p className="mt-1 text-[10px] leading-tight text-muted-foreground">{helper}</p>
    </div>
  );
}

function Segmented({ label, helper, children }: { label: string; helper: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
      {children}
      <p className="mt-1 text-[10px] leading-tight text-muted-foreground">{helper}</p>
    </div>
  );
}

interface DropLabControlsProps {
  beatOffset: DropLabBeatOffset;
  barCount: DropLabBarCount;
  sourceDropPoints: DropPoint[];
  candidateDropPoints: DropPoint[];
  sourceDropId: string | null;
  candidateDropId: string | null;
  disabledReason: string | null;
  onSourceDropChange: (dropId: string) => void;
  onCandidateDropChange: (dropId: string) => void;
  onBeatOffsetChange: (offset: DropLabBeatOffset) => void;
  onBarCountChange: (count: DropLabBarCount) => void;
}

/** The four preview controls, laid out like the Cue Points filter row. */
export function DropLabControls({
  beatOffset, barCount, sourceDropPoints, candidateDropPoints, sourceDropId, candidateDropId, disabledReason,
  onSourceDropChange, onCandidateDropChange, onBeatOffsetChange, onBarCountChange,
}: DropLabControlsProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-start gap-x-6 gap-y-3 border-b border-[var(--color-border-faint)] px-4 py-3 lg:px-5">
      <CueSelect label="1 · Source exit cue" helper="The selected track plays up to this line." points={sourceDropPoints} value={sourceDropId} onChange={onSourceDropChange} />
      <CueSelect label="2 · Candidate entry cue" helper="The new track begins from this detected drop." points={candidateDropPoints} value={candidateDropId} onChange={onCandidateDropChange} />
      <Segmented label="3 · Line up the entry" helper="Move the candidate start around its detected drop.">
        <TabNavigation
          ariaLabel="Candidate drop alignment"
          variant="filter"
          value={String(beatOffset)}
          onChange={(value) => onBeatOffsetChange(Number(value) as DropLabBeatOffset)}
          options={[{ id: '-1', label: '−1 beat' }, { id: '0', label: 'On drop' }, { id: '1', label: '+1 beat' }]}
        />
      </Segmented>
      <Segmented label="4 · Preview length" helper="Choose how much build and drop audio to hear.">
        <TabNavigation
          ariaLabel="Comparison window"
          variant="filter"
          value={String(barCount)}
          onChange={(value) => onBarCountChange(Number(value) as DropLabBarCount)}
          options={[{ id: '4', label: '4 bars' }, { id: '8', label: '8 bars' }, { id: '16', label: '16 bars' }]}
        />
      </Segmented>
      <p className={cn('ml-auto max-w-[260px] self-center text-[10px] leading-snug', disabledReason ? 'text-amber-300' : 'text-muted-foreground')}>
        {disabledReason ?? 'Press play to hear the build, then the automatic swap into the candidate drop.'}
      </p>
    </div>
  );
}
