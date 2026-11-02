import { useMemo, type CSSProperties, type ReactNode } from 'react';
import {
  Calendar, ChartBar, CheckmarkFilled, Dashboard, Export, Globe, Growth, Headphones, Idea, LogoInstagram,
  LogoYoutube, Music, Radio, RecordingFilled, Search, Shuffle, Upload, Usb, VolumeUp, Waveform,
} from '@carbon/icons-react';
import { cn } from '../../lib/utils';
import { HeroActionButton } from '../library/HeroActionButton';
import { ControlButton, FilterDropdown, SearchControl } from './controls';
import { Artwork, KeyBadge, TabNavigation } from './display';
import { camelotKeyColor } from './display/camelotKey';
import { MediaTransportControlGroup } from './media';

// Library + Cue Mode concepts. Frames are drawn at production proportions with
// the real shared components (tabs, search, dropdowns, transport, key badge,
// hero button), cropped to a fixed viewport height so they compare fairly.

const FRAME_HEIGHT = 880;
const FRAME_MIN_WIDTH = 1180;

// ── Sample data (from the Cue Points screen) ─────────────────────────────────

const PROFILE = { name: 'DVYDRM', initials: 'DV', usb: 'DVYDRMNG', lastImport: 'Sep 29, 2026', tracks: 45, playlists: 8, bpm: 140, key: '7A', genre: 'Nasty' };

export const TRACKS = [
  { title: 'Disappearance w EVOKE45', artist: 'Artist Not Available', bpm: '150.0', key: '10A', genre: '—', cues: 3, dur: '3:51', seed: 3, cueAt: [0.25, 0.3, 0.36] },
  { title: 'Ring The Alarm (HAHNER Edit)', artist: 'DJ Snake & Malaa x Anxi x Marshmello & SVDDEN DEATH', bpm: '145.0', key: '12A', genre: '—', cues: 0, dur: '2:27', seed: 8, cueAt: [] },
  { title: 'DJ DIESEL & CELO x LIL JON - In The Pit (TALIX …', artist: 'TALIX & VIBE LINK', bpm: '150.0', key: '02A', genre: 'Dubstep', cues: 0, dur: '1:45', seed: 15, cueAt: [] },
  { title: 'WIde Open (MAVIC FLIP) Final', artist: 'DISCO LINES', bpm: '140.0', key: '07A', genre: '—', cues: 4, dur: '2:47', seed: 21, cueAt: [0.12, 0.3, 0.45, 0.6] },
  { title: 'IN THIS FERGALICIOUS (Angel TFC Edit)', artist: 'Artist Not Available', bpm: '130.0', key: '02B', genre: '—', cues: 3, dur: '4:26', seed: 34, cueAt: [0.24, 0.3, 0.38] },
  { title: 'Warfare (HAHNER Edit)', artist: 'DJ Diesel & CELO x YDG x ISOXO', bpm: '150.0', key: '07A', genre: '—', cues: 0, dur: '1:58', seed: 44, cueAt: [] },
  { title: 'Gas Pedal x Honda VIP (RAFAEL Edit) 9A 130', artist: 'Sage The Gemini x 1997', bpm: '130.0', key: '09A', genre: '—', cues: 2, dur: '3:12', seed: 51, cueAt: [0.2, 0.55] },
  { title: 'Fall Before Me', artist: 'Unknown artist', bpm: '130.0', key: '02A', genre: '—', cues: 0, dur: '3:05', seed: 62, cueAt: [] },
];

const CUE_COLORS = ['#1fb6ff', '#2be02b', '#5a22f2', '#ff4d4d'];

// ── Small helpers ────────────────────────────────────────────────────────────

export function makeRand(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0xffffffff; };
}

export function MiniWave({ seed, cueAt, height = 26 }: { seed: number; cueAt: number[]; height?: number }) {
  const bars = useMemo(() => {
    const rand = makeRand(seed);
    return Array.from({ length: 70 }, (_, i) => {
      const base = 0.3 + 0.55 * Math.abs(Math.sin(i / 6 + seed)) * (0.5 + rand() * 0.5);
      return Math.max(0.12, Math.min(1, base));
    });
  }, [seed]);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="relative h-3">
        {cueAt.map((at, i) => (
          <span key={i} className="absolute top-0 -translate-x-1/2" style={{ left: `${at * 100}%` }}>
            <svg viewBox="0 0 8 10" width={6} height={8} style={{ display: 'block' }}><polygon points="0,0 8,0 8,6 4,10 0,6" fill={CUE_COLORS[i % CUE_COLORS.length]} /></svg>
          </span>
        ))}
      </div>
      <svg viewBox="0 0 70 20" preserveAspectRatio="none" width="100%" height={height}>
        {bars.map((b, i) => <rect key={i} x={i + 0.15} y={10 - b * 10} width={0.7} height={b * 20} fill="#5aa7cf" />)}
      </svg>
    </div>
  );
}

