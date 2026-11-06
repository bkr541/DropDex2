import { useMemo, useState, type ReactNode } from 'react';
import {
  ArrowRight, CheckmarkFilled, Chemistry, CircleDash, CrossTab, Document, Information, Play,
  Search as SearchIcon, Star, StarFilled, Stop, WarningAlt,
} from '@carbon/icons-react';
import { cn } from '../../lib/utils';
import { PageNameTab } from '../navigation/PageNameTab';
import { ControlButton, FilterDropdown } from './controls';
import { Artwork, TabNavigation } from './display';
import { camelotKeyColor } from './display/camelotKey';
import { MediaTransportControlGroup, TransportButton } from './media';
import {
  Filters, Frame, Main, MiniWave, NAV_TODAY, Rail, TRACKS, TrackTable, makeRand, type NavItem,
} from './LayoutLabDropLabParts';

// New Drop Lab, drawn in the Cue Points style: track header row, borderless timeline,
// audio dock row, underline filter-style controls, and a Cue Points-style table for the
// candidate list. Every piece of the current Drop Lab is here: source and candidate tracks,
// the transition waveform with the swap cue, the status messages, the four preview controls
// (source exit cue, candidate entry cue, line up the entry, preview length), the preview
// transport with progress, candidate details, and the candidate rotation.

const NAV: NavItem[] = [
  ...NAV_TODAY.slice(0, -1),
  { label: 'Drop Lab', icon: Chemistry },
  NAV_TODAY[NAV_TODAY.length - 1],
];

const BUILD = '#ff8a1f';
const DROP = '#ff5a4f';
const SWAP = '#3b91ff';

// ── Sample data ──────────────────────────────────────────────────────────────

const SOURCE = { title: 'CID - Fancy. $hit (KALYP Remix) - Final 2026', artist: 'Artist Not Available', bpm: '140.0', key: '04A', rating: 4, drop: 'Drop 1 · high' };

type CandidateStatus = 'ready' | 'missing-waveform' | 'waveform-failed' | 'invalid-waveform' | 'loading-waveform' | 'missing-drop';

interface Candidate {
  title: string; artist: string; bpm: string; key: string; rating: number; drop: string;
  match: string; reasons: string[]; status: CandidateStatus; seed: number;
}

const CANDIDATES: Candidate[] = [
  { title: "Choosin' Texas ( SENDSZN Remix)", artist: 'Artist Not Available', bpm: '140.0', key: '03A', rating: 3, drop: 'Drop 1 · high', match: 'Great match', reasons: ['Same BPM', 'Key compatible'], status: 'ready', seed: 15 },
  { title: 'WIde Open (MAVIC FLIP) Final', artist: 'DISCO LINES', bpm: '140.0', key: '07A', rating: 4, drop: 'Drop 2 · high', match: 'Great match', reasons: ['Same BPM', 'Strong drop'], status: 'ready', seed: 21 },
  { title: 'Stevie Wonder - Superstition (WBBL Remix)', artist: 'WBBL', bpm: '138.0', key: '02A', rating: 0, drop: 'Drop 1 · medium', match: 'Good match', reasons: ['BPM within 2', 'Key compatible'], status: 'ready', seed: 34 },
  { title: 'Big Sean - Dance (A$$) [Levity x Justin Jay Rem…', artist: 'Artist Not Available', bpm: '142.0', key: '05B', rating: 0, drop: '', match: 'Good match', reasons: ['BPM within 2'], status: 'missing-waveform', seed: 44 },
  { title: 'Warfare (HAHNER Edit)', artist: 'DJ Diesel & CELO x YDG x ISOXO', bpm: '139.0', key: '07A', rating: 2, drop: '', match: 'Possible', reasons: ['BPM within 2'], status: 'missing-drop', seed: 51 },
];

const STATUS_TEXT: Record<Exclude<CandidateStatus, 'ready'>, string> = {
  'missing-waveform': 'Missing waveform',
  'waveform-failed': 'Waveform failed',
  'invalid-waveform': 'Invalid waveform',
  'loading-waveform': 'Loading waveform',
  'missing-drop': 'Missing drop',
};

