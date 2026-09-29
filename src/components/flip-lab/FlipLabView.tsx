import { useState, useEffect, useMemo, useCallback, useRef, useDeferredValue } from 'react';
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
import { fetchTrackBeatGrid, fetchTrackPhrases, type BeatGridRow, type PhraseRow } from '../../lib/queries/analysisData';
import {
  flipLabBarLines,
  mapPhrasesToTimelineSegments,
  resolveFlipLabArtist,
  resolveFlipLabCamelotKey,
  trackDurationMs,
  type FlipLabTimelineSegment,
} from './flipLabAnalysis';
import { flipLabKeyShiftSemitones, formatFlipLabTime, type FlipLabTimeline } from './flipLabTimeline';
import { useFlipLab } from './useFlipLab';
import {
  FLIP_LAB_ROW_HEIGHT,
  computeFlipLabWindowRange,
  filterFlipLabCandidates,
  isCurrentFlipLabLoad,
  scrollTopForFlipLabSelection,
} from './flipLabPerformance';
import {
  FLIP_LAB_SESSION_VERSION,
  loadFlipLabSession,
  resolveFlipLabRestoredSelection,
  saveFlipLabSession,
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
const ERROR_RED = '#ef4444';
const WARN_AMBER = '#f59e0b';

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
  role: 'VOCAL' | 'INSTRUMENTAL';
  roleColor: string;
  targetBpm?: number | null;
  keyShift?: {
    enabled: boolean;
    available: boolean;
    disabled: boolean;
    semitones: number | null;
    onToggle: (next: boolean) => void;
  };
}