export function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <div
        className="relative flex overflow-hidden rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-background)]"
        style={{ height: FRAME_HEIGHT, minWidth: FRAME_MIN_WIDTH }}
      >
        {children}
      </div>
    </div>
  );
}

export interface NavItem { label: string; icon: typeof Music }
const NAV_SIX: NavItem[] = [
  { label: 'Library', icon: Music }, { label: 'Review', icon: Growth }, { label: 'Audition', icon: Headphones },
  { label: 'Discover', icon: Radio }, { label: 'Search', icon: Search }, { label: 'Flip Lab', icon: Shuffle },
];
const NAV_SEVEN: NavItem[] = [{ label: 'Overview', icon: Dashboard }, ...NAV_SIX];
export const NAV_TODAY: NavItem[] = [
  { label: 'Library', icon: Music }, { label: 'Review', icon: Growth }, { label: 'Cue Points', icon: Idea },
  { label: 'Audition', icon: Headphones }, { label: 'Discover', icon: Radio }, { label: 'Search', icon: Search }, { label: 'Flip Lab', icon: Shuffle },
];

export function Rail({ items, active }: { items: NavItem[]; active: string }) {
  return (
    <div className="flex w-[72px] shrink-0 flex-col items-center gap-1.5 border-r border-[var(--color-border-faint)] bg-[var(--color-card)] py-3">
      <div className="mb-2 h-7 w-7 rounded-md bg-primary/80" />
      {items.map(({ label, icon: Icon }) => (
        <div
          key={label}
          className={cn('flex w-[58px] flex-col items-center gap-1 rounded-xl border py-2', label === active ? 'border-primary/20 bg-primary/10 text-primary' : 'border-transparent text-muted-foreground')}
        >
          <Icon size={18} />
          <span className="text-[9px] font-semibold">{label}</span>
        </div>
      ))}
    </div>
  );
}

export function Main({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex min-w-0 flex-1 flex-col overflow-hidden px-6 pt-6', className)}>{children}</div>;
}

// ── Cue mode switch (the new control) ────────────────────────────────────────

function CueModeSwitch({ on, unsaved = 0 }: { on: boolean; unsaved?: number }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={cn(
        'group flex h-[34px] items-center gap-2.5 rounded-[8px] border pl-2.5 pr-3 text-[11px] font-semibold transition-colors',
        on ? 'border-primary/40 bg-primary/12 text-foreground' : 'border-[var(--color-border-subtle)] bg-[var(--color-panel)] text-muted-foreground',
      )}
    >
      <Idea size={15} className={on ? 'text-primary' : undefined} />
      <span className="whitespace-nowrap">Cue mode</span>
      <span className={cn('relative h-[16px] w-[28px] rounded-full transition-colors', on ? 'bg-primary' : 'bg-white/15')}>
        <span className={cn('absolute top-[2px] h-[12px] w-[12px] rounded-full bg-white transition-all', on ? 'left-[14px]' : 'left-[2px]')} />
      </span>
      {unsaved > 0 && (
        <span className="flex items-center gap-1 rounded-full bg-amber-400/15 px-1.5 py-[1px] text-[9px] font-bold text-amber-300">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> {unsaved} unsaved
        </span>
      )}
    </button>
  );
}

// ── Audio dock (production layout) ───────────────────────────────────────────

function Dock({ tabs, tab, cueMode, unsaved }: { tabs: string[]; tab: string; cueMode: boolean; unsaved?: number }) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-y border-[var(--color-border-faint)] bg-[color-mix(in_srgb,var(--color-background)_92%,var(--color-card))] px-2.5 py-2">
      <div className="w-[240px] shrink-0 self-stretch">
        <TabNavigation
          ariaLabel="Library browser source"
          variant="primary"
          className="dd-tab-nav--compact"
          value={tab}
          onChange={() => undefined}
          options={tabs.map((t) => ({ id: t.toLowerCase(), label: t }))}
        />
      </div>
      <MediaTransportControlGroup compact ariaLabel="Transport" playing={false} onTogglePlay={() => undefined} previousDisabled rewindDisabled forwardDisabled nextDisabled />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="w-9 shrink-0 text-right font-mono text-[10px] text-muted-foreground">0:00</span>
        <input type="range" disabled className="h-1.5 min-w-[120px] flex-1 accent-primary opacity-40" aria-label="Playback position" />
        <span className="w-9 shrink-0 font-mono text-[10px] text-muted-foreground">—</span>
      </div>
      {cueMode && (
        <div className="flex shrink-0 items-center gap-3 border-l border-white/10 pl-4">
          <FilterDropdown label="Snap" value="1-beat" onChange={() => undefined} className="min-w-[80px]" options={[{ value: '1-beat', label: '1 Beat' }]} />
          <FilterDropdown label="Beat Count" value="beats" onChange={() => undefined} className="min-w-[80px]" options={[{ value: 'beats', label: 'Beats' }]} />
        </div>
      )}
      <div className="flex shrink-0 items-center gap-2 border-l border-white/10 pl-4">
        <VolumeUp size={16} className="text-muted-foreground" />
        <input type="range" defaultValue={85} className="w-[84px] accent-primary" aria-label="Volume" />
      </div>
      <div className="shrink-0 border-l border-white/10 pl-4">
        <CueModeSwitch on={cueMode} unsaved={unsaved} />
      </div>
    </div>
  );
}

