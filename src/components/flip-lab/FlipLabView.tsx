import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  classifyCamelotRelationship,
  parseCamelotKey,
  camelotKeyFromTonicMode,
  getCamelotRelationshipLabel,
  type CamelotRelationship,
} from '../../lib/music/camelot';
import { fetchRouletteCandidateAnalysis } from '../../lib/queries/rouletteCandidates';
import type { RouletteCandidateAnalysis, RouletteHardFilterReason } from '../../features/roulette/rouletteMatching';
import {
  applyFlipLabSelection,
  chooseInitialFlipLabPair,
  flipLabRejectionReasonLabel,
  getFlipLabPairRejectionReason,
  rankFlipLabSuggestions,
} from './flipLabMatching';
import { useTrackPreviewWaveforms } from '../../hooks/useTrackPreviewWaveforms';
import { RekordboxPreviewWaveform } from '../library/RekordboxPreviewWaveform';
import { useAppRouter } from '../../navigation/useAppRouter';
import { formatKey } from '../../lib/utils';
import type { RekordboxTrack } from '../../types';
import type { WaveformLoadState } from '../../lib/queries/waveformValidation';
import {
  flipLabStemLifecycle,
  flipLabStemStatusPresentation,
  isFlipLabStemUsable,
  type FlipLabStemRoleState,
} from './flipLabStemLifecycle';

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
};

// ── Camelot color mapping (from CuePointsView) ────────────────────────────────
const CAMELOT_COLORS: Record<number, string> = {
  1: '#e74c3c', 2: '#3b82f6', 3: '#1d4ed8', 4: '#f59e0b', 5: '#16a34a', 6: '#d97706',
  7: '#8b5cf6', 8: '#0d9488', 9: '#22c55e', 10: '#0891b2', 11: '#06b6d4', 12: '#ec4899',
};

function trackCamelotCode(
  track: Pick<RekordboxTrack, 'camelot_key' | 'key_tonic' | 'key_mode'>,
): string | null {
  return parseCamelotKey(track.camelot_key)?.code
    ?? camelotKeyFromTonicMode(track.key_tonic, track.key_mode)
    ?? null;
}

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

// ── Section defs ──────────────────────────────────────────────────────────────
interface SectionDef { label: string; color: string; start: number; end: number }

const VOCAL_SECTIONS: SectionDef[] = [
  { label: 'Verse 1', color: SECTION_COLORS.verse.wave,  start: 0,  end: 28 },
  { label: 'Build',   color: SECTION_COLORS.build.wave,  start: 28, end: 46 },
  { label: 'Chorus',  color: SECTION_COLORS.chorus.wave, start: 46, end: 75 },
  { label: 'Drop',    color: SECTION_COLORS.drop.wave,   start: 75, end: 100 },
];

const INSTR_SECTIONS: SectionDef[] = [
  { label: 'Intro', color: SECTION_COLORS.intro.wave, start: 0,  end: 22 },
  { label: 'Verse', color: SECTION_COLORS.verse.wave, start: 22, end: 48 },
  { label: 'Build', color: SECTION_COLORS.build.wave, start: 48, end: 70 },
  { label: 'Drop',  color: SECTION_COLORS.drop.wave,  start: 70, end: 100 },
];

const BAR_NUMBERS = [1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 41, 45, 49, 53, 57, 61];