function TrackHeader({ track, role, roleColor, targetBpm, keyShift }: TrackHeaderProps) {
  const bpm = track.bpm != null ? track.bpm.toFixed(0) : '—';
  const bpmValue = targetBpm != null && track.bpm != null && Math.abs(targetBpm - track.bpm) >= 0.05
    ? `${bpm} → ${targetBpm.toFixed(0)}`
    : bpm;
  const keyStr = resolveFlipLabCamelotKey(track);
  const shownKey = keyShift?.enabled && keyShift.available ? shiftedCamelot(keyStr, keyShift.semitones) : keyStr;
  const keyValue = keyStr && shownKey && shownKey !== keyStr ? `${keyStr} → ${shownKey}` : (keyStr ?? '—');

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '6px 16px', background: PANEL, borderBottom: `1px solid ${BORDER_F}`,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: FG, letterSpacing: '-0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.title}</div>
        <div style={{ fontSize: 11, color: MUTED, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{resolveFlipLabArtist(track, '')}</div>
      </div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexShrink: 0 }}>
        <HeaderStat label="BPM" value={bpmValue} />
        <HeaderStat label="Key" value={keyValue} valueColor={shownKey ? camelotColor(shownKey) : undefined} />
        <HeaderStat label="Stem" value={role} valueColor={roleColor} />
        {keyShift && (
          <button
            type="button"
            role="switch"
            aria-checked={keyShift.enabled}
            data-testid="flip-lab-key-shift"
            disabled={keyShift.disabled || !keyShift.available}
            title={keyShift.available ? 'Shift the vocal to the instrumental\'s key' : 'Both tracks need a key to use Key Shift'}
            onClick={() => keyShift.onToggle(!keyShift.enabled)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: 0,
              background: 'transparent', border: 'none',
              cursor: keyShift.disabled || !keyShift.available ? 'not-allowed' : 'pointer',
              opacity: keyShift.disabled || !keyShift.available ? 0.45 : 1,
            }}
          >
            <span style={{ fontSize: 10, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Key Shift</span>
            <span style={{
              position: 'relative', width: 26, height: 14, borderRadius: 7,
              background: keyShift.enabled ? SECONDARY : CTRL_BG,
              border: `1px solid ${keyShift.enabled ? SECONDARY : CTRL_BDR}`,
              transition: 'background 0.15s',
            }}>
              <span style={{
                position: 'absolute', top: 1, left: keyShift.enabled ? 13 : 1,
                width: 10, height: 10, borderRadius: '50%', background: '#fff',
                transition: 'left 0.15s',
              }} />
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Track selector row ────────────────────────────────────────────────────────
const ROW_GRID = '36px 24px minmax(0,1fr) 80px 40px 38px 12px 20px';
const ROW_GAP  = 6;

function TrackSelectorRow({
  candidate,
  selected,
  disabled,
  onSelect,
  onPreview,
  previewStatus,
  waveformState,
  otherTrack,
}: {
  candidate: RouletteCandidateAnalysis;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onPreview: () => void;
  previewStatus: 'idle' | 'loading' | 'playing';
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
        padding: '7px 12px',
        background: selected ? `${PRIMARY}12` : 'transparent',
        border: 'none',
        borderBottom: `1px solid ${BORDER_F}`,
        borderLeft: `2px solid ${selected ? PRIMARY : 'transparent'}`,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        textAlign: 'left',
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: 6,
        background: selected ? `${PRIMARY}28` : SURFACE,
        border: `1px solid ${BORDER_S}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 800,
        color: selected ? PRIMARY : MUTED, flexShrink: 0,
      }}>{initials}</div>

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

      <div style={{ height: 24, overflow: 'hidden' }}>
        <RekordboxPreviewWaveform
          state={waveformState}
          height={24}
          variant="compact"
          showCenterLine={false}
          surface={false}
        />
      </div>

      <div style={{
        fontSize: 11, fontWeight: 700, color: FG,
        fontVariantNumeric: 'tabular-nums', textAlign: 'center',
      }}>{bpm}</div>

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
  previewStatusFor: (trackId: string) => 'idle' | 'loading' | 'playing';
  disabled: boolean;
}

function SelectPanel({
  role, suggested, library,
  selectedId, onSelect,
  tab, onTabChange,
  search, onSearchChange,
  getWaveformState, onVisibleTrackIdsChange, otherTrack,
  onPreview, previewStatusFor, disabled,
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
      borderLeft: !isVocal ? `1px solid ${BORDER_F}` : undefined,
      background: BG, minHeight: 0, overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px 10px',
        background: PANEL, borderBottom: `1px solid ${BORDER_F}`,
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: FG }}>Select {roleLabel}</div>
          <div style={{ fontSize: 10, color: MUTED }}>Choose the {role} track</div>
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
        style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}
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

// ── Flip column (center) ──────────────────────────────────────────────────────
function FlipColumn({
  canFlip,
  canClear,
  busy,
  phase,
  progress,
  errors,
  warnings,
  onFlip,
  onClear,
}: {
  canFlip: boolean;
  canClear: boolean;
  busy: boolean;
  phase: ReturnType<typeof useFlipLab>['state']['phase'];
  progress: number;
  errors: string[];
  warnings: string[];
  onFlip: () => void;
  onClear: () => void;
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      background: PANEL, padding: 16, gap: 12, overflowY: 'auto',
    }}>
      {busy && (
        <>
          <FlipProgressCircle progress={progress} />
          <div style={{ fontSize: 10, color: MUTED, textAlign: 'center' }}>
            {phase === 'preparing' ? 'Getting playback ready…' : 'Separating stems…'}
          </div>
          <div data-testid="flip-lab-selection-locked" style={{ fontSize: 10, color: MUTED, textAlign: 'center' }}>
            Track Selection is disabled until stem separation is finished
          </div>
        </>
      )}
      <button
        type="button"
        data-testid="flip-lab-flip"
        onClick={onFlip}
        disabled={!canFlip}
        style={{
          padding: '12px 20px', borderRadius: 10, width: '100%',
          background: canFlip ? PRIMARY : CTRL_BG,
          border: canFlip ? 'none' : `1px solid ${CTRL_BDR}`,
          color: canFlip ? '#fff' : MUTED,
          fontSize: 13, fontWeight: 800,
          cursor: canFlip ? 'pointer' : 'not-allowed',
        }}
      >
        Flip
      </button>
      <button
        type="button"
        data-testid="flip-lab-clear-pair"
        onClick={onClear}
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
      {(errors.length > 0 || warnings.length > 0) && (
        <div data-testid="flip-lab-messages" style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
          {errors.map((message) => (
            <div key={`e-${message}`} role="alert" style={{
              fontSize: 10, lineHeight: 1.4, color: ERROR_RED,
              padding: '6px 8px', borderRadius: 6, background: `${ERROR_RED}14`, border: `1px solid ${ERROR_RED}40`,
            }}>{message}</div>
          ))}
          {warnings.map((message) => (
            <div key={`w-${message}`} style={{
              fontSize: 10, lineHeight: 1.4, color: WARN_AMBER,
              padding: '6px 8px', borderRadius: 6, background: `${WARN_AMBER}14`, border: `1px solid ${WARN_AMBER}40`,
            }}>{message}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Timeline lanes ────────────────────────────────────────────────────────────
function laneBox(startSec: number, spanSec: number, totalSec: number): React.CSSProperties {
  const total = totalSec > 0 ? totalSec : 1;
  return {
    position: 'absolute', top: 0, bottom: 0,
    left: `${(startSec / total) * 100}%`,
    width: `${(spanSec / total) * 100}%`,
  };
}

function BarLines({ track, beatGrid }: { track: RekordboxTrack; beatGrid: BeatGridRow | null }) {
  const lines = useMemo(() => flipLabBarLines(beatGrid, trackDurationMs(track)), [beatGrid, track]);
  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {lines.map((line) => (
        <span key={`${line.bar}-${line.percent}`} style={{
          position: 'absolute', top: 0, bottom: 0, left: `${line.percent}%`,
          width: line.first ? 2 : 1,
          background: line.first ? PRIMARY : line.major ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)',
        }} />
      ))}
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

function LoadingOverlay() {
  return (
    <div data-testid="flip-lab-waveform-loading" style={{
      position: 'absolute', inset: 0, zIndex: 3,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.35)', pointerEvents: 'none',
    }}>
      <span className="flip-lab-spin" aria-label="Separating stems" style={{
        width: 22, height: 22, borderRadius: '50%',
        border: '2px solid rgba(255,255,255,0.25)', borderTopColor: '#fff',
        animation: 'flip-lab-spin 0.9s linear infinite',
      }} />
    </div>
  );
}

// ── Audio dock ────────────────────────────────────────────────────────────────
function FlipLabAudioDock({
  canPlay,
  playing,
  positionSec,
  durationSec,
  volume,
  onTogglePlay,
  onSeek,
  onVolume,
}: {
  canPlay: boolean;
  playing: boolean;
  positionSec: number;
  durationSec: number;
  volume: number;
  onTogglePlay: () => void;
  onSeek: (sec: number) => void;
  onVolume: (value: number) => void;
}) {
  const position = Math.min(durationSec, Math.max(0, positionSec));
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
        onClick={onTogglePlay}
        disabled={!canPlay}
        style={{
          width: 32, height: 32, borderRadius: '50%', padding: 0, flexShrink: 0,
          background: canPlay ? PRIMARY : CTRL_BG,
          border: `1px solid ${canPlay ? PRIMARY : CTRL_BDR}`,
          color: canPlay ? '#fff' : MUTED,
          cursor: canPlay ? 'pointer' : 'not-allowed',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
        }}
      >{playing ? '❚❚' : '▶'}</button>

      <span style={{ fontSize: 10, color: MUTED, fontVariantNumeric: 'tabular-nums', width: 32, textAlign: 'right', flexShrink: 0 }}>
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
        style={{ flex: 1, minWidth: 100, cursor: canPlay ? 'pointer' : 'not-allowed', accentColor: PRIMARY }}
      />
      <span style={{ fontSize: 10, color: MUTED, fontVariantNumeric: 'tabular-nums', width: 32, flexShrink: 0 }}>
        {formatFlipLabTime(durationSec)}
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, borderLeft: `1px solid ${BORDER_F}`, paddingLeft: 12 }}>
        <span aria-hidden="true" style={{ fontSize: 12, color: MUTED }}>{volume === 0 ? '🔇' : '🔊'}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={volume}
          onChange={(event) => onVolume(Number(event.target.value))}
          aria-label="Flip Lab playback volume"
          style={{ width: 80, cursor: 'pointer', accentColor: PRIMARY }}
        />
      </div>
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
      ? mapPhrasesToTimelineSegments(vocalAnalysis.phrases, trackDurationMs(vocalTrack))
      : []
  ), [vocalAnalysis, vocalTrack]);
  const instrSections = useMemo(() => (
    instrAnalysis.status === 'loaded'
      ? mapPhrasesToTimelineSegments(instrAnalysis.phrases, trackDurationMs(instrTrack))
      : []
  ), [instrAnalysis, instrTrack]);
  const semitones = flipLabKeyShiftSemitones(resolveFlipLabCamelotKey(vocalTrack), resolveFlipLabCamelotKey(instrTrack));

  const vocalBox = laneBox(timeline.vocalStartSec, timeline.vocalSpanSec, timeline.totalSec);
  const instrBox = laneBox(timeline.instrumentalStartSec, timeline.instrumentalSpanSec, timeline.totalSec);
  const playheadProgress = timeline.totalSec > 0 ? state.positionSec / timeline.totalSec : 0;
  const lanesDimmed = busy || state.phase === 'error';

  return (
    <>
      <TrackHeader
        track={vocalTrack}
        role="VOCAL"
        roleColor={SECONDARY}
        targetBpm={instrTrack.bpm}
        keyShift={{
          enabled: state.keyShift,
          available: semitones != null,
          disabled: busy,
          semitones,
          onToggle: (next) => { void flipLab.setKeyShift(next); },
        }}
      />

      <div style={{ position: 'relative', height: 40, borderBottom: `1px solid ${BORDER_F}` }}>
        <div style={vocalBox}><SectionRow segments={vocalSections} analysisStatus={vocalAnalysis.status} /></div>
      </div>

      <div data-testid="flip-lab-lanes" style={{ position: 'relative' }}>
        <div style={{
          filter: lanesDimmed ? 'grayscale(0.85)' : undefined,
          opacity: lanesDimmed ? 0.55 : 1,
          transition: 'opacity 0.2s, filter 0.2s',
        }}>
          <div style={{ height: 88, position: 'relative', overflow: 'hidden', background: BG }}>
            <div style={vocalBox}>
              <RekordboxPreviewWaveform
                state={vocalWaveformState}
                height={88}
                variant="detail"
                ariaLabel={`Waveform for ${vocalTrack.title}`}
              />
              <BarLines track={vocalTrack} beatGrid={vocalAnalysis.status === 'loaded' ? vocalAnalysis.beatGrid : null} />
            </div>
          </div>
          <div style={{ height: 88, position: 'relative', overflow: 'hidden', background: BG }}>
            <div style={instrBox}>
              <RekordboxPreviewWaveform
                state={instrWaveformState}
                height={88}
                variant="detail"
                ariaLabel={`Waveform for ${instrTrack.title}`}
              />
              <BarLines track={instrTrack} beatGrid={instrAnalysis.status === 'loaded' ? instrAnalysis.beatGrid : null} />
            </div>
          </div>
        </div>
        {busy && <LoadingOverlay />}
        {state.phase === 'ready' && <FlipLabPlayheadOverlay progress={playheadProgress} />}
      </div>

      <div style={{ position: 'relative', height: 40, borderBottom: `1px solid ${BORDER_F}` }}>
        <div style={instrBox}><SectionRow segments={instrSections} analysisStatus={instrAnalysis.status} /></div>
      </div>

      <TrackHeader track={instrTrack} role="INSTRUMENTAL" roleColor={PRIMARY} />

      <FlipLabAudioDock
        canPlay={state.phase === 'ready'}
        playing={state.playing}
        positionSec={state.positionSec}
        durationSec={timeline.totalSec}
        volume={state.volume}
        onTogglePlay={() => { void flipLab.togglePlay(); }}
        onSeek={flipLab.seek}
        onVolume={flipLab.setVolume}
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
  const [sessionHydratedImportId, setSessionHydratedImportId] = useState<string | null>(null);

  const [vocalTab, setVocalTab] = useState<'suggested' | 'library'>('library');
  const [instrTab, setInstrTab] = useState<'suggested' | 'library'>('library');
  const [vocalSearch, setVocalSearch] = useState('');
  const [instrSearch, setInstrSearch] = useState('');
  const [vocalVisibleIds, setVocalVisibleIds] = useState<string[]>([]);
  const [instrVisibleIds, setInstrVisibleIds] = useState<string[]>([]);

  const flipLab = useFlipLab();
  const { state: flipState, busy } = flipLab;
  const clearFlip = flipLab.clear;
  const globalPlayer = useAudioPlayer();

  useEffect(() => {
    const generation = ++candidateLoadGenerationRef.current;
    const controller = new AbortController();
    const requestImportId = activeImportId;
    const storedSession = requestImportId ? loadFlipLabSession(requestImportId) : null;

    // Import/session boundaries invalidate every old selection immediately.
    setSessionHydratedImportId(null);
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
        const restored = resolveFlipLabRestoredSelection(storedSession, pools.vocals, pools.instrumentals);
        setSelectedVocalId(restored.vocalId);
        setSelectedInstrId(restored.instrumentalId);
        setVocalTab(restored.instrumentalId ? 'suggested' : 'library');
        setInstrTab(restored.vocalId ? 'suggested' : 'library');
        setSessionHydratedImportId(requestImportId);
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

  useEffect(() => {
    if (!activeImportId || sessionHydratedImportId !== activeImportId || loading) return;
    saveFlipLabSession({
      version: FLIP_LAB_SESSION_VERSION,
      importId: activeImportId,
      selectedVocalId,
      selectedInstrumentalId: selectedInstrId,
    });
  }, [activeImportId, loading, selectedInstrId, selectedVocalId, sessionHydratedImportId]);

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
    <div style={{
      display: 'flex', flexDirection: 'column',
      flex: 1, minHeight: 0, overflowY: 'auto',
      borderTop: `1px solid ${BORDER_F}`,
      borderBottom: `1px solid ${BORDER_F}`,
      background: BG, fontFamily: 'inherit',
    }}>
      <style>{FLIP_LAB_KEYFRAMES}</style>

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
          gridTemplateColumns: '1fr 236px 1fr',
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
            disabled={busy}
          />
          <FlipColumn
            canFlip={canFlip}
            canClear={pairIsLoaded}
            busy={busy}
            phase={flipState.phase}
            progress={flipState.progress}
            errors={flipState.errors}
            warnings={flipState.warnings}
            onFlip={handleFlip}
            onClear={handleClearPair}
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
            disabled={busy}
          />
        </div>
      )}
    </div>
  );
}
