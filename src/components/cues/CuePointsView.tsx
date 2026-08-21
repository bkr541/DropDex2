import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CircleDash, Music, Upload, WarningAlt } from '@carbon/icons-react';
import { AudioWaveform, Bookmark, Grip, List } from 'lucide-react';
import { cn, formatKey } from '../../lib/utils';
import { isUsableBeatGrid } from '../../lib/music/beatGridHelpers';
import { applyAutoCueStrategy } from '../../lib/music/autoCueStrategy';
import {
  addWorkingCue,
  deleteWorkingCue,
  moveWorkingCue,
  nextAvailableHotCueSlot,
  isCurrentTrackResponse,
  normalizeImportedCues,
  workingCueSetsEqual,
  type WorkingCue,
} from '../../lib/music/cueEditorState';
import { useLibraryStats, useLibraryTracks } from '../../hooks/useRekordboxTracks';
import { useTrackPreviewWaveforms } from '../../hooks/useTrackPreviewWaveforms';
import { useRouteImport } from '../../hooks/useRouteEntities';
import { useAuthSession } from '../../hooks/useAuthSession';
import {
  fetchTrackBeatGrid,
  fetchTrackCues,
  fetchTrackPhrases,
  fetchTracksCues,
  type BeatEntry,
  type BeatGridRow,
  type CueRow,
  type PhraseRow,
} from '../../lib/queries/analysisData';
import { RekordboxPreviewWaveform, type WaveformColorSegment } from '../library/RekordboxPreviewWaveform';
import type { WaveformLoadState } from '../../lib/queries/waveformValidation';
import { ControlButton, SearchControl, SelectControl } from '../ui/controls';
import { useTheme } from '../../theme/ThemeProvider';
import type { RekordboxTrack } from '../../types';
import {
  createCueDraftDocument,
  cueDraftStrategySummary,
  fingerprintCueDraftDocument,
  hydrateCueDraftDocument,
} from '../../lib/cues/cueDraftDocument';
import {
  CueDraftRevisionConflictError,
  fetchCueDraft,
  fetchCueDraftsForApply,
  markCueDraftApplied,
  saveCueDraft,
  type CueDraftRow,
} from '../../lib/queries/cueDrafts';
import type { DesktopCueApplyPreflightResult, DesktopCueApplyResult } from '../../types/dropdex-desktop';

interface CuePointsViewProps {
  importId: string | null;
  onImport: () => void;
}

type CueFilter = 'all' | 'with-cues' | 'without-cues';
type AnalysisFilter = 'all' | 'ready' | 'incomplete';
type CueDraftStatus = 'Original' | 'Unsaved' | 'Saved' | 'Needs Apply' | 'Applied';

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
  const slot = cue.hotCueSlot;
  if (slot != null && slot >= 1 && slot <= 8) return String.fromCharCode(64 + slot);
  return 'H';
}

function cueDisplayName(cue: WorkingCue): string {
  const family = cue.family === 'hot' ? `Hot Cue ${cueLabel(cue)}` : 'Memory Cue';
  return cue.pointType === 'loop' ? `${family} Loop` : family;
}

function cueTimelineLabel(cue: WorkingCue, memoryIndex: number): string {
  if (cue.family === 'hot') return `Cue ${cueLabel(cue)}`;
  return `Memory ${memoryIndex + 1}`;
}

function analysisReady(track: RekordboxTrack): boolean {
  return track.analysis_parse_status === 'completed' || track.analysis_parse_status === 'reused';
}

