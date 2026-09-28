import { useState, useEffect, useMemo, useCallback, useRef, useDeferredValue } from 'react';
import {
  classifyCamelotRelationship,
  type CamelotRelationship,
} from '../../lib/music/camelot';
import { fetchRouletteCandidatePools } from '../../lib/queries/rouletteCandidates';
import type { RouletteCandidateAnalysis } from '../../features/roulette/rouletteMatching';
import {
  applyFlipLabSelection,
  rankFlipLabSuggestions,
} from './flipLabMatching';
import { useTrackPreviewWaveforms } from '../../hooks/useTrackPreviewWaveforms';
import { RekordboxPreviewWaveform } from '../library/RekordboxPreviewWaveform';
import { Dialog } from '../ui/feedback';
import type { RekordboxTrack } from '../../types';
import type { WaveformLoadState } from '../../lib/queries/waveformValidation';
import { fetchTrackBeatGrid, fetchTrackPhrases, type BeatGridRow, type PhraseRow } from '../../lib/queries/analysisData';
import {
  flipLabStemLifecycle,
  type FlipLabStemRoleState,
} from './flipLabStemLifecycle';
import {
  mapPhrasesToTimelineSegments,
  resolveFlipLabArtist,
  resolveFlipLabCamelotKey,
  trackDurationMs,
  type FlipLabTimelineSegment,
} from './flipLabAnalysis';
import {
  useFlipLabAudioRuntime,
  type FlipLabCandidatePreviewState,
} from './useFlipLabAudioRuntime';
import {
  FLIP_LAB_ROW_HEIGHT,
  computeFlipLabWindowRange,
  filterFlipLabCandidates,
  isCurrentFlipLabLoad,
  scrollTopForFlipLabSelection,
} from './flipLabPerformance';
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

// ── Header stat (label + value pair, matches CuePointsView header stats) ─────
function HeaderStat({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 600, color: MUTED, whiteSpace: 'nowrap' }}>
      <span style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>{' '}
      <strong style={{ marginLeft: 4, fontWeight: 700, color: valueColor ?? FG }}>{value}</strong>
    </span>
  );
}

// ── Track header (real data when track provided, placeholder otherwise) ───────
interface TrackHeaderProps {
  track: RekordboxTrack | null;
  placeholderTitle: string;
  placeholderArtist: string;
  placeholderBpm: string;
  role: 'VOCAL' | 'INSTRUMENTAL';
  roleColor: string;
}

function TrackHeader({ track, placeholderTitle, placeholderArtist, placeholderBpm, role, roleColor }: TrackHeaderProps) {
  const title   = track?.title ?? placeholderTitle;
  const artist  = resolveFlipLabArtist(track, placeholderArtist);
  const bpm     = track?.bpm != null ? track.bpm.toFixed(0) : placeholderBpm;
  const keyStr  = track ? resolveFlipLabCamelotKey(track) : null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '6px 16px', background: PANEL, borderBottom: `1px solid ${BORDER_F}`,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: FG, letterSpacing: '-0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        <div style={{ fontSize: 11, color: MUTED, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{artist}</div>
      </div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexShrink: 0 }}>
        <HeaderStat label="BPM" value={bpm} />
        <HeaderStat label="Key" value={keyStr ?? '—'} valueColor={keyStr ? camelotColor(keyStr) : undefined} />
        <HeaderStat label="Stem" value={role} valueColor={roleColor} />
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

// ── Load pair column (center column) ─────────────────────────────────────────
function LoadPairColumn({
  vocal,
  instr,
  pairLoaded,
  onLoadPair,
  onClearPair,
}: {
  vocal: RouletteCandidateAnalysis | null;
  instr: RouletteCandidateAnalysis | null;
  pairLoaded: boolean;
  onLoadPair: () => void;
  onClearPair: () => void;
}) {
  const bothSelected = vocal !== null && instr !== null;
  const canClear = bothSelected && pairLoaded;
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      background: PANEL, padding: 16, gap: 12,
    }}>
      {bothSelected ? (
        <button
          type="button"
          data-testid="flip-lab-load-pair"
          onClick={onLoadPair}
          style={{
            padding: '12px 20px', borderRadius: 10, cursor: 'pointer',
            background: PRIMARY, border: 'none', color: '#fff',
            fontSize: 13, fontWeight: 800, width: '100%',
          }}
        >
          Load Pair
        </button>
      ) : (
        <div style={{ fontSize: 11, color: MUTED, textAlign: 'center' }}>
          Select a vocal and instrumental to load
        </div>
      )}
      <button
        type="button"
        data-testid="flip-lab-clear-pair"
        onClick={onClearPair}
        disabled={!canClear}
        style={{
          padding: '10px 20px', borderRadius: 10,
          background: 'transparent', border: `1px solid ${BORDER_S}`,
          color: canClear ? FG : MUTED,
          fontSize: 12, fontWeight: 700, width: '100%',
          cursor: canClear ? 'pointer' : 'not-allowed',
          opacity: canClear ? 1 : 0.5,
        }}
      >
        Clear Loaded Pair
      </button>
    </div>
  );
}

