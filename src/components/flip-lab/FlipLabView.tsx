import { useState, useEffect, useMemo, useCallback, useRef, useDeferredValue } from 'react';
import {
  classifyCamelotRelationship,
  getCamelotRelationshipLabel,
  type CamelotRelationship,
} from '../../lib/music/camelot';
import { fetchRouletteCandidatePools } from '../../lib/queries/rouletteCandidates';
import type { RouletteCandidateAnalysis, RouletteHardFilterReason } from '../../features/roulette/rouletteMatching';
import {
  applyFlipLabSelection,
  flipLabRejectionReasonLabel,
  getFlipLabPairRejectionReason,
  rankFlipLabSuggestions,
} from './flipLabMatching';
import { useTrackPreviewWaveforms } from '../../hooks/useTrackPreviewWaveforms';
import { useLatestRekordboxImport } from '../../hooks/useLatestRekordboxImport';
import { useAuthSession } from '../../hooks/useAuthSession';
import { RekordboxPreviewWaveform } from '../library/RekordboxPreviewWaveform';
import { useAppRouter } from '../../navigation/useAppRouter';
import { Dialog } from '../ui/feedback';
import type { RekordboxTrack } from '../../types';
import type { WaveformLoadState } from '../../lib/queries/waveformValidation';
import { fetchTrackBeatGrid, fetchTrackPhrases, type BeatGridRow, type PhraseRow } from '../../lib/queries/analysisData';
import type { RoulettePreviewWindow } from '../../features/roulette/roulettePreview';
import {
  flipLabStemLifecycle,
  flipLabStemStatusPresentation,
  isFlipLabStemUsable,
  type FlipLabStemRoleState,
} from './flipLabStemLifecycle';
import {
  deriveFlipLabAlignment,
  deriveFlipLabBarRuler,
  formatSignedBpmDelta,
  mapPhrasesToTimelineSegments,
  resolveFlipLabArtist,
  resolveFlipLabCamelotKey,
  signedVocalBpmDelta,
  trackDurationMs,
  type FlipLabAlignmentState,
  type FlipLabTimelineSegment,
} from './flipLabAnalysis';
import {
  formatFlipLabEqDb,
  resolveFlipLabPreparedPlayheadPercent,
  useFlipLabAudioRuntime,
  type FlipLabCandidatePreviewState,
  type FlipLabLoopBars,
  type FlipLabPlaybackState,
  type FlipLabPreparedVisualizationState,
} from './useFlipLabAudioRuntime';
import type { RouletteEqBand, RouletteEqState, RoulettePlaybackResult } from '../../features/roulette/rouletteAudioRuntime';
import {
  FLIP_LAB_ROW_HEIGHT,
  computeFlipLabWindowRange,
  filterFlipLabCandidates,
  isCurrentFlipLabLoad,
  scrollTopForFlipLabSelection,
} from './flipLabPerformance';
import { buildFlipLabDropLabRoute } from './flipLabHandoff';
import {
  FLIP_LAB_SESSION_VERSION,
  createDefaultFlipLabSession,
  loadFlipLabSession,
  resolveFlipLabRestoredSelection,
  saveFlipLabSession,
  type FlipLabPersistedSession,
} from './flipLabSession';

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

function matchDotColor(rel: CamelotRelationship | null): string {
  if (rel === null) return '#4b5563'; // no other track selected → neutral
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

// ── Camelot key badge ─────────────────────────────────────────────────────────
function CamelotBadge({ k }: { k: string }) {
  const color = camelotColor(k);
  return (
    <span style={{
      padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 700, flexShrink: 0,
      background: `${color}20`, border: `1px solid ${color}50`, color,
    }}>{k}</span>
  );
}

// ── EQ knob ───────────────────────────────────────────────────────────────────
function LargeKnob({ color, size = 36, value = 0 }: { color: string; size?: number; value?: number }) {
  const angle = -135 + ((value + 12) / 24) * 270;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', position: 'relative',
      border: `1px solid ${CTRL_BDR}`, background: CTRL_BG,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: `0 0 8px ${color}18`, flexShrink: 0,
    }}>
      <div style={{
        position: 'absolute', inset: 4, borderRadius: '50%', transform: `rotate(${angle}deg)`,
      }}>
        <div style={{ width: 2, height: size * 0.25, borderRadius: 3, background: color, margin: '0 auto' }} />
      </div>
    </div>
  );
}

function EqKnob({
  role,
  band,
  value,
  color,
  onChange,
}: {
  role: 'vocal' | 'instrumental';
  band: RouletteEqBand;
  value: number;
  color: string;
  onChange: (value: number) => void;
}) {
  const roleLabel = role === 'vocal' ? 'Vocal' : 'Instrumental';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
      <div style={{ position: 'relative', width: 36, height: 36 }} title="Double-click or press Escape to reset to 0 dB">
        <LargeKnob color={color} size={36} value={value} />
        <input
          type="range"
          min={-12}
          max={12}
          step={0.5}
          value={value}
          aria-label={`${roleLabel} ${band} EQ`}
          aria-keyshortcuts="Escape"
          onChange={(event) => onChange(Number(event.target.value))}
          onDoubleClick={() => onChange(0)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onChange(0);
            }
          }}
          style={{
            position: 'absolute', inset: 0, width: 36, height: 36,
            opacity: 0, cursor: 'ew-resize', margin: 0,
          }}
        />
      </div>
      <div style={{ fontSize: 8, color: MUTED, letterSpacing: '0.1em' }}>{band.toUpperCase()}</div>
      <div data-testid={`flip-lab-${role}-${band}-db`} style={{ fontSize: 8, color: FG, opacity: 0.6 }}>
        {formatFlipLabEqDb(value)}
      </div>
    </div>
  );
}

function PreparedStemWaveform({
  role,
  peaks,
  color,
  message,
}: {
  role: 'vocal' | 'instrumental';
  peaks: number[];
  color: string;
  message: string;
}) {
  if (peaks.length === 0) {
    return (
      <div
        data-testid={`flip-lab-${role}-stem-waveform-empty`}
        style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 9 }}
      >{message}</div>
    );
  }

  const width = 1000;
  const height = 88;
  const center = height / 2;
  return (
    <svg
      data-testid={`flip-lab-${role}-stem-waveform`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-label={`${role} prepared stem waveform`}
      role="img"
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      <line x1="0" x2={width} y1={center} y2={center} stroke="var(--color-waveform-grid)" strokeOpacity="0.5" strokeWidth="1" />
      {peaks.map((peak, index) => {
        const x = peaks.length <= 1 ? width / 2 : (index / (peaks.length - 1)) * width;
        const amplitude = Math.max(1, Math.min(center - 3, peak * (center - 5)));
        return (
          <line
            key={`${role}-${index}`}
            x1={x}
            x2={x}
            y1={center - amplitude}
            y2={center + amplitude}
            stroke={color}
            strokeOpacity={0.9}
            strokeWidth={Math.max(1, width / Math.max(peaks.length, 1) * 0.55)}
          />
        );
      })}
    </svg>
  );
}

