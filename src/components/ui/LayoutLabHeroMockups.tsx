import type { ReactNode } from 'react';
import {
  Calendar, CheckmarkFilled, LogoInstagram, Upload, Usb, Waveform,
} from '@carbon/icons-react';
import { cn } from '../../lib/utils';
import { camelotKeyColor } from './display/camelotKey';
import { CamelotWheel, InsightBpmDistribution, InsightKeyProfile, InsightTopGenres } from '../library/InsightCharts';
import { GENRE_OTHER_COLOR, GENRE_RANK_COLORS, camelotColor } from '../library/libraryInsights';

// Sample data mirroring the artist library hero (profile card + DesktopLibraryHero).
const HERO = {
  name: 'DVYDRM',
  initials: 'DV',
  usb: 'DVYDRMNG',
  lastImport: 'Sep 29, 2026',
  tracks: 45,
  playlists: 8,
  largestPlaylist: 'Peak Time',
  analyzed: 45,
  progress: 100,
  status: 'Completed',
  bpm: 140,
  key: '7A',
  genre: 'Nasty',
};

const KEY_COLOR = camelotKeyColor(HERO.key);

// Sample insight data in the same shape the production hero receives.
const SAMPLE_GENRES: readonly (readonly [string, number])[] = [['Nasty', 18], ['Dubstep', 11], ['Riddim', 9], ['Trap', 7], ['Bass House', 4], ['Other', 6]];
const SAMPLE_BPM: readonly (readonly [string, number])[] = [['100–119', 3], ['120–139', 9], ['140–159', 22], ['160–179', 8], ['180–199', 3]];
const SAMPLE_KEYS: readonly (readonly [string, number])[] = [['7A', 12], ['8A', 9], ['6A', 7], ['4A', 5], ['5A', 4]];

const GENRE_TOTAL = SAMPLE_GENRES.reduce((sum, [, n]) => sum + n, 0);
const BPM_TOTAL = SAMPLE_BPM.reduce((sum, [, n]) => sum + n, 0);
const BPM_MAX = Math.max(...SAMPLE_BPM.map(([, n]) => n));
const BPM_PEAK = SAMPLE_BPM.find(([, n]) => n === BPM_MAX)!;
const BPM_PEAK_PCT = Math.round((BPM_PEAK[1] / BPM_TOTAL) * 100);