// ── Filters + table ──────────────────────────────────────────────────────────

export function Filters({ showExport = true }: { showExport?: boolean }) {
  const dd = (label: string) => <FilterDropdown key={label} label={label} value="all" onChange={() => undefined} className="min-w-[96px]" options={[{ value: 'all', label: 'All' }]} />;
  return (
    <div className="flex shrink-0 items-end gap-x-5 border-b border-[var(--color-border-faint)] px-4 py-2.5">
      <div className="min-w-[200px] max-w-[300px] flex-1">
        <SearchControl underline placeholder="Search title, artist, or genre…" aria-label="Search tracks" />
      </div>
      {['Status', 'Genre', 'Key', 'Cue States', 'Analysis'].map(dd)}
      <div className="min-w-[150px]">
        <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">BPM</div>
        <div className="relative mt-3 h-[2px] bg-primary/60">
          <span className="absolute -left-1 -top-[11px] flex h-6 w-6 items-center justify-center rounded-full border border-primary bg-[var(--color-card)] text-[8px] font-bold">75</span>
          <span className="absolute -right-1 -top-[11px] flex h-6 w-6 items-center justify-center rounded-full border border-primary bg-[var(--color-card)] text-[8px] font-bold">150</span>
        </div>
      </div>
      {showExport && (
        <div className="ml-auto pb-[3px]">
          <ControlButton variant="surface" className="h-[34px] min-h-0 px-3 text-[11px]"><Export size={14} /> Export 45</ControlButton>
        </div>
      )}
    </div>
  );
}

const ROW_COLS = 'minmax(0,1.5fr) minmax(0,1fr) 70px 80px 100px 70px 70px';

export function TrackTable({ selected = 0 }: { selected?: number | null }) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <div className="grid items-center border-b border-[var(--color-border-faint)] px-5 py-2 text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground" style={{ gridTemplateColumns: ROW_COLS }}>
        <span>Track</span><span /><span>BPM</span><span>Key</span><span>Genre</span><span className="text-center">Cues</span><span className="text-right">Duration</span>
      </div>
      {TRACKS.map((t, i) => (
        <div
          key={t.title}
          className={cn('relative grid items-center border-b border-[var(--color-border-faint)] px-5', i === selected && 'bg-primary/[0.07]')}
          style={{ gridTemplateColumns: ROW_COLS, height: 58 }}
        >
          {i === selected && <span className="absolute inset-y-0 left-0 w-[3px] bg-primary" />}
          <div className="flex min-w-0 items-center gap-3">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
            <Artwork src={null} alt="" fallbackTitle="No artwork" className="h-10 w-10 shrink-0 rounded-md" />
            <div className="min-w-0">
              <div className={cn('truncate text-[13px] font-bold', i === selected && 'text-primary')}>{t.title}</div>
              <div className="truncate text-[11px] text-muted-foreground">{t.artist}</div>
            </div>
          </div>
          <div className="px-3"><MiniWave seed={t.seed} cueAt={t.cueAt} /></div>
          <span className="font-mono text-[13px] font-bold tabular-nums">{t.bpm}</span>
          <KeyBadge camelotKey={t.key} />
          <span className="text-[12px] text-muted-foreground">{t.genre}</span>
          <span className="flex justify-center"><span className={cn('flex h-7 w-9 items-center justify-center rounded-md border font-mono text-[12px] font-bold', t.cues > 0 ? 'border-primary/30 bg-primary/10 text-primary' : 'border-white/10 bg-white/[0.04] text-muted-foreground')}>{t.cues}</span></span>
          <span className="text-right font-mono text-[12px] tabular-nums text-muted-foreground">{t.dur}</span>
        </div>
      ))}
    </div>
  );
}

