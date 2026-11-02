import { cn } from '../../lib/utils';
import type { DropPoint } from '../../lib/music/dropPointResolver';
import type { DropLabBarCount, DropLabBeatOffset } from '../../lib/music/dropLabSegments';
import { CircleDash, Play, RotateCounterclockwise, Stop } from '@carbon/icons-react';
import { FilterDropdown } from '../ui/controls';
import { TabNavigation } from '../ui/display';
import { AudioDock, MediaTransportControlGroup, PlaybackSeekBar } from '../ui/media';

function formatCueTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60).toString().padStart(2, '0')}`;
}

interface DropLabDockProps {
  previewLabel: string;
  previewDisabled: boolean;
  previewPlaying: boolean;
  previewLoading: boolean;
  previewError: boolean;
  /** 0 to 1 through the whole preview (build, then drop). */
  previewProgress: number;
  /** Length of the whole preview in seconds, or 0 when it is not known yet. */
  previewSeconds: number;
  disabledReason: string | null;
  onPreview: () => void;
}

/** The audio dock row: the same dock band, transport capsule and progress bar as Cue Points. */
export function DropLabDock({
  previewLabel, previewDisabled, previewPlaying, previewLoading, previewError, previewProgress, previewSeconds, disabledReason, onPreview,
}: DropLabDockProps) {
  const progress = Math.max(0, Math.min(1, previewProgress));
  return (
    <AudioDock data-testid="drop-lab-audio-dock" aria-label="Drop Lab audio dock" className="flex-none flex-row flex-wrap items-center gap-4">
      <MediaTransportControlGroup
        compact
        playOnly
        ariaLabel="Drop Lab transport controls"
        playing={previewPlaying}
        playLabel={previewDisabled && disabledReason ? `${previewLabel} (${disabledReason})` : previewLabel}
        playIcon={previewLoading
          ? <CircleDash size={16} className="animate-spin" />
          : previewPlaying ? <Stop size={14} fill="currentColor" /> : previewError ? <RotateCounterclockwise size={16} /> : <Play size={16} fill="currentColor" />}
        onTogglePlay={onPreview}
        playDisabled={previewDisabled}
      />
      <PlaybackSeekBar
        currentSeconds={progress * previewSeconds}
        durationSeconds={previewSeconds}
        seekable={false}
        readOnly
        ariaLabel="Transition preview position"
      />
    </AudioDock>
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
  /** When something blocks the preview, the status line above the dock already says what. */
  previewBlocked: boolean;
  onSourceDropChange: (dropId: string) => void;
  onCandidateDropChange: (dropId: string) => void;
  onBeatOffsetChange: (offset: DropLabBeatOffset) => void;
  onBarCountChange: (count: DropLabBarCount) => void;
}

/** The four preview controls, laid out like the Cue Points filter row. */
export function DropLabControls({
  beatOffset, barCount, sourceDropPoints, candidateDropPoints, sourceDropId, candidateDropId, previewBlocked,
  onSourceDropChange, onCandidateDropChange, onBeatOffsetChange, onBarCountChange,
}: DropLabControlsProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-start gap-x-6 gap-y-3 border-b border-[var(--color-border-faint)] px-4 py-3 lg:px-5">
      <CueSelect label="1 · Source exit cue" helper="The selected track plays up to this line." points={sourceDropPoints} value={sourceDropId} onChange={onSourceDropChange} />
      <CueSelect label="2 · Candidate entry cue" helper="The new track begins from this detected drop." points={candidateDropPoints} value={candidateDropId} onChange={onCandidateDropChange} />
      <Segmented label="3 · Line up the entry" helper="Move the candidate start around its detected drop.">
        <TabNavigation
          ariaLabel="Candidate drop alignment"
          variant="primary"
          value={String(beatOffset)}
          onChange={(value) => onBeatOffsetChange(Number(value) as DropLabBeatOffset)}
          options={[{ id: '-1', label: '−1 beat' }, { id: '0', label: 'On drop' }, { id: '1', label: '+1 beat' }]}
        />
      </Segmented>
      <Segmented label="4 · Preview length" helper="Choose how much build and drop audio to hear.">
        <TabNavigation
          ariaLabel="Comparison window"
          variant="primary"
          value={String(barCount)}
          onChange={(value) => onBarCountChange(Number(value) as DropLabBarCount)}
          options={[{ id: '4', label: '4 bars' }, { id: '8', label: '8 bars' }, { id: '16', label: '16 bars' }]}
        />
      </Segmented>
      {!previewBlocked && (
        <p className={cn('ml-auto max-w-[260px] self-center text-[10px] leading-snug text-muted-foreground')}>
          Press play to hear the build, then the automatic swap into the candidate drop.
        </p>
      )}
    </div>
  );
}
