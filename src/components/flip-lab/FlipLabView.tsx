import { useState, useEffect, useMemo, useCallback, useRef, useDeferredValue } from 'react';
import { createPortal } from 'react-dom';
import {
  classifyCamelotRelationship,
  parseCamelotKey,
  type CamelotRelationship,
} from '../../lib/music/camelot';
import { fetchFlipLabCandidatePools } from './flipLabCandidates';
import type { RouletteCandidateAnalysis } from '../../features/roulette/rouletteMatching';
import { applyFlipLabSelection, rankFlipLabSuggestions } from './flipLabMatching';
import { useTrackPreviewWaveforms } from '../../hooks/useTrackPreviewWaveforms';
import { RekordboxPreviewWaveform } from '../library/RekordboxPreviewWaveform';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import type { RekordboxTrack } from '../../types';
import type { WaveformLoadState } from '../../lib/queries/waveformValidation';
import {
  fetchTrackBeatGrid,
  fetchTrackPhrases,
  fetchTracksCueStates,
  type BeatGridRow,
  type CueLoadState,
  type PhraseRow,
} from '../../lib/queries/analysisData';
import {
  mapPhrasesToTimelineSegments,
  resolveFlipLabArtist,
  resolveFlipLabCamelotKey,
  trackDurationMs,
  type FlipLabTimelineSegment,
} from './flipLabAnalysis';
import {
  flipLabCombinedBeatGrid,
  flipLabKeyShiftSemitones,
  formatFlipLabTime,
  type FlipLabCombinedBeat,
  type FlipLabTimeline,
} from './flipLabTimeline';
import { MIN_CUE_TIMELINE_WINDOW_MS, panCueTimelineView, zoomCueTimelineView } from '../../lib/cues/cueTimelineViewport';
import { useFlipLab } from './useFlipLab';
import { NotificationCenter, type AppNotification } from '../ui/feedback';
import { KeyBadge } from '../ui/display';
import { MediaTransportControlGroup, TrackWaveformPreview, cueMarkersFromState, type TrackCueMarker } from '../ui/media';
import { logger } from '../../lib/logger';
import { Add, Close, Subtract } from '@carbon/icons-react';
import { ControlButton, Knob } from '../ui/controls';
import { FLIP_LAB_EQ_RANGE_DB, type FlipLabEqBand, type FlipLabStem, type FlipLabStemEq } from './flipLabEngine';
import { FlipIcon, InstrumentalIcon, VocalIcon } from './FlipLabIcons';
import { motion, useReducedMotion } from 'motion/react';
import {
  FLIP_LAB_ROW_HEIGHT,
  computeFlipLabWindowRange,
  filterFlipLabCandidates,
  isCurrentFlipLabLoad,
  scrollTopForFlipLabSelection,
} from './flipLabPerformance';

// ── Color tokens ──────────────────────────────────────────────────────────────
const BG       = 'var(--color-background)';
const PANEL    = 'var(--color-panel)';
const SURFACE  = 'var(--color-surface)';
const FG       = 'var(--color-foreground)';
const MUTED    = 'var(--color-muted-foreground)';
const BORDER_F = 'var(--color-border-faint)';
const BORDER_S = 'var(--color-border-subtle)';
const CTRL_BG  = 'var(--color-control-surface)';
const CTRL_BDR = 'var(--color-control-border)';
const PRIMARY  = 'var(--color-primary)';
const SECONDARY = 'var(--color-secondary)';
const ERROR_RED = '#ef4444';

// ── Section colors (from CuePointsView sectionTone()) ────────────────────────
const SECTION_COLORS = {
  intro:  { wave: '#2997ff' },
  verse:  { wave: '#a868f4' },
  build:  { wave: '#ff8614' },
  drop:   { wave: '#ff514b' },
  chorus: { wave: '#f151a6' },
  neutral: { wave: '#64748b' },
};

// ── Camelot color mapping (from CuePointsView) ────────────────────────────────
const CAMELOT_COLORS: Record<number, string> = {
  1: '#e74c3c', 2: '#3b82f6', 3: '#1d4ed8', 4: '#f59e0b', 5: '#16a34a', 6: '#d97706',
  7: '#8b5cf6', 8: '#0d9488', 9: '#22c55e', 10: '#0891b2', 11: '#06b6d4', 12: '#ec4899',
};

function camelotColor(key: string | null | undefined): string {
  if (!key) return '#6b7280';
  const m = key.match(/^(\d{1,2})[AB]$/i);
  if (!m) return '#6b7280';
  const n = parseInt(m[1], 10);
  return (n >= 1 && n <= 12) ? (CAMELOT_COLORS[n] ?? '#6b7280') : '#6b7280';
}

function shiftedCamelot(key: string | null, semitones: number | null): string | null {
  const parsed = parseCamelotKey(key);
  if (!parsed || semitones == null) return key;
  const number = ((((parsed.number - 1 + semitones * 7) % 12) + 12) % 12) + 1;
  return `${number}${parsed.mode}`;
}

function matchDotColor(rel: CamelotRelationship | null): string {
  if (rel === null) return '#4b5563';
  switch (rel) {
    case 'exact':
    case 'relative':
    case 'adjacent_up':
    case 'adjacent_down': return '#22c55e';
    case 'energy_boost':  return '#f59e0b';
    case 'incompatible':  return '#ef4444';
    case 'unknown':       return '#4b5563';
  }
}

const FLIP_LAB_KEYFRAMES = `
@keyframes flip-lab-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .flip-lab-spin { animation: none !important; } }
`;

type FlipLabTrackAnalysisState =
  | { status: 'idle'; beatGrid: null; phrases: [] }
  | { status: 'loading'; beatGrid: null; phrases: [] }
  | { status: 'loaded'; beatGrid: BeatGridRow | null; phrases: PhraseRow[] }
  | { status: 'error'; beatGrid: null; phrases: []; error: string };

function useFlipLabTrackAnalysis(trackId: string | null): FlipLabTrackAnalysisState {
  const [state, setState] = useState<FlipLabTrackAnalysisState>({ status: 'idle', beatGrid: null, phrases: [] });

  useEffect(() => {
    if (!trackId) {
      setState({ status: 'idle', beatGrid: null, phrases: [] });
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading', beatGrid: null, phrases: [] });
    void Promise.all([
      fetchTrackBeatGrid(trackId, controller.signal),
      fetchTrackPhrases(trackId, controller.signal),
    ])
      .then(([beatGrid, phrases]) => {
        if (controller.signal.aborted) return;
        setState({ status: 'loaded', beatGrid, phrases });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: 'error',
          beatGrid: null,
          phrases: [],
          error: error instanceof Error ? error.message : 'Failed to load track analysis.',
        });
      });
    return () => controller.abort();
  }, [trackId]);

  return state;
}