// ── Workstation (cue mode on): header + timeline, as in production ───────────

function Workstation() {
  return (
    <div className="shrink-0">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border-faint)] px-4 py-2 lg:px-5">
        <div className="flex min-w-0 items-center gap-3.5">
          <Artwork src={null} alt="" fallbackTitle="No artwork" className="h-14 w-14 shrink-0 rounded-[7px]" />
          <div className="min-w-0">
            <div className="truncate text-[21px] font-bold leading-tight tracking-[-0.02em]">{TRACKS[0].title}</div>
            <div className="text-xs font-medium leading-tight text-muted-foreground">{TRACKS[0].artist}</div>
            <div className="mt-0.5 flex items-center gap-x-4 text-[10px] font-semibold text-muted-foreground">
              <span><span className="uppercase tracking-[0.08em] text-foreground/45">BPM</span> <strong className="ml-1 text-foreground/90">150.00</strong></span>
              <span><span className="uppercase tracking-[0.08em] text-foreground/45">Key</span> <strong className="ml-1" style={{ color: camelotKeyColor('10A') }}>10A</strong></span>
              <span><span className="uppercase tracking-[0.08em] text-foreground/45">Duration</span> <strong className="ml-1 text-foreground/90">3:51</strong></span>
              <span className="flex items-center gap-1.5">
                <span className="uppercase tracking-[0.08em] text-foreground/45">Cues</span><strong className="text-foreground/90">3</strong>
                <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-primary/75">Editing</span>
                <span className="rounded-[4px] border border-[var(--color-border-faint)] bg-white/[0.015] px-1.5 py-0.5 text-[9px] font-semibold">Original</span>
              </span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <ControlButton variant="surface" className="min-h-[34px] px-2.5 text-[11px]">Pending 0</ControlButton>
          <ControlButton variant="surface" className="min-h-[34px] px-2.5 text-[11px]"><Idea size={16} /> Auto Cue</ControlButton>
          <div className="flex">
            <ControlButton variant="primary" disabled className="min-h-[34px] rounded-r-none px-3 text-[11px]"><Export size={16} /> Apply All (0)</ControlButton>
            <ControlButton variant="primary" className="min-h-[34px] w-[32px] rounded-l-none border-l border-white/10 px-0">▾</ControlButton>
          </div>
        </div>
      </div>
      <div className="px-4 pb-3 pt-3 lg:px-5"><Timeline /></div>
    </div>
  );
}

type Kind = 'intro' | 'build' | 'verse' | 'bridge';
const KIND: Record<Kind, { label: string; color: string }> = {
  intro: { label: 'INTRO', color: '#2f9bff' }, build: { label: 'BUILD', color: '#ff8a1f' },
  verse: { label: 'VERSE', color: '#b266ff' }, bridge: { label: 'BRIDGE', color: '#2dd4bf' },
};
const EDGES: Array<[Kind, number, number]> = [
  ['intro', 70, 223], ['build', 223, 327], ['verse', 327, 431], ['verse', 431, 531], ['build', 531, 635], ['verse', 635, 737],
  ['verse', 737, 943], ['build', 943, 1045], ['verse', 1045, 1149], ['verse', 1149, 1355], ['build', 1355, 1457],
  ['verse', 1457, 1535], ['verse', 1535, 1637], ['verse', 1637, 1767], ['verse', 1767, 1870], ['bridge', 1870, 1925],
];
const SECS = EDGES.map(([kind, a, b]) => ({ kind, from: (a - 70) / 1855, to: (b - 70) / 1855 }));
const CUES = [{ l: 'B', at: (532 - 70) / 1855, c: '#1fb6ff' }, { l: 'C', at: (636 - 70) / 1855, c: '#2be02b' }, { l: 'D', at: (739 - 70) / 1855, c: '#5a22f2' }];
const BARS = 144.2;