/** Heading + one of the production insight charts, for the mockups that have room for the full charts. */
function InsightPanel({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-h-0 min-w-0 flex-col', className)}>
      <p className="mb-1.5 shrink-0 truncate text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

/** The three full insight charts side by side: top genres, BPM distribution, Camelot wheel. */
function InsightTrio({ className, bordered = true, wide = true }: { className?: string; bordered?: boolean; wide?: boolean }) {
  const divider = bordered ? 'border-l border-white/[0.07] pl-4' : '';
  return (
    <div className={cn('grid min-w-0 grid-cols-3 gap-4', className)}>
      <InsightPanel title="Top Genres"><InsightTopGenres genres={SAMPLE_GENRES} compact /></InsightPanel>
      <InsightPanel title="BPM Distribution" className={divider}><InsightBpmDistribution bpmRangeStats={SAMPLE_BPM} compact /></InsightPanel>
      <InsightPanel title="Camelot Wheel" className={divider}>{wide ? <WheelWithKeys /> : <InsightKeyProfile keyStats={SAMPLE_KEYS} compact />}</InsightPanel>
    </div>
  );
}

// Slim versions for the quiet, typographic concepts: same data, drawn as small as a stat.

function MiniGenres({ rows = 3, className }: { rows?: number; className?: string }) {
  const shown = SAMPLE_GENRES.filter(([name]) => name !== 'Other').slice(0, rows);
  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        {SAMPLE_GENRES.map(([name, n], i) => (
          <div key={name} style={{ width: `${(n / GENRE_TOTAL) * 100}%`, background: name === 'Other' ? GENRE_OTHER_COLOR : GENRE_RANK_COLORS[i] }} />
        ))}
      </div>
      {shown.map(([name, n], i) => (
        <div key={name} className="flex items-center gap-1.5 text-[10px]">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: GENRE_RANK_COLORS[i] }} />
          <span className="truncate text-muted-foreground">{name}</span>
          <span className="ml-auto tabular-nums">{Math.round((n / GENRE_TOTAL) * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

function MiniBpm({ height = 40, className }: { height?: number; className?: string }) {
  return (
    <div className={className}>
      <p className="text-[11px] font-semibold tabular-nums" style={{ color: '#f43f5e' }}>{BPM_PEAK[0]} BPM · {BPM_PEAK_PCT}%</p>
      <div className="mt-1.5 flex items-end gap-[3px]" style={{ height }}>
        {SAMPLE_BPM.map(([range, n]) => (
          <div key={range} className="flex-1 rounded-[2px]" style={{ height: `${Math.max(6, (n / BPM_MAX) * 100)}%`, background: n === BPM_MAX ? '#f43f5e' : '#1f2d3d' }} />
        ))}
      </div>
      <div className="mt-1 flex gap-[3px] text-[8px] text-muted-foreground">
        {SAMPLE_BPM.map(([range]) => <span key={range} className="flex-1 text-center">{range.split('–')[0]}</span>)}
      </div>
    </div>
  );
}

function MiniWheel({ size = 72, withKeys = true, className }: { size?: number; withKeys?: boolean; className?: string }) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="shrink-0" style={{ width: size }}><CamelotWheel keyStats={SAMPLE_KEYS} /></div>
      {withKeys && (
        <div className="space-y-0.5">
          {SAMPLE_KEYS.slice(0, 3).map(([k, n]) => (
            <div key={k} className="flex items-center gap-2 text-[11px] tabular-nums">
              <span className="w-7 font-black" style={{ color: camelotColor(k) }}>{k}</span>
              <span className="font-bold">{n}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The Camelot wheel beside its five most common keys, for the mockups with a wide enough panel. */
function WheelWithKeys({ size = 112 }: { size?: number }) {
  const total = SAMPLE_KEYS.reduce((sum, [, n]) => sum + n, 0);
  return (
    <div className="flex min-h-0 flex-1 items-center gap-3">
      <div className="shrink-0" style={{ width: size }}><CamelotWheel keyStats={SAMPLE_KEYS} /></div>
      <div className="min-w-0 flex-1 space-y-[5px]">
        {SAMPLE_KEYS.map(([k, n], i) => (
          <div key={k} className="flex items-center gap-1.5">
            <span className="w-3 shrink-0 font-mono text-[9px] text-muted-foreground">{i + 1}</span>
            <span className="w-7 shrink-0 text-[11px] font-black" style={{ color: camelotColor(k) }}>{k}</span>
            <div className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full rounded-full" style={{ width: `${(n / total) * 100}%`, background: camelotColor(k) }} />
            </div>
            <span className="shrink-0 text-[12px] font-black tabular-nums">{n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Three slim insights in a row, each with a small-caps label above. */
function MiniInsights({ className, wheelSize = 72, barHeight = 40 }: { className?: string; wheelSize?: number; barHeight?: number }) {
  return (
    <div className={cn('grid grid-cols-[1fr_1fr_auto] items-start gap-6', className)}>
      <div className="min-w-0"><ProLabel className="mb-1.5 block">Top genres</ProLabel><MiniGenres /></div>
      <div className="min-w-0"><ProLabel className="mb-1.5 block">BPM distribution</ProLabel><MiniBpm height={barHeight} /></div>
      <div><ProLabel className="mb-1.5 block">Camelot wheel</ProLabel><MiniWheel size={wheelSize} /></div>
    </div>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function SpotifyIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.516 17.313a.748.748 0 0 1-1.031.25c-2.822-1.724-6.375-2.114-10.561-1.158a.749.749 0 1 1-.333-1.462c4.579-1.045 8.507-.596 11.675 1.339a.75.75 0 0 1 .25 1.031zm1.472-3.274a.937.937 0 0 1-1.288.308c-3.226-1.983-8.143-2.558-11.963-1.4a.937.937 0 1 1-.544-1.791c4.361-1.323 9.782-.682 13.487 1.596a.937.937 0 0 1 .308 1.287zm.126-3.409c-3.868-2.297-10.249-2.509-13.944-1.388a1.124 1.124 0 1 1-.652-2.15c4.243-1.288 11.298-1.039 15.749 1.607a1.125 1.125 0 0 1-1.153 1.931z" />
    </svg>
  );
}

function SoundCloudIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M7.5 17h-1V9.6c.3-.1.6-.1 1-.1V17zm-2 0h-1v-6.3c.3-.3.6-.5 1-.7v7zm-2 0h-1v-4.6c.3-.4.6-.7 1-.9V17zm-2-.2c-.6-.4-1-1.1-1-1.9s.4-1.5 1-1.9v3.8zM20.5 11c-.3 0-.6 0-.9.1C19.2 8.2 16.8 6 13.9 6c-1.1 0-2.2.3-3.1.9-.2.1-.3.3-.3.5V17h10c1.9 0 3.5-1.6 3.5-3s-1.6-3-3.5-3zM9.5 17h-1V8.7c.3-.2.6-.4 1-.5V17z" />
    </svg>
  );
}

function Socials({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 text-muted-foreground', className)}>
      <span title="Spotify" className="hover:text-foreground transition-colors"><SpotifyIcon size={size} /></span>
      <span title="SoundCloud" className="hover:text-foreground transition-colors"><SoundCloudIcon size={size} /></span>
      <span title="Instagram" className="hover:text-foreground transition-colors"><LogoInstagram size={size} /></span>
    </div>
  );
}

function Avatar({ size = 96, ring = true, online = true }: { size?: number; ring?: boolean; online?: boolean }) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {ring && (
        <div className="absolute inset-[-5px] rounded-full border-2 border-primary shadow-[0_0_24px_rgba(10,145,255,0.34)] pointer-events-none" />
      )}
      <div
        className="w-full h-full rounded-full bg-gradient-to-br from-primary/40 to-primary/5 border border-primary/30 flex items-center justify-center"
        style={{ fontSize: size * 0.28 }}
      >
        <span className="font-black text-primary">{HERO.initials}</span>
      </div>
      {online && (
        <span
          className="absolute rounded-full bg-emerald-500 border-2 border-[var(--color-background)] shadow-[0_0_10px_rgba(16,185,129,0.6)]"
          style={{ width: Math.max(10, size * 0.15), height: Math.max(10, size * 0.15), right: size * 0.02, bottom: size * 0.04 }}
        />
      )}
    </div>
  );
}

function ImportButton({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-blue-500 text-blue-400 bg-transparent',
        'font-bold uppercase tracking-widest transition-all hover:bg-blue-500/10 hover:border-blue-400',
        compact ? 'px-3 py-1.5 text-[9px]' : 'px-3 py-2 text-[10px]',
        className,
      )}
    >
      <Upload size={11} /> Import Library
    </button>
  );
}

function Complete({ label, size = 'sm' }: { label: string; size?: 'xs' | 'sm' | 'md' }) {
  return (
    <div className="flex items-center gap-1.5">
      <CheckmarkFilled size={size === 'md' ? 16 : size === 'sm' ? 14 : 12} className="text-emerald-500 shrink-0" />
      <span className={cn('font-black leading-none text-emerald-500', size === 'md' ? 'text-base' : size === 'sm' ? 'text-sm' : 'text-xs')}>
        {label}
      </span>
    </div>
  );
}

function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-[9px] uppercase tracking-[0.2em] text-muted-foreground font-bold', className)}>{children}</p>;
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Usb; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <Icon size={11} className="text-muted-foreground shrink-0" />
      <span className="text-[10px] text-muted-foreground truncate">{label}</span>
      <span className="text-[10px] font-bold font-mono ml-auto shrink-0">{value}</span>
    </div>
  );
}

function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('h-1.5 w-full rounded-full bg-white/[0.08] overflow-hidden', className)}>
      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${value}%` }} />
    </div>
  );
}

// Every mockup must stay within the Spotlight Banner's height (218px, the production hero's height).
function HeroMockupCard({ n, title, concept, children }: { n: number; title: string; concept: string; children: ReactNode }) {
  return (
    <section className="mb-12">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-[26px] h-[26px] rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center text-primary text-[11px] font-extrabold shrink-0">
          {n}
        </div>
        <span className="text-[13px] font-bold text-foreground">{title}</span>
        <span className="text-[11px] text-muted-foreground">{concept}</span>
      </div>
      {children}
    </section>
  );
}

// ── 1. Spotlight Banner ──────────────────────────────────────────────────────
// One wide gradient banner. Identity on the left, status as two compact chips
// in the middle, big headline stats on the right.

function HeroSpotlight() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[var(--color-border-subtle)] bg-[linear-gradient(105deg,rgba(2,12,25,0.98)_0%,rgba(3,25,52,0.95)_50%,rgba(2,11,24,0.98)_100%)]">
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_18%_30%,rgba(16,103,220,0.38),transparent_36%),radial-gradient(circle_at_80%_60%,rgba(24,94,190,0.18),transparent_30%)]" />
      <div className="relative flex items-center gap-6 px-6 py-5">
        <div className="flex items-center gap-5 shrink-0">
          <Avatar size={72} />
          <div>
            <h2 className="text-2xl font-black uppercase tracking-tight leading-none">{HERO.name}</h2>
            <p className="text-xs font-semibold text-muted-foreground mt-2">{HERO.tracks} tracks across {HERO.playlists} playlists</p>
            <Socials className="mt-3" />
          </div>
        </div>

        <div className="flex flex-col gap-2 shrink-0">
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
            <Usb size={14} className="text-muted-foreground" />
            <div className="min-w-0">
              <Complete label="Import Complete" size="xs" />
              <p className="text-[10px] text-muted-foreground font-mono mt-1">{HERO.usb} · {HERO.lastImport}</p>
              <ImportButton compact className="mt-2" />
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
            <Waveform size={14} className="text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <Complete label="Analysis Complete" size="xs" />
              <div className="flex items-center gap-2 mt-1.5">
                <ProgressBar value={HERO.progress} className="w-28" />
                <span className="text-[10px] font-mono text-muted-foreground">{HERO.analyzed}/{HERO.tracks}</span>
              </div>
            </div>
          </div>
        </div>

        <InsightTrio className="h-[176px] min-w-0 flex-1" wide={false} />
      </div>
    </div>
  );
}

// ── 3. Bento Grid ────────────────────────────────────────────────────────────
// Separate tiles of different sizes; the profile tile is tallest, the three
// headline stats each get their own tile with a colored accent.

function HeroBento() {
  return (
    <div className="grid h-[218px] gap-3" style={{ gridTemplateColumns: '168px 214px 1fr 1fr 1fr', gridTemplateRows: '1fr 1fr' }}>
      <div className="glass row-span-2 flex flex-col items-center justify-center rounded-2xl border border-[var(--color-border-subtle)] p-4 text-center">
        <Avatar size={64} />
        <h2 className="mt-3 text-xl font-black uppercase tracking-tight">{HERO.name}</h2>
        <Socials className="mt-2 justify-center" />
        <ImportButton compact className="mt-3 whitespace-nowrap" />
      </div>

      <div className="glass flex min-h-0 flex-col justify-center gap-1.5 rounded-2xl border border-[var(--color-border-subtle)] px-3.5 py-2.5" style={{ gridColumn: 2, gridRow: 1 }}>
        <Eyebrow>USB Import</Eyebrow>
        <Complete label="Import Complete" size="xs" />
        <InfoRow icon={Usb} label="USB" value={HERO.usb} />
        <InfoRow icon={Calendar} label="Last Import" value={HERO.lastImport} />
      </div>

      <div className="glass flex min-h-0 flex-col justify-center gap-1.5 rounded-2xl border border-[var(--color-border-subtle)] px-3.5 py-2.5" style={{ gridColumn: 2, gridRow: 2 }}>
        <Eyebrow>Track Analysis</Eyebrow>
        <Complete label="Analysis Complete" size="xs" />
        <ProgressBar value={HERO.progress} className="my-1" />
        <InfoRow icon={Waveform} label="Analyzed" value={`${HERO.analyzed} / ${HERO.tracks}`} />
      </div>

      <BentoInsight title="Top Genres" accent={GENRE_RANK_COLORS[0]}><InsightTopGenres genres={SAMPLE_GENRES} compact /></BentoInsight>
      <BentoInsight title="BPM Distribution" accent="#f43f5e"><InsightBpmDistribution bpmRangeStats={SAMPLE_BPM} compact /></BentoInsight>
      <BentoInsight title="Camelot Wheel" accent={KEY_COLOR}><InsightKeyProfile keyStats={SAMPLE_KEYS} compact /></BentoInsight>
    </div>
  );
}

/** A bento tile holding one insight chart, with a colored accent bar on top. */
function BentoInsight({ title, accent, children }: { title: string; accent: string; children: ReactNode }) {
  return (
    <div className="glass relative row-span-2 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--color-border-subtle)] px-3.5 pb-3 pt-4">
      <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: accent }} />
      <Eyebrow className="mb-1.5 shrink-0">{title}</Eyebrow>
      {children}
    </div>
  );
}

// ── 4. Editorial Cover ───────────────────────────────────────────────────────
// Magazine-style: oversized name over a soft glow, stats as a ruled row
// underneath, import/analysis status in a thin footer bar.

function HeroEditorial() {
  return (
    <div className="relative h-[218px] overflow-hidden rounded-2xl border border-[var(--color-border-subtle)] bg-[#050b16]">
      <div className="absolute -left-16 -top-24 h-72 w-72 rounded-full bg-primary/30 blur-3xl pointer-events-none" />
      <div className="absolute right-10 -bottom-24 h-64 w-96 rounded-full bg-violet-500/15 blur-3xl pointer-events-none" />
      <div className="relative grid h-full grid-cols-[380px_1fr]">
        <div className="flex min-w-0 flex-col justify-between border-r border-white/10 px-6 py-5">
          <div className="flex items-center gap-3">
            <Avatar size={52} />
            <div className="min-w-0">
              <Eyebrow>Artist Library</Eyebrow>
              <h2 className="mt-0.5 text-4xl font-black uppercase leading-[0.9] tracking-[-0.04em]">{HERO.name}</h2>
            </div>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
            <span><b className="text-base font-black text-foreground tabular-nums">{HERO.tracks}</b> tracks</span>
            <span><b className="text-base font-black text-foreground tabular-nums">{HERO.playlists}</b> playlists</span>
            <Socials size={15} className="ml-auto" />
          </div>
          <div className="space-y-1 text-[10px]">
            <div className="flex items-center gap-2 whitespace-nowrap"><Complete label="Import Complete" size="xs" /><span className="font-mono text-muted-foreground">{HERO.usb}</span></div>
            <div className="flex items-center gap-2 whitespace-nowrap"><Complete label="Analysis Complete" size="xs" /><span className="font-mono text-muted-foreground">{HERO.analyzed}/{HERO.tracks}</span><ImportButton compact className="ml-auto whitespace-nowrap" /></div>
          </div>
        </div>
        <InsightTrio className="min-w-0 px-5 py-5" bordered wide={false} />
      </div>
    </div>
  );
}

// ── Pro suite concepts ───────────────────────────────────────────────────────
// Flat surfaces, hairline dividers, small-caps labels, tabular figures and a
// single accent. Modelled on DAW / DJ-software chrome rather than web heroes.

const PRO = {
  surface: 'var(--color-surface)',
  panel: 'var(--color-panel)',
  line: 'var(--color-border-subtle)',
  accent: 'var(--color-primary)',
  ok: '#3fb950',
};

// Sample library spread used for the distribution mockups.
const BPM_SPREAD = [1, 0, 2, 1, 3, 2, 6, 14, 9, 4, 2, 1];
const BPM_SPREAD_LABELS = ['118', '140', '152'];
const KEY_SPREAD: Record<string, number> = { '7A': 12, '8A': 9, '6A': 7, '4A': 5, '5A': 4, '9B': 3, '10A': 3, '2A': 2 };
const GENRE_SPREAD = [['Nasty', 18], ['Dubstep', 11], ['Riddim', 9], ['Trap', 7]] as const;

function ProLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground', className)}>{children}</span>;
}

function ProButton({ children, primary = false }: { children: ReactNode; primary?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-[4px] border px-2.5 text-[11px] font-medium transition-colors',
        primary
          ? 'border-transparent bg-primary text-white hover:brightness-110'
          : 'border-[var(--color-border-subtle)] bg-[var(--color-panel)] text-foreground hover:bg-white/[0.06]',
      )}
    >
      {children}
    </button>
  );
}

function SquareAvatar({ size = 40 }: { size?: number }) {
  return (
    <div
      className="shrink-0 rounded-[4px] bg-[var(--color-panel)] border border-[var(--color-border-subtle)] flex items-center justify-center font-semibold text-muted-foreground"
      style={{ width: size, height: size, fontSize: size * 0.32 }}
    >
      {HERO.initials}
    </div>
  );
}

function StatusDot({ color = PRO.ok }: { color?: string }) {
  return <span className="inline-block h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} />;
}

// ── 6. Inspector Bar ─────────────────────────────────────────────────────────
// Ableton/Bitwig-style info strip: one row of equal-height cells divided by
// hairlines, every value labeled, nothing decorative.

function InspectorCell({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col justify-center gap-1 px-4 border-l border-[var(--color-border-subtle)] min-w-0', className)}>
      <ProLabel>{label}</ProLabel>
      <div className="text-[13px] font-medium tabular-nums truncate">{children}</div>
    </div>
  );
}

function _HeroInspector() {
  return (
    <div className="flex h-[68px] items-stretch rounded-md border border-[var(--color-border-subtle)]" style={{ background: PRO.surface }}>
      <div className="flex items-center gap-3 px-4 shrink-0">
        <SquareAvatar size={40} />
        <div>
          <div className="text-[15px] font-semibold tracking-tight leading-none">{HERO.name}</div>
          <Socials size={12} className="mt-1.5 gap-2" />
        </div>
      </div>
      <InspectorCell label="Source">{HERO.usb}</InspectorCell>
      <InspectorCell label="Last import">{HERO.lastImport}</InspectorCell>
      <InspectorCell label="Tracks">{HERO.tracks}<span className="text-muted-foreground"> / {HERO.playlists} playlists</span></InspectorCell>
      <InspectorCell label="Analysis" className="w-[150px]">
        <div className="flex items-center gap-2">
          <div className="h-[3px] flex-1 bg-white/10"><div className="h-full" style={{ width: `${HERO.progress}%`, background: PRO.ok }} /></div>
          <span className="text-[11px] text-muted-foreground">{HERO.analyzed}/{HERO.tracks}</span>
        </div>
      </InspectorCell>
      <InspectorCell label="Tempo">{HERO.bpm}<span className="text-muted-foreground text-[11px]"> BPM</span></InspectorCell>
      <InspectorCell label="Key">{HERO.key}</InspectorCell>
      <InspectorCell label="Genre" className="flex-1">{HERO.genre}</InspectorCell>
      <div className="flex items-center px-4 border-l border-[var(--color-border-subtle)] shrink-0">
        <ProButton><Upload size={12} /> Import</ProButton>
      </div>
    </div>
  );
}

// ── 7. Session Sheet ─────────────────────────────────────────────────────────
// Logic/Pro Tools session-info feel: title line with plain text links, then a
// ruled key/value sheet in three groups.

function SheetRow({ label, value, children }: { label: string; value?: string; children?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-[var(--color-border-subtle)] last:border-b-0">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      {children ?? <span className="text-[11px] font-medium tabular-nums">{value}</span>}
    </div>
  );
}

function _HeroSessionSheet() {
  return (
    <div className="rounded-md border border-[var(--color-border-subtle)]" style={{ background: PRO.surface }}>
      <div className="flex items-center gap-4 px-5 py-3 border-b border-[var(--color-border-subtle)]">
        <SquareAvatar size={32} />
        <span className="text-[15px] font-semibold">{HERO.name}</span>
        <span className="flex items-center gap-3 text-[11px] text-muted-foreground">
          {['Spotify', 'SoundCloud', 'Instagram'].map((l) => <span key={l} className="hover:text-foreground cursor-pointer">{l}</span>)}
        </span>
        <div className="ml-auto flex gap-2">
          <ProButton primary><Upload size={12} /> Import Library</ProButton>
        </div>
      </div>
      <div className="grid grid-cols-3 divide-x divide-[var(--color-border-subtle)]">
        <div className="px-5 py-2">
          <ProLabel className="block pb-1">Import</ProLabel>
          <SheetRow label="Status"><span className="flex items-center gap-1.5 text-[11px] font-medium"><StatusDot /> Complete</span></SheetRow>
          <SheetRow label="Device" value={HERO.usb} />
          <SheetRow label="Last import" value={HERO.lastImport} />
        </div>
        <div className="px-5 py-2">
          <ProLabel className="block pb-1">Analysis</ProLabel>
          <SheetRow label="Status"><span className="flex items-center gap-1.5 text-[11px] font-medium"><StatusDot /> Complete</span></SheetRow>
          <SheetRow label="Analyzed" value={`${HERO.analyzed} of ${HERO.tracks}`} />
          <SheetRow label="Progress" value={`${HERO.progress}%`} />
        </div>
        <div className="px-5 py-2">
          <ProLabel className="block pb-1">Library profile</ProLabel>
          <SheetRow label="Most common tempo" value={`${HERO.bpm} BPM`} />
          <SheetRow label="Most common key" value={HERO.key} />
          <SheetRow label="Top genre" value={HERO.genre} />
        </div>
      </div>
    </div>
  );
}

// ── 8. Library Profile with distributions ────────────────────────────────────
// The headline numbers earn their place by showing the spread behind them:
// a tempo histogram, key share and genre share, each with the main value.

function _HeroDistributions() {
  const maxBpm = Math.max(...BPM_SPREAD);
  const peakIndex = BPM_SPREAD.indexOf(maxBpm);
  const keyTotal = Object.values(KEY_SPREAD).reduce((a, b) => a + b, 0);
  const genreTotal = GENRE_SPREAD.reduce((a, [, n]) => a + n, 0);
  return (
    <div className="grid rounded-md border border-[var(--color-border-subtle)] divide-x divide-[var(--color-border-subtle)]"
      style={{ background: PRO.surface, gridTemplateColumns: '260px 1fr 1fr 1fr' }}>
      <div className="p-4 flex flex-col justify-between gap-3">
        <div className="flex items-center gap-3">
          <SquareAvatar size={44} />
          <div>
            <div className="text-[15px] font-semibold leading-none">{HERO.name}</div>
            <div className="text-[11px] text-muted-foreground mt-1.5">{HERO.tracks} tracks · {HERO.playlists} playlists</div>
          </div>
        </div>
        <div className="space-y-1 text-[11px]">
          <div className="flex items-center gap-1.5"><StatusDot /> Imported from {HERO.usb} <span className="text-muted-foreground ml-auto">{HERO.lastImport}</span></div>
          <div className="flex items-center gap-1.5"><StatusDot /> {HERO.analyzed}/{HERO.tracks} tracks analyzed</div>
        </div>
        <div className="flex items-center justify-between">
          <Socials size={13} className="gap-2.5" />
          <ProButton><Upload size={12} /> Import</ProButton>
        </div>
      </div>

      <div className="p-4 flex flex-col">
        <div className="flex items-baseline justify-between"><ProLabel>Tempo</ProLabel><span className="text-[10px] text-muted-foreground">{Math.round((maxBpm / HERO.tracks) * 100)}% of library</span></div>
        <div className="text-2xl font-semibold tabular-nums mt-1">{HERO.bpm}<span className="text-xs text-muted-foreground font-normal ml-1">BPM</span></div>
        <div className="flex items-end gap-[2px] h-12 mt-auto pt-3">
          {BPM_SPREAD.map((n, i) => (
            <div key={i} className="flex-1" style={{ height: `${Math.max(4, (n / maxBpm) * 100)}%`, background: i === peakIndex ? PRO.accent : 'rgba(255,255,255,0.14)' }} />
          ))}
        </div>
        <div className="flex justify-between text-[9px] text-muted-foreground tabular-nums mt-1">
          {BPM_SPREAD_LABELS.map((l) => <span key={l}>{l}</span>)}
        </div>
      </div>

      <div className="p-4 flex flex-col">
        <div className="flex items-baseline justify-between"><ProLabel>Key</ProLabel><span className="text-[10px] text-muted-foreground">{Math.round((KEY_SPREAD[HERO.key] / keyTotal) * 100)}% of library</span></div>
        <div className="text-2xl font-semibold tabular-nums mt-1">{HERO.key}</div>
        <div className="flex h-2 mt-auto overflow-hidden rounded-[2px]">
          {Object.entries(KEY_SPREAD).map(([k, n]) => (
            <div key={k} title={`${k}: ${n}`} style={{ width: `${(n / keyTotal) * 100}%`, background: camelotKeyColor(k), opacity: k === HERO.key ? 1 : 0.35 }} className="border-r border-[var(--color-surface)] last:border-r-0" />
          ))}
        </div>
        <div className="flex gap-3 text-[9px] text-muted-foreground tabular-nums mt-1.5">
          {Object.entries(KEY_SPREAD).slice(0, 4).map(([k, n]) => <span key={k}>{k} <span className="text-foreground/70">{n}</span></span>)}
        </div>
      </div>

      <div className="p-4 flex flex-col">
        <div className="flex items-baseline justify-between"><ProLabel>Genre</ProLabel><span className="text-[10px] text-muted-foreground">{Math.round((GENRE_SPREAD[0][1] / genreTotal) * 100)}% of library</span></div>
        <div className="text-2xl font-semibold mt-1">{HERO.genre}</div>
        <div className="mt-auto space-y-1 pt-2">
          {GENRE_SPREAD.map(([g, n], i) => (
            <div key={g} className="flex items-center gap-2 text-[10px]">
              <span className="w-14 text-muted-foreground truncate">{g}</span>
              <div className="h-[3px] flex-1 bg-white/[0.06]"><div className="h-full" style={{ width: `${(n / GENRE_SPREAD[0][1]) * 100}%`, background: i === 0 ? PRO.accent : 'rgba(255,255,255,0.25)' }} /></div>
              <span className="w-4 text-right tabular-nums text-muted-foreground">{n}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── 9. Device Header ─────────────────────────────────────────────────────────
// Rekordbox/Engine-style: the USB is the subject. Device panel on the left,
// library identity and sync state beside it, a toolbar-like action area.

function _HeroDevice() {
  return (
    <div className="rounded-md border border-[var(--color-border-subtle)] overflow-hidden" style={{ background: PRO.surface }}>
      <div className="flex items-stretch">
        <div className="flex items-center gap-3 px-4 py-3 w-[240px] shrink-0 border-r border-[var(--color-border-subtle)]" style={{ background: PRO.panel }}>
          <div className="flex h-9 w-9 items-center justify-center rounded-[4px] border border-[var(--color-border-subtle)] text-muted-foreground"><Usb size={18} /></div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold font-mono truncate">{HERO.usb}</div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5"><StatusDot /> Connected · synced {HERO.lastImport}</div>
          </div>
        </div>
        <div className="flex items-center gap-3 px-4 min-w-0 flex-1">
          <SquareAvatar size={36} />
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="text-[15px] font-semibold leading-none">{HERO.name}</span>
              <Socials size={12} className="gap-2" />
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">{HERO.tracks} tracks in {HERO.playlists} playlists · largest: {HERO.largestPlaylist}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 px-4 shrink-0 border-l border-[var(--color-border-subtle)]">
          <ProButton primary><Upload size={12} /> Import Library</ProButton>
        </div>
      </div>
      <div className="flex items-center h-8 border-t border-[var(--color-border-subtle)] text-[11px] tabular-nums">
        {[
          ['Import', 'Complete'],
          ['Analysis', `${HERO.analyzed}/${HERO.tracks} · ${HERO.progress}%`],
          ['Main BPM', String(HERO.bpm)],
          ['Main key', HERO.key],
          ['Main genre', HERO.genre],
        ].map(([label, value], i) => (
          <div key={label} className={cn('flex items-center gap-2 px-4 h-full', i > 0 && 'border-l border-[var(--color-border-subtle)]')}>
            {i < 2 && <StatusDot />}
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 10. Typographic Header ───────────────────────────────────────────────────
// No container at all: a page header the way a mastering or catalog tool
// would set it. Regular-weight name, one line of meta, numbers set in a row
// with units, a single hairline to close it.

function HeroTypographic() {
  return (
    <div className="px-1 pb-5 border-b border-[var(--color-border-subtle)]">
      <div className="flex items-end gap-10">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <StatusDot /> Library up to date · imported from <span className="font-mono text-foreground/80">{HERO.usb}</span> on {HERO.lastImport}
          </div>
          <h2 className="text-[40px] font-medium tracking-[-0.02em] leading-none mt-3">{HERO.name}</h2>
          <div className="flex items-center gap-4 mt-3 text-[12px] text-muted-foreground">
            <span>{HERO.tracks} tracks</span>
            <span>{HERO.playlists} playlists</span>
            <span>{HERO.analyzed} analyzed</span>
            <span className="h-3 w-px bg-[var(--color-border-subtle)]" />
            <Socials size={13} className="gap-2.5" />
          </div>
        </div>
        <div className="ml-auto flex items-end gap-8">
          <MiniInsights className="w-[460px]" wheelSize={60} barHeight={44} />
          <ProButton><Upload size={12} /> Import</ProButton>
        </div>
      </div>
    </div>
  );
}

// ── 11–15. Editorial continuations ───────────────────────────────────────────

function HeroGalleryMasthead() {
  return (
    <div className="h-[218px] border-y border-[var(--color-border-subtle)] py-4">
      <div className="flex items-end gap-4">
        <SquareAvatar size={46} />
        <div className="min-w-0">
          <ProLabel>Library profile / 01</ProLabel>
          <h2 className="mt-1.5 truncate text-[36px] font-medium leading-[.82] tracking-[-.055em]">{HERO.name}</h2>
        </div>
        <div className="ml-6 hidden items-center gap-2 pb-1 text-[11px] text-muted-foreground md:flex">
          <span>{HERO.tracks} tracks</span><span>·</span><span>{HERO.playlists} playlists</span><Socials size={13} className="ml-2 gap-2.5" />
        </div>
        <div className="ml-auto flex items-center gap-4 pb-1 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-2 text-foreground"><StatusDot /> Library current</span>
          <span className="font-mono">{HERO.usb}</span><span>{HERO.analyzed}/{HERO.tracks} analyzed</span>
          <ProButton><Upload size={12} /> Import</ProButton>
        </div>
      </div>
      <div className="mt-4 border-t border-[var(--color-border-subtle)] pt-4">
        <MiniInsights wheelSize={64} barHeight={40} className="gap-10" />
      </div>
    </div>
  );
}

function HeroSwissIndex() {
  return (
    <div className="grid h-[218px] overflow-hidden border border-[var(--color-border-subtle)] lg:grid-cols-[52px_.9fr_2fr]" style={{ background: PRO.surface }}>
      <div className="flex items-center justify-center border-b border-[var(--color-border-subtle)] bg-[var(--color-panel)] lg:border-b-0 lg:border-r"><span className="font-mono text-[9px] tracking-[.2em] text-muted-foreground [writing-mode:vertical-rl]">DROPDEX / LIBRARY</span></div>
      <div className="flex min-w-0 flex-col justify-between p-5">
        <div className="flex items-center justify-between"><span className="font-mono text-[9px] text-muted-foreground">PROFILE—001</span><Socials size={12} className="gap-2" /></div>
        <h2 className="text-[clamp(34px,5vw,56px)] font-semibold leading-[.78] tracking-[-.075em]">{HERO.name}</h2>
        <div className="space-y-1 text-[10px] text-muted-foreground"><div className="flex gap-4"><span>{HERO.tracks} TRACKS</span><span>{HERO.playlists} PLAYLISTS</span></div><div className="font-mono">{HERO.usb} · {HERO.progress}% ANALYZED</div></div>
      </div>
      <div className="grid grid-cols-3 divide-x divide-[var(--color-border-subtle)] border-t border-[var(--color-border-subtle)] lg:border-l lg:border-t-0">
        <div className="flex flex-col gap-3 p-4"><ProLabel>TOP GENRES</ProLabel><MiniGenres rows={4} /></div>
        <div className="flex flex-col gap-3 p-4"><ProLabel>BPM DISTRIBUTION</ProLabel><MiniBpm height={84} /></div>
        <div className="flex flex-col gap-3 p-4"><ProLabel>CAMELOT WHEEL</ProLabel><MiniWheel size={84} withKeys={false} /><div className="flex gap-3 text-[10px] tabular-nums text-muted-foreground">{SAMPLE_KEYS.slice(0, 3).map(([k, n]) => <span key={k}><b style={{ color: camelotColor(k) }}>{k}</b> {n}</span>)}</div></div>
      </div>
    </div>
  );
}

function HeroQuietRegister() {
  return (
    <div className="flex h-[218px] flex-col justify-between px-4 py-4 text-center">
      <div className="mx-auto flex w-full max-w-[860px] items-center gap-4"><span className="h-px flex-1 bg-[var(--color-border-subtle)]" /><ProLabel>Artist library</ProLabel><span className="h-px flex-1 bg-[var(--color-border-subtle)]" /></div>
      <div className="flex items-center justify-center gap-5">
        <h2 className="text-[34px] font-light leading-none tracking-[-.045em]">{HERO.name}</h2>
        <span className="h-4 w-px bg-[var(--color-border-subtle)]" />
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground"><Socials size={13} className="gap-2.5" /><span>{HERO.tracks} tracks</span><span>{HERO.playlists} playlists</span></div>
        <span className="h-4 w-px bg-[var(--color-border-subtle)]" />
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground"><span className="flex items-center gap-2 text-foreground"><StatusDot /> Analysis complete</span><span>Imported {HERO.lastImport}</span><ProButton><Upload size={12} /> Import</ProButton></div>
      </div>
      <div className="mx-auto grid w-full max-w-[860px] grid-cols-3 border-y border-[var(--color-border-subtle)] py-3 text-left">
        <div className="pr-6"><ProLabel className="mb-1.5 block">Top genres</ProLabel><MiniGenres rows={2} /></div>
        <div className="border-l border-[var(--color-border-subtle)] px-6"><ProLabel className="mb-1.5 block">BPM distribution</ProLabel><MiniBpm height={34} /></div>
        <div className="flex flex-col items-center border-l border-[var(--color-border-subtle)] pl-6"><ProLabel className="mb-1.5 block">Camelot wheel</ProLabel><MiniWheel size={54} withKeys={false} /></div>
      </div>
    </div>
  );
}

function HeroSplitLedger() {
  return (
    <div className="grid overflow-hidden border-y border-[var(--color-border-subtle)] lg:grid-cols-[.8fr_1.5fr]">
      <div className="flex min-h-[190px] flex-col justify-between border-b border-[var(--color-border-subtle)] py-5 pr-7 lg:border-b-0 lg:border-r">
        <div className="flex items-start justify-between"><ProLabel>Collection owner</ProLabel><span className="font-mono text-[9px] text-muted-foreground">{HERO.initials}—26</span></div>
        <div><h2 className="text-[44px] font-medium leading-none tracking-[-.055em]">{HERO.name}</h2><div className="mt-3 flex items-center gap-3"><Socials size={13} className="gap-2.5" /><span className="text-[10px] text-muted-foreground">{HERO.tracks} tracks · {HERO.playlists} playlists</span></div></div>
        <p className="font-mono text-[9px] text-muted-foreground">SOURCE {HERO.usb} / {HERO.lastImport}</p>
      </div>
      <div className="grid grid-rows-[1fr_auto] pl-0 lg:pl-7">
        <div className="grid grid-cols-3 divide-x divide-[var(--color-border-subtle)] border-b border-[var(--color-border-subtle)]">
          <div className="px-5 py-4 first:pl-0"><ProLabel className="mb-2 block">TOP GENRES</ProLabel><MiniGenres rows={4} /></div>
          <div className="px-5 py-4"><ProLabel className="mb-2 block">BPM DISTRIBUTION</ProLabel><MiniBpm height={56} /></div>
          <div className="px-5 py-4"><ProLabel className="mb-2 block">CAMELOT WHEEL</ProLabel><MiniWheel size={76} /></div>
        </div>
        <div className="flex items-center gap-4 py-3 text-[10px] text-muted-foreground"><StatusDot /><span className="text-foreground">Analysis complete</span><span className="font-mono">{HERO.analyzed}/{HERO.tracks}</span><div className="h-px flex-1 bg-[var(--color-border-subtle)]" /><ProButton><Upload size={12} /> Import library</ProButton></div>
      </div>
    </div>
  );
}

function HeroMonograph() {
  return (
    <div className="border border-[var(--color-border-subtle)] bg-[var(--color-background)] p-5">
      <div className="grid gap-5 lg:grid-cols-[auto_1fr_auto]">
        <div className="flex min-w-[88px] flex-col justify-between border-r border-[var(--color-border-subtle)] pr-5"><span className="font-mono text-[9px] text-muted-foreground">CATALOG</span><span className="text-[36px] font-light leading-none tabular-nums">0{HERO.tracks}</span></div>
        <div className="min-w-0"><div className="flex items-center gap-2 text-[10px] text-muted-foreground"><StatusDot /> Synchronized library · {HERO.lastImport}</div><h2 className="mt-4 truncate text-[46px] font-medium leading-none tracking-[-.06em]">{HERO.name}</h2><div className="mt-4 flex items-center gap-4"><Socials size={13} className="gap-2.5" /><span className="text-[10px] text-muted-foreground">{HERO.playlists} playlists · {HERO.analyzed} analyzed</span></div></div>
        <MiniInsights className="min-w-[500px] border-l border-[var(--color-border-subtle)] pl-5" wheelSize={68} barHeight={44} />
      </div>
      <div className="mt-5 flex items-center border-t border-[var(--color-border-subtle)] pt-3"><span className="font-mono text-[9px] text-muted-foreground">USB / {HERO.usb}</span><span className="ml-auto"><ProButton><Upload size={12} /> Import</ProButton></span></div>
    </div>
  );
}

// ── Tab content ──────────────────────────────────────────────────────────────

export function HeroMockupsContent() {
  return (
    <div className="h-full overflow-y-auto px-8 pt-7 pb-12 bg-[var(--color-background)]">
      <div className="mb-7">
        <div className="text-sm font-extrabold text-foreground mb-1">Library Hero Concepts</div>
        <div className="text-[11px] text-muted-foreground leading-relaxed">
          Nine hero directions using the same information as the artist library hero: profile, socials, USB import, track analysis and the library's top genres, BPM distribution and Camelot wheel (these replace the single main BPM, key and genre).
        </div>
      </div>
      <HeroMockupCard n={1} title="Spotlight Banner" concept="One wide banner: identity left, status chips middle, big stats right">
        <HeroSpotlight />
      </HeroMockupCard>
      <HeroMockupCard n={3} title="Bento Grid" concept="Separate tiles; profile tallest, each headline stat gets its own tile">
        <HeroBento />
      </HeroMockupCard>
      <HeroMockupCard n={4} title="Editorial Cover" concept="Oversized name, ruled stat row, status in a thin footer bar">
        <HeroEditorial />
      </HeroMockupCard>
      <HeroMockupCard n={10} title="Typographic Header" concept="No container: page header with a single closing rule">
        <HeroTypographic />
      </HeroMockupCard>
      <HeroMockupCard n={11} title="Gallery Masthead" concept="An asymmetrical identity, context, and statistics composition with editorial pacing">
        <HeroGalleryMasthead />
      </HeroMockupCard>
      <HeroMockupCard n={12} title="Swiss Index" concept="A strict catalog grid pairing oversized identity with indexed library readouts">
        <HeroSwissIndex />
      </HeroMockupCard>
      <HeroMockupCard n={13} title="Quiet Register" concept="Centered typography, generous negative space, and a restrained statistical rule">
        <HeroQuietRegister />
      </HeroMockupCard>
      <HeroMockupCard n={14} title="Split Ledger" concept="Identity and library intelligence divided into a precise two-part ledger">
        <HeroSplitLedger />
      </HeroMockupCard>
      <HeroMockupCard n={15} title="Studio Monograph" concept="A catalog-number composition with compact metadata and disciplined typography">
        <HeroMonograph />
      </HeroMockupCard>
    </div>
  );
}