// ── Section label row (matches CuePointsView section lane) ───────────────────
function SectionRow({ segments, analysisStatus }: {
  segments: FlipLabTimelineSegment[];
  analysisStatus: FlipLabTrackAnalysisState['status'];
}) {
  const emptyLabel = analysisStatus === 'loading' ? 'Loading phrase data…' : 'Phrase data unavailable';

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {segments.length === 0 ? (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, color: MUTED, letterSpacing: '0.04em',
        }}>{emptyLabel}</div>
      ) : segments.map((segment, index) => {
        const color = SECTION_COLORS[segment.tone].wave;
        return (
          <div
            key={`${segment.label}-${index}-${segment.startPercent}`}
            style={{
              position: 'absolute', left: `${segment.startPercent}%`, width: `${segment.endPercent - segment.startPercent}%`,
              top: 5, height: 28,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden', borderBottom: `2px solid ${color}`,
            }}
          >
            <span style={{
              fontFamily: 'monospace', fontSize: 9, fontWeight: 700,
              color, letterSpacing: '0.06em',
              textShadow: '0 1px 4px rgba(0,0,0,0.8)', whiteSpace: 'nowrap',
            }}>
              {segment.label.toUpperCase()}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Header stat (label + value pair, matches CuePointsView header stats) ─────
function HeaderStat({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 600, color: MUTED, whiteSpace: 'nowrap' }}>
      <span style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>{' '}
      <strong style={{ marginLeft: 4, fontWeight: 700, color: valueColor ?? FG }}>{value}</strong>
    </span>
  );
}

// ── Track header ──────────────────────────────────────────────────────────────
interface TrackHeaderProps {
  track: RekordboxTrack;
  /** 'right' puts BPM/Key first and right-justifies the title and artist. */
  titleSide?: 'left' | 'right';
  targetBpm?: number | null;
  keyShift?: {
    enabled: boolean;
    available: boolean;
    disabled: boolean;
    semitones: number | null;
    onToggle: (next: boolean) => void;
  };
  solo?: {
    enabled: boolean;
    disabled: boolean;
    onToggle: () => void;
  };
}

function HeaderSwitch({
  label,
  on,
  disabled = false,
  color,
  title,
  testId,
  onToggle,
}: {
  label: string;
  on: boolean;
  disabled?: boolean;
  color: string;
  title: string;
  testId: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      title={title}
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: 0,
        background: 'transparent', border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      <span style={{
        position: 'relative', width: 26, height: 14, borderRadius: 7,
        background: on ? color : CTRL_BG,
        border: `1px solid ${on ? color : CTRL_BDR}`,
        transition: 'background 0.15s',
      }}>
        <span style={{
          position: 'absolute', top: 1, left: on ? 13 : 1,
          width: 10, height: 10, borderRadius: '50%', background: '#fff',
          transition: 'left 0.15s',
        }} />
      </span>
    </button>
  );
}

function TrackHeader({ track, titleSide = 'left', targetBpm, keyShift, solo }: TrackHeaderProps) {
  const bpm = track.bpm != null ? track.bpm.toFixed(0) : '—';
  const bpmValue = targetBpm != null && track.bpm != null && Math.abs(targetBpm - track.bpm) >= 0.05
    ? `${bpm} → ${targetBpm.toFixed(0)}`
    : bpm;
  const keyStr = resolveFlipLabCamelotKey(track);
  const shownKey = keyShift?.enabled && keyShift.available ? shiftedCamelot(keyStr, keyShift.semitones) : keyStr;
  const keyValue = keyStr && shownKey && shownKey !== keyStr ? `${keyStr} → ${shownKey}` : (keyStr ?? '—');
  const right = titleSide === 'right';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      justifyContent: right ? 'flex-end' : 'flex-start',
      padding: '6px 16px', background: PANEL, borderBottom: `1px solid ${BORDER_F}`,
    }}>
      <div style={{
        flex: '0 1 auto',
        minWidth: 0,
        textAlign: right ? 'right' : 'left',
        order: right ? 2 : 0,
        marginLeft: right ? 12 : 0,
        marginRight: right ? 0 : 12,
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: FG, letterSpacing: '-0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.title}</div>
        <div style={{ fontSize: 11, color: MUTED, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{resolveFlipLabArtist(track, '')}</div>
      </div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexShrink: 0, order: right ? 1 : 0 }}>
        <HeaderStat label="BPM" value={bpmValue} />
        <HeaderStat label="Key" value={keyValue} valueColor={shownKey ? camelotColor(shownKey) : undefined} />
        {keyShift && (
          <HeaderSwitch
            label="Key Shift"
            on={keyShift.enabled}
            disabled={keyShift.disabled || !keyShift.available}
            color={SECONDARY}
            title={keyShift.available ? 'Shift the vocal to the instrumental\'s key' : 'Both tracks need a key to use Key Shift'}
            testId="flip-lab-key-shift"
            onToggle={() => keyShift.onToggle(!keyShift.enabled)}
          />
        )}
        {solo && (
          <HeaderSwitch
            label="Solo"
            on={solo.enabled}
            disabled={solo.disabled}
            color={right ? PRIMARY : SECONDARY}
            title={solo.enabled ? 'Play both stems again' : 'Play only this stem'}
            testId={right ? 'flip-lab-solo-instrumental' : 'flip-lab-solo-vocal'}
            onToggle={solo.onToggle}
          />
        )}
      </div>
    </div>
  );
}

// ── Track selector row ────────────────────────────────────────────────────────
const ROW_GRID = '24px minmax(0,1fr) 168px 40px 56px 12px 20px';
const ROW_GAP  = 6;

