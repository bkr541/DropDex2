import { useMemo, type ReactNode } from 'react';
import { Growth, Headphones, Idea, Music, Radio, Search, Shuffle } from '@carbon/icons-react';
import { cn } from '../../lib/utils';
import { FilterDropdown, SearchControl } from './controls';
import { Artwork, KeyBadge } from './display';

const FRAME_HEIGHT = 880;
const FRAME_MIN_WIDTH = 1180;

// ── Sample data (from the Cue Points screen) ─────────────────────────────────

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

// ── Filters + table ──────────────────────────────────────────────────────────

export function Filters() {
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