function Timeline() {
  const waves = useMemo(() => {
    const rand = makeRand(7);
    let spike = 0;
    const out = new Map<string, string>();
    for (let i = 0; i < 900; i++) {
      const f = i / 900;
      const s = SECS.find((x) => f >= x.from && f < x.to) ?? SECS[SECS.length - 1];
      let a: number;
      if (s.kind === 'intro') a = 0.2 + rand() * 0.05;
      else if (s.kind === 'build') a = 0.3 + ((f - s.from) / (s.to - s.from)) * 0.1 + rand() * 0.08;
      else if (s.kind === 'bridge') a = 0.28 + rand() * 0.08;
      else { if (i % 22 === 0 && rand() > 0.35) spike = 0.5 + rand() * 0.45; spike *= 0.82; a = 0.36 + rand() * 0.14 + spike; }
      const h = Math.min(0.98, a) * 48;
      const color = KIND[s.kind].color;
      out.set(color, (out.get(color) ?? '') + `M${i + 0.5} ${50 - h}V${50 + h}`);
    }
    return [...out.entries()];
  }, []);
  const grid = useMemo(() => {
    let g = ''; let r = '';
    for (let i = 0; i <= Math.floor(BARS * 4); i++) { g += `M${i} 0V62`; if (i % 4 === 0) r += `M${i} 35V100`; }
    return { g, r };
  }, []);
  const lane = (h: number, children: ReactNode, style?: CSSProperties) => (
    <div className="relative" style={{ height: h, paddingInline: 24, ...style }}><div className="relative h-full w-full">{children}</div></div>
  );
  return (
    <div className="overflow-hidden border-y border-[var(--color-border-faint)] bg-[var(--color-background)]">
      {lane(34, CUES.map((c) => (
        <div key={c.l} className="absolute -translate-x-1/2" style={{ left: `${c.at * 100}%`, top: 6 }}>
          <svg width={24} height={27} viewBox="0 0 28 32"><path d="M3 2h22a1 1 0 0 1 1 1v17.5a2 2 0 0 1-.9 1.7L14 30 2.9 22.2A2 2 0 0 1 2 20.5V3a1 1 0 0 1 1-1z" fill={`${c.c}22`} stroke={c.c} strokeWidth="2" /><text x="14" y="17" textAnchor="middle" fontSize="13" fontWeight="800" fontFamily="ui-monospace, monospace" fill={c.c}>{c.l}</text></svg>
        </div>
      )))}
      {lane(28, SECS.map((s, i) => (
        <div key={i} className="absolute top-0" style={{ left: `${s.from * 100}%`, width: `${(s.to - s.from) * 100}%`, height: 22, borderBottom: `2px solid ${KIND[s.kind].color}` }}>
          <div className="flex h-full items-center justify-center font-mono text-[9px] font-bold tracking-wide" style={{ color: KIND[s.kind].color }}>{KIND[s.kind].label}</div>
        </div>
      )))}
      {lane(88, (
        <>
          <svg viewBox="0 0 900 100" preserveAspectRatio="none" width="100%" height={88} style={{ display: 'block' }}>
            {waves.map(([c, d]) => <path key={c} d={d} stroke={c} strokeWidth="1.2" fill="none" />)}
          </svg>
          {CUES.map((c) => <div key={c.l} className="absolute inset-y-0 w-[2px] -translate-x-1/2" style={{ left: `${c.at * 100}%`, background: c.c }} />)}
        </>
      ))}
      {lane(22, (
        <svg viewBox={`0 0 ${Math.floor(BARS * 4)} 100`} preserveAspectRatio="none" width="100%" height={22} style={{ display: 'block' }}>
          <path d={grid.g} stroke="#3ddc84" strokeWidth="0.55" fill="none" vectorEffect="non-scaling-stroke" strokeOpacity="0.85" />
          <path d={grid.r} stroke="#ff6b6b" strokeWidth="1" fill="none" vectorEffect="non-scaling-stroke" />
        </svg>
      ))}
      {lane(22, Array.from({ length: 21 }, (_, i) => 1 + i * 7).map((n) => (
        <span key={n} className="absolute font-mono text-[11px] leading-[22px] text-muted-foreground tabular-nums" style={{ left: `${((n - 1) / BARS) * 100}%` }}>{n}</span>
      )))}
    </div>
  );
}

// ── Hero pieces ──────────────────────────────────────────────────────────────

function Socials() {
  return (
    <div className="flex items-center gap-2.5 text-muted-foreground">
      <LogoInstagram size={14} /><LogoYoutube size={14} /><Globe size={14} />
    </div>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-400">
      <CheckmarkFilled size={12} /> {children}
    </span>
  );
}

