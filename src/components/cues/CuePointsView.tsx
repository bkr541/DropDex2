import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, CircleDash, Export, Idea, Music, Save, Undo, Upload, WarningAlt } from '@carbon/icons-react';
import { AudioWaveform, Bookmark, Grip, List, RotateCcw } from 'lucide-react';
import { cn, formatKey } from '../../lib/utils';
import { isUsableBeatGrid } from '../../lib/music/beatGridHelpers';
import { applyAutoCueStrategy } from '../../lib/music/autoCueStrategy';
import {
  addWorkingCue,
  deleteWorkingCue,
  editWorkingCue,
  moveWorkingCue,
  nextAvailableHotCueSlot,
  hotCueSlotLabel,
  isCurrentTrackResponse,
  workingCueSetsEqual,
  type CueEditAction,
  type CueTimingMode,
  type WorkingCue,
} from '../../lib/music/cueEditorState';
import { useLibraryStats, useLibraryTracks } from '../../hooks/useRekordboxTracks';
import { useTrackPreviewWaveforms } from '../../hooks/useTrackPreviewWaveforms';
import { useRouteImport } from '../../hooks/useRouteEntities';
import { useAuthSession } from '../../hooks/useAuthSession';
import {
  fetchTrackBeatGrid,
  fetchTrackPhrases,
  fetchTrackVocalAnalysis,
  fetchTracksCueStates,
  type BeatEntry,
  type BeatGridRow,
  type CueLoadState,
  type PhraseRow,
  type VocalAnalysisRow,
} from '../../lib/queries/analysisData';
import { RekordboxPreviewWaveform, type WaveformColorSegment } from '../library/RekordboxPreviewWaveform';
import type { WaveformLoadState } from '../../lib/queries/waveformValidation';
import { ControlButton, SearchControl, SegmentedControl, SelectControl, TextControl } from '../ui/controls';
import { useTheme } from '../../theme/ThemeProvider';
import type { RekordboxTrack } from '../../types';
import {
  createCueDraftDocument,
  cueDraftStrategySummary,
  fingerprintCueDraftDocument,
  hydrateCueDraftDocument,
  type CueDraftValidationResult,
} from '../../lib/cues/cueDraftDocument';
import { fingerprintImportedLocalCueBaseline } from '../../lib/cues/localCueBaseline';
import {
  cueLoopRangeGeometry,
  resolveCueDisplayColor,
  summarizeCueProvenance,
} from '../../lib/cues/cueVisualization';
import { REKORDBOX_MEMORY_CUE_COLORS } from '../../lib/cues/rekordboxCueColorCodec';
import { loadCueEditorBaseline } from '../../lib/cues/cueBaselineLoader';
import { cueAnalysisLabel, cueAnalysisReady } from '../../lib/cues/cueReadiness';
import { cueFilterMatches, cueLoadCount, cueLoadOwnerMatches, type CueLoadOwner } from '../../lib/cues/cueLoadState';
import {
  CueDraftRevisionConflictError,
  fetchCueDraftsForApply,
  markCueDraftApplied,
  markCueDraftApplyOutcome,
  saveCueDraft,
  type CueDraftRow,
} from '../../lib/queries/cueDrafts';
import { resolveCueApplySelection, type CueApplyScope } from '../../lib/cues/cueApplyScope';
import type {
  DesktopCueApplyPreflightResult,
  DesktopCueApplyResult,
  DesktopCueDiffChange,
  DesktopCueDiffCue,
} from '../../types/dropdex-desktop';

interface CuePointsViewProps {
  importId: string | null;
  onImport: () => void;
}

type CueFilter = 'all' | 'with-cues' | 'without-cues';
type AnalysisFilter = 'all' | 'ready' | 'incomplete';
type CueDraftStatus = 'Original' | 'Unsaved' | 'Saved' | 'Needs Verification' | 'Needs Apply' | 'Applied';
type TerminalCueLoadStatus = 'loaded-empty' | 'loaded-with-cues' | 'failed';
type SelectedCueLoadStatus = 'idle' | 'loading' | TerminalCueLoadStatus;

interface CueRebaseRecoveryItem {
  row: CueDraftRow;
  postApplyLocalCueFingerprint: string | null;
}

interface CueRebaseRecoveryState {
  userId: string;
  importId: string;
  operationId: string;
  summary: Record<string, unknown>;
  items: CueRebaseRecoveryItem[];
}

const CUE_PAGE_SIZE = 100;
const MAX_TIMELINE_GRID_LINES = 640;
const MAX_BEAT_RULER_TICKS = 640;
const MAX_BAR_LABELS = 24;

interface TimelineSection {
  id: string;
  label: string;
  sourceLabel: string;
  startMs: number;
  endMs: number;
  panelColor: string;
  waveformColor: string;
}

const CAMELOT_COLORS: Record<number, string> = {
  1: '#e74c3c', 2: '#3b82f6', 3: '#1d4ed8', 4: '#f59e0b', 5: '#16a34a', 6: '#d97706',
  7: '#8b5cf6', 8: '#0d9488', 9: '#22c55e', 10: '#0891b2', 11: '#06b6d4', 12: '#ec4899',
};
function formatCamelotKey(key: string | null | undefined): string {
  const raw = formatKey(key);
  return raw.replace(/^(\d)([AB])$/i, (_, n, l) => `0${n}${l.toUpperCase()}`);
}

function camelotColor(key: string | null | undefined): string {
  if (!key) return '#6b7280';
  const m = key.match(/^(\d{1,2})[AB]$/i);
  if (!m) return '#6b7280';
  const n = parseInt(m[1], 10);
  return (n >= 1 && n <= 12) ? (CAMELOT_COLORS[n] ?? '#6b7280') : '#6b7280';
}

function durationMsForTrack(
  track: RekordboxTrack | null,
  beatGrid: BeatGridRow | null,
  phrases: PhraseRow[] = [],
): number | null {
  if (!track) return null;

  // Do not blindly trust one duration field. Some Rekordbox exports contain a
  // suspiciously small CONTENT length while PQTZ still contains a complete
  // multi-minute beat grid. The timeline must use the longest trustworthy
  // track/beat extent or every beat collapses against the right edge.
  const trackCandidates = [
    typeof track.duration_ms === 'number' && Number.isFinite(track.duration_ms) && track.duration_ms > 0
      ? track.duration_ms
      : null,
    typeof track.duration_seconds === 'number' && Number.isFinite(track.duration_seconds) && track.duration_seconds > 0
      ? track.duration_seconds * 1000
      : null,
  ].filter((value): value is number => value != null);

  const beats = beatGrid?.beats ?? [];
  const lastBeat = beats[beats.length - 1];
  const beatGridDuration = lastBeat && Number.isFinite(lastBeat.ms)
    ? lastBeat.ms + (lastBeat.bpm > 0 ? 60_000 / lastBeat.bpm : 500)
    : null;

  const authoritativeCandidates = [
    ...trackCandidates,
    beatGridDuration != null && Number.isFinite(beatGridDuration) && beatGridDuration > 0
      ? beatGridDuration
      : null,
  ].filter((value): value is number => value != null);

  if (authoritativeCandidates.length > 0) {
    return Math.max(...authoritativeCandidates);
  }

  const phraseCandidates = phrases.flatMap((phrase) => {
    if (phrase.end_ms != null && Number.isFinite(phrase.end_ms) && phrase.end_ms > 0) return [phrase.end_ms];
    if (phrase.start_ms != null && Number.isFinite(phrase.start_ms) && phrase.start_ms > 0) return [phrase.start_ms];
    return [];
  });
  return phraseCandidates.length > 0 ? Math.max(...phraseCandidates) : null;
}

