import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Add, ChevronDown, CircleDash, Close, Edit, Export, Idea, Music, Pause, Play, Repeat, Save, Search, Subtract, Upload, VolumeMute, VolumeUp, WarningAlt } from '@carbon/icons-react';
import { AudioWaveform, Bookmark, Grip, List, RotateCcw } from 'lucide-react';
import { cn, formatKey } from '../../lib/utils';
import { isUsableBeatGrid } from '../../lib/music/beatGridHelpers';
import { gridBeatsForMode, MIN_CUE_TIMELINE_WINDOW_MS, panCueTimelineView, zoomCueTimelineView, type CueGridDisplayMode } from '../../lib/cues/cueTimelineViewport';
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
  type CueSnapResolution,
  type WorkingCue,
} from '../../lib/music/cueEditorState';
import { useLibraryStats, useLibraryTracks } from '../../hooks/useRekordboxTracks';
import { useRekordboxPlaylists } from '../../hooks/useRekordboxPlaylists';
import { useRekordboxPlaylistTracks } from '../../hooks/useRekordboxPlaylistTracks';
import { fetchTracksByIds } from '../../lib/queries/rekordbox';
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
import { ControlButton, SearchControl, SelectControl, TextControl } from '../ui/controls';
import { Artwork } from '../ui/display/Artwork';
import { TabNavigation } from '../ui/display/TabNavigation';
import { MediaTransportControlGroup } from '../ui/media';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { useWaveformProgress } from '../../hooks/useWaveformProgress';
import { clampCueTransportTime, cueAdjacentTrackIndex, cuePlaybackPlayheadPercent } from '../../lib/cues/cuePlaybackTransport';
import type { RekordboxTrack } from '../../types';
import './CuePointsView.css';
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
  cueDraftHasVerifiedBaseline,
  fetchCueDraftsForApply,
  markCueDraftApplied,
  markCueDraftApplyOutcome,
  saveCueDraft,
  updateCueBaselineFingerprint,
  type CueDraftRow,
} from '../../lib/queries/cueDrafts';
import {
  discardGenreMetadataDraft,
  fetchTrackMetadataDraftsForImport,
  finalizeTrackMetadataApply,
  isTrackMetadataDraftRecoveryLocked,
  markTrackMetadataApplyOutcome,
  normalizeGenreMetadataDraftValue,
  REKORDBOX_GENRE_MAX_LENGTH,
  saveGenreMetadataDraft,
  TrackMetadataDraftRevisionConflictError,
  validateGenreMetadataDraftValue,
  type TrackMetadataDraftRow,
} from '../../lib/queries/trackMetadataDrafts';
import { resolveCueApplySelection, type CueApplyScope } from '../../lib/cues/cueApplyScope';
import {
  buildMetadataRecoveryRequest,
  MetadataApplyProofError,
  validateMetadataApplyOutcomeEnvelope,
  validateMetadataRecoveryVerification,
  validateVerifiedMetadataApplyResult,
} from '../../lib/metadata/metadataApplyOrchestration';
import { PendingMetadataChangesReview } from './PendingMetadataChangesReview';
import type {
  DesktopCueApplyPreflightResult,
  DesktopCueApplyResult,
  DesktopCueDiffChange,
  DesktopCueDiffCue,
  DesktopMetadataApplyResult,
  DesktopMetadataDraft,
  DesktopMetadataPreflightResult,
} from '../../types/dropdex-desktop';

interface CuePointsViewProps {
  importId: string | null;
  onImport: () => void;
}

type CueFilter = 'all' | 'with-cues' | 'without-cues';
type AnalysisFilter = 'all' | 'ready' | 'incomplete';
type StatusFilter = 'all' | 'ready' | 'partial' | 'errored' | 'pending';
type BrowserSource = 'library' | 'playlists';
type CueDraftStatus = 'Original' | 'Unsaved' | 'Saved' | 'Needs Verification' | 'Needs Apply' | 'Applied';
type TerminalCueLoadStatus = 'loaded-empty' | 'loaded-with-cues' | 'failed';
type SelectedCueLoadStatus = 'idle' | 'loading' | TerminalCueLoadStatus;
type MetadataDraftLoadStatus = 'idle' | 'loading' | 'loaded' | 'failed';
type MetadataCloudOutcomeState = 'finalized' | 'recovery-required' | 'proof-mismatch' | 'persistence-failed';

interface MetadataCloudOutcome {
  state: MetadataCloudOutcomeState;
  message: string;
}

interface GenreSaveErrorState {
  trackId: string;
  message: string;
  revisionConflict: boolean;
}

function metadataDraftNeedsApply(draft: TrackMetadataDraftRow): boolean {
  if (isTrackMetadataDraftRecoveryLocked(draft)) return false;
  return normalizeGenreMetadataDraftValue(draft.pendingValue)
    !== normalizeGenreMetadataDraftValue(draft.currentBaselineValue);
}

function metadataDraftNeedsReview(draft: TrackMetadataDraftRow): boolean {
  return metadataDraftNeedsApply(draft) || isTrackMetadataDraftRecoveryLocked(draft);
}

function metadataApplySafeSummary(result: DesktopMetadataApplyResult, code?: string) {
  return {
    code,
    blockerCodes: result.blockers.map((blocker) => blocker.code),
    warningCodes: result.warnings.map((warning) => warning.code),
    rollbackVerified: result.rollback_verified ?? undefined,
  };
}

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

  // Rekordbox Content.length is the single source of truth, stored as duration_ms.
  // Guard against the Device Library Plus unit bug where Content.length (seconds) was
  // stored verbatim as duration_ms — a 95-second track would show as 95 ms. Any stored
  // duration under 1,000 ms (1 s) is implausible for a DJ track and is treated as absent
  // so beat-grid and phrase fallbacks can supply the correct value.
  if (typeof track.duration_ms === 'number' && Number.isFinite(track.duration_ms) && track.duration_ms >= 1_000) {
    return track.duration_ms;
  }
  if (typeof track.duration_seconds === 'number' && Number.isFinite(track.duration_seconds) && track.duration_seconds > 0) {
    return track.duration_seconds * 1000;
  }

  // Stored duration absent — fall back to beat-grid, then phrases.
  const beats = beatGrid?.beats ?? [];
  const lastBeat = beats[beats.length - 1];
  if (lastBeat && Number.isFinite(lastBeat.ms) && lastBeat.ms > 0) {
    return lastBeat.ms + (lastBeat.bpm > 0 ? 60_000 / lastBeat.bpm : 500);
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

function cueSnapResolutionLabel(resolution: CueSnapResolution): string {
  if (resolution === '1-beat') return '1 Beat';
  if (resolution === '2-beats') return '2 Beats';
  if (resolution === '4-beats') return '4 Beats';
  return 'Off';
}

function timelineGridLines(beats: BeatEntry[]): BeatEntry[] {
  if (beats.length <= MAX_TIMELINE_GRID_LINES) return beats;
  const step = Math.ceil(beats.length / MAX_TIMELINE_GRID_LINES);
  const sampled = new Map<number, BeatEntry>();
  beats.forEach((beat, index) => {
    if (beat.isDownbeat || beat.beatInBar === 1 || index % step === 0) sampled.set(beat.seq, beat);
  });
  return [...sampled.values()].sort((a, b) => a.ms - b.ms);
}

function beatRulerTicks(beats: BeatEntry[]): BeatEntry[] {
  if (beats.length <= MAX_BEAT_RULER_TICKS) return beats;
  const step = Math.ceil(beats.length / MAX_BEAT_RULER_TICKS);
  const sampled = new Map<number, BeatEntry>();
  beats.forEach((beat, index) => {
    if (beat.isDownbeat || beat.beatInBar === 1 || index % step === 0) sampled.set(beat.seq, beat);
  });
  return [...sampled.values()].sort((a, b) => a.ms - b.ms);
}

function barLabelBeats(beats: BeatEntry[]): BeatEntry[] {
  const downbeats = beats.filter((beat) => beat.isDownbeat || beat.beatInBar === 1);
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
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const val = valFromClientX(e.clientX);
    onChange([Math.min(val, hi), hi]);
  }

  function handleHiPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const val = valFromClientX(e.clientX);
    onChange([lo, Math.max(val, lo)]);
  }

  function handleSliderKeyDown(
    event: React.KeyboardEvent<HTMLDivElement>,
    kind: 'minimum' | 'maximum',
  ) {
    const current = kind === 'minimum' ? lo : hi;
    const minimum = kind === 'minimum' ? bMin : lo;
    const maximum = kind === 'minimum' ? hi : bMax;
    let next: number | null = null;

    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = current - 1;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = current + 1;
    else if (event.key === 'PageDown') next = current - 5;
    else if (event.key === 'PageUp') next = current + 5;
    else if (event.key === 'Home') next = minimum;
    else if (event.key === 'End') next = maximum;

    if (next == null) return;
    event.preventDefault();
    const clamped = Math.max(minimum, Math.min(maximum, next));
    if (kind === 'minimum') onChange([clamped, hi]);
    else onChange([lo, clamped]);
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
            role="slider"
            tabIndex={0}
            aria-label="Minimum BPM"
            aria-valuemin={bMin}
            aria-valuemax={hi}
            aria-valuenow={lo}
            aria-valuetext={`${lo} BPM`}
            className="absolute bottom-[5px] translate-y-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-[var(--color-card)] border border-primary cursor-grab active:cursor-grabbing touch-none flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            style={{ left: `${loPct}%` }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              handleLoPointerMove(e);
            }}
            onPointerMove={handleLoPointerMove}
            onKeyDown={(event) => handleSliderKeyDown(event, 'minimum')}
          >
            <span className="text-[8px] font-black text-foreground tabular-nums leading-none pointer-events-none">{lo}</span>
          </div>
          <div
            role="slider"
            tabIndex={0}
            aria-label="Maximum BPM"
            aria-valuemin={lo}
            aria-valuemax={bMax}
            aria-valuenow={hi}
            aria-valuetext={`${hi} BPM`}
            className="absolute bottom-[5px] translate-y-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-[var(--color-card)] border border-primary cursor-grab active:cursor-grabbing touch-none flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            style={{ left: `${hiPct}%` }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              handleHiPointerMove(e);
            }}
            onPointerMove={handleHiPointerMove}
            onKeyDown={(event) => handleSliderKeyDown(event, 'maximum')}
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
  searchable = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedLabel = options.find((o) => o.value === value)?.label ?? options[0]?.label ?? value;

  const filtered = searchable && search.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(search.trim().toLowerCase()))
    : options;

  const closeAndRestoreFocus = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) { setSearch(''); return; }
    const focusTimer = window.setTimeout(() => {
      if (searchable) searchRef.current?.focus();
      else {
        const selected = listboxRef.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');
        const first = listboxRef.current?.querySelector<HTMLElement>('[role="option"]');
        (selected ?? first)?.focus();
      }
    }, 0);
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeAndRestoreFocus();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [closeAndRestoreFocus, open, searchable]);

  function handleListboxKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const optionElements = [...(listboxRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    if (optionElements.length === 0) return;
    event.preventDefault();
    const currentIndex = optionElements.indexOf(document.activeElement as HTMLElement);
    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = optionElements.length - 1;
    else if (event.key === 'ArrowDown') nextIndex = currentIndex < 0 ? 0 : Math.min(optionElements.length - 1, currentIndex + 1);
    else if (event.key === 'ArrowUp') nextIndex = currentIndex < 0 ? optionElements.length - 1 : Math.max(0, currentIndex - 1);
    optionElements[nextIndex]?.focus();
  }

  return (
    <div ref={ref} className="relative min-w-[130px]">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left pb-2 border-b border-white/15 hover:border-white/35 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
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
          ref={listboxRef}
          role="listbox"
          aria-label={`${label} filter options`}
          onKeyDown={handleListboxKeyDown}
          className="absolute top-full left-0 mt-1.5 z-50 min-w-full overflow-y-auto overscroll-contain rounded-md border border-[var(--color-control-border)] bg-[var(--color-control-surface)] shadow-[0_12px_28px_rgba(0,0,0,0.32)] max-h-[320px]"
        >
          {searchable && (
            <div className="dd-control-wrap sticky top-0 p-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-card)]">
              <Search size={16} className="dd-control-start-icon" aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                aria-label={`Search ${label} filter options`}
                className="dd-text-control dd-text-control--with-start-icon"
                style={{ minHeight: 34, fontSize: 13 }}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
          {filtered.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">No results</p>
          ) : filtered.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={value === opt.value}
              onClick={() => { onChange(opt.value); closeAndRestoreFocus(); }}
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

function CueTrackPlayButton({ track }: { track: RekordboxTrack }) {
  const { activeTrack, status, playIntent, toggleTrack } = useAudioPlayer();
  const isActive = activeTrack?.id === track.id;
  const isPlaying = isActive && playIntent && status !== 'error';
  const isLoading = isActive && (status === 'resolving' || status === 'loading' || status === 'buffering' || status === 'seeking');

  return (
    <button
      type="button"
      aria-label={isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
      title={track.file_path ? (isPlaying ? `Pause ${track.title}` : `Play ${track.title}`) : 'This track has no playable file path'}
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-all',
        isActive
          ? 'border-primary/40 bg-primary/15 text-primary opacity-100'
          : 'border-[var(--color-border-subtle)] bg-[var(--color-surface)] text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
        'hover:border-primary/50 hover:bg-primary/15 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
      )}
      onClick={(event) => {
        event.stopPropagation();
        void toggleTrack(track);
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {isLoading ? <CircleDash size={13} className="animate-spin" /> : isPlaying ? <Pause size={13} /> : <Play size={13} />}
    </button>
  );
}

function CueEditorPlaybackPlayhead({
  trackId,
  viewStartMs,
  viewEndMs,
  labelsCollapsed,
}: {
  trackId: string;
  viewStartMs: number;
  viewEndMs: number;
  labelsCollapsed: boolean;
}) {
  const { activeTrack, status, getAudioElement } = useAudioPlayer();
  const playbackProgress = useWaveformProgress(trackId);
  if (activeTrack?.id !== trackId || status === 'idle' || status === 'resolving' || status === 'loading' || status === 'error' || playbackProgress === undefined) return null;

  const audio = getAudioElement();
  const currentTimeMs = audio && Number.isFinite(audio.currentTime) ? audio.currentTime * 1000 : Number.NaN;
  const leftPercent = cuePlaybackPlayheadPercent(currentTimeMs, viewStartMs, viewEndMs);
  if (leftPercent == null) return null;

  return (
    <div
      data-testid="cue-playback-playhead-region"
      className="pointer-events-none absolute bottom-0 top-0 z-30 transition-[left] duration-200"
      style={{
        left: `calc(${labelsCollapsed ? 48 : 150}px + var(--cue-timeline-inline-inset))`,
        right: 'var(--cue-timeline-inline-inset)',
      }}
      aria-hidden="true"
    >
      <span
        data-testid="cue-playback-playhead"
        className="absolute bottom-0 top-0 w-px -translate-x-1/2 bg-white shadow-[0_0_7px_rgba(255,255,255,0.75)]"
        style={{ left: `${leftPercent}%` }}
      >
        <span className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 -translate-y-[2px] rotate-45 rounded-[1px] bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)]" />
      </span>
    </div>
  );
}

function CuePointsAudioDock({
  selectedTrack,
  orderedTracks,
  onSelectTrack,
}: {
  selectedTrack: RekordboxTrack | null;
  orderedTracks: RekordboxTrack[];
  onSelectTrack: (track: RekordboxTrack) => void;
}) {
  const {
    activeTrack,
    status,
    playIntent,
    volume,
    muted,
    repeat,
    error,
    playTrack,
    toggleTrack,
    seek,
    setVolume,
    toggleMute,
    toggleRepeat,
    getAudioElement,
  } = useAudioPlayer();
  const playbackProgress = useWaveformProgress(activeTrack?.id);
  const orderedTrackIds = useMemo(() => orderedTracks.map((track) => track.id), [orderedTracks]);
  const previousIndex = cueAdjacentTrackIndex(orderedTrackIds, activeTrack?.id, selectedTrack?.id, -1);
  const nextIndex = cueAdjacentTrackIndex(orderedTrackIds, activeTrack?.id, selectedTrack?.id, 1);
  const displayTrack = activeTrack ?? selectedTrack;
  const audio = getAudioElement();
  const durationSeconds = audio && Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
  const fallbackCurrentTime = playbackProgress != null && durationSeconds > 0 ? playbackProgress * durationSeconds : 0;
  const currentSeconds = audio && Number.isFinite(audio.currentTime) ? audio.currentTime : fallbackCurrentTime;
  const loading = status === 'resolving' || status === 'loading';
  const hasTransportTrack = Boolean(activeTrack ?? selectedTrack);
  const transportBlocked = !hasTransportTrack || loading || status === 'error';
  const seekable = Boolean(activeTrack && durationSeconds > 0 && !transportBlocked);
  const playing = Boolean(activeTrack && playIntent && status !== 'error');

  const playAdjacent = useCallback((index: number | null) => {
    if (transportBlocked || index == null) return;
    const destination = orderedTracks[index];
    if (!destination) return;
    onSelectTrack(destination);
    void playTrack(destination);
  }, [onSelectTrack, orderedTracks, playTrack, transportBlocked]);

  const handleTogglePlay = useCallback(() => {
    const target = activeTrack ?? selectedTrack;
    if (!target || transportBlocked) return;
    void toggleTrack(target);
  }, [activeTrack, selectedTrack, toggleTrack, transportBlocked]);

  const handleSeekBy = useCallback((deltaSeconds: number) => {
    if (!seekable) return;
    seek(clampCueTransportTime(currentSeconds, durationSeconds, deltaSeconds));
  }, [currentSeconds, durationSeconds, seek, seekable]);

  return (
    <div
      data-testid="cue-audio-dock"
      className="cue-audio-dock flex min-w-0 flex-1 flex-col gap-2 px-2.5 py-2 xl:flex-row xl:items-center"
      role="region"
      aria-label="Cue Points audio dock"
    >
      <div className="flex min-w-0 items-center gap-2.5 xl:w-[210px] xl:shrink-0">
        {displayTrack ? (
          <Artwork
            src={displayTrack.artwork_path}
            alt={`Artwork for ${displayTrack.title}`}
            fallbackTitle="No artwork"
            className="h-9 w-9 shrink-0 rounded-[6px]"
          />
        ) : (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] border border-[var(--color-border-faint)] bg-black/10 text-muted-foreground">
            <Music size={16} />
          </div>
        )}
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            {loading && <CircleDash size={12} className="shrink-0 animate-spin text-primary" />}
            <p className="truncate text-xs font-bold text-foreground">{displayTrack?.title ?? 'Select a track'}</p>
          </div>
          <p className={cn('truncate text-[10px]', status === 'error' ? 'text-amber-300' : 'text-muted-foreground')}>
            {status === 'error' ? error ?? 'Playback unavailable' : displayTrack?.artist ?? 'Ready for playback'}
          </p>
        </div>
      </div>

      <MediaTransportControlGroup
        compact
        ariaLabel="Cue Points transport controls"
        playing={playing}
        onPrevious={() => playAdjacent(previousIndex)}
        onRewind={() => handleSeekBy(-10)}
        onTogglePlay={handleTogglePlay}
        onForward={() => handleSeekBy(10)}
        onNext={() => playAdjacent(nextIndex)}
        previousDisabled={transportBlocked || previousIndex == null}
        rewindDisabled={!seekable}
        playDisabled={transportBlocked}
        forwardDisabled={!seekable}
        nextDisabled={transportBlocked || nextIndex == null}
      />

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="w-9 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
          {formatTime(currentSeconds * 1000)}
        </span>
        <input
          type="range"
          min={0}
          max={durationSeconds > 0 ? durationSeconds : 1}
          step={0.1}
          value={seekable ? Math.min(durationSeconds, Math.max(0, currentSeconds)) : 0}
          disabled={!seekable}
          onChange={(event) => seek(Number(event.target.value))}
          aria-label="Cue Points playback position"
          className="h-1.5 min-w-[120px] flex-1 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-40"
        />
        <span className="w-9 shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
          {formatTime(durationSeconds > 0 ? durationSeconds * 1000 : null)}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          aria-label={repeat ? 'Disable repeat' : 'Repeat current track'}
          aria-pressed={repeat}
          disabled={!activeTrack || transportBlocked}
          onClick={toggleRepeat}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-35',
            repeat
              ? 'border-primary/40 bg-primary/15 text-primary'
              : 'border-[var(--color-border-subtle)] bg-[var(--color-card)] text-muted-foreground hover:text-foreground',
          )}
        >
          <Repeat size={14} />
        </button>
        <button
          type="button"
          aria-label={muted ? 'Unmute' : 'Mute'}
          onClick={toggleMute}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-card)] text-muted-foreground transition-colors hover:text-foreground"
        >
          {muted || volume === 0 ? <VolumeMute size={14} /> : <VolumeUp size={14} />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={volume}
          onChange={(event) => setVolume(Number(event.target.value))}
          aria-label="Cue Points playback volume"
          className="h-1.5 w-20 cursor-pointer accent-primary"
        />
      </div>
    </div>
  );
}

