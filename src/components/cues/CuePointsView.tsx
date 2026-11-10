import { sortRecordTracks } from '../ui/display/recordTrackSorting';
import { useAudioDockTracks } from '../../contexts/AudioDockWorkspaceContext';
import { AuditionTrackHeader } from '../audition/AuditionTrackHeader';
import { formatClock, timeRulerTicks } from '../audition/auditionTracks';
import { TrackTimeline } from '../ui/media/TrackTimeline';
import { waveformSectionInk } from '../ui/media/waveformPresentation';
import { cueFlagColor, WaveformCueMarker } from '../ui/media/WaveformCueMarker';
import { CloudSyncIcon } from '../library/CloudSyncIcon';
import { useSyncedPreviewKeys } from '../../hooks/useSyncedPreviewKeys';
import { trackIdentityKey } from '../../lib/preview/trackIdentity';
import { GenreEditPopover, GenreEditorContent } from './GenreEditPopover';
import { CueApplyMenu } from './CueApplyMenu';
import { TrackSourceTabs } from './TrackSourceTabs';
import { RecordTrackListing } from '../ui/display/RecordTrackListing';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Clock, DatabaseExport, EditPencil, FloppyDisk, Label, LightBulb, MusicNote, NavArrowDown, Palette, Pause, Play, Refresh, TaskList, Timer, Undo, Upload, WarningTriangle, Xmark } from 'iconoir-react/regular';
import { cn, formatKey } from '../../lib/utils';
import { isUsableBeatGrid } from '../../lib/music/beatGridHelpers';
import { barLabelBeats, beatRulerTicks, timelineGridLines } from '../../lib/cues/beatRuler';
import { gridBeatsForMode, type CueGridDisplayMode } from '../../lib/cues/cueTimelineViewport';
import { useTimelineZoom } from '../../hooks/useTimelineZoom';
import { useTrackPlaylistCounts } from '../../hooks/useTrackPlaylistCounts';
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
import { type WaveformColorSegment } from '../library/RekordboxPreviewWaveform';
import { CueEditorToolbar, CueStateIcon, TimelineGridControls } from './CueEditorToolbar';
import type { WaveformLoadState } from '../../lib/queries/waveformValidation';
import { ControlButton, DualRangeSlider, FilterDropdown, SearchControl, SelectControl, TextControl } from '../ui/controls';
import { WaveformZoomControls } from '../ui/media';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { useWaveformProgress } from '../../hooks/useWaveformProgress';
import { cuePlaybackPlayheadPercent } from '../../lib/cues/cuePlaybackTransport';
import type { RekordboxTrack } from '../../types';
import { buildTimelineSections } from '../../lib/music/phraseSections';
import { durationMsForTrack, formatTime } from '../../lib/music/trackTiming';
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
import './cue-studio.css';
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
  mode?: 'cues' | 'audition' | 'artist-library';
  onTrackOpen?: (track: RekordboxTrack) => void;
  /** Library page only: told whenever the selected track changes, so the page can show that track's waveform. */
  onSelectedTrackChange?: (track: RekordboxTrack | null) => void;
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

function formatCamelotKey(key: string | null | undefined): string {
  const raw = formatKey(key);
  return raw.replace(/^(\d)([AB])$/i, (_, n, l) => `0${n}${l.toUpperCase()}`);
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
      {isLoading ? <Refresh width={13} height={13} aria-hidden="true" className="animate-spin" /> : isPlaying ? <Pause width={13} height={13} aria-hidden="true" /> : <Play width={13} height={13} aria-hidden="true" />}
    </button>
  );
}