function TrackSelectorRow({
  candidate,
  selected,
  disabled,
  onSelect,
  onPreview,
  previewStatus,
  waveformState,
  cueMarkers,
  otherTrack,
}: {
  candidate: RouletteCandidateAnalysis;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onPreview: () => void;
  previewStatus: 'idle' | 'loading' | 'playing';
  waveformState: WaveformLoadState;
  cueMarkers: TrackCueMarker[];
  otherTrack: RekordboxTrack | null;
}) {
  const { track } = candidate;
  const bpm    = track.bpm != null ? track.bpm.toFixed(0) : '—';
  const keyStr = resolveFlipLabCamelotKey(track);

  const rel = useMemo<CamelotRelationship | null>(() => {
    if (!otherTrack) return null;
    const mine   = resolveFlipLabCamelotKey(track);
    const theirs = resolveFlipLabCamelotKey(otherTrack);
    if (!mine || !theirs) return 'unknown';
    return classifyCamelotRelationship(mine, theirs);
  }, [track, otherTrack]);

  const dotClr = matchDotColor(rel);

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-pressed={selected}
      aria-disabled={disabled}
      onClick={disabled ? undefined : onSelect}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      style={{
        width: '100%',
        display: 'grid',
        gridTemplateColumns: ROW_GRID,
        alignItems: 'center',
        columnGap: ROW_GAP,
        padding: '5px 12px',
        background: selected ? `${PRIMARY}12` : 'transparent',
        border: 'none',
        borderBottom: `1px solid ${BORDER_F}`,
        borderLeft: `2px solid ${selected ? PRIMARY : 'transparent'}`,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        textAlign: 'left',
      }}
    >
      {/* Plays the original track; separate from row selection. */}
      <button
        type="button"
        disabled={disabled}
        aria-label={`${previewStatus === 'playing' ? 'Stop' : 'Preview'} ${track.title}`}
        aria-pressed={previewStatus === 'playing'}
        onClick={(event) => {
          event.stopPropagation();
          onPreview();
        }}
        onKeyDown={(event) => event.stopPropagation()}
        style={{
          width: 24, height: 24, borderRadius: '50%', padding: 0,
          background: previewStatus !== 'idle' ? `${PRIMARY}20` : CTRL_BG,
          border: `1px solid ${previewStatus !== 'idle' ? PRIMARY : CTRL_BDR}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 7, color: previewStatus !== 'idle' ? PRIMARY : FG,
          flexShrink: 0, cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >{previewStatus === 'loading' ? '…' : previewStatus === 'playing' ? '■' : '▶'}</button>

      <div style={{ minWidth: 0, overflow: 'hidden' }}>
        <div style={{
          fontSize: 11, fontWeight: 600, color: FG,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{track.title}</div>
        <div style={{
          fontSize: 10, color: MUTED,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{resolveFlipLabArtist(track, 'Unknown artist')}</div>
      </div>

      <TrackWaveformPreview
        waveformState={waveformState}
        durationMs={trackDurationMs(track)}
        cues={cueMarkers}
        height={24}
        ariaLabel={`Waveform for ${track.title}`}
      />

      <div style={{
        fontSize: 11, fontWeight: 700, color: FG,
        fontVariantNumeric: 'tabular-nums', textAlign: 'center',
      }}>{bpm}</div>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <KeyBadge camelotKey={keyStr} />
      </div>

      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: dotClr, boxShadow: `0 0 5px ${dotClr}70`,
        margin: '0 auto',
      }} />

      {/* Reserved column: no fake overflow-menu affordance until a real menu exists. */}
      <div aria-hidden="true" />
    </div>
  );
}

function TrackListColumnHeader() {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: ROW_GRID,
      alignItems: 'center',
      columnGap: ROW_GAP,
      padding: '5px 12px',
      borderBottom: `1px solid ${BORDER_F}`,
      background: PANEL,
    }}>
      {['', 'Track', '', 'BPM', 'Key', 'Match', ''].map((label, i) => (
        <div key={i} style={{
          fontSize: 8, fontWeight: 800, color: MUTED,
          letterSpacing: '0.08em', textTransform: 'uppercase',
          textAlign: i >= 2 ? 'center' : 'left',
        }}>{label}</div>
      ))}
    </div>
  );
}

// ── Select panel (left or right column) ──────────────────────────────────────
interface SelectPanelProps {
  role: 'vocal' | 'instrumental';
  suggested: RouletteCandidateAnalysis[];
  library: RouletteCandidateAnalysis[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  tab: 'suggested' | 'library';
  onTabChange: (t: 'suggested' | 'library') => void;
  search: string;
  onSearchChange: (v: string) => void;
  getWaveformState: (id: string | null | undefined) => WaveformLoadState;
  onVisibleTrackIdsChange: (ids: string[]) => void;
  otherTrack: RekordboxTrack | null;
  onPreview: (track: RekordboxTrack) => void;
  previewStatusFor: (trackId: string) => 'idle' | 'loading' | 'playing';
  cueMarkersFor: (trackId: string) => TrackCueMarker[];
  disabled: boolean;
}

function SelectPanel({
  role, suggested, library,
  selectedId, onSelect,
  tab, onTabChange,
  search, onSearchChange,
  getWaveformState, onVisibleTrackIdsChange, otherTrack,
  onPreview, previewStatusFor, cueMarkersFor, disabled,
}: SelectPanelProps) {
  const isVocal = role === 'vocal';
  const roleColor = isVocal ? SECONDARY : PRIMARY;
  const roleLabel = isVocal ? 'Vocal' : 'Instrumental';
  const list = tab === 'suggested' ? suggested : library;
  const deferredSearch = useDeferredValue(search);
  const listRef = useRef<HTMLDivElement | null>(null);
  const scrollTopRef = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(FLIP_LAB_ROW_HEIGHT * 8);

  const filtered = useMemo(
    () => filterFlipLabCandidates(list, deferredSearch),
    [deferredSearch, list],
  );
  const windowRange = useMemo(
    () => computeFlipLabWindowRange(filtered.length, scrollTop, viewportHeight),
    [filtered.length, scrollTop, viewportHeight],
  );
  const visibleCandidates = useMemo(
    () => filtered.slice(windowRange.startIndex, windowRange.endIndex),
    [filtered, windowRange.endIndex, windowRange.startIndex],
  );

  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    const updateHeight = () => setViewportHeight(Math.max(FLIP_LAB_ROW_HEIGHT, node.clientHeight));
    updateHeight();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = 0;
    scrollTopRef.current = 0;
    setScrollTop(0);
  }, [search, tab]);

  useEffect(() => {
    const selectedIndex = selectedId
      ? filtered.findIndex((candidate) => candidate.track.id === selectedId)
      : -1;
    if (selectedIndex < 0) return;
    const currentScrollTop = scrollTopRef.current;
    const nextScrollTop = scrollTopForFlipLabSelection(selectedIndex, currentScrollTop, viewportHeight);
    if (Math.abs(nextScrollTop - currentScrollTop) < 1) return;
    if (listRef.current) listRef.current.scrollTop = nextScrollTop;
    scrollTopRef.current = nextScrollTop;
    setScrollTop(nextScrollTop);
  }, [filtered, selectedId, viewportHeight]);

  useEffect(() => {
    onVisibleTrackIdsChange(visibleCandidates.map((candidate) => candidate.track.id));
  }, [onVisibleTrackIdsChange, visibleCandidates]);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      borderRight: isVocal ? `1px solid ${BORDER_F}` : undefined,
      background: BG, minHeight: 0, overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px 10px',
        background: PANEL, borderBottom: `1px solid ${BORDER_F}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: FG, display: 'flex', flexShrink: 0 }}>
            {isVocal ? <VocalIcon size={30} /> : <InstrumentalIcon size={30} />}
          </span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: FG }}>Select {roleLabel}</div>
            <div style={{ fontSize: 10, color: MUTED }}>Choose the {role} track</div>
          </div>
        </div>
        <div style={{
          display: 'flex', gap: 2, background: SURFACE,
          borderRadius: 8, padding: 2, border: `1px solid ${BORDER_S}`,
        }}>
          {(['suggested', 'library'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => onTabChange(t)}
              style={{
                padding: '4px 12px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                cursor: 'pointer', border: 'none',
                background: tab === t ? roleColor : 'transparent',
                color: tab === t ? '#fff' : MUTED,
                transition: 'all 0.15s',
              }}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '8px 12px', background: PANEL, borderBottom: `1px solid ${BORDER_F}` }}>
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: MUTED, pointerEvents: 'none' }}>⌕</div>
          <input
            type="text"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder={`Search ${role}s, artists…`}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '6px 10px 6px 26px', borderRadius: 8,
              background: SURFACE, border: `1px solid ${BORDER_S}`,
              fontSize: 11, color: FG, outline: 'none',
            }}
          />
        </div>
      </div>

      <TrackListColumnHeader />

      <div
        ref={listRef}
        onScroll={(event) => {
          scrollTopRef.current = event.currentTarget.scrollTop;
          setScrollTop(event.currentTarget.scrollTop);
        }}
        style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingBottom: 88 }}
      >
        {filtered.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: 11, color: MUTED }}>
            {tab === 'suggested' && suggested.length === 0
              ? (otherTrack ? 'No compatible suggestions for this selection.' : 'Select a track on the other side to see suggestions.')
              : library.length === 0
                ? 'No tracks in library yet.'
                : 'No tracks match your search.'}
          </div>
        ) : (
          <>
            {windowRange.topSpacerHeight > 0 && <div aria-hidden="true" style={{ height: windowRange.topSpacerHeight }} />}
            {visibleCandidates.map(c => (
              <div key={c.track.id} style={{ height: FLIP_LAB_ROW_HEIGHT, overflow: 'hidden' }}>
                <TrackSelectorRow
                  candidate={c}
                  selected={c.track.id === selectedId}
                  disabled={disabled}
                  onSelect={() => onSelect(c.track.id)}
                  onPreview={() => onPreview(c.track)}
                  previewStatus={previewStatusFor(c.track.id)}
                  waveformState={getWaveformState(c.track.id)}
                  cueMarkers={cueMarkersFor(c.track.id)}
                  otherTrack={otherTrack}
                />
              </div>
            ))}
            {windowRange.bottomSpacerHeight > 0 && <div aria-hidden="true" style={{ height: windowRange.bottomSpacerHeight }} />}
          </>
        )}
      </div>
    </div>
  );
}

