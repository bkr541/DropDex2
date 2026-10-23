import type { ReactNode } from 'react';
import {
  Calendar, ChartBar, CheckmarkFilled, LogoInstagram, Music, RecordingFilled, Upload, Usb, Waveform,
} from '@carbon/icons-react';
import { cn } from '../../lib/utils';
import { camelotKeyColor } from './display/camelotKey';

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
        'flex items-center justify-center gap-1.5 rounded-xl border border-blue-500 text-blue-400 bg-transparent',
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

const ANALYSIS_ROWS = [
  { icon: RecordingFilled, label: 'Status', value: HERO.status },
  { icon: Waveform, label: 'Analyzed', value: String(HERO.analyzed) },
  { icon: Music, label: 'Tracks', value: String(HERO.tracks) },
  { icon: ChartBar, label: 'Progress', value: `${HERO.progress}%` },
];

const MAIN_STATS = [
  { label: 'Main BPM', value: String(HERO.bpm) },
  { label: 'Main Key', value: HERO.key },
  { label: 'Main Genre', value: HERO.genre },
];

function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('h-1.5 w-full rounded-full bg-white/[0.08] overflow-hidden', className)}>
      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${value}%` }} />
    </div>
  );
}

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
      <div className="relative flex items-center gap-8 px-8 py-7">
        <div className="flex items-center gap-5 shrink-0">
          <Avatar size={88} />
          <div>
            <h2 className="text-3xl font-black uppercase tracking-tight leading-none">{HERO.name}</h2>
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
            </div>
            <ImportButton compact className="ml-3" />
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

        <div className="flex-1 flex items-center justify-end gap-10 pr-2">
          {MAIN_STATS.map(({ label, value }) => (
            <div key={label} className="text-right">
              <p className="text-4xl font-black tabular-nums leading-none tracking-tight" style={label === 'Main Key' ? { color: KEY_COLOR } : undefined}>
                {value}
              </p>
              <Eyebrow className="mt-2">{label}</Eyebrow>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── 3. Bento Grid ────────────────────────────────────────────────────────────
// Separate tiles of different sizes; the profile tile is tallest, the three
// headline stats each get their own tile with a colored accent.

function HeroBento() {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: '1.1fr 1.2fr 1.2fr 0.8fr 0.8fr', gridTemplateRows: 'auto auto' }}>
      <div className="glass row-span-2 rounded-2xl border border-[var(--color-border-subtle)] p-5 flex flex-col items-center justify-center text-center">
        <Avatar size={84} />
        <h2 className="text-2xl font-black uppercase tracking-tight mt-4">{HERO.name}</h2>
        <Socials className="mt-2 justify-center" />
      </div>

      <div className="glass row-span-2 rounded-2xl border border-[var(--color-border-subtle)] p-4 flex flex-col">
        <Eyebrow className="mb-2">USB Import</Eyebrow>
        <Complete label="Import Complete" />
        <div className="grid gap-2 mt-4">
          <InfoRow icon={Usb} label="USB" value={HERO.usb} />
          <InfoRow icon={Calendar} label="Last Import" value={HERO.lastImport} />
          <InfoRow icon={Music} label="Playlists" value={String(HERO.playlists)} />
        </div>
        <div className="flex-1" />
        <ImportButton className="w-full mt-4" />
      </div>

      <div className="glass row-span-2 rounded-2xl border border-[var(--color-border-subtle)] p-4 flex flex-col">
        <Eyebrow className="mb-2">Track Analysis</Eyebrow>
        <Complete label="Analysis Complete" />
        <div className="flex items-center gap-4 mt-4">
          <ProgressRing value={HERO.progress} />
          <div className="grid gap-2 flex-1">
            {ANALYSIS_ROWS.slice(0, 3).map((row) => <InfoRow key={row.label} {...row} />)}
          </div>
        </div>
      </div>

      <BentoStat label="Main BPM" value={String(HERO.bpm)} accent="#f59e0b" />
      <BentoStat label="Main Key" value={HERO.key} accent={KEY_COLOR} />
      <BentoStat label="Main Genre" value={HERO.genre} accent="var(--color-primary)" wide />
    </div>
  );
}

function BentoStat({ label, value, accent, wide = false }: { label: string; value: string; accent: string; wide?: boolean }) {
  return (
    <div
      className={cn('glass relative overflow-hidden rounded-2xl border border-[var(--color-border-subtle)] px-4 py-4 flex flex-col justify-end', wide && 'col-span-2')}
    >
      <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: accent }} />
      <p className="text-3xl font-black tabular-nums leading-none tracking-tight" style={{ color: accent }}>{value}</p>
      <Eyebrow className="mt-1.5">{label}</Eyebrow>
    </div>
  );
}

function ProgressRing({ value, size = 64 }: { value: number; size?: number }) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={5} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#10b981" strokeWidth={5} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-black tabular-nums">{value}%</span>
    </div>
  );
}

// ── 4. Editorial Cover ───────────────────────────────────────────────────────
// Magazine-style: oversized name over a soft glow, stats as a ruled row
// underneath, import/analysis status in a thin footer bar.

function HeroEditorial() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[var(--color-border-subtle)] bg-[#050b16]">
      <div className="absolute -left-16 -top-24 h-72 w-72 rounded-full bg-primary/30 blur-3xl pointer-events-none" />
      <div className="absolute right-10 -bottom-24 h-64 w-96 rounded-full bg-violet-500/15 blur-3xl pointer-events-none" />
      <div className="relative px-8 pt-7 pb-5">
        <div className="flex items-end gap-6">
          <Avatar size={72} />
          <div className="min-w-0 flex-1">
            <Eyebrow>Artist Library</Eyebrow>
            <h2 className="text-6xl font-black uppercase tracking-[-0.04em] leading-[0.9] mt-1">{HERO.name}</h2>
          </div>
          <div className="flex flex-col items-end gap-3 shrink-0">
            <Socials size={18} />
            <ImportButton />
          </div>
        </div>

        <div className="grid grid-cols-5 mt-7 border-t border-white/10">
          {[
            { label: 'Tracks', value: String(HERO.tracks) },
            { label: 'Playlists', value: String(HERO.playlists) },
            ...MAIN_STATS,
          ].map(({ label, value }, i) => (
            <div key={label} className={cn('pt-4 pr-4', i > 0 && 'pl-4 border-l border-white/10')}>
              <p className="text-2xl font-black tabular-nums leading-none" style={label === 'Main Key' ? { color: KEY_COLOR } : undefined}>{value}</p>
              <Eyebrow className="mt-1.5">{label}</Eyebrow>
            </div>
          ))}
        </div>
      </div>

      <div className="relative flex items-center gap-6 border-t border-white/10 bg-black/30 px-8 py-2.5 text-[10px]">
        <Complete label="Import Complete" size="xs" />
        <span className="text-muted-foreground font-mono">{HERO.usb}</span>
        <span className="text-muted-foreground font-mono">Last import {HERO.lastImport}</span>
        <span className="h-3 w-px bg-white/15" />
        <Complete label="Analysis Complete" size="xs" />
        <span className="text-muted-foreground font-mono">{HERO.analyzed} of {HERO.tracks} tracks · {HERO.progress}%</span>
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
        <div className="ml-auto flex items-end gap-10 tabular-nums">
          {[
            ['Tempo', String(HERO.bpm), 'BPM'],
            ['Key', HERO.key, ''],
            ['Genre', HERO.genre, ''],
          ].map(([label, value, unit]) => (
            <div key={label}>
              <ProLabel>{label}</ProLabel>
              <div className="text-[28px] font-light leading-none mt-1.5">
                {value}{unit && <span className="text-[11px] text-muted-foreground font-normal ml-1">{unit}</span>}
              </div>
            </div>
          ))}
          <ProButton><Upload size={12} /> Import</ProButton>
        </div>
      </div>
    </div>
  );
}

// ── 11–15. Editorial continuations ───────────────────────────────────────────

function HeroGalleryMasthead() {
  return (
    <div className="border-y border-[var(--color-border-subtle)] py-5">
      <div className="grid items-end gap-6 lg:grid-cols-[1.35fr_.8fr_1fr]">
        <div className="flex items-end gap-4">
          <SquareAvatar size={54} />
          <div className="min-w-0">
            <ProLabel>Library profile / 01</ProLabel>
            <h2 className="mt-2 truncate text-[42px] font-medium leading-[.82] tracking-[-.055em]">{HERO.name}</h2>
          </div>
        </div>
        <div className="border-l border-[var(--color-border-subtle)] pl-5">
          <p className="max-w-[230px] text-[11px] leading-relaxed text-muted-foreground">{HERO.tracks} tracks organized across {HERO.playlists} playlists. Primary collection: {HERO.largestPlaylist}.</p>
          <Socials size={13} className="mt-3 gap-2.5" />
        </div>
        <div className="flex items-end justify-between gap-5 border-l border-[var(--color-border-subtle)] pl-5">
          {[['BPM', HERO.bpm], ['KEY', HERO.key], ['GENRE', HERO.genre]].map(([label, value]) => <div key={label}><ProLabel>{label}</ProLabel><p className="mt-1 text-[20px] font-light tracking-[-.03em]">{value}</p></div>)}
        </div>
      </div>
      <div className="mt-5 flex items-center gap-5 border-t border-[var(--color-border-subtle)] pt-3 text-[10px] text-muted-foreground"><span className="flex items-center gap-2 text-foreground"><StatusDot /> Library current</span><span className="font-mono">{HERO.usb}</span><span>{HERO.lastImport}</span><span className="ml-auto">{HERO.analyzed}/{HERO.tracks} analyzed</span><ProButton><Upload size={12} /> Import</ProButton></div>
    </div>
  );
}

function HeroSwissIndex() {
  return (
    <div className="grid min-h-[170px] overflow-hidden border border-[var(--color-border-subtle)] lg:grid-cols-[52px_1.5fr_1fr]" style={{ background: PRO.surface }}>
      <div className="flex items-center justify-center border-b border-[var(--color-border-subtle)] bg-[var(--color-panel)] lg:border-b-0 lg:border-r"><span className="font-mono text-[9px] tracking-[.2em] text-muted-foreground [writing-mode:vertical-rl]">DROPDEX / LIBRARY</span></div>
      <div className="flex flex-col justify-between p-5">
        <div className="flex items-center justify-between"><span className="font-mono text-[9px] text-muted-foreground">PROFILE—001</span><Socials size={12} className="gap-2" /></div>
        <h2 className="text-[clamp(34px,6vw,72px)] font-semibold leading-[.78] tracking-[-.075em]">{HERO.name}</h2>
        <div className="flex gap-5 text-[10px] text-muted-foreground"><span>{HERO.tracks} TRACKS</span><span>{HERO.playlists} PLAYLISTS</span><span>{HERO.progress}% ANALYZED</span></div>
      </div>
      <div className="grid grid-cols-2 border-t border-[var(--color-border-subtle)] lg:border-l lg:border-t-0">
        {[['TEMPO', `${HERO.bpm}\nBPM`], ['KEY', HERO.key], ['GENRE', HERO.genre], ['SOURCE', HERO.usb]].map(([label, value], index) => <div key={label} className={cn('flex flex-col justify-between p-4', index % 2 === 1 && 'border-l border-[var(--color-border-subtle)]', index > 1 && 'border-t border-[var(--color-border-subtle)]')}><ProLabel>{label}</ProLabel><span className="whitespace-pre-line text-[17px] font-medium leading-tight">{value}</span></div>)}
      </div>
    </div>
  );
}

function HeroQuietRegister() {
  return (
    <div className="px-4 py-8 text-center">
      <div className="mx-auto flex max-w-[820px] items-center gap-4"><span className="h-px flex-1 bg-[var(--color-border-subtle)]" /><ProLabel>Artist library</ProLabel><span className="h-px flex-1 bg-[var(--color-border-subtle)]" /></div>
      <h2 className="mt-5 text-[48px] font-light leading-none tracking-[-.045em]">{HERO.name}</h2>
      <div className="mt-4 flex items-center justify-center gap-4 text-[11px] text-muted-foreground"><Socials size={13} className="gap-2.5" /><span className="h-3 w-px bg-[var(--color-border-subtle)]" /><span>{HERO.tracks} tracks</span><span>{HERO.playlists} playlists</span></div>
      <div className="mx-auto mt-7 grid max-w-[820px] grid-cols-3 border-y border-[var(--color-border-subtle)] py-4">
        {[['Tempo', `${HERO.bpm} BPM`], ['Key', HERO.key], ['Genre', HERO.genre]].map(([label, value], index) => <div key={label} className={cn(index > 0 && 'border-l border-[var(--color-border-subtle)]')}><ProLabel>{label}</ProLabel><p className="mt-2 text-[22px] font-light">{value}</p></div>)}
      </div>
      <div className="mx-auto mt-4 flex max-w-[820px] items-center justify-center gap-4 text-[10px] text-muted-foreground"><span className="flex items-center gap-2 text-foreground"><StatusDot /> Analysis complete</span><span>{HERO.analyzed} of {HERO.tracks}</span><span>Imported {HERO.lastImport}</span><ProButton><Upload size={12} /> Import</ProButton></div>
    </div>
  );
}

function HeroSplitLedger() {
  return (
    <div className="grid overflow-hidden border-y border-[var(--color-border-subtle)] lg:grid-cols-[.9fr_1.35fr]">
      <div className="flex min-h-[190px] flex-col justify-between border-b border-[var(--color-border-subtle)] py-5 pr-7 lg:border-b-0 lg:border-r">
        <div className="flex items-start justify-between"><ProLabel>Collection owner</ProLabel><span className="font-mono text-[9px] text-muted-foreground">{HERO.initials}—26</span></div>
        <div><h2 className="text-[44px] font-medium leading-none tracking-[-.055em]">{HERO.name}</h2><div className="mt-3 flex items-center gap-3"><Socials size={13} className="gap-2.5" /><span className="text-[10px] text-muted-foreground">{HERO.tracks} tracks · {HERO.playlists} playlists</span></div></div>
        <p className="font-mono text-[9px] text-muted-foreground">SOURCE {HERO.usb} / {HERO.lastImport}</p>
      </div>
      <div className="grid grid-rows-[1fr_auto] pl-0 lg:pl-7">
        <div className="grid grid-cols-3 divide-x divide-[var(--color-border-subtle)] border-b border-[var(--color-border-subtle)]">{[['MAIN BPM', HERO.bpm], ['MAIN KEY', HERO.key], ['MAIN GENRE', HERO.genre]].map(([label, value]) => <div key={label} className="flex flex-col justify-between px-5 py-5 first:pl-0"><ProLabel>{label}</ProLabel><p className="text-[32px] font-light tracking-[-.04em]">{value}</p></div>)}</div>
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
        <div className="grid min-w-[330px] grid-cols-3 border-l border-[var(--color-border-subtle)]">{[['BPM', HERO.bpm], ['KEY', HERO.key], ['GENRE', HERO.genre]].map(([label, value]) => <div key={label} className="flex flex-col justify-between border-r border-[var(--color-border-subtle)] px-4 last:border-r-0"><ProLabel>{label}</ProLabel><span className="text-[21px] font-light">{value}</span></div>)}</div>
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
          Nine hero directions using the same information as the artist library hero: profile, socials, USB import, track analysis and the main BPM, key and genre.
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