function formatTime(milliseconds: number | null): string {
  if (milliseconds == null || !Number.isFinite(milliseconds) || milliseconds < 0) return '—';
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function cueLabel(cue: WorkingCue): string {
  if (cue.family === 'memory') return 'M';
  return hotCueSlotLabel(cue.hotCueSlot);
}

function cueDisplayName(cue: WorkingCue): string {
  const family = cue.family === 'hot' ? `Hot Cue ${cueLabel(cue)}` : 'Memory Cue';
  return cue.pointType === 'loop' ? `${family} Loop` : family;
}

function cueDiffLabel(cue: DesktopCueDiffCue): string {
  const family = cue.family === 'hot'
    ? `Hot Cue ${hotCueSlotLabel(cue.hot_cue_slot)}`
    : cue.family === 'memory' ? 'Memory Cue' : 'Unknown cue';
  return `${family}${cue.point_type === 'loop' ? ' Loop' : ''} @ ${formatTime(cue.start_ms)}`;
}

function cueDiffChangeLabel(change: DesktopCueDiffChange): string {
  const labels: Record<string, string> = {
    moved: 'moved',
    family: 'Hot/Memory',
    slot: 'slot',
    'point-type': 'cue/loop',
    'loop-extent': 'loop extent',
    comment: 'comment/name',
    color: 'color',
    'active-loop': 'active loop',
  };
  return change.changes.map((item) => labels[item] ?? item).join(', ');
}

function cueTimelineLabel(cue: WorkingCue, memoryIndex: number): string {
  if (cue.family === 'hot') return `Cue ${cueLabel(cue)}`;
  return `Memory ${memoryIndex + 1}`;
}

function analysisReady(track: RekordboxTrack): boolean {
  return cueAnalysisReady(track);
}

function analysisLabel(track: RekordboxTrack): string {
  return cueAnalysisLabel(track);
}

function timelineGridLines(beats: BeatEntry[]): BeatEntry[] {
  if (beats.length <= MAX_TIMELINE_GRID_LINES) return beats;
  const step = Math.ceil(beats.length / MAX_TIMELINE_GRID_LINES);
  const sampled = new Map<number, BeatEntry>();
  beats.forEach((beat, index) => {
    if (beat.isDownbeat || index % step === 0) sampled.set(beat.seq, beat);
  });
  return [...sampled.values()].sort((a, b) => a.ms - b.ms);
}

function beatRulerTicks(beats: BeatEntry[]): BeatEntry[] {
  if (beats.length <= MAX_BEAT_RULER_TICKS) return beats;
  const step = Math.ceil(beats.length / MAX_BEAT_RULER_TICKS);
  const sampled = new Map<number, BeatEntry>();
  beats.forEach((beat, index) => {
    if (beat.isDownbeat || index % step === 0) sampled.set(beat.seq, beat);
  });
  return [...sampled.values()].sort((a, b) => a.ms - b.ms);
}

function barLabelBeats(beats: BeatEntry[]): BeatEntry[] {
  const downbeats = beats.filter((beat) => beat.isDownbeat);
  if (downbeats.length <= MAX_BAR_LABELS) return downbeats;
  const step = Math.ceil(downbeats.length / MAX_BAR_LABELS);
  return downbeats.filter((_, index) => index % step === 0 || index === downbeats.length - 1);
}

function phraseBeatMs(beatGrid: BeatGridRow | null, beatNumber: number | null): number | null {
  if (beatNumber == null) return null;
  const beat = beatGrid?.beats.find((entry) => entry.seq === beatNumber);
  return beat?.ms ?? null;
}

function sectionDisplayLabel(sourceLabel: string | null, index: number): string {
  switch ((sourceLabel ?? '').toLowerCase()) {
    case 'up': return 'Build';
    case 'down': return 'Drop';
    case 'verse2': return 'Verse 2';
    case 'intro': return 'Intro';
    case 'verse': return 'Verse';
    case 'chorus': return 'Chorus';
    case 'bridge': return 'Bridge';
    case 'outro': return 'Outro';
    default: return sourceLabel
      ? sourceLabel.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
      : `Section ${index + 1}`;
  }
}

function sectionTone(label: string): { panelColor: string; waveformColor: string } {
  const normalized = label.toLowerCase();
  if (normalized.includes('intro')) return { panelColor: '#16477a', waveformColor: '#2997ff' };
  if (normalized.includes('verse')) return { panelColor: '#503477', waveformColor: '#a868f4' };
  if (normalized.includes('build') || normalized.includes('up')) return { panelColor: '#8d480d', waveformColor: '#ff8614' };
  if (normalized.includes('drop') || normalized.includes('down')) return { panelColor: '#8f2d2f', waveformColor: '#ff514b' };
  if (normalized.includes('chorus')) return { panelColor: '#8a2d61', waveformColor: '#f151a6' };
  if (normalized.includes('bridge')) return { panelColor: '#23656c', waveformColor: '#32c2c8' };
  if (normalized.includes('outro')) return { panelColor: '#3d526a', waveformColor: '#72a1cf' };
  return { panelColor: '#39434f', waveformColor: '#8d9aaa' };
}

function buildTimelineSections(
  phrases: PhraseRow[],
  beatGrid: BeatGridRow | null,
  durationMs: number | null,
): TimelineSection[] {
  if (durationMs == null || durationMs <= 0) return [];
  const positioned = phrases
    .map((phrase) => ({
      phrase,
      startMs: phrase.start_ms ?? phraseBeatMs(beatGrid, phrase.start_beat),
      endMs: phrase.end_ms ?? phraseBeatMs(beatGrid, phrase.end_beat),
    }))
    .filter((item): item is typeof item & { startMs: number } => item.startMs != null && Number.isFinite(item.startMs))
    .sort((a, b) => a.startMs - b.startMs);

  return positioned.flatMap((item, index) => {
    const nextStart = positioned[index + 1]?.startMs ?? null;
    const startMs = Math.max(0, Math.min(durationMs, item.startMs));
    const rawEnd = item.endMs ?? nextStart ?? durationMs;
    const endMs = Math.max(startMs, Math.min(durationMs, rawEnd));
    if (endMs <= startMs) return [];
    const sourceLabel = item.phrase.normalized_label ?? '';
    const label = sectionDisplayLabel(sourceLabel || null, index);
    const tone = sectionTone(label);
    return [{
      id: item.phrase.id,
      label,
      sourceLabel: sourceLabel || 'unmapped Rekordbox phrase',
      startMs,
      endMs,
      ...tone,
    }];
  });
}

function CueBpmRangeSlider({
  bounds,
  value,
  onChange,
  onReset,
}: {
  bounds: [number, number];
  value: [number, number];
  onChange: (range: [number, number]) => void;
  onReset: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [lo, hi] = value;
  const [bMin, bMax] = bounds;
  const span = bMax - bMin || 1;
  const loPct = ((lo - bMin) / span) * 100;
  const hiPct = ((hi - bMin) / span) * 100;
  const isFiltered = lo > bMin || hi < bMax;

  function valFromClientX(clientX: number): number {
    if (!trackRef.current) return bMin;
    const rect = trackRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(bMin + pct * span);
  }

  function handleLoPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const val = valFromClientX(e.clientX);
    onChange([Math.min(val, hi - 1), hi]);
  }

  function handleHiPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const val = valFromClientX(e.clientX);
    onChange([lo, Math.max(val, lo + 1)]);
  }

  return (
    <div className="min-w-[180px]">
      <div className="pb-2">
        <div className="flex items-center gap-1 mb-1">
          <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground">BPM</p>
          {isFiltered && (
            <button
              type="button"
              onClick={onReset}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Reset BPM filter"
            >
              <RotateCcw size={8} />
            </button>
          )}
        </div>
        <div ref={trackRef} className="relative h-5 select-none mx-3.5">
          <div className="absolute left-0 right-0 bottom-[5px] h-px bg-white/15 rounded-full" />
          <div
            className="absolute bottom-[5px] h-px bg-primary rounded-full"
            style={{ left: `${loPct}%`, right: `${100 - hiPct}%` }}
          />
          <div
            className="absolute bottom-[5px] translate-y-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-[var(--color-card)] border border-primary cursor-grab active:cursor-grabbing touch-none flex items-center justify-center"
            style={{ left: `${loPct}%` }}
            onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
            onPointerMove={handleLoPointerMove}
          >
            <span className="text-[8px] font-black text-foreground tabular-nums leading-none pointer-events-none">{lo}</span>
          </div>
          <div
            className="absolute bottom-[5px] translate-y-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-[var(--color-card)] border border-primary cursor-grab active:cursor-grabbing touch-none flex items-center justify-center"
            style={{ left: `${hiPct}%` }}
            onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
            onPointerMove={handleHiPointerMove}
          >
            <span className="text-[8px] font-black text-foreground tabular-nums leading-none pointer-events-none">{hi}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function CueFilterDropdown({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selectedLabel = options.find((o) => o.value === value)?.label ?? options[0]?.label ?? value;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative min-w-[130px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left pb-2 border-b border-white/15 hover:border-white/35 transition-colors focus-visible:outline-none"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground mb-1">{label}</p>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-foreground truncate">{selectedLabel}</span>
          <ChevronDown
            size={14}
            className={cn('shrink-0 text-muted-foreground transition-transform duration-200', open && 'rotate-180')}
            aria-hidden="true"
          />
        </div>
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute top-full left-0 mt-1.5 z-50 min-w-full glass rounded-xl border border-[var(--color-border-subtle)] overflow-hidden shadow-2xl"
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={value === opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={cn(
                'w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-white/[0.06]',
                value === opt.value ? 'text-foreground' : 'font-medium text-muted-foreground',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function percentageAt(ms: number, viewStart: number, viewEnd: number): number {
  return ((ms - viewStart) / (viewEnd - viewStart)) * 100;
}

function beatPositionLabel(beat: BeatEntry | undefined): string {
  if (!beat) return '—';
  return `${beat.bar}.${beat.beatInBar}.1`;
}

function TimelineLaneLabel({ icon, label, children }: { icon: ReactNode; label: string; children?: ReactNode }) {
  return (
    <div className="flex h-full items-center gap-3.5 rounded-[8px] border border-[#26313a] bg-[#11181e] px-[18px] text-[#d9dde1] shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
      <span className="shrink-0 text-[#aeb7bf]" aria-hidden="true">{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-[14px] font-semibold tracking-[-0.015em]">{label}</p>
        {children}
      </div>
    </div>
  );
}

function CueInspector({
  cue,
  cues,
  timingMode,
  onMoveCue,
  onEditCue,
  onMessage,
  editable = true,
}: {
  cue: WorkingCue;
  cues: WorkingCue[];
  timingMode: CueTimingMode;
  onMoveCue: (cueId: string, requestedMs: number, timingMode: CueTimingMode) => string | null;
  onEditCue: (cueId: string, action: CueEditAction) => string | null;
  onMessage: (message: string | null) => void;
  editable?: boolean;
}) {
  const occupiedByOther = useMemo(() => new Set(
    cues
      .filter((candidate) => candidate.editorId !== cue.editorId && candidate.family === 'hot' && candidate.hotCueSlot != null)
      .map((candidate) => candidate.hotCueSlot as number),
  ), [cue.editorId, cues]);
  const familySlotValue = cue.family === 'memory' ? 'memory' : `hot:${cue.hotCueSlot ?? ''}`;
  const loopLengthMs = cue.pointType === 'loop' && cue.startMs != null && cue.endMs != null
    ? Math.max(0, cue.endMs - cue.startMs)
    : null;
  const knownMemoryColor = cue.rekordboxColor == null || cue.rekordboxColor === -1
    ? null
    : REKORDBOX_MEMORY_CUE_COLORS.find((option) => option.index === cue.rekordboxColor) ?? null;
  const displayColor = resolveCueDisplayColor(cue);
  const provenance = summarizeCueProvenance(cue);

  const commitNumber = (
    rawValue: string,
    currentValue: number | null,
    commit: (value: number) => string | null,
    input: HTMLInputElement,
  ) => {
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0) {
      input.value = currentValue == null ? '' : String(currentValue);
      onMessage('Timing must be a non-negative millisecond value.');
      return;
    }
    if (currentValue != null && value === currentValue) {
      onMessage(null);
      return;
    }
    const error = commit(value);
    onMessage(error);
    if (error) input.value = currentValue == null ? '' : String(currentValue);
  };

  const commitHotColorIndex = (rawValue: string, input: HTMLInputElement) => {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      if (cue.colorTableIndex == null && cue.colorName == null && cue.colorHex == null) {
        onMessage(null);
        return;
      }
      onMessage(onEditCue(cue.editorId, { kind: 'hot-color-table', colorTableIndex: null }));
      return;
    }
    const value = Number(trimmed);
    if (!Number.isInteger(value) || value < 0) {
      input.value = cue.colorTableIndex == null ? '' : String(cue.colorTableIndex);
      onMessage('Hot Cue color table index must be a non-negative integer.');
      return;
    }
    if (value === cue.colorTableIndex) {
      onMessage(null);
      return;
    }
    const error = onEditCue(cue.editorId, { kind: 'hot-color-table', colorTableIndex: value });
    onMessage(error);
    if (error) input.value = cue.colorTableIndex == null ? '' : String(cue.colorTableIndex);
  };

  return (
    <div className="mx-3 mb-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 md:mx-4" data-testid="selected-cue-inspector">
      <div className="min-w-0">
        <p className="text-[9px] font-black uppercase tracking-[0.16em] text-muted-foreground">Selected cue</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-sm font-black">{cueDisplayName(cue)}</span>
          <span className="rounded-md border border-white/10 px-2 py-0.5 font-mono text-[9px] text-muted-foreground">
            {timingMode === 'snap' ? 'SNAP · Rekordbox grid' : 'EXACT · integer ms'}
          </span>
        </div>
      </div>

      <div className="mt-3 grid gap-2 rounded-lg border border-white/[0.06] bg-black/10 p-2.5 md:grid-cols-3" data-testid="cue-metadata-summary">
        <div className="min-w-0">
          <p className="text-[8px] font-black uppercase tracking-[0.14em] text-muted-foreground">Display color</p>
          <div className="mt-1 flex items-center gap-2 text-[11px] font-semibold">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/20" style={{ backgroundColor: displayColor.hex }} aria-hidden="true" />
            <span className="truncate">{displayColor.label}</span>
            {displayColor.source === 'unknown' && <span className="shrink-0 text-amber-300">Unknown mapping</span>}
          </div>
        </div>
        <div className="min-w-0">
          <p className="text-[8px] font-black uppercase tracking-[0.14em] text-muted-foreground">Provenance</p>
          <p className="mt-1 text-[11px] font-semibold">{provenance.sources}{cue.sourceKind ? ` · ${cue.sourceKind}` : ''}</p>
          <p className="mt-0.5 text-[9px] text-muted-foreground">{provenance.resolution}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[8px] font-black uppercase tracking-[0.14em] text-muted-foreground">Conflict status</p>
          <p className={cn('mt-1 text-[11px] font-bold', provenance.blocking ? 'text-amber-200' : 'text-emerald-300')}>
            {provenance.blocking ? 'Blocking conflict' : 'No blocking conflict'}
          </p>
          {provenance.conflict && <p className="mt-0.5 text-[9px] text-amber-100/80">{provenance.conflict}</p>}
        </div>
      </div>

      {!editable && (
        <p className="mt-2 text-[9px] font-semibold text-amber-200">This cue is inspectable but read-only until the canonical cue baseline is safe.</p>
      )}

      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="min-w-0 text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Family / Hot slot
          <SelectControl
            className="mt-1"
            disabled={!editable}
            value={familySlotValue}
            onChange={(event) => {
              const value = event.target.value;
              const error = value === 'memory'
                ? onEditCue(cue.editorId, { kind: 'family', family: 'memory' })
                : (() => {
                  const slot = Number(value.split(':')[1]);
                  return cue.family === 'hot'
                    ? onEditCue(cue.editorId, { kind: 'hot-slot', hotCueSlot: slot })
                    : onEditCue(cue.editorId, { kind: 'family', family: 'hot', hotCueSlot: slot });
                })();
              onMessage(error);
            }}
          >
            <option value="memory">Memory Cue</option>
            {Array.from({ length: 8 }, (_, index) => index + 1).map((slot) => (
              <option key={slot} value={`hot:${slot}`} disabled={occupiedByOther.has(slot)}>
                Hot Cue {hotCueSlotLabel(slot)}{occupiedByOther.has(slot) ? ' · occupied' : ''}
              </option>
            ))}
          </SelectControl>
        </label>

        <label className="min-w-0 text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Cue type
          <SelectControl
            className="mt-1"
            disabled={!editable}
            value={cue.pointType}
            onChange={(event) => onMessage(onEditCue(cue.editorId, {
              kind: 'point-type',
              pointType: event.target.value as 'cue' | 'loop',
            }))}
          >
            <option value="cue">Cue point</option>
            <option value="loop">Loop · 4-bar default</option>
          </SelectControl>
        </label>

        <label className="min-w-0 text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Start (ms)
          <TextControl
            key={`${cue.editorId}:start:${cue.startMs}`}
            className="mt-1 font-mono tabular-nums"
            disabled={!editable}
            type="number"
            min={0}
            step={1}
            defaultValue={cue.startMs ?? ''}
            onBlur={(event) => commitNumber(
              event.currentTarget.value,
              cue.startMs,
              (value) => onMoveCue(cue.editorId, value, timingMode),
              event.currentTarget,
            )}
          />
        </label>

        <label className="min-w-0 text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          {cue.family === 'memory' ? 'Memory DjmdCue.Color' : 'Hot color table index'}
          {cue.family === 'memory' ? (
            <SelectControl
              className="mt-1"
              disabled={!editable}
              value={cue.rekordboxColor == null || cue.rekordboxColor === -1 ? 'clear' : String(cue.rekordboxColor)}
              onChange={(event) => {
                if (event.target.value === 'clear') {
                  onMessage(onEditCue(cue.editorId, { kind: 'memory-color', rekordboxColor: -1, colorHex: null, colorName: null }));
                  return;
                }
                const index = Number(event.target.value);
                const option = REKORDBOX_MEMORY_CUE_COLORS.find((candidate) => candidate.index === index);
                if (!option) return;
                onMessage(onEditCue(cue.editorId, {
                  kind: 'memory-color',
                  rekordboxColor: option.index,
                  colorHex: option.hex,
                  colorName: option.name,
                }));
              }}
            >
              <option value="clear">Unspecified / clear</option>
              {!knownMemoryColor && cue.rekordboxColor != null && cue.rekordboxColor !== -1 && (
                <option value={String(cue.rekordboxColor)}>Current Color {cue.rekordboxColor}</option>
              )}
              {REKORDBOX_MEMORY_CUE_COLORS.map((option) => (
                <option key={option.index} value={String(option.index)}>{option.label}</option>
              ))}
            </SelectControl>
          ) : (
            <TextControl
              key={`${cue.editorId}:color-index:${cue.colorTableIndex}`}
              className="mt-1 font-mono tabular-nums"
              disabled={!editable}
              type="number"
              min={0}
              step={1}
              defaultValue={cue.colorTableIndex ?? ''}
              placeholder="Unspecified"
              onBlur={(event) => commitHotColorIndex(event.currentTarget.value, event.currentTarget)}
            />
          )}
        </label>
      </div>

      {cue.pointType === 'loop' && (
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Loop end (ms)
            <TextControl
              key={`${cue.editorId}:end:${cue.endMs}`}
              className="mt-1 font-mono tabular-nums"
              disabled={!editable}
              type="number"
              min={0}
              step={1}
              defaultValue={cue.endMs ?? ''}
              onBlur={(event) => commitNumber(
                event.currentTarget.value,
                cue.endMs,
                (value) => onEditCue(cue.editorId, { kind: 'end-ms', requestedMs: value, timingMode }),
                event.currentTarget,
              )}
            />
          </label>
          <label className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Loop length (ms)
            <TextControl
              key={`${cue.editorId}:length:${loopLengthMs}`}
              className="mt-1 font-mono tabular-nums"
              disabled={!editable}
              type="number"
              min={1}
              step={1}
              defaultValue={loopLengthMs ?? ''}
              onBlur={(event) => commitNumber(
                event.currentTarget.value,
                loopLengthMs,
                (value) => onEditCue(cue.editorId, { kind: 'loop-length-ms', requestedMs: value, timingMode }),
                event.currentTarget,
              )}
            />
          </label>
          <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Active loop
            <button
              type="button"
              aria-pressed={cue.isActiveLoop === true}
              disabled={!editable}
              className={cn(
                'mt-1 flex min-h-10 w-full items-center justify-between rounded-lg border px-3 text-xs font-bold normal-case tracking-normal transition-colors',
                cue.isActiveLoop === true
                  ? 'border-primary/40 bg-primary/10 text-foreground'
                  : 'border-[var(--color-border-subtle)] bg-[var(--color-surface)] text-muted-foreground hover:text-foreground',
              )}
              onClick={() => onMessage(onEditCue(cue.editorId, { kind: 'active-loop', isActiveLoop: cue.isActiveLoop !== true }))}
            >
              <span>{cue.isActiveLoop === true ? 'Enabled' : 'Disabled'}</span>
              <span className="font-mono text-[9px]">{cue.beatLoopNumerator && cue.beatLoopDenominator ? `${cue.beatLoopNumerator}/${cue.beatLoopDenominator}` : 'custom'}</span>
            </button>
          </div>
        </div>
      )}

      <label className="mt-3 block text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        Comment / name
        <TextControl
          className="mt-1"
          disabled={!editable}
          value={cue.comment ?? ''}
          maxLength={255}
          onChange={(event) => onMessage(onEditCue(cue.editorId, { kind: 'comment', comment: event.target.value || null }))}
          placeholder="Cue comment"
        />
      </label>
      <p className="mt-2 text-[9px] text-muted-foreground">
        Snap is the default. Exact mode records deliberate integer-millisecond timing and does not resnap existing cues merely by selecting or opening them.
      </p>
    </div>
  );
}

type CueContextMenuState =
  | { kind: 'add'; x: number; y: number; requestedMs: number }
  | { kind: 'cue'; x: number; y: number; cueId: string };

function CueWaveformPanel({
  track,
  beatGrid,
  cues,
  phrases,
  cueLoading,
  cueLoadStatus,
  cueLoadError,
  cueIntegrity,
  beatGridLoading,
  phraseLoading,
  waveformState,
  dirty,
  draftStatus,
  baselineProofRefreshNeeded,
  saving,
  persistenceMessage,
  editingBlockedReason,
  onRetryCues,
  onRetryWaveform,
  onAddCue,
  onMoveCue,
  onEditCue,
  onDeleteCue,
  onDiscard,
  onAutoCue,
  onSave,
  applyTrackAvailable,
  applyAllCount,
  applying,
  onApplyTrack,
  onApplyAll,
}: {
  track: RekordboxTrack | null;
  beatGrid: BeatGridRow | null;
  cues: WorkingCue[];
  phrases: PhraseRow[];
  cueLoading: boolean;
  cueLoadStatus: SelectedCueLoadStatus;
  cueLoadError: string | null;
  cueIntegrity: CueDraftValidationResult | null;
  beatGridLoading: boolean;
  phraseLoading: boolean;
  waveformState: WaveformLoadState;
  dirty: boolean;
  draftStatus: CueDraftStatus;
  baselineProofRefreshNeeded: boolean;
  saving: boolean;
  persistenceMessage: string | null;
  editingBlockedReason: string | null;
  onRetryCues: () => void;
  onRetryWaveform: () => void;
  onAddCue: (family: 'hot' | 'memory', requestedMs: number, timingMode: CueTimingMode) => string | null;
  onMoveCue: (cueId: string, requestedMs: number, timingMode: CueTimingMode) => string | null;
  onEditCue: (cueId: string, action: CueEditAction) => string | null;
  onDeleteCue: (cueId: string) => void;
  onDiscard: () => void;
  onAutoCue: () => string | null;
  onSave: () => Promise<string | null>;
  applyTrackAvailable: boolean;
  applyAllCount: number;
  applying: boolean;
  onApplyTrack: () => void;
  onApplyAll: () => void;
}) {
  const { theme } = useTheme();
  const durationMs = durationMsForTrack(track, beatGrid, phrases);

  const [viewStart, setViewStart] = useState(0);
  const [viewEnd, setViewEnd] = useState<number | null>(null);
  const [selectedCueId, setSelectedCueId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<CueContextMenuState | null>(null);
  const [editorMessage, setEditorMessage] = useState<string | null>(null);
  const [timingMode, setTimingMode] = useState<CueTimingMode>('snap');
  const dragStateRef = useRef<{ cueId: string; pointerId: number; startX: number; moved: boolean } | null>(null);
  const effectiveViewEnd = viewEnd ?? durationMs ?? 0;

  useEffect(() => {
    setViewStart(0);
    setViewEnd(null);
    setSelectedCueId(null);
    setContextMenu(null);
    setEditorMessage(null);
    dragStateRef.current = null;
  }, [track?.id, durationMs]);

  useEffect(() => {
    setTimingMode('snap');
  }, [track?.id]);

  useEffect(() => {
    if (!contextMenu) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [contextMenu]);

  useEffect(() => {
    if (selectedCueId && !cues.some((cue) => cue.editorId === selectedCueId)) setSelectedCueId(null);
  }, [cues, selectedCueId]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (!durationMs || durationMs <= 0) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const vStart = viewStart;
    const vEnd = viewEnd ?? durationMs;
    const focusMs = vStart + fraction * (vEnd - vStart);
    const factor = e.deltaY > 0 ? 1.06 : 1 / 1.06;
    const range = Math.max(2000, Math.min(durationMs, (vEnd - vStart) * factor));
    let newStart = focusMs - fraction * range;
    let newEnd = focusMs + (1 - fraction) * range;
    if (newStart < 0) { newEnd = Math.min(durationMs, newEnd - newStart); newStart = 0; }
    if (newEnd > durationMs) { newStart = Math.max(0, newStart - (newEnd - durationMs)); newEnd = durationMs; }
    setViewStart(newStart);
    setViewEnd(newEnd);
  }, [durationMs, viewStart, viewEnd]);

  const sections = useMemo(
    () => buildTimelineSections(phrases, beatGrid, durationMs),
    [beatGrid, durationMs, phrases],
  );
  const gridLines = useMemo(() => timelineGridLines(beatGrid?.beats ?? []), [beatGrid]);
  const rulerTicks = useMemo(() => beatRulerTicks(beatGrid?.beats ?? []), [beatGrid]);
  const rulerLabels = useMemo(() => barLabelBeats(beatGrid?.beats ?? []), [beatGrid]);
  const positionedCues = useMemo(
    () => cues.filter((cue) => cue.startMs != null && durationMs != null && durationMs > 0),
    [cues, durationMs],
  );
  const memoryCueIndexes = useMemo(() => {
    let memoryIndex = 0;
    return new Map(positionedCues.map((cue) => {
      const index = cue.family === 'memory' ? memoryIndex++ : memoryIndex;
      return [cue.editorId, index] as const;
    }));
  }, [positionedCues]);
  const waveformColorSegments = useMemo<WaveformColorSegment[]>(() => {
    if (durationMs == null || durationMs <= 0) return [];
    return sections.map((section) => ({
      startFraction: section.startMs / durationMs,
      endFraction: section.endMs / durationMs,
      color: section.waveformColor,
    }));
  }, [durationMs, sections]);
  const hasUsableGrid = useMemo(() => isUsableBeatGrid(beatGrid?.beats ?? []), [beatGrid]);
  const availableHotCueSlot = useMemo(() => nextAvailableHotCueSlot(cues), [cues]);
  const selectedCue = useMemo(() => cues.find((cue) => cue.editorId === selectedCueId) ?? null, [cues, selectedCueId]);
  const cueBaselineComplete = cueLoadStatus === 'loaded-empty' || cueLoadStatus === 'loaded-with-cues';
  const cueEditingAllowed = cueBaselineComplete && cueIntegrity?.status === 'valid' && !editingBlockedReason;
  const cueIntegrityError = editingBlockedReason
    ?? (cueIntegrity && cueIntegrity.status !== 'valid' ? cueIntegrity.error ?? 'Cue baseline is not safe to edit.' : null);
  const autoCueReady = Boolean(
    track
    && cueEditingAllowed
    && !beatGridLoading
    && !phraseLoading
    && hasUsableGrid
    && beatGrid?.track_id === track.id
    && phrases.every((phrase) => phrase.track_id === track.id),
  );

  const timeAtClientX = useCallback((clientX: number, element: HTMLElement): number | null => {
    if (effectiveViewEnd <= viewStart) return null;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return viewStart + fraction * (effectiveViewEnd - viewStart);
  }, [effectiveViewEnd, viewStart]);

  const handleWaveformContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setSelectedCueId(null);
    if (cueLoading) {
      setContextMenu(null);
      setEditorMessage('Cue editing will be available when the imported cue baseline finishes loading.');
      return;
    }
    if (!cueBaselineComplete) {
      setContextMenu(null);
      setEditorMessage(cueLoadError ?? 'Cue editing is unavailable until the complete cue baseline loads successfully.');
      return;
    }
    if (!cueEditingAllowed) {
      setContextMenu(null);
      setEditorMessage(cueIntegrityError);
      return;
    }
    if (timingMode === 'snap' && beatGridLoading) {
      setContextMenu(null);
      setEditorMessage('Cue editing will be available when the Rekordbox beat grid finishes loading.');
      return;
    }
    if (timingMode === 'snap' && !hasUsableGrid) {
      setContextMenu(null);
      setEditorMessage('Beat snapping is unavailable because this track has no valid Rekordbox beat grid. Switch to Exact ms for deliberate off-grid timing.');
      return;
    }
    const requestedMs = timeAtClientX(event.clientX, event.currentTarget);
    if (requestedMs == null) {
      setContextMenu(null);
      setEditorMessage('Unable to resolve a cue position from the waveform.');
      return;
    }
    setEditorMessage(null);
    setContextMenu({ kind: 'add', x: event.clientX, y: event.clientY, requestedMs });
  }, [beatGridLoading, cueBaselineComplete, cueEditingAllowed, cueIntegrityError, cueLoadError, cueLoading, hasUsableGrid, timeAtClientX, timingMode]);

  const handleCuePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>, cueId: string) => {
    if (event.button !== 0) return;
    setSelectedCueId(cueId);
    setContextMenu(null);
    if (!cueEditingAllowed) {
      setEditorMessage(cueIntegrityError);
      return;
    }
    dragStateRef.current = { cueId, pointerId: event.pointerId, startX: event.clientX, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [cueEditingAllowed, cueIntegrityError]);

  const handleCuePointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    if (!drag.moved && Math.abs(event.clientX - drag.startX) < 3) return;
    drag.moved = true;
    const lane = event.currentTarget.parentElement;
    if (!lane) return;
    const requestedMs = timeAtClientX(event.clientX, lane);
    if (requestedMs == null) return;
    const error = onMoveCue(drag.cueId, requestedMs, timingMode);
    setEditorMessage(error);
  }, [onMoveCue, timeAtClientX, timingMode]);

  const handleCuePointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragStateRef.current;
    if (drag?.pointerId === event.pointerId && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
  }, []);

  const handleCueContextMenu = useCallback((event: React.MouseEvent<HTMLButtonElement>, cueId: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (!cueEditingAllowed) {
      setEditorMessage(cueIntegrityError);
      setContextMenu(null);
      return;
    }
    setSelectedCueId(cueId);
    setContextMenu({ kind: 'cue', x: event.clientX, y: event.clientY, cueId });
  }, [cueEditingAllowed, cueIntegrityError]);

  if (!track) {
    return (
      <section className="glass rounded-2xl border border-[var(--color-border-subtle)] overflow-hidden">
        <div className="flex min-h-[310px] flex-col items-center justify-center px-6 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
            <Music size={26} />
          </div>
          <h2 className="text-lg font-black">Select a track to inspect cue points</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Track sections, imported cues, the Rekordbox waveform, and the beat grid will appear in one aligned timeline.
          </p>
        </div>
      </section>
    );
  }

  const keyDisplay = formatCamelotKey(track.musical_key);
  const bpmDisplay = track.bpm != null ? track.bpm.toFixed(2) : '—';
  const durationDisplay = formatTime(durationMs);

  return (
    <section className="glass rounded-2xl border border-[var(--color-border-subtle)] overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-[var(--color-border-subtle)] px-5 py-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-muted-foreground">{track.artist ?? 'Artist Not Stored'}</p>
          <h1 className="mt-1 truncate text-xl font-black tracking-tight md:text-2xl">{track.title}</h1>
        </div>

        <div className="flex flex-wrap items-stretch gap-2 xl:justify-end">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['BPM', bpmDisplay],
              ['Key', keyDisplay],
              ['Duration', durationDisplay],
              ['Cues', cueLoading ? '…' : cueLoadStatus === 'failed' ? '!' : String(cues.length)],
            ].map(([label, value]) => {
              const kc = label === 'Key' ? camelotColor(track.musical_key) : null;
              return (
                <div key={label} className="min-w-[88px] rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2"
                  style={kc ? { backgroundColor: kc, borderColor: 'transparent' } : undefined}>
                  <span className="block text-[8px] font-bold uppercase tracking-[0.18em]"
                    style={kc ? { color: 'rgba(255,255,255,0.65)' } : undefined}>{label}</span>
                  <span className="mt-1 block font-mono text-sm font-black tabular-nums"
                    style={kc ? { color: 'rgba(255,255,255,0.88)' } : undefined}>{value}</span>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[148px]">
              <SegmentedControl
                ariaLabel="Cue timing mode"
                value={timingMode}
                onChange={(value) => setTimingMode(value as CueTimingMode)}
                options={[{ value: 'snap', label: 'Snap' }, { value: 'exact', label: 'Exact ms' }]}
              />
            </div>
            <ControlButton
              variant="surface"
              disabled={!autoCueReady}
              onClick={() => setEditorMessage(onAutoCue())}
              title={autoCueReady ? 'Auto Cue: generate deterministic A–H cue proposals' : "Auto Cue requires the selected track's exact beat grid and phrase data to finish loading"}
            >
              <Idea size={17} />
            </ControlButton>
            <ControlButton
              variant="ghost"
              disabled={!dirty || !cueEditingAllowed || saving}
              onClick={onDiscard}
              title="Discard unsaved cue changes"
            >
              <Undo size={17} />
            </ControlButton>
            <ControlButton
              variant="surface"
              disabled={(!dirty && !baselineProofRefreshNeeded) || !cueEditingAllowed || saving}
              onClick={() => { void onSave().then(setEditorMessage); }}
              title={saving
                ? 'Saving cue changes…'
                : baselineProofRefreshNeeded && !dirty
                  ? 'Refresh verified cue baseline proof for this legacy draft'
                  : 'Save cue changes'}
            >
              {saving ? <CircleDash size={17} className="animate-spin" /> : <Save size={17} />}
            </ControlButton>
            <ControlButton
              variant="surface"
              disabled={!applyTrackAvailable || applying}
              onClick={onApplyTrack}
              title={applyTrackAvailable ? 'Apply only the selected track to local Rekordbox' : 'Apply Track requires a saved pending draft for the selected track'}
            >
              {applying ? <CircleDash size={17} className="animate-spin" /> : <Export size={17} />}
              <span>Apply Track</span>
            </ControlButton>
            <ControlButton
              variant="primary"
              disabled={applyAllCount === 0 || applying}
              onClick={onApplyAll}
              title={applyAllCount > 0 ? `Apply all ${applyAllCount} saved track changes to local Rekordbox` : 'Apply All requires at least one saved draft that needs apply'}
            >
              {applying ? <CircleDash size={17} className="animate-spin" /> : <Export size={17} />}
              <span>Apply All ({applyAllCount})</span>
            </ControlButton>
          </div>
        </div>
      </div>

      {cueBaselineComplete && cueIntegrity && cueIntegrity.status !== 'valid' && (
        <div className="mx-5 mt-3 flex items-start justify-between gap-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2 text-amber-100" role="status">
          <div className="flex min-w-0 items-start gap-2">
            <WarningAlt size={16} className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.12em]">
                {cueIntegrity.status === 'unresolved' ? 'Cue ownership unresolved' : 'Cue baseline invalid'}
              </p>
              <p className="mt-0.5 text-[11px] text-amber-100/80">{cueIntegrityError}</p>
            </div>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-md border border-amber-200/20 px-2 py-1 text-[9px] font-black uppercase tracking-[0.1em] hover:bg-amber-200/[0.08]"
            onClick={onRetryCues}
          >
            Retry baseline
          </button>
        </div>
      )}

      <div className="px-3 pb-2 pt-2 md:px-4">
        <div className="overflow-x-auto rounded-[18px]">
          <div className="min-w-[980px] rounded-[18px] border border-[#2a353e] bg-[#090e13] p-[7px] shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
            <div className="grid grid-cols-[174px_minmax(0,1fr)] gap-x-[5px] gap-y-[4px]">
              <div className="h-[40px]">
                <TimelineLaneLabel icon={<List size={19} strokeWidth={2.35} />} label="Sections" />
              </div>
              <div className="relative h-[40px] overflow-hidden rounded-[8px] border border-[#26313a] bg-[#0d1318]">
                {phraseLoading ? (
                  <div className="flex h-full items-center px-5 text-[11px] font-medium text-[#707b85]">Loading track sections…</div>
                ) : sections.length === 0 ? (
                  <div className="absolute inset-0 flex items-center px-5">
                    <div className="h-[30px] w-full rounded-[5px] border border-white/[0.035] bg-white/[0.015]" />
                    <span className="absolute left-8 text-[10px] font-medium uppercase tracking-[0.12em] text-[#66717b]">
                      Sections unavailable
                    </span>
                  </div>
                ) : (
                  sections.map((section) => {
                    const left = percentageAt(section.startMs, viewStart, effectiveViewEnd);
                    return (
                      <div
                        key={section.id}
                        className="absolute top-0 bottom-0 flex flex-col justify-start pt-[5px] pl-1.5"
                        style={{ left: `${left}%` }}
                        title={`${section.label} · ${formatTime(section.startMs)}–${formatTime(section.endMs)}`}
                      >
                        <span
                          className="absolute top-0 bottom-0 left-0 w-px"
                          style={{ backgroundColor: section.waveformColor }}
                          aria-hidden="true"
                        />
                        <span
                          className="whitespace-nowrap font-mono text-[9px] font-bold leading-none"
                          style={{ color: section.waveformColor }}
                        >
                          {section.label}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="h-[40px]">
                <TimelineLaneLabel icon={<Bookmark size={19} strokeWidth={2.25} />} label="Cues" />
              </div>
              <div className="relative h-[40px] overflow-hidden rounded-[8px] border border-[#26313a] bg-[#0d1318]">
                {cueLoading ? (
                  <div className="flex h-full items-center px-5 text-[11px] font-medium text-[#707b85]">Loading cue points…</div>
                ) : cueLoadStatus === 'failed' ? (
                  <div className="flex h-full items-center justify-between gap-3 px-5 text-[10px] font-semibold text-red-300">
                    <span className="truncate">{cueLoadError ?? 'Cue points could not be loaded.'}</span>
                    <button
                      type="button"
                      className="shrink-0 rounded-md border border-red-300/20 px-2 py-1 text-[9px] font-black uppercase tracking-[0.1em] hover:bg-red-300/[0.08]"
                      onClick={onRetryCues}
                    >
                      Retry
                    </button>
                  </div>
                ) : positionedCues.length === 0 ? (
                  <div className="flex h-full items-center px-5 text-[10px] font-medium uppercase tracking-[0.12em] text-[#5e6973]">
                    No cue points
                  </div>
                ) : (
                  <>
                    {positionedCues.map((cue) => {
                      const range = cueLoopRangeGeometry(cue, viewStart, effectiveViewEnd);
                      if (!range?.visible) return null;
                      const displayColor = resolveCueDisplayColor(cue);
                      return (
                        <span
                          key={`cue-loop-range-${cue.editorId}`}
                          data-testid="cue-loop-range"
                          className="pointer-events-none absolute bottom-[5px] top-[5px] z-10 rounded-[3px] border"
                          style={{
                            left: `${range.leftPercent}%`,
                            width: `${range.widthPercent}%`,
                            minWidth: '2px',
                            borderColor: `${displayColor.hex}AA`,
                            backgroundColor: `${displayColor.hex}24`,
                          }}
                          title={`${cueDisplayName(cue)} range · ${formatTime(cue.startMs)}–${formatTime(cue.endMs)}`}
                        >
                          <span className="absolute bottom-0 right-0 top-0 w-px" style={{ backgroundColor: displayColor.hex }} aria-hidden="true" />
                        </span>
                      );
                    })}
                    {positionedCues.map((cue) => {
                      const left = percentageAt(cue.startMs ?? 0, viewStart, effectiveViewEnd);
                      const displayColor = resolveCueDisplayColor(cue);
                      const markerColor = displayColor.hex;
                      const memoryIndex = memoryCueIndexes.get(cue.editorId) ?? 0;
                      const selected = selectedCueId === cue.editorId;
                      return (
                        <button
                          key={cue.editorId}
                          type="button"
                          data-testid={cue.pointType === 'loop' ? 'cue-loop-start-marker' : 'cue-point-marker'}
                          className={cn(
                            'absolute top-0 bottom-0 z-20 w-10 -translate-x-1/2 rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-white/70',
                            cueEditingAllowed ? 'cursor-ew-resize' : 'cursor-pointer',
                            selected && 'bg-white/[0.05]',
                          )}
                          style={{ left: `${left}%` }}
                          title={`${cueDisplayName(cue)} · ${formatTime(cue.startMs)}${cue.pointType === 'loop' ? `–${formatTime(cue.endMs)}` : ''} · ${cue.comment || 'No comment'} · ${displayColor.label} · ${summarizeCueProvenance(cue).sources}`}
                          aria-label={`${cueDisplayName(cue)} at ${formatTime(cue.startMs)}${cue.pointType === 'loop' ? ` through ${formatTime(cue.endMs)}` : ''}. ${cueEditingAllowed ? 'Drag to reposition, click to edit, or press Delete to remove.' : 'Read-only because cue integrity is blocked.'}`}
                          onFocus={() => setSelectedCueId(cue.editorId)}
                          onPointerDown={(event) => handleCuePointerDown(event, cue.editorId)}
                          onPointerMove={handleCuePointerMove}
                          onPointerUp={handleCuePointerUp}
                          onPointerCancel={handleCuePointerUp}
                          onContextMenu={(event) => handleCueContextMenu(event, cue.editorId)}
                          onKeyDown={(event) => {
                            if (cueEditingAllowed && (event.key === 'Delete' || event.key === 'Backspace')) {
                              event.preventDefault();
                              onDeleteCue(cue.editorId);
                              setSelectedCueId(null);
                              setEditorMessage(null);
                            }
                          }}
                        >
                        <span
                          className="absolute top-0 bottom-0 left-1/2 w-px -translate-x-1/2"
                          style={{ backgroundColor: markerColor }}
                          aria-hidden="true"
                        />
                        <span
                          className="pointer-events-none absolute top-[4px] left-1/2 -translate-x-1/2 whitespace-nowrap pl-1.5 font-mono text-[9px] font-bold leading-none"
                          style={{ color: markerColor }}
                        >
                          {cueTimelineLabel(cue, memoryIndex)}
                        </span>
                      </button>
                      );
                    })}
                  </>
                )}
              </div>

              <div className="h-[88px]">
                <TimelineLaneLabel icon={<AudioWaveform size={20} strokeWidth={2.25} />} label="Waveform" />
              </div>
              <div
                className="relative h-[88px] cursor-crosshair overflow-hidden rounded-[8px] border border-[#26313a] bg-[#0b1116]"
                onWheel={handleWheel}
                onContextMenu={handleWaveformContextMenu}
                title={timingMode === 'snap' ? 'Right-click to add a beat-snapped cue' : 'Right-click to add an exact millisecond cue'}
              >
                {durationMs != null && durationMs > 0 ? (() => {
                  const wScale = durationMs / (effectiveViewEnd - viewStart);
                  const wLeft = -(viewStart / durationMs) * wScale * 100;
                  return (
                    <div className="absolute inset-y-0" style={{ left: `${wLeft}%`, width: `${wScale * 100}%` }}>
                      <RekordboxPreviewWaveform
                        state={waveformState}
                        height={86}
                        variant="detail"
                        appearance={theme === 'cdj' ? 'dropdex' : 'rekordbox'}
                        renderMode="area"
                        showCenterLine={false}
                        surface={false}
                        colorSegments={waveformColorSegments}
                        onRetry={onRetryWaveform}
                        ariaLabel={`Cue point waveform for ${track.title}`}
                        className="absolute inset-x-0 top-0 w-full"
                      />
                    </div>
                  );
                })() : (
                  <RekordboxPreviewWaveform
                    state={waveformState}
                    height={86}
                    variant="detail"
                    appearance="rekordbox"
                    renderMode="area"
                    showCenterLine={false}
                    surface={false}
                    colorSegments={waveformColorSegments}
                    onRetry={onRetryWaveform}
                    ariaLabel={`Cue point waveform for ${track.title}`}
                    className="absolute inset-x-0 top-0"
                  />
                )}
                {durationMs != null && durationMs > 0 && (
                  <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                    {gridLines.map((beat) => (
                      <span
                        key={`wave-grid-${beat.seq}`}
                        className={cn(
                          'absolute bottom-0 top-0 border-l border-dashed',
                          beat.isDownbeat ? 'border-white/[0.10]' : 'border-white/[0.035]',
                        )}
                        style={{ left: `${percentageAt(beat.ms, viewStart, effectiveViewEnd)}%` }}
                      />
                    ))}
                    {sections.slice(1).map((section) => (
                      <span
                        key={`section-boundary-${section.id}`}
                        className="absolute bottom-0 top-0 w-px bg-white/[0.16]"
                        style={{ left: `${percentageAt(section.startMs, viewStart, effectiveViewEnd)}%` }}
                      />
                    ))}
                    {positionedCues.map((cue) => {
                      const displayColor = resolveCueDisplayColor(cue);
                      const markerColor = displayColor.hex;
                      const range = cueLoopRangeGeometry(cue, viewStart, effectiveViewEnd);
                      return (
                        <span key={`wave-cue-${cue.editorId}`}>
                          {range?.visible && (
                            <span
                              data-testid="waveform-loop-range"
                              className="absolute bottom-1 top-1 rounded-[2px] border-y"
                              style={{
                                left: `${range.leftPercent}%`,
                                width: `${range.widthPercent}%`,
                                minWidth: '2px',
                                borderColor: `${markerColor}66`,
                                backgroundColor: `${markerColor}18`,
                              }}
                            >
                              <span className="absolute bottom-0 right-0 top-0 w-px" style={{ backgroundColor: markerColor }} />
                            </span>
                          )}
                          <span
                            className="absolute bottom-0 top-0 w-px opacity-75"
                            style={{
                              left: `${percentageAt(cue.startMs ?? 0, viewStart, effectiveViewEnd)}%`,
                              backgroundColor: markerColor,
                              boxShadow: `0 0 5px ${markerColor}55`,
                            }}
                          />
                        </span>
                      );
                    })}
                  </div>
                )}
                {(editorMessage ?? persistenceMessage) && (
                  <div
                    role="status"
                    className="pointer-events-none absolute bottom-2 right-2 max-w-[420px] rounded-md border border-amber-300/20 bg-[#11181e]/95 px-2.5 py-1.5 text-[10px] font-semibold text-amber-200 shadow-lg"
                  >
                    {editorMessage ?? persistenceMessage}
                  </div>
                )}
              </div>

              <div className="h-[40px]">
                <TimelineLaneLabel icon={<Grip size={19} strokeWidth={2.55} />} label="Beat Grid" />
              </div>
              <div className="relative h-[40px] overflow-hidden rounded-[8px] border border-[#26313a] bg-[#0d1318]">
                {beatGridLoading ? (
                  <div className="flex h-full items-center px-5 text-[11px] font-medium text-[#707b85]">Loading beat grid…</div>
                ) : durationMs == null || rulerTicks.length === 0 ? (
                  <div className="flex h-full items-center px-5 text-[10px] font-medium uppercase tracking-[0.12em] text-[#5e6973]">
                    No beat grid
                  </div>
                ) : (
                  <>
                    {rulerTicks.map((beat) => (
                      <span
                        key={`ruler-${beat.seq}`}
                        className={cn(
                          'absolute -translate-x-1/2 rounded-full',
                          beat.isDownbeat
                            ? 'top-[3px] h-[20px] w-[2px] bg-[#f87171]'
                            : 'top-[4px] h-[12px] w-[1.5px] bg-[#4ade80] opacity-90',
                        )}
                        style={{ left: `${percentageAt(beat.ms, viewStart, effectiveViewEnd)}%` }}
                        title={`Bar ${beat.bar}, beat ${beat.beatInBar} · ${formatTime(beat.ms)}`}
                      />
                    ))}
                    {rulerLabels.map((beat) => (
                      <span
                        key={`bar-label-${beat.seq}`}
                        className="absolute bottom-[3px] -translate-x-1/2 font-mono text-[8px] font-medium tabular-nums text-[#9ca5ae]"
                        style={{ left: `${percentageAt(beat.ms, viewStart, effectiveViewEnd)}%` }}
                      >
                        {beat.bar}
                      </span>
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {selectedCue && (
        <CueInspector
          cue={selectedCue}
          cues={cues}
          timingMode={timingMode}
          onMoveCue={onMoveCue}
          onEditCue={onEditCue}
          onMessage={setEditorMessage}
          editable={cueEditingAllowed}
        />
      )}

      {contextMenu && (
        <div
          className="fixed inset-0 z-[80]"
          onPointerDown={() => setContextMenu(null)}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div
            role="menu"
            aria-label={contextMenu.kind === 'add' ? 'Add cue' : 'Cue actions'}
            className="fixed min-w-[190px] overflow-hidden rounded-lg border border-[#34414b] bg-[#11181e] p-1.5 shadow-2xl"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {contextMenu.kind === 'add' ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  disabled={availableHotCueSlot == null}
                  className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-xs font-semibold text-[#e5e9ed] hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => {
                    const error = onAddCue('hot', contextMenu.requestedMs, timingMode);
                    setEditorMessage(error);
                    setContextMenu(null);
                  }}
                >
                  <span>Add Hot Cue</span>
                  <span className="font-mono text-[10px] text-[#8e99a4]">
                    {availableHotCueSlot == null ? 'A–H full' : String.fromCharCode(64 + availableHotCueSlot)}
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="mt-0.5 w-full rounded-md px-3 py-2 text-left text-xs font-semibold text-[#e5e9ed] hover:bg-white/[0.06]"
                  onClick={() => {
                    const error = onAddCue('memory', contextMenu.requestedMs, timingMode);
                    setEditorMessage(error);
                    setContextMenu(null);
                  }}
                >
                  Add Memory Cue
                </button>
              </>
            ) : (
              <button
                type="button"
                role="menuitem"
                className="w-full rounded-md px-3 py-2 text-left text-xs font-semibold text-red-300 hover:bg-red-400/[0.08]"
                onClick={() => {
                  onDeleteCue(contextMenu.cueId);
                  setSelectedCueId(null);
                  setEditorMessage(null);
                  setContextMenu(null);
                }}
              >
                Delete cue
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export function CuePointsView({ importId, onImport }: CuePointsViewProps) {
  const auth = useAuthSession();
  const userId = auth.status === 'authenticated' ? auth.session.user.id : null;
  const [search, setSearch] = useState('');
  const [genre, setGenre] = useState('');
  const [keyFilter, setKeyFilter] = useState('');
  const [cueFilter, setCueFilter] = useState<CueFilter>('all');
  const [analysisFilter, setAnalysisFilter] = useState<AnalysisFilter>('all');
  const [bpmRange, setBpmRange] = useState<[number, number] | null>(null);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedTrack, setSelectedTrack] = useState<RekordboxTrack | null>(null);
  const [importedCueBaseline, setImportedCueBaseline] = useState<WorkingCue[]>([]);
  const [savedCueBaseline, setSavedCueBaseline] = useState<WorkingCue[] | null>(null);
  const [draftRevision, setDraftRevision] = useState<number | null>(null);
  const [draftAppliedRevision, setDraftAppliedRevision] = useState<number | null>(null);
  const [draftAppliedFingerprint, setDraftAppliedFingerprint] = useState<string | null>(null);
  const [draftDesiredFingerprint, setDraftDesiredFingerprint] = useState<string | null>(null);
  const [draftImportedBaselineFingerprint, setDraftImportedBaselineFingerprint] = useState<string | null>(null);
  const [draftImportedBaselineLocalCueFingerprint, setDraftImportedBaselineLocalCueFingerprint] = useState<string | null>(null);
  const [draftCurrentBaselineFingerprint, setDraftCurrentBaselineFingerprint] = useState<string | null>(null);
  const [draftCurrentBaselineLocalCueFingerprint, setDraftCurrentBaselineLocalCueFingerprint] = useState<string | null>(null);
  const [draftPersistenceMessage, setDraftPersistenceMessage] = useState<string | null>(null);
  const [savingCueDraft, setSavingCueDraft] = useState(false);
  const [applyDrafts, setApplyDrafts] = useState<CueDraftRow[]>([]);
  const [applyBridgeAvailable, setApplyBridgeAvailable] = useState(false);
  const [applyBridgeReason, setApplyBridgeReason] = useState<string | null>(null);
  const [applyPreflight, setApplyPreflight] = useState<DesktopCueApplyPreflightResult | null>(null);
  const [applyScope, setApplyScope] = useState<CueApplyScope | null>(null);
  const [applySnapshot, setApplySnapshot] = useState<CueDraftRow[]>([]);
  const [applyResult, setApplyResult] = useState<DesktopCueApplyResult | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const applyGenerationRef = useRef(0);
  const [workingCues, setWorkingCues] = useState<WorkingCue[]>([]);
  const [selectedCueLoading, setSelectedCueLoading] = useState(false);
  const [selectedCueLoadStatus, setSelectedCueLoadStatus] = useState<SelectedCueLoadStatus>('idle');
  const [selectedCueLoadOwner, setSelectedCueLoadOwner] = useState<CueLoadOwner | null>(null);
  const [selectedCueLoadError, setSelectedCueLoadError] = useState<string | null>(null);
  const [selectedCueIntegrity, setSelectedCueIntegrity] = useState<CueDraftValidationResult | null>(null);
  const [selectedCueRetryNonce, setSelectedCueRetryNonce] = useState(0);
  const [cueSummaryStates, setCueSummaryStates] = useState<Map<string, CueLoadState>>(new Map());
  const [cueSummaryRetryNonce, setCueSummaryRetryNonce] = useState(0);
  const [applyDraftLoadError, setApplyDraftLoadError] = useState<string | null>(null);
  const [applyDraftRetryNonce, setApplyDraftRetryNonce] = useState(0);
  const [applyRebaseRecovery, setApplyRebaseRecovery] = useState<CueRebaseRecoveryState | null>(null);
  const [beatGrid, setBeatGrid] = useState<BeatGridRow | null>(null);
  const [beatGridLoading, setBeatGridLoading] = useState(false);
  const [phrases, setPhrases] = useState<PhraseRow[]>([]);
  const [phraseLoading, setPhraseLoading] = useState(false);
  const [vocalAnalysis, setVocalAnalysis] = useState<VocalAnalysisRow | null>(null);
  const manualCueSequenceRef = useRef(0);
  const selectedTrackIdRef = useRef<string | null>(null);
  const selectedUserIdRef = useRef<string | null>(null);
  const selectedImportIdRef = useRef<string | null>(null);
  const workingCuesRef = useRef<WorkingCue[]>([]);
  const cueDraftLoadRequestRef = useRef(0);
  const cueDraftSaveRequestRef = useRef(0);
  const cueDraftSaveInFlightRef = useRef(false);

  const selectedTrackId = selectedTrack?.id ?? null;
  selectedTrackIdRef.current = selectedTrackId;
  selectedUserIdRef.current = userId;
  selectedImportIdRef.current = importId;
  workingCuesRef.current = workingCues;
  const { stats } = useLibraryStats(importId);
  const bpmBounds = useMemo((): [number, number] => {
    const bpms = (stats?.bpmTotals ?? []).map((t) => t.bpm).filter((b) => b > 0);
    if (bpms.length === 0) return [60, 200];
    return [Math.floor(Math.min(...bpms)), Math.ceil(Math.max(...bpms))];
  }, [stats?.bpmTotals]);
  const { data: routeImport } = useRouteImport(importId);
  const usbName = routeImport?.device_name?.trim() || 'USB';
  const {
    tracks,
    total,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
  } = useLibraryTracks(importId, {
    search,
    genre: genre || null,
    debounceMs: 220,
    pageSize: CUE_PAGE_SIZE,
  });

  const trackIdsKey = useMemo(() => tracks.map((track) => track.id).join(','), [tracks]);
  useEffect(() => {
    let cancelled = false;
    const trackIds = trackIdsKey ? trackIdsKey.split(',') : [];
    if (!importId || trackIds.length === 0) {
      setCueSummaryStates(new Map());
      return;
    }

    setCueSummaryStates(new Map(trackIds.map((trackId) => [trackId, { status: 'loading', trackId }] as const)));
    void fetchTracksCueStates(trackIds)
      .then((result) => {
        if (!cancelled) setCueSummaryStates(new Map(result.states));
      })
      .catch((error) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Cue summaries could not be loaded.';
          setCueSummaryStates(new Map(trackIds.map((trackId) => [trackId, {
            status: 'failed',
            trackId,
            error: message,
            retryable: true,
          }] as const)));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cueSummaryRetryNonce, importId, trackIdsKey]);

  const filteredTracks = useMemo(() => tracks.filter((track) => {
    if (!cueFilterMatches(cueSummaryStates.get(track.id), cueFilter)) return false;
    if (analysisFilter === 'ready' && !analysisReady(track)) return false;
    if (analysisFilter === 'incomplete' && analysisReady(track)) return false;
    if (keyFilter && formatKey(track.musical_key) !== keyFilter) return false;
    if (bpmRange !== null) {
      const bpm = track.bpm != null ? Math.round(track.bpm) : null;
      if (bpm == null || bpm < bpmRange[0] || bpm > bpmRange[1]) return false;
    }
    return true;
  }), [analysisFilter, bpmRange, cueFilter, cueSummaryStates, keyFilter, tracks]);

  const sortedTracks = useMemo(() => {
    if (!sortCol) return filteredTracks;
    return [...filteredTracks].sort((a, b) => {
      let av: string | number | null = null;
      let bv: string | number | null = null;
      if (sortCol === 'track') { av = `${a.title ?? ''} ${a.artist ?? ''}`; bv = `${b.title ?? ''} ${b.artist ?? ''}`; }
      else if (sortCol === 'bpm') { av = a.bpm ?? -1; bv = b.bpm ?? -1; }
      else if (sortCol === 'key') { av = formatCamelotKey(a.musical_key); bv = formatCamelotKey(b.musical_key); }
      else if (sortCol === 'genre') { av = a.genre ?? ''; bv = b.genre ?? ''; }
      else if (sortCol === 'cues') {
        const aCount = cueLoadCount(cueSummaryStates.get(a.id));
        const bCount = cueLoadCount(cueSummaryStates.get(b.id));
        av = aCount ?? Number.POSITIVE_INFINITY;
        bv = bCount ?? Number.POSITIVE_INFINITY;
      }
      else if (sortCol === 'analysis') { av = analysisReady(a) ? 1 : 0; bv = analysisReady(b) ? 1 : 0; }
      else if (sortCol === 'duration') {
        av = a.duration_ms ?? (a.duration_seconds != null ? a.duration_seconds * 1000 : -1);
        bv = b.duration_ms ?? (b.duration_seconds != null ? b.duration_seconds * 1000 : -1);
      }
      if (av === null || av === bv) return 0;
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filteredTracks, sortCol, sortDir, cueSummaryStates]);

  const cueSummaryFailureCount = useMemo(
    () => [...cueSummaryStates.values()].filter((state) => state.status === 'failed').length,
    [cueSummaryStates],
  );

  function handleColClick(col: string) {
    if (sortCol === col) {
      if (sortDir === 'asc') setSortDir('desc');
      else { setSortCol(null); setSortDir('asc'); }
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  }

  useEffect(() => {
    setSelectedTrack(null);
    setImportedCueBaseline([]);
    setSavedCueBaseline(null);
    setDraftRevision(null);
    setDraftAppliedRevision(null);
    setDraftAppliedFingerprint(null);
    setDraftDesiredFingerprint(null);
    setDraftImportedBaselineFingerprint(null);
    setDraftImportedBaselineLocalCueFingerprint(null);
    setDraftCurrentBaselineFingerprint(null);
    setDraftCurrentBaselineLocalCueFingerprint(null);
    setDraftPersistenceMessage(null);
    setSavingCueDraft(false);
    cueDraftSaveInFlightRef.current = false;
    applyGenerationRef.current += 1;
    setApplyPreflight(null);
    setApplyScope(null);
    setApplySnapshot([]);
    setApplyResult(null);
    setApplyMessage(null);
    setApplyDrafts([]);
    setWorkingCues([]);
    setSelectedCueLoading(false);
    setSelectedCueLoadStatus('idle');
    setSelectedCueLoadOwner(null);
    setSelectedCueLoadError(null);
    setSelectedCueIntegrity(null);
    setSelectedCueRetryNonce(0);
    setCueSummaryStates(new Map());
    setCueSummaryRetryNonce(0);
    setApplyDraftLoadError(null);
    setBeatGrid(null);
    setBeatGridLoading(false);
    setPhrases([]);
    setPhraseLoading(false);
    setVocalAnalysis(null);
  }, [importId, userId]);

  useEffect(() => {
    let cancelled = false;
    const requestId = ++cueDraftLoadRequestRef.current;
    const requestedTrack = selectedTrack;
    const requestedTrackId = selectedTrackId;
    const requestedUserId = userId;
    const requestedOwner: CueLoadOwner | null = requestedTrackId
      ? { trackId: requestedTrackId, userId: requestedUserId }
      : null;

    // A track/user ownership change invalidates any in-flight Save response.
    // The write may still finish for its original owner, but it must never
    // reconcile into the newly selected track or block that track's controls.
    cueDraftSaveRequestRef.current += 1;
    cueDraftSaveInFlightRef.current = false;
    setSavingCueDraft(false);

    if (!requestedTrackId || !requestedTrack) {
      setImportedCueBaseline([]);
      setSavedCueBaseline(null);
      setDraftRevision(null);
      setDraftAppliedRevision(null);
      setDraftAppliedFingerprint(null);
      setDraftDesiredFingerprint(null);
      setDraftImportedBaselineFingerprint(null);
      setDraftImportedBaselineLocalCueFingerprint(null);
      setDraftCurrentBaselineFingerprint(null);
      setDraftCurrentBaselineLocalCueFingerprint(null);
      setDraftPersistenceMessage(null);
      setWorkingCues([]);
      setSelectedCueLoadError(null);
      setSelectedCueIntegrity(null);
      setSelectedCueLoading(false);
      setSelectedCueLoadStatus('idle');
      setSelectedCueLoadOwner(null);
      return;
    }

    const responseIsCurrent = () => (
      !cancelled
      && cueDraftLoadRequestRef.current === requestId
      && cueLoadOwnerMatches(requestedOwner, selectedTrackIdRef.current, selectedUserIdRef.current)
    );

    setImportedCueBaseline([]);
    setSavedCueBaseline(null);
    setDraftRevision(null);
    setDraftAppliedRevision(null);
    setDraftAppliedFingerprint(null);
    setDraftDesiredFingerprint(null);
    setDraftImportedBaselineFingerprint(null);
    setDraftImportedBaselineLocalCueFingerprint(null);
    setDraftCurrentBaselineFingerprint(null);
    setDraftCurrentBaselineLocalCueFingerprint(null);
    setDraftPersistenceMessage(null);
    setWorkingCues([]);
    setSelectedCueLoadError(null);
    setSelectedCueIntegrity(null);
    setSelectedCueLoading(true);
    setSelectedCueLoadOwner(requestedOwner);
    setSelectedCueLoadStatus('loading');

    void loadCueEditorBaseline(requestedTrack, requestedUserId)
      .then((result) => {
        if (!responseIsCurrent()) return;
        setImportedCueBaseline(result.importedCues);
        if (result.status === 'failed') {
          setSavedCueBaseline(null);
          setDraftRevision(null);
          setDraftAppliedRevision(null);
          setDraftAppliedFingerprint(null);
          setDraftDesiredFingerprint(null);
          setDraftImportedBaselineFingerprint(null);
          setDraftImportedBaselineLocalCueFingerprint(null);
          setDraftCurrentBaselineFingerprint(null);
          setDraftCurrentBaselineLocalCueFingerprint(null);
          setWorkingCues([]);
          setDraftPersistenceMessage(null);
          setSelectedCueLoadStatus('failed');
          setSelectedCueLoadError(result.error);
          setSelectedCueIntegrity(null);
          return;
        }

        setSavedCueBaseline(result.savedCues);
        setDraftRevision(result.draftRevision);
        setDraftAppliedRevision(result.draftAppliedRevision);
        setDraftAppliedFingerprint(result.draftAppliedFingerprint);
        setDraftDesiredFingerprint(result.draftDesiredFingerprint);
        setDraftImportedBaselineFingerprint(result.draftImportedBaselineFingerprint);
        setDraftImportedBaselineLocalCueFingerprint(result.draftImportedBaselineLocalCueFingerprint);
        setDraftCurrentBaselineFingerprint(result.draftCurrentBaselineFingerprint);
        setDraftCurrentBaselineLocalCueFingerprint(result.draftCurrentBaselineLocalCueFingerprint);
        setWorkingCues(result.workingCues);
        setSelectedCueLoadStatus(result.status);
        setSelectedCueLoadError(null);
        setSelectedCueIntegrity(result.integrity);
      })
      .catch((error) => {
        if (!responseIsCurrent()) return;
        setImportedCueBaseline([]);
        setSavedCueBaseline(null);
        setDraftRevision(null);
        setDraftAppliedRevision(null);
        setDraftAppliedFingerprint(null);
        setDraftDesiredFingerprint(null);
        setDraftImportedBaselineFingerprint(null);
        setDraftImportedBaselineLocalCueFingerprint(null);
        setDraftCurrentBaselineFingerprint(null);
        setDraftCurrentBaselineLocalCueFingerprint(null);
        setWorkingCues([]);
        setDraftPersistenceMessage(null);
        setSelectedCueLoadStatus('failed');
        setSelectedCueIntegrity(null);
        setSelectedCueLoadError(error instanceof Error
          ? `Cue baseline could not be loaded: ${error.message}`
          : 'Cue baseline could not be loaded for this track.');
      })
      .finally(() => {
        if (responseIsCurrent()) setSelectedCueLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedCueRetryNonce, selectedTrack, selectedTrackId, userId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedTrackId) {
      setBeatGrid(null);
      setBeatGridLoading(false);
      return;
    }
    setBeatGrid(null);
    setBeatGridLoading(true);
    void fetchTrackBeatGrid(selectedTrackId)
      .then((next) => {
        if (!cancelled && isCurrentTrackResponse(selectedTrackIdRef.current, selectedTrackId)) setBeatGrid(next);
      })
      .catch(() => {
        if (!cancelled && isCurrentTrackResponse(selectedTrackIdRef.current, selectedTrackId)) setBeatGrid(null);
      })
      .finally(() => {
        if (!cancelled && isCurrentTrackResponse(selectedTrackIdRef.current, selectedTrackId)) setBeatGridLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTrackId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedTrackId) {
      setPhrases([]);
      setPhraseLoading(false);
      return;
    }
    setPhrases([]);
    setPhraseLoading(true);
    void fetchTrackPhrases(selectedTrackId)
      .then((next) => {
        if (!cancelled && isCurrentTrackResponse(selectedTrackIdRef.current, selectedTrackId)) setPhrases(next);
      })
      .catch(() => {
        if (!cancelled && isCurrentTrackResponse(selectedTrackIdRef.current, selectedTrackId)) setPhrases([]);
      })
      .finally(() => {
        if (!cancelled && isCurrentTrackResponse(selectedTrackIdRef.current, selectedTrackId)) setPhraseLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTrackId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedTrackId) {
      setVocalAnalysis(null);
      return;
    }
    setVocalAnalysis(null);
    // PVDI is enrichment only: query errors, an absent row, or an older backend
    // without the Stage 8 migration must leave Auto Cue's Stage 3 path usable.
    void fetchTrackVocalAnalysis(selectedTrackId)
      .then((next) => {
        if (!cancelled && isCurrentTrackResponse(selectedTrackIdRef.current, selectedTrackId)) {
          setVocalAnalysis(next?.track_id === selectedTrackId ? next : null);
        }
      })
      .catch(() => {
        if (!cancelled && isCurrentTrackResponse(selectedTrackIdRef.current, selectedTrackId)) setVocalAnalysis(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTrackId]);

  const allVisibleTrackIds = useMemo(() => sortedTracks.map(t => t.id), [sortedTracks]);
  const {
    getState: getWaveformState,
    retry: retryWaveform,
  } = useTrackPreviewWaveforms(importId, allVisibleTrackIds);
  const waveformState = getWaveformState(selectedTrackId);
  const selectedCueLoadOwnedBySelection = cueLoadOwnerMatches(
    selectedCueLoadOwner,
    selectedTrackId,
    userId,
  );
  const selectedCueBaselineComplete = selectedCueLoadOwnedBySelection
    && (selectedCueLoadStatus === 'loaded-empty' || selectedCueLoadStatus === 'loaded-with-cues');
  const selectedCueRebaseRecoveryPending = Boolean(
    applyRebaseRecovery
    && applyRebaseRecovery.userId === userId
    && applyRebaseRecovery.importId === importId
    && selectedTrackId
    && applyRebaseRecovery.items.some((item) => item.row.trackId === selectedTrackId),
  );
  const applyBlockedByPendingRebase = Boolean(
    applyRebaseRecovery
    && applyRebaseRecovery.userId === userId
    && applyRebaseRecovery.items.length > 0,
  );
  const selectedCueBaselineEditable = selectedCueBaselineComplete
    && selectedCueIntegrity?.status === 'valid'
    && !selectedCueRebaseRecoveryPending;
  const selectedCueBlockReason = selectedCueRebaseRecoveryPending
    ? 'Rekordbox was updated and verified, but this track baseline was not rebased in cloud state. Retry the verified baseline rebase before editing or applying again.'
    : !selectedCueBaselineComplete
      ? selectedCueLoadError ?? 'Cue editing is blocked until the complete cue baseline loads successfully.'
      : selectedCueIntegrity?.status !== 'valid'
        ? selectedCueIntegrity?.error ?? 'Cue editing is blocked until cue ownership is deterministic.'
        : null;
  const selectedCuePanelStatus: SelectedCueLoadStatus = selectedTrackId && !selectedCueLoadOwnedBySelection
    ? 'loading'
    : selectedCueLoadStatus;
  const selectedCuePanelLoading = selectedCueLoading || Boolean(selectedTrackId && !selectedCueLoadOwnedBySelection);
  const selectedCuePanelError = selectedCueLoadOwnedBySelection ? selectedCueLoadError : null;
  const retrySelectedCueBaseline = useCallback(() => {
    if (!selectedTrackId || selectedCueLoading) return;
    setSelectedCueRetryNonce((value) => value + 1);
  }, [selectedCueLoading, selectedTrackId]);
  const discardBaseline = savedCueBaseline ?? importedCueBaseline;
  const workingCuesDirty = useMemo(
    () => !workingCueSetsEqual(discardBaseline, workingCues),
    [discardBaseline, workingCues],
  );
  const cueDraftStatus = useMemo<CueDraftStatus>(() => {
    if (workingCuesDirty) return 'Unsaved';
    if (!savedCueBaseline) return 'Original';
    if (workingCueSetsEqual(importedCueBaseline, savedCueBaseline)) return 'Saved';
    if (draftCurrentBaselineLocalCueFingerprint == null) return 'Needs Verification';
    if (draftDesiredFingerprint != null
      && draftDesiredFingerprint === draftCurrentBaselineFingerprint) return 'Applied';
    return 'Needs Apply';
  }, [draftCurrentBaselineFingerprint, draftCurrentBaselineLocalCueFingerprint, draftDesiredFingerprint, importedCueBaseline, savedCueBaseline, workingCuesDirty]);
  const baselineProofRefreshNeeded = Boolean(
    savedCueBaseline
    && draftRevision != null
    && draftCurrentBaselineLocalCueFingerprint == null,
  );

  const refreshApplyDrafts = useCallback(async (): Promise<CueDraftRow[]> => {
    if (!userId || !importId) {
      setApplyDrafts([]);
      setApplyDraftLoadError(null);
      return [];
    }
    const rows = await fetchCueDraftsForApply(userId, importId);
    setApplyDrafts(rows);
    setApplyDraftLoadError(null);
    return rows;
  }, [importId, userId]);

  const persistVerifiedApplyRebase = useCallback(async (recovery: CueRebaseRecoveryState) => {
    const statusUpdates = await Promise.allSettled(recovery.items.map((item) => {
      if (!item.postApplyLocalCueFingerprint) {
        return Promise.reject(new Error(`Verified Apply did not return a local cue fingerprint for ${item.row.masterContentId ?? item.row.rekordboxContentId}.`));
      }
      return markCueDraftApplied({
        importId: item.row.importId,
        trackId: item.row.trackId,
        revision: item.row.revision,
        desiredFingerprint: item.row.desiredFingerprint,
        postApplyLocalCueFingerprint: item.postApplyLocalCueFingerprint,
        operationId: recovery.operationId,
        resultSummary: recovery.summary,
      });
    }));

    const failedItems = recovery.items.filter((_, index) => statusUpdates[index]?.status === 'rejected');
    if (selectedUserIdRef.current === recovery.userId && selectedImportIdRef.current === recovery.importId) {
      const updatedSelected = statusUpdates.find((item) => item.status === 'fulfilled' && item.value.trackId === selectedTrackIdRef.current);
      if (updatedSelected?.status === 'fulfilled') {
        setDraftAppliedRevision(updatedSelected.value.appliedRevision);
        setDraftAppliedFingerprint(updatedSelected.value.appliedFingerprint);
        setDraftDesiredFingerprint(updatedSelected.value.desiredFingerprint);
        setDraftImportedBaselineFingerprint(updatedSelected.value.importedBaselineFingerprint);
        setDraftImportedBaselineLocalCueFingerprint(updatedSelected.value.importedBaselineLocalCueFingerprint);
        setDraftCurrentBaselineFingerprint(updatedSelected.value.currentBaselineFingerprint);
        setDraftCurrentBaselineLocalCueFingerprint(updatedSelected.value.currentBaselineLocalCueFingerprint);
      }
    }

    const nextRecovery = failedItems.length > 0 ? { ...recovery, items: failedItems } : null;
    if (selectedUserIdRef.current === recovery.userId) setApplyRebaseRecovery(nextRecovery);
    try {
      if (selectedUserIdRef.current === recovery.userId && selectedImportIdRef.current === recovery.importId) {
        await refreshApplyDrafts();
      }
    } catch (error) {
      setApplyDraftLoadError(error instanceof Error
        ? `Saved cue drafts could not be refreshed after Apply: ${error.message}`
        : 'Saved cue drafts could not be refreshed after Apply.');
    }
    return nextRecovery;
  }, [refreshApplyDrafts]);

  const handleRetryApplyRebase = useCallback(async () => {
    const recovery = applyRebaseRecovery;
    if (!recovery || applyBusy) return;
    if (selectedUserIdRef.current !== recovery.userId) {
      setApplyMessage('The authenticated user changed. The previous Apply rebase proof cannot be reused in this session.');
      setApplyRebaseRecovery(null);
      return;
    }
    if (selectedImportIdRef.current !== recovery.importId) {
      setApplyMessage('Return to the import that was just applied before retrying its verified baseline rebase.');
      return;
    }
    setApplyBusy(true);
    setApplyMessage(null);
    try {
      const remaining = await persistVerifiedApplyRebase(recovery);
      setApplyMessage(remaining
        ? 'Rekordbox is already updated and verified, but its cloud baseline still could not be rebased. Editing and further Apply actions remain blocked for the affected track(s). Retry this rebase or refresh/re-import before continuing.'
        : 'The verified local Rekordbox state was successfully recorded as the new cue baseline. Editing and Apply are safe to continue.');
    } finally {
      setApplyBusy(false);
    }
  }, [applyBusy, applyRebaseRecovery, persistVerifiedApplyRebase]);

  useEffect(() => {
    setApplyRebaseRecovery(null);
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    const desktop = window.dropdexDesktop;
    if (!desktop?.isElectron) {
      setApplyBridgeAvailable(false);
      setApplyBridgeReason('Apply to Rekordbox is available in the DropDex desktop app only.');
      return;
    }
    void desktop.cueApplyAvailability().then((result) => {
      if (cancelled) return;
      setApplyBridgeAvailable(result.available);
      setApplyBridgeReason(result.reason);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!userId || !importId) {
      setApplyDrafts([]);
      setApplyDraftLoadError(null);
      return;
    }
    // Identity changes intentionally clear the prior user's/import's rows before
    // loading the new scope. A subsequent request failure remains an explicit
    // error and is not interpreted as proof that the new scope has no drafts.
    setApplyDrafts([]);
    setApplyDraftLoadError(null);
    void fetchCueDraftsForApply(userId, importId)
      .then((rows) => {
        if (cancelled) return;
        setApplyDrafts(rows);
        setApplyDraftLoadError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setApplyDraftLoadError(error instanceof Error
          ? `Saved cue drafts could not be loaded for Apply: ${error.message}`
          : 'Saved cue drafts could not be loaded for Apply.');
      });
    return () => { cancelled = true; };
  }, [applyDraftRetryNonce, draftRevision, importId, userId]);

  const desktopDrafts = useCallback((rows: CueDraftRow[]) => rows.map((row) => ({
    importId: row.importId,
    trackId: row.trackId,
    rekordboxContentId: row.rekordboxContentId,
    revision: row.revision,
    desiredFingerprint: row.desiredFingerprint,
    importedBaselineFingerprint: row.importedBaselineFingerprint,
    importedBaselineLocalCueFingerprint: row.importedBaselineLocalCueFingerprint,
    currentBaselineFingerprint: row.currentBaselineFingerprint,
    currentBaselineLocalCueFingerprint: row.currentBaselineLocalCueFingerprint,
    masterDbId: row.masterDbId,
    masterContentId: row.masterContentId,
    desiredDocument: row.desiredDocument as unknown as Record<string, unknown>,
  })), []);

  const handleApplyPreflight = useCallback(async (kind: 'track' | 'all') => {
    const desktop = window.dropdexDesktop;
    if (!desktop?.isElectron || !applyBridgeAvailable || !userId || !importId) return;
    if (applyRebaseRecovery && applyRebaseRecovery.userId === userId && applyRebaseRecovery.items.length > 0) {
      setApplyMessage(applyRebaseRecovery.importId === importId
        ? 'A verified Rekordbox write is waiting for its cloud baseline rebase. Retry that rebase before any further Apply action.'
        : 'Another import has a verified Rekordbox write waiting for its cloud baseline rebase. Return to that import and resolve it before another Apply action.');
      return;
    }
    if (kind === 'track' && !selectedTrackId) {
      setApplyMessage('Select a track before using Apply Track.');
      return;
    }
    if (kind === 'track' && !selectedCueBaselineEditable) {
      setApplyMessage(selectedCueBlockReason ?? 'Apply Track is blocked until the selected track has a valid cue baseline.');
      return;
    }

    const scope: CueApplyScope = kind === 'track'
      ? { kind: 'track', importId, trackId: selectedTrackId as string }
      : { kind: 'all', importId };
    const generation = ++applyGenerationRef.current;
    setApplyBusy(true);
    setApplyMessage(null);
    setApplyResult(null);
    setApplyPreflight(null);
    setApplyScope(null);
    setApplySnapshot([]);
    try {
      const rows = await refreshApplyDrafts();
      const selection = resolveCueApplySelection(rows, scope);
      if (selection.error) {
        setApplyMessage(selection.error);
        return;
      }
      const result = await desktop.cueApplyPreflight(scope, desktopDrafts(selection.rows));
      if (generation !== applyGenerationRef.current
        || selectedUserIdRef.current !== userId
        || selectedImportIdRef.current !== importId) return;
      if (scope.kind === 'track' && selectedTrackIdRef.current !== scope.trackId) {
        setApplyMessage('The selected track changed during Apply Track preflight. Run Apply Track again for the current selection.');
        return;
      }
      setApplyScope(scope);
      setApplySnapshot(selection.rows);
      setApplyPreflight(result);
    } catch (error) {
      if (generation === applyGenerationRef.current) setApplyMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (generation === applyGenerationRef.current) setApplyBusy(false);
    }
  }, [applyBridgeAvailable, applyRebaseRecovery, desktopDrafts, importId, refreshApplyDrafts, selectedCueBaselineEditable, selectedCueBlockReason, selectedTrackId, userId]);

  const handleConfirmApply = useCallback(async () => {
    const desktop = window.dropdexDesktop;
    const preflight = applyPreflight;
    const scope = applyScope;
    if (!desktop?.isElectron || !preflight?.ok || !preflight.token || !scope || !userId || !importId || applyBusy) return;
    if (scope.kind === 'track' && selectedTrackId !== scope.trackId) {
      applyGenerationRef.current += 1;
      setApplyPreflight(null);
      setApplyScope(null);
      setApplySnapshot([]);
      setApplyMessage('The selected track changed after preflight. Run Apply Track again for the current selection.');
      return;
    }
    if (scope.kind === 'track' && !selectedCueBaselineEditable) {
      applyGenerationRef.current += 1;
      setApplyPreflight(null);
      setApplyScope(null);
      setApplySnapshot([]);
      setApplyMessage(selectedCueBlockReason ?? 'Apply Track is blocked until the selected track has a valid cue baseline.');
      return;
    }
    const generation = ++applyGenerationRef.current;
    setApplyBusy(true);
    setApplyMessage(null);
    try {
      const currentRows = await fetchCueDraftsForApply(userId, importId);
      const currentSelection = resolveCueApplySelection(currentRows, scope);
      if (currentSelection.error) {
        setApplyPreflight(null);
        setApplyScope(null);
        setApplySnapshot([]);
        setApplyDrafts(currentRows);
        setApplyMessage(currentSelection.error);
        return;
      }
      const currentIdentity = new Map(currentSelection.rows.map((row) => [row.trackId, `${row.revision}:${row.desiredFingerprint}`]));
      const snapshotStillCurrent = applySnapshot.every((row) => currentIdentity.get(row.trackId) === `${row.revision}:${row.desiredFingerprint}`);
      if (!snapshotStillCurrent || currentSelection.rows.length !== applySnapshot.length) {
        setApplyPreflight(null);
        setApplyScope(null);
        setApplySnapshot([]);
        setApplyDrafts(currentRows);
        setApplyMessage('Saved cue drafts changed after preflight. Run the Apply action again for a fresh preflight.');
        return;
      }
      const result = await desktop.cueApply(preflight.token, scope, desktopDrafts(applySnapshot));
      let failedOutcomePersistenceCount = 0;
      if (result.state !== 'applied') {
        const failureSummary = {
          state: result.state,
          planFingerprint: result.plan_fingerprint,
          sourceIdentityBefore: result.source_identity_before,
          sourceIdentityAfter: result.source_identity_after,
          backupIdentity: result.backup_identity,
          rollbackVerified: result.rollback_verified,
          tracks: result.tracks,
          blockers: result.blockers,
          warnings: result.warnings,
          recovery: result.recovery,
        };
        // Persist the desktop outcome before renderer-generation guards. If the
        // user changes selection/import while the bridge is working, the exact
        // attempted revisions still need a durable audit record in Supabase.
        const persisted = await Promise.allSettled(applySnapshot.map((row) => markCueDraftApplyOutcome({
          importId,
          trackId: row.trackId,
          revision: row.revision,
          desiredFingerprint: row.desiredFingerprint,
          operationId: result.operation_id,
          state: result.state,
          resultSummary: failureSummary,
        })));
        failedOutcomePersistenceCount = persisted.filter((item) => item.status === 'rejected').length;
      }
      if (generation !== applyGenerationRef.current
        || selectedUserIdRef.current !== userId
        || selectedImportIdRef.current !== importId) return;
      setApplyResult(result);
      setApplyPreflight(null);
      setApplyScope(null);
      if (result.ok && result.state === 'applied') {
        const summary = {
          state: result.state,
          planFingerprint: result.plan_fingerprint,
          backupIdentity: result.backup_identity,
          verifiedTracks: result.tracks.filter((track) => track.state === 'verified').length,
          rollbackVerified: result.rollback_verified,
        };
        const verifiedByContentId = new Map(
          result.tracks
            .filter((track) => track.state === 'verified' && /^[0-9a-f]{64}$/.test(track.local_cue_fingerprint ?? ''))
            .map((track) => [track.content_id, track.local_cue_fingerprint as string]),
        );
        const recovery: CueRebaseRecoveryState = {
          userId,
          importId,
          operationId: result.operation_id,
          summary,
          items: applySnapshot.map((row) => ({
            row,
            // Bridge results use the trusted local master ContentID, which is
            // masterContentId when available, not necessarily the imported
            // rekordboxContentId exposed by the renderer.
            postApplyLocalCueFingerprint: verifiedByContentId.get(row.masterContentId ?? row.rekordboxContentId) ?? null,
          })),
        };
        // From this point forward the local DB is authoritative. Keep an
        // explicit recovery record before cloud persistence so a failure cannot
        // silently leave the editor using the pre-Apply comparison baseline.
        setApplyRebaseRecovery(recovery);
        const remainingRecovery = await persistVerifiedApplyRebase(recovery);
        if (remainingRecovery) {
          setApplyMessage('Rekordbox was updated and verified, but the cloud cue baseline could not be fully rebased. Editing and further Apply actions are blocked for the affected track(s) until the verified rebase is retried or the import is safely refreshed.');
        } else {
          setApplyMessage(scope.kind === 'track'
            ? 'The selected track was applied to local Rekordbox, verified, and rebased for the next edit.'
            : 'All selected saved cue drafts were applied to local Rekordbox, verified, and rebased for the next edit.');
        }
      } else {
        const outcomeMessage = result.state === 'rolled-back'
          ? 'Apply did not complete. The original local Rekordbox database was restored and rollback verification succeeded.'
          : result.state === 'recovery-unverified'
            ? 'Apply encountered a recovery failure. Do not reopen Rekordbox until the reported recovery state is reviewed.'
            : 'Apply was rejected. No successful revision was marked applied.';
        setApplyMessage(failedOutcomePersistenceCount > 0
          ? `${outcomeMessage} Warning: ${failedOutcomePersistenceCount} failed apply outcome${failedOutcomePersistenceCount === 1 ? '' : 's'} could not be persisted to the cloud audit state.`
          : outcomeMessage);
      }
    } catch (error) {
      if (generation === applyGenerationRef.current) setApplyMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (generation === applyGenerationRef.current) setApplyBusy(false);
    }
  }, [applyBusy, applyPreflight, applyScope, applySnapshot, desktopDrafts, importId, persistVerifiedApplyRebase, selectedCueBaselineEditable, selectedCueBlockReason, selectedTrackId, userId]);

  const handleAddCue = useCallback((family: 'hot' | 'memory', requestedMs: number, timingMode: CueTimingMode): string | null => {
    if (!selectedTrackId) return 'Select a track before editing cue points.';
    if (selectedCueLoading) return 'Cue points are still loading for this track.';
    if (!selectedCueBaselineEditable) return selectedCueBlockReason ?? 'Cue editing is blocked until the cue baseline is safe.';
    if (timingMode === 'snap' && beatGridLoading) return 'The Rekordbox beat grid is still loading for this track.';
    manualCueSequenceRef.current += 1;
    const result = addWorkingCue(workingCues, {
      editorId: `manual:${selectedTrackId}:${manualCueSequenceRef.current}`,
      trackId: selectedTrackId,
      family,
      requestedMs,
      beats: beatGrid?.beats ?? [],
      timingMode,
    });
    if (!result.error) setWorkingCues(result.cues);
    return result.error;
  }, [beatGrid, beatGridLoading, selectedCueBaselineEditable, selectedCueBlockReason, selectedCueLoading, selectedTrackId, workingCues]);

  const handleMoveCue = useCallback((cueId: string, requestedMs: number, timingMode: CueTimingMode): string | null => {
    if (selectedCueLoading) return 'Cue points are still loading for this track.';
    if (!selectedCueBaselineEditable) return selectedCueBlockReason ?? 'Cue editing is blocked until the cue baseline is safe.';
    if (timingMode === 'snap' && beatGridLoading) return 'The Rekordbox beat grid is still loading for this track.';
    const result = moveWorkingCue(workingCues, cueId, requestedMs, beatGrid?.beats ?? [], timingMode);
    if (!result.error) setWorkingCues(result.cues);
    return result.error;
  }, [beatGrid, beatGridLoading, selectedCueBaselineEditable, selectedCueBlockReason, selectedCueLoading, workingCues]);

  const handleEditCue = useCallback((cueId: string, action: CueEditAction): string | null => {
    if (selectedCueLoading) return 'Cue points are still loading for this track.';
    if (!selectedCueBaselineEditable) return selectedCueBlockReason ?? 'Cue editing is blocked until the cue baseline is safe.';
    const needsGrid = (action.kind === 'point-type' && action.pointType === 'loop')
      || ((action.kind === 'end-ms' || action.kind === 'loop-length-ms') && action.timingMode === 'snap');
    if (needsGrid && beatGridLoading) return 'The Rekordbox beat grid is still loading for this track.';
    const result = editWorkingCue(workingCues, cueId, action, beatGrid?.beats ?? []);
    if (!result.error) setWorkingCues(result.cues);
    return result.error;
  }, [beatGrid, beatGridLoading, selectedCueBaselineEditable, selectedCueBlockReason, selectedCueLoading, workingCues]);

  const handleDeleteCue = useCallback((cueId: string) => {
    if (!selectedCueBaselineEditable) return;
    setWorkingCues((current) => deleteWorkingCue(current, cueId));
  }, [selectedCueBaselineEditable]);

  const handleAutoCue = useCallback((): string | null => {
    if (!selectedTrackId || !selectedTrack) return 'Select a track before running Auto Cue.';
    if (selectedCueLoading) return 'Cue points are still loading for this track.';
    if (!selectedCueBaselineEditable) return selectedCueBlockReason ?? 'Auto Cue is blocked until the cue baseline is safe.';
    if (beatGridLoading) return 'The Rekordbox beat grid is still loading for this track.';
    if (phraseLoading) return 'Track sections are still loading for this track.';
    if (!beatGrid || beatGrid.track_id !== selectedTrackId || !isUsableBeatGrid(beatGrid.beats)) {
      return 'Auto Cue requires a valid exact Rekordbox beat grid for the selected track.';
    }
    if (phrases.some((phrase) => phrase.track_id !== selectedTrackId)) {
      return 'Auto Cue is waiting for phrase data scoped to the selected track.';
    }

    const result = applyAutoCueStrategy({
      trackId: selectedTrackId,
      importId: selectedTrack.import_id ?? importId,
      durationMs: durationMsForTrack(selectedTrack, beatGrid, phrases),
      beats: beatGrid.beats,
      phrases,
      vocalAnalysis,
      currentCues: workingCues,
    });
    if (result.blockedReason) return result.blockedReason;
    if (result.addedHotCount > 0 || result.addedMemoryCount > 0) {
      setWorkingCues(result.cues);
    }

    const skippedCount = Object.keys(result.skippedSlots).length;
    if (result.addedHotCount === 0 && result.preservedOccupiedSlots.length > 0) {
      return 'Auto Cue preserved the occupied Hot Cue slots; no empty proposed slots were available.';
    }
    if (result.addedHotCount === 0) {
      return skippedCount > 0
        ? `Auto Cue could not safely derive any new Hot Cues (${skippedCount} slot${skippedCount === 1 ? '' : 's'} skipped).`
        : 'Auto Cue did not add any new cues.';
    }
    return `Auto Cue added ${result.addedHotCount} Hot Cue${result.addedHotCount === 1 ? '' : 's'} and ${result.addedMemoryCount} Memory Cue${result.addedMemoryCount === 1 ? '' : 's'}${skippedCount > 0 ? `; ${skippedCount} unsupported slot${skippedCount === 1 ? '' : 's'} skipped` : ''}.`;
  }, [beatGrid, beatGridLoading, importId, phraseLoading, phrases, selectedCueBaselineEditable, selectedCueBlockReason, selectedCueLoading, selectedTrack, selectedTrackId, vocalAnalysis, workingCues]);

  const handleSave = useCallback(async (): Promise<string | null> => {
    if (!selectedTrackId || !selectedTrack) return 'Select a track before saving cue changes.';
    if (!userId) return 'Sign in before saving cue changes.';
    if (selectedCueLoading) return 'Cue points are still loading for this track.';
    if (!selectedCueBaselineEditable) return selectedCueBlockReason ?? 'Save is blocked until the cue baseline is safe.';
    const refreshBaselineProof = draftRevision != null && draftCurrentBaselineLocalCueFingerprint == null;
    if (!workingCuesDirty && !refreshBaselineProof) return 'There are no unsaved cue changes.';
    if (cueDraftSaveInFlightRef.current) return 'A cue draft save is already in progress.';

    cueDraftSaveInFlightRef.current = true;
    setSavingCueDraft(true);
    setDraftPersistenceMessage(null);
    const requestId = ++cueDraftSaveRequestRef.current;
    const requestedTrackId = selectedTrackId;
    const requestedUserId = userId;
    const workingSnapshot = workingCues;
    const importedSnapshot = importedCueBaseline;
    const expectedRevision = draftRevision ?? 0;
    const existingImportedBaselineFingerprint = draftImportedBaselineFingerprint;
    const existingImportedBaselineLocalCueFingerprint = draftImportedBaselineLocalCueFingerprint;

    const responseIsCurrent = () => (
      cueDraftSaveRequestRef.current === requestId
      && selectedTrackIdRef.current === requestedTrackId
      && selectedUserIdRef.current === requestedUserId
    );

    try {
      const document = createCueDraftDocument({
        importId: selectedTrack.import_id,
        trackId: requestedTrackId,
        rekordboxContentId: selectedTrack.rekordbox_content_id,
        cues: workingSnapshot,
      });
      const importedDocument = createCueDraftDocument({
        importId: selectedTrack.import_id,
        trackId: requestedTrackId,
        rekordboxContentId: selectedTrack.rekordbox_content_id,
        cues: importedSnapshot,
      });
      const [desiredFingerprint, freshImportedBaselineFingerprint, freshImportedBaselineLocalCueFingerprint] = await Promise.all([
        fingerprintCueDraftDocument(document),
        fingerprintCueDraftDocument(importedDocument),
        fingerprintImportedLocalCueBaseline(importedDocument),
      ]);
      // Once a draft exists, proven safety baselines are durable state. A
      // verified Apply may have rebased the moving baseline to a newer local
      // generation, so never overwrite non-null proof with import-time evidence.
      // Legacy rows that never had local proof may acquire it once from the
      // freshly validated imported baseline; the Stage 10 RPC has the same rule.
      const importedBaselineFingerprint = expectedRevision > 0
        ? existingImportedBaselineFingerprint ?? freshImportedBaselineFingerprint
        : freshImportedBaselineFingerprint;
      const importedBaselineLocalCueFingerprint = expectedRevision > 0
        ? existingImportedBaselineLocalCueFingerprint ?? freshImportedBaselineLocalCueFingerprint
        : freshImportedBaselineLocalCueFingerprint;
      const strategy = cueDraftStrategySummary(document);
      const saved = await saveCueDraft({
        importId: selectedTrack.import_id,
        trackId: requestedTrackId,
        rekordboxContentId: selectedTrack.rekordbox_content_id,
        document,
        desiredFingerprint,
        importedBaselineFingerprint,
        importedBaselineLocalCueFingerprint,
        expectedRevision,
        strategyVersion: strategy.version,
        strategySettings: strategy.settings,
      });

      if (!responseIsCurrent()) return null;
      const hydrated = hydrateCueDraftDocument(saved.desiredDocument);
      setSavedCueBaseline(hydrated);
      setDraftRevision(saved.revision);
      setDraftAppliedRevision(saved.appliedRevision);
      setDraftAppliedFingerprint(saved.appliedFingerprint);
      setDraftDesiredFingerprint(saved.desiredFingerprint);
      setDraftImportedBaselineFingerprint(saved.importedBaselineFingerprint);
      setDraftImportedBaselineLocalCueFingerprint(saved.importedBaselineLocalCueFingerprint);
      setDraftCurrentBaselineFingerprint(saved.currentBaselineFingerprint);
      setDraftCurrentBaselineLocalCueFingerprint(saved.currentBaselineLocalCueFingerprint);
      applyGenerationRef.current += 1;
      setApplyPreflight(null);
      setApplyScope(null);
      setApplySnapshot([]);
      if (workingCueSetsEqual(workingCuesRef.current, workingSnapshot)) {
        setWorkingCues(hydrated);
      }
      return workingCuesDirty
        ? 'Cue changes saved.'
        : 'Verified cue baseline proof refreshed. This draft can now be evaluated for Apply.';
    } catch (error) {
      if (!responseIsCurrent()) return null;
      if (error instanceof CueDraftRevisionConflictError) return error.message;
      return error instanceof Error ? `Cue changes were not saved: ${error.message}` : 'Cue changes were not saved.';
    } finally {
      if (cueDraftSaveRequestRef.current === requestId) {
        if (responseIsCurrent()) setSavingCueDraft(false);
        cueDraftSaveInFlightRef.current = false;
      }
    }
  }, [draftCurrentBaselineLocalCueFingerprint, draftImportedBaselineFingerprint, draftImportedBaselineLocalCueFingerprint, draftRevision, importedCueBaseline, selectedCueBaselineEditable, selectedCueBlockReason, selectedCueLoading, selectedTrack, selectedTrackId, userId, workingCues, workingCuesDirty]);

  const handleDiscard = useCallback(() => {
    if (!selectedCueBaselineComplete) return;
    setWorkingCues(savedCueBaseline ?? importedCueBaseline);
    setDraftPersistenceMessage(null);
  }, [importedCueBaseline, savedCueBaseline, selectedCueBaselineComplete]);

  if (!importId) {
    return (
      <div className="mx-auto max-w-3xl pt-8">
        <div className="glass rounded-2xl border border-secondary/20 p-8 text-center">
          <Music size={48} className="mx-auto mb-4 text-secondary opacity-60" />
          <h2 className="text-2xl font-black">Cue Points</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
            Import a Rekordbox library to preview waveforms, beat grids, and existing cue points.
          </p>
          <ControlButton variant="primary" className="mt-5" onClick={onImport}>
            <Upload size={16} /> Import library
          </ControlButton>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 pb-10">
      <CueWaveformPanel
        track={selectedTrack}
        beatGrid={beatGrid}
        cues={workingCues}
        phrases={phrases}
        cueLoading={selectedCuePanelLoading}
        cueLoadStatus={selectedCuePanelStatus}
        cueLoadError={selectedCuePanelError}
        cueIntegrity={selectedCueLoadOwnedBySelection ? selectedCueIntegrity : null}
        beatGridLoading={beatGridLoading}
        phraseLoading={phraseLoading}
        waveformState={waveformState}
        dirty={workingCuesDirty}
        draftStatus={cueDraftStatus}
        baselineProofRefreshNeeded={baselineProofRefreshNeeded}
        saving={savingCueDraft}
        persistenceMessage={draftPersistenceMessage}
        editingBlockedReason={selectedCueRebaseRecoveryPending ? selectedCueBlockReason : null}
        onRetryCues={retrySelectedCueBaseline}
        onRetryWaveform={() => selectedTrackId && retryWaveform([selectedTrackId])}
        onAddCue={handleAddCue}
        onMoveCue={handleMoveCue}
        onEditCue={handleEditCue}
        onDeleteCue={handleDeleteCue}
        onDiscard={handleDiscard}
        onAutoCue={handleAutoCue}
        onSave={handleSave}
        applyTrackAvailable={applyBridgeAvailable
          && !applyDraftLoadError
          && !applyBlockedByPendingRebase
          && Boolean(selectedTrackId)
          && selectedCueBaselineEditable
          && applyDrafts.some((row) => row.trackId === selectedTrackId)}
        applyAllCount={applyBridgeAvailable && !applyDraftLoadError && !applyBlockedByPendingRebase ? applyDrafts.length : 0}
        applying={applyBusy}
        onApplyTrack={() => { void handleApplyPreflight('track'); }}
        onApplyAll={() => { void handleApplyPreflight('all'); }}
      />

      {(applyPreflight || applyResult || applyMessage || applyDraftLoadError || applyRebaseRecovery) && (
        <div className="glass rounded-2xl border border-[var(--color-border-subtle)] p-4" role="status">
          {applyPreflight ? (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-black">{applyScope?.kind === 'track' ? 'Apply Track' : 'Apply All'} preflight</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {applyPreflight.tracks.length} saved track{applyPreflight.tracks.length === 1 ? '' : 's'} · {applySnapshot.reduce((sum, row) => sum + row.desiredDocument.cues.length, 0)} desired cue{applySnapshot.reduce((sum, row) => sum + row.desiredDocument.cues.length, 0) === 1 ? '' : 's'} · local Rekordbox only, no USB write
                  </p>
                </div>
                <button type="button" className="text-xs font-bold text-muted-foreground hover:text-foreground" onClick={() => { applyGenerationRef.current += 1; setApplyPreflight(null); setApplyScope(null); setApplySnapshot([]); }}>Cancel</button>
              </div>
              {applyPreflight.blockers.length > 0 && <div className="rounded-xl border border-red-400/20 bg-red-400/[0.06] p-3 text-xs text-red-200">{applyPreflight.blockers.map((item) => <p key={`${item.code}:${item.message}`}>{item.message}</p>)}</div>}
              {applyPreflight.warnings.length > 0 && <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-3 text-xs text-amber-100">{applyPreflight.warnings.map((item) => <p key={`${item.code}:${item.message}`}>{item.message}</p>)}</div>}

              <div className="space-y-2">
                {applyPreflight.tracks.map((track) => {
                  const draft = applySnapshot.find((row) => row.masterContentId === track.content_id || row.rekordboxContentId === track.content_id);
                  const diff = track.diff;
                  const movedCount = diff?.changed.filter((change) => change.changes.includes('moved')).length ?? 0;
                  const familyCount = diff?.changed.filter((change) => change.changes.includes('family')).length ?? 0;
                  const slotCount = diff?.changed.filter((change) => change.changes.includes('slot')).length ?? 0;
                  const typeCount = diff?.changed.filter((change) => change.changes.includes('point-type')).length ?? 0;
                  const loopCount = diff?.changed.filter((change) => change.changes.includes('loop-extent')).length ?? 0;
                  const metadataCount = diff?.changed.filter((change) => change.changes.some((item) => ['comment', 'color', 'active-loop'].includes(item))).length ?? 0;
                  return (
                    <details key={track.content_id} className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)]/40 p-3" open={applyPreflight.tracks.length === 1}>
                      <summary className="cursor-pointer list-none">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-xs font-black text-foreground">{draft?.trackId ?? `Content ${track.content_id}`}</p>
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                              {diff ? `${diff.current_count} current → ${diff.desired_count} desired` : 'Diff unavailable'}
                              {diff?.blocking ? ' · BLOCKED' : ''}
                            </p>
                          </div>
                          {diff && (
                            <div className="flex flex-wrap gap-1 text-[9px] font-bold text-muted-foreground">
                              <span className="rounded-md border border-white/10 px-1.5 py-0.5">+{diff.added.length}</span>
                              <span className="rounded-md border border-white/10 px-1.5 py-0.5">−{diff.removed.length}</span>
                              <span className="rounded-md border border-white/10 px-1.5 py-0.5">Move {movedCount}</span>
                              <span className="rounded-md border border-white/10 px-1.5 py-0.5">Hot/Memory {familyCount}</span>
                              <span className="rounded-md border border-white/10 px-1.5 py-0.5">Slot {slotCount}</span>
                              <span className="rounded-md border border-white/10 px-1.5 py-0.5">Cue/Loop {typeCount}</span>
                              <span className="rounded-md border border-white/10 px-1.5 py-0.5">Loop {loopCount}</span>
                              <span className="rounded-md border border-white/10 px-1.5 py-0.5">Meta {metadataCount}</span>
                            </div>
                          )}
                        </div>
                      </summary>
                      {diff && (
                        <div className="mt-3 space-y-2 border-t border-white/10 pt-2 text-[10px] text-muted-foreground">
                          {diff.conflicts.map((message) => <p key={message} className="text-red-300">Conflict: {message}</p>)}
                          {diff.added.map((cue, index) => <p key={`add:${index}:${cue.start_ms}`}><span className="font-bold text-emerald-300">ADD</span> {cueDiffLabel(cue)}</p>)}
                          {diff.removed.map((cue, index) => <p key={`remove:${index}:${cue.start_ms}`}><span className="font-bold text-red-300">REMOVE</span> {cueDiffLabel(cue)}</p>)}
                          {diff.changed.map((change, index) => (
                            <p key={`change:${index}:${change.after.start_ms}`}>
                              <span className="font-bold text-amber-200">CHANGE</span> {cueDiffLabel(change.before)} → {cueDiffLabel(change.after)} · {cueDiffChangeLabel(change)}
                            </p>
                          ))}
                          {diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0 && diff.conflicts.length === 0 && <p>No cue changes for this track.</p>}
                        </div>
                      )}
                    </details>
                  );
                })}
              </div>

              <p className="text-xs font-semibold text-foreground">{applyScope?.kind === 'track' ? 'Apply Track replaces the complete Rekordbox cue set for this track.' : `Apply All replaces the complete Rekordbox cue set for each of these ${applyPreflight.tracks.length} tracks.`}</p>
              <p className="text-xs text-muted-foreground">DropDex will retain the guarded backup identity, write only to an isolated staging database, verify the staged cue sets, atomically replace the trusted local Rekordbox database, and re-verify the live result. Rekordbox must remain closed.</p>
              <div className="flex justify-end gap-2">
                <ControlButton variant="ghost" disabled={applyBusy} onClick={() => { applyGenerationRef.current += 1; setApplyPreflight(null); setApplyScope(null); setApplySnapshot([]); }}>Cancel</ControlButton>
                <ControlButton variant="primary" disabled={applyBusy || !applyPreflight.ok || !applyPreflight.token || applyPreflight.blockers.length > 0 || Boolean(applyScope?.kind === 'track' && !selectedCueBaselineEditable)} onClick={() => { void handleConfirmApply(); }}>
                  {applyBusy ? 'Applying…' : applyScope?.kind === 'track' ? 'Confirm Apply Track' : `Confirm Apply All (${applyPreflight.tracks.length})`}
                </ControlButton>
              </div>
            </div>
          ) : (
            <div className="space-y-2 text-xs text-muted-foreground">
              {applyRebaseRecovery && applyRebaseRecovery.userId === userId && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-400/25 bg-red-400/[0.06] p-3 text-red-100">
                  <div>
                    <p className="font-black">Verified local write needs baseline recovery</p>
                    <p className="mt-1 text-red-100/80">
                      Rekordbox already contains the verified cue state for {applyRebaseRecovery.items.length} track{applyRebaseRecovery.items.length === 1 ? '' : 's'}, but cloud baseline persistence is incomplete. Further Apply actions are blocked until this proof is recorded or the import is safely refreshed.
                    </p>
                  </div>
                  <ControlButton variant="surface" disabled={applyBusy || applyRebaseRecovery.importId !== importId} onClick={() => { void handleRetryApplyRebase(); }}>
                    {applyBusy ? 'Retrying…' : applyRebaseRecovery.importId === importId ? 'Retry verified rebase' : 'Return to affected import'}
                  </ControlButton>
                </div>
              )}
              {applyResult && <p className="font-bold text-foreground">Last apply result: {applyResult.state} · {applyResult.tracks.filter((track) => track.state === 'verified').length}/{applyResult.tracks.length} tracks verified{applyResult.backup_identity ? ` · backup ${applyResult.backup_identity.slice(0, 12)}…` : ''}</p>}
              {applyMessage && <p>{applyMessage}</p>}
              {applyDraftLoadError && (
                <div className="flex flex-wrap items-center justify-between gap-3 text-red-300">
                  <p>{applyDraftLoadError}</p>
                  <ControlButton
                    variant="surface"
                    disabled={!userId || !importId || applyBusy}
                    onClick={() => setApplyDraftRetryNonce((value) => value + 1)}
                  >
                    Retry loading drafts
                  </ControlButton>
                </div>
              )}
              {!applyBridgeAvailable && applyBridgeReason && <p>{applyBridgeReason}</p>}
            </div>
          )}
        </div>
      )}

      <section className="glass rounded-2xl overflow-hidden border border-[var(--color-border-subtle)]">
        <div className="border-b border-[var(--color-border-subtle)] px-4 py-4 md:px-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-[200px] xl:max-w-xs">
              <div className="pb-2 border-b border-white/15 hover:border-white/35 transition-colors focus-within:border-white/35">
                <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground mb-1">Search</p>
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Title or artist…"
                  aria-label="Search cue point tracks"
                  className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/30 outline-none"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
              <CueFilterDropdown
                label="Genre"
                value={genre}
                onChange={setGenre}
                options={[
                  { value: '', label: 'All' },
                  ...(stats?.genreTotals ?? []).map((item) => ({ value: item.name, label: `${item.name} (${item.count})` })),
                ]}
              />
              <CueFilterDropdown
                label="Key"
                value={keyFilter}
                onChange={setKeyFilter}
                options={[
                  { value: '', label: 'All' },
                  ...(stats?.keyTotals ?? []).map((item) => ({ value: item.name, label: `${item.name} (${item.count})` })),
                ]}
              />
              <CueFilterDropdown
                label="Cue States"
                value={cueFilter}
                onChange={(v) => setCueFilter(v as CueFilter)}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'with-cues', label: 'Has cues' },
                  { value: 'without-cues', label: 'No cues' },
                ]}
              />
              <CueFilterDropdown
                label="Analysis"
                value={analysisFilter}
                onChange={(v) => setAnalysisFilter(v as AnalysisFilter)}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'ready', label: 'Analysis ready' },
                  { value: 'incomplete', label: 'Needs analysis' },
                ]}
              />
              <CueBpmRangeSlider
                bounds={bpmBounds}
                value={bpmRange ?? bpmBounds}
                onChange={setBpmRange}
                onReset={() => setBpmRange(null)}
              />
            </div>
          </div>
        </div>

        {cueSummaryFailureCount > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-red-400/15 bg-red-400/[0.04] px-5 py-3 text-xs text-red-200" role="status">
            <span>
              Cue counts could not be resolved for {cueSummaryFailureCount} track{cueSummaryFailureCount === 1 ? '' : 's'}. Those tracks are excluded from Has cues / No cues results until the request succeeds.
            </span>
            <ControlButton variant="ghost" onClick={() => setCueSummaryRetryNonce((value) => value + 1)}>
              Retry cue counts
            </ControlButton>
          </div>
        )}

        {error ? (
          <div className="flex items-center gap-3 px-5 py-8 text-sm text-red-300">
            <WarningAlt size={20} />
            <span>{error}</span>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-3 py-16 text-sm text-muted-foreground">
            <CircleDash className="animate-spin text-primary" size={22} /> Loading library tracks…
          </div>
        ) : filteredTracks.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="font-bold">No tracks match these filters.</p>
            <p className="mt-1 text-sm text-muted-foreground">Try clearing a search or filter to widen the library view.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-left">
                <thead className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-[var(--color-border-faint)]">
                    {([
                      { col: 'track', label: 'Track', cls: 'px-4 py-2.5 md:px-5' },
                      { col: 'bpm', label: 'BPM', cls: 'px-3 py-2.5' },
                      { col: 'key', label: 'Key', cls: 'px-3 py-2.5' },
                      { col: 'genre', label: 'Genre', cls: 'px-3 py-2.5 w-[178px]' },
                      { col: 'cues', label: 'Cues', cls: 'px-3 py-2.5 text-center' },
                      { col: 'duration', label: 'Duration', cls: 'px-3 py-2.5 text-right w-[80px]' },
                    ] as const).map(({ col, label, cls }) => (
                      <th key={col} className={cn(cls, 'select-none cursor-pointer hover:text-foreground transition-colors')}
                        onClick={() => handleColClick(col)}>
                        <span className="inline-flex items-center gap-1">
                          {label}
                          {sortCol === col && (
                            <span className="text-primary">{sortDir === 'asc' ? '↑' : '↓'}</span>
                          )}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-faint)]">
                  {sortedTracks.map((track) => {
                    const cueState = cueSummaryStates.get(track.id);
                    const cueCount = cueLoadCount(cueState);
                    const selected = track.id === selectedTrackId;
                    return (
                      <tr
                        key={track.id}
                        tabIndex={0}
                        aria-selected={selected}
                        onClick={() => setSelectedTrack(track)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelectedTrack(track);
                          }
                        }}
                        className={cn(
                          'cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50',
                          selected ? 'bg-primary/[0.08]' : 'hover:bg-[var(--color-surface-hover)]',
                        )}
                      >
                        <td className="px-4 py-3 md:px-5">
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              'h-2 w-2 shrink-0 rounded-full',
                              analysisReady(track)
                                ? 'bg-emerald-400'
                                : track.analysis_parse_status === 'failed' || track.analysis_parse_status === 'missing_required'
                                  ? 'bg-red-400'
                                  : track.analysis_parse_status == null
                                    ? 'bg-muted-foreground/40'
                                    : 'bg-amber-400',
                            )} aria-hidden="true" />
                            <span className={cn('h-8 w-1 shrink-0 rounded-full', selected ? 'bg-primary' : 'bg-transparent')} aria-hidden="true" />
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                              <div className="min-w-0 max-w-[152px]">
                                <p className={cn('truncate text-sm font-bold', selected && 'text-primary')}>{track.title}</p>
                                <p className="mt-0.5 truncate text-xs text-muted-foreground">{track.artist ?? 'Artist Not Stored'}</p>
                              </div>
                              {(() => {
                                const ws = getWaveformState(track.id);
                                if (ws?.status !== 'loaded' || !ws.waveform.previewColumnsValid) return null;
                                const cols = ws.waveform.previewColumns;
                                if (cols.length === 0) return null;
                                const maxH = Math.max(...cols.map(c => c.h), 1);
                                const W = 88, H = 20, n = Math.min(cols.length, W);
                                const step = cols.length / n;
                                const barW = Math.max(1, W / n - 0.4);
                                return (
                                  <svg width={W} height={H} className="shrink-0 opacity-55" aria-hidden="true">
                                    {Array.from({ length: n }, (_, i) => {
                                      const col = cols[Math.floor(i * step)];
                                      const h = Math.max(1, (col.h / maxH) * H);
                                      const fill = 'r' in col ? `rgb(${col.r},${col.g},${col.b})` : '#4899d4';
                                      return (
                                        <rect key={i} x={i * (W / n)} y={(H - h) / 2} width={barW} height={h} fill={fill} />
                                      );
                                    })}
                                  </svg>
                                );
                              })()}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 font-mono text-xs font-bold tabular-nums">{track.bpm != null ? track.bpm.toFixed(1) : '—'}</td>
                        <td className="px-3 py-3">
                          {(() => { const kc = camelotColor(track.musical_key); return (
                            <span className="rounded-md p-1.5 font-mono text-[11px] font-bold"
                              style={{ backgroundColor: kc, color: 'rgba(255,255,255,0.88)' }}>
                              {formatCamelotKey(track.musical_key)}
                            </span>
                          ); })()}
                        </td>
                        <td className="w-[178px] px-3 py-3 text-xs text-muted-foreground"><span className="block truncate">{track.genre ?? '—'}</span></td>
                        <td className="px-3 py-3 text-center">
                          <span className={cn(
                            'inline-flex min-w-8 justify-center rounded-md border px-2 py-1 font-mono text-[10px] font-black',
                            cueState?.status === 'failed'
                              ? 'border-red-400/25 bg-red-400/10 text-red-300'
                              : (cueCount ?? 0) > 0
                              ? 'border-secondary/25 bg-secondary/10 text-secondary'
                              : 'border-[var(--color-border-subtle)] bg-[var(--color-surface)] text-muted-foreground',
                          )} title={cueState?.status === 'failed' ? cueState.error : undefined}>
                            {cueState?.status === 'loading' || !cueState ? '…' : cueState.status === 'failed' ? '!' : cueCount}
                          </span>
                        </td>
                        <td className="w-[80px] px-3 py-3 text-right font-mono text-xs text-muted-foreground">
                          {formatTime(durationMsForTrack(track, null))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 border-t border-[var(--color-border-subtle)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-5">
              <p className="text-xs text-muted-foreground">
                Showing {filteredTracks.length.toLocaleString()} loaded rows · {total.toLocaleString()} tracks match title/genre filters
              </p>
              {hasMore && (
                <ControlButton variant="surface" onClick={() => void loadMore()} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : 'Load more tracks'}
                </ControlButton>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