// ── Progress circle ───────────────────────────────────────────────────────────
function FlipProgressCircle({ progress }: { progress: number }) {
  const size = 72;
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, progress));
  const percent = Math.round(clamped * 100);
  return (
    <div
      data-testid="flip-lab-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label="Stem separation progress"
      style={{ position: 'relative', width: size, height: size }}
    >
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={BORDER_S} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={PRIMARY}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          style={{ transition: 'stroke-dashoffset 0.4s ease' }}
        />
      </svg>
      {/* A small orbiting dot keeps the ring visibly alive between progress updates. */}
      <div className="flip-lab-spin" aria-hidden="true" style={{
        position: 'absolute', inset: 0, animation: 'flip-lab-spin 1.6s linear infinite',
      }}>
        <span style={{
          position: 'absolute', top: 0, left: '50%', width: stroke, height: stroke,
          marginLeft: -stroke / 2, borderRadius: '50%', background: PRIMARY, opacity: 0.6,
        }} />
      </div>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, fontWeight: 800, color: FG, fontVariantNumeric: 'tabular-nums',
      }}>{percent}%</div>
    </div>
  );
}

// Rebuild of the Framer "PremiumGlowButton": a pill whose 1.5px border is a
// spinning conic gradient over a near-black fill, with a soft outer glow.
const GLOW_COLOR = '#00F0FF';

function GlowFlipButton({ enabled, onClick }: { enabled: boolean; onClick: () => void }) {
  const reduceMotion = useReducedMotion();
  const spinning = enabled && !reduceMotion;
  return (
    <motion.button
      type="button"
      data-testid="flip-lab-flip"
      aria-label="Flip"
      title="Flip"
      onClick={onClick}
      disabled={!enabled}
      whileHover={enabled ? { scale: 1.02 } : undefined}
      whileTap={enabled ? { scale: 0.98 } : undefined}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      style={{
        position: 'relative', padding: 1.5, borderRadius: 100, overflow: 'hidden',
        border: 'none', background: enabled ? 'transparent' : CTRL_BDR,
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        cursor: enabled ? 'pointer' : 'not-allowed',
        opacity: enabled ? 1 : 0.45,
        boxShadow: enabled ? '0px 15px 35px 0px rgba(0, 240, 255, 0.25)' : 'none',
      }}
    >
      {enabled && (
        <motion.span
          aria-hidden="true"
          animate={spinning ? { rotate: 360 } : undefined}
          transition={spinning ? { repeat: Infinity, duration: 3, ease: 'linear' } : undefined}
          style={{
            position: 'absolute', left: '50%', top: '50%', x: '-50%', y: '-50%',
            width: 2000, height: 2000, zIndex: 0,
            background: `conic-gradient(from 0deg, transparent 0%, ${GLOW_COLOR} 20%, transparent 50%)`,
          }}
        />
      )}
      <span style={{
        position: 'relative', zIndex: 1, background: '#0D0D0D', borderRadius: 100 - 1.5,
        padding: '10px 26px', display: 'flex', alignItems: 'center', color: '#FFFFFF',
      }}>
        <FlipIcon size={26} />
      </span>
    </motion.button>
  );
}

// ── Flip column (center) ──────────────────────────────────────────────────────
// Flip stays centered under the Flip Lab area at all times; Clear sits 6px to
// its right. Rendered into <body> so it floats above the lists and the
// loading overlay (so a running separation can still be cancelled).
function FlipFloatingControls({
  anchorRef,
  canFlip,
  canClear,
  onFlip,
  onClear,
}: {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  canFlip: boolean;
  canClear: boolean;
  onFlip: () => void;
  onClear: () => void;
}) {
  const [centerX, setCenterX] = useState<number | null>(null);
  useEffect(() => {
    const node = anchorRef.current;
    if (!node) return;
    const update = () => {
      const rect = node.getBoundingClientRect();
      setCenterX(rect.left + rect.width / 2);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(node);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [anchorRef]);

  if (centerX == null || typeof document === 'undefined') return null;
  return createPortal(
    <div
      data-testid="flip-lab-floating-controls"
      style={{ position: 'fixed', bottom: 24, left: centerX, transform: 'translateX(-50%)', zIndex: 85 }}
    >
      <GlowFlipButton enabled={canFlip} onClick={onFlip} />
      <button
        type="button"
        data-testid="flip-lab-clear-pair"
        onClick={onClear}
        disabled={!canClear}
        aria-label="Clear loaded pair"
        title="Clear loaded pair"
        style={{
          position: 'absolute', left: 'calc(100% + 6px)', top: '50%', transform: 'translateY(-50%)',
          width: 38, height: 38, borderRadius: '50%', padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#0D0D0D', border: `1px solid ${BORDER_S}`,
          color: canClear ? FG : MUTED,
          cursor: canClear ? 'pointer' : 'not-allowed',
          opacity: canClear ? 1 : 0.5,
          boxShadow: '0 8px 20px rgba(0, 0, 0, 0.4)',
        }}
      >
        <Close size={18} />
      </button>
    </div>,
    document.body,
  );
}

// Full-screen blurred, darkened overlay with the separation progress, matching
// the notification card overlay.
function FlipLoadingOverlay({ phase, progress }: { phase: ReturnType<typeof useFlipLab>['state']['phase']; progress: number }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      data-testid="flip-lab-loading-overlay"
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', inset: 0, zIndex: 80,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
        background: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      }}
    >
      <FlipProgressCircle progress={progress} />
      <div style={{ fontSize: 12, fontWeight: 600, color: FG }}>
        {phase === 'preparing' ? 'Getting playback ready…' : 'Separating stems…'}
      </div>
      <div data-testid="flip-lab-selection-locked" style={{ fontSize: 11, color: MUTED, textAlign: 'center', maxWidth: 280 }}>
        Track Selection is disabled until stem separation is finished
      </div>
    </div>,
    document.body,
  );
}

// ── Timeline lanes ────────────────────────────────────────────────────────────
interface TimelineView {
  start: number;
  end: number;
}

function laneBox(startSec: number, spanSec: number, view: TimelineView): React.CSSProperties {
  const range = Math.max(1, view.end - view.start);
  return {
    position: 'absolute', top: 0, bottom: 0,
    left: `${((startSec * 1000 - view.start) / range) * 100}%`,
    width: `${((spanSec * 1000) / range) * 100}%`,
  };
}

// One beat grid for the combined track, styled like the CuePoints lane:
// red downbeats, green beats, bar numbers.
const MAX_BAR_LABELS = 24;