/** Option A: the hero as one slim strip above the browser. */
function HeroStrip() {
  return (
    <div className="mb-4 flex shrink-0 items-center gap-5 rounded-2xl border border-[var(--color-border-subtle)] bg-[linear-gradient(105deg,rgba(2,12,25,0.98)_0%,rgba(3,25,52,0.95)_50%,rgba(2,11,24,0.98)_100%)] px-5 py-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-primary/15 text-sm font-black text-primary">{PROFILE.initials}</div>
      <div>
        <div className="text-lg font-black uppercase leading-none tracking-tight">{PROFILE.name}</div>
        <div className="mt-1.5"><Socials /></div>
      </div>
      <span className="h-9 w-px bg-white/10" />
      <div className="flex items-center gap-2">
        <Pill>Imported · {PROFILE.usb}</Pill>
        <Pill>Analyzed {PROFILE.tracks}/{PROFILE.tracks}</Pill>
        <span className="font-mono text-[10px] text-muted-foreground">Last import {PROFILE.lastImport}</span>
      </div>
      <div className="ml-auto flex items-center gap-6">
        {[['Tracks', String(PROFILE.tracks)], ['BPM', String(PROFILE.bpm)], ['Key', PROFILE.key], ['Genre', PROFILE.genre]].map(([l, v]) => (
          <div key={l} className="text-center">
            <div className="text-lg font-black leading-none tabular-nums" style={l === 'Key' ? { color: camelotKeyColor(PROFILE.key) } : undefined}>{v}</div>
            <div className="mt-1 text-[8px] font-bold uppercase tracking-widest text-muted-foreground">{l}</div>
          </div>
        ))}
      </div>
      <div className="w-[140px] shrink-0"><HeroActionButton variant="import" onClick={() => undefined}><Upload size={11} /> Import</HeroActionButton></div>
    </div>
  );
}

/** Full hero + insights, used by the Overview tab (B) and the Overview page (C). */
function OverviewBody() {
  const bpm = [1, 0, 2, 1, 3, 2, 6, 14, 9, 4, 2, 1];
  const genres: Array<[string, number]> = [['Nasty', 18], ['Dubstep', 11], ['Riddim', 9], ['Trap', 7]];
  const keys: Array<[string, number]> = [['7A', 12], ['8A', 9], ['6A', 7], ['4A', 5], ['5A', 4], ['10A', 3]];
  const stat = (label: string, value: string, color?: string) => (
    <div key={label} className="flex flex-1 flex-col items-center justify-center self-stretch border-l border-white/[0.07] px-4 text-center">
      <p className="truncate text-3xl font-black leading-none tracking-tight tabular-nums" style={color ? { color } : undefined}>{value}</p>
      <p className="mt-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
    </div>
  );
  const card = (title: string, body: ReactNode) => (
    <div className="glass rounded-2xl border border-[var(--color-border-subtle)] p-4">
      <p className="mb-3 text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{title}</p>
      {body}
    </div>
  );
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-hidden px-4 pt-5">
      <section className="relative flex min-h-[218px] items-center gap-6 overflow-hidden rounded-2xl border border-[var(--color-border-subtle)] bg-[linear-gradient(105deg,rgba(2,12,25,0.98)_0%,rgba(3,25,52,0.95)_50%,rgba(2,11,24,0.98)_100%)] px-8 py-7">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_58%_20%,rgba(16,103,220,0.42),transparent_34%)]" />
        <div className="relative flex w-[170px] shrink-0 flex-col items-center text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-primary bg-primary/15 text-2xl font-black text-primary shadow-[0_0_24px_rgba(10,145,255,0.34)]">{PROFILE.initials}</div>
          <div className="mt-3 text-xl font-black uppercase tracking-tight">{PROFILE.name}</div>
          <div className="mt-2"><Socials /></div>
        </div>
        <div className="relative w-[264px] shrink-0 rounded-xl border border-[var(--color-border-subtle)] bg-white/[0.04] px-4 py-3">
          <p className="mb-2 text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">USB Import</p>
          <div className="flex items-center gap-2"><CheckmarkFilled size={14} className="text-emerald-500" /><span className="text-sm font-black text-emerald-500">Import Complete</span></div>
          <HeroActionButton variant="import" onClick={() => undefined} className="mt-3"><Upload size={11} /> Import Library</HeroActionButton>
          <div className="mt-3 space-y-2 text-[10px]">
            <div className="flex items-center gap-1.5"><Usb size={11} className="text-muted-foreground" /><span className="text-muted-foreground">USB</span><span className="ml-auto font-mono font-bold">{PROFILE.usb}</span></div>
            <div className="flex items-center gap-1.5"><Calendar size={11} className="text-muted-foreground" /><span className="text-muted-foreground">Last Import</span><span className="ml-auto font-mono font-bold">{PROFILE.lastImport}</span></div>
          </div>
        </div>
        <div className="relative w-[264px] shrink-0 rounded-xl border border-[var(--color-border-subtle)] bg-white/[0.04] px-4 py-3">
          <p className="mb-2 text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Track Analysis</p>
          <div className="flex items-center gap-2"><CheckmarkFilled size={14} className="text-emerald-500" /><span className="text-sm font-black text-emerald-500">Analysis Complete</span></div>
          <div className="mt-3 h-7" />
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[10px]">
            {[[RecordingFilled, 'Status', 'Completed'], [Waveform, 'Analyzed', '45'], [Music, 'Tracks', '45'], [ChartBar, 'Progress', '100%']].map(([I, l, v]) => {
              const Icon = I as typeof Music;
              return <div key={l as string} className="flex items-center gap-1.5"><Icon size={11} className="text-muted-foreground" /><span className="text-muted-foreground">{l as string}</span><span className="ml-auto font-mono font-bold">{v as string}</span></div>;
            })}
          </div>
        </div>
        <div className="relative flex flex-1 self-stretch">
          {stat('Main BPM', String(PROFILE.bpm))}{stat('Main Key', PROFILE.key, camelotKeyColor(PROFILE.key))}{stat('Main Genre', PROFILE.genre)}
        </div>
      </section>
      <div className="grid grid-cols-3 gap-4">
        {card('Top genres', (
          <div className="space-y-2">{genres.map(([g, n]) => (
            <div key={g} className="flex items-center gap-2 text-[11px]"><span className="w-16 text-muted-foreground">{g}</span><div className="h-1.5 flex-1 rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-primary" style={{ width: `${(n / 18) * 100}%` }} /></div><span className="w-5 text-right font-mono text-muted-foreground">{n}</span></div>
          ))}</div>
        ))}
        {card('BPM distribution', (
          <div className="flex h-[74px] items-end gap-1">{bpm.map((n, i) => <div key={i} className="flex-1 rounded-sm" style={{ height: `${Math.max(6, (n / 14) * 100)}%`, background: n === 14 ? 'var(--color-primary)' : 'rgba(255,255,255,0.16)' }} />)}</div>
        ))}
        {card('Key profile', (
          <div className="flex flex-wrap gap-2">{keys.map(([k, n]) => <span key={k} className="flex items-center gap-1.5 rounded-md bg-white/[0.05] px-2 py-1 font-mono text-[12px] font-bold" style={{ color: camelotKeyColor(k) }}><span className="h-3 w-[3px] rounded-full" style={{ background: camelotKeyColor(k) }} />{k}<span className="text-[10px] text-muted-foreground">{n}</span></span>)}</div>
        ))}
      </div>
    </div>
  );
}