function beatPositionLabel(beat: BeatEntry | undefined): string {
  if (!beat) return '—';
  return `${beat.bar}.${beat.beatInBar}.1`;
}

function TimelineLaneLabel({ icon, label, color, children, collapsed }: { icon: ReactNode; label: string; color: string; children?: ReactNode; collapsed?: boolean }) {
  return (
    <div className={cn(
      'pointer-events-none relative flex h-full items-center text-[#d9dde1] transition-all duration-200',
      collapsed ? 'justify-center px-0' : 'gap-3.5 pl-[10px] pr-1',
    )}>
      {!collapsed && (
        <span className="absolute left-[2px] top-1/2 h-[20px] w-[3px] -translate-y-1/2 rounded-full" style={{ backgroundColor: color }} />
      )}
      <span className="shrink-0" style={{ color: color }} aria-hidden="true">{icon}</span>
      {!collapsed && (
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold tracking-[-0.015em]">{label}</p>
          {children}
        </div>
      )}
    </div>
  );
}

function CueInspector({
  cue,
  cues,
  snapResolution,
  onMoveCue,
  onEditCue,
  onMessage,
  onClose,
  editable = true,
}: {
  cue: WorkingCue;
  cues: WorkingCue[];
  snapResolution: CueSnapResolution;
  onMoveCue: (cueId: string, requestedMs: number, snapResolution: CueSnapResolution) => string | null;
  onEditCue: (cueId: string, action: CueEditAction) => string | null;
  onMessage: (message: string | null) => void;
  onClose: () => void;
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
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-muted-foreground">Selected cue</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-sm font-black">{cueDisplayName(cue)}</span>
            <span className="rounded-md border border-white/10 px-2 py-0.5 font-mono text-[9px] text-muted-foreground">
              {snapResolution === 'off' ? 'SNAP OFF · integer ms' : `SNAP · ${cueSnapResolutionLabel(snapResolution)}`}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-0.5"
          title="Dismiss cue inspector"
          aria-label="Dismiss selected cue inspector"
          onClick={onClose}
        >
          <Close size={15} />
        </button>
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
              (value) => onMoveCue(cue.editorId, value, snapResolution),
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
                (value) => onEditCue(cue.editorId, { kind: 'end-ms', requestedMs: value, snapResolution }),
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
                (value) => onEditCue(cue.editorId, { kind: 'loop-length-ms', requestedMs: value, snapResolution }),
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
        1 Beat is the default snap resolution. Snap Off records deliberate integer-millisecond timing, and changing resolution alone never resnaps an existing cue.
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
  pendingMetadataCount,
  metadataDraftLoadStatus,
  onOpenPendingChanges,
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
  onAddCue: (family: 'hot' | 'memory', requestedMs: number, snapResolution: CueSnapResolution) => string | null;
  onMoveCue: (cueId: string, requestedMs: number, snapResolution: CueSnapResolution) => string | null;
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
  pendingMetadataCount: number;
  metadataDraftLoadStatus: MetadataDraftLoadStatus;
  onOpenPendingChanges: () => void;
}) {
  const [labelsCollapsed, setLabelsCollapsed] = useState(false);
  const durationMs = durationMsForTrack(track, beatGrid, phrases);

  const [viewStart, setViewStart] = useState(0);
  const [viewEnd, setViewEnd] = useState<number | null>(null);
  const [selectedCueId, setSelectedCueId] = useState<string | null>(null);
  const viewRef = useRef({ start: 0, end: null as number | null });
  const wheelRafRef = useRef<number | null>(null);
  const waveformDivRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<CueContextMenuState | null>(null);
  const [editorMessage, setEditorMessage] = useState<string | null>(null);
  const [snapResolution, setSnapResolution] = useState<CueSnapResolution>('1-beat');
  const [gridDisplayMode, setGridDisplayMode] = useState<CueGridDisplayMode>('beats');
  const [applyMenuOpen, setApplyMenuOpen] = useState(false);
  const applyMenuRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{ cueId: string; pointerId: number; startX: number; moved: boolean } | null>(null);
  const effectiveViewEnd = viewEnd ?? durationMs ?? 0;

  useEffect(() => {
    setViewStart(0);
    setViewEnd(null);
    setSelectedCueId(null);
    setContextMenu(null);
    setEditorMessage(null);
    setApplyMenuOpen(false);
    dragStateRef.current = null;
  }, [track?.id, durationMs]);

  useEffect(() => {
    setSnapResolution('1-beat');
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

  const closeApplyMenuAndRestoreFocus = useCallback(() => {
    setApplyMenuOpen(false);
    requestAnimationFrame(() => {
      applyMenuRef.current?.querySelector<HTMLButtonElement>('[aria-label="Open Apply menu"]')?.focus();
    });
  }, []);

  useEffect(() => {
    if (!applyMenuOpen) return;
    const focusFrame = requestAnimationFrame(() => {
      applyMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    });
    const handlePointerDown = (event: PointerEvent) => {
      if (!applyMenuRef.current?.contains(event.target as Node)) setApplyMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeApplyMenuAndRestoreFocus();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [applyMenuOpen, closeApplyMenuAndRestoreFocus]);

  function handleApplyMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...(applyMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    if (items.length === 0) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;
    else if (event.key === 'ArrowDown') nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    else if (event.key === 'ArrowUp') nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
  }


  // Keep viewRef in sync so wheel handler always reads the latest view without stale closures
  useEffect(() => { viewRef.current = { start: viewStart, end: viewEnd }; }, [viewStart, viewEnd]);

  useEffect(() => {
    const el = waveformDivRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!durationMs || durationMs <= 0) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const { start: vStart, end: vEndRaw } = viewRef.current;
      const vEnd = vEndRaw ?? durationMs;
      const viewRange = vEnd - vStart;
      const nextView = Math.abs(e.deltaX) > Math.abs(e.deltaY)
        ? panCueTimelineView({ start: vStart, end: vEnd }, durationMs, (e.deltaX / rect.width) * viewRange)
        : zoomCueTimelineView(
          { start: vStart, end: vEnd },
          durationMs,
          Math.exp(e.deltaY * 0.005),
          Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
        );
      if (!nextView) return;
      viewRef.current = nextView;
      if (!wheelRafRef.current) {
        wheelRafRef.current = requestAnimationFrame(() => {
          setViewStart(viewRef.current.start);
          setViewEnd(viewRef.current.end);
          wheelRafRef.current = null;
        });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [durationMs]);

  const sections = useMemo(
    () => buildTimelineSections(phrases, beatGrid, durationMs),
    [beatGrid, durationMs, phrases],
  );
  const displayGridBeats = useMemo(() => gridBeatsForMode(beatGrid?.beats ?? [], gridDisplayMode), [beatGrid, gridDisplayMode]);
  const gridLines = useMemo(() => timelineGridLines(displayGridBeats), [displayGridBeats]);
  const rulerTicks = useMemo(() => beatRulerTicks(displayGridBeats), [displayGridBeats]);
  const rulerLabels = useMemo(() => gridDisplayMode === 'off' ? [] : barLabelBeats(beatGrid?.beats ?? []), [beatGrid, gridDisplayMode]);
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

  const handleZoom = useCallback((factor: number) => {
    if (!durationMs || durationMs <= 0) return;
    const currentEnd = viewRef.current.end ?? durationMs;
    const nextView = zoomCueTimelineView({ start: viewRef.current.start, end: currentEnd }, durationMs, factor, 0.5);
    if (!nextView) return;
    viewRef.current = nextView;
    setViewStart(nextView.start);
    setViewEnd(nextView.end);
  }, [durationMs]);

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
    if (snapResolution !== 'off' && beatGridLoading) {
      setContextMenu(null);
      setEditorMessage('Cue editing will be available when the Rekordbox beat grid finishes loading.');
      return;
    }
    if (snapResolution !== 'off' && !hasUsableGrid) {
      setContextMenu(null);
      setEditorMessage('Beat snapping is unavailable because this track has no valid Rekordbox beat grid. Switch Snap to Off for deliberate off-grid timing.');
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
  }, [beatGridLoading, cueBaselineComplete, cueEditingAllowed, cueIntegrityError, cueLoadError, cueLoading, hasUsableGrid, timeAtClientX, snapResolution]);

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
    const error = onMoveCue(drag.cueId, requestedMs, snapResolution);
    setEditorMessage(error);
  }, [onMoveCue, timeAtClientX, snapResolution]);

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
      <section className="overflow-hidden border-y border-[var(--color-border-subtle)] bg-[var(--color-card)]">
        <div className="flex min-h-[280px] flex-col items-center justify-center px-6 text-center">
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
  const saveDisabled = (!dirty && !baselineProofRefreshNeeded) || !cueEditingAllowed || saving;
  const discardDisabled = !dirty || !cueEditingAllowed || saving;
  const applyTrackDisabled = !applyTrackAvailable || applying;
  const applyAllDisabled = applyAllCount === 0 || applying;

  return (
    <section className="cue-workstation relative overflow-visible border-y border-[var(--color-border-faint)]" data-testid="cue-points-workstation">
      <div className="cue-workstation__header flex flex-col gap-3 border-b border-[var(--color-border-faint)] px-4 py-3 lg:px-5 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          <Artwork
            src={track.artwork_path}
            alt={`Artwork for ${track.title}`}
            fallbackTitle="No artwork"
            className="h-16 w-16 shrink-0 rounded-[7px]"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-primary/75">Editing Track</p>
              <span className="rounded-[4px] border border-[var(--color-border-faint)] bg-white/[0.015] px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">{draftStatus}</span>
            </div>
            <h1 className="mt-1 truncate text-xl font-bold tracking-[-0.02em] text-foreground md:text-[21px]">{track.title}</h1>
            <p className="mt-0.5 truncate text-xs font-medium text-muted-foreground">{track.artist ?? 'Artist Not Available'}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-semibold text-muted-foreground">
              <span><span className="uppercase tracking-[0.08em] text-foreground/45">BPM</span> <strong className="ml-1 text-foreground/90">{bpmDisplay}</strong></span>
              <span><span className="uppercase tracking-[0.08em] text-foreground/45">Key</span> <strong className="ml-1" style={{ color: camelotColor(track.musical_key) }}>{keyDisplay}</strong></span>
              <span><span className="uppercase tracking-[0.08em] text-foreground/45">Duration</span> <strong className="ml-1 text-foreground/90">{durationDisplay}</strong></span>
              <span><span className="uppercase tracking-[0.08em] text-foreground/45">Cues</span> <strong className="ml-1 text-foreground/90">{cueLoading ? '…' : cueLoadStatus === 'failed' ? '!' : String(cues.length)}</strong></span>
            </div>
          </div>
        </div>

        <div className="cue-workstation__actions flex flex-wrap items-center gap-1.5 xl:max-w-[900px] xl:justify-end">
          <label className="cue-workstation__field flex min-h-[34px] items-center gap-1.5 pl-1.5 text-[9px] font-black uppercase tracking-[0.1em] text-muted-foreground">
            <span>Snap</span>
            <SelectControl
              aria-label="Snap resolution"
              value={snapResolution}
              onChange={(event) => setSnapResolution(event.target.value as CueSnapResolution)}
              className="min-h-[32px] min-w-[96px] border-0 bg-transparent py-0 text-[11px] normal-case tracking-normal"
            >
              <option value="off">Off</option>
              <option value="1-beat">1 Beat</option>
              <option value="2-beats">2 Beats</option>
              <option value="4-beats">4 Beats</option>
            </SelectControl>
          </label>
          <label className="cue-workstation__field flex min-h-[34px] items-center gap-1.5 pl-1.5 text-[9px] font-black uppercase tracking-[0.1em] text-muted-foreground">
            <span>Grid</span>
            <SelectControl
              aria-label="Grid display"
              value={gridDisplayMode}
              onChange={(event) => setGridDisplayMode(event.target.value as CueGridDisplayMode)}
              className="min-h-[32px] min-w-[86px] border-0 bg-transparent py-0 text-[11px] normal-case tracking-normal"
            >
              <option value="off">Off</option>
              <option value="beats">Beats</option>
              <option value="bars">Bars</option>
            </SelectControl>
          </label>
          <div className="cue-workstation__zoom flex overflow-hidden border-l border-[var(--color-border-faint)] pl-1.5" aria-label="Waveform zoom controls">
            <ControlButton
              className="min-h-[34px] w-[34px] rounded-none border-0 px-0"
              variant="surface"
              onClick={() => handleZoom(1 / 0.75)}
              disabled={!durationMs || effectiveViewEnd - viewStart >= durationMs}
              aria-label="Zoom out"
              title="Zoom out around the visible center"
            >
              <Subtract size={15} />
            </ControlButton>
            <ControlButton
              className="min-h-[34px] w-[34px] rounded-none border-0 border-l border-[var(--color-border-faint)] px-0"
              variant="surface"
              onClick={() => handleZoom(0.75)}
              disabled={!durationMs || durationMs <= 0 || effectiveViewEnd - viewStart <= Math.min(MIN_CUE_TIMELINE_WINDOW_MS, durationMs)}
              aria-label="Zoom in"
              title="Zoom in around the visible center"
            >
              <Add size={15} />
            </ControlButton>
          </div>
          <ControlButton
            className="min-h-[34px] px-2.5 text-[11px]"
            variant="surface"
            onClick={onOpenPendingChanges}
            aria-label={metadataDraftLoadStatus === 'loaded' ? `Open Pending Changes, ${pendingMetadataCount} pending` : 'Open Pending Changes'}
            title={metadataDraftLoadStatus === 'failed' ? 'Pending metadata state failed to load. Open to retry.' : 'Review saved metadata changes'}
          >
            {metadataDraftLoadStatus === 'loaded'
              ? `Pending ${pendingMetadataCount}`
              : metadataDraftLoadStatus === 'failed' ? 'Pending (!)' : 'Pending…'}
          </ControlButton>
          <ControlButton
            className="min-h-[34px] px-2.5 text-[11px]"
            variant="surface"
            disabled={!autoCueReady}
            onClick={() => setEditorMessage(onAutoCue())}
            title={autoCueReady ? 'Auto Cue: generate deterministic A–H cue proposals' : "Auto Cue requires the selected track's exact beat grid and phrase data to finish loading"}
          >
            <Idea size={16} />
            <span>Auto Cue</span>
          </ControlButton>
          <div ref={applyMenuRef} className="relative flex" data-testid="cue-apply-menu">
            <ControlButton
              className="min-h-[34px] rounded-r-none px-3 text-[11px]"
              variant="primary"
              disabled={applyAllDisabled}
              onClick={onApplyAll}
              title={applyAllCount > 0 ? `Apply all ${applyAllCount} saved track changes to local Rekordbox` : 'Apply All requires at least one saved draft that needs apply'}
            >
              {applying ? <CircleDash size={16} className="animate-spin" /> : <Export size={16} />}
              <span>Apply All ({applyAllCount})</span>
            </ControlButton>
            <ControlButton
              className="min-h-[34px] w-[32px] rounded-l-none border-l border-white/10 px-0"
              variant="primary"
              aria-label="Open Apply menu"
              aria-haspopup="menu"
              aria-expanded={applyMenuOpen}
              onClick={() => setApplyMenuOpen((open) => !open)}
              title="Save, Apply, or Discard"
            >
              <ChevronDown size={15} className={cn('transition-transform', applyMenuOpen && 'rotate-180')} />
            </ControlButton>
            {applyMenuOpen && (
              <div
                role="menu"
                aria-label="Cue draft and Apply actions"
                onKeyDown={handleApplyMenuKeyDown}
                className="absolute right-0 top-[calc(100%+6px)] z-[90] min-w-[220px] overflow-hidden rounded-lg border border-[#34414b] bg-[#11181e] p-1.5 shadow-2xl"
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={saveDisabled}
                  title={saving
                    ? 'Saving cue changes…'
                    : baselineProofRefreshNeeded && !dirty
                      ? 'Refresh verified cue baseline proof for this legacy draft'
                      : 'Save cue changes as a draft'}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[11px] font-semibold text-foreground transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => { closeApplyMenuAndRestoreFocus(); void onSave().then(setEditorMessage); }}
                >
                  {saving ? <CircleDash size={15} className="animate-spin" /> : <Save size={15} />}
                  <span>Save Draft</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={applyTrackDisabled}
                  title={applyTrackAvailable ? 'Apply only the selected track to local Rekordbox' : 'Apply Track requires a saved pending draft for the selected track'}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[11px] font-semibold text-foreground transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => { closeApplyMenuAndRestoreFocus(); onApplyTrack(); }}
                >
                  <Export size={15} />
                  <span>Apply Track</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={applyAllDisabled}
                  title={applyAllCount > 0 ? `Apply all ${applyAllCount} saved track changes to local Rekordbox` : 'Apply All requires at least one saved draft that needs apply'}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[11px] font-semibold text-foreground transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => { closeApplyMenuAndRestoreFocus(); onApplyAll(); }}
                >
                  <Export size={15} />
                  <span>Apply All ({applyAllCount})</span>
                </button>
                <div className="my-1 border-t border-white/[0.07]" />
                <button
                  type="button"
                  role="menuitem"
                  disabled={discardDisabled}
                  title="Discard unsaved cue changes and restore the saved/imported baseline"
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[11px] font-semibold text-amber-100 transition-colors hover:bg-amber-300/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => { closeApplyMenuAndRestoreFocus(); onDiscard(); }}
                >
                  <RotateCcw size={15} />
                  <span>Discard Changes</span>
                </button>
              </div>
            )}
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

      <div className="px-4 pb-3 pt-3 lg:px-5">
        <div className="overflow-x-auto">
          <div className="min-w-[920px]">
            <div className="cue-timeline relative overflow-hidden border-y border-[var(--color-border-faint)] bg-[var(--color-background)]">
              {/* Full-column click target keeps the useful collapse behavior without a dead gutter. */}
              <button
                type="button"
                onClick={() => setLabelsCollapsed((v) => !v)}
                className={cn('absolute bottom-0 left-0 top-0 z-20 cursor-pointer transition-[width] duration-200', labelsCollapsed ? 'w-[48px]' : 'w-[150px]')}
                aria-label={labelsCollapsed ? 'Expand timeline lanes' : 'Collapse timeline lanes'}
              />
              <CueEditorPlaybackPlayhead
                trackId={track.id}
                viewStartMs={viewStart}
                viewEndMs={effectiveViewEnd}
                labelsCollapsed={labelsCollapsed}
              />
            <div className={cn('grid gap-0 transition-[grid-template-columns] duration-200', labelsCollapsed ? 'grid-cols-[48px_minmax(0,1fr)]' : 'grid-cols-[150px_minmax(0,1fr)]')}>
              <div className="cue-timeline__rail h-[40px] border-b border-r border-[var(--color-border-faint)]">
                <TimelineLaneLabel icon={<Bookmark size={19} strokeWidth={2.25} />} label="Cue Points" color="#fb923c" collapsed={labelsCollapsed} />
              </div>
              <div className="cue-timeline__data-lane h-[40px] overflow-hidden border-b border-[var(--color-border-faint)]">
                <div className="relative h-full overflow-visible">
                {cueLoading ? (
                  <div className="flex h-full items-center px-2 text-[11px] font-medium text-[#707b85]">Loading cue points…</div>
                ) : cueLoadStatus === 'failed' ? (
                  <div className="flex h-full items-center justify-between gap-3 px-2 text-[10px] font-semibold text-red-300">
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
                          className="pointer-events-none absolute top-[2px] left-1/2 -translate-x-1/2 flex items-center justify-center"
                          style={{ width: 28, height: 32 }}
                          aria-hidden="true"
                        >
                          <svg
                            viewBox="0 0 256 256"
                            width={28}
                            height={32}
                            xmlns="http://www.w3.org/2000/svg"
                            style={{ fill: 'none', stroke: markerColor, strokeWidth: 14, transform: 'rotate(90deg)', display: 'block', flexShrink: 0 }}
                          >
                            <path d="M187.71875,203.99963H40a12.01312,12.01312,0,0,1-12-12v-128a12.01312,12.01312,0,0,1,12-12H187.71875a11.976,11.976,0,0,1,9.98437,5.34375l45.625,68.4375a4.00066,4.00066,0,0,1,0,4.4375l-45.625,68.43848A11.97381,11.97381,0,0,1,187.71875,203.99963Z" />
                          </svg>
                          <span
                            className="absolute font-black uppercase leading-none"
                            style={{ fontSize: 10, top: '44%', left: '50%', transform: 'translate(-50%, -50%)', color: markerColor }}
                          >
                            {cue.family === 'hot' ? cueLabel(cue) : String(memoryIndex + 1)}
                          </span>
                        </span>
                      </button>
                      );
                    })}
                  </>
                )}
                </div>
              </div>

              <div className="cue-timeline__rail h-[40px] border-b border-r border-[var(--color-border-faint)]">
                <TimelineLaneLabel icon={<List size={19} strokeWidth={2.35} />} label="Track Sections" color="#60a5fa" collapsed={labelsCollapsed} />
              </div>
              <div className="cue-timeline__data-lane h-[40px] border-b border-[var(--color-border-faint)]">
                <div className="relative h-full overflow-hidden">
                {phraseLoading ? (
                  <div className="flex h-full items-center px-2 text-[11px] font-medium text-[#707b85]">Loading track sections…</div>
                ) : sections.length === 0 ? (
                  <div className="absolute inset-0 flex items-center px-2">
                    <div className="h-[30px] w-full rounded-[5px] border border-white/[0.035] bg-white/[0.015]" />
                    <span className="absolute left-4 text-[10px] font-medium uppercase tracking-[0.12em] text-[#66717b]">
                      Sections unavailable
                    </span>
                  </div>
                ) : (
                  sections.map((section) => {
                    const left = percentageAt(section.startMs, viewStart, effectiveViewEnd);
                    const right = percentageAt(section.endMs, viewStart, effectiveViewEnd);
                    const width = Math.max(0, right - left);
                    return (
                      <div
                        key={section.id}
                        className="absolute top-[5px] h-[28px] flex items-center justify-center overflow-hidden"
                        style={{
                          left: `${left}%`,
                          width: `${width}%`,
                          backgroundColor: section.panelColor,
                        }}
                        title={`${section.label} · ${formatTime(section.startMs)}–${formatTime(section.endMs)}`}
                      >
                        <span
                          className="whitespace-nowrap font-mono text-[9px] font-bold leading-none tracking-wide"
                          style={{
                            color: '#ffffff',
                            textShadow: `0 1px 4px rgba(0,0,0,0.7), 0 0 8px ${section.waveformColor}99`,
                          }}
                        >
                          {section.label}
                        </span>
                      </div>
                    );
                  })
                )}
                </div>
              </div>

              <div className="cue-timeline__rail h-[88px] border-b border-r border-[var(--color-border-faint)]">
                <TimelineLaneLabel icon={<AudioWaveform size={20} strokeWidth={2.25} />} label="Waveform" color="#5dcfff" collapsed={labelsCollapsed} />
              </div>
              <div className="cue-timeline__data-lane h-[88px] border-b border-[var(--color-border-faint)]">
              <div
                ref={waveformDivRef}
                className="relative h-full cursor-crosshair overflow-hidden"
                onContextMenu={handleWaveformContextMenu}
                title={snapResolution !== 'off' ? `Right-click to add a ${cueSnapResolutionLabel(snapResolution)} snapped cue` : 'Right-click to add an exact millisecond cue'}
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
                        appearance="rekordbox"
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
                          beat.isDownbeat || beat.beatInBar === 1 ? 'border-white/[0.10]' : 'border-white/[0.035]',
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
              </div>

              <div className="cue-timeline__rail h-[40px] border-r border-[var(--color-border-faint)]">
                <TimelineLaneLabel icon={<Grip size={19} strokeWidth={2.55} />} label="Beat Grid" color="#4ade80" collapsed={labelsCollapsed} />
              </div>
              <div className="cue-timeline__data-lane h-[40px]">
                <div className="relative h-full overflow-hidden">
                {gridDisplayMode === 'off' ? (
                  <div className="flex h-full items-center px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[#5e6973]">Grid hidden</div>
                ) : beatGridLoading ? (
                  <div className="flex h-full items-center px-2 text-[11px] font-medium text-[#707b85]">Loading beat grid…</div>
                ) : durationMs == null || rulerTicks.length === 0 ? (
                  <div className="flex h-full items-center px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[#5e6973]">
                    No beat grid
                  </div>
                ) : (
                  <>
                    {rulerTicks.map((beat) => (
                      <span
                        key={`ruler-${beat.seq}`}
                        className={cn(
                          'absolute -translate-x-1/2 rounded-full',
                          beat.isDownbeat || beat.beatInBar === 1
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
        </div>
      </div>

      {selectedCue && (
        <CueInspector
          cue={selectedCue}
          cues={cues}
          snapResolution={snapResolution}
          onMoveCue={onMoveCue}
          onEditCue={onEditCue}
          onMessage={setEditorMessage}
          onClose={() => setSelectedCueId(null)}
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
                    const error = onAddCue('hot', contextMenu.requestedMs, snapResolution);
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
                    const error = onAddCue('memory', contextMenu.requestedMs, snapResolution);
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
  const [browserSource, setBrowserSource] = useState<BrowserSource>('library');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [genre, setGenre] = useState('');
  const [keyFilter, setKeyFilter] = useState('');
  const [cueFilter, setCueFilter] = useState<CueFilter>('all');
  const [analysisFilter, setAnalysisFilter] = useState<AnalysisFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [bpmRange, setBpmRange] = useState<[number, number] | null>(null);
  const [editingGenreTrackId, setEditingGenreTrackId] = useState<string | null>(null);
  const [editingGenreValue, setEditingGenreValue] = useState('');
  const [genreDraftsByTrackId, setGenreDraftsByTrackId] = useState<Map<string, TrackMetadataDraftRow>>(new Map());
  const [metadataDraftLoadStatus, setMetadataDraftLoadStatus] = useState<MetadataDraftLoadStatus>('idle');
  const [metadataDraftLoadError, setMetadataDraftLoadError] = useState<string | null>(null);
  const [metadataDraftRetryNonce, setMetadataDraftRetryNonce] = useState(0);
  const [savingGenreTrackIds, setSavingGenreTrackIds] = useState<Set<string>>(new Set());
  const [genreSaveError, setGenreSaveError] = useState<GenreSaveErrorState | null>(null);
  const [pendingMetadataReviewOpen, setPendingMetadataReviewOpen] = useState(false);
  const [pendingMetadataTracksById, setPendingMetadataTracksById] = useState<Map<string, RekordboxTrack>>(new Map());
  const [pendingMetadataTrackLoadStatus, setPendingMetadataTrackLoadStatus] = useState<MetadataDraftLoadStatus>('idle');
  const [pendingMetadataTrackLoadError, setPendingMetadataTrackLoadError] = useState<string | null>(null);
  const [pendingMetadataTrackRetryNonce, setPendingMetadataTrackRetryNonce] = useState(0);
  const [discardingMetadataTrackIds, setDiscardingMetadataTrackIds] = useState<Set<string>>(new Set());
  const [metadataDraftActionError, setMetadataDraftActionError] = useState<string | null>(null);
  const [metadataApplyBridgeAvailable, setMetadataApplyBridgeAvailable] = useState(false);
  const [metadataApplyBridgeReason, setMetadataApplyBridgeReason] = useState<string | null>(null);
  const [metadataApplyPreflight, setMetadataApplyPreflight] = useState<DesktopMetadataPreflightResult | null>(null);
  const [metadataApplyResult, setMetadataApplyResult] = useState<DesktopMetadataApplyResult | null>(null);
  const [metadataApplyBusy, setMetadataApplyBusy] = useState(false);
  const [metadataApplyMessage, setMetadataApplyMessage] = useState<string | null>(null);
  const [metadataCloudOutcome, setMetadataCloudOutcome] = useState<MetadataCloudOutcome | null>(null);
  const [metadataRecoveryTrackId, setMetadataRecoveryTrackId] = useState<string | null>(null);
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
  const waveformPanelWrapperRef = useRef<HTMLDivElement>(null);
  const filterRowRef = useRef<HTMLDivElement>(null);
  const [waveformPanelHeight, setWaveformPanelHeight] = useState(0);
  const [filterRowHeight, setFilterRowHeight] = useState(0);
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
  const genreSaveContextGenerationRef = useRef(0);
  const genreSaveInFlightRef = useRef<Set<string>>(new Set());
  const metadataApplyGenerationRef = useRef(0);

  const selectedTrackId = selectedTrack?.id ?? null;
  selectedTrackIdRef.current = selectedTrackId;
  selectedUserIdRef.current = userId;
  selectedImportIdRef.current = importId;
  workingCuesRef.current = workingCues;
  const { stats, refresh: refreshLibraryStats } = useLibraryStats(importId);
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
    refresh: refreshLibraryTracks,
  } = useLibraryTracks(importId, {
    search,
    genre: genre || null,
    debounceMs: 220,
    pageSize: CUE_PAGE_SIZE,
  });
  const {
    playlists,
    loading: playlistsLoading,
    error: playlistsError,
  } = useRekordboxPlaylists(importId);
  const selectablePlaylists = useMemo(
    () => playlists.filter((playlist) => !playlist.is_folder),
    [playlists],
  );
  const activePlaylistId = browserSource === 'playlists' ? selectedPlaylistId : null;
  const {
    tracks: playlistTrackItems,
    total: playlistTrackTotal,
    loading: playlistTracksLoading,
    loadingMore: playlistTracksLoadingMore,
    error: playlistTracksError,
    hasMore: playlistTracksHaveMore,
    loadMore: loadMorePlaylistTracks,
  } = useRekordboxPlaylistTracks(activePlaylistId);
  const playlistTracks = useMemo(
    () => playlistTrackItems.map((item) => item.track),
    [playlistTrackItems],
  );

  useEffect(() => {
    if (browserSource !== 'playlists') return;
    if (selectedPlaylistId && selectablePlaylists.some((playlist) => playlist.id === selectedPlaylistId)) return;
    setSelectedPlaylistId(selectablePlaylists[0]?.id ?? null);
  }, [browserSource, selectablePlaylists, selectedPlaylistId]);

  useEffect(() => {
    // Identity changes cancel only this renderer's reconciliation. Any RPC
    // already accepted by Supabase remains revision-protected for its original
    // track and cannot leak its response into the new user/import scope.
    genreSaveContextGenerationRef.current += 1;
    setEditingGenreTrackId(null);
    setEditingGenreValue('');
    setSavingGenreTrackIds(new Set());
    setGenreSaveError(null);
    setPendingMetadataReviewOpen(false);
    setPendingMetadataTracksById(new Map());
    setPendingMetadataTrackLoadStatus('idle');
    setPendingMetadataTrackLoadError(null);
    setPendingMetadataTrackRetryNonce(0);
    setDiscardingMetadataTrackIds(new Set());
    setMetadataDraftActionError(null);
    metadataApplyGenerationRef.current += 1;
    setMetadataApplyPreflight(null);
    setMetadataApplyResult(null);
    setMetadataApplyMessage(null);
    setMetadataCloudOutcome(null);
    setMetadataRecoveryTrackId(null);
    setMetadataApplyBusy(false);
    setBrowserSource('library');
    setSelectedPlaylistId(null);
  }, [importId, userId]);

  useEffect(() => {
    let cancelled = false;
    const desktop = window.dropdexDesktop;
    if (!desktop?.isElectron || typeof desktop.metadataApplyAvailability !== 'function') {
      setMetadataApplyBridgeAvailable(false);
      setMetadataApplyBridgeReason('Metadata preflight is available in the current DropDex desktop app only.');
      return;
    }
    void desktop.metadataApplyAvailability().then((result) => {
      if (cancelled) return;
      const compatible = result.available
        && result.metadataApplySupported === true
        && result.metadataSchemaVersion === 1
        && result.genreMaxLength === REKORDBOX_GENRE_MAX_LENGTH;
      setMetadataApplyBridgeAvailable(compatible);
      setMetadataApplyBridgeReason(compatible
        ? null
        : result.reason ?? 'The desktop metadata protocol is incompatible with this renderer.');
    }).catch((error) => {
      if (cancelled) return;
      setMetadataApplyBridgeAvailable(false);
      setMetadataApplyBridgeReason(error instanceof Error ? error.message : String(error));
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!userId || !importId) {
      setGenreDraftsByTrackId(new Map());
      setMetadataDraftLoadStatus('idle');
      setMetadataDraftLoadError(null);
      return;
    }

    // Do not retain the previous scope or silently equate a failed load with
    // "no pending metadata". Editing is enabled only after a complete load.
    setGenreDraftsByTrackId(new Map());
    setMetadataDraftLoadStatus('loading');
    setMetadataDraftLoadError(null);
    void fetchTrackMetadataDraftsForImport(userId, importId)
      .then((rows) => {
        if (cancelled) return;
        setGenreDraftsByTrackId(new Map(rows.map((row) => [row.trackId, row])));
        setMetadataDraftLoadStatus('loaded');
        setMetadataDraftLoadError(null);
        setGenreSaveError((current) => current?.revisionConflict ? null : current);
      })
      .catch((error) => {
        if (cancelled) return;
        setGenreDraftsByTrackId(new Map());
        setMetadataDraftLoadStatus('failed');
        setMetadataDraftLoadError(error instanceof Error
          ? `Pending Genre changes could not be loaded: ${error.message}`
          : 'Pending Genre changes could not be loaded.');
      });

    return () => {
      cancelled = true;
    };
  }, [importId, metadataDraftRetryNonce, userId]);

  const pendingMetadataDraftTrackIdsKey = useMemo(
    () => [...genreDraftsByTrackId.values()]
      .filter(metadataDraftNeedsReview)
      .map((draft) => draft.trackId)
      .sort()
      .join(','),
    [genreDraftsByTrackId],
  );

  useEffect(() => {
    let cancelled = false;
    if (!userId || !importId || metadataDraftLoadStatus !== 'loaded') {
      setPendingMetadataTracksById(new Map());
      setPendingMetadataTrackLoadStatus('idle');
      setPendingMetadataTrackLoadError(null);
      return;
    }

    const trackIds = pendingMetadataDraftTrackIdsKey ? pendingMetadataDraftTrackIdsKey.split(',') : [];
    if (trackIds.length === 0) {
      setPendingMetadataTracksById(new Map());
      setPendingMetadataTrackLoadStatus('loaded');
      setPendingMetadataTrackLoadError(null);
      return;
    }

    setPendingMetadataTracksById(new Map());
    setPendingMetadataTrackLoadStatus('loading');
    setPendingMetadataTrackLoadError(null);
    void fetchTracksByIds(trackIds)
      .then((rows) => {
        if (cancelled) return;
        const byId = new Map(rows.map((track) => [track.id, track]));
        const missingIds = trackIds.filter((trackId) => !byId.has(trackId));
        const wrongImport = rows.find((track) => track.import_id !== importId);
        if (missingIds.length > 0 || wrongImport) {
          throw new Error(missingIds.length > 0
            ? `Track details are incomplete for ${missingIds.length} pending metadata change${missingIds.length === 1 ? '' : 's'}.`
            : 'A pending metadata track resolved outside the active import.');
        }
        setPendingMetadataTracksById(byId);
        setPendingMetadataTrackLoadStatus('loaded');
        setPendingMetadataTrackLoadError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setPendingMetadataTracksById(new Map());
        setPendingMetadataTrackLoadStatus('failed');
        setPendingMetadataTrackLoadError(error instanceof Error
          ? `Track details for pending metadata changes could not be loaded: ${error.message}`
          : 'Track details for pending metadata changes could not be loaded.');
      });

    return () => {
      cancelled = true;
    };
  }, [importId, metadataDraftLoadStatus, pendingMetadataDraftTrackIdsKey, pendingMetadataTrackRetryNonce, userId]);

  const saveInlineGenreDraft = useCallback(async (track: RekordboxTrack) => {
    if (!userId || !importId || metadataDraftLoadStatus !== 'loaded') return;

    const inFlightKey = `${userId}:${importId}:${track.id}`;
    if (genreSaveInFlightRef.current.has(inFlightKey)) return;

    let pendingValue: string | null;
    try {
      pendingValue = validateGenreMetadataDraftValue(editingGenreValue);
    } catch (error) {
      setGenreSaveError({
        trackId: track.id,
        message: error instanceof Error ? error.message : 'Genre could not be saved.',
        revisionConflict: false,
      });
      return;
    }

    const existingDraft = genreDraftsByTrackId.get(track.id) ?? null;
    if (existingDraft && isTrackMetadataDraftRecoveryLocked(existingDraft)) {
      setGenreSaveError({
        trackId: track.id,
        message: 'This Genre change is locked while metadata recovery reconciles verified local Rekordbox state with DropDex.',
        revisionConflict: false,
      });
      return;
    }
    const contextGeneration = genreSaveContextGenerationRef.current;
    const requestedUserId = userId;
    const requestedImportId = importId;
    genreSaveInFlightRef.current.add(inFlightKey);
    setSavingGenreTrackIds((current) => {
      const next = new Set(current);
      next.add(track.id);
      return next;
    });
    setGenreSaveError((current) => current?.trackId === track.id ? null : current);
    setMetadataDraftActionError(null);

    try {
      const saved = await saveGenreMetadataDraft({
        importId: requestedImportId,
        trackId: track.id,
        pendingValue,
        expectedRevision: existingDraft?.revision ?? 0,
      });
      if (
        genreSaveContextGenerationRef.current !== contextGeneration
        || selectedUserIdRef.current !== requestedUserId
        || selectedImportIdRef.current !== requestedImportId
      ) return;

      setGenreDraftsByTrackId((current) => {
        const next = new Map(current);
        if (saved) next.set(track.id, saved);
        else next.delete(track.id);
        return next;
      });
      setEditingGenreTrackId((current) => current === track.id ? null : current);
      setGenreSaveError((current) => current?.trackId === track.id ? null : current);
    } catch (error) {
      if (
        genreSaveContextGenerationRef.current !== contextGeneration
        || selectedUserIdRef.current !== requestedUserId
        || selectedImportIdRef.current !== requestedImportId
      ) return;
      setGenreSaveError({
        trackId: track.id,
        message: error instanceof Error ? error.message : 'Genre could not be saved.',
        revisionConflict: error instanceof TrackMetadataDraftRevisionConflictError,
      });
    } finally {
      genreSaveInFlightRef.current.delete(inFlightKey);
      if (
        genreSaveContextGenerationRef.current === contextGeneration
        && selectedUserIdRef.current === requestedUserId
        && selectedImportIdRef.current === requestedImportId
      ) setSavingGenreTrackIds((current) => {
        const next = new Set(current);
        next.delete(track.id);
        return next;
      });
    }
  }, [editingGenreValue, genreDraftsByTrackId, importId, metadataDraftLoadStatus, userId]);

  const discardPendingGenreDraft = useCallback(async (draft: TrackMetadataDraftRow) => {
    if (!userId || !importId || metadataDraftLoadStatus !== 'loaded') return;
    if (isTrackMetadataDraftRecoveryLocked(draft)) {
      setMetadataDraftActionError('This Genre change is locked for metadata recovery and cannot be discarded until Rekordbox and cloud state converge.');
      return;
    }
    const inFlightKey = `${userId}:${importId}:${draft.trackId}`;
    if (genreSaveInFlightRef.current.has(inFlightKey)) {
      setMetadataDraftActionError('This Genre change is already being updated. Wait for that request to finish, then try Discard again.');
      return;
    }

    const contextGeneration = genreSaveContextGenerationRef.current;
    const requestedUserId = userId;
    const requestedImportId = importId;
    genreSaveInFlightRef.current.add(inFlightKey);
    setDiscardingMetadataTrackIds((current) => {
      const next = new Set(current);
      next.add(draft.trackId);
      return next;
    });
    setMetadataDraftActionError(null);

    try {
      await discardGenreMetadataDraft({
        importId: requestedImportId,
        trackId: draft.trackId,
        expectedRevision: draft.revision,
      });
      if (
        genreSaveContextGenerationRef.current !== contextGeneration
        || selectedUserIdRef.current !== requestedUserId
        || selectedImportIdRef.current !== requestedImportId
      ) return;

      setGenreDraftsByTrackId((current) => {
        const latest = current.get(draft.trackId);
        if (!latest || latest.revision !== draft.revision) return current;
        const next = new Map(current);
        next.delete(draft.trackId);
        return next;
      });
      if (editingGenreTrackId === draft.trackId) {
        setEditingGenreTrackId(null);
        setEditingGenreValue('');
      }
      setGenreSaveError((current) => current?.trackId === draft.trackId ? null : current);
    } catch (error) {
      if (
        genreSaveContextGenerationRef.current !== contextGeneration
        || selectedUserIdRef.current !== requestedUserId
        || selectedImportIdRef.current !== requestedImportId
      ) return;
      const conflict = error instanceof TrackMetadataDraftRevisionConflictError;
      setMetadataDraftActionError(conflict
        ? `${error.message} Reload pending changes before discarding.`
        : error instanceof Error ? `Pending Genre change could not be discarded: ${error.message}` : 'Pending Genre change could not be discarded.');
    } finally {
      genreSaveInFlightRef.current.delete(inFlightKey);
      if (
        genreSaveContextGenerationRef.current === contextGeneration
        && selectedUserIdRef.current === requestedUserId
        && selectedImportIdRef.current === requestedImportId
      ) setDiscardingMetadataTrackIds((current) => {
        const next = new Set(current);
        next.delete(draft.trackId);
        return next;
      });
    }
  }, [editingGenreTrackId, importId, metadataDraftLoadStatus, userId]);

  const pendingMetadataReviewRows = useMemo(() => {
    if (metadataDraftLoadStatus !== 'loaded' || pendingMetadataTrackLoadStatus !== 'loaded') return [];
    return [...genreDraftsByTrackId.values()]
      .filter(metadataDraftNeedsReview)
      .map((draft) => ({ draft, track: pendingMetadataTracksById.get(draft.trackId) }))
      .filter((row): row is { draft: TrackMetadataDraftRow; track: RekordboxTrack } => Boolean(row.track))
      .sort((a, b) => a.track.title.localeCompare(b.track.title) || (a.track.artist ?? '').localeCompare(b.track.artist ?? ''));
  }, [genreDraftsByTrackId, metadataDraftLoadStatus, pendingMetadataTrackLoadStatus, pendingMetadataTracksById]);
  const pendingMetadataCount = metadataDraftLoadStatus === 'loaded'
    ? [...genreDraftsByTrackId.values()].filter(metadataDraftNeedsReview).length
    : 0;
  const actionableMetadataPendingCount = metadataDraftLoadStatus === 'loaded'
    ? [...genreDraftsByTrackId.values()].filter(metadataDraftNeedsApply).length
    : 0;
  const metadataRecoveryCount = metadataDraftLoadStatus === 'loaded'
    ? [...genreDraftsByTrackId.values()].filter(isTrackMetadataDraftRecoveryLocked).length
    : 0;

  const pendingMetadataDraftIdentityKey = useMemo(() => [...genreDraftsByTrackId.values()]
    .filter(metadataDraftNeedsApply)
    .sort((a, b) => a.trackId.localeCompare(b.trackId) || a.id.localeCompare(b.id))
    .map((draft) => `${draft.id}:${draft.revision}:${draft.draftFingerprint}`)
    .join('|'), [genreDraftsByTrackId]);

  const metadataReviewStateKey = useMemo(() => [...genreDraftsByTrackId.values()]
    .filter(metadataDraftNeedsReview)
    .sort((a, b) => a.trackId.localeCompare(b.trackId) || a.id.localeCompare(b.id))
    .map((draft) => `${draft.id}:${draft.revision}:${draft.draftFingerprint}:${draft.lastApplyState ?? ''}:${draft.lastApplyOperationId ?? ''}`)
    .join('|'), [genreDraftsByTrackId]);

  useEffect(() => {
    metadataApplyGenerationRef.current += 1;
    setMetadataApplyPreflight(null);
    setMetadataApplyBusy(false);
  }, [metadataReviewStateKey]);

  const desktopMetadataDrafts = useCallback((rows: TrackMetadataDraftRow[]): DesktopMetadataDraft[] => rows.map((row) => {
    if (row.field !== 'genre' || row.schemaVersion !== 1) {
      throw new Error('A saved metadata draft uses an unsupported field or schema version. Reload DropDex before preflighting.');
    }
    return {
      id: row.id,
      userId: row.userId,
      importId: row.importId,
      trackId: row.trackId,
      field: 'genre',
      schemaVersion: 1,
      pendingValue: row.pendingValue,
      importedBaselineValue: row.importedBaselineValue,
      currentBaselineValue: row.currentBaselineValue,
      masterDbId: row.masterDbId,
      masterContentId: row.masterContentId,
      revision: row.revision,
      draftFingerprint: row.draftFingerprint,
    };
  }), []);

  const refreshMetadataCanonicalState = useCallback(async (
    requestedUserId: string,
    requestedImportId: string,
    affectedTrackIds: string[],
  ): Promise<TrackMetadataDraftRow[]> => {
    const [draftRows, refreshedTracks] = await Promise.all([
      fetchTrackMetadataDraftsForImport(requestedUserId, requestedImportId),
      fetchTracksByIds(affectedTrackIds),
    ]);
    const sameContext = selectedUserIdRef.current === requestedUserId
      && selectedImportIdRef.current === requestedImportId;
    if (sameContext) {
      setGenreDraftsByTrackId(new Map(draftRows.map((row) => [row.trackId, row])));
      setPendingMetadataTrackRetryNonce((value) => value + 1);
      refreshLibraryTracks();
      refreshLibraryStats();
      const selectedId = selectedTrackIdRef.current;
      const refreshedSelected = selectedId ? refreshedTracks.find((track) => track.id === selectedId) : null;
      if (refreshedSelected && refreshedSelected.import_id === requestedImportId) setSelectedTrack(refreshedSelected);
    }
    return draftRows;
  }, [refreshLibraryStats, refreshLibraryTracks]);

  const handleMetadataPreflightAll = useCallback(async () => {
    const desktop = window.dropdexDesktop;
    if (!desktop?.isElectron || !metadataApplyBridgeAvailable || !userId || !importId || metadataApplyBusy) return;
    if (metadataDraftLoadStatus !== 'loaded') {
      setMetadataApplyMessage('Load the complete pending metadata set before running preflight.');
      return;
    }

    const generation = ++metadataApplyGenerationRef.current;
    setMetadataApplyBusy(true);
    setMetadataApplyPreflight(null);
    setMetadataApplyResult(null);
    setMetadataApplyMessage(null);
    setMetadataCloudOutcome(null);
    setMetadataDraftActionError(null);
    try {
      // Re-fetch through the Stage 1 exact-count paginator immediately before
      // crossing the desktop boundary. This prevents Apply All from being
      // scoped to the rendered/filtered page or a stale in-memory subset.
      const freshRows = await fetchTrackMetadataDraftsForImport(userId, importId);
      if (generation !== metadataApplyGenerationRef.current
        || selectedUserIdRef.current !== userId
        || selectedImportIdRef.current !== importId) return;
      const recoveryRows = freshRows.filter(isTrackMetadataDraftRecoveryLocked);
      if (recoveryRows.length > 0) {
        setGenreDraftsByTrackId(new Map(freshRows.map((row) => [row.trackId, row])));
        setMetadataApplyMessage(`Resolve ${recoveryRows.length} metadata recovery item${recoveryRows.length === 1 ? '' : 's'} before starting another Rekordbox metadata Apply.`);
        return;
      }
      const pendingRows = freshRows
        .filter(metadataDraftNeedsApply)
        .sort((a, b) => a.trackId.localeCompare(b.trackId) || a.id.localeCompare(b.id));
      const freshIdentityKey = pendingRows
        .map((draft) => `${draft.id}:${draft.revision}:${draft.draftFingerprint}`)
        .join('|');
      if (freshIdentityKey !== pendingMetadataDraftIdentityKey) {
        setGenreDraftsByTrackId(new Map(freshRows.map((row) => [row.trackId, row])));
        setMetadataApplyMessage('Pending metadata changed before preflight. The review has been refreshed; run preflight again for the new complete set.');
        return;
      }
      if (pendingRows.length === 0) {
        setMetadataApplyMessage('There are no pending metadata changes to preflight.');
        return;
      }

      const result = await desktop.metadataApplyPreflight(
        { kind: 'all', importId, expectedDraftCount: pendingRows.length },
        desktopMetadataDrafts(pendingRows),
      );
      if (generation !== metadataApplyGenerationRef.current
        || selectedUserIdRef.current !== userId
        || selectedImportIdRef.current !== importId) return;
      setMetadataApplyPreflight(result);
      setMetadataApplyMessage(result.ok
        ? 'Read-only preflight passed. Review the exact Genre resolutions, then Apply All to write this bound plan safely.'
        : 'Read-only preflight found blockers. Pending Genre drafts were left unchanged.');
    } catch (error) {
      if (generation === metadataApplyGenerationRef.current) {
        setMetadataApplyMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (generation === metadataApplyGenerationRef.current) setMetadataApplyBusy(false);
    }
  }, [desktopMetadataDrafts, importId, metadataApplyBridgeAvailable, metadataApplyBusy, metadataDraftLoadStatus, pendingMetadataDraftIdentityKey, userId]);

  const handleMetadataApplyAll = useCallback(async () => {
    const desktop = window.dropdexDesktop;
    const preflight = metadataApplyPreflight;
    if (!desktop?.isElectron
      || typeof desktop.metadataApply !== 'function'
      || !metadataApplyBridgeAvailable
      || !userId
      || !importId
      || metadataApplyBusy
      || !preflight?.ok
      || !preflight.token) return;
    if (metadataDraftLoadStatus !== 'loaded') {
      setMetadataApplyMessage('Load the complete pending metadata set before applying.');
      return;
    }

    const requestedUserId = userId;
    const requestedImportId = importId;
    const generation = ++metadataApplyGenerationRef.current;
    const contextIsCurrent = () => selectedUserIdRef.current === requestedUserId
      && selectedImportIdRef.current === requestedImportId;
    let localApplyReturned = false;
    setMetadataApplyBusy(true);
    setMetadataApplyResult(null);
    setMetadataApplyMessage(null);
    setMetadataCloudOutcome(null);
    setMetadataDraftActionError(null);
    try {
      // Re-read the persisted complete set immediately before mutation. The
      // opaque token is bound to these exact draft revisions/fingerprints, and
      // the Python bridge independently revalidates local Rekordbox state.
      const freshRows = await fetchTrackMetadataDraftsForImport(requestedUserId, requestedImportId);
      if (generation !== metadataApplyGenerationRef.current
        || selectedUserIdRef.current !== requestedUserId
        || selectedImportIdRef.current !== requestedImportId) return;
      const recoveryRows = freshRows.filter(isTrackMetadataDraftRecoveryLocked);
      if (recoveryRows.length > 0) {
        setGenreDraftsByTrackId(new Map(freshRows.map((row) => [row.trackId, row])));
        setMetadataApplyPreflight(null);
        setMetadataApplyMessage('Metadata recovery is unresolved. No new Rekordbox metadata write was requested.');
        return;
      }
      const pendingRows = freshRows
        .filter(metadataDraftNeedsApply)
        .sort((a, b) => a.trackId.localeCompare(b.trackId) || a.id.localeCompare(b.id));
      const freshIdentityKey = pendingRows
        .map((draft) => `${draft.id}:${draft.revision}:${draft.draftFingerprint}`)
        .join('|');
      if (freshIdentityKey !== pendingMetadataDraftIdentityKey
        || pendingRows.length !== preflight.tracks.length) {
        setGenreDraftsByTrackId(new Map(freshRows.map((row) => [row.trackId, row])));
        setMetadataApplyPreflight(null);
        setMetadataApplyMessage('Pending metadata changed after preflight. No write was requested; run preflight again for the refreshed complete set.');
        return;
      }

      const result = await desktop.metadataApply(
        preflight.token,
        { kind: 'all', importId: requestedImportId, expectedDraftCount: pendingRows.length },
        desktopMetadataDrafts(pendingRows),
      );
      localApplyReturned = true;
      if (contextIsCurrent()) {
        setMetadataApplyPreflight(null); // Stage 4 tokens are single-use even on rejection.
        setMetadataApplyResult(result);
      }

      try {
        validateMetadataApplyOutcomeEnvelope({ drafts: pendingRows, preflight, result });
      } catch (error) {
        if (contextIsCurrent()) {
          setMetadataCloudOutcome({
            state: 'proof-mismatch',
            message: error instanceof Error ? error.message : 'Metadata apply returned invalid operation evidence.',
          });
          setMetadataApplyMessage('Metadata result evidence did not match the exact submitted plan. Cloud finalization was blocked; do not repeat the local write.');
        }
        return;
      }

      if (result.state !== 'applied') {
        // Capture the narrowed state before the async map callback; TypeScript
        // does not preserve discriminant narrowing across that closure boundary.
        const nonFinalState: Exclude<DesktopMetadataApplyResult['state'], 'applied'> = result.state;
        const persistence = await Promise.allSettled(pendingRows.map((draft) => markTrackMetadataApplyOutcome({
          importId: requestedImportId,
          trackId: draft.trackId,
          revision: draft.revision,
          draftFingerprint: draft.draftFingerprint,
          operationId: result.operation_id,
          planFingerprint: result.plan_fingerprint,
          applyState: nonFinalState,
          sourceIdentityBefore: result.source_identity_before,
          sourceIdentityAfter: result.source_identity_after,
          resultSummary: metadataApplySafeSummary(result, `local-${result.state}`),
        })));
        const persistenceFailures = persistence.filter((item) => item.status === 'rejected').length;
        if (contextIsCurrent()) {
          setMetadataApplyMessage(result.state === 'rolled-back'
            ? 'The local Genre apply did not verify, so DropDex restored and verified the prior Rekordbox generation. The pending draft remains.'
            : result.state === 'recovery-unverified'
              ? 'Rollback could not be verified. Metadata editing and Apply are locked for the persisted recovery state; inspect Rekordbox before further writes.'
              : 'Metadata apply was rejected safely. The pending draft remains; run preflight again after resolving the blocker.');
          if (persistenceFailures > 0) {
            setMetadataCloudOutcome({
              state: 'persistence-failed',
              message: `${persistenceFailures} metadata outcome record${persistenceFailures === 1 ? '' : 's'} could not be persisted.`,
            });
          }
        }
        try {
          await refreshMetadataCanonicalState(requestedUserId, requestedImportId, pendingRows.map((draft) => draft.trackId));
        } catch {
          // The structured local outcome has already been persisted when possible;
          // the normal draft retry remains available if this read refresh fails.
        }
        return;
      }

      let proof;
      try {
        proof = validateVerifiedMetadataApplyResult({ drafts: pendingRows, preflight, result });
      } catch (error) {
        // The operation envelope is bound to the submitted plan, but the local
        // success proof is not exact enough to authorize cloud convergence.
        // Persist a recovery lock instead of guessing or replaying the writer.
        await Promise.allSettled(pendingRows.map((draft) => markTrackMetadataApplyOutcome({
          importId: requestedImportId,
          trackId: draft.trackId,
          revision: draft.revision,
          draftFingerprint: draft.draftFingerprint,
          operationId: result.operation_id,
          planFingerprint: result.plan_fingerprint,
          applyState: 'recovery-unverified',
          sourceIdentityBefore: result.source_identity_before,
          sourceIdentityAfter: result.source_identity_after,
          resultSummary: metadataApplySafeSummary(result, 'renderer-proof-mismatch'),
        })));
        if (contextIsCurrent()) {
          setMetadataCloudOutcome({
            state: 'proof-mismatch',
            message: error instanceof Error ? error.message : 'Verified local metadata proof did not match the submitted plan.',
          });
          setMetadataApplyMessage('Rekordbox reported local success, but exact proof validation failed. Cloud finalization was blocked and the operation was locked for recovery; the writer will not be replayed.');
        }
        try {
          await refreshMetadataCanonicalState(requestedUserId, requestedImportId, pendingRows.map((draft) => draft.trackId));
        } catch {
          // Preserve the critical message above; reload can rehydrate any lock
          // that Stage 6A accepted before this refresh failed.
        }
        return;
      }

      // Persist every verified local-success receipt before finalizing any track.
      // This ordering ensures a cloud finalizer failure is reload-recoverable and
      // prevents one partially finalized Apply All from replaying the local writer.
      const pendingPersistence = await Promise.allSettled(proof.tracks.map(({ draft, result: trackResult }) => (
        markTrackMetadataApplyOutcome({
          importId: requestedImportId,
          trackId: draft.trackId,
          revision: draft.revision,
          draftFingerprint: draft.draftFingerprint,
          operationId: proof.operationId,
          planFingerprint: proof.planFingerprint,
          applyState: 'cloud-finalization-pending',
          appliedValue: trackResult.normalized_applied_genre,
          sourceIdentityBefore: proof.sourceIdentityBefore,
          sourceIdentityAfter: proof.sourceIdentityAfter,
          resultSummary: metadataApplySafeSummary(result, 'local-verified'),
        })
      )));
      const pendingFailures = pendingPersistence.filter((item) => item.status === 'rejected').length;
      if (pendingFailures > 0) {
        if (contextIsCurrent()) {
          setMetadataCloudOutcome({
            state: 'persistence-failed',
            message: `${pendingFailures} verified local operation receipt${pendingFailures === 1 ? '' : 's'} could not be persisted, so cloud finalization was not attempted.`,
          });
          setMetadataApplyMessage('Local Rekordbox Genre is verified, but DropDex could not durably persist the complete cloud-recovery proof. Do not run Apply again. Reload/retry cloud state only after the recovery record is visible.');
        }
        try {
          await refreshMetadataCanonicalState(requestedUserId, requestedImportId, pendingRows.map((draft) => draft.trackId));
        } catch {
          // The current renderer remains blocked by metadataCloudOutcome.
        }
        return;
      }

      const finalization = await Promise.allSettled(proof.tracks.map(({ draft, result: trackResult }) => (
        finalizeTrackMetadataApply({
          importId: requestedImportId,
          trackId: draft.trackId,
          revision: draft.revision,
          draftFingerprint: draft.draftFingerprint,
          operationId: proof.operationId,
          planFingerprint: proof.planFingerprint,
          appliedValue: trackResult.normalized_applied_genre,
          expectedCurrentBaselineValue: draft.currentBaselineValue,
          masterDbId: draft.masterDbId,
          masterContentId: draft.masterContentId,
          sourceIdentityAfter: proof.sourceIdentityAfter,
        })
      )));
      const failedFinalizationIndexes = finalization.flatMap((item, index) => item.status === 'rejected' ? [index] : []);

      if (failedFinalizationIndexes.length > 0) {
        await Promise.allSettled(failedFinalizationIndexes.map((index) => {
          const item = proof.tracks[index];
          return markTrackMetadataApplyOutcome({
            importId: requestedImportId,
            trackId: item.draft.trackId,
            revision: item.draft.revision,
            draftFingerprint: item.draft.draftFingerprint,
            operationId: proof.operationId,
            planFingerprint: proof.planFingerprint,
            applyState: 'cloud-finalization-failed',
            appliedValue: item.result.normalized_applied_genre,
            sourceIdentityBefore: proof.sourceIdentityBefore,
            sourceIdentityAfter: proof.sourceIdentityAfter,
            resultSummary: metadataApplySafeSummary(result, 'cloud-finalization-failed'),
          });
        }));
      }

      let refreshedDraftRows: TrackMetadataDraftRow[] | null = null;
      let refreshFailure: unknown = null;
      try {
        refreshedDraftRows = await refreshMetadataCanonicalState(
          requestedUserId,
          requestedImportId,
          pendingRows.map((draft) => draft.trackId),
        );
      } catch (error) {
        refreshFailure = error;
      }

      // A lost finalizer response can still mean Stage 6A committed. Re-read the
      // canonical durable state before presenting recovery so idempotent/lost-
      // response finalization converges instead of displaying a false failure.
      const refreshProvesFinalized = refreshedDraftRows != null && proof.tracks.every(({ draft }) => {
        const refreshed = refreshedDraftRows?.find((row) => row.trackId === draft.trackId);
        return refreshed?.lastApplyState === 'applied'
          && refreshed.lastApplyOperationId === proof.operationId
          && refreshed.appliedRevision === draft.revision
          && normalizeGenreMetadataDraftValue(refreshed.appliedValue) === normalizeGenreMetadataDraftValue(draft.pendingValue);
      });
      const cloudFinalized = failedFinalizationIndexes.length === 0 || refreshProvesFinalized;

      if (contextIsCurrent()) {
        if (cloudFinalized) {
          setMetadataCloudOutcome({
            state: 'finalized',
            message: `Finalized ${proof.tracks.length} Genre change${proof.tracks.length === 1 ? '' : 's'} in DropDex.`,
          });
          setMetadataApplyMessage('Metadata Apply finalized successfully. Canonical Genre, moving baselines, pending changes, the track list, and library Genre statistics were refreshed.');
        } else {
          setMetadataCloudOutcome({
            state: 'recovery-required',
            message: `${failedFinalizationIndexes.length} metadata change${failedFinalizationIndexes.length === 1 ? '' : 's'} still need cloud finalization recovery.`,
          });
          setMetadataApplyMessage('Rekordbox Genre is already verified. Some Supabase finalization calls remain unresolved, so those rows are locked for read-only recovery. Retry recovery will verify local Genre and will not rewrite Rekordbox.');
        }
        if (refreshFailure) {
          setMetadataDraftActionError(refreshFailure instanceof Error
            ? `Metadata finalization completed, but refreshed cloud state could not be loaded: ${refreshFailure.message}`
            : 'Metadata finalization completed, but refreshed cloud state could not be loaded.');
        }
      }
    } catch (error) {
      if (contextIsCurrent()) {
        // The desktop token may have been claimed before a transport-visible
        // failure, so force a new preflight rather than risking token replay.
        setMetadataApplyPreflight(null);
        if (localApplyReturned) {
          setMetadataApplyMessage(error instanceof Error ? error.message : String(error));
        } else {
          setMetadataCloudOutcome({
            state: 'proof-mismatch',
            message: 'The desktop Apply response was unavailable after the one-time token was submitted.',
          });
          setMetadataApplyMessage('The metadata Apply response was lost or unavailable. DropDex cannot safely infer whether Rekordbox changed, so do not replay Apply until the local state is inspected and a fresh preflight is safe.');
        }
      }
    } finally {
      if (generation === metadataApplyGenerationRef.current) setMetadataApplyBusy(false);
    }
  }, [desktopMetadataDrafts, importId, metadataApplyBridgeAvailable, metadataApplyBusy, metadataApplyPreflight, metadataDraftLoadStatus, pendingMetadataDraftIdentityKey, refreshMetadataCanonicalState, userId]);

  const handleMetadataRecovery = useCallback(async (draft: TrackMetadataDraftRow) => {
    const desktop = window.dropdexDesktop;
    if (!desktop?.isElectron
      || typeof desktop.metadataRecoveryVerify !== 'function'
      || !metadataApplyBridgeAvailable
      || !userId
      || !importId
      || metadataApplyBusy
      || metadataRecoveryTrackId != null) return;

    const requestedUserId = userId;
    const requestedImportId = importId;
    if (draft.userId !== requestedUserId || draft.importId !== requestedImportId) return;

    const generation = ++metadataApplyGenerationRef.current;
    const contextIsCurrent = () => selectedUserIdRef.current === requestedUserId
      && selectedImportIdRef.current === requestedImportId;
    setMetadataApplyBusy(true);
    setMetadataRecoveryTrackId(draft.trackId);
    setMetadataApplyPreflight(null);
    setMetadataApplyResult(null);
    setMetadataApplyMessage(null);
    setMetadataCloudOutcome(null);
    setMetadataDraftActionError(null);
    try {
      const request = buildMetadataRecoveryRequest(draft);
      const verification = await desktop.metadataRecoveryVerify(request);
      if (!verification.ok || verification.state !== 'verified') {
        if (contextIsCurrent()) {
          const blockerText = verification.blockers.length > 0
            ? verification.blockers.map((blocker) => `${blocker.code}: ${blocker.message}`).join(' ')
            : 'Read-only recovery verification did not confirm the previously applied Genre.';
          setMetadataCloudOutcome({ state: 'recovery-required', message: blockerText });
          setMetadataApplyMessage('Cloud recovery is blocked because trusted local Rekordbox state no longer matches the persisted verified apply evidence. Rekordbox was not rewritten.');
        }
        return;
      }

      validateMetadataRecoveryVerification(request, verification);
      let finalizationFailure: unknown = null;
      try {
        await finalizeTrackMetadataApply({
          importId: requestedImportId,
          trackId: draft.trackId,
          revision: request.appliedRevision,
          draftFingerprint: request.draftFingerprint,
          operationId: request.operationId,
          planFingerprint: request.planFingerprint,
          appliedValue: request.appliedValue,
          expectedCurrentBaselineValue: draft.currentBaselineValue,
          masterDbId: request.masterDbId,
          masterContentId: request.masterContentId,
          sourceIdentityAfter: request.sourceIdentityAfter,
        });
      } catch (error) {
        finalizationFailure = error;
        await markTrackMetadataApplyOutcome({
          importId: requestedImportId,
          trackId: draft.trackId,
          revision: request.appliedRevision,
          draftFingerprint: request.draftFingerprint,
          operationId: request.operationId,
          planFingerprint: request.planFingerprint,
          applyState: 'cloud-finalization-failed',
          appliedValue: request.appliedValue,
          sourceIdentityBefore: draft.lastApplySourceIdentityBefore,
          sourceIdentityAfter: request.sourceIdentityAfter,
          resultSummary: { code: 'cloud-recovery-finalization-failed' },
        }).catch(() => undefined);
      }

      let refreshedDraftRows: TrackMetadataDraftRow[] | null = null;
      let refreshFailure: unknown = null;
      try {
        refreshedDraftRows = await refreshMetadataCanonicalState(requestedUserId, requestedImportId, [draft.trackId]);
      } catch (error) {
        refreshFailure = error;
      }
      const refreshed = refreshedDraftRows?.find((row) => row.trackId === draft.trackId);
      const refreshProvesFinalized = refreshed?.lastApplyState === 'applied'
        && refreshed.lastApplyOperationId === request.operationId
        && refreshed.appliedRevision === request.appliedRevision
        && normalizeGenreMetadataDraftValue(refreshed.appliedValue) === normalizeGenreMetadataDraftValue(request.appliedValue);
      const cloudFinalized = finalizationFailure == null || refreshProvesFinalized;

      if (contextIsCurrent()) {
        if (cloudFinalized) {
          setMetadataCloudOutcome({ state: 'finalized', message: 'Cloud recovery finalized this verified Genre change.' });
          setMetadataApplyMessage('Recovery succeeded after read-only local verification. Supabase is finalized and Rekordbox was not rewritten.');
        } else {
          setMetadataCloudOutcome({
            state: 'recovery-required',
            message: finalizationFailure instanceof Error ? finalizationFailure.message : 'Cloud finalization retry failed.',
          });
          setMetadataApplyMessage('Read-only local recovery verification passed, but Supabase finalization is still unresolved. Rekordbox was not rewritten; retry recovery later.');
        }
        if (refreshFailure) {
          setMetadataDraftActionError(refreshFailure instanceof Error
            ? `Recovery completed, but refreshed metadata could not be loaded: ${refreshFailure.message}`
            : 'Recovery completed, but refreshed metadata could not be loaded.');
        }
      }
    } catch (error) {
      if (contextIsCurrent()) {
        setMetadataCloudOutcome({
          state: error instanceof MetadataApplyProofError ? 'proof-mismatch' : 'recovery-required',
          message: error instanceof Error ? error.message : 'Metadata recovery could not be completed.',
        });
        setMetadataApplyMessage('Metadata recovery stopped safely before cloud finalization. Rekordbox was not rewritten.');
      }
    } finally {
      if (generation === metadataApplyGenerationRef.current) {
        setMetadataRecoveryTrackId(null);
        setMetadataApplyBusy(false);
      }
    }
  }, [importId, metadataApplyBridgeAvailable, metadataApplyBusy, metadataRecoveryTrackId, refreshMetadataCanonicalState, userId]);

  const activeSourceTracks = browserSource === 'library' ? tracks : playlistTracks;
  const activeSourceTotal = browserSource === 'library' ? total : playlistTrackTotal;
  const activeSourceLoading = browserSource === 'library'
    ? loading
    : playlistsLoading || (Boolean(activePlaylistId) && playlistTracksLoading);
  const activeSourceLoadingMore = browserSource === 'library' ? loadingMore : playlistTracksLoadingMore;
  const activeSourceError = browserSource === 'library' ? error : playlistsError ?? playlistTracksError;
  const activeSourceHasMore = browserSource === 'library' ? hasMore : playlistTracksHaveMore;
  const loadMoreActiveSource = browserSource === 'library' ? loadMore : loadMorePlaylistTracks;

  const trackIdsKey = useMemo(
    () => [...new Set(activeSourceTracks.map((track) => track.id))].join(','),
    [activeSourceTracks],
  );
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

  const sourceSearchFilteredTracks = useMemo(() => {
    if (browserSource === 'library') return activeSourceTracks;
    const query = search.trim().toLowerCase();
    return activeSourceTracks.filter((track) => {
      if (genre && track.genre !== genre) return false;
      if (!query) return true;
      return [track.title, track.artist, track.genre]
        .some((value) => value?.toLowerCase().includes(query));
    });
  }, [activeSourceTracks, browserSource, genre, search]);

  const filteredTracks = useMemo(() => sourceSearchFilteredTracks.filter((track) => {
    if (!cueFilterMatches(cueSummaryStates.get(track.id), cueFilter)) return false;
    if (analysisFilter === 'ready' && !analysisReady(track)) return false;
    if (analysisFilter === 'incomplete' && analysisReady(track)) return false;
    if (statusFilter !== 'all') {
      const s = track.analysis_parse_status ?? '';
      if (statusFilter === 'ready' && s !== 'completed' && s !== 'reused') return false;
      if (statusFilter === 'partial' && s !== 'partial') return false;
      if (statusFilter === 'errored' && s !== 'failed' && s !== 'missing_required') return false;
      if (statusFilter === 'pending' && s !== '' && s !== 'not_requested' && s !== 'queued' && s !== 'parsing' && s !== 'skipped') return false;
    }
    if (keyFilter && formatKey(track.musical_key) !== keyFilter) return false;
    if (bpmRange !== null) {
      const bpm = track.bpm != null ? Math.round(track.bpm) : null;
      if (bpm == null || bpm < bpmRange[0] || bpm > bpmRange[1]) return false;
    }
    return true;
  }), [analysisFilter, bpmRange, cueFilter, cueSummaryStates, keyFilter, sourceSearchFilteredTracks, statusFilter]);

  const sortedTracks = useMemo(() => {
    if (!sortCol) return filteredTracks;
    return [...filteredTracks].sort((a, b) => {
      let av: string | number | null = null;
      let bv: string | number | null = null;
      if (sortCol === 'title') { av = a.title ?? ''; bv = b.title ?? ''; }
      else if (sortCol === 'artist') { av = a.artist ?? ''; bv = b.artist ?? ''; }
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

  // Stage 3 consumes this derived list for Previous/Next playback. It intentionally
  // follows the active source, current playlist, filters, sort order, and only the
  // records currently loaded by the existing query hooks.
  const orderedVisibleTracks = sortedTracks;

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
    if (selectedTrackId == null && orderedVisibleTracks.length > 0) {
      setSelectedTrack(orderedVisibleTracks[0]);
    }
  }, [orderedVisibleTracks, selectedTrackId]);

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

  const allVisibleTrackIds = useMemo(() => orderedVisibleTracks.map((track) => track.id), [orderedVisibleTracks]);
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
      // For ANLZ-only tracks (no local DB evidence), the current baseline
      // fingerprint was never established from imported data. Before preflight
      // can run, a live desktop observation must prove the current master.db state.
      if (
        kind === 'track'
        && selectedTrack
        && draftRevision != null
        && draftCurrentBaselineLocalCueFingerprint == null
        && draftDesiredFingerprint != null
        && draftImportedBaselineFingerprint != null
      ) {
        const verifyDraft = {
          importId: selectedTrack.import_id,
          trackId: selectedTrackId as string,
          rekordboxContentId: selectedTrack.rekordbox_content_id,
          revision: draftRevision,
          desiredFingerprint: draftDesiredFingerprint,
          importedBaselineFingerprint: draftImportedBaselineFingerprint,
          importedBaselineLocalCueFingerprint: null,
          masterDbId: selectedTrack.master_db_id,
          masterContentId: selectedTrack.master_content_id,
          desiredDocument: {
            schemaVersion: 1,
            importId: selectedTrack.import_id,
            trackId: selectedTrackId as string,
            rekordboxContentId: selectedTrack.rekordbox_content_id,
            cues: [],
          },
        };
        const verifyResult = await desktop.cueBaselineVerify(scope, [verifyDraft]);
        if (generation !== applyGenerationRef.current) return;
        const verifiedTrack = verifyResult.tracks.find((t) => t.content_id === selectedTrack.rekordbox_content_id);
        if (!verifiedTrack || verifiedTrack.identity_comparison !== 'match' || !verifiedTrack.current_cue_fingerprint) {
          setApplyMessage(
            verifiedTrack?.identity_error
            ?? 'Could not verify the current Rekordbox baseline. Make sure Rekordbox is closed and the track is in your local library, then try again.',
          );
          return;
        }
        const updated = await updateCueBaselineFingerprint({
          importId: selectedTrack.import_id,
          trackId: selectedTrackId as string,
          revision: draftRevision,
          currentBaselineLocalCueFingerprint: verifiedTrack.current_cue_fingerprint,
        });
        if (generation !== applyGenerationRef.current) return;
        setDraftCurrentBaselineLocalCueFingerprint(updated.currentBaselineLocalCueFingerprint);
      }

      let applyRows = await refreshApplyDrafts();
      if (generation !== applyGenerationRef.current || selectedUserIdRef.current !== userId || selectedImportIdRef.current !== importId) return;

      // Apply All: enroll any unverified baselines before destructive preflight.
      // Changed drafts without a current local fingerprint are Apply All candidates
      // that need a read-only live observation before the bridge can validate TOCTOU state.
      if (kind === 'all') {
        const unverifiedRows = applyRows.filter((row) => !cueDraftHasVerifiedBaseline(row));
        if (unverifiedRows.length > 0) {
          for (const unverifiedRow of unverifiedRows) {
            const verifyResult = await desktop.cueBaselineVerify(scope, desktopDrafts([unverifiedRow]));
            if (generation !== applyGenerationRef.current || selectedUserIdRef.current !== userId || selectedImportIdRef.current !== importId) return;
            const verifiedTrack = verifyResult.tracks.find(
              (t) => t.content_id === (unverifiedRow.masterContentId ?? unverifiedRow.rekordboxContentId),
            );
            if (!verifiedTrack || verifiedTrack.identity_comparison !== 'match' || !verifiedTrack.current_cue_fingerprint) {
              setApplyMessage(
                (verifiedTrack?.identity_error ?? 'Baseline verification failed for one or more tracks.')
                + ' No Rekordbox changes were made. Make sure Rekordbox is closed and all tracks are in your local library, then try again.',
              );
              return;
            }
            await updateCueBaselineFingerprint({
              importId: unverifiedRow.importId,
              trackId: unverifiedRow.trackId,
              revision: unverifiedRow.revision,
              currentBaselineLocalCueFingerprint: verifiedTrack.current_cue_fingerprint,
            });
            if (generation !== applyGenerationRef.current) return;
          }
          // Reload drafts so the preflight sees the newly enrolled fingerprints.
          applyRows = await refreshApplyDrafts();
          if (generation !== applyGenerationRef.current || selectedUserIdRef.current !== userId || selectedImportIdRef.current !== importId) return;
        }
      }

      const selection = resolveCueApplySelection(applyRows, scope);
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
  }, [applyBridgeAvailable, applyRebaseRecovery, desktopDrafts, draftCurrentBaselineLocalCueFingerprint, draftDesiredFingerprint, draftImportedBaselineFingerprint, draftRevision, importId, refreshApplyDrafts, selectedCueBaselineEditable, selectedCueBlockReason, selectedTrack, selectedTrackId, userId]);

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

  const handleAddCue = useCallback((family: 'hot' | 'memory', requestedMs: number, snapResolution: CueSnapResolution): string | null => {
    if (!selectedTrackId) return 'Select a track before editing cue points.';
    if (selectedCueLoading) return 'Cue points are still loading for this track.';
    if (!selectedCueBaselineEditable) return selectedCueBlockReason ?? 'Cue editing is blocked until the cue baseline is safe.';
    if (snapResolution !== 'off' && beatGridLoading) return 'The Rekordbox beat grid is still loading for this track.';
    manualCueSequenceRef.current += 1;
    const result = addWorkingCue(workingCues, {
      editorId: `manual:${selectedTrackId}:${manualCueSequenceRef.current}`,
      trackId: selectedTrackId,
      family,
      requestedMs,
      beats: beatGrid?.beats ?? [],
      snapResolution,
    });
    if (!result.error) setWorkingCues(result.cues);
    return result.error;
  }, [beatGrid, beatGridLoading, selectedCueBaselineEditable, selectedCueBlockReason, selectedCueLoading, selectedTrackId, workingCues]);

  const handleMoveCue = useCallback((cueId: string, requestedMs: number, snapResolution: CueSnapResolution): string | null => {
    if (selectedCueLoading) return 'Cue points are still loading for this track.';
    if (!selectedCueBaselineEditable) return selectedCueBlockReason ?? 'Cue editing is blocked until the cue baseline is safe.';
    if (snapResolution !== 'off' && beatGridLoading) return 'The Rekordbox beat grid is still loading for this track.';
    const result = moveWorkingCue(workingCues, cueId, requestedMs, beatGrid?.beats ?? [], snapResolution);
    if (!result.error) setWorkingCues(result.cues);
    return result.error;
  }, [beatGrid, beatGridLoading, selectedCueBaselineEditable, selectedCueBlockReason, selectedCueLoading, workingCues]);

  const handleEditCue = useCallback((cueId: string, action: CueEditAction): string | null => {
    if (selectedCueLoading) return 'Cue points are still loading for this track.';
    if (!selectedCueBaselineEditable) return selectedCueBlockReason ?? 'Cue editing is blocked until the cue baseline is safe.';
    const needsGrid = (action.kind === 'point-type' && action.pointType === 'loop')
      || ((action.kind === 'end-ms' || action.kind === 'loop-length-ms') && action.snapResolution !== 'off');
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

  useEffect(() => {
    const el = waveformPanelWrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWaveformPanelHeight(entry.contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = filterRowRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setFilterRowHeight(entry.contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (!importId) {
    return (
      <div className="mx-auto max-w-3xl pt-8">
        <div className="border-y border-[var(--color-border-faint)] bg-[var(--color-card)]/55 p-8 text-center">
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
    <div className="flex w-full flex-col gap-4 pb-10">
      <PendingMetadataChangesReview
        open={pendingMetadataReviewOpen}
        pendingCount={pendingMetadataCount}
        actionablePendingCount={actionableMetadataPendingCount}
        recoveryCount={metadataRecoveryCount}
        draftLoadStatus={metadataDraftLoadStatus}
        draftLoadError={metadataDraftLoadError}
        identityLoadStatus={pendingMetadataTrackLoadStatus}
        identityLoadError={pendingMetadataTrackLoadError}
        rows={pendingMetadataReviewRows}
        discardingTrackIds={discardingMetadataTrackIds}
        actionError={metadataDraftActionError}
        applyAvailable={metadataApplyBridgeAvailable}
        applyAvailabilityReason={metadataApplyBridgeReason}
        preflightBusy={metadataApplyBusy}
        preflightResult={metadataApplyPreflight}
        applyResult={metadataApplyResult}
        cloudOutcome={metadataCloudOutcome}
        recoveryBusyTrackId={metadataRecoveryTrackId}
        ordinaryActionsBlocked={Boolean(metadataCloudOutcome && metadataCloudOutcome.state !== 'finalized')}
        preflightMessage={metadataApplyMessage}
        onClose={() => setPendingMetadataReviewOpen(false)}
        onRetryDrafts={() => { setMetadataDraftActionError(null); setMetadataDraftRetryNonce((value) => value + 1); }}
        onRetryIdentities={() => setPendingMetadataTrackRetryNonce((value) => value + 1)}
        onDiscard={(draft) => { void discardPendingGenreDraft(draft); }}
        onRecover={(draft) => { void handleMetadataRecovery(draft); }}
        onPreflightAll={() => { void handleMetadataPreflightAll(); }}
        onApplyAll={() => { void handleMetadataApplyAll(); }}
      />

      <div ref={waveformPanelWrapperRef} className="sticky top-0 z-30">
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
          && (applyDrafts.some((row) => row.trackId === selectedTrackId) || baselineProofRefreshNeeded)}
        applyAllCount={applyBridgeAvailable && !applyDraftLoadError && !applyBlockedByPendingRebase ? applyDrafts.length : 0}
        applying={applyBusy}
        onApplyTrack={() => { void handleApplyPreflight('track'); }}
        onApplyAll={() => { void handleApplyPreflight('all'); }}
        pendingMetadataCount={pendingMetadataCount}
        metadataDraftLoadStatus={metadataDraftLoadStatus}
        onOpenPendingChanges={() => setPendingMetadataReviewOpen(true)}
      />
      </div>

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

      <section className="cue-browser border-y border-[var(--color-border-faint)]" style={{ overflow: 'clip' }}>
        <div ref={filterRowRef} className="cue-browser__chrome sticky z-20 border-b border-[var(--color-border-faint)]" style={{ top: waveformPanelHeight }}>
          <div className="flex flex-col">
            <div className="cue-browser__transport-row w-full">
              <CuePointsAudioDock
                selectedTrack={selectedTrack}
                orderedTracks={orderedVisibleTracks}
                onSelectTrack={setSelectedTrack}
              />
            </div>

            <div className="cue-browser__filters flex flex-wrap items-end gap-x-5 gap-y-2.5 border-t border-[var(--color-border-faint)] px-4 py-2.5 md:px-5" data-testid="cue-browser-filters">
              <div data-testid="cue-browser-source-tabs" className="min-w-[190px] self-stretch flex">
                <TabNavigation
                  ariaLabel="Cue Points browser source"
                  variant="primary"
                  value={browserSource}
                  onChange={(value) => setBrowserSource(value as BrowserSource)}
                  options={[
                    { id: 'library', label: 'Library' },
                    { id: 'playlists', label: 'Playlists' },
                  ]}
                />
              </div>
              <CueFilterDropdown
                label="Status"
                value={statusFilter}
                onChange={(v) => setStatusFilter(v as StatusFilter)}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'ready', label: 'Ready' },
                  { value: 'partial', label: 'Partial' },
                  { value: 'errored', label: 'Errored' },
                  { value: 'pending', label: 'Pending' },
                ]}
              />
              <CueFilterDropdown
                label="Genre"
                value={genre}
                onChange={setGenre}
                searchable
                options={[
                  { value: '', label: 'All' },
                  ...(stats?.genreTotals ?? []).map((item) => ({ value: item.name, label: `${item.name} (${item.count})` })),
                ]}
              />
              <CueFilterDropdown
                label="Key"
                value={keyFilter}
                onChange={setKeyFilter}
                searchable
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
              <div className="min-w-[240px] max-w-[360px] flex-1" data-testid="cue-browser-search">
                <SearchControl
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search title, artist, or genre…"
                  aria-label="Search cue point tracks"
                />
              </div>
              {browserSource === 'playlists' && (
                <div className="min-w-[220px] max-w-[360px] flex-1" data-testid="cue-browser-playlist-selector">
                  <SelectControl
                    aria-label="Select Rekordbox playlist"
                    value={selectedPlaylistId ?? ''}
                    disabled={playlistsLoading || selectablePlaylists.length === 0}
                    onChange={(event) => setSelectedPlaylistId(event.target.value || null)}
                  >
                    {playlistsLoading ? (
                      <option value="">Loading playlists…</option>
                    ) : selectablePlaylists.length === 0 ? (
                      <option value="">No imported playlists</option>
                    ) : (
                      selectablePlaylists.map((playlist) => (
                        <option key={playlist.id} value={playlist.id}>
                          {playlist.name} ({playlist.track_count.toLocaleString()})
                        </option>
                      ))
                    )}
                  </SelectControl>
                </div>
              )}
            </div>
          </div>
        </div>

        {metadataDraftLoadStatus === 'loading' && userId && importId && (
          <div className="flex items-center gap-2 border-b border-[var(--color-border-faint)] bg-white/[0.02] px-5 py-2.5 text-xs text-muted-foreground" role="status">
            <CircleDash className="animate-spin" size={14} />
            Loading pending Genre changes…
          </div>
        )}

        {metadataDraftLoadError && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-red-400/15 bg-red-400/[0.04] px-5 py-3 text-xs text-red-200" role="alert">
            <span>{metadataDraftLoadError} Canonical Rekordbox Genre values are shown below, but pending state is unknown until this succeeds.</span>
            <ControlButton
              variant="ghost"
              disabled={!userId || !importId || metadataDraftLoadStatus === 'loading'}
              onClick={() => setMetadataDraftRetryNonce((value) => value + 1)}
            >
              Retry pending Genres
            </ControlButton>
          </div>
        )}

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

        {activeSourceError ? (
          <div className="flex items-center gap-3 px-5 py-8 text-sm text-red-300">
            <WarningAlt size={20} />
            <span>{activeSourceError}</span>
          </div>
        ) : activeSourceLoading ? (
          <div className="flex items-center justify-center gap-3 py-16 text-sm text-muted-foreground">
            <CircleDash className="animate-spin text-primary" size={22} />
            {browserSource === 'library' ? 'Loading library tracks…' : 'Loading playlist tracks…'}
          </div>
        ) : browserSource === 'playlists' && selectablePlaylists.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="font-bold">No imported playlists are available.</p>
            <p className="mt-1 text-sm text-muted-foreground">Library browsing remains available while playlists are empty.</p>
          </div>
        ) : filteredTracks.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="font-bold">No tracks match these filters.</p>
            <p className="mt-1 text-sm text-muted-foreground">Try clearing a search or filter to widen the current source.</p>
          </div>
        ) : (
          <>
            <div className="overflow-y-auto overflow-x-hidden scrollbar-none" style={{ maxHeight: `calc(100vh - ${waveformPanelHeight + filterRowHeight + 16}px)` }}>
              <table className="cue-browser__table w-full min-w-[900px] border-collapse text-left" data-testid="cue-browser-track-table" aria-label="Cue Points browser tracks">
                <thead className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-[var(--color-border-faint)]">
                    <th className="sticky top-0 z-10 bg-[var(--color-background)] px-3 py-2 select-none">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                        aria-label="Sort by Track"
                        onClick={() => handleColClick('title')}
                      >
                        Track
                        <span className={cn('text-primary', sortCol !== 'title' && 'invisible')}>{sortDir === 'asc' ? '↑' : '↓'}</span>
                      </button>
                    </th>
                    {([
                      { col: 'bpm', label: 'BPM', cls: 'px-3 py-2' },
                      { col: 'key', label: 'Key', cls: 'px-3 py-2' },
                      { col: 'genre', label: 'Genre', cls: 'px-3 py-2 w-[178px]' },
                      { col: 'cues', label: 'Cues', cls: 'px-3 py-2 text-center' },
                      { col: 'duration', label: 'Duration', cls: 'px-3 py-2 text-left w-[80px]' },
                    ] as const).map(({ col, label, cls }) => (
                      <th key={col} className={cn(cls, 'sticky top-0 z-10 bg-[var(--color-background)] select-none')}>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                          aria-label={`Sort by ${label}`}
                          onClick={() => handleColClick(col)}
                        >
                          {label}
                          <span className={cn('text-primary', sortCol !== col && 'invisible')}>{sortDir === 'asc' ? '↑' : '↓'}</span>
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-faint)]">
                  {orderedVisibleTracks.map((track, rowIndex) => {
                    const cueState = cueSummaryStates.get(track.id);
                    const cueCount = cueLoadCount(cueState);
                    const selected = track.id === selectedTrackId;
                    const genreDraft = genreDraftsByTrackId.get(track.id) ?? null;
                    const effectiveGenre = genreDraft ? genreDraft.pendingValue : track.genre;
                    const genreEditingDirty = editingGenreTrackId === track.id
                      && normalizeGenreMetadataDraftValue(editingGenreValue) !== normalizeGenreMetadataDraftValue(effectiveGenre);
                    const genreSaving = savingGenreTrackIds.has(track.id);
                    const genreRecoveryLocked = Boolean(genreDraft && isTrackMetadataDraftRecoveryLocked(genreDraft));
                    const genreRuntimeBlocked = Boolean(metadataCloudOutcome && metadataCloudOutcome.state !== 'finalized');
                    const genreEditingAvailable = metadataDraftLoadStatus === 'loaded' && !genreRecoveryLocked && !genreRuntimeBlocked;
                    return (
                      <tr
                        key={`${browserSource}:${selectedPlaylistId ?? 'library'}:${track.id}:${rowIndex}`}
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
                          'cue-browser__row cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50',
                          selected ? 'cue-browser__row--selected' : 'hover:bg-[var(--color-surface-hover)]',
                        )}
                      >
                        <td className="px-3 py-1.5">
                          <div className="group flex min-w-0 items-center gap-2.5">
                            <span className={cn(
                              'h-1.5 w-1.5 shrink-0 rounded-full',
                              analysisReady(track)
                                ? 'bg-emerald-400'
                                : track.analysis_parse_status === 'failed' || track.analysis_parse_status === 'missing_required'
                                  ? 'bg-red-400'
                                  : track.analysis_parse_status == null
                                    ? 'bg-muted-foreground/40'
                                    : 'bg-amber-400',
                            )} aria-hidden="true" />
                            <span className={cn('h-8 w-0.5 shrink-0 rounded-full', selected ? 'bg-primary' : 'bg-transparent')} aria-hidden="true" />
                            <Artwork
                              src={track.artwork_path}
                              alt={`Artwork for ${track.title}`}
                              fallbackTitle="No artwork"
                              className="h-9 w-9 shrink-0 rounded-[6px]"
                            />
                            <div className="w-[346px] shrink-0 min-w-0">
                              <p className={cn('truncate text-sm font-bold leading-tight', selected && 'text-primary')}>{track.title}</p>
                              <p className="truncate text-[10px] text-muted-foreground">{track.artist ?? 'Artist Not Available'}</p>
                            </div>
                            <div className="flex-1 min-w-[80px] flex flex-col gap-1">
                              <div className="relative h-2" aria-hidden="true">
                                {(() => {
                                  if (cueState?.status !== 'loaded-with-cues') return null;
                                  const trackDurationMs = durationMsForTrack(track, null);
                                  if (!trackDurationMs) return null;
                                  return cueState.cues
                                    .filter((cue) => cue.start_ms != null)
                                    .map((cue) => (
                                      <span
                                        key={cue.id}
                                        className="absolute top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full"
                                        style={{
                                          left: `${Math.min(100, Math.max(0, (cue.start_ms! / trackDurationMs) * 100))}%`,
                                          backgroundColor: cue.color_hex ?? (cue.cue_family === 'hot' ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.25)'),
                                        }}
                                      />
                                    ));
                                })()}
                              </div>
                              <RekordboxPreviewWaveform
                                state={getWaveformState(track.id)}
                                height={26}
                                variant="compact"
                                appearance="dropdex"
                                showCenterLine={false}
                                surface={false}
                                ariaLabel={`Waveform for ${track.title}`}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-1.5 font-mono text-[13px] font-bold tabular-nums">{track.bpm != null ? track.bpm.toFixed(1) : '—'}</td>
                        <td className="px-3 py-1.5">
                          {(() => {
                            const kc = camelotColor(track.musical_key);
                            const key = formatCamelotKey(track.musical_key);
                            if (!key) return <span className="text-xs text-muted-foreground">—</span>;
                            return (
                              <span className="inline-flex items-center rounded-[5px] bg-white/[0.05] pl-[3px] pr-2 py-1 font-mono text-[13px] font-bold"
                                style={{ color: kc ?? 'rgba(255,255,255,0.5)' }}>
                                <span className="mr-1.5 h-[14px] w-[3px] shrink-0 rounded-full" style={{ backgroundColor: kc ?? 'rgba(255,255,255,0.2)' }} />
                                {key}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="w-[178px] px-3 py-1.5 text-xs text-muted-foreground">
                          {editingGenreTrackId === track.id ? (
                            <div className="space-y-1.5" onClick={(event) => event.stopPropagation()}>
                              <div className="flex items-center gap-1.5">
                                <div className="flex-1 pb-2 border-b border-white/15 focus-within:border-white/35 transition-colors">
                                  <input
                                    type="text"
                                    autoFocus
                                    maxLength={REKORDBOX_GENRE_MAX_LENGTH}
                                    value={editingGenreValue}
                                    onChange={(event) => {
                                      setEditingGenreValue(event.target.value);
                                      setGenreSaveError((current) => current?.trackId === track.id ? null : current);
                                    }}
                                    onKeyDown={(event) => {
                                      event.stopPropagation();
                                      if (event.key === 'Escape') {
                                        event.preventDefault();
                                        setEditingGenreTrackId(null);
                                        setGenreSaveError((current) => current?.trackId === track.id ? null : current);
                                      } else if (event.key === 'Enter' && !event.repeat && genreEditingDirty && !genreSaving && genreEditingAvailable) {
                                        event.preventDefault();
                                        void saveInlineGenreDraft(track);
                                      }
                                    }}
                                    disabled={genreSaving || !genreEditingAvailable}
                                    aria-label={`Genre for ${track.title}`}
                                    className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground/30 outline-none disabled:opacity-60"
                                    placeholder="Genre…"
                                  />
                                </div>
                                {genreEditingDirty && (
                                  <button
                                    type="button"
                                    className="shrink-0 text-primary hover:text-primary/80 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                                    title="Save pending Genre change"
                                    aria-label={`Save pending Genre change for ${track.title}`}
                                    disabled={genreSaving || !genreEditingAvailable}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void saveInlineGenreDraft(track);
                                    }}
                                  >
                                    {genreSaving ? <CircleDash className="animate-spin" size={13} /> : <Save size={13} />}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                                  title="Cancel genre edit"
                                  aria-label={`Cancel genre edit for ${track.title}`}
                                  disabled={genreSaving}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setEditingGenreTrackId(null);
                                    setGenreSaveError((current) => current?.trackId === track.id ? null : current);
                                  }}
                                >
                                  <Close size={13} />
                                </button>
                              </div>
                              {genreSaveError?.trackId === track.id && (
                                <div className="flex items-center justify-between gap-2 text-[10px] text-red-300" role="alert">
                                  <span>{genreSaveError.message}</span>
                                  {genreSaveError.revisionConflict && (
                                    <button
                                      type="button"
                                      className="shrink-0 font-bold text-red-200 underline underline-offset-2 hover:text-red-100"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setMetadataDraftRetryNonce((value) => value + 1);
                                      }}
                                    >
                                      Reload pending Genre
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div
                              className="group flex items-center gap-1.5"
                              onMouseLeave={() => {}}
                            >
                              <span className="block min-w-0 truncate">{effectiveGenre ?? '—'}</span>
                              {genreDraft && (
                                <span
                                  className="shrink-0 rounded-full border border-amber-300/25 bg-amber-300/[0.08] px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide text-amber-200"
                                  title={genreRecoveryLocked
                                    ? 'Rekordbox Genre is already locally verified; cloud finalization recovery is required.'
                                    : 'Pending Genre change. Not yet applied to Rekordbox.'}
                                  aria-label={genreRecoveryLocked
                                    ? 'Genre cloud finalization recovery required'
                                    : 'Pending Genre change, not yet applied to Rekordbox'}
                                >
                                  {genreRecoveryLocked ? 'Recovery' : 'Pending'}
                                </span>
                              )}
                              <button
                                type="button"
                                className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all disabled:cursor-not-allowed disabled:opacity-20 group-hover:disabled:opacity-20"
                                title={genreEditingAvailable
                                  ? 'Edit Genre'
                                  : genreRecoveryLocked
                                    ? 'Genre editing is locked until metadata cloud recovery completes'
                                    : genreRuntimeBlocked
                                      ? 'Genre editing is blocked while the current metadata Apply outcome is unresolved'
                                      : 'Pending Genre changes must finish loading before editing'}
                                aria-label={`Edit Genre for ${track.title}`}
                                disabled={!genreEditingAvailable}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!genreEditingAvailable) return;
                                  setEditingGenreTrackId(track.id);
                                  setEditingGenreValue(effectiveGenre ?? '');
                                  setGenreSaveError(null);
                                }}
                              >
                                <Edit size={12} />
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <span className={cn(
                            'inline-flex min-w-8 justify-center rounded-md border px-2 py-1 font-mono text-[12px] font-black',
                            cueState?.status === 'failed'
                              ? 'border-red-400/25 bg-red-400/10 text-red-300'
                              : (cueCount ?? 0) > 0
                              ? 'border-secondary/25 bg-secondary/10 text-secondary'
                              : 'border-[var(--color-border-subtle)] bg-[var(--color-surface)] text-muted-foreground',
                          )} title={cueState?.status === 'failed' ? cueState.error : undefined}>
                            {cueState?.status === 'loading' || !cueState ? '…' : cueState.status === 'failed' ? '!' : cueCount}
                          </span>
                        </td>
                        <td className="w-[80px] px-3 py-1.5 text-left font-mono text-[13px] text-muted-foreground">
                          {formatTime(durationMsForTrack(track, null))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 border-t border-[var(--color-border-subtle)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-5">
              <div className="space-y-0.5 text-xs text-muted-foreground">
                <p>
                  Showing {orderedVisibleTracks.length.toLocaleString()} visible rows · {activeSourceTotal.toLocaleString()} tracks in the active source query
                </p>
                {browserSource === 'playlists' && activeSourceHasMore && (
                  <p>Playlist search and filters apply to currently loaded tracks; load more to widen the filtered result set.</p>
                )}
              </div>
              {activeSourceHasMore && (
                <ControlButton variant="surface" onClick={() => void loadMoreActiveSource()} disabled={activeSourceLoadingMore}>
                  {activeSourceLoadingMore ? 'Loading…' : 'Load more tracks'}
                </ControlButton>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