function CombinedBeatGridLane({ beats, view }: { beats: FlipLabCombinedBeat[]; view: TimelineView }) {
  const range = Math.max(1, view.end - view.start);
  const visible = beats.filter((beat) => beat.timeSec * 1000 >= view.start && beat.timeSec * 1000 <= view.end);
  const labeled = visible.filter((beat) => beat.downbeat && beat.bar >= 1);
  const step = Math.max(1, Math.ceil(labeled.length / MAX_BAR_LABELS));
  const percent = (timeSec: number) => ((timeSec * 1000 - view.start) / range) * 100;
  return (
    <div
      data-testid="flip-lab-beat-grid"
      style={{ position: 'relative', height: 30, borderBottom: `1px solid ${BORDER_F}`, background: BG, overflow: 'hidden' }}
    >
      {visible.length === 0 ? (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, color: MUTED, letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>No beat grid</div>
      ) : (
        <>
          {visible.map((beat) => (
            <span
              key={`beat-${beat.timeSec.toFixed(4)}`}
              aria-hidden="true"
              style={{
                position: 'absolute', left: `${percent(beat.timeSec)}%`, transform: 'translateX(-50%)', borderRadius: 999,
                top: beat.downbeat ? 2 : 3,
                height: beat.downbeat ? 14 : 8,
                width: beat.downbeat ? 2 : 1.5,
                background: beat.downbeat ? '#f87171' : '#4ade80',
                opacity: beat.downbeat ? 1 : 0.9,
              }}
            />
          ))}
          {labeled.filter((_, index) => index % step === 0).map((beat) => (
            <span
              key={`bar-${beat.bar}`}
              style={{
                position: 'absolute', bottom: 2, left: `${percent(beat.timeSec)}%`, transform: 'translateX(-50%)',
                fontFamily: 'monospace', fontSize: 9, fontWeight: 500, color: '#9ca5ae', fontVariantNumeric: 'tabular-nums',
              }}
            >{beat.bar}</span>
          ))}
        </>
      )}
    </div>
  );
}

// A gray copy of the waveform with the normal blue one revealed left→right by
// `fill` (0..1), so the waveform itself acts as the separation progress bar.
function FillingWaveformLane({
  box,
  fill,
  muted = false,
  waveformState,
  ariaLabel,
}: {
  box: React.CSSProperties;
  fill: number;
  muted?: boolean;
  waveformState: WaveformLoadState;
  ariaLabel: string;
}) {
  const hidden = `${(1 - Math.max(0, Math.min(1, fill))) * 100}%`;
  return (
    <div
      data-testid={muted ? 'flip-lab-waveform-muted' : undefined}
      style={{ height: 88, position: 'relative', overflow: 'hidden', background: BG }}
    >
      <div style={{
        ...box,
        filter: muted ? 'grayscale(1) brightness(1.6)' : undefined,
        opacity: muted ? 0.45 : 1,
        transition: 'filter 0.2s, opacity 0.2s',
      }}>
        {fill < 1 && (
          <div aria-hidden="true" style={{ position: 'absolute', inset: 0, filter: 'grayscale(1)', opacity: 0.35 }}>
            <RekordboxPreviewWaveform state={waveformState} height={88} variant="detail" surface={false} />
          </div>
        )}
        <div
          data-testid="flip-lab-waveform-fill"
          style={{
            position: 'absolute', inset: 0,
            clipPath: `inset(0 ${hidden} 0 0)`,
            transition: 'clip-path 0.4s linear',
          }}
        >
          <RekordboxPreviewWaveform
            state={waveformState}
            height={88}
            variant="detail"
            surface={false}
            ariaLabel={ariaLabel}
          />
        </div>
      </div>
    </div>
  );
}

function FlipLabPlayheadOverlay({ progress }: { progress: number }) {
  const percent = Math.max(0, Math.min(100, progress * 100));
  return (
    <div
      data-testid="flip-lab-playhead"
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2 }}
    >
      <div style={{
        position: 'absolute', top: 0, bottom: 0, left: `${percent}%`,
        width: 1, background: '#fff', transform: 'translateX(-50%)',
        boxShadow: '0 0 7px rgba(255,255,255,0.75)',
      }}>
        <div style={{
          position: 'absolute', left: '50%', top: -1,
          width: 8, height: 8, borderRadius: 1,
          background: '#fff', transform: 'translate(-50%, -2px) rotate(45deg)',
          boxShadow: '0 0 6px rgba(255,255,255,0.8)',
        }} />
      </div>
    </div>
  );
}

// ── Audio dock ────────────────────────────────────────────────────────────────
const EQ_BANDS: { band: FlipLabEqBand; label: string }[] = [
  { band: 'low', label: 'Low' },
  { band: 'mid', label: 'Mid' },
  { band: 'high', label: 'High' },
];

function StemEqKnobs({
  stem,
  eq,
  accent,
  onChange,
}: {
  stem: FlipLabStem;
  eq: FlipLabStemEq;
  accent: string;
  onChange: (stem: FlipLabStem, band: FlipLabEqBand, db: number) => void;
}) {
  const stemLabel = stem === 'vocal' ? 'Vocal' : 'Instrumental';
  return (
    <div
      role="group"
      aria-label={`${stemLabel} EQ`}
      data-testid={`flip-lab-eq-${stem}`}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, flex: 1, minWidth: 0 }}
    >
      {EQ_BANDS.map(({ band, label }) => (
        <Knob
          key={band}
          label={label}
          ariaLabel={`${stemLabel} ${label}`}
          value={eq[band]}
          min={-FLIP_LAB_EQ_RANGE_DB}
          max={FLIP_LAB_EQ_RANGE_DB}
          accent={accent}
          onChange={(db) => onChange(stem, band, db)}
        />
      ))}
    </div>
  );
}

function FlipLabAudioDock({
  canPlay,
  playing,
  positionSec,
  durationSec,
  volume,
  eq,
  onTogglePlay,
  onSeek,
  onVolume,
  onEq,
}: {
  canPlay: boolean;
  playing: boolean;
  positionSec: number;
  durationSec: number;
  volume: number;
  eq: Record<FlipLabStem, FlipLabStemEq>;
  onTogglePlay: () => void;
  onSeek: (sec: number) => void;
  onVolume: (value: number) => void;
  onEq: (stem: FlipLabStem, band: FlipLabEqBand, db: number) => void;
}) {
  const position = Math.min(durationSec, Math.max(0, positionSec));
  return (
    <div
      data-testid="flip-lab-audio-dock"
      role="region"
      aria-label="Flip Lab audio dock"
      style={{
        display: 'flex', alignItems: 'center',
        padding: '8px 16px', background: PANEL, borderBottom: `1px solid ${BORDER_F}`,
      }}
    >
      <StemEqKnobs stem="vocal" eq={eq.vocal} accent={SECONDARY} onChange={onEq} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '50%', flexShrink: 0, minWidth: 0 }}>
        <MediaTransportControlGroup
          compact
          ariaLabel="Flip Lab transport controls"
          playing={playing}
          onTogglePlay={onTogglePlay}
          onPrevious={() => undefined}
          onRewind={() => onSeek(Math.max(0, position - 10))}
          onForward={() => onSeek(Math.min(durationSec, position + 10))}
          onNext={() => undefined}
          previousDisabled
          nextDisabled
          playDisabled={!canPlay}
          rewindDisabled={!canPlay}
          forwardDisabled={!canPlay}
        />

        <span style={{ fontSize: 10, color: MUTED, fontVariantNumeric: 'tabular-nums', width: 30, textAlign: 'right', flexShrink: 0 }}>
          {formatFlipLabTime(position)}
        </span>
        <input
          type="range"
          min={0}
          max={durationSec > 0 ? durationSec : 1}
          step={0.1}
          value={canPlay ? position : 0}
          disabled={!canPlay}
          onChange={(event) => onSeek(Number(event.target.value))}
          aria-label="Flip Lab playback position"
          style={{ flex: 1, minWidth: 40, cursor: canPlay ? 'pointer' : 'not-allowed', accentColor: PRIMARY }}
        />
        <span style={{ fontSize: 10, color: MUTED, fontVariantNumeric: 'tabular-nums', width: 30, flexShrink: 0 }}>
          {formatFlipLabTime(durationSec)}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, borderLeft: `1px solid ${BORDER_F}`, paddingLeft: 10 }}>
          <span aria-hidden="true" style={{ fontSize: 12, color: MUTED }}>{volume === 0 ? '🔇' : '🔊'}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={volume}
            onChange={(event) => onVolume(Number(event.target.value))}
            aria-label="Flip Lab playback volume"
            style={{ width: 64, cursor: 'pointer', accentColor: PRIMARY }}
          />
        </div>
      </div>

      <StemEqKnobs stem="instrumental" eq={eq.instrumental} accent={PRIMARY} onChange={onEq} />
    </div>
  );
}