const ALIGNMENT: Record<-1 | 0 | 1, string> = {
  [-1]: 'Candidate starts one beat before its detected drop',
  0: 'Candidate starts exactly on its detected drop',
  1: 'Candidate starts one beat after its detected drop',
};

const BPM_NUM = 140;

function mmss(sec: number) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ── Header row ───────────────────────────────────────────────────────────────

const LABEL = 'uppercase tracking-[0.08em] text-foreground/45';

function IconBtn({ title, children, disabled }: { title: string; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function TrackHalf({ eyebrow, track, muted }: { eyebrow: string; track: { title: string; artist: string; bpm: string; key: string; rating: number; drop: string } | null; muted?: boolean }) {
  return (
    <div className={cn('flex min-w-0 flex-1 items-center gap-3', muted && 'opacity-70')}>
      <Artwork src={null} alt="" fallbackTitle="No artwork" className="h-9 w-9 shrink-0 rounded-[7px]" />
      <div className="min-w-0">
        <div className="text-[9px] font-bold uppercase leading-none tracking-[0.2em] text-muted-foreground">{eyebrow}</div>
        <h2 className="mt-0.5 truncate text-[15px] font-bold leading-tight tracking-[-0.02em] text-foreground">{track?.title ?? 'No track selected'}</h2>
        <div className="flex min-w-0 items-center gap-3 text-[10px] font-semibold text-muted-foreground">
          <span className="min-w-0 max-w-[40%] truncate text-xs font-medium">{track?.artist ?? 'Artist not stored'}</span>
          {track && (
            <span className="flex shrink-0 items-center gap-x-3">
              <span><span className={LABEL}>BPM</span> <strong className="ml-1 text-foreground/90">{track.bpm}</strong></span>
              <span><span className={LABEL}>Key</span> <strong className="ml-1" style={{ color: camelotKeyColor(track.key) }}>{track.key}</strong></span>
              <span className="flex items-center gap-1"><span className={LABEL}>Rating</span> <strong className="ml-1 flex items-center gap-0.5 text-foreground/90">{track.rating > 0 ? <><StarFilled size={9} />{track.rating}/5</> : <><Star size={9} />--</>}</strong></span>
              <span><span className={LABEL}>Drop</span> <strong className="ml-1 text-foreground/90">{track.drop || 'Unavailable'}</strong></span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function HeaderRow({ candidate }: { candidate: Candidate | null }) {
  return (
    <div className="flex shrink-0 items-start gap-4 px-4 py-2 lg:px-5">
      <TrackHalf eyebrow="Selected track" track={SOURCE} />
      <ArrowRight size={14} className="mt-3.5 shrink-0 text-muted-foreground" />
      <TrackHalf eyebrow="Active candidate" track={candidate} muted={!candidate} />
      <div className="-mt-[7px] flex shrink-0 items-center gap-0.5">
        <IconBtn title="Change source track"><SearchIcon size={20} /></IconBtn>
        <IconBtn title="Candidate details" disabled={!candidate}><Document size={20} /></IconBtn>
      </div>
    </div>
  );
}

// ── Transition timeline ──────────────────────────────────────────────────────

type TimelineState = 'ready' | 'loading' | 'unavailable';

function HalfWave({ seed, kind }: { seed: number; kind: 'build' | 'drop' }) {
  const path = useMemo(() => {
    const rand = makeRand(seed);
    let d = '';
    let spike = 0;
    for (let i = 0; i < 300; i++) {
      const f = i / 300;
      let a: number;
      if (kind === 'build') a = 0.28 + f * 0.4 + rand() * 0.1 + (i % 36 < 3 ? 0.12 : 0);
      else { if (i % 20 === 0 && rand() > 0.3) spike = 0.35 + rand() * 0.3; spike *= 0.85; a = 0.62 + rand() * 0.12 + spike * 0.5 - f * 0.12; }
      const h = Math.min(0.98, a) * 48;
      d += `M${i + 0.5} ${50 - h}V${50 + h}`;
    }
    return d;
  }, [seed, kind]);
  return (
    <svg viewBox="0 0 300 100" preserveAspectRatio="none" width="100%" height="100%" style={{ display: 'block' }}>
      <path d={path} stroke={kind === 'build' ? BUILD : DROP} strokeWidth="1.2" fill="none" />
    </svg>
  );
}

function TransitionTimeline({
  barCount, offset, playing, progress, state, message,
}: { barCount: number; offset: -1 | 0 | 1; playing: boolean; progress: number; state: TimelineState; message?: string }) {
  const beatsPerHalf = barCount * 4;
  const grid = useMemo(() => {
    let g = ''; let r = '';
    for (let i = 0; i <= beatsPerHalf * 2; i++) { g += `M${i} 0V62`; if (i % 4 === 0) r += `M${i} 35V100`; }
    return { g, r };
  }, [beatsPerHalf]);
  const labelEvery = barCount > 8 ? 2 : 1;
  const bars = Array.from({ length: barCount }, (_, i) => i);
  const lane = (h: number, children: ReactNode, className?: string) => (
    <div className={cn('relative', className)} style={{ height: h, paddingInline: 24 }}><div className="relative h-full w-full">{children}</div></div>
  );
  return (
    <div className="shrink-0 px-4 pt-1 lg:px-5">
      {lane(34, (
        <div className="absolute -translate-x-1/2" style={{ left: '50%', top: 6 }}>
          <div className="relative">
            <svg width={26} height={29} viewBox="0 0 28 32"><path d="M3 2h22a1 1 0 0 1 1 1v17.5a2 2 0 0 1-.9 1.7L14 30 2.9 22.2A2 2 0 0 1 2 20.5V3a1 1 0 0 1 1-1z" fill={`${SWAP}22`} stroke={SWAP} strokeWidth="2" /></svg>
            <span className="absolute inset-x-0 top-[5px] flex justify-center" style={{ color: SWAP }}><CrossTab size={13} /></span>
          </div>
        </div>
      ))}
      {lane(28, (
        <>
          <div className="absolute left-0 top-0 flex items-center justify-center font-mono text-[9px] font-bold tracking-wide" style={{ width: '50%', height: 22, color: BUILD, borderBottom: `2px solid ${BUILD}` }}>SELECTED BUILD</div>
          <div className="absolute right-0 top-0 flex items-center justify-center font-mono text-[9px] font-bold tracking-wide" style={{ width: '50%', height: 22, color: DROP, borderBottom: `2px solid ${DROP}` }}>CANDIDATE DROP</div>
        </>
      ))}
      {lane(68, (
        state === 'loading' ? (
          <div className="absolute inset-0 flex items-center justify-center"><div className="h-12 w-4/5 animate-pulse rounded-lg bg-white/[0.06]" /></div>
        ) : state === 'unavailable' ? (
          <div className="absolute inset-0 flex items-center justify-center text-center text-xs text-muted-foreground">{message ?? 'Waveform segment unavailable'}</div>
        ) : (
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute inset-y-0 left-0 w-1/2"><HalfWave seed={7} kind="build" /></div>
            <div className="absolute inset-y-0 left-1/2 w-1/2 transition-transform duration-150" style={{ transform: `translateX(${(offset / beatsPerHalf) * 100}%)` }}><HalfWave seed={19} kind="drop" /></div>
            <div className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2" style={{ background: SWAP }} />
            {playing && progress > 0 && (
              <div className="absolute inset-y-0 w-px bg-white shadow-[0_0_7px_rgba(255,255,255,0.75)]" style={{ left: `${progress * 100}%` }}>
                <span className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 -translate-y-[2px] rotate-45 rounded-[1px] bg-white" />
              </div>
            )}
          </div>
        )
      ))}
      {lane(22, (
        <svg viewBox={`0 0 ${beatsPerHalf * 2} 100`} preserveAspectRatio="none" width="100%" height={22} style={{ display: 'block' }}>
          <path d={grid.g} stroke="#3ddc84" strokeWidth="0.55" fill="none" vectorEffect="non-scaling-stroke" strokeOpacity="0.85" />
          <path d={grid.r} stroke="#ff6b6b" strokeWidth="1" fill="none" vectorEffect="non-scaling-stroke" />
        </svg>
      ))}
      {lane(18, (
        <>
          {bars.filter((i) => i % labelEvery === 0).map((i) => (
            <span key={`l${i}`} className="absolute font-mono text-[11px] leading-[18px] tabular-nums text-muted-foreground" style={{ left: `${(i / barCount) * 50}%` }}>{`−${barCount - i}`}</span>
          ))}
          {bars.filter((i) => i % labelEvery === 0).map((i) => (
            <span key={`r${i}`} className="absolute font-mono text-[11px] leading-[18px] tabular-nums text-muted-foreground" style={{ left: `${50 + (i / barCount) * 50}%` }}>{i + 1}</span>
          ))}
        </>
      ))}
      <div className="flex items-center justify-between px-6 pb-1 pt-0.5 text-[10px] text-muted-foreground">
        <span><span className="font-bold uppercase tracking-[0.14em]" style={{ color: BUILD }}>First</span> · play the selected track&apos;s build</span>
        <span className="rounded-md border px-2 py-0.5 font-medium" style={{ borderColor: `${SWAP}59`, color: SWAP }}>Swap cue · {ALIGNMENT[offset]}</span>
        <span><span className="font-bold uppercase tracking-[0.14em]" style={{ color: DROP }}>Then</span> · swap into the candidate drop</span>
      </div>
    </div>
  );
}

// ── Status messages ──────────────────────────────────────────────────────────

type StatusKind = 'ready' | 'warning' | 'info';
function StatusLine({ kind, children, retry }: { kind: StatusKind; children: ReactNode; retry?: boolean }) {
  const Icon = kind === 'ready' ? CheckmarkFilled : kind === 'warning' ? WarningAlt : Information;
  const color = kind === 'ready' ? '#34d399' : kind === 'warning' ? '#fbbf24' : '#8e9aa8';
  return (
    <div role={kind === 'warning' ? 'status' : undefined} className="flex items-center gap-2 px-5 py-[3px] text-[11px]" style={{ color }}>
      <Icon size={13} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {retry && <button type="button" className="shrink-0 rounded px-1.5 text-[10px] font-semibold text-foreground/80 hover:bg-white/10">Retry</button>}
    </div>
  );
}

// ── Dock row: preview transport ──────────────────────────────────────────────

type Phase = 'ready' | 'build' | 'drop' | 'preparing' | 'error';
const PHASE_TEXT: Record<Phase, string> = {
  ready: 'Ready to audition', build: 'Playing selected build', drop: 'Playing candidate drop', preparing: 'Preparing audio', error: 'Audio needs attention',
};

function DockRow({ playing, progress, barCount, phase, onToggle }: { playing: boolean; progress: number; barCount: number; phase: Phase; onToggle: () => void }) {
  const total = (barCount * 8 * 60) / BPM_NUM;
  const chip = phase === 'error' ? 'border-amber-400/35 bg-amber-400/10 text-amber-300' : playing ? 'border-primary/40 bg-primary/15 text-primary' : 'border-[var(--color-border-subtle)] text-muted-foreground';
  return (
    <div className="flex shrink-0 items-center gap-4 border-y border-[var(--color-border-faint)] bg-[color-mix(in_srgb,var(--color-surface)_56%,var(--color-background))] px-4 py-2" role="region" aria-label="Drop Lab audio dock">
      <div className="w-[230px] shrink-0">
        <p className="text-[9px] font-black uppercase tracking-[0.22em] text-primary">Transition transport</p>
        <p className="mt-1 flex items-center gap-1.5 text-[10px] font-semibold text-foreground/80">Selected build <ArrowRight size={10} className="text-muted-foreground" /> <span className="rounded border border-primary/30 bg-primary/10 px-1 text-primary">Swap at cue</span> <ArrowRight size={10} className="text-muted-foreground" /> Candidate drop</p>
      </div>
      <TransportButton label={playing ? 'Stop preview' : phase === 'error' ? 'Retry preview' : 'Play preview'} tone={playing ? 'stop' : 'play'} size="compact" onClick={onToggle}>
        {phase === 'preparing' ? <CircleDash size={16} className="animate-spin" /> : playing ? <Stop size={14} /> : <Play size={16} />}
      </TransportButton>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="w-9 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">{mmss(progress * total)}</span>
        <div className="relative flex-1">
          <div className="h-1.5 rounded-full bg-white/10"><div className="h-full rounded-full bg-primary transition-[width] duration-75" style={{ width: `${progress * 100}%` }} /></div>
          <span className="absolute inset-y-[-3px] left-1/2 w-px bg-foreground/70" aria-hidden="true" />
        </div>
        <span className="w-9 shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">{mmss(total)}</span>
      </div>
      <span className={cn('shrink-0 rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.16em]', chip)}>{PHASE_TEXT[phase]}</span>
    </div>
  );
}

// ── Controls row (filter-row style) ──────────────────────────────────────────

function ControlsRow({
  offset, onOffset, barCount, onBars, disabledReason,
}: { offset: -1 | 0 | 1; onOffset: (v: -1 | 0 | 1) => void; barCount: number; onBars: (v: number) => void; disabledReason?: string }) {
  const cue = (label: string, helper: string) => (
    <div className="min-w-[210px]">
      <FilterDropdown label={label} value="1" onChange={() => undefined} className="w-full" options={[{ value: '1', label: '1. Drop · 0:57 · high' }, { value: '2', label: '2. Drop · 1:46 · medium' }]} />
      <p className="mt-1 text-[10px] leading-tight text-muted-foreground">{helper}</p>
    </div>
  );
  const seg = (label: string, helper: string, node: ReactNode) => (
    <div>
      <p className="mb-1 text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
      {node}
      <p className="mt-1 text-[10px] leading-tight text-muted-foreground">{helper}</p>
    </div>
  );
  return (
    <div className="flex shrink-0 flex-wrap items-start gap-x-6 gap-y-3 border-b border-[var(--color-border-faint)] px-4 py-3 lg:px-5">
      {cue('1 · Source exit cue', 'The selected track plays up to this line.')}
      {cue('2 · Candidate entry cue', 'The new track begins from this detected drop.')}
      {seg('3 · Line up the entry', 'Move the candidate start around its detected drop.', (
        <TabNavigation ariaLabel="Candidate drop alignment" variant="filter" value={String(offset)} onChange={(v) => onOffset(Number(v) as -1 | 0 | 1)} options={[{ id: '-1', label: '−1 beat' }, { id: '0', label: 'On drop' }, { id: '1', label: '+1 beat' }]} />
      ))}
      {seg('4 · Preview length', 'How much build and drop audio to hear.', (
        <TabNavigation ariaLabel="Comparison window" variant="filter" value={String(barCount)} onChange={(v) => onBars(Number(v))} options={[{ id: '4', label: '4 bars' }, { id: '8', label: '8 bars' }, { id: '16', label: '16 bars' }]} />
      ))}
      <p className={cn('ml-auto max-w-[260px] self-center text-[10px] leading-snug', disabledReason ? 'text-amber-300' : 'text-muted-foreground')}>
        {disabledReason ?? 'Press play to hear the build, then the automatic swap into the candidate drop.'}
      </p>
    </div>
  );
}

// ── Candidate rotation (Cue Points table style) ──────────────────────────────

const CAND_COLS = 'minmax(0,1.5fr) 150px 64px 80px 110px minmax(0,1.1fr) 150px 28px';

function CandidateRow({ c, active, onSelect }: { c: Candidate; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onSelect}
      className={cn('relative grid w-full items-center border-b border-[var(--color-border-faint)] px-5 text-left transition-colors hover:bg-white/[0.03]', active && 'bg-primary/[0.07]')}
      style={{ gridTemplateColumns: CAND_COLS, height: 58 }}
    >
      {active && <span className="absolute inset-y-0 left-0 w-[3px] bg-primary" />}
      <div className="flex min-w-0 items-center gap-3">
        <Artwork src={null} alt="" fallbackTitle="No artwork" className="h-10 w-10 shrink-0 rounded-md" />
        <div className="min-w-0">
          <div className={cn('truncate text-[13px] font-bold', active && 'text-primary')}>{c.title}</div>
          <div className="truncate text-[11px] text-muted-foreground">{c.artist}</div>
        </div>
      </div>
      <div className="px-3"><MiniWave seed={c.seed} cueAt={[]} /></div>
      <span className="font-mono text-[13px] font-bold tabular-nums">{c.bpm}</span>
      <span className="font-mono text-[13px] font-bold" style={{ color: camelotKeyColor(c.key) }}>{c.key}</span>
      <span className="text-[11px] font-bold uppercase tracking-wider text-primary">{c.match}</span>
      <span className="flex flex-wrap gap-1">{c.reasons.map((r) => <span key={r} className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-muted-foreground">{r}</span>)}</span>
      {c.status === 'ready'
        ? <span className="flex items-center gap-1.5 text-[11px] text-emerald-400"><CheckmarkFilled size={12} /> Ready to preview</span>
        : <span className="flex items-center gap-1.5 text-[11px] text-amber-400"><WarningAlt size={12} /> {STATUS_TEXT[c.status]}</span>}
      <span aria-hidden="true">{active ? <CheckmarkFilled size={16} className="text-primary" /> : <span className="block h-3.5 w-3.5 rounded-full border border-white/25" />}</span>
    </button>
  );
}

function CandidateTable({ candidates, activeIdx, onSelect, loading }: { candidates: Candidate[]; activeIdx: number; onSelect: (i: number) => void; loading?: boolean }) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3">
        <h3 className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Candidate rotation</h3>
        <span className="flex items-center gap-2 font-mono text-[11px] tabular-nums text-muted-foreground">
          {loading && <CircleDash size={13} className="animate-spin" aria-label="Loading candidates" />}
          {candidates.length} candidates
        </span>
      </div>
      <div className="grid items-center border-b border-t border-[var(--color-border-faint)] px-5 py-2 text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground" style={{ gridTemplateColumns: CAND_COLS }}>
        <span>Candidate</span><span /><span>BPM</span><span>Key</span><span>Match</span><span>Why it fits</span><span>Status</span><span />
      </div>
      <div role="listbox" aria-label="Drop Lab candidates">
        {loading && candidates.length === 0
          ? Array.from({ length: 4 }, (_, i) => <div key={i} className="m-3 h-12 animate-pulse rounded-lg bg-white/[0.05]" />)
          : candidates.length === 0
            ? <p className="py-8 text-center text-xs italic text-muted-foreground">No compatible drop candidates were found for this track.</p>
            : candidates.map((c, i) => <CandidateRow key={c.title} c={c} active={i === activeIdx} onSelect={() => onSelect(i)} />)}
      </div>
    </div>
  );
}

// ── Screens ──────────────────────────────────────────────────────────────────

/** The Drop Lab screen: header, timeline, status, dock, controls, candidate table. */
function DropLabScreen({ initialPlaying = false }: { initialPlaying?: boolean }) {
  const [offset, setOffset] = useState<-1 | 0 | 1>(0);
  const [barCount, setBarCount] = useState(8);
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(initialPlaying);
  const progress = playing ? 0.38 : 0;
  const candidate = CANDIDATES[active];
  const usable = candidate.status === 'ready';
  return (
    <Frame>
      <Rail items={NAV} active="Drop Lab" />
      <Main className="relative px-0">
        <PageNameTab title="Drop Lab" icon={Chemistry} />
        <HeaderRow candidate={candidate} />
        <TransitionTimeline barCount={barCount} offset={offset} playing={playing} progress={progress} state={usable ? 'ready' : 'unavailable'} message="Active candidate has no waveform analysis." />
        <div className="pb-1">
          {usable
            ? <StatusLine kind="ready">Transition preview is prepared from decoded source and candidate audio.</StatusLine>
            : <StatusLine kind="warning">{candidate.title} has no waveform analysis, so it can&apos;t be previewed.</StatusLine>}
        </div>
        <DockRow playing={playing && usable} progress={progress} barCount={barCount} phase={!usable ? 'error' : playing ? (progress < 0.5 ? 'build' : 'drop') : 'ready'} onToggle={() => usable && setPlaying((p) => !p)} />
        <ControlsRow offset={offset} onOffset={setOffset} barCount={barCount} onBars={setBarCount} disabledReason={usable ? undefined : 'Pick a candidate with a waveform and a detected drop.'} />
        <CandidateTable candidates={CANDIDATES} activeIdx={active} onSelect={setActive} />
      </Main>
    </Frame>
  );
}

/** First visit: no source track yet, so the screen is a Cue Points-style browser. */
function PickTrackScreen() {
  return (
    <Frame>
      <Rail items={NAV} active="Drop Lab" />
      <Main className="relative px-0">
        <PageNameTab title="Drop Lab" icon={Chemistry} />
        <div className="flex shrink-0 items-start justify-between gap-4 px-4 py-2 lg:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[7px] border border-[var(--color-border-subtle)] bg-[var(--color-panel)] text-muted-foreground"><Chemistry size={20} /></div>
            <div className="min-w-0">
              <h2 className="text-[17px] font-bold leading-tight tracking-[-0.02em]">Choose a source track</h2>
              <p className="text-xs leading-tight text-muted-foreground">Pick the track whose build-up you want to test other drops against.</p>
            </div>
          </div>
          <div className="-mt-[2px] flex shrink-0 items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Selected: <strong className="text-foreground/90">{TRACKS[0].title}</strong></span>
            <ControlButton variant="primary" className="min-h-[34px] px-3 text-[11px]"><Chemistry size={15} /> Open in Drop Lab</ControlButton>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 border-y border-[var(--color-border-faint)] bg-[color-mix(in_srgb,var(--color-surface)_56%,var(--color-background))] px-2.5 py-2">
          <div className="w-[240px] shrink-0 self-stretch">
            <TabNavigation ariaLabel="Source browser" variant="primary" className="dd-tab-nav--compact" value="library" onChange={() => undefined} options={[{ id: 'library', label: 'Library' }, { id: 'playlists', label: 'Playlists' }]} />
          </div>
          <MediaTransportControlGroup compact ariaLabel="Transport" playing={false} onTogglePlay={() => undefined} previousDisabled rewindDisabled forwardDisabled nextDisabled />
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="w-9 shrink-0 text-right font-mono text-[10px] text-muted-foreground">0:00</span>
            <input type="range" disabled className="h-1.5 min-w-[120px] flex-1 accent-primary opacity-40" aria-label="Playback position" />
            <span className="w-9 shrink-0 font-mono text-[10px] text-muted-foreground">—</span>
          </div>
        </div>
        <Filters />
        <TrackTable selected={0} />
      </Main>
    </Frame>
  );
}

// ── States gallery ───────────────────────────────────────────────────────────

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-background)]">
      <div className="border-b border-[var(--color-border-faint)] px-5 py-2 text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{title}</div>
      <div style={{ minWidth: 1100 }}>{children}</div>
    </div>
  );
}

function StatesGallery() {
  return (
    <div className="space-y-5 overflow-x-auto">
      <Panel title="Timeline while analysis loads"><TransitionTimeline barCount={8} offset={0} playing={false} progress={0} state="loading" /></Panel>
      <Panel title="Timeline when a waveform is unavailable"><TransitionTimeline barCount={8} offset={0} playing={false} progress={0} state="unavailable" message="Active candidate has no waveform analysis." /></Panel>
      <Panel title="Status messages (shown above the dock, one line each)">
        <div className="py-2">
          <StatusLine kind="warning">A drop point could not be identified from this track&apos;s cues or phrase analysis.</StatusLine>
          <StatusLine kind="info">Selected track has no waveform analysis.</StatusLine>
          <StatusLine kind="warning">Selected track waveform is invalid or unsupported: unexpected data format.</StatusLine>
          <StatusLine kind="warning" retry>Active candidate waveform failed to load: network error.</StatusLine>
          <StatusLine kind="warning" retry>Selected track detailed waveform failed to load. Using its preview waveform.</StatusLine>
          <StatusLine kind="info">Beat-grid timing is incomplete, so BPM timing is being used for this window.</StatusLine>
          <StatusLine kind="info">Preparing source and candidate audio for the transition preview.</StatusLine>
          <StatusLine kind="warning">The preview audio could not be prepared. Try again.</StatusLine>
          <StatusLine kind="ready">Transition preview is prepared from decoded source and candidate audio.</StatusLine>
        </div>
      </Panel>
      <Panel title="Dock states">
        <div className="space-y-2 py-2">
          <DockRow playing={false} progress={0} barCount={8} phase="ready" onToggle={() => undefined} />
          <DockRow playing progress={0.2} barCount={8} phase="build" onToggle={() => undefined} />
          <DockRow playing progress={0.7} barCount={8} phase="drop" onToggle={() => undefined} />
          <DockRow playing={false} progress={0} barCount={8} phase="preparing" onToggle={() => undefined} />
          <DockRow playing={false} progress={0} barCount={8} phase="error" onToggle={() => undefined} />
        </div>
      </Panel>
      <Panel title="Candidate rotation: every row status, and the empty and loading states">
        <CandidateTable
          candidates={[
            { ...CANDIDATES[0], status: 'ready' },
            { ...CANDIDATES[1], status: 'waveform-failed' },
            { ...CANDIDATES[2], status: 'invalid-waveform' },
            { ...CANDIDATES[3], status: 'loading-waveform' },
            { ...CANDIDATES[4], status: 'missing-drop' },
          ]}
          activeIdx={0}
          onSelect={() => undefined}
        />
        <CandidateTable candidates={[]} activeIdx={-1} onSelect={() => undefined} />
        <CandidateTable candidates={[]} activeIdx={-1} onSelect={() => undefined} loading />
      </Panel>
    </div>
  );
}

// ── Tab content ──────────────────────────────────────────────────────────────

function Section({ n, title, note, children }: { n: number; title: string; note: string; children: ReactNode }) {
  return (
    <section className="mb-12">
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/15 text-[11px] font-extrabold text-primary">{n}</div>
        <span className="text-[13px] font-bold text-foreground">{title}</span>
        <span className="text-[11px] text-muted-foreground">{note}</span>
      </div>
      {children}
    </section>
  );
}

export function DropLabMockupsContent() {
  return (
    <div className="h-full overflow-y-auto bg-[var(--color-background)] px-8 pb-16 pt-7">
      <div className="mb-8">
        <div className="mb-1 text-sm font-extrabold text-foreground">New Drop Lab</div>
        <div className="max-w-[940px] text-[11px] leading-relaxed text-muted-foreground">
          Drop Lab gets its own spot in the left nav (just before Flip Lab) and a screen built in the Cue Points style: the page-name tab, a track header row with icon-only buttons, a borderless timeline, an audio dock row, underline-style controls and a Cue Points-style table for the candidates. It keeps every function of today's Drop Lab, and adds a way to choose the source track inside the screen. Frames 2 and 3 are interactive: change the alignment and preview length, click a candidate, press play. The sample tracks and numbers are made up.
        </div>
      </div>

      <Section n={1} title="Choose a source track" note="First visit, or after pressing 'Change source track'. Today you can only start Drop Lab from a track's detail page.">
        <PickTrackScreen />
      </Section>
      <Section n={2} title="Drop Lab, ready to audition" note="Selected track on the left, active candidate on the right; the candidate list below is the Candidate Rotation.">
        <DropLabScreen />
      </Section>
      <Section n={3} title="Drop Lab, previewing" note="Same screen with the preview playing: playhead moves through the build, then swaps into the drop at the center cue.">
        <DropLabScreen initialPlaying />
      </Section>
      <Section n={4} title="Loading, warning and empty states" note="Everything the current screen can show, restyled.">
        <StatesGallery />
      </Section>
    </div>
  );
}