// ── Playback playhead overlay (spans both waveforms, matches CuePoints marker) ─
function FlipLabPlayheadOverlay({ progress }: { progress: number }) {
  const percent = Math.max(0, Math.min(100, progress * 100));
  return (
    <div
      data-testid="flip-lab-playhead"
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }}
    >
      <div style={{
        position: 'absolute', top: 0, bottom: 0, left: `${percent}%`,
        width: 1, background: '#fff', transform: 'translateX(-50%)',
        boxShadow: '0 0 7px rgba(255,255,255,0.75)', transition: 'left 0.1s linear',
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

// ── Audio dock (play/pause, scrubber, volume — styled like CuePoints' dock) ───
function formatFlipLabTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function FlipLabAudioDock({ audio }: { audio: ReturnType<typeof useFlipLabAudioRuntime> }) {
  const { playback, ready, togglePlayPause, seekTo, volume, setVolume } = audio;
  const playing = playback.status === 'playing';
  const loading = playback.status === 'loading';
  const durationSeconds = playback.durationSeconds;
  const seekable = ready && durationSeconds > 0;
  const positionSeconds = Math.min(durationSeconds, Math.max(0, playback.positionSeconds));

  return (
    <div
      data-testid="flip-lab-audio-dock"
      role="region"
      aria-label="Flip Lab audio dock"
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '8px 16px', background: PANEL, borderBottom: `1px solid ${BORDER_F}`,
      }}
    >
      <button
        type="button"
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={() => { void togglePlayPause(); }}
        disabled={!ready}
        style={{
          width: 32, height: 32, borderRadius: '50%', padding: 0, flexShrink: 0,
          background: ready ? PRIMARY : CTRL_BG,
          border: `1px solid ${ready ? PRIMARY : CTRL_BDR}`,
          color: ready ? '#fff' : MUTED,
          cursor: ready ? 'pointer' : 'not-allowed',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
        }}
      >{loading ? '…' : playing ? '❚❚' : '▶'}</button>

      <span style={{ fontSize: 10, color: MUTED, fontVariantNumeric: 'tabular-nums', width: 32, textAlign: 'right', flexShrink: 0 }}>
        {formatFlipLabTime(positionSeconds)}
      </span>
      <input
        type="range"
        min={0}
        max={durationSeconds > 0 ? durationSeconds : 1}
        step={0.1}
        value={seekable ? positionSeconds : 0}
        disabled={!seekable}
        onChange={(event) => seekTo(Number(event.target.value))}
        aria-label="Flip Lab playback position"
        style={{ flex: 1, minWidth: 100, cursor: seekable ? 'pointer' : 'not-allowed', accentColor: PRIMARY }}
      />
      <span style={{ fontSize: 10, color: MUTED, fontVariantNumeric: 'tabular-nums', width: 32, flexShrink: 0 }}>
        {formatFlipLabTime(durationSeconds)}
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, borderLeft: `1px solid ${BORDER_F}`, paddingLeft: 12 }}>
        <span aria-hidden="true" style={{ fontSize: 12, color: MUTED }}>{volume === 0 ? '🔇' : '🔊'}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={volume}
          onChange={(event) => setVolume(Number(event.target.value))}
          aria-label="Flip Lab playback volume"
          style={{ width: 80, cursor: 'pointer', accentColor: PRIMARY }}
        />
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
  vocalWaveformState,
  instrWaveformState,
  audio,
}: {
  vocalTrack: RekordboxTrack | null;
  instrTrack: RekordboxTrack | null;
  vocalAnalysis: FlipLabTrackAnalysisState;
  instrAnalysis: FlipLabTrackAnalysisState;
  vocalWaveformState: WaveformLoadState;
  instrWaveformState: WaveformLoadState;
  audio: ReturnType<typeof useFlipLabAudioRuntime>;
}) {
  const vocalSections = useMemo(() => (
    vocalAnalysis.status === 'loaded'
      ? mapPhrasesToTimelineSegments(vocalAnalysis.phrases, trackDurationMs(vocalTrack), null)
      : []
  ), [vocalAnalysis, vocalTrack]);
  const instrSections = useMemo(() => (
    instrAnalysis.status === 'loaded'
      ? mapPhrasesToTimelineSegments(instrAnalysis.phrases, trackDurationMs(instrTrack), null)
      : []
  ), [instrAnalysis, instrTrack]);

  const playbackProgress = audio.playback.durationSeconds > 0
    ? audio.playback.positionSeconds / audio.playback.durationSeconds
    : 0;

  return (
    <>
      <TrackHeader
        track={vocalTrack}
        placeholderTitle="Select a vocal track"
        placeholderArtist="No vocal selected"
        placeholderBpm="—"
        role="VOCAL"
        roleColor={SECONDARY}
      />

      <SectionRow segments={vocalSections} analysisStatus={vocalAnalysis.status} />

      <div style={{ position: 'relative' }}>
        <div style={{ height: 88, position: 'relative', overflow: 'hidden', background: BG }}>
          <RekordboxPreviewWaveform
            state={vocalWaveformState}
            height={88}
            variant="detail"
            ariaLabel={vocalTrack ? `Waveform for ${vocalTrack.title}` : 'Vocal waveform'}
          />
        </div>

        <div style={{ height: 88, position: 'relative', overflow: 'hidden', background: BG }}>
          <RekordboxPreviewWaveform
            state={instrWaveformState}
            height={88}
            variant="detail"
            ariaLabel={instrTrack ? `Waveform for ${instrTrack.title}` : 'Instrumental waveform'}
          />
        </div>

        {audio.playback.durationSeconds > 0 && <FlipLabPlayheadOverlay progress={playbackProgress} />}
      </div>

      <SectionRow segments={instrSections} analysisStatus={instrAnalysis.status} />

      <TrackHeader
        track={instrTrack}
        placeholderTitle="Select an instrumental"
        placeholderArtist="No instrumental selected"
        placeholderBpm="—"
        role="INSTRUMENTAL"
        roleColor={PRIMARY}
      />

      <FlipLabAudioDock audio={audio} />
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
  const [pendingSessionRestore, setPendingSessionRestore] = useState<FlipLabPersistedSession | null>(null);
  const [sessionHydratedImportId, setSessionHydratedImportId] = useState<string | null>(null);
  const [vocalStemState, setVocalStemState] = useState<FlipLabStemRoleState>(() => flipLabStemLifecycle.getState('vocal'));
  const [instrStemState, setInstrStemState] = useState<FlipLabStemRoleState>(() => flipLabStemLifecycle.getState('instrumental'));

  const [vocalTab, setVocalTab] = useState<'suggested' | 'library'>('library');
  const [instrTab, setInstrTab] = useState<'suggested' | 'library'>('library');
  const [pairLoaded, setPairLoaded] = useState(false);
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
    setVocalTab('library');
    setInstrTab('library');
    setPairLoaded(false);
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
        setVocalTab(restoredSelection.instrumentalId ? 'suggested' : 'library');
        setInstrTab(restoredSelection.vocalId ? 'suggested' : 'library');
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

  const audio = useFlipLabAudioRuntime({
    vocalTrack: selectedVocal?.track ?? null,
    instrumentalTrack: selectedInstr?.track ?? null,
    vocalStemState,
    instrumentalStemState: instrStemState,
    pairCompatible: selectedVocal !== null && selectedInstr !== null,
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
    setPairLoaded(false);
    audio.stop({ clearResult: true });
    if (role === 'vocal') {
      setSelectedVocalId(null);
      setInstrTab('library');
    } else {
      setSelectedInstrId(null);
      setVocalTab('library');
    }
    void flipLabStemLifecycle.select(role, null);
  }, [audio.stop]);

  const commitSelection = useCallback((role: 'vocal' | 'instrumental', trackId: string) => {
    audio.stop({ clearResult: true });
    setPairLoaded(false);
    const next = applyFlipLabSelection(role, trackId, selectedVocalId, selectedInstrId);
    setSelectedVocalId(next.vocalId);
    setSelectedInstrId(next.instrumentalId);
    if (role === 'vocal') setInstrTab('suggested');
    else setVocalTab('suggested');
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

  const handleLoadPair = useCallback(() => {
    if (selectedVocal && selectedInstr) setPairLoaded(true);
  }, [selectedVocal, selectedInstr]);

  const handleClearPair = useCallback(() => {
    clearSelection('vocal');
    clearSelection('instrumental');
  }, [clearSelection]);

  const showLoadedPair = pairLoaded && selectedVocal !== null && selectedInstr !== null;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      borderTop: `1px solid ${BORDER_F}`,
      borderBottom: `1px solid ${BORDER_F}`,
      background: BG, fontFamily: 'inherit',
    }}>
      {/* ── Top: loaded pair waveforms, or empty state until Load Pair ── */}
      {showLoadedPair ? (
        <TopWaveformSection
          vocalTrack={selectedVocal.track}
          instrTrack={selectedInstr.track}
          vocalAnalysis={vocalAnalysis}
          instrAnalysis={instrAnalysis}
          vocalWaveformState={getWaveformState(selectedVocal.track.id)}
          instrWaveformState={getWaveformState(selectedInstr.track.id)}
          audio={audio}
        />
      ) : (
        <div
          data-testid="flip-lab-empty-pair"
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 6, minHeight: 200, padding: '32px 16px', background: BG, textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 800, color: FG }}>No pair loaded</div>
          <div style={{ fontSize: 11, color: MUTED }}>
            Pick a vocal track and an instrumental track below, then click Load Pair.
          </div>
        </div>
      )}

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
          <LoadPairColumn
            vocal={selectedVocal}
            instr={selectedInstr}
            pairLoaded={pairLoaded}
            onLoadPair={handleLoadPair}
            onClearPair={handleClearPair}
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