function CueEditorPlaybackPlayhead({
  trackId,
  viewStartMs,
  viewEndMs,
}: {
  trackId: string;
  viewStartMs: number;
  viewEndMs: number;
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
        left: 'var(--cue-timeline-inline-inset)',
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
          <Xmark width={15} height={15} aria-hidden="true" />
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
            icon={<Timer width={15} height={15} aria-hidden="true" />}
            key={`${cue.editorId}:start:${cue.startMs}`}
            className="font-mono tabular-nums"
            containerClassName="mt-1"
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
              icon={<Palette width={15} height={15} aria-hidden="true" />}
              key={`${cue.editorId}:color-index:${cue.colorTableIndex}`}
              className="font-mono tabular-nums"
              containerClassName="mt-1"
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
              icon={<Timer width={15} height={15} aria-hidden="true" />}
              key={`${cue.editorId}:end:${cue.endMs}`}
              className="font-mono tabular-nums"
              containerClassName="mt-1"
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
              icon={<Clock width={15} height={15} aria-hidden="true" />}
              key={`${cue.editorId}:length:${loopLengthMs}`}
              className="font-mono tabular-nums"
              containerClassName="mt-1"
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
          icon={<EditPencil width={15} height={15} aria-hidden="true" />}
          containerClassName="mt-1"
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
  audition = false,
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
  snapResolution,
  onSnapResolutionChange,
  gridDisplayMode,
  onGridDisplayModeChange,
  gridVisible,
  onGridVisibleChange,
}: {
  audition?: boolean;
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
  snapResolution: CueSnapResolution;
  onSnapResolutionChange: (v: CueSnapResolution) => void;
  gridDisplayMode: CueGridDisplayMode;
  onGridDisplayModeChange: (v: CueGridDisplayMode) => void;
  gridVisible: boolean;
  onGridVisibleChange: (v: boolean) => void;
}) {
  const durationMs = durationMsForTrack(track, beatGrid, phrases);

  const zoom = useTimelineZoom(durationMs);
  const { viewStart, containerRef: waveformDivRef } = zoom;
  const [selectedCueId, setSelectedCueId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<CueContextMenuState | null>(null);
  const [editorMessage, setEditorMessage] = useState<string | null>(null);
  const [applyMenuOpen, setApplyMenuOpen] = useState(false);
  const applyMenuRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{ cueId: string; pointerId: number; startX: number; moved: boolean } | null>(null);
  const effectiveViewEnd = zoom.viewEnd;

  const resetZoom = zoom.reset;
  useEffect(() => {
    resetZoom();
    setSelectedCueId(null);
    setContextMenu(null);
    setEditorMessage(null);
    setApplyMenuOpen(false);
    dragStateRef.current = null;
  }, [track?.id, durationMs, resetZoom]);

  useEffect(() => {
    onSnapResolutionChange('1-beat');
  }, [track?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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


  const sections = useMemo(
    () => buildTimelineSections(phrases, beatGrid, durationMs),
    [beatGrid, durationMs, phrases],
  );
  const displayGridBeats = useMemo(() => gridVisible ? gridBeatsForMode(beatGrid?.beats ?? [], gridDisplayMode) : [], [beatGrid, gridDisplayMode, gridVisible]);
  const gridLines = useMemo(() => timelineGridLines(displayGridBeats), [displayGridBeats]);
  const rulerTicks = useMemo(() => beatRulerTicks(displayGridBeats), [displayGridBeats]);
  const timeTicks = useMemo(() => timeRulerTicks(effectiveViewEnd - viewStart).map((tick) => ({
    ms: tick.ms + viewStart, label: formatClock(tick.ms + viewStart),
  })), [viewStart, effectiveViewEnd]);
  const rulerLabels = useMemo(() => gridVisible ? barLabelBeats(beatGrid?.beats ?? []) : [], [beatGrid, gridVisible]);
  const positionedCues = useMemo(() => {
    if (durationMs == null || durationMs <= 0) return [];
    let memoryNumber = 0;
    return cues.filter((cue) => cue.startMs != null).map((cue) => {
      const markerLabel = cue.family === 'hot' ? cueLabel(cue) : String(++memoryNumber);
      const displayColor = resolveCueDisplayColor(cue);
      return { ...cue, markerLabel, displayColor, markerColor: cueFlagColor(markerLabel, displayColor.hex) };
    });
  }, [cues, durationMs]);
  const waveformColorSegments = useMemo<WaveformColorSegment[]>(() => {
    if (durationMs == null || durationMs <= 0) return [];
    return sections.map((section) => ({
      startFraction: section.startMs / durationMs,
      endFraction: section.endMs / durationMs,
      color: waveformSectionInk(section.label),
    }));
  }, [durationMs, sections]);
  const { activeTrack: panelActiveTrack, status: panelPlayerStatus, seek: seekPlayback } = useAudioPlayer();
  const panelPlaybackProgress = useWaveformProgress(track?.id);
  const activeSection = useMemo(() => {
    if (panelActiveTrack?.id !== track?.id || panelPlayerStatus === 'idle') return null;
    if (panelPlaybackProgress == null || durationMs == null) return null;
    const currentMs = panelPlaybackProgress * durationMs;
    return sections.find((s) => currentMs >= s.startMs && currentMs < s.endMs) ?? null;
  }, [durationMs, panelActiveTrack?.id, panelPlayerStatus, panelPlaybackProgress, sections, track?.id]);

  const hasUsableGrid = useMemo(() => isUsableBeatGrid(beatGrid?.beats ?? []), [beatGrid]);
  const availableHotCueSlot = useMemo(() => nextAvailableHotCueSlot(cues), [cues]);
  const selectedCue = useMemo(() => cues.find((cue) => cue.editorId === selectedCueId) ?? null, [cues, selectedCueId]);
  const cueBaselineComplete = cueLoadStatus === 'loaded-empty' || cueLoadStatus === 'loaded-with-cues';
  const cueEditingAllowed = !audition && cueBaselineComplete && cueIntegrity?.status === 'valid' && !editingBlockedReason;
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

  const handleZoom = zoom.zoomBy;

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
      <section className="overflow-hidden border-t border-[var(--color-border-subtle)] bg-[var(--color-card)]">
        <div className="flex min-h-[280px] flex-col items-center justify-center px-6 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
            <MusicNote width={26} height={26} aria-hidden="true" />
          </div>
          <h2 className="text-lg font-black">{audition ? 'Select a track to audition' : 'Select a track to inspect cue points'}</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Track sections, imported cues, the Rekordbox waveform, and the beat grid will appear in one aligned timeline.
          </p>
        </div>
      </section>
    );
  }

  const saveDisabled = (!dirty && !baselineProofRefreshNeeded) || !cueEditingAllowed || saving;
  const discardDisabled = !dirty || !cueEditingAllowed || saving;
  const applyTrackDisabled = !applyTrackAvailable || applying;
  const applyAllDisabled = applyAllCount === 0 || applying;


  return (
    <section className="cue-workstation relative overflow-visible" data-testid="cue-points-workstation">
      <AuditionTrackHeader
        track={track}
        durationMs={durationMs}
        cueCount={audition ? undefined : cueLoading ? '…' : cueLoadStatus === 'failed' ? '!' : String(cues.length)}
      />
      {audition && <div className="cue-workstation__toolbar" role="group" aria-label="Track timeline controls">
        <div className="cue-workstation__actions flex shrink-0 items-center gap-0.5">
          <TimelineGridControls
            gridDisplayMode={gridDisplayMode}
            onGridDisplayModeChange={onGridDisplayModeChange}
            gridVisible={gridVisible}
            onGridVisibleChange={onGridVisibleChange}
          />
        </div>
      </div>}
      {!audition && <div className="cue-workstation__toolbar">
        <div className="cue-workstation__actions flex shrink-0 items-center gap-0.5">
          <CueStateIcon state={draftStatus} />
          <span className="mx-1.5 h-5 w-px bg-white/10" aria-hidden="true" />
          <CueEditorToolbar
            snapResolution={snapResolution}
            onSnapResolutionChange={onSnapResolutionChange}
            gridDisplayMode={gridDisplayMode}
            onGridDisplayModeChange={onGridDisplayModeChange}
            gridVisible={gridVisible}
            onGridVisibleChange={onGridVisibleChange}
          />
          <span className="mx-1.5 h-5 w-px bg-white/10" aria-hidden="true" />
          <ControlButton
            className="cue-action-icon"
            data-label="Pending"
            variant="ghost"
            onClick={onOpenPendingChanges}
            aria-label={metadataDraftLoadStatus === 'loaded' ? `Open Pending Changes, ${pendingMetadataCount} pending` : 'Open Pending Changes'}
            title={metadataDraftLoadStatus === 'failed' ? 'Pending metadata state failed to load. Open to retry.' : 'Review saved metadata changes'}
          >
            <TaskList width={20} height={20} aria-hidden="true" />
            {metadataDraftLoadStatus === 'loaded' && pendingMetadataCount > 0 && <span className="cue-action-icon__badge">{pendingMetadataCount}</span>}
            {metadataDraftLoadStatus === 'failed' && <span className="cue-action-icon__badge cue-action-icon__badge--warn">!</span>}
          </ControlButton>
          <ControlButton
            className="cue-action-icon"
            data-label="Auto Cue"
            variant="ghost"
            aria-label="Auto Cue"
            disabled={!autoCueReady}
            onClick={() => setEditorMessage(onAutoCue())}
            title={autoCueReady ? 'Auto Cue: generate deterministic A–H cue proposals' : "Auto Cue requires the selected track's exact beat grid and phrase data to finish loading"}
          >
            <LightBulb width={20} height={20} aria-hidden="true" />
          </ControlButton>
          <div ref={applyMenuRef} className="relative flex" data-testid="cue-apply-menu">
            <ControlButton
              className="cue-action-icon cue-action-icon--accent"
              data-label="Apply"
              variant="ghost"
              aria-label={`Apply All, ${applyAllCount} to apply`}
              disabled={applyAllDisabled}
              onClick={onApplyAll}
              title={applyAllCount > 0 ? `Apply all ${applyAllCount} saved track changes to local Rekordbox` : 'Apply All requires at least one saved draft that needs apply'}
            >
              {applying ? <Refresh width={20} height={20} aria-hidden="true" className="animate-spin" /> : <DatabaseExport width={20} height={20} aria-hidden="true" />}
              {applyAllCount > 0 && <span className="cue-action-icon__badge">{applyAllCount}</span>}
            </ControlButton>
            <ControlButton
              className="cue-action-icon cue-action-icon--narrow"
              variant="ghost"
              aria-label="Open Apply menu"
              aria-haspopup="menu"
              aria-expanded={applyMenuOpen}
              onClick={() => setApplyMenuOpen((open) => !open)}
              title="Save, Apply, or Discard"
            >
              <NavArrowDown width={15} height={15} aria-hidden="true" className={cn('transition-transform', applyMenuOpen && 'rotate-180')} />
            </ControlButton>
            {applyMenuOpen && (
              <CueApplyMenu
                onKeyDown={handleApplyMenuKeyDown}
                saving={saving}
                saveDisabled={saveDisabled}
                saveTitle={saving
                  ? 'Saving cue changes…'
                  : baselineProofRefreshNeeded && !dirty
                    ? 'Refresh verified cue baseline proof for this legacy draft'
                    : 'Save cue changes as a draft'}
                applyTrackDisabled={applyTrackDisabled}
                applyTrackTitle={applyTrackAvailable ? 'Apply only the selected track to local Rekordbox' : 'Apply Track requires a saved pending draft for the selected track'}
                applyAllDisabled={applyAllDisabled}
                applyAllCount={applyAllCount}
                applyAllTitle={applyAllCount > 0 ? `Apply all ${applyAllCount} saved track changes to local Rekordbox` : 'Apply All requires at least one saved draft that needs apply'}
                discardDisabled={discardDisabled}
                onSave={() => { closeApplyMenuAndRestoreFocus(); void onSave().then(setEditorMessage); }}
                onApplyTrack={() => { closeApplyMenuAndRestoreFocus(); onApplyTrack(); }}
                onApplyAll={() => { closeApplyMenuAndRestoreFocus(); onApplyAll(); }}
                onDiscard={() => { closeApplyMenuAndRestoreFocus(); onDiscard(); }}
              />
            )}
          </div>
        </div>
      </div>}

      {!audition && cueBaselineComplete && cueIntegrity && cueIntegrity.status !== 'valid' && (
        <div className="mx-5 mt-3 flex items-start justify-between gap-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2 text-amber-100" role="status">
          <div className="flex min-w-0 items-start gap-2">
            <WarningTriangle width={16} height={16} aria-hidden="true" className="mt-0.5 shrink-0" />
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

      <div className="cue-workstation__timeline">
        <div className="overflow-x-auto">
          <div className="min-w-[920px]">
            <TrackTimeline
              sectionMessage={phraseLoading ? (
                <div className="flex h-full items-center px-2 text-[11px] font-medium text-[#707b85]">Loading track sections…</div>
              ) : sections.length === 0 ? (
                <div className="absolute inset-0 flex items-center px-2">
                  <div className="h-[30px] w-full rounded-[5px] border border-white/[0.035] bg-white/[0.015]" />
                  <span className="absolute left-4 text-[10px] font-medium uppercase tracking-[0.12em] text-[#66717b]">
                    Sections unavailable
                  </span>
                </div>
              ) : undefined}
              sections={sections.map((section) => {
                const left = percentageAt(section.startMs, viewStart, effectiveViewEnd);
                const right = percentageAt(section.endMs, viewStart, effectiveViewEnd);
                return {
                  id: section.id,
                  label: section.label,
                  color: waveformSectionInk(section.label),
                  leftPercent: left,
                  widthPercent: Math.max(0, right - left),
                  title: `${section.label} · ${formatTime(section.startMs)}–${formatTime(section.endMs)}`,
                };
              })}
              start={viewStart} end={effectiveViewEnd} timeTicks={timeTicks}
              cues={<>
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
                  <div className="flex h-full items-center justify-center px-5 text-center text-[10px] font-medium uppercase tracking-[0.12em] text-[#5e6973]">
                    No cue points
                  </div>
                ) : (
                  <>
                    {positionedCues.map((cue) => {
                      const range = cueLoopRangeGeometry(cue, viewStart, effectiveViewEnd);
                      if (!range?.visible) return null;
                      return (
                        <span
                          key={`cue-loop-range-${cue.editorId}`}
                          data-testid="cue-loop-range"
                          className="pointer-events-none absolute bottom-[5px] top-[5px] z-10 rounded-[3px] border"
                          style={{
                            left: `${range.leftPercent}%`,
                            width: `${range.widthPercent}%`,
                            minWidth: '2px',
                            borderColor: `${cue.markerColor}AA`,
                            backgroundColor: `${cue.markerColor}24`,
                          }}
                          title={`${cueDisplayName(cue)} range · ${formatTime(cue.startMs)}–${formatTime(cue.endMs)}`}
                        >
                          <span className="absolute bottom-0 right-0 top-0 w-px" style={{ backgroundColor: cue.markerColor }} aria-hidden="true" />
                        </span>
                      );
                    })}
                    {positionedCues.map((cue) => {
                      const left = percentageAt(cue.startMs ?? 0, viewStart, effectiveViewEnd);
                      const { displayColor, markerColor } = cue;
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
                          style={{ left: `${left}%`, '--cue-ink': markerColor } as CSSProperties}
                          title={`${cueDisplayName(cue)} · ${formatTime(cue.startMs)}${cue.pointType === 'loop' ? `–${formatTime(cue.endMs)}` : ''} · ${cue.comment || 'No comment'} · ${displayColor.label} · ${summarizeCueProvenance(cue).sources}`}
                          aria-label={`${cueDisplayName(cue)} at ${formatTime(cue.startMs)}${cue.pointType === 'loop' ? ` through ${formatTime(cue.endMs)}` : ''}. ${audition ? 'Seek to cue point during playback.' : cueEditingAllowed ? 'Drag to reposition, click to edit, or press Delete to remove.' : 'Read-only because cue integrity is blocked.'}`}
                          disabled={audition && panelActiveTrack?.id !== track.id}
                          onClick={audition ? () => seekPlayback((cue.startMs ?? 0) / 1000) : undefined}
                          onFocus={() => setSelectedCueId(cue.editorId)}
                          onPointerDown={audition ? undefined : (event) => handleCuePointerDown(event, cue.editorId)}
                          onPointerMove={handleCuePointerMove}
                          onPointerUp={handleCuePointerUp}
                          onPointerCancel={handleCuePointerUp}
                          onContextMenu={audition ? undefined : (event) => handleCueContextMenu(event, cue.editorId)}
                          onKeyDown={(event) => {
                            if (cueEditingAllowed && (event.key === 'Delete' || event.key === 'Backspace')) {
                              event.preventDefault();
                              onDeleteCue(cue.editorId);
                              setSelectedCueId(null);
                              setEditorMessage(null);
                            }
                          }}
                        >
                        <WaveformCueMarker
                          className="pointer-events-none"
                          label={cue.markerLabel}
                          color={markerColor}
                          memory={cue.family === 'memory'}
                          selected={selected}
                          style={{ left: '50%' }}
                          aria-hidden="true"
                        />
                      </button>
                      );
                    })}
                  </>
                )}
              </>}
              waveforms={[{
                id: track.id, state: waveformState, colorSegments: waveformColorSegments,
                leftPercent: durationMs > 0 ? -viewStart / (effectiveViewEnd - viewStart) * 100 : 0,
                widthPercent: durationMs > 0 ? durationMs / (effectiveViewEnd - viewStart) * 100 : 100,
                onRetry: onRetryWaveform, ariaLabel: `Cue point waveform for ${track.title}`,
              }]}
              waveformRef={waveformDivRef}
              waveformProps={{
                className: audition ? 'cursor-pointer' : 'cursor-crosshair',
                onClick: audition && panelActiveTrack?.id === track.id ? (event) => {
                  const requestedMs = timeAtClientX(event.clientX, event.currentTarget);
                  if (requestedMs != null) seekPlayback(requestedMs / 1000);
                } : undefined,
                onContextMenu: audition ? undefined : handleWaveformContextMenu,
                title: audition ? undefined : snapResolution !== 'off' ? `Right-click to add a ${cueSnapResolutionLabel(snapResolution)} snapped cue` : 'Right-click to add an exact millisecond cue',
              }}
              cueLines={positionedCues.map((cue) => ({ id: cue.editorId, leftPercent: percentageAt(cue.startMs ?? 0, viewStart, effectiveViewEnd), label: cue.markerLabel, color: cue.markerColor }))}
              waveformOverlay={<>
                {durationMs != null && durationMs > 0 && (
                  <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                    {activeSection && (() => {
                      const leftPct = percentageAt(activeSection.startMs, viewStart, effectiveViewEnd);
                      const rightPct = percentageAt(activeSection.endMs, viewStart, effectiveViewEnd);
                      return (
                        <span
                          className="absolute bottom-0 top-0 border border-white/15 bg-white/[0.025]"
                          style={{ left: `${leftPct}%`, width: `${Math.max(0, rightPct - leftPct)}%` }}
                        />
                      );
                    })()}
                    {effectiveViewEnd - viewStart < durationMs && gridLines.map((beat) => (
                      <span
                        key={`wave-grid-${beat.seq}`}
                        className={cn(
                          'absolute bottom-0 top-0 border-l border-dashed',
                          beat.isDownbeat || beat.beatInBar === 1 ? 'border-white/[0.10]' : 'border-white/[0.035]',
                        )}
                        style={{ left: `${percentageAt(beat.ms, viewStart, effectiveViewEnd)}%` }}
                      />
                    ))}
                    {gridVisible && effectiveViewEnd - viewStart < durationMs && sections.slice(1).map((section) => (
                      <span
                        key={`section-boundary-${section.id}`}
                        className="absolute bottom-0 top-0 w-px bg-white/[0.16]"
                        style={{ left: `${percentageAt(section.startMs, viewStart, effectiveViewEnd)}%` }}
                      />
                    ))}
                    {positionedCues.map((cue) => {
                      const { markerColor } = cue;
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
              </>}
              waveformControls={
              <WaveformZoomControls
                onZoomIn={() => handleZoom(0.75)}
                onZoomOut={() => handleZoom(1 / 0.75)}
                canZoomIn={zoom.canZoomIn}
                canZoomOut={zoom.canZoomOut}
              />
              }
                beatMessage={!gridVisible ? (
                  <div className="flex h-full items-center px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[#5e6973]">Grid hidden</div>
                ) : beatGridLoading ? (
                  <div className="flex h-full items-center px-2 text-[11px] font-medium text-[#707b85]">Loading beat grid…</div>
                ) : durationMs == null || rulerTicks.length === 0 ? (
                  <div className="flex h-full items-center px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[#5e6973]">
                    No beat grid
                  </div>
                ) : undefined}
                beatTicks={rulerTicks.map((beat) => ({
                  key: `ruler-${beat.seq}`,
                  leftPercent: percentageAt(beat.ms, viewStart, effectiveViewEnd),
                  downbeat: beat.isDownbeat || beat.beatInBar === 1,
                  title: `Bar ${beat.bar}, beat ${beat.beatInBar} · ${formatTime(beat.ms)}`,
                }))}
                beatLabels={rulerLabels.map((beat) => ({
                  key: `bar-label-${beat.seq}`,
                  leftPercent: percentageAt(beat.ms, viewStart, effectiveViewEnd),
                  text: beat.bar,
                }))}
              overlay={<CueEditorPlaybackPlayhead trackId={track.id} viewStartMs={viewStart} viewEndMs={effectiveViewEnd} />}
            />
          </div>
        </div>
      </div>

      {!audition && selectedCue && (
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

      {!audition && contextMenu && (
        <div
          className="fixed inset-0 z-[80]"
          onPointerDown={() => setContextMenu(null)}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div
            role="menu"
            aria-label={contextMenu.kind === 'add' ? 'Add cue' : 'Cue actions'}
            className="fixed min-w-[190px] overflow-hidden dd-popup-surface p-1.5"
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

/** Focused, read-only use of the production Cue Points timeline for track details. */
export function CuePointsTrackPanel({ track, waveformState, onRetryWaveform }: {
  track: RekordboxTrack;
  waveformState: WaveformLoadState;
  onRetryWaveform?: () => void;
}) {
  const auth = useAuthSession();
  const userId = auth.status === 'authenticated' ? auth.session.user.id : null;
  const [beatGrid, setBeatGrid] = useState<BeatGridRow | null>(null);
  const [phrases, setPhrases] = useState<PhraseRow[]>([]);
  const [cues, setCues] = useState<WorkingCue[]>([]);
  const [loading, setLoading] = useState(true);
  const [cueStatus, setCueStatus] = useState<SelectedCueLoadStatus>('loading');
  const [cueError, setCueError] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [gridDisplayMode, setGridDisplayMode] = useState<CueGridDisplayMode>('beats');
  const [gridVisible, setGridVisible] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setCueStatus('loading');
    setBeatGrid(null);
    setPhrases([]);
    setCues([]);
    setCueError(null);
    setAnalysisError(null);
    void Promise.allSettled([
      fetchTrackBeatGrid(track.id),
      fetchTrackPhrases(track.id),
      loadCueEditorBaseline(track, userId),
    ]).then(([gridResult, phraseResult, cueResult]) => {
      if (cancelled) return;
      if (gridResult.status === 'fulfilled') setBeatGrid(gridResult.value);
      if (phraseResult.status === 'fulfilled') setPhrases(phraseResult.value);
      if (gridResult.status === 'rejected' || phraseResult.status === 'rejected') {
        setAnalysisError('Some beat grid or track section data could not be loaded.');
      }
      if (cueResult.status === 'fulfilled' && cueResult.value.status !== 'failed') {
        setCues(cueResult.value.workingCues);
        setCueStatus(cueResult.value.status);
      } else {
        setCueStatus('failed');
        setCueError(cueResult.status === 'fulfilled' ? cueResult.value.status === 'failed' ? cueResult.value.error : null : 'Cue points could not be loaded.');
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [track, userId, retry]);

  const retryAnalysis = () => setRetry((value) => value + 1);
  const noop = () => {};
  return (
    <section className="studio-surface cue-studio cue-track-panel" aria-label="Track timeline">
      <CueWaveformPanel audition track={track} beatGrid={beatGrid} cues={cues} phrases={phrases}
        cueLoading={loading} cueLoadStatus={cueStatus} cueLoadError={cueError} cueIntegrity={null}
        beatGridLoading={loading} phraseLoading={loading} waveformState={waveformState}
        dirty={false} draftStatus="Original" baselineProofRefreshNeeded={false} saving={false}
        persistenceMessage={null} editingBlockedReason={null} onRetryCues={retryAnalysis}
        onRetryWaveform={onRetryWaveform ?? noop} onAddCue={() => null} onMoveCue={() => null}
        onEditCue={() => null} onDeleteCue={noop} onDiscard={noop} onAutoCue={() => null}
        onSave={async () => null} applyTrackAvailable={false} applyAllCount={0} applying={false}
        onApplyTrack={noop} onApplyAll={noop} pendingMetadataCount={0} metadataDraftLoadStatus="loaded"
        onOpenPendingChanges={noop} snapResolution="off" onSnapResolutionChange={noop}
        gridDisplayMode={gridDisplayMode} onGridDisplayModeChange={setGridDisplayMode} gridVisible={gridVisible} onGridVisibleChange={setGridVisible} />
      {analysisError && <div role="status" className="flex items-center justify-between gap-3 px-5 py-2 text-xs text-muted-foreground">
        <span>{analysisError}</span><ControlButton variant="ghost" onClick={retryAnalysis}>Retry analysis</ControlButton>
      </div>}
    </section>
  );
}

export function CuePointsView({ importId, onImport, mode = 'cues', onTrackOpen, onSelectedTrackChange }: CuePointsViewProps) {
  const artistLibrary = mode === 'artist-library';
  const audition = mode !== 'cues';
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
  const [genreEditAnchor, setGenreEditAnchor] = useState<HTMLElement | null>(null);
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
  const [snapResolution, setSnapResolution] = useState<CueSnapResolution>('1-beat');
  const [gridDisplayMode, setGridDisplayMode] = useState<CueGridDisplayMode>('beats');
  const [gridVisible, setGridVisible] = useState(true);
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
  const listingRef = useRef<HTMLDivElement>(null);
  // The record listing is the only thing that scrolls: it gets exactly the height left below everything above it, so nothing above it moves.
  const [listingMaxHeight, setListingMaxHeight] = useState<number | null>(null);
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

  const activeSourceTrackIds = useMemo(() => activeSourceTracks.map((track) => track.id), [activeSourceTracks]);
  const playlistCounts = useTrackPlaylistCounts(activeSourceTrackIds);
  const cloudSynced = useSyncedPreviewKeys(artistLibrary);

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

  const sortedTracks = useMemo(() => sortRecordTracks(filteredTracks,
    sortCol ? { column: sortCol, direction: sortDir } : null, playlistCounts.counts),
    [filteredTracks, sortCol, sortDir, playlistCounts.counts]);

  // Stage 3 consumes this derived list for Previous/Next playback. It intentionally
  // follows the active source, current playlist, filters, sort order, and only the
  // records currently loaded by the existing query hooks.
  const orderedVisibleTracks = sortedTracks;
  useAudioDockTracks(orderedVisibleTracks, selectedTrack, setSelectedTrack);

  const cueSummaryFailureCount = useMemo(
    () => [...cueSummaryStates.values()].filter((state) => state.status === 'failed').length,
    [cueSummaryStates],
  );

  function handleColClick(col: string) {
    if (sortCol === col) {
      if (sortDir === 'asc') setSortDir('desc');
      else setSortDir('asc');
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

  // Every page starts with its first track selected (the Library page included).
  useEffect(() => {
    if (selectedTrackId == null && orderedVisibleTracks.length > 0) {
      setSelectedTrack(orderedVisibleTracks[0]);
    }
  }, [orderedVisibleTracks, selectedTrackId]);

  const selectedTrackChangeRef = useRef(onSelectedTrackChange);
  selectedTrackChangeRef.current = onSelectedTrackChange;
  useEffect(() => {
    if (artistLibrary) selectedTrackChangeRef.current?.(selectedTrack);
  }, [artistLibrary, selectedTrack]);

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

  useEffect(() => {
    const measure = () => {
      const el = listingRef.current;
      if (!el) return;
      setListingMaxHeight(Math.max(280, Math.floor(window.innerHeight - el.getBoundingClientRect().top - 16)));
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    if (filterRowRef.current) observer.observe(filterRowRef.current);
    return () => { window.removeEventListener('resize', measure); observer.disconnect(); };
  }, [waveformPanelHeight, filterRowHeight, importId]);

  if (!importId) {
    return (
      <div className="mx-auto max-w-3xl pt-8">
        <div className="border-y border-[var(--color-border-faint)] bg-[var(--color-card)]/55 p-8 text-center">
          <MusicNote width={48} height={48} aria-hidden="true" className="mx-auto mb-4 text-secondary opacity-60" />
          <h2 className="text-2xl font-black">{audition ? 'Audition' : 'Cue Points'}</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
            Import a Rekordbox library to preview waveforms, beat grids, and existing cue points.
          </p>
          <ControlButton variant="primary" className="mt-5" onClick={onImport}>
            <Upload width={16} height={16} aria-hidden="true" /> Import library
          </ControlButton>
        </div>
      </div>
    );
  }

  const renderGenreCell = (track: RekordboxTrack) => {
    const genreDraft = genreDraftsByTrackId.get(track.id) ?? null;
    const effectiveGenre = genreDraft ? genreDraft.pendingValue : track.genre;
    const genreEditingDirty = editingGenreTrackId === track.id
      && normalizeGenreMetadataDraftValue(editingGenreValue) !== normalizeGenreMetadataDraftValue(effectiveGenre);
    const genreSaving = savingGenreTrackIds.has(track.id);
    const genreRecoveryLocked = Boolean(genreDraft && isTrackMetadataDraftRecoveryLocked(genreDraft));
    const genreRuntimeBlocked = Boolean(metadataCloudOutcome && metadataCloudOutcome.state !== 'finalized');
    const genreEditingAvailable = metadataDraftLoadStatus === 'loaded' && !genreRecoveryLocked && !genreRuntimeBlocked;
    return audition ? (
      <span className="block min-w-0 whitespace-normal [overflow-wrap:anywhere]">{effectiveGenre ?? '—'}</span>
    ) : (
      <>
                            <div
                              className="group flex min-w-0 flex-wrap items-center gap-1.5"
                            >
                              <span className="block min-w-0 flex-1 whitespace-normal [overflow-wrap:anywhere]">{effectiveGenre ?? '—'}</span>
                              {genreDraft && (
                                <span
                                  className="max-w-full break-words rounded-full border border-amber-300/25 bg-amber-300/[0.08] px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide text-amber-200"
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
                                className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-foreground transition-all disabled:cursor-not-allowed disabled:opacity-20 group-hover:disabled:opacity-20"
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
                                  setGenreEditAnchor(e.currentTarget.closest('td'));
                                  setEditingGenreTrackId(track.id);
                                  setEditingGenreValue(effectiveGenre ?? '');
                                  setGenreSaveError(null);
                                }}
                              >
                                <EditPencil width={12} height={12} aria-hidden="true" />
                              </button>
                            </div>
        {editingGenreTrackId === track.id && genreEditAnchor && (
          <GenreEditPopover anchor={genreEditAnchor} onClose={() => {
            if (genreSaving) return;
            setEditingGenreTrackId(null);
            setGenreSaveError(null);
          }}>
            <GenreEditorContent
              title={track.title}
              value={editingGenreValue}
              maxLength={REKORDBOX_GENRE_MAX_LENGTH}
              dirty={genreEditingDirty}
              saving={genreSaving}
              available={genreEditingAvailable}
              error={genreSaveError?.trackId === track.id ? genreSaveError : null}
              onChange={(next) => {
                setEditingGenreValue(next);
                setGenreSaveError((current) => current?.trackId === track.id ? null : current);
              }}
              onSave={() => { void saveInlineGenreDraft(track); }}
              onCancel={() => {
                setEditingGenreTrackId(null);
                setGenreSaveError((current) => current?.trackId === track.id ? null : current);
              }}
              onReload={() => setMetadataDraftRetryNonce((value) => value + 1)}
            />
          </GenreEditPopover>
        )}
      </>
    );
  };

  return (
    <div className={cn('flex w-full flex-col pb-10', mode === 'audition' ? 'gap-1' : 'gap-4', mode === 'cues' && 'studio-surface', mode !== 'audition' && 'cue-studio')} data-testid={mode === 'cues' ? 'cue-studio' : undefined}>
      {!audition && <PendingMetadataChangesReview
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
      />}

      {!artistLibrary && <div ref={waveformPanelWrapperRef} className="cue-studio__sticky sticky top-0 z-30 bg-[var(--color-background)]">
      <CueWaveformPanel
        audition={audition}
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
        snapResolution={snapResolution}
        onSnapResolutionChange={setSnapResolution}
        gridDisplayMode={gridDisplayMode}
        onGridDisplayModeChange={setGridDisplayMode}
        gridVisible={gridVisible}
        onGridVisibleChange={setGridVisible}
      />
      </div>}

      {!audition && (applyPreflight || applyResult || applyMessage || applyDraftLoadError || applyRebaseRecovery) && (
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

      <section className={cn('cue-browser', artistLibrary ? 'artist-library-browser' : 'border-y border-[var(--color-border-faint)]')} style={{ overflow: 'clip' }}>
        <div ref={filterRowRef} className="cue-browser__chrome sticky z-20 border-b border-[var(--color-border-faint)]" style={{ top: waveformPanelHeight }}>
          <div className="flex flex-col">
            <div className="cue-browser__filters flex flex-wrap items-stretch gap-x-5 gap-y-2.5 border-t border-[var(--color-border-faint)] px-4 py-2.5 md:px-5" data-testid="cue-browser-filters">
              {!artistLibrary && mode !== 'audition' && <TrackSourceTabs value={browserSource} onChange={setBrowserSource} />}


              <div className="flex min-w-[200px] max-w-[320px] flex-1 flex-col justify-end" data-testid="cue-browser-search">
                <SearchControl
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search title, artist, or genre…"
                  aria-label={artistLibrary ? 'Search artist library tracks' : audition ? 'Search audition tracks' : 'Search cue point tracks'}
                />
              </div>
              <FilterDropdown
                label="Status"
                value={statusFilter}
                onChange={(v) => setStatusFilter(v as StatusFilter)}
                className="cue-browser__filter min-w-[90px]"
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'ready', label: 'Ready' },
                  { value: 'partial', label: 'Partial' },
                  { value: 'errored', label: 'Errored' },
                  { value: 'pending', label: 'Pending' },
                ]}
              />
              <FilterDropdown
                label="Genre"
                value={genre}
                onChange={setGenre}
                searchable
                className="cue-browser__filter cue-browser__filter--genre min-w-[100px]"
                options={[
                  { value: '', label: 'All' },
                  ...(stats?.genreTotals ?? []).map((item) => ({ value: item.name, label: `${item.name} (${item.count})` })),
                ]}
              />
              <FilterDropdown
                label="Key"
                value={keyFilter}
                onChange={setKeyFilter}
                className="cue-browser__filter cue-browser__filter--key"
                options={[
                  { value: '', label: 'All' },
                  ...(stats?.keyTotals ?? []).map((item) => ({ value: item.name, label: `${item.name} (${item.count})` })),
                ]}
              />
              <FilterDropdown
                label="Cue States"
                value={cueFilter}
                onChange={(v) => setCueFilter(v as CueFilter)}
                className="cue-browser__filter cue-browser__filter--cues"
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'with-cues', label: 'Has cues' },
                  { value: 'without-cues', label: 'No cues' },
                ]}
              />
              <FilterDropdown
                label="Analysis"
                value={analysisFilter}
                onChange={(v) => setAnalysisFilter(v as AnalysisFilter)}
                className="cue-browser__filter cue-browser__filter--analysis min-w-[90px]"
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'ready', label: 'Analysis ready' },
                  { value: 'incomplete', label: 'Needs analysis' },
                ]}
              />
              <DualRangeSlider variant="inline"
                bounds={bpmBounds}
                value={bpmRange ?? bpmBounds}
                onChange={setBpmRange}
                onReset={() => setBpmRange(null)}
              />
              {browserSource === 'playlists' && (
                <div className="flex min-w-[220px] max-w-[360px] flex-1 flex-col justify-end" data-testid="cue-browser-playlist-selector">
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

        {!audition && metadataDraftLoadStatus === 'loading' && userId && importId && (
          <div className="flex items-center gap-2 border-b border-[var(--color-border-faint)] bg-white/[0.02] px-5 py-2.5 text-xs text-muted-foreground" role="status">
            <Refresh className="animate-spin" width={14} height={14} aria-hidden="true" />
            Loading pending Genre changes…
          </div>
        )}

        {!audition && metadataDraftLoadError && (
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
            <WarningTriangle width={20} height={20} aria-hidden="true" />
            <span>{activeSourceError}</span>
          </div>
        ) : activeSourceLoading ? (
          <div className="flex items-center justify-center gap-3 py-16 text-sm text-muted-foreground">
            <Refresh className="animate-spin text-control-primary" width={22} height={22} aria-hidden="true" />
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
            <div ref={listingRef}>
            <RecordTrackListing<RekordboxTrack>
              tracks={orderedVisibleTracks}
              selectedId={selectedTrackId}
              onSelect={setSelectedTrack}
              importId={importId}
              getWaveformState={getWaveformState}
              cueStates={cueSummaryStates}
              playlistCounts={playlistCounts}
              renderGenre={renderGenreCell}
              getActions={(track) => [
                { id: 'cues', label: 'Cue points', hint: cueLoadCount(cueSummaryStates.get(track.id)) ?? '—' },
                { id: 'sample-rate', label: 'Sample rate', hint: track.sample_rate_hz ? (track.sample_rate_hz / 1000) + ' kHz' : '—' },
                { id: 'bit-rate', label: 'Bit rate', hint: track.bitrate_kbps ? track.bitrate_kbps + ' kbps' : '—' },
                ...(artistLibrary ? [{
                  id: 'cloud', label: 'Cloud preview',
                  hint: <CloudSyncIcon synced={cloudSynced.keys.has(trackIdentityKey(track))} unknown={cloudSynced.failed} />,
                }] : []),
              ]}
              rowKey={(track, rowIndex) => `${browserSource}:${selectedPlaylistId ?? 'library'}:${track.id}:${rowIndex}`}
              rowProps={(track) => ({
                // On the Artist Library page a click selects the track (its waveform shows above), and a double-click or Enter opens it.
                onDoubleClick: artistLibrary ? () => onTrackOpen?.(track) : undefined,
                onKeyDown: (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    if (artistLibrary && event.key === 'Enter') onTrackOpen?.(track);
                    else setSelectedTrack(track);
                  }
                },
              })}
              sort={sortCol ? { column: sortCol, direction: sortDir } : null}
              onSort={(column) => handleColClick(column as typeof sortCol & string)}
              scrollStyle={{ maxHeight: listingMaxHeight ?? `calc(100vh - ${waveformPanelHeight + filterRowHeight + 16}px)` }}
              tableTestId="cue-browser-track-table"
              ariaLabel="Cue Points browser tracks"
            />
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