// ── Multi-color mock waveform (placeholder when no real waveform loaded) ──────
function MultiColorWaveform({ sections, seed = 1, bars = 260 }: {
  sections: SectionDef[];
  seed?: number;
  bars?: number;
}) {
  const d = useMemo(() => {
    let s = (seed * 2654435761) >>> 0;
    const rand = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s >>> 0) / 0xffffffff; };
    const raw = Array.from({ length: bars }, () => Math.pow(rand(), 0.55));
    const smooth = raw.map((_, i) => {
      let sum = 0, n = 0;
      for (let j = Math.max(0, i - 5); j <= Math.min(bars - 1, i + 5); j++) { sum += raw[j]; n++; }
      return sum / n;
    });
    const vw = 400, vh = 60, mid = vh / 2, bw = vw / bars;
    return smooth.map((amp, i) => {
      const x = i * bw + bw / 2;
      const h = Math.max(1.5, amp * mid * 0.91);
      return `M${x.toFixed(1)} ${(mid - h).toFixed(1)}L${x.toFixed(1)} ${(mid + h).toFixed(1)}`;
    }).join(' ');
  }, [seed, bars]);

  return (
    <svg viewBox="0 0 400 60" preserveAspectRatio="none"
      style={{ width: '100%', height: '100%', display: 'block' }}>
      <defs>
        {sections.map((sec, i) => (
          <clipPath key={i} id={`flip-clip-${seed}-${i}`}>
            <rect x={sec.start * 4} y={0} width={(sec.end - sec.start) * 4} height={60} />
          </clipPath>
        ))}
      </defs>
      {sections.map((sec, i) => (
        <path
          key={i}
          d={d}
          stroke={sec.color}
          strokeWidth="1.6"
          strokeLinecap="round"
          fill="none"
          clipPath={`url(#flip-clip-${seed}-${i})`}
        />
      ))}
    </svg>
  );
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
function LargeKnob({ color, size = 36 }: { color: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      border: `1px solid ${CTRL_BDR}`, background: CTRL_BG,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: `0 0 8px ${color}18`, flexShrink: 0,
    }}>
      <div style={{ width: 2, height: size * 0.35, borderRadius: 3, background: color, transform: 'translateY(-3px)' }} />
    </div>
  );
}