// ── Top section: both tracks on one shared timeline ──────────────────────────
function TopWaveformSection({
  vocalTrack,
  instrTrack,
  vocalAnalysis,
  instrAnalysis,
  vocalWaveformState,
  instrWaveformState,
  timeline,
  flipLab,
}: {
  vocalTrack: RekordboxTrack;
  instrTrack: RekordboxTrack;
  vocalAnalysis: FlipLabTrackAnalysisState;
  instrAnalysis: FlipLabTrackAnalysisState;
  vocalWaveformState: WaveformLoadState;
  instrWaveformState: WaveformLoadState;
  timeline: FlipLabTimeline;
  flipLab: ReturnType<typeof useFlipLab>;
}) {
  const { state, busy } = flipLab;
  const vocalSections = useMemo(() => (
    vocalAnalysis.status === 'loaded'
      ? mapPhrasesToTimelineSegments(vocalAnalysis.phrases, trackDurationMs(vocalTrack), vocalAnalysis.beatGrid)
      : []
  ), [vocalAnalysis, vocalTrack]);
  const instrSections = useMemo(() => (
    instrAnalysis.status === 'loaded'
      ? mapPhrasesToTimelineSegments(instrAnalysis.phrases, trackDurationMs(instrTrack), instrAnalysis.beatGrid)
      : []
  ), [instrAnalysis, instrTrack]);
  const semitones = flipLabKeyShiftSemitones(resolveFlipLabCamelotKey(vocalTrack), resolveFlipLabCamelotKey(instrTrack));

  // One zoom window shared by every row, so both stems zoom together like CuePoints.
  const totalMs = timeline.totalSec * 1000;
  const [view, setView] = useState<TimelineView>({ start: 0, end: totalMs });
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    setView({ start: 0, end: totalMs });
  }, [totalMs]);

  const lanesRef = useRef<HTMLDivElement | null>(null);
  const wheelFrameRef = useRef<number | null>(null);
  useEffect(() => {
    const el = lanesRef.current;
    if (!el || totalMs <= 0) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const current = viewRef.current;
      const range = current.end - current.start;
      const next = Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? panCueTimelineView(current, totalMs, (event.deltaX / rect.width) * range)
        : zoomCueTimelineView(current, totalMs, Math.exp(event.deltaY * 0.005), Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)));
      if (!next) return;
      viewRef.current = next;
      if (wheelFrameRef.current == null) {
        wheelFrameRef.current = requestAnimationFrame(() => {
          wheelFrameRef.current = null;
          setView(viewRef.current);
        });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (wheelFrameRef.current != null) cancelAnimationFrame(wheelFrameRef.current);
      wheelFrameRef.current = null;
    };
  }, [totalMs]);

  const handleZoom = useCallback((factor: number) => {
    const next = zoomCueTimelineView(viewRef.current, totalMs, factor, 0.5);
    if (next) setView(next);
  }, [totalMs]);
  const canZoomIn = view.end - view.start > Math.min(MIN_CUE_TIMELINE_WINDOW_MS, totalMs);
  const canZoomOut = view.end - view.start < totalMs;

  const combinedBeats = useMemo(() => flipLabCombinedBeatGrid(
    timeline,
    instrAnalysis.status === 'loaded' ? instrAnalysis.beatGrid?.beats ?? [] : [],
    instrTrack.bpm ?? 0,
  ), [instrAnalysis, instrTrack.bpm, timeline]);

  const vocalBox = laneBox(timeline.vocalStartSec, timeline.vocalSpanSec, view);
  const instrBox = laneBox(timeline.instrumentalStartSec, timeline.instrumentalSpanSec, view);
  const playheadProgress = (state.positionSec * 1000 - view.start) / Math.max(1, view.end - view.start);
  // Vocal separates first (0–50% of the combined progress), then the instrumental.
  const separating = state.phase === 'separating' || state.phase === 'error';
  const vocalFill = separating ? Math.max(0, Math.min(1, state.progress * 2)) : 1;
  const instrFill = separating ? Math.max(0, Math.min(1, (state.progress - 0.5) * 2)) : 1;

  return (
    <>
      <TrackHeader
        track={vocalTrack}
        targetBpm={instrTrack.bpm}
        keyShift={{
          enabled: state.keyShift,
          available: semitones != null,
          disabled: busy,
          semitones,
          onToggle: (next) => { void flipLab.setKeyShift(next); },
        }}
        solo={{ enabled: state.solo === 'vocal', disabled: busy, onToggle: () => flipLab.toggleSolo('vocal') }}
      />

      <div style={{ position: 'relative', height: 40, borderBottom: `1px solid ${BORDER_F}`, overflow: 'hidden' }}>
        <div style={vocalBox}><SectionRow segments={vocalSections} analysisStatus={vocalAnalysis.status} /></div>
      </div>

      <div ref={lanesRef} data-testid="flip-lab-lanes" className="group/waveform" style={{ position: 'relative' }}>
        <FillingWaveformLane
          box={vocalBox}
          fill={vocalFill}
          muted={state.solo === 'instrumental'}
          waveformState={vocalWaveformState}
          ariaLabel={`Waveform for ${vocalTrack.title}`}
        />
        <FillingWaveformLane
          box={instrBox}
          fill={instrFill}
          muted={state.solo === 'vocal'}
          waveformState={instrWaveformState}
          ariaLabel={`Waveform for ${instrTrack.title}`}
        />
        {state.phase === 'ready' && playheadProgress >= 0 && playheadProgress <= 1 && (
          <FlipLabPlayheadOverlay progress={playheadProgress} />
        )}
        <div
          className="pointer-events-none absolute right-2 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-0.5 opacity-0 transition-opacity duration-150 group-hover/waveform:opacity-100"
          aria-label="Waveform zoom controls"
        >
          <ControlButton
            className="pointer-events-auto h-[26px] w-[26px] min-h-0 border border-[var(--color-border-faint)] bg-[var(--color-card)]/80 px-0 backdrop-blur-sm"
            variant="surface"
            onClick={() => handleZoom(0.75)}
            disabled={!canZoomIn}
            aria-label="Zoom in"
            title="Zoom in"
          >
            <Add size={12} />
          </ControlButton>
          <ControlButton
            className="pointer-events-auto h-[26px] w-[26px] min-h-0 border border-[var(--color-border-faint)] bg-[var(--color-card)]/80 px-0 backdrop-blur-sm"
            variant="surface"
            onClick={() => handleZoom(1 / 0.75)}
            disabled={!canZoomOut}
            aria-label="Zoom out"
            title="Zoom out"
          >
            <Subtract size={12} />
          </ControlButton>
        </div>
      </div>

      <div style={{ position: 'relative', height: 40, borderBottom: `1px solid ${BORDER_F}`, overflow: 'hidden' }}>
        <div style={instrBox}><SectionRow segments={instrSections} analysisStatus={instrAnalysis.status} /></div>
      </div>

      <CombinedBeatGridLane beats={combinedBeats} view={view} />

      <TrackHeader
        track={instrTrack}
        titleSide="right"
        solo={{ enabled: state.solo === 'instrumental', disabled: busy, onToggle: () => flipLab.toggleSolo('instrumental') }}
      />

      <FlipLabAudioDock
        canPlay={state.phase === 'ready'}
        playing={state.playing}
        positionSec={state.positionSec}
        durationSec={timeline.totalSec}
        volume={state.volume}
        eq={state.eq}
        onTogglePlay={() => { void flipLab.togglePlay(); }}
        onSeek={flipLab.seek}
        onVolume={flipLab.setVolume}
        onEq={flipLab.setEqBand}
      />
    </>
  );
}