function analysisLabel(track: RekordboxTrack): string {
  switch (track.analysis_parse_status) {
    case 'completed': return 'Ready';
    case 'reused': return 'Reused';
    case 'partial': return 'Partial';
    case 'failed': return 'Failed';
    case 'missing_required': return 'Missing';
    case 'parsing': return 'Parsing';
    case 'queued': return 'Queued';
    default: return 'Pending';
  }
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

type CueContextMenuState =
  | { kind: 'add'; x: number; y: number; requestedMs: number }
  | { kind: 'cue'; x: number; y: number; cueId: string };

function CueWaveformPanel({
  track,
  beatGrid,
  cues,
  phrases,
  cueLoading,
  beatGridLoading,
  phraseLoading,
  waveformState,
  dirty,
  draftStatus,
  saving,
  persistenceMessage,
  onRetryWaveform,
  onAddCue,
  onMoveCue,
  onDeleteCue,
  onDiscard,
  onAutoCue,
  onSave,
  applyAvailable,
  applying,
  onApply,
}: {
  track: RekordboxTrack | null;
  beatGrid: BeatGridRow | null;
  cues: WorkingCue[];
  phrases: PhraseRow[];
  cueLoading: boolean;
  beatGridLoading: boolean;
  phraseLoading: boolean;
  waveformState: WaveformLoadState;
  dirty: boolean;
  draftStatus: CueDraftStatus;
  saving: boolean;
  persistenceMessage: string | null;
  onRetryWaveform: () => void;
  onAddCue: (family: 'hot' | 'memory', requestedMs: number) => string | null;
  onMoveCue: (cueId: string, requestedMs: number) => string | null;
  onDeleteCue: (cueId: string) => void;
  onDiscard: () => void;
  onAutoCue: () => string | null;
  onSave: () => Promise<string | null>;
  applyAvailable: boolean;
  applying: boolean;
  onApply: () => void;
}) {
  const { theme } = useTheme();
  const durationMs = durationMsForTrack(track, beatGrid, phrases);

  const [viewStart, setViewStart] = useState(0);
  const [viewEnd, setViewEnd] = useState<number | null>(null);
  const [selectedCueId, setSelectedCueId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<CueContextMenuState | null>(null);
  const [editorMessage, setEditorMessage] = useState<string | null>(null);
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
    if (!contextMenu) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [contextMenu]);

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
  const autoCueReady = Boolean(
    track
    && !cueLoading
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
    if (beatGridLoading) {
      setContextMenu(null);
      setEditorMessage('Cue editing will be available when the Rekordbox beat grid finishes loading.');
      return;
    }
    if (!hasUsableGrid) {
      setContextMenu(null);
      setEditorMessage('Beat snapping is unavailable because this track has no valid Rekordbox beat grid.');
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
  }, [beatGridLoading, cueLoading, hasUsableGrid, timeAtClientX]);

  const handleCuePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>, cueId: string) => {
    if (event.button !== 0) return;
    setSelectedCueId(cueId);
    setContextMenu(null);
    dragStateRef.current = { cueId, pointerId: event.pointerId, startX: event.clientX, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handleCuePointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    if (!drag.moved && Math.abs(event.clientX - drag.startX) < 3) return;
    drag.moved = true;
    const lane = event.currentTarget.parentElement;
    if (!lane) return;
    const requestedMs = timeAtClientX(event.clientX, lane);
    if (requestedMs == null) return;
    const error = onMoveCue(drag.cueId, requestedMs);
    setEditorMessage(error);
  }, [onMoveCue, timeAtClientX]);

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
    setSelectedCueId(cueId);
    setContextMenu({ kind: 'cue', x: event.clientX, y: event.clientY, cueId });
  }, []);

  if (!track) {
    return (
      <section className="overflow-hidden rounded-3xl border border-[var(--color-border-subtle)] bg-[var(--color-panel)]">
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

  const keyDisplay = formatKey(track.musical_key);
  const bpmDisplay = track.bpm != null ? track.bpm.toFixed(2) : '—';
  const durationDisplay = formatTime(durationMs);

  return (
    <section className="overflow-hidden rounded-3xl border border-[var(--color-border-subtle)] bg-[var(--color-panel)] shadow-sm">
      <div className="flex flex-col gap-3 border-b border-[var(--color-border-subtle)] px-5 py-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-muted-foreground">{track.artist ?? 'Artist Not Stored'}</p>
          <h1 className="mt-1 truncate text-xl font-black tracking-tight md:text-2xl">{track.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            {[
              ['Beats', beatGridLoading ? '…' : beatGrid ? String(beatGrid.beat_count ?? beatGrid.beats.length) : '—'],
              ['Bars', beatGridLoading ? '…' : beatGrid ? String(beatGrid.bar_count ?? '—') : '—'],
              ['First Beat', beatGridLoading ? '…' : formatTime(beatGrid?.first_beat_ms ?? null)],
            ].map(([label, value]) => (
              <span key={label} className="inline-flex items-baseline gap-1.5">
                <span className="text-[8px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
                <strong className="font-mono text-[11px] font-black tabular-nums">{value}</strong>
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-stretch gap-2 xl:justify-end">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['BPM', bpmDisplay],
              ['Key', keyDisplay],
              ['Duration', durationDisplay],
              ['Cues', cueLoading ? '…' : String(cues.length)],
            ].map(([label, value]) => (
              <div key={label} className="min-w-[88px] rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2">
                <span className="block text-[8px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
                <span className="mt-1 block font-mono text-sm font-black tabular-nums">{value}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-muted-foreground"
              title="Cue draft state"
            >
              {draftStatus}
            </span>
            <ControlButton
              variant="surface"
              disabled={!autoCueReady}
              onClick={() => setEditorMessage(onAutoCue())}
              title={autoCueReady ? 'Generate deterministic A–H cue proposals' : "Auto Cue requires the selected track's exact beat grid and phrase data to finish loading"}
            >
              Auto Cue
            </ControlButton>
            <ControlButton variant="ghost" disabled={!dirty || cueLoading || saving} onClick={onDiscard}>Discard</ControlButton>
            <ControlButton
              variant="surface"
              disabled={!dirty || cueLoading || saving}
              onClick={() => { void onSave().then(setEditorMessage); }}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </ControlButton>
            <ControlButton
              variant="primary"
              disabled={!applyAvailable || applying}
              onClick={onApply}
              title={applyAvailable ? 'Preflight saved cue drafts before applying them to local Rekordbox' : 'Apply requires the Electron desktop app, the packaged bridge, and at least one saved draft that needs apply'}
            >
              {applying ? 'Applying…' : 'Apply to Rekordbox'}
            </ControlButton>
          </div>
        </div>
      </div>

      <div className="px-3 pb-2 pt-2 md:px-4">
        <div className="overflow-x-auto rounded-[18px]">
          <div className="min-w-[980px] rounded-[18px] border border-[#2a353e] bg-[#090e13] p-[7px] shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
            <div className="grid grid-cols-[174px_minmax(0,1fr)] gap-x-[5px] gap-y-[4px]" onWheel={handleWheel}>
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
                ) : positionedCues.length === 0 ? (
                  <div className="flex h-full items-center px-5 text-[10px] font-medium uppercase tracking-[0.12em] text-[#5e6973]">
                    No cue points
                  </div>
                ) : (
                  positionedCues.map((cue, index) => {
                    const left = percentageAt(cue.startMs ?? 0, viewStart, effectiveViewEnd);
                    const markerColor = cue.colorHex || (cue.family === 'hot' ? '#238df2' : '#9b5de5');
                    const memoryIndex = positionedCues.slice(0, index).filter((item) => item.family === 'memory').length;
                    const selected = selectedCueId === cue.editorId;
                    return (
                      <button
                        key={cue.editorId}
                        type="button"
                        className={cn(
                          'absolute top-0 bottom-0 z-20 w-10 -translate-x-1/2 cursor-ew-resize rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-white/70',
                          selected && 'bg-white/[0.05]',
                        )}
                        style={{ left: `${left}%` }}
                        title={`${cueDisplayName(cue)} · ${formatTime(cue.startMs)} · drag to reposition; right-click to delete`}
                        aria-label={`${cueDisplayName(cue)} at ${formatTime(cue.startMs)}. Drag to reposition or press Delete to remove.`}
                        onPointerDown={(event) => handleCuePointerDown(event, cue.editorId)}
                        onPointerMove={handleCuePointerMove}
                        onPointerUp={handleCuePointerUp}
                        onPointerCancel={handleCuePointerUp}
                        onContextMenu={(event) => handleCueContextMenu(event, cue.editorId)}
                        onKeyDown={(event) => {
                          if (event.key === 'Delete' || event.key === 'Backspace') {
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
                  })
                )}
              </div>

              <div className="h-[88px]">
                <TimelineLaneLabel icon={<AudioWaveform size={20} strokeWidth={2.25} />} label="Waveform" />
              </div>
              <div
                className="relative h-[88px] cursor-crosshair overflow-hidden rounded-[8px] border border-[#26313a] bg-[#0b1116]"
                onContextMenu={handleWaveformContextMenu}
                title="Right-click to add a beat-snapped cue"
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
                      const markerColor = cue.colorHex || (cue.family === 'hot' ? '#238df2' : '#9b5de5');
                      return (
                        <span
                          key={`wave-cue-${cue.editorId}`}
                          className="absolute bottom-0 top-0 w-px opacity-75"
                          style={{
                            left: `${percentageAt(cue.startMs ?? 0, viewStart, effectiveViewEnd)}%`,
                            backgroundColor: markerColor,
                            boxShadow: `0 0 5px ${markerColor}55`,
                          }}
                        />
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
                    const error = onAddCue('hot', contextMenu.requestedMs);
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
                    const error = onAddCue('memory', contextMenu.requestedMs);
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
  const [cueFilter, setCueFilter] = useState<CueFilter>('all');
  const [analysisFilter, setAnalysisFilter] = useState<AnalysisFilter>('all');
  const [selectedTrack, setSelectedTrack] = useState<RekordboxTrack | null>(null);
  const [importedCueBaseline, setImportedCueBaseline] = useState<WorkingCue[]>([]);
  const [savedCueBaseline, setSavedCueBaseline] = useState<WorkingCue[] | null>(null);
  const [draftRevision, setDraftRevision] = useState<number | null>(null);
  const [draftAppliedRevision, setDraftAppliedRevision] = useState<number | null>(null);
  const [draftAppliedFingerprint, setDraftAppliedFingerprint] = useState<string | null>(null);
  const [draftDesiredFingerprint, setDraftDesiredFingerprint] = useState<string | null>(null);
  const [draftPersistenceMessage, setDraftPersistenceMessage] = useState<string | null>(null);
  const [savingCueDraft, setSavingCueDraft] = useState(false);
  const [applyDrafts, setApplyDrafts] = useState<CueDraftRow[]>([]);
  const [applyBridgeAvailable, setApplyBridgeAvailable] = useState(false);
  const [applyBridgeReason, setApplyBridgeReason] = useState<string | null>(null);
  const [applyPreflight, setApplyPreflight] = useState<DesktopCueApplyPreflightResult | null>(null);
  const [applySnapshot, setApplySnapshot] = useState<CueDraftRow[]>([]);
  const [applyResult, setApplyResult] = useState<DesktopCueApplyResult | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const applyGenerationRef = useRef(0);
  const [workingCues, setWorkingCues] = useState<WorkingCue[]>([]);
  const [selectedCueLoading, setSelectedCueLoading] = useState(false);
  const [cueRowsByTrackId, setCueRowsByTrackId] = useState<Map<string, CueRow[]>>(new Map());
  const [cueSummaryLoading, setCueSummaryLoading] = useState(false);
  const [beatGrid, setBeatGrid] = useState<BeatGridRow | null>(null);
  const [beatGridLoading, setBeatGridLoading] = useState(false);
  const [phrases, setPhrases] = useState<PhraseRow[]>([]);
  const [phraseLoading, setPhraseLoading] = useState(false);
  const manualCueSequenceRef = useRef(0);
  const selectedTrackIdRef = useRef<string | null>(null);
  const selectedUserIdRef = useRef<string | null>(null);
  const workingCuesRef = useRef<WorkingCue[]>([]);
  const cueDraftLoadRequestRef = useRef(0);
  const cueDraftSaveRequestRef = useRef(0);
  const cueDraftSaveInFlightRef = useRef(false);

  const selectedTrackId = selectedTrack?.id ?? null;
  selectedTrackIdRef.current = selectedTrackId;
  selectedUserIdRef.current = userId;
  workingCuesRef.current = workingCues;
  const { stats } = useLibraryStats(importId);
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
      setCueRowsByTrackId(new Map());
      setCueSummaryLoading(false);
      return;
    }

    setCueSummaryLoading(true);
    void fetchTracksCues(trackIds)
      .then((next) => {
        if (!cancelled) setCueRowsByTrackId(next);
      })
      .catch(() => {
        if (!cancelled) setCueRowsByTrackId(new Map(trackIds.map((id) => [id, []])));
      })
      .finally(() => {
        if (!cancelled) setCueSummaryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [importId, trackIdsKey]);

  const filteredTracks = useMemo(() => tracks.filter((track) => {
    const cueCount = cueRowsByTrackId.get(track.id)?.length ?? 0;
    if (cueFilter === 'with-cues' && cueCount === 0) return false;
    if (cueFilter === 'without-cues' && cueCount > 0) return false;
    if (analysisFilter === 'ready' && !analysisReady(track)) return false;
    if (analysisFilter === 'incomplete' && analysisReady(track)) return false;
    return true;
  }), [analysisFilter, cueFilter, cueRowsByTrackId, tracks]);

  useEffect(() => {
    setSelectedTrack(null);
    setImportedCueBaseline([]);
    setSavedCueBaseline(null);
    setDraftRevision(null);
    setDraftAppliedRevision(null);
    setDraftAppliedFingerprint(null);
    setDraftDesiredFingerprint(null);
    setDraftPersistenceMessage(null);
    setSavingCueDraft(false);
    cueDraftSaveInFlightRef.current = false;
    applyGenerationRef.current += 1;
    setApplyPreflight(null);
    setApplySnapshot([]);
    setApplyResult(null);
    setApplyMessage(null);
    setWorkingCues([]);
    setSelectedCueLoading(false);
    setBeatGrid(null);
    setBeatGridLoading(false);
    setPhrases([]);
    setPhraseLoading(false);
  }, [importId, userId]);

  useEffect(() => {
    let cancelled = false;
    const requestId = ++cueDraftLoadRequestRef.current;
    const requestedTrack = selectedTrack;
    const requestedTrackId = selectedTrackId;
    const requestedUserId = userId;

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
      setDraftPersistenceMessage(null);
      setWorkingCues([]);
      setSelectedCueLoading(false);
      return;
    }

    const responseIsCurrent = () => (
      !cancelled
      && cueDraftLoadRequestRef.current === requestId
      && isCurrentTrackResponse(selectedTrackIdRef.current, requestedTrackId)
      && selectedUserIdRef.current === requestedUserId
    );

    setImportedCueBaseline([]);
    setSavedCueBaseline(null);
    setDraftRevision(null);
    setDraftAppliedRevision(null);
    setDraftAppliedFingerprint(null);
    setDraftDesiredFingerprint(null);
    setDraftPersistenceMessage(null);
    setWorkingCues([]);
    setSelectedCueLoading(true);

    void fetchTrackCues(requestedTrackId)
      .then(async (rows) => {
        if (!responseIsCurrent()) return;
        const imported = normalizeImportedCues(requestedTrackId, rows);
        setImportedCueBaseline(imported);
        setWorkingCues(imported);

        if (!requestedUserId) return;
        try {
          const draft = await fetchCueDraft(requestedUserId, requestedTrackId);
          if (!responseIsCurrent() || !draft) return;
          if (
            draft.importId !== requestedTrack.import_id
            || draft.rekordboxContentId !== requestedTrack.rekordbox_content_id
            || draft.desiredDocument.importId !== requestedTrack.import_id
            || draft.desiredDocument.trackId !== requestedTrackId
            || draft.desiredDocument.rekordboxContentId !== requestedTrack.rekordbox_content_id
          ) {
            throw new Error('Saved cue draft identity does not match the selected Rekordbox track.');
          }
          const hydrated = hydrateCueDraftDocument(draft.desiredDocument);
          setSavedCueBaseline(hydrated);
          setDraftRevision(draft.revision);
          setDraftAppliedRevision(draft.appliedRevision);
          setDraftAppliedFingerprint(draft.appliedFingerprint);
          setDraftDesiredFingerprint(draft.desiredFingerprint);
          setWorkingCues(hydrated);
        } catch (error) {
          if (!responseIsCurrent()) return;
          setDraftPersistenceMessage(
            error instanceof Error
              ? `Saved cue draft could not be loaded: ${error.message}`
              : 'Saved cue draft could not be loaded.',
          );
        }
      })
      .catch((error) => {
        if (!responseIsCurrent()) return;
        setImportedCueBaseline([]);
        setSavedCueBaseline(null);
        setDraftRevision(null);
        setDraftAppliedRevision(null);
        setDraftAppliedFingerprint(null);
        setDraftDesiredFingerprint(null);
        setWorkingCues([]);
        setDraftPersistenceMessage(
          error instanceof Error
            ? `Imported cue baseline could not be loaded: ${error.message}`
            : 'Imported cue baseline could not be loaded.',
        );
      })
      .finally(() => {
        if (responseIsCurrent()) setSelectedCueLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTrack, selectedTrackId, userId]);

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

  const selectedTrackIds = useMemo(() => selectedTrackId ? [selectedTrackId] : [], [selectedTrackId]);
  const {
    getState: getWaveformState,
    retry: retryWaveform,
  } = useTrackPreviewWaveforms(importId, selectedTrackIds);
  const waveformState = getWaveformState(selectedTrackId);
  const discardBaseline = savedCueBaseline ?? importedCueBaseline;
  const workingCuesDirty = useMemo(
    () => !workingCueSetsEqual(discardBaseline, workingCues),
    [discardBaseline, workingCues],
  );
  const cueDraftStatus = useMemo<CueDraftStatus>(() => {
    if (workingCuesDirty) return 'Unsaved';
    if (!savedCueBaseline) return 'Original';
    if (workingCueSetsEqual(importedCueBaseline, savedCueBaseline)) return 'Saved';
    if (draftRevision != null && draftAppliedRevision === draftRevision && draftAppliedFingerprint === draftDesiredFingerprint) return 'Applied';
    return 'Needs Apply';
  }, [draftAppliedFingerprint, draftAppliedRevision, draftDesiredFingerprint, draftRevision, importedCueBaseline, savedCueBaseline, workingCuesDirty]);

  const refreshApplyDrafts = useCallback(async (): Promise<CueDraftRow[]> => {
    if (!userId || !importId) {
      setApplyDrafts([]);
      return [];
    }
    const rows = await fetchCueDraftsForApply(userId, importId);
    setApplyDrafts(rows);
    return rows;
  }, [importId, userId]);

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
      return;
    }
    void fetchCueDraftsForApply(userId, importId)
      .then((rows) => { if (!cancelled) setApplyDrafts(rows); })
      .catch((error) => { if (!cancelled) setApplyMessage(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, [draftRevision, importId, userId]);

  const desktopDrafts = useCallback((rows: CueDraftRow[]) => rows.map((row) => ({
    importId: row.importId,
    trackId: row.trackId,
    rekordboxContentId: row.rekordboxContentId,
    revision: row.revision,
    desiredFingerprint: row.desiredFingerprint,
    importedBaselineFingerprint: row.importedBaselineFingerprint,
    desiredDocument: row.desiredDocument as unknown as Record<string, unknown>,
  })), []);

  const handleApplyPreflight = useCallback(async () => {
    const desktop = window.dropdexDesktop;
    if (!desktop?.isElectron || !applyBridgeAvailable || !userId || !importId) return;
    const generation = ++applyGenerationRef.current;
    setApplyBusy(true);
    setApplyMessage(null);
    setApplyResult(null);
    try {
      const rows = await refreshApplyDrafts();
      if (rows.length === 0) {
        setApplyMessage('No saved cue drafts currently need to be applied.');
        return;
      }
      const result = await desktop.cueApplyPreflight(desktopDrafts(rows));
      if (generation !== applyGenerationRef.current || selectedUserIdRef.current !== userId) return;
      setApplySnapshot(rows);
      setApplyPreflight(result);
    } catch (error) {
      if (generation === applyGenerationRef.current) setApplyMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (generation === applyGenerationRef.current) setApplyBusy(false);
    }
  }, [applyBridgeAvailable, desktopDrafts, importId, refreshApplyDrafts, userId]);

  const handleConfirmApply = useCallback(async () => {
    const desktop = window.dropdexDesktop;
    const preflight = applyPreflight;
    if (!desktop?.isElectron || !preflight?.ok || !preflight.token || !userId || !importId || applyBusy) return;
    const generation = ++applyGenerationRef.current;
    setApplyBusy(true);
    setApplyMessage(null);
    try {
      const currentRows = await fetchCueDraftsForApply(userId, importId);
      const currentIdentity = new Map(currentRows.map((row) => [row.trackId, `${row.revision}:${row.desiredFingerprint}`]));
      const snapshotStillCurrent = applySnapshot.every((row) => currentIdentity.get(row.trackId) === `${row.revision}:${row.desiredFingerprint}`);
      if (!snapshotStillCurrent || currentRows.length !== applySnapshot.length) {
        setApplyPreflight(null);
        setApplySnapshot([]);
        setApplyDrafts(currentRows);
        setApplyMessage('Saved cue drafts changed after preflight. Run Apply to Rekordbox again for a fresh preflight.');
        return;
      }
      const result = await desktop.cueApply(preflight.token, desktopDrafts(applySnapshot));
      if (generation !== applyGenerationRef.current || selectedUserIdRef.current !== userId) return;
      setApplyResult(result);
      setApplyPreflight(null);
      if (result.ok && result.state === 'applied') {
        const summary = {
          state: result.state,
          planFingerprint: result.plan_fingerprint,
          backupIdentity: result.backup_identity,
          verifiedTracks: result.tracks.filter((track) => track.state === 'verified').length,
          rollbackVerified: result.rollback_verified,
        };
        const statusUpdates = await Promise.allSettled(applySnapshot.map((row) => markCueDraftApplied({
          trackId: row.trackId,
          revision: row.revision,
          desiredFingerprint: row.desiredFingerprint,
          operationId: result.operation_id,
          resultSummary: summary,
        })));
        if (statusUpdates.some((item) => item.status === 'rejected')) {
          setApplyMessage('Rekordbox was updated and verified, but one or more cloud apply-status updates could not be recorded. No newer draft was marked applied.');
        } else {
          setApplyMessage('Saved cue drafts were applied to local Rekordbox and verified. Use Rekordbox normally to sync/export to USB later.');
        }
        if (selectedTrackId) {
          const updated = statusUpdates.find((item) => item.status === 'fulfilled' && item.value.trackId === selectedTrackId);
          if (updated?.status === 'fulfilled') {
            setDraftAppliedRevision(updated.value.appliedRevision);
            setDraftAppliedFingerprint(updated.value.appliedFingerprint);
            setDraftDesiredFingerprint(updated.value.desiredFingerprint);
          }
        }
        await refreshApplyDrafts();
      } else {
        setApplyMessage(result.state === 'rolled-back'
          ? 'Apply did not complete. The original local Rekordbox database was restored and rollback verification succeeded.'
          : result.state === 'recovery-unverified'
            ? 'Apply encountered a recovery failure. Do not reopen Rekordbox until the reported recovery state is reviewed.'
            : 'Apply was rejected. No successful revision was marked applied.');
      }
    } catch (error) {
      if (generation === applyGenerationRef.current) setApplyMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (generation === applyGenerationRef.current) setApplyBusy(false);
    }
  }, [applyBusy, applyPreflight, applySnapshot, desktopDrafts, importId, refreshApplyDrafts, selectedTrackId, userId]);

  const handleAddCue = useCallback((family: 'hot' | 'memory', requestedMs: number): string | null => {
    if (!selectedTrackId) return 'Select a track before editing cue points.';
    if (selectedCueLoading) return 'Cue points are still loading for this track.';
    if (beatGridLoading) return 'The Rekordbox beat grid is still loading for this track.';
    manualCueSequenceRef.current += 1;
    const result = addWorkingCue(workingCues, {
      editorId: `manual:${selectedTrackId}:${manualCueSequenceRef.current}`,
      trackId: selectedTrackId,
      family,
      requestedMs,
      beats: beatGrid?.beats ?? [],
    });
    if (!result.error) setWorkingCues(result.cues);
    return result.error;
  }, [beatGrid, beatGridLoading, selectedCueLoading, selectedTrackId, workingCues]);

  const handleMoveCue = useCallback((cueId: string, requestedMs: number): string | null => {
    if (selectedCueLoading) return 'Cue points are still loading for this track.';
    if (beatGridLoading) return 'The Rekordbox beat grid is still loading for this track.';
    const result = moveWorkingCue(workingCues, cueId, requestedMs, beatGrid?.beats ?? []);
    if (!result.error) setWorkingCues(result.cues);
    return result.error;
  }, [beatGrid, beatGridLoading, selectedCueLoading, workingCues]);

  const handleDeleteCue = useCallback((cueId: string) => {
    setWorkingCues((current) => deleteWorkingCue(current, cueId));
  }, []);

  const handleAutoCue = useCallback((): string | null => {
    if (!selectedTrackId || !selectedTrack) return 'Select a track before running Auto Cue.';
    if (selectedCueLoading) return 'Cue points are still loading for this track.';
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
      currentCues: workingCues,
    });
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
  }, [beatGrid, beatGridLoading, importId, phraseLoading, phrases, selectedCueLoading, selectedTrack, selectedTrackId, workingCues]);

  const handleSave = useCallback(async (): Promise<string | null> => {
    if (!selectedTrackId || !selectedTrack) return 'Select a track before saving cue changes.';
    if (!userId) return 'Sign in before saving cue changes.';
    if (selectedCueLoading) return 'Cue points are still loading for this track.';
    if (!workingCuesDirty) return 'There are no unsaved cue changes.';
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
      const [desiredFingerprint, importedBaselineFingerprint] = await Promise.all([
        fingerprintCueDraftDocument(document),
        fingerprintCueDraftDocument(importedDocument),
      ]);
      const strategy = cueDraftStrategySummary(document);
      const saved = await saveCueDraft({
        importId: selectedTrack.import_id,
        trackId: requestedTrackId,
        rekordboxContentId: selectedTrack.rekordbox_content_id,
        document,
        desiredFingerprint,
        importedBaselineFingerprint,
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
      applyGenerationRef.current += 1;
      setApplyPreflight(null);
      setApplySnapshot([]);
      if (workingCueSetsEqual(workingCuesRef.current, workingSnapshot)) {
        setWorkingCues(hydrated);
      }
      return 'Cue changes saved.';
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
  }, [draftRevision, importedCueBaseline, selectedCueLoading, selectedTrack, selectedTrackId, userId, workingCues, workingCuesDirty]);

  const handleDiscard = useCallback(() => {
    setWorkingCues(savedCueBaseline ?? importedCueBaseline);
    setDraftPersistenceMessage(null);
  }, [importedCueBaseline, savedCueBaseline]);

  if (!importId) {
    return (
      <div className="mx-auto max-w-3xl pt-8">
        <div className="rounded-3xl border border-secondary/20 bg-[var(--color-panel)] p-8 text-center">
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
        cueLoading={selectedCueLoading}
        beatGridLoading={beatGridLoading}
        phraseLoading={phraseLoading}
        waveformState={waveformState}
        dirty={workingCuesDirty}
        draftStatus={cueDraftStatus}
        saving={savingCueDraft}
        persistenceMessage={draftPersistenceMessage}
        onRetryWaveform={() => selectedTrackId && retryWaveform([selectedTrackId])}
        onAddCue={handleAddCue}
        onMoveCue={handleMoveCue}
        onDeleteCue={handleDeleteCue}
        onDiscard={handleDiscard}
        onAutoCue={handleAutoCue}
        onSave={handleSave}
        applyAvailable={applyBridgeAvailable && applyDrafts.length > 0}
        applying={applyBusy}
        onApply={() => { void handleApplyPreflight(); }}
      />

      {(applyPreflight || applyResult || applyMessage || (!applyBridgeAvailable && applyBridgeReason)) && (
        <div className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-panel)] p-4" role="status">
          {applyPreflight ? (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-black">Apply to Rekordbox preflight</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {applyPreflight.tracks.length} saved track{applyPreflight.tracks.length === 1 ? '' : 's'} · {applySnapshot.reduce((sum, row) => sum + row.desiredDocument.cues.length, 0)} cue{applySnapshot.reduce((sum, row) => sum + row.desiredDocument.cues.length, 0) === 1 ? '' : 's'} · local Rekordbox only, no USB write
                  </p>
                </div>
                <button type="button" className="text-xs font-bold text-muted-foreground hover:text-foreground" onClick={() => { applyGenerationRef.current += 1; setApplyPreflight(null); setApplySnapshot([]); }}>Cancel</button>
              </div>
              {applyPreflight.blockers.length > 0 && <div className="rounded-xl border border-red-400/20 bg-red-400/[0.06] p-3 text-xs text-red-200">{applyPreflight.blockers.map((item) => <p key={item.code}>{item.message}</p>)}</div>}
              {applyPreflight.warnings.length > 0 && <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-3 text-xs text-amber-100">{applyPreflight.warnings.map((item) => <p key={item.code}>{item.message}</p>)}</div>}
              <p className="text-xs text-muted-foreground">DropDex will create/retain the Stage 6 backup identity, replace only the trusted local Rekordbox database after staging verification, and re-verify the live result. Rekordbox must remain closed.</p>
              <div className="flex justify-end gap-2">
                <ControlButton variant="ghost" disabled={applyBusy} onClick={() => { applyGenerationRef.current += 1; setApplyPreflight(null); setApplySnapshot([]); }}>Cancel</ControlButton>
                <ControlButton variant="primary" disabled={applyBusy || !applyPreflight.ok || !applyPreflight.token || applyPreflight.blockers.length > 0} onClick={() => { void handleConfirmApply(); }}>
                  {applyBusy ? 'Applying…' : 'Confirm Apply'}
                </ControlButton>
              </div>
            </div>
          ) : (
            <div className="space-y-1 text-xs text-muted-foreground">
              {applyResult && <p className="font-bold text-foreground">Last apply result: {applyResult.state} · {applyResult.tracks.filter((track) => track.state === 'verified').length}/{applyResult.tracks.length} tracks verified{applyResult.backup_identity ? ` · backup ${applyResult.backup_identity.slice(0, 12)}…` : ''}</p>}
              {applyMessage && <p>{applyMessage}</p>}
              {!applyBridgeAvailable && applyBridgeReason && <p>{applyBridgeReason}</p>}
            </div>
          )}
        </div>
      )}

      <section className="overflow-hidden rounded-3xl border border-[var(--color-border-subtle)] bg-[var(--color-panel)] shadow-sm">
        <div className="border-b border-[var(--color-border-subtle)] px-4 py-4 md:px-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black">{usbName}&apos;s Tracks</h2>
                <span className="rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {total.toLocaleString()}
                </span>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_180px_170px_180px]">
              <SearchControl
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search title or artist…"
                aria-label="Search cue point tracks"
              />
              <SelectControl value={genre} onChange={(event) => setGenre(event.target.value)} aria-label="Filter tracks by genre">
                <option value="">All genres</option>
                {(stats?.genreTotals ?? []).map((item) => (
                  <option key={item.name} value={item.name}>{item.name} ({item.count})</option>
                ))}
              </SelectControl>
              <SelectControl value={cueFilter} onChange={(event) => setCueFilter(event.target.value as CueFilter)} aria-label="Filter tracks by cue status">
                <option value="all">All cue states</option>
                <option value="with-cues">Has cues</option>
                <option value="without-cues">No cues</option>
              </SelectControl>
              <SelectControl value={analysisFilter} onChange={(event) => setAnalysisFilter(event.target.value as AnalysisFilter)} aria-label="Filter tracks by analysis status">
                <option value="all">All analysis</option>
                <option value="ready">Analysis ready</option>
                <option value="incomplete">Needs analysis</option>
              </SelectControl>
            </div>
          </div>
        </div>

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
                <thead className="bg-[var(--color-surface)] text-[9px] font-black uppercase tracking-[0.16em] text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 md:px-5">Track</th>
                    <th className="px-3 py-3">BPM</th>
                    <th className="px-3 py-3">Key</th>
                    <th className="px-3 py-3">Genre</th>
                    <th className="px-3 py-3 text-center">Cues</th>
                    <th className="px-3 py-3">Analysis</th>
                    <th className="px-4 py-3 text-right md:px-5">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-faint)]">
                  {filteredTracks.map((track) => {
                    const cueCount = cueRowsByTrackId.get(track.id)?.length ?? 0;
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
                        <td className="max-w-[420px] px-4 py-3 md:px-5">
                          <div className="flex items-center gap-3">
                            <span className={cn('h-8 w-1 rounded-full', selected ? 'bg-primary' : 'bg-transparent')} aria-hidden="true" />
                            <div className="min-w-0">
                              <p className={cn('truncate text-sm font-bold', selected && 'text-primary')}>{track.title}</p>
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">{track.artist ?? 'Artist Not Stored'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 font-mono text-xs font-bold tabular-nums">{track.bpm != null ? track.bpm.toFixed(1) : '—'}</td>
                        <td className="px-3 py-3">
                          <span className="rounded-md border border-primary/20 bg-primary/[0.07] px-2 py-1 font-mono text-[11px] font-bold text-primary">
                            {formatKey(track.musical_key)}
                          </span>
                        </td>
                        <td className="max-w-[190px] px-3 py-3 text-xs text-muted-foreground"><span className="block truncate">{track.genre ?? '—'}</span></td>
                        <td className="px-3 py-3 text-center">
                          <span className={cn(
                            'inline-flex min-w-8 justify-center rounded-md border px-2 py-1 font-mono text-[10px] font-black',
                            cueCount > 0
                              ? 'border-secondary/25 bg-secondary/10 text-secondary'
                              : 'border-[var(--color-border-subtle)] bg-[var(--color-surface)] text-muted-foreground',
                          )}>
                            {cueSummaryLoading ? '…' : cueCount}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span className={cn(
                            'inline-flex rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em]',
                            analysisReady(track)
                              ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
                              : track.analysis_parse_status === 'failed' || track.analysis_parse_status === 'missing_required'
                                ? 'border-red-400/20 bg-red-400/10 text-red-300'
                                : 'border-amber-400/20 bg-amber-400/10 text-amber-300',
                          )}>
                            {analysisLabel(track)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground md:px-5">
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