// ── Section label row (matches CuePointsView section lane) ───────────────────
function SectionRow({ sections }: { sections: SectionDef[] }) {
  return (
    <div style={{ position: 'relative', height: 40, borderBottom: `1px solid ${BORDER_F}` }}>
      {sections.map(sec => (
        <div
          key={sec.label}
          style={{
            position: 'absolute', left: `${sec.start}%`, width: `${sec.end - sec.start}%`,
            top: 5, height: 28,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden', borderBottom: `2px solid ${sec.color}`,
          }}
        >
          <span style={{
            fontFamily: 'monospace', fontSize: 9, fontWeight: 700,
            color: sec.color, letterSpacing: '0.06em',
            textShadow: '0 1px 4px rgba(0,0,0,0.8)', whiteSpace: 'nowrap',
          }}>
            {sec.label.toUpperCase()}
          </span>
        </div>
      ))}
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
  placeholderCamelot: string;
  role: 'VOCAL' | 'INSTRUMENTAL';
  roleColor: string;
}

function TrackHeader({ track, placeholderEmoji, placeholderTitle, placeholderArtist, placeholderBpm, placeholderCamelot, role, roleColor }: TrackHeaderProps) {
  const title   = track?.title ?? placeholderTitle;
  const artist  = track?.artist ?? placeholderArtist;
  const bpm     = track?.bpm != null ? track.bpm.toFixed(0) : placeholderBpm;
  const keyStr  = track ? (formatKey(track.camelot_key ?? track.musical_key) || placeholderCamelot) : placeholderCamelot;

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
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 8, color: MUTED, letterSpacing: '0.08em', textTransform: 'uppercase' }}>BPM</div>
          <div style={{ fontSize: 15, fontWeight: 900, color: FG, fontVariantNumeric: 'tabular-nums' }}>{bpm}</div>
        </div>
        {keyStr && <CamelotBadge k={keyStr} />}
        <span style={{ fontSize: 11, color: MUTED }}>···</span>
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
  onSelect,
  waveformState,
  otherTrack,
}: {
  candidate: RouletteCandidateAnalysis;
  selected: boolean;
  onSelect: () => void;
  waveformState: WaveformLoadState;
  otherTrack: RekordboxTrack | null;
}) {
  const { track } = candidate;
  const bpm    = track.bpm != null ? track.bpm.toFixed(0) : '—';
  const keyStr = formatKey(track.camelot_key ?? track.musical_key);
  const keyClr = camelotColor(track.camelot_key ?? track.musical_key);
  const initials = `${(track.artist?.[0] ?? track.title[0] ?? '?')}${track.title[0] ?? '?'}`.toUpperCase();

  const rel = useMemo<CamelotRelationship | null>(() => {
    if (!otherTrack) return null;
    const mine   = trackCamelotCode(track);
    const theirs = trackCamelotCode(otherTrack);
    if (!mine || !theirs) return 'unknown';
    return classifyCamelotRelationship(mine, theirs);
  }, [track, otherTrack]);

  const dotClr = matchDotColor(rel);

  return (
    <button
      type="button"
      onClick={onSelect}
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

      {/* Play circle */}
      <div style={{
        width: 24, height: 24, borderRadius: '50%',
        background: CTRL_BG, border: `1px solid ${CTRL_BDR}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 7, color: FG, flexShrink: 0, paddingLeft: 1,
      }}>▶</div>

      {/* Title + artist */}
      <div style={{ minWidth: 0, overflow: 'hidden' }}>
        <div style={{
          fontSize: 11, fontWeight: 600, color: FG,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{track.title}</div>
        <div style={{
          fontSize: 10, color: MUTED,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{track.artist ?? 'Unknown artist'}</div>
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

      {/* ··· */}
      <div style={{ fontSize: 11, color: MUTED, textAlign: 'center' }}>···</div>
    </button>
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
  otherTrack: RekordboxTrack | null;
}

function SelectPanel({
  role, suggested, library,
  selectedId, onSelect,
  tab, onTabChange,
  search, onSearchChange,
  getWaveformState, otherTrack,
}: SelectPanelProps) {
  const isVocal = role === 'vocal';
  const roleColor = isVocal ? SECONDARY : PRIMARY;
  const roleLabel = isVocal ? 'Vocal' : 'Instrumental';
  const roleEmoji = isVocal ? '🎤' : '⚡';
  const list = tab === 'suggested' ? suggested : library;

  // Filter by search
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(c =>
      `${c.track.title} ${c.track.artist ?? ''}`.toLowerCase().includes(q),
    );
  }, [list, search]);

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

      {/* Track list */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: 11, color: MUTED }}>
            {tab === 'suggested' && suggested.length === 0
              ? (otherTrack ? 'No compatible suggestions for this selection.' : 'Select the opposite role to see suggestions.')
              : library.length === 0
                ? 'No tracks in library yet.'
                : 'No tracks match your search.'}
          </div>
        ) : (
          filtered.map(c => (
            <TrackSelectorRow
              key={c.track.id}
              candidate={c}
              selected={c.track.id === selectedId}
              onSelect={() => onSelect(c.track.id)}
              waveformState={getWaveformState(c.track.id)}
              otherTrack={otherTrack}
            />
          ))
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
  bpmDiff: number | null;
  pairRejectionReason: RouletteHardFilterReason | null;
  onOpenDropLab: () => void;
}

function CompatibilityPanel({
  vocal,
  instr,
  vocalStemState,
  instrStemState,
  keyRel,
  bpmDiff,
  pairRejectionReason,
  onOpenDropLab,
}: CompatibilityPanelProps) {
  const vocalKey = vocal ? (formatKey(vocal.track.camelot_key ?? vocal.track.musical_key) || null) : null;
  const instrKey = instr ? (formatKey(instr.track.camelot_key ?? instr.track.musical_key) || null) : null;

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

  const bpmInfo = bpmDiff != null ? (() => {
    if (bpmDiff <= 2) return { label: 'Easy Mix', color: '#22c55e' };
    if (bpmDiff <= 5) return { label: 'Moderate', color: '#f59e0b' };
    return { label: 'Hard Mix', color: '#ef4444' };
  })() : null;

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
          value={bpmDiff != null ? `+${bpmDiff.toFixed(1)} BPM` : '—'}
          valueColor={bpmInfo?.color ?? MUTED}
          subtitle={bpmInfo?.label}
        />

        {/* Phrase Alignment (placeholder) */}
        <InfoRow
          icon="📐"
          label="Phrase Alignment"
          value={vocal && instr ? 'Great Match' : '—'}
          valueColor={vocal && instr ? '#22c55e' : MUTED}
          subtitle={vocal && instr ? 'Phrase analysis coming soon' : undefined}
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

      {/* Pair Ready / Not Ready banner */}
      <div style={{ padding: 12 }}>
        {!vocal || !instr ? (
          <div style={{
            padding: '12px 14px', borderRadius: 10, textAlign: 'center',
            background: SURFACE, border: `1px solid ${BORDER_S}`,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: MUTED }}>Select both tracks</div>
            <div style={{ fontSize: 10, color: MUTED, marginTop: 2, opacity: 0.7 }}>Choose a vocal and instrumental to analyze compatibility.</div>
          </div>
        ) : pairReady ? (
          <button
            type="button"
            onClick={onOpenDropLab}
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 10,
              background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)',
              cursor: 'pointer', textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 800, color: '#22c55e' }}>✓ Pair Ready</div>
            <div style={{ fontSize: 10, color: '#22c55e', opacity: 0.75, marginTop: 2 }}>Open in Drop Lab →</div>
          </button>
        ) : (
          <button
            type="button"
            onClick={onOpenDropLab}
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 10,
              background: `${PRIMARY}10`, border: `1px solid ${PRIMARY}30`,
              cursor: 'pointer', textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 800, color: PRIMARY }}>Pair Not Ready</div>
            <div style={{ fontSize: 10, color: PRIMARY, opacity: 0.7, marginTop: 2 }}>
              {notReadyMessage}
            </div>
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
  vocalWaveformState,
  instrWaveformState,
}: {
  vocalTrack: RekordboxTrack | null;
  instrTrack: RekordboxTrack | null;
  vocalWaveformState: WaveformLoadState;
  instrWaveformState: WaveformLoadState;
}) {
  const useRealVocal = vocalWaveformState.status === 'loaded';
  const useRealInstr = instrWaveformState.status === 'loaded';

  return (
    <>
      {/* Vocal track header */}
      <TrackHeader
        track={vocalTrack}
        placeholderEmoji="🎤"
        placeholderTitle="Select a vocal stem"
        placeholderArtist="No vocal selected"
        placeholderBpm="—"
        placeholderCamelot="—"
        role="VOCAL"
        roleColor={SECONDARY}
      />

      {/* Shared beat grid bar */}
      <div style={{
        display: 'flex', alignItems: 'center', height: 16,
        padding: '0 16px', background: BG, borderBottom: `1px solid ${BORDER_F}`,
      }}>
        <span style={{ fontSize: 7, color: MUTED, marginRight: 6, flexShrink: 0, letterSpacing: '0.08em' }}>BAR</span>
        {BAR_NUMBERS.map(n => (
          <div key={n} style={{ flex: 1, fontSize: 7, color: MUTED, opacity: 0.5 }}>{n}</div>
        ))}
      </div>

      {/* Vocal section labels */}
      <SectionRow sections={VOCAL_SECTIONS} />

      {/* Vocal waveform */}
      <div style={{ height: 88, position: 'relative', overflow: 'hidden', background: BG }}>
        {useRealVocal ? (
          <RekordboxPreviewWaveform
            state={vocalWaveformState}
            height={88}
            variant="detail"
            appearance="rekordbox"
            renderMode="area"
            showCenterLine
            surface={false}
          />
        ) : (
          <MultiColorWaveform sections={VOCAL_SECTIONS} seed={1101} bars={260} />
        )}
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: '55%', width: 1.5, background: 'var(--color-waveform-playhead)' }} />
      </div>

      {/* Instrumental section labels */}
      <SectionRow sections={INSTR_SECTIONS} />

      {/* Instrumental waveform */}
      <div style={{ height: 88, position: 'relative', overflow: 'hidden', background: BG }}>
        {useRealInstr ? (
          <RekordboxPreviewWaveform
            state={instrWaveformState}
            height={88}
            variant="detail"
            appearance="rekordbox"
            renderMode="area"
            showCenterLine
            surface={false}
          />
        ) : (
          <MultiColorWaveform sections={INSTR_SECTIONS} seed={1202} bars={260} />
        )}
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: '55%', width: 1.5, background: 'var(--color-waveform-playhead)' }} />
      </div>

      {/* Instrumental track header */}
      <TrackHeader
        track={instrTrack}
        placeholderEmoji="⚡"
        placeholderTitle="Select an instrumental"
        placeholderArtist="No instrumental selected"
        placeholderBpm="—"
        placeholderCamelot="—"
        role="INSTRUMENTAL"
        roleColor={PRIMARY}
      />

      {/* EQ + transport dock */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'auto 1fr auto',
        background: PANEL, borderTop: `1px solid ${BORDER_F}`,
      }}>
        {/* Vocal EQ */}
        <div style={{ padding: '14px 18px', borderRight: `1px solid ${BORDER_F}` }}>
          <div style={{ fontSize: 8, fontWeight: 800, color: SECONDARY, letterSpacing: '0.1em', marginBottom: 10 }}>VOCAL EQ</div>
          <div style={{ display: 'flex', gap: 16 }}>
            {[['LOW', '-2.0'], ['MID', '+1.5'], ['HIGH', '+3.0']].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                <LargeKnob color={SECONDARY} size={36} />
                <div style={{ fontSize: 8, color: MUTED, letterSpacing: '0.1em' }}>{l}</div>
                <div style={{ fontSize: 8, color: FG, opacity: 0.6 }}>{v} dB</div>
              </div>
            ))}
          </div>
        </div>

        {/* Center transport */}
        <div style={{
          padding: '14px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
          borderRight: `1px solid ${BORDER_F}`, minWidth: 180,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button style={{
              padding: '4px 10px', borderRadius: 6, fontSize: 8, fontWeight: 700, cursor: 'pointer',
              background: SURFACE, border: `1px solid ${BORDER_S}`, color: SECONDARY,
            }}>⊞ SYNC ▾</button>
            <div>
              <div style={{ fontSize: 7, color: MUTED, letterSpacing: '0.1em', textTransform: 'uppercase' }}>BPM</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <div style={{ fontSize: 16, fontWeight: 900, color: FG, fontVariantNumeric: 'tabular-nums' }}>125.0</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 7, color: MUTED, cursor: 'pointer' }}>▲</span>
                  <span style={{ fontSize: 7, color: MUTED, cursor: 'pointer' }}>▼</span>
                </div>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {(['⏮', '⏪', '▶', '⏩', '⏭'] as const).map((c, i) => (
              <button key={i} style={{
                width: i === 2 ? 36 : 26, height: i === 2 ? 36 : 26, borderRadius: '50%',
                background: i === 2 ? 'var(--color-control-green)' : CTRL_BG,
                border: `1px solid ${i === 2 ? 'var(--color-control-green)' : CTRL_BDR}`,
                color: i === 2 ? '#000' : FG,
                fontSize: i === 2 ? 13 : 8, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{c}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 8, color: MUTED }}>LOOP</span>
            <span style={{
              padding: '2px 8px', borderRadius: 4, fontSize: 9, fontWeight: 700,
              background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.22)',
              color: 'var(--color-control-amber)',
            }}>16 Bars ▾</span>
            <span style={{ fontSize: 8, color: MUTED }}>MIX</span>
            <div style={{ width: 56, height: 4, borderRadius: 2, background: SURFACE, position: 'relative' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '60%', background: `${PRIMARY}60`, borderRadius: 2 }} />
              <div style={{ position: 'absolute', right: 8, top: -4, width: 12, height: 12, borderRadius: '50%', background: FG, border: `2px solid ${BORDER_S}` }} />
            </div>
          </div>
        </div>

        {/* Instrumental EQ */}
        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <div style={{ fontSize: 8, fontWeight: 800, color: PRIMARY, letterSpacing: '0.1em', marginBottom: 10 }}>INSTRUMENTAL EQ</div>
          <div style={{ display: 'flex', gap: 16 }}>
            {[['LOW', '+1.0'], ['MID', '-1.0'], ['HIGH', '+2.0']].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                <LargeKnob color={PRIMARY} size={36} />
                <div style={{ fontSize: 8, color: MUTED, letterSpacing: '0.1em' }}>{l}</div>
                <div style={{ fontSize: 8, color: FG, opacity: 0.6 }}>{v} dB</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Main FlipLabView ──────────────────────────────────────────────────────────
const WAVEFORM_VISIBLE_LIMIT = 40;

export function FlipLabView() {
  const { navigate } = useAppRouter();

  const [vocals,  setVocals]  = useState<RouletteCandidateAnalysis[]>([]);
  const [instrs,  setInstrs]  = useState<RouletteCandidateAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedVocalId, setSelectedVocalId] = useState<string | null>(null);
  const [selectedInstrId, setSelectedInstrId] = useState<string | null>(null);
  const [vocalStemState, setVocalStemState] = useState<FlipLabStemRoleState>(() => flipLabStemLifecycle.getState('vocal'));
  const [instrStemState, setInstrStemState] = useState<FlipLabStemRoleState>(() => flipLabStemLifecycle.getState('instrumental'));

  const [vocalTab, setVocalTab] = useState<'suggested' | 'library'>('suggested');
  const [instrTab, setInstrTab] = useState<'suggested' | 'library'>('suggested');
  const [vocalSearch, setVocalSearch] = useState('');
  const [instrSearch, setInstrSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      fetchRouletteCandidateAnalysis('vocal'),
      fetchRouletteCandidateAnalysis('instrumental'),
    ]).then(([vs, is]) => {
      setVocals(vs);
      setInstrs(is);
      const initialPair = chooseInitialFlipLabPair(vs, is);
      setSelectedVocalId(initialPair?.vocal.track.id ?? null);
      setSelectedInstrId(initialPair?.instrumental.track.id ?? null);
    }).catch(err => {
      setLoadError(err instanceof Error ? err.message : 'Failed to load candidates.');
    }).finally(() => setLoading(false));
  }, []);

  const importId = useMemo(
    () => vocals[0]?.track.import_id ?? instrs[0]?.track.import_id ?? null,
    [vocals, instrs],
  );

  const selectedVocal = useMemo(() => vocals.find(c => c.track.id === selectedVocalId) ?? null, [vocals, selectedVocalId]);
  const selectedInstr = useMemo(() => instrs.find(c => c.track.id === selectedInstrId) ?? null, [instrs, selectedInstrId]);

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

  // Waveform loading: selected tracks + first N visible in each filtered list
  const vocalVisibleIds = useMemo(() => {
    const base = vocalTab === 'suggested' ? vocalSuggested : vocalLibrary;
    const q = vocalSearch.trim().toLowerCase();
    const filtered = q ? base.filter(c => `${c.track.title} ${c.track.artist ?? ''}`.toLowerCase().includes(q)) : base;
    return filtered.slice(0, WAVEFORM_VISIBLE_LIMIT).map(c => c.track.id);
  }, [vocalTab, vocalSuggested, vocalLibrary, vocalSearch]);

  const instrVisibleIds = useMemo(() => {
    const base = instrTab === 'suggested' ? instrSuggested : instrLibrary;
    const q = instrSearch.trim().toLowerCase();
    const filtered = q ? base.filter(c => `${c.track.title} ${c.track.artist ?? ''}`.toLowerCase().includes(q)) : base;
    return filtered.slice(0, WAVEFORM_VISIBLE_LIMIT).map(c => c.track.id);
  }, [instrTab, instrSuggested, instrLibrary, instrSearch]);

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
    const vKey = trackCamelotCode(selectedVocal.track);
    const iKey = trackCamelotCode(selectedInstr.track);
    if (!vKey || !iKey) return 'unknown';
    return classifyCamelotRelationship(vKey, iKey);
  }, [selectedVocal, selectedInstr]);

  const bpmDiff = useMemo(() => {
    const vBpm = selectedVocal?.track.bpm;
    const iBpm = selectedInstr?.track.bpm;
    if (vBpm == null || iBpm == null) return null;
    return Math.abs(vBpm - iBpm);
  }, [selectedVocal, selectedInstr]);

  const pairRejectionReason = useMemo(
    () => getFlipLabPairRejectionReason(selectedVocal, selectedInstr),
    [selectedVocal, selectedInstr],
  );

  const handleSelectVocal = useCallback((trackId: string) => {
    const next = applyFlipLabSelection('vocal', trackId, selectedVocalId, selectedInstrId);
    setSelectedVocalId(next.vocalId);
    setSelectedInstrId(next.instrumentalId);
  }, [selectedVocalId, selectedInstrId]);

  const handleSelectInstrumental = useCallback((trackId: string) => {
    const next = applyFlipLabSelection('instrumental', trackId, selectedVocalId, selectedInstrId);
    setSelectedVocalId(next.vocalId);
    setSelectedInstrId(next.instrumentalId);
  }, [selectedVocalId, selectedInstrId]);

  const handleOpenDropLab = useCallback(() => {
    if (!selectedVocal || !selectedInstr) return;
    navigate({
      name: 'drop-lab',
      sourceTrackId: selectedVocal.track.id,
      candidateTrackId: selectedInstr.track.id,
      sourceDropId: null,
      candidateDropId: null,
    });
  }, [navigate, selectedVocal, selectedInstr]);

  const vocalWaveformState  = getWaveformState(selectedVocalId);
  const instrWaveformState  = getWaveformState(selectedInstrId);

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
        vocalWaveformState={vocalWaveformState}
        instrWaveformState={instrWaveformState}
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
          minHeight: 480,
          maxHeight: 'calc(100vh - 600px)',
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
            otherTrack={selectedInstr?.track ?? null}
          />
          <CompatibilityPanel
            vocal={selectedVocal}
            instr={selectedInstr}
            vocalStemState={vocalStemState}
            instrStemState={instrStemState}
            keyRel={keyRel}
            bpmDiff={bpmDiff}
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
            otherTrack={selectedVocal?.track ?? null}
          />
        </div>
      )}
    </div>
  );
}