// ── Section label row (matches CuePointsView section lane) ───────────────────
function SectionRow({ segments, analysisStatus }: {
  segments: FlipLabTimelineSegment[];
  analysisStatus: FlipLabTrackAnalysisState['status'];
}) {
  const emptyLabel = analysisStatus === 'loading'
    ? 'Loading phrase data…'
    : analysisStatus === 'error'
      ? 'Phrase data unavailable'
      : 'Phrase data unavailable';

  return (
    <div style={{ position: 'relative', height: 40, borderBottom: `1px solid ${BORDER_F}` }}>
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

// ── Track header (real data when track provided, placeholder otherwise) ───────
interface TrackHeaderProps {
  track: RekordboxTrack | null;
  placeholderEmoji: string;
  placeholderTitle: string;
  placeholderArtist: string;
  placeholderBpm: string;
  role: 'VOCAL' | 'INSTRUMENTAL';
  roleColor: string;
  onClear?: () => void;
}

function TrackHeader({ track, placeholderEmoji, placeholderTitle, placeholderArtist, placeholderBpm, role, roleColor, onClear }: TrackHeaderProps) {
  const title   = track?.title ?? placeholderTitle;
  const artist  = resolveFlipLabArtist(track, placeholderArtist);
  const bpm     = track?.bpm != null ? track.bpm.toFixed(0) : placeholderBpm;
  const keyStr  = track ? resolveFlipLabCamelotKey(track) : null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 16px', background: PANEL, borderBottom: `1px solid ${BORDER_F}`,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 7, flexShrink: 0,
        background: SURFACE, border: `1px solid ${BORDER_S}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
      }}>{placeholderEmoji}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: FG, letterSpacing: '-0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        <div style={{ fontSize: 11, color: MUTED, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{artist}</div>
      </div>
      <span style={{
        padding: '3px 8px', borderRadius: 4, fontSize: 9, fontWeight: 800,
        background: `${roleColor}18`, border: `1px solid ${roleColor}30`,
        color: roleColor, letterSpacing: '0.08em', flexShrink: 0,
      }}>{role}</span>
      {track && onClear && (
        <button
          type="button"
          aria-label={`Clear ${role.toLowerCase()} selection`}
          title={`Clear ${role.toLowerCase()} selection`}
          onClick={onClear}
          style={{
            width: 24, height: 24, borderRadius: 6, padding: 0,
            background: SURFACE, border: `1px solid ${BORDER_S}`,
            color: MUTED, cursor: 'pointer', fontSize: 13, lineHeight: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}
        >×</button>
      )}
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 8, color: MUTED, letterSpacing: '0.08em', textTransform: 'uppercase' }}>BPM</div>
          <div style={{ fontSize: 15, fontWeight: 900, color: FG, fontVariantNumeric: 'tabular-nums' }}>{bpm}</div>
        </div>
        {keyStr ? <CamelotBadge k={keyStr} /> : (
          <span style={{ fontSize: 10, color: MUTED, padding: '2px 7px', border: `1px solid ${BORDER_S}`, borderRadius: 4 }}>—</span>
        )}
      </div>
    </div>
  );
}

// ── Track selector row ────────────────────────────────────────────────────────
const ROW_GRID = '36px 24px minmax(0,1fr) 80px 40px 38px 12px 20px';
const ROW_GAP  = 6;

function TrackSelectorRow({
  role,
  candidate,
  selected,
  onSelect,
  onPreview,
  previewState,
  waveformState,
  otherTrack,
}: {
  role: 'vocal' | 'instrumental';
  candidate: RouletteCandidateAnalysis;
  selected: boolean;
  onSelect: () => void;
  onPreview: () => void;
  previewState: FlipLabCandidatePreviewState;
  waveformState: WaveformLoadState;
  otherTrack: RekordboxTrack | null;
}) {
  const { track } = candidate;
  const bpm    = track.bpm != null ? track.bpm.toFixed(0) : '—';
  const keyStr = resolveFlipLabCamelotKey(track);
  const keyClr = camelotColor(keyStr);
  const initials = `${(track.artist?.[0] ?? track.title[0] ?? '?')}${track.title[0] ?? '?'}`.toUpperCase();

  const rel = useMemo<CamelotRelationship | null>(() => {
    if (!otherTrack) return null;
    const mine   = resolveFlipLabCamelotKey(track);
    const theirs = resolveFlipLabCamelotKey(otherTrack);
    if (!mine || !theirs) return 'unknown';
    return classifyCamelotRelationship(mine, theirs);
  }, [track, otherTrack]);

  const dotClr = matchDotColor(rel);

  const previewing = previewState.role === role && previewState.trackId === track.id;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(event) => {
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
        padding: '7px 12px',
        background: selected ? `${PRIMARY}12` : 'transparent',
        border: 'none',
        borderBottom: `1px solid ${BORDER_F}`,
        borderLeft: `2px solid ${selected ? PRIMARY : 'transparent'}`,
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      {/* Avatar */}
      <div style={{
        width: 36, height: 36, borderRadius: 6,
        background: selected ? `${PRIMARY}28` : SURFACE,
        border: `1px solid ${BORDER_S}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 800,
        color: selected ? PRIMARY : MUTED, flexShrink: 0,
      }}>{initials}</div>

      {/* Role-stem preview. This is intentionally separate from row selection. */}
      <button
        type="button"
        aria-label={`${previewing && previewState.status === 'playing' ? 'Stop' : 'Preview'} ${track.title} ${role} stem`}
        aria-pressed={previewing && previewState.status === 'playing'}
        onClick={(event) => {
          event.stopPropagation();
          onPreview();
        }}
        onKeyDown={(event) => event.stopPropagation()}
        style={{
          width: 24, height: 24, borderRadius: '50%', padding: 0,
          background: previewing ? `${role === 'vocal' ? SECONDARY : PRIMARY}20` : CTRL_BG,
          border: `1px solid ${previewing ? (role === 'vocal' ? SECONDARY : PRIMARY) : CTRL_BDR}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 7, color: previewing ? (role === 'vocal' ? SECONDARY : PRIMARY) : FG,
          flexShrink: 0, cursor: 'pointer',
        }}
      >{previewing && previewState.status === 'loading' ? '…' : previewing && previewState.status === 'playing' ? '■' : '▶'}</button>

      {/* Title + artist */}
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

      {/* Mini waveform */}
      <div style={{ height: 24, overflow: 'hidden' }}>
        <RekordboxPreviewWaveform
          state={waveformState}
          height={24}
          variant="compact"
          showCenterLine={false}
          surface={false}
        />
      </div>

      {/* BPM */}
      <div style={{
        fontSize: 11, fontWeight: 700, color: FG,
        fontVariantNumeric: 'tabular-nums', textAlign: 'center',
      }}>{bpm}</div>

      {/* Key badge */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        {keyStr ? (
          <span style={{
            padding: '1px 5px', borderRadius: 3,
            background: `${keyClr}20`, border: `1px solid ${keyClr}50`,
            color: keyClr, fontSize: 9, fontWeight: 700,
          }}>{keyStr}</span>
        ) : (
          <span style={{ fontSize: 9, color: MUTED }}>—</span>
        )}
      </div>

      {/* Match dot */}
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

// ── Track list column header row ──────────────────────────────────────────────
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
      {['', '', 'Track', '', 'BPM', 'Key', 'Match', ''].map((label, i) => (
        <div key={i} style={{
          fontSize: 8, fontWeight: 800, color: MUTED,
          letterSpacing: '0.08em', textTransform: 'uppercase',
          textAlign: i >= 3 ? 'center' : 'left',
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
  previewState: FlipLabCandidatePreviewState;
}

function SelectPanel({
  role, suggested, library,
  selectedId, onSelect,
  tab, onTabChange,
  search, onSearchChange,
  getWaveformState, onVisibleTrackIdsChange, otherTrack,
  onPreview, previewState,
}: SelectPanelProps) {
  const isVocal = role === 'vocal';
  const roleColor = isVocal ? SECONDARY : PRIMARY;
  const roleLabel = isVocal ? 'Vocal' : 'Instrumental';
  const roleEmoji = isVocal ? '🎤' : '⚡';
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
    const nextScrollTop = scrollTopForFlipLabSelection(
      selectedIndex,
      currentScrollTop,
      viewportHeight,
    );
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
      borderLeft: !isVocal ? `1px solid ${BORDER_F}` : undefined,
      background: BG, minHeight: 0, overflow: 'hidden',
    }}>
      {/* Panel header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px 10px',
        background: PANEL, borderBottom: `1px solid ${BORDER_F}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: `${roleColor}18`, border: `1px solid ${roleColor}30`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
          }}>{roleEmoji}</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: FG }}>Select {roleLabel}</div>
            <div style={{ fontSize: 10, color: MUTED }}>Choose a {role} stem to pair</div>
          </div>
        </div>
        {/* Suggested | Library tabs */}
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

      {/* Search row */}
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

      {/* Column header */}
      <TrackListColumnHeader />

      {/* Track list: lightweight fixed-row windowing keeps huge libraries bounded. */}
      <div
        ref={listRef}
        onScroll={(event) => {
          scrollTopRef.current = event.currentTarget.scrollTop;
          setScrollTop(event.currentTarget.scrollTop);
        }}
        style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}
      >
        {filtered.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: 11, color: MUTED }}>
            {tab === 'suggested' && suggested.length === 0
              ? (otherTrack ? 'No compatible suggestions for this selection.' : 'Select the opposite role to see suggestions.')
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
                  role={role}
                  candidate={c}
                  selected={c.track.id === selectedId}
                  onSelect={() => onSelect(c.track.id)}
                  onPreview={() => onPreview(c.track)}
                  previewState={previewState}
                  waveformState={getWaveformState(c.track.id)}
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

// ── Compatibility panel (center column) ───────────────────────────────────────
interface CompatibilityPanelProps {
  vocal:   RouletteCandidateAnalysis | null;
  instr:   RouletteCandidateAnalysis | null;
  vocalStemState: FlipLabStemRoleState;
  instrStemState: FlipLabStemRoleState;
  keyRel:  CamelotRelationship | null;
  bpmDelta: number | null;
  phraseAlignment: FlipLabAlignmentState;
  pairRejectionReason: RouletteHardFilterReason | null;
  onOpenDropLab: () => void;
}

function CompatibilityPanel({
  vocal,
  instr,
  vocalStemState,
  instrStemState,
  keyRel,
  bpmDelta,
  phraseAlignment,
  pairRejectionReason,
  onOpenDropLab,
}: CompatibilityPanelProps) {
  const vocalKey = vocal ? resolveFlipLabCamelotKey(vocal.track) : null;
  const instrKey = instr ? resolveFlipLabCamelotKey(instr.track) : null;

  const keyInfo = keyRel ? (() => {
    switch (keyRel) {
      case 'exact':
      case 'relative':
      case 'adjacent_up':
      case 'adjacent_down':
        return { label: 'Compatible', color: '#22c55e' };
      case 'energy_boost':
        return { label: 'Energy Boost', color: '#f59e0b' };
      case 'incompatible':
        return { label: 'Avoid', color: '#ef4444' };
      case 'unknown':
        return { label: 'Unknown', color: '#6b7280' };
    }
  })() : null;

  const bpmInfo = bpmDelta != null ? (() => {
    const magnitude = Math.abs(bpmDelta);
    if (magnitude <= 2) return { label: 'Easy Mix', color: '#22c55e' };
    if (magnitude <= 5) return { label: 'Moderate', color: '#f59e0b' };
    return { label: 'Hard Mix', color: '#ef4444' };
  })() : null;
  const alignmentColor = phraseAlignment.status === 'aligned'
    ? '#22c55e'
    : phraseAlignment.status === 'offset'
      ? '#f59e0b'
      : phraseAlignment.status === 'cannot-align'
        ? '#ef4444'
        : MUTED;

  const matchingReady = vocal !== null && instr !== null && pairRejectionReason === null;
  const mediaReady = isFlipLabStemUsable(vocalStemState, vocal?.track.id)
    && isFlipLabStemUsable(instrStemState, instr?.track.id);
  const pairReady = matchingReady && mediaReady;
  const rejectionLabel = flipLabRejectionReasonLabel(pairRejectionReason);
  const vocalStemInfo = flipLabStemStatusPresentation(vocalStemState);
  const instrStemInfo = flipLabStemStatusPresentation(instrStemState);
  const mediaPreparing = [vocalStemState.status, instrStemState.status].some((status) => (
    status === 'checking' || status === 'queued' || status === 'processing'
  ));
  const notReadyMessage = rejectionLabel
    ?? (mediaPreparing ? 'Preparing audition media…' : 'Both role stems must be ready to audition.');

  const InfoRow = ({ icon, label, value, valueColor, subtitle }: { icon: string; label: string; value: string; valueColor: string; subtitle?: string }) => (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '10px 0', borderBottom: `1px solid ${BORDER_F}`,
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 7, flexShrink: 0, marginTop: 1,
        background: SURFACE, border: `1px solid ${BORDER_S}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12,
      }}>{icon}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 10, color: MUTED, marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: valueColor }}>{value}</div>
        {subtitle && <div style={{ fontSize: 9, color: MUTED, marginTop: 1 }}>{subtitle}</div>}
      </div>
    </div>
  );

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      background: PANEL, minHeight: 0,
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 14px 10px',
        borderBottom: `1px solid ${BORDER_F}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: `${SECONDARY}18`, border: `1px solid ${SECONDARY}30`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
          }}>〜</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: FG }}>Compatibility</div>
            <div style={{ fontSize: 10, color: MUTED }}>Analysis for this pair</div>
          </div>
        </div>
      </div>

      <div style={{ padding: '0 14px', flex: 1, overflowY: 'auto' }}>
        {/* Key codes display */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '14px 0 10px',
          borderBottom: `1px solid ${BORDER_F}`,
        }}>
          {vocalKey
            ? <CamelotBadge k={vocalKey} />
            : <span style={{ fontSize: 11, color: MUTED, padding: '2px 8px', border: `1px solid ${BORDER_S}`, borderRadius: 4 }}>—</span>
          }
          <span style={{ fontSize: 12, color: MUTED }}>→</span>
          {instrKey
            ? <CamelotBadge k={instrKey} />
            : <span style={{ fontSize: 11, color: MUTED, padding: '2px 8px', border: `1px solid ${BORDER_S}`, borderRadius: 4 }}>—</span>
          }
        </div>

        {/* Key relationship */}
        <InfoRow
          icon="🎵"
          label="Key Relationship"
          value={keyInfo ? `${getCamelotRelationshipLabel(keyRel!)} — ${keyInfo.label}` : '—'}
          valueColor={keyInfo?.color ?? MUTED}
          subtitle={keyInfo?.label === 'Compatible' ? undefined : (keyRel ? undefined : 'Select both tracks to analyze')}
        />

        {/* BPM Difference */}
        <InfoRow
          icon="⏱"
          label="BPM Difference"
          value={formatSignedBpmDelta(bpmDelta)}
          valueColor={bpmInfo?.color ?? MUTED}
          subtitle={bpmInfo?.label}
        />

        {/* Phrase Alignment */}
        <InfoRow
          icon="📐"
          label="Phrase Alignment"
          value={phraseAlignment.label}
          valueColor={alignmentColor}
          subtitle={phraseAlignment.subtitle ?? undefined}
        />

        {/* Stem Availability */}
        <div style={{ padding: '10px 0', borderBottom: `1px solid ${BORDER_F}` }}>
          <div style={{ fontSize: 10, color: MUTED, marginBottom: 6 }}>Stem Availability</div>
          {[
            { label: 'Vocal', selected: Boolean(vocal), state: vocalStemState, info: vocalStemInfo },
            { label: 'Instrumental', selected: Boolean(instr), state: instrStemState, info: instrStemInfo },
          ].map(({ label, selected, state, info }) => (
            <div key={label} style={{ marginBottom: 5 }} title={state.message ?? undefined}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{
                  width: 7, height: 7, borderRadius: '50%',
                  background: selected ? info.color : '#4b5563',
                }} />
                <span style={{ fontSize: 10, color: MUTED }}>{label}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: selected ? info.color : '#4b5563' }}>
                  {selected ? info.label : 'Not selected'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Flip Lab readiness is status only. Drop Lab is a separate parent-track handoff. */}
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {!vocal || !instr ? (
          <div style={{
            padding: '12px 14px', borderRadius: 10, textAlign: 'center',
            background: SURFACE, border: `1px solid ${BORDER_S}`,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: MUTED }}>Select both tracks</div>
            <div style={{ fontSize: 10, color: MUTED, marginTop: 2, opacity: 0.7 }}>Choose a vocal and instrumental to analyze compatibility.</div>
          </div>
        ) : pairReady ? (
          <div
            data-testid="flip-lab-pair-ready"
            style={{
              padding: '12px 14px', borderRadius: 10, textAlign: 'center',
              background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 800, color: '#22c55e' }}>✓ Pair Ready</div>
            <div style={{ fontSize: 10, color: '#22c55e', opacity: 0.75, marginTop: 2 }}>Ready for Flip Lab audition playback.</div>
          </div>
        ) : (
          <div
            data-testid="flip-lab-pair-not-ready"
            style={{
              padding: '12px 14px', borderRadius: 10, textAlign: 'center',
              background: `${PRIMARY}10`, border: `1px solid ${PRIMARY}30`,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 800, color: PRIMARY }}>Pair Not Ready</div>
            <div style={{ fontSize: 10, color: PRIMARY, opacity: 0.7, marginTop: 2 }}>
              {notReadyMessage}
            </div>
          </div>
        )}

        {vocal && instr && (
          <button
            type="button"
            data-testid="flip-lab-drop-lab-handoff"
            onClick={onOpenDropLab}
            title="Pass the two selected parent tracks to Drop Lab. Flip Lab stems and mixer state do not carry over."
            style={{
              width: '100%', padding: '9px 12px', borderRadius: 8,
              background: SURFACE, border: `1px solid ${BORDER_S}`,
              color: FG, cursor: 'pointer', textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 800 }}>Test Transition in Drop Lab →</div>
            <div style={{ fontSize: 8, color: MUTED, marginTop: 2 }}>Selected parent tracks only</div>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Top waveform section ──────────────────────────────────────────────────────
function TopWaveformSection({
  vocalTrack,
  instrTrack,
  vocalAnalysis,
  instrAnalysis,
  vocalStemState,
  instrStemState,
  vocalWindow,
  instrWindow,
  playback,
  visualization,
  visualResult,
  eq,
  mixPosition,
  loopBars,
  loopOptions,
  masterBpm,
  playbackReady,
  onClearVocal,
  onClearInstrumental,
  onTogglePlayPause,
  onSeekStart,
  onSeekBackwardBar,
  onSeekForwardBar,
  onSeekEnd,
  onToggleSync,
  onSetEqBand,
  onMixPositionChange,
  onLoopChange,
}: {
  vocalTrack: RekordboxTrack | null;
  instrTrack: RekordboxTrack | null;
  vocalAnalysis: FlipLabTrackAnalysisState;
  instrAnalysis: FlipLabTrackAnalysisState;
  vocalStemState: FlipLabStemRoleState;
  instrStemState: FlipLabStemRoleState;
  vocalWindow: RoulettePreviewWindow | null;
  instrWindow: RoulettePreviewWindow | null;
  playback: FlipLabPlaybackState;
  visualization: FlipLabPreparedVisualizationState;
  visualResult: RoulettePlaybackResult | null;
  eq: RouletteEqState;
  mixPosition: number;
  loopBars: FlipLabLoopBars;
  loopOptions: FlipLabLoopBars[];
  masterBpm: number | null;
  playbackReady: boolean;
  onClearVocal: () => void;
  onClearInstrumental: () => void;
  onTogglePlayPause: () => void;
  onSeekStart: () => void;
  onSeekBackwardBar: () => void;
  onSeekForwardBar: () => void;
  onSeekEnd: () => void;
  onToggleSync: () => void;
  onSetEqBand: (role: 'vocal' | 'instrumental', band: RouletteEqBand, value: number) => void;
  onMixPositionChange: (position: number) => void;
  onLoopChange: (bars: FlipLabLoopBars) => void;
}) {
  const vocalSections = useMemo(() => (
    vocalAnalysis.status === 'loaded'
      ? mapPhrasesToTimelineSegments(vocalAnalysis.phrases, trackDurationMs(vocalTrack), vocalWindow)
      : []
  ), [vocalAnalysis, vocalTrack, vocalWindow]);
  const instrSections = useMemo(() => (
    instrAnalysis.status === 'loaded'
      ? mapPhrasesToTimelineSegments(instrAnalysis.phrases, trackDurationMs(instrTrack), instrWindow)
      : []
  ), [instrAnalysis, instrTrack, instrWindow]);
  const barRuler = useMemo(() => deriveFlipLabBarRuler(
    vocalAnalysis.status === 'loaded' ? vocalAnalysis.beatGrid : null,
    instrAnalysis.status === 'loaded' ? instrAnalysis.beatGrid : null,
    vocalWindow,
    instrWindow,
  ), [vocalAnalysis, instrAnalysis, vocalWindow, instrWindow]);
  const preparedPlayheadPercent = resolveFlipLabPreparedPlayheadPercent(
    playback.positionSeconds,
    playback.durationSeconds || visualResult?.durationSeconds || 0,
  );
  const transportAvailable = playback.result !== null && playback.durationSeconds > 0;
  const playDisabled = playback.status === 'loading' || (!playbackReady && playback.status !== 'playing' && playback.status !== 'paused');
  const waveformMessage = (state: FlipLabStemRoleState) => {
    if (visualization.status === 'loading' && state.status === 'ready') return 'Loading prepared stem waveform…';
    if (visualization.status === 'error' && state.status === 'ready') return visualization.error ?? 'Prepared stem waveform unavailable.';
    return state.status === 'ready'
      ? 'Prepared stem waveform is waiting for audio decode.'
      : flipLabStemStatusPresentation(state).label;
  };
  const loopChoices: FlipLabLoopBars[] = [4, 8, 16, 32, 'off'];

  return (
    <>
      <TrackHeader
        track={vocalTrack}
        placeholderEmoji="🎤"
        placeholderTitle="Select a vocal stem"
        placeholderArtist="No vocal selected"
        placeholderBpm="—"
        role="VOCAL"
        roleColor={SECONDARY}
        onClear={onClearVocal}
      />

      <div style={{
        display: 'flex', alignItems: 'center', height: 16,
        padding: '0 16px', background: BG, borderBottom: `1px solid ${BORDER_F}`,
      }}>
        <span style={{ fontSize: 7, color: MUTED, marginRight: 6, flexShrink: 0, letterSpacing: '0.08em' }}>BAR</span>
        <div style={{ position: 'relative', flex: 1, height: '100%' }}>
          {barRuler.status === 'available' ? barRuler.markers.map((marker) => (
            <span key={`${marker.label}-${marker.percent}`} style={{
              position: 'absolute', left: `${marker.percent}%`, top: '50%', transform: 'translateY(-50%)',
              fontSize: 7, color: MUTED, opacity: 0.6, fontVariantNumeric: 'tabular-nums',
            }}>{marker.label}</span>
          )) : (
            <span style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 7, color: MUTED, opacity: 0.55,
            }}>Bar grid unavailable</span>
          )}
        </div>
      </div>

      <SectionRow segments={vocalSections} analysisStatus={vocalAnalysis.status} />

      <div style={{ height: 88, position: 'relative', overflow: 'hidden', background: BG }}>
        <PreparedStemWaveform
          role="vocal"
          peaks={visualResult?.waveforms.vocal ?? []}
          color={SECONDARY}
          message={waveformMessage(vocalStemState)}
        />
        {transportAvailable && (
          <div
            data-testid="flip-lab-vocal-playhead"
            style={{
              position: 'absolute', top: 0, bottom: 0, left: `${preparedPlayheadPercent}%`, width: 1,
              background: SECONDARY, boxShadow: `0 0 8px ${SECONDARY}`, pointerEvents: 'none', zIndex: 3,
            }}
          />
        )}
      </div>

      <SectionRow segments={instrSections} analysisStatus={instrAnalysis.status} />

      <div style={{ height: 88, position: 'relative', overflow: 'hidden', background: BG }}>
        <PreparedStemWaveform
          role="instrumental"
          peaks={visualResult?.waveforms.instrumental ?? []}
          color={PRIMARY}
          message={waveformMessage(instrStemState)}
        />
        {transportAvailable && (
          <div
            data-testid="flip-lab-instrumental-playhead"
            style={{
              position: 'absolute', top: 0, bottom: 0, left: `${preparedPlayheadPercent}%`, width: 1,
              background: PRIMARY, boxShadow: `0 0 8px ${PRIMARY}`, pointerEvents: 'none', zIndex: 3,
            }}
          />
        )}
      </div>

      <TrackHeader
        track={instrTrack}
        placeholderEmoji="⚡"
        placeholderTitle="Select an instrumental"
        placeholderArtist="No instrumental selected"
        placeholderBpm="—"
        role="INSTRUMENTAL"
        roleColor={PRIMARY}
        onClear={onClearInstrumental}
      />

      <div style={{
        display: 'grid', gridTemplateColumns: 'auto 1fr auto',
        background: PANEL, borderTop: `1px solid ${BORDER_F}`,
      }}>
        <div style={{ padding: '14px 18px', borderRight: `1px solid ${BORDER_F}` }}>
          <div style={{ fontSize: 8, fontWeight: 800, color: SECONDARY, letterSpacing: '0.1em', marginBottom: 10 }}>VOCAL EQ</div>
          <div style={{ display: 'flex', gap: 16 }}>
            {(['low', 'mid', 'high'] as const).map((band) => (
              <EqKnob
                key={band}
                role="vocal"
                band={band}
                value={eq.vocal[band]}
                color={SECONDARY}
                onChange={(value) => onSetEqBand('vocal', band, value)}
              />
            ))}
          </div>
        </div>

        <div style={{
          padding: '14px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
          borderRight: `1px solid ${BORDER_F}`, minWidth: 220,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              aria-pressed={playback.syncEnabled}
              aria-label="Toggle Flip Lab tempo sync"
              onClick={onToggleSync}
              style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 8, fontWeight: 700, cursor: 'pointer',
                background: playback.syncEnabled ? `${SECONDARY}18` : SURFACE,
                border: `1px solid ${playback.syncEnabled ? `${SECONDARY}55` : BORDER_S}`,
                color: playback.syncEnabled ? SECONDARY : MUTED,
              }}
            >⊞ SYNC</button>
            <div>
              <div style={{ fontSize: 7, color: MUTED, letterSpacing: '0.1em', textTransform: 'uppercase' }}>BPM</div>
              <div
                data-testid="flip-lab-master-bpm"
                style={{ fontSize: 16, fontWeight: 900, color: FG, fontVariantNumeric: 'tabular-nums' }}
              >{masterBpm != null ? masterBpm.toFixed(1) : '—'}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {[
              { label: '⏮', title: 'Jump to audition start', onClick: onSeekStart, disabled: !transportAvailable },
              { label: '⏪', title: 'Seek one bar backward', onClick: onSeekBackwardBar, disabled: !transportAvailable },
              { label: playback.status === 'playing' ? '⏸' : '▶', title: playback.status === 'playing' ? 'Pause' : 'Play', onClick: onTogglePlayPause, disabled: playDisabled },
              { label: '⏩', title: 'Seek one bar forward', onClick: onSeekForwardBar, disabled: !transportAvailable },
              { label: '⏭', title: 'Jump to audition end', onClick: onSeekEnd, disabled: !transportAvailable },
            ].map((control, i) => (
              <button
                key={control.title}
                type="button"
                title={control.title}
                aria-label={control.title}
                disabled={control.disabled}
                onClick={control.onClick}
                style={{
                  width: i === 2 ? 36 : 26, height: i === 2 ? 36 : 26, borderRadius: '50%',
                  background: i === 2 ? 'var(--color-control-green)' : CTRL_BG,
                  border: `1px solid ${i === 2 ? 'var(--color-control-green)' : CTRL_BDR}`,
                  color: i === 2 ? '#000' : FG,
                  fontSize: i === 2 ? 13 : 8, cursor: control.disabled ? 'not-allowed' : 'pointer',
                  opacity: control.disabled ? 0.4 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >{control.label}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
            <label htmlFor="flip-lab-loop-bars" style={{ fontSize: 8, color: MUTED }}>LOOP</label>
            <select
              id="flip-lab-loop-bars"
              aria-label="Flip Lab loop length"
              value={String(loopBars)}
              onChange={(event) => onLoopChange(event.target.value === 'off' ? 'off' : Number(event.target.value) as FlipLabLoopBars)}
              style={{
                padding: '2px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700,
                background: SURFACE, border: '1px solid rgba(245,158,11,0.22)',
                color: 'var(--color-control-amber)', outline: 'none',
              }}
            >
              {loopChoices.map((choice) => (
                <option
                  key={String(choice)}
                  value={String(choice)}
                  disabled={choice !== 'off' && !loopOptions.includes(choice)}
                >{choice === 'off' ? 'Off' : `${choice} Bars`}</option>
              ))}
            </select>
            <span style={{ fontSize: 8, color: MUTED }}>VOCAL</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={mixPosition}
              aria-label="Vocal and instrumental mix"
              title="Vocal ← Mix → Instrumental"
              onChange={(event) => onMixPositionChange(Number(event.target.value))}
              style={{ width: 72, accentColor: 'var(--color-primary)', cursor: 'ew-resize' }}
            />
            <span style={{ fontSize: 8, color: MUTED }}>INST</span>
          </div>
          {playback.error && (
            <div style={{ maxWidth: 300, textAlign: 'center', fontSize: 8, color: '#ef4444' }}>{playback.error}</div>
          )}
        </div>

        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <div style={{ fontSize: 8, fontWeight: 800, color: PRIMARY, letterSpacing: '0.1em', marginBottom: 10 }}>INSTRUMENTAL EQ</div>
          <div style={{ display: 'flex', gap: 16 }}>
            {(['low', 'mid', 'high'] as const).map((band) => (
              <EqKnob
                key={band}
                role="instrumental"
                band={band}
                value={eq.instrumental[band]}
                color={PRIMARY}
                onChange={(value) => onSetEqBand('instrumental', band, value)}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Main FlipLabView ──────────────────────────────────────────────────────────
export function FlipLabView() {
  const { navigate } = useAppRouter();
  const { session } = useAuthSession();
  const userId = session?.user?.id ?? null;
  const {
    data: activeImport,
    loading: activeImportLoading,
    error: activeImportError,
  } = useLatestRekordboxImport(userId);
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
  const [pendingSessionRestore, setPendingSessionRestore] = useState<FlipLabPersistedSession | null>(null);
  const [sessionHydratedImportId, setSessionHydratedImportId] = useState<string | null>(null);
  const [vocalStemState, setVocalStemState] = useState<FlipLabStemRoleState>(() => flipLabStemLifecycle.getState('vocal'));
  const [instrStemState, setInstrStemState] = useState<FlipLabStemRoleState>(() => flipLabStemLifecycle.getState('instrumental'));

  const [vocalTab, setVocalTab] = useState<'suggested' | 'library'>('suggested');
  const [instrTab, setInstrTab] = useState<'suggested' | 'library'>('suggested');
  const [vocalSearch, setVocalSearch] = useState('');
  const [instrSearch, setInstrSearch] = useState('');
  const [vocalVisibleIds, setVocalVisibleIds] = useState<string[]>([]);
  const [instrVisibleIds, setInstrVisibleIds] = useState<string[]>([]);
  const [pendingSelection, setPendingSelection] = useState<{ role: 'vocal' | 'instrumental'; trackId: string } | null>(null);

  useEffect(() => {
    const generation = ++candidateLoadGenerationRef.current;
    const controller = new AbortController();
    const requestImportId = activeImportId;
    const storedSession = requestImportId ? loadFlipLabSession(requestImportId) : null;

    // Import/session boundaries invalidate every old selection immediately.
    setSessionHydratedImportId(null);
    setPendingSessionRestore(null);
    setVocals([]);
    setInstrs([]);
    setSelectedVocalId(null);
    setSelectedInstrId(null);
    setVocalVisibleIds([]);
    setInstrVisibleIds([]);
    setPendingSelection(null);
    setLoadError(null);
    setVocalTab(storedSession?.vocalTab ?? 'suggested');
    setInstrTab(storedSession?.instrumentalTab ?? 'suggested');
    setVocalSearch('');
    setInstrSearch('');
    void flipLabStemLifecycle.select('vocal', null);
    void flipLabStemLifecycle.select('instrumental', null);

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
    void fetchRouletteCandidatePools(requestImportId, {
      signal: controller.signal,
      // Flip Lab validates local stem truth only for selected/visible work.
      verifyLocalStemReadiness: false,
    })
      .then((pools) => {
        if (!isCurrentFlipLabLoad(
          generation,
          candidateLoadGenerationRef.current,
          requestImportId,
          activeImportIdRef.current,
          controller.signal,
        )) return;
        setVocals(pools.vocals);
        setInstrs(pools.instrumentals);
        const restoredSelection = resolveFlipLabRestoredSelection(storedSession, pools.vocals, pools.instrumentals);
        setSelectedVocalId(restoredSelection.vocalId);
        setSelectedInstrId(restoredSelection.instrumentalId);
        const sessionToRestore = storedSession ?? createDefaultFlipLabSession(
          requestImportId,
          restoredSelection.vocalId,
          restoredSelection.instrumentalId,
        );
        setVocalTab(sessionToRestore.vocalTab);
        setInstrTab(sessionToRestore.instrumentalTab);
        setPendingSessionRestore(sessionToRestore);
      })
      .catch((error: unknown) => {
        if (!isCurrentFlipLabLoad(
          generation,
          candidateLoadGenerationRef.current,
          requestImportId,
          activeImportIdRef.current,
          controller.signal,
        )) return;
        setLoadError(error instanceof Error ? error.message : 'Failed to load candidates.');
      })
      .finally(() => {
        if (isCurrentFlipLabLoad(
          generation,
          candidateLoadGenerationRef.current,
          requestImportId,
          activeImportIdRef.current,
          controller.signal,
        )) setLoading(false);
      });

    return () => controller.abort();
  }, [activeImportError, activeImportId, activeImportLoading]);

  const importId = activeImportId;

  const selectedVocal = useMemo(() => vocals.find(c => c.track.id === selectedVocalId) ?? null, [vocals, selectedVocalId]);
  const selectedInstr = useMemo(() => instrs.find(c => c.track.id === selectedInstrId) ?? null, [instrs, selectedInstrId]);
  const vocalAnalysis = useFlipLabTrackAnalysis(selectedVocalId);
  const instrAnalysis = useFlipLabTrackAnalysis(selectedInstrId);

  useEffect(() => flipLabStemLifecycle.subscribe((role, state) => {
    if (role === 'vocal') setVocalStemState(state);
    else setInstrStemState(state);
  }), []);

  useEffect(() => {
    void flipLabStemLifecycle.select('vocal', selectedVocal?.track ?? null);
  }, [selectedVocal]);

  useEffect(() => {
    void flipLabStemLifecycle.select('instrumental', selectedInstr?.track ?? null);
  }, [selectedInstr]);

  // Suggested uses Roulette's canonical hard filters + ranking against the opposite role.
  const vocalSuggested = useMemo(
    () => rankFlipLabSuggestions(vocals, selectedInstr, 'vocal'),
    [vocals, selectedInstr],
  );
  const instrSuggested = useMemo(
    () => rankFlipLabSuggestions(instrs, selectedVocal, 'instrumental'),
    [instrs, selectedVocal],
  );

  // Library: alphabetical, all tracks
  const vocalLibrary = useMemo(
    () => [...vocals].sort((a, b) => a.track.title.localeCompare(b.track.title)),
    [vocals],
  );
  const instrLibrary = useMemo(
    () => [...instrs].sort((a, b) => a.track.title.localeCompare(b.track.title)),
    [instrs],
  );

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

  // Key relationship and BPM diff for the compatibility panel
  const keyRel = useMemo<CamelotRelationship | null>(() => {
    if (!selectedVocal || !selectedInstr) return null;
    const vKey = resolveFlipLabCamelotKey(selectedVocal.track);
    const iKey = resolveFlipLabCamelotKey(selectedInstr.track);
    if (!vKey || !iKey) return 'unknown';
    return classifyCamelotRelationship(vKey, iKey);
  }, [selectedVocal, selectedInstr]);

  const bpmDelta = useMemo(() => signedVocalBpmDelta(
    selectedVocal?.track.bpm,
    selectedInstr?.track.bpm,
  ), [selectedVocal, selectedInstr]);

  const phraseAlignment = useMemo(() => deriveFlipLabAlignment(
    selectedVocal?.track ?? null,
    selectedInstr?.track ?? null,
    vocalAnalysis.status === 'loaded' ? vocalAnalysis.beatGrid : null,
    instrAnalysis.status === 'loaded' ? instrAnalysis.beatGrid : null,
    vocalAnalysis.status === 'loaded' ? vocalAnalysis.phrases : [],
    instrAnalysis.status === 'loaded' ? instrAnalysis.phrases : [],
    vocalStemState.window,
    instrStemState.window,
  ), [selectedVocal, selectedInstr, vocalAnalysis, instrAnalysis, vocalStemState.window, instrStemState.window]);

  const pairRejectionReason = useMemo(
    () => getFlipLabPairRejectionReason(selectedVocal, selectedInstr),
    [selectedVocal, selectedInstr],
  );

  const audio = useFlipLabAudioRuntime({
    vocalTrack: selectedVocal?.track ?? null,
    instrumentalTrack: selectedInstr?.track ?? null,
    vocalStemState,
    instrumentalStemState: instrStemState,
    pairCompatible: selectedVocal !== null && selectedInstr !== null && pairRejectionReason === null,
  });

  useEffect(() => {
    if (!pendingSessionRestore || pendingSessionRestore.importId !== activeImportId) return;
    audio.restoreControls({
      syncEnabled: pendingSessionRestore.syncEnabled,
      eq: pendingSessionRestore.eq,
      mixPosition: pendingSessionRestore.mixPosition,
      loopBars: pendingSessionRestore.loopBars,
    });
    setPendingSessionRestore(null);
    setSessionHydratedImportId(pendingSessionRestore.importId);
  }, [activeImportId, audio.restoreControls, pendingSessionRestore]);

  useEffect(() => {
    if (!activeImportId || sessionHydratedImportId !== activeImportId || loading) return;
    saveFlipLabSession({
      version: FLIP_LAB_SESSION_VERSION,
      importId: activeImportId,
      selectedVocalId,
      selectedInstrumentalId: selectedInstrId,
      vocalTab,
      instrumentalTab: instrTab,
      syncEnabled: audio.playback.syncEnabled,
      mixPosition: audio.mixPosition,
      eq: {
        vocal: { ...audio.eq.vocal },
        instrumental: { ...audio.eq.instrumental },
      },
      loopBars: audio.loopBars,
    });
  }, [
    activeImportId,
    audio.eq,
    audio.loopBars,
    audio.mixPosition,
    audio.playback.syncEnabled,
    instrTab,
    loading,
    selectedInstrId,
    selectedVocalId,
    sessionHydratedImportId,
    vocalTab,
  ]);

  const clearSelection = useCallback((role: 'vocal' | 'instrumental') => {
    setPendingSelection(null);
    audio.stop({ clearResult: true });
    if (role === 'vocal') setSelectedVocalId(null);
    else setSelectedInstrId(null);
    void flipLabStemLifecycle.select(role, null);
  }, [audio.stop]);

  const commitSelection = useCallback((role: 'vocal' | 'instrumental', trackId: string) => {
    audio.stop({ clearResult: true });
    const next = applyFlipLabSelection(role, trackId, selectedVocalId, selectedInstrId);
    setSelectedVocalId(next.vocalId);
    setSelectedInstrId(next.instrumentalId);
  }, [audio.stop, selectedVocalId, selectedInstrId]);

  const requestSelection = useCallback((role: 'vocal' | 'instrumental', trackId: string) => {
    if (audio.playback.status === 'playing') {
      setPendingSelection({ role, trackId });
      return;
    }
    commitSelection(role, trackId);
  }, [audio.playback.status, commitSelection]);

  const handleSelectVocal = useCallback((trackId: string) => {
    requestSelection('vocal', trackId);
  }, [requestSelection]);

  const handleSelectInstrumental = useCallback((trackId: string) => {
    requestSelection('instrumental', trackId);
  }, [requestSelection]);

  const continuePendingSelection = useCallback(() => {
    const pending = pendingSelection;
    if (!pending) return;
    setPendingSelection(null);
    commitSelection(pending.role, pending.trackId);
  }, [commitSelection, pendingSelection]);

  const handleOpenDropLab = useCallback(() => {
    if (!selectedVocal || !selectedInstr) return;
    navigate(buildFlipLabDropLabRoute(selectedVocal.track.id, selectedInstr.track.id));
  }, [navigate, selectedVocal, selectedInstr]);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      borderTop: `1px solid ${BORDER_F}`,
      borderBottom: `1px solid ${BORDER_F}`,
      background: BG, fontFamily: 'inherit',
    }}>
      {/* ── Top: dual waveform + EQ/transport ── */}
      <TopWaveformSection
        vocalTrack={selectedVocal?.track ?? null}
        instrTrack={selectedInstr?.track ?? null}
        vocalAnalysis={vocalAnalysis}
        instrAnalysis={instrAnalysis}
        vocalStemState={vocalStemState}
        instrStemState={instrStemState}
        vocalWindow={vocalStemState.window}
        instrWindow={instrStemState.window}
        playback={audio.playback}
        visualization={audio.visualization}
        visualResult={audio.visualResult}
        eq={audio.eq}
        mixPosition={audio.mixPosition}
        loopBars={audio.loopBars}
        loopOptions={audio.loopOptions}
        masterBpm={audio.masterBpm}
        playbackReady={audio.ready}
        onClearVocal={() => clearSelection('vocal')}
        onClearInstrumental={() => clearSelection('instrumental')}
        onTogglePlayPause={() => { void audio.togglePlayPause(); }}
        onSeekStart={audio.seekToStart}
        onSeekBackwardBar={() => audio.seekByBars(-1)}
        onSeekForwardBar={() => audio.seekByBars(1)}
        onSeekEnd={audio.seekToEnd}
        onToggleSync={audio.toggleSync}
        onSetEqBand={audio.setEqBand}
        onMixPositionChange={audio.setMixPosition}
        onLoopChange={audio.setLoopBars}
      />

      {/* ── Bottom: 3-column selector panel ── */}
      {loading ? (
        <div style={{ padding: '48px 16px', textAlign: 'center', fontSize: 12, color: MUTED }}>
          Loading candidates…
        </div>
      ) : loadError ? (
        <div style={{ padding: '48px 16px', textAlign: 'center', fontSize: 12, color: '#ef4444' }}>
          {loadError}
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 260px 1fr',
          borderTop: `1px solid ${BORDER_F}`,
          height: 'min(480px, 46vh)',
          minHeight: 0,
          maxHeight: 'calc(100vh - 320px)',
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
            onPreview={(track) => { void audio.toggleCandidatePreview('vocal', track); }}
            previewState={audio.candidatePreview}
          />
          <CompatibilityPanel
            vocal={selectedVocal}
            instr={selectedInstr}
            vocalStemState={vocalStemState}
            instrStemState={instrStemState}
            keyRel={keyRel}
            bpmDelta={bpmDelta}
            phraseAlignment={phraseAlignment}
            pairRejectionReason={pairRejectionReason}
            onOpenDropLab={handleOpenDropLab}
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
            onPreview={(track) => { void audio.toggleCandidatePreview('instrumental', track); }}
            previewState={audio.candidatePreview}
          />
        </div>
      )}
      <Dialog
        open={pendingSelection !== null}
        title="Stop Flip Lab playback?"
        onClose={() => setPendingSelection(null)}
        closeOnBackdrop
        actions={[
          { label: 'Cancel', onClick: () => setPendingSelection(null), variant: 'neutral' },
          { label: 'Continue', onClick: continuePendingSelection, variant: 'primary' },
        ]}
      >
        <p>Changing a source will stop the current dual-stem audition.</p>
      </Dialog>
    </div>
  );
}