// ── Main FlipLabView ──────────────────────────────────────────────────────────
interface FlipLabViewProps {
  activeImport: import('../../types').RekordboxImport | null;
  activeImportLoading: boolean;
  activeImportError: string | null;
}

export function FlipLabView({ activeImport, activeImportLoading, activeImportError }: FlipLabViewProps) {
  const activeImportId = activeImport?.id ?? null;
  const activeImportIdRef = useRef<string | null>(activeImportId);
  const candidateLoadGenerationRef = useRef(0);
  activeImportIdRef.current = activeImportId;

  const [vocals,  setVocals]  = useState<RouletteCandidateAnalysis[]>([]);
  const [instrs,  setInstrs]  = useState<RouletteCandidateAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedVocalId, setSelectedVocalId] = useState<string | null>(null);
  const [selectedInstrId, setSelectedInstrId] = useState<string | null>(null);

  const [vocalTab, setVocalTab] = useState<'suggested' | 'library'>('library');
  const [instrTab, setInstrTab] = useState<'suggested' | 'library'>('library');
  const [vocalSearch, setVocalSearch] = useState('');
  const [instrSearch, setInstrSearch] = useState('');
  const [vocalVisibleIds, setVocalVisibleIds] = useState<string[]>([]);
  const [instrVisibleIds, setInstrVisibleIds] = useState<string[]>([]);

  const flipLab = useFlipLab();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { state: flipState, busy } = flipLab;
  const clearFlip = flipLab.clear;
  const globalPlayer = useAudioPlayer();

  useEffect(() => {
    const generation = ++candidateLoadGenerationRef.current;
    const controller = new AbortController();
    const requestImportId = activeImportId;

    // Import/session boundaries invalidate every old selection immediately.
    setVocals([]);
    setInstrs([]);
    setSelectedVocalId(null);
    setSelectedInstrId(null);
    setVocalVisibleIds([]);
    setInstrVisibleIds([]);
    setLoadError(null);
    setVocalTab('library');
    setInstrTab('library');
    setVocalSearch('');
    setInstrSearch('');
    clearFlip();

    if (activeImportLoading) {
      setLoading(true);
      return () => controller.abort();
    }
    if (activeImportError) {
      setLoading(false);
      setLoadError(activeImportError);
      return () => controller.abort();
    }
    if (!requestImportId) {
      setLoading(false);
      return () => controller.abort();
    }

    setLoading(true);
    void fetchFlipLabCandidatePools(requestImportId, { signal: controller.signal })
      .then((pools) => {
        if (!isCurrentFlipLabLoad(generation, candidateLoadGenerationRef.current, requestImportId, activeImportIdRef.current, controller.signal)) return;
        setVocals(pools.vocals);
        setInstrs(pools.instrumentals);
      })
      .catch((error: unknown) => {
        if (!isCurrentFlipLabLoad(generation, candidateLoadGenerationRef.current, requestImportId, activeImportIdRef.current, controller.signal)) return;
        setLoadError(error instanceof Error ? error.message : 'Failed to load tracks.');
      })
      .finally(() => {
        if (isCurrentFlipLabLoad(generation, candidateLoadGenerationRef.current, requestImportId, activeImportIdRef.current, controller.signal)) setLoading(false);
      });

    return () => controller.abort();
    // clearFlip changes identity with the flip phase; import changes are the only trigger here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeImportError, activeImportId, activeImportLoading]);

  const importId = activeImportId;

  const selectedVocal = useMemo(() => vocals.find(c => c.track.id === selectedVocalId) ?? null, [vocals, selectedVocalId]);
  const selectedInstr = useMemo(() => instrs.find(c => c.track.id === selectedInstrId) ?? null, [instrs, selectedInstrId]);
  const vocalAnalysis = useFlipLabTrackAnalysis(selectedVocalId);
  const instrAnalysis = useFlipLabTrackAnalysis(selectedInstrId);

  const vocalSuggested = useMemo(() => rankFlipLabSuggestions(vocals, selectedInstr, 'vocal'), [vocals, selectedInstr]);
  const instrSuggested = useMemo(() => rankFlipLabSuggestions(instrs, selectedVocal, 'instrumental'), [instrs, selectedVocal]);
  const vocalLibrary = useMemo(() => [...vocals].sort((a, b) => a.track.title.localeCompare(b.track.title)), [vocals]);
  const instrLibrary = useMemo(() => [...instrs].sort((a, b) => a.track.title.localeCompare(b.track.title)), [instrs]);

  // Waveform loading is bounded to selected tracks plus the virtualized visible windows.
  const waveformTrackIds = useMemo(() => {
    const ids = new Set([
      ...(selectedVocalId ? [selectedVocalId] : []),
      ...(selectedInstrId ? [selectedInstrId] : []),
      ...vocalVisibleIds,
      ...instrVisibleIds,
    ]);
    return [...ids];
  }, [selectedVocalId, selectedInstrId, vocalVisibleIds, instrVisibleIds]);

  const { getState: getWaveformState } = useTrackPreviewWaveforms(importId, waveformTrackIds);

  const [cueStates, setCueStates] = useState<ReadonlyMap<string, CueLoadState>>(new Map());
  const requestedCueIdsRef = useRef(new Set<string>());
  useEffect(() => {
    setCueStates(new Map());
    requestedCueIdsRef.current = new Set();
  }, [importId]);
  useEffect(() => {
    const missing = [...new Set([...vocalVisibleIds, ...instrVisibleIds])]
      .filter((id) => !requestedCueIdsRef.current.has(id));
    if (missing.length === 0) return;
    missing.forEach((id) => requestedCueIdsRef.current.add(id));
    void fetchTracksCueStates(missing)
      .then((result) => {
        setCueStates((current) => new Map([...current, ...result.states]));
        if (result.errors.length > 0) {
          logger.warn('fliplab.cues.load_failed', { trackCount: missing.length, errors: result.errors.map((e) => e.error) });
        }
      })
      .catch((error: unknown) => {
        missing.forEach((id) => requestedCueIdsRef.current.delete(id));
        logger.warn('fliplab.cues.load_failed', { trackCount: missing.length, message: error instanceof Error ? error.message : String(error) });
      });
  }, [instrVisibleIds, vocalVisibleIds]);
  const cueMarkersFor = useCallback((trackId: string) => cueMarkersFromState(cueStates.get(trackId)), [cueStates]);


  const commitSelection = useCallback((role: 'vocal' | 'instrumental', trackId: string) => {
    if (busy) return;
    if (flipState.loadedPair) clearFlip();
    const next = applyFlipLabSelection(role, trackId, selectedVocalId, selectedInstrId);
    setSelectedVocalId(next.vocalId);
    setSelectedInstrId(next.instrumentalId);
    if (role === 'vocal') setInstrTab('suggested');
    else setVocalTab('suggested');
  }, [busy, clearFlip, flipState.loadedPair, selectedInstrId, selectedVocalId]);

  const handleSelectVocal = useCallback((trackId: string) => commitSelection('vocal', trackId), [commitSelection]);
  const handleSelectInstrumental = useCallback((trackId: string) => commitSelection('instrumental', trackId), [commitSelection]);

  const analysesSettled = vocalAnalysis.status !== 'loading' && instrAnalysis.status !== 'loading';
  const pairIsLoaded = flipState.loadedPair !== null
    && flipState.loadedPair.vocalId === selectedVocalId
    && flipState.loadedPair.instrumentalId === selectedInstrId;
  const canFlip = selectedVocal !== null && selectedInstr !== null && !busy && analysesSettled
    && !(pairIsLoaded && flipState.phase === 'ready');

  const handleFlip = useCallback(() => {
    if (!selectedVocal || !selectedInstr) return;
    void flipLab.flip({
      vocal: selectedVocal.track,
      instrumental: selectedInstr.track,
      vocalBeatGrid: vocalAnalysis.status === 'loaded' ? vocalAnalysis.beatGrid : null,
      instrumentalBeatGrid: instrAnalysis.status === 'loaded' ? instrAnalysis.beatGrid : null,
    });
  }, [flipLab, instrAnalysis, selectedInstr, selectedVocal, vocalAnalysis]);

  const handleClearPair = useCallback(() => {
    clearFlip();
    setSelectedVocalId(null);
    setSelectedInstrId(null);
    setVocalTab('library');
    setInstrTab('library');
  }, [clearFlip]);

  const [dismissedNotificationIds, setDismissedNotificationIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    setDismissedNotificationIds(new Set());
  }, [flipState.errors, flipState.warnings]);
  const notifications = useMemo<AppNotification[]>(() => [
    ...flipState.errors.map((message) => ({ id: `error:${message}`, tone: 'error' as const, title: "Flip didn't work", message })),
    ...flipState.warnings.map((message) => ({ id: `warning:${message}`, tone: 'warning' as const, title: 'Heads up', message })),
  ].filter((notification) => !dismissedNotificationIds.has(notification.id)), [dismissedNotificationIds, flipState.errors, flipState.warnings]);
  const dismissNotification = useCallback((id: string) => {
    setDismissedNotificationIds((current) => new Set(current).add(id));
  }, []);

  const handlePreview = useCallback((track: RekordboxTrack) => {
    flipLab.pause();
    void globalPlayer.toggleTrack(track);
  }, [flipLab, globalPlayer]);

  const previewStatusFor = useCallback((trackId: string): 'idle' | 'loading' | 'playing' => {
    if (globalPlayer.activeTrack?.id !== trackId) return 'idle';
    if (globalPlayer.status === 'resolving' || globalPlayer.status === 'loading') return 'loading';
    return globalPlayer.playIntent ? 'playing' : 'idle';
  }, [globalPlayer.activeTrack?.id, globalPlayer.playIntent, globalPlayer.status]);

  const showLoadedPair = pairIsLoaded && selectedVocal !== null && selectedInstr !== null && flipState.timeline !== null;

  return (
    <div ref={rootRef} style={{
      display: 'flex', flexDirection: 'column',
      flex: 1, minHeight: 0, overflowY: 'auto',
      borderTop: `1px solid ${BORDER_F}`,
      borderBottom: `1px solid ${BORDER_F}`,
      background: BG, fontFamily: 'inherit',
    }}>
      <style>{FLIP_LAB_KEYFRAMES}</style>
      <NotificationCenter notifications={notifications} onDismiss={dismissNotification} label="Flip Lab notifications" />
      {busy && <FlipLoadingOverlay phase={flipState.phase} progress={flipState.progress} />}
      <FlipFloatingControls
        anchorRef={rootRef}
        canFlip={canFlip}
        canClear={pairIsLoaded}
        onFlip={handleFlip}
        onClear={handleClearPair}
      />

      {showLoadedPair ? (
        <div style={{ flexShrink: 0 }}>
          <TopWaveformSection
            vocalTrack={selectedVocal.track}
            instrTrack={selectedInstr.track}
            vocalAnalysis={vocalAnalysis}
            instrAnalysis={instrAnalysis}
            vocalWaveformState={getWaveformState(selectedVocal.track.id)}
            instrWaveformState={getWaveformState(selectedInstr.track.id)}
            timeline={flipState.timeline!}
            flipLab={flipLab}
          />
        </div>
      ) : (
        <div
          data-testid="flip-lab-empty-pair"
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 6, minHeight: 200, flexShrink: 0, padding: '32px 16px', background: BG, textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 800, color: FG }}>No pair loaded</div>
          <div style={{ fontSize: 11, color: MUTED }}>
            Pick a vocal track and an instrumental track below, then press Flip.
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: '48px 16px', textAlign: 'center', fontSize: 12, color: MUTED }}>
          Loading tracks…
        </div>
      ) : loadError ? (
        <div style={{ padding: '48px 16px', textAlign: 'center', fontSize: 12, color: ERROR_RED }}>
          {loadError}
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          borderTop: `1px solid ${BORDER_F}`,
          flex: 1,
          minHeight: 200,
          overflow: 'hidden',
        }}>
          <SelectPanel
            role="vocal"
            suggested={vocalSuggested}
            library={vocalLibrary}
            selectedId={selectedVocalId}
            onSelect={handleSelectVocal}
            tab={vocalTab}
            onTabChange={setVocalTab}
            search={vocalSearch}
            onSearchChange={setVocalSearch}
            getWaveformState={getWaveformState}
            onVisibleTrackIdsChange={setVocalVisibleIds}
            otherTrack={selectedInstr?.track ?? null}
            onPreview={handlePreview}
            previewStatusFor={previewStatusFor}
            cueMarkersFor={cueMarkersFor}
            disabled={busy}
          />
          <SelectPanel
            role="instrumental"
            suggested={instrSuggested}
            library={instrLibrary}
            selectedId={selectedInstrId}
            onSelect={handleSelectInstrumental}
            tab={instrTab}
            onTabChange={setInstrTab}
            search={instrSearch}
            onSearchChange={setInstrSearch}
            getWaveformState={getWaveformState}
            onVisibleTrackIdsChange={setInstrVisibleIds}
            otherTrack={selectedVocal?.track ?? null}
            onPreview={handlePreview}
            previewStatusFor={previewStatusFor}
            cueMarkersFor={cueMarkersFor}
            disabled={busy}
          />
        </div>
      )}
    </div>
  );
}