// ── Screens ──────────────────────────────────────────────────────────────────

function BrowserBody({ tab }: { tab: string }) {
  if (tab === 'overview') return <OverviewBody />;
  return <><Filters /><TrackTable selected={0} /></>;
}

function LibraryScreen({
  nav, active, tabs, tab, cueMode, strip, unsaved,
}: { nav: NavItem[]; active: string; tabs: string[]; tab: string; cueMode: boolean; strip: boolean; unsaved?: number }) {
  return (
    <Frame>
      <Rail items={nav} active={active} />
      <Main>
        {strip && !cueMode && <HeroStrip />}
        {cueMode && <Workstation />}
        <Dock tabs={tabs} tab={tab} cueMode={cueMode} unsaved={unsaved} />
        <BrowserBody tab={tab} />
      </Main>
    </Frame>
  );
}

function OverviewPageScreen() {
  return (
    <Frame>
      <Rail items={NAV_SEVEN} active="Overview" />
      <Main><OverviewBody /></Main>
    </Frame>
  );
}

function CurrentCuePointsScreen() {
  return (
    <Frame>
      <Rail items={NAV_TODAY} active="Cue Points" />
      <Main>
        <Workstation />
        <Dock tabs={['Library', 'Playlists']} tab="library" cueMode />
        <BrowserBody tab="library" />
      </Main>
    </Frame>
  );
}

// ── Toggle close-ups ─────────────────────────────────────────────────────────

function ToggleStates() {
  const cell = (label: string, node: ReactNode, note: string) => (
    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-card)] p-4">
      <div className="mb-3 flex items-center gap-2"><span className="text-[11px] font-bold">{label}</span></div>
      <div className="rounded-lg border border-[var(--color-border-faint)] bg-[var(--color-background)] p-3">{node}</div>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{note}</p>
    </div>
  );
  return (
    <div className="grid grid-cols-3 gap-4">
      {cell('Off', <CueModeSwitch on={false} />, 'Library is a plain browser. The workstation is hidden, so the table gets the full height.')}
      {cell('On', <CueModeSwitch on />, 'The track header and timeline slide open above the browser. Snap and Beat Count appear in the dock.')}
      {cell('On, with unsaved edits', <CueModeSwitch on unsaved={2} />, 'Turning it off keeps the edits as a draft and shows this marker, so nothing is lost or blocked.')}
    </div>
  );
}

// ── Tab content ──────────────────────────────────────────────────────────────

function Section({ n, title, note, changes, children }: { n: number; title: string; note: string; changes: string[]; children: ReactNode }) {
  return (
    <section className="mb-12">
      <div className="mb-2 flex items-center gap-2.5">
        <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/15 text-[11px] font-extrabold text-primary">{n}</div>
        <span className="text-[13px] font-bold text-foreground">{title}</span>
        <span className="text-[11px] text-muted-foreground">{note}</span>
      </div>
      <ul className="mb-3 ml-9 list-disc space-y-0.5 text-[11px] text-muted-foreground">
        {changes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      {children}
    </section>
  );
}

export function LibraryCueModeMockupsContent() {
  return (
    <div className="h-full overflow-y-auto bg-[var(--color-background)] px-8 pb-16 pt-7">
      <div className="mb-8">
        <div className="mb-1 text-sm font-extrabold text-foreground">Library + Cue Mode</div>
        <div className="max-w-[920px] text-[11px] leading-relaxed text-muted-foreground">
          Every frame is a full screen at production proportions, cropped to the same {FRAME_HEIGHT}px viewport so they compare fairly. They use the real shared components (tabs, search, dropdowns, transport, key badge, hero button). Frame 1 is today's Cue Points screen as the baseline; the rest are the proposed Library with a Cue mode switch in the audio dock. Track data is sample data.
        </div>
      </div>

      <Section n={1} title="Today: Cue Points" note="Baseline for comparison" changes={['Separate nav item, workstation always open, no hero or insights on this screen.']}>
        <CurrentCuePointsScreen />
      </Section>

      <Section n={2} title="The Cue mode switch" note="Three states" changes={['Lives at the right end of the audio dock, so it is reachable from every tab (Library, Playlists and Overview).', 'Unsaved edits are kept as a draft and flagged on the switch rather than blocking you.']}>
        <ToggleStates />
      </Section>

      <Section n={3} title="Option A: slim hero strip · cue mode off" note="Hero stays on top as one row" changes={['Left nav drops Cue Points (6 items).', 'Hero is one row above the browser; Snap / Beat Count appear only in cue mode.', 'New Export button sits at the right end of the filter row.']}>
        <LibraryScreen nav={NAV_SIX} active="Library" tabs={['Library', 'Playlists']} tab="library" cueMode={false} strip />
      </Section>
      <Section n={4} title="Option A: cue mode on" note="Workstation replaces the strip" changes={['The hero strip hides while editing so the timeline gets the space.', 'Same workstation as today: track header, Pending, Auto Cue, Apply All, timeline.', 'The table shrinks to the rows that fit below, as on today\'s screen.']}>
        <LibraryScreen nav={NAV_SIX} active="Library" tabs={['Library', 'Playlists']} tab="library" cueMode strip />
      </Section>
      <Section n={5} title="Option A: cue mode on, with unsaved edits" note="Marker on the switch" changes={['Same as 4, with the unsaved marker showing in the dock.']}>
        <LibraryScreen nav={NAV_SIX} active="Library" tabs={['Library', 'Playlists']} tab="library" cueMode strip unsaved={2} />
      </Section>

      <Section n={6} title="Option B: Overview tab · Overview selected" note="Hero and insights become a third tab" changes={['No hero above the browser; the dock gets an Overview tab beside Library and Playlists.', 'The Overview tab holds the full hero and the three insight cards.']}>
        <LibraryScreen nav={NAV_SIX} active="Library" tabs={['Overview', 'Library', 'Playlists']} tab="overview" cueMode={false} strip={false} />
      </Section>
      <Section n={7} title="Option B: Library tab · cue mode off" note="Browser gets the whole page" changes={['The table gets the most vertical room of any option.']}>
        <LibraryScreen nav={NAV_SIX} active="Library" tabs={['Overview', 'Library', 'Playlists']} tab="library" cueMode={false} strip={false} />
      </Section>
      <Section n={8} title="Option B: Library tab · cue mode on" note="Workstation above the browser" changes={['Identical to Option A with cue mode on, plus the Overview tab.']}>
        <LibraryScreen nav={NAV_SIX} active="Library" tabs={['Overview', 'Library', 'Playlists']} tab="library" cueMode strip={false} />
      </Section>

      <Section n={9} title="Option C: Overview as its own page" note="Hero and insights leave Library entirely" changes={['Left nav gets an Overview item (7 items), so Library is only the browser.']}>
        <OverviewPageScreen />
      </Section>
      <Section n={10} title="Option C: Library · cue mode off" note="Browser only" changes={['Looks like Option B\'s Library tab, but with no Overview tab.']}>
        <LibraryScreen nav={NAV_SEVEN} active="Library" tabs={['Library', 'Playlists']} tab="library" cueMode={false} strip={false} />
      </Section>
    </div>
  );
}
