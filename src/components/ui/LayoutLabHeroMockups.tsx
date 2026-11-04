import type { CSSProperties, ReactNode } from 'react';
import { Calendar, CheckmarkFilled, Upload, Usb } from '@carbon/icons-react';
import { cn } from '../../lib/utils';
import { CamelotWheel } from '../library/InsightCharts';
import { GENRE_RANK_COLORS, camelotColor } from '../library/libraryInsights';
import { Socials } from './LayoutLabHeroParts';
import { HERO, SAMPLE_BPM, SAMPLE_GENRES, SAMPLE_KEYS } from './layoutLabHeroSample';

// Ten hero directions. Every one is 218px tall (the production hero's height), shows the same information (profile, socials,
// USB import, analysis, top genres, BPM distribution and a Camelot wheel big enough to read every key) and keeps each group
// only as wide as its content needs.

const NAMED_GENRES = SAMPLE_GENRES.filter(([name]) => name !== 'Other').slice(0, 5);
const GENRE_TOTAL = SAMPLE_GENRES.reduce((sum, [, n]) => sum + n, 0);
const BPM_MAX = Math.max(...SAMPLE_BPM.map(([, n]) => n));
const BPM_TOTAL = SAMPLE_BPM.reduce((sum, [, n]) => sum + n, 0);
const BPM_PEAK = SAMPLE_BPM.find(([, n]) => n === BPM_MAX)!;
const BPM_PEAK_PCT = Math.round((BPM_PEAK[1] / BPM_TOTAL) * 100);
const KEY_TOTAL = SAMPLE_KEYS.reduce((sum, [, n]) => sum + n, 0);
const PEAK_RED = '#f43f5e';

// Textures, as CSS backgrounds.
const DOTS = 'radial-gradient(rgba(255,255,255,0.075) 1px, transparent 1px) 0 0 / 14px 14px';
const HATCH = 'repeating-linear-gradient(135deg, rgba(255,255,255,0.028) 0 1px, transparent 1px 7px)';
const RULES = 'repeating-linear-gradient(0deg, rgba(255,255,255,0.045) 0 1px, transparent 1px 24px)';
const GRAPH = 'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px) 0 0 / 20px 20px, linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px) 0 0 / 20px 20px';
const RINGS = 'repeating-radial-gradient(circle at 50% 50%, rgba(255,255,255,0.055) 0 1px, transparent 1px 24px)';
const GRAIN = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .55 0'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='.6'/></svg>")`;

const MONO = "'SF Mono','Menlo','Monaco',monospace";

// ── Shared pieces ────────────────────────────────────────────────────────────

function HeroFrame({ className, style, children }: { className?: string; style?: CSSProperties; children: ReactNode }) {
  return <div className={cn('relative h-[218px] overflow-hidden', className)} style={style}>{children}</div>;
}

function Texture({ background, opacity = 1, blend }: { background: string; opacity?: number; blend?: CSSProperties['mixBlendMode'] }) {
  return <div className="pointer-events-none absolute inset-0" style={{ background, opacity, mixBlendMode: blend }} />;
}

function Eyebrow({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <p className={cn('text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground', className)} style={style}>{children}</p>;
}

/** A titled group: only as wide as its content (`width`), never stretched. */
function Group({ title, width, children, className, titleClassName }: { title?: string; width?: number; children: ReactNode; className?: string; titleClassName?: string }) {
  return (
    <div className={cn('flex shrink-0 flex-col justify-center', className)} style={width ? { width } : undefined}>
      {title && <Eyebrow className={cn('mb-2.5', titleClassName)}>{title}</Eyebrow>}
      {children}
    </div>
  );
}

/** Top genres: name and share, with a thin coloured bar. Coloured by rank, as in the production hero. */
function GenreList({ width = 150, rows = 5, mono = false }: { width?: number; rows?: number; mono?: boolean }) {
  return (
    <div className="space-y-[9px]" style={{ width }}>
      {NAMED_GENRES.slice(0, rows).map(([name, n], i) => {
        const pct = Math.round((n / GENRE_TOTAL) * 100);
        const color = mono ? (i === 0 ? '#ffffff' : '#8b929b') : GENRE_RANK_COLORS[i];
        return (
          <div key={name}>
            <div className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="truncate font-semibold" style={{ color, fontFamily: mono ? MONO : undefined }}>{name}</span>
              <span className="font-mono font-black tabular-nums">{pct}%</span>
            </div>
            <div className="mt-[3px] h-[3px] w-full rounded-full bg-white/[0.07]">
              <div className="h-full rounded-full" style={{ width: `${(n / NAMED_GENRES[0][1]) * 100}%`, background: color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** BPM distribution: a bar for each 20-BPM range with the busiest range picked out. */
function BpmChart({ width = 168, height = 92, mono = false }: { width?: number; height?: number; mono?: boolean }) {
  return (
    <div style={{ width }}>
      <p className={cn('whitespace-nowrap text-[17px] font-black leading-none tabular-nums', mono && 'font-semibold')} style={{ color: mono ? '#ffffff' : PEAK_RED, fontFamily: mono ? MONO : undefined }}>
        {BPM_PEAK[0]} <span className="text-[10px] font-semibold text-muted-foreground">BPM</span> · {BPM_PEAK_PCT}%
      </p>
      <div className="mt-3 flex items-end gap-[5px]" style={{ height }}>
        {SAMPLE_BPM.map(([range, n]) => (
          <div key={range} className="flex-1 rounded-[3px]" style={{ height: `${Math.max(6, (n / BPM_MAX) * 100)}%`, background: n === BPM_MAX ? (mono ? '#ffffff' : PEAK_RED) : mono ? '#4b5058' : '#243447' }} />
        ))}
      </div>
      <div className="mt-1.5 flex gap-[5px] border-t border-white/[0.07] pt-1.5 text-[9px] tabular-nums text-muted-foreground">
        {SAMPLE_BPM.map(([range]) => <span key={range} className="flex-1 text-center">{range.split('–')[0]}</span>)}
      </div>
    </div>
  );
}

/** The Camelot wheel, sized so every key name inside a section can be read (9px or larger), with an optional key list. */
function Wheel({ size = 162, keys = 0, className }: { size?: number; keys?: number; className?: string }) {
  return (
    <div className={cn('flex shrink-0 items-center gap-3', className)}>
      <div className="shrink-0" style={{ width: size }}><CamelotWheel keyStats={SAMPLE_KEYS} labelSize={9} idleLabelColor="#8fa6bf" /></div>
      {keys > 0 && (
        <div className="space-y-1.5">
          {SAMPLE_KEYS.slice(0, keys).map(([key, n]) => (
            <div key={key} className="flex items-baseline gap-2 text-[11px] tabular-nums">
              <span className="w-7 font-black" style={{ color: camelotColor(key) }}>{key}</span>
              <span className="font-mono font-bold">{Math.round((n / KEY_TOTAL) * 100)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Avatar({ size = 64, ring = true }: { size?: number; ring?: boolean }) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {ring && <div className="pointer-events-none absolute inset-[-4px] rounded-full border-2 border-primary" />}
      <div className="flex h-full w-full items-center justify-center rounded-full border border-primary/30 bg-gradient-to-br from-primary/40 to-primary/5" style={{ fontSize: size * 0.3 }}>
        <span className="font-black text-primary">{HERO.initials}</span>
      </div>
      <span className="absolute rounded-full border-2 border-[var(--color-background)] bg-emerald-500" style={{ width: 12, height: 12, right: 0, bottom: 2 }} />
    </div>
  );
}

function ImportButton({ className }: { className?: string }) {
  return (
    <button type="button" className={cn('inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-blue-500 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-blue-400 transition-colors hover:bg-blue-500/10', className)}>
      <Upload size={11} /> Import Library
    </button>
  );
}

function Done({ label }: { label: string }) {
  return <span className="flex items-center gap-1.5 whitespace-nowrap text-[13px] font-black leading-none text-emerald-500"><CheckmarkFilled size={13} /> {label}</span>;
}

function ProgressBar() {
  return <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]"><div className="h-full w-full rounded-full bg-emerald-500" /></div>;
}

/** USB import and track analysis as two compact cards. */
function StatusCards({ width = 176, className }: { width?: number; className?: string }) {
  return (
    <div className={cn('flex shrink-0 flex-col justify-center gap-2.5', className)} style={{ width }}>
      <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
        <Eyebrow className="mb-1.5">USB Import</Eyebrow>
        <Done label="Import Complete" />
        <p className="mt-1.5 flex items-center gap-1.5 whitespace-nowrap font-mono text-[10px] text-muted-foreground"><Usb size={11} /> {HERO.usb} · {HERO.lastImport.replace(', 2026', '')}</p>
        <ImportButton className="mt-2 w-full" />
      </div>
      <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
        <Eyebrow className="mb-1.5">Track Analysis</Eyebrow>
        <Done label="Analysis Complete" />
        <div className="mt-2 flex items-center gap-2"><ProgressBar /><span className="font-mono text-[10px] text-muted-foreground">{HERO.analyzed}/{HERO.tracks}</span></div>
      </div>
    </div>
  );
}

/** The same two statuses as plain lines, for the mockups without cards. */
function StatusLines({ className, stacked = false }: { className?: string; stacked?: boolean }) {
  const row = stacked ? 'flex flex-col gap-1' : 'flex items-center gap-2';
  return (
    <div className={cn('space-y-1.5 text-[11px]', className)}>
      <div className={row}><Done label="Import Complete" /><span className="font-mono text-[10px] text-muted-foreground">{HERO.usb} · {HERO.lastImport.replace(', 2026', '')}</span></div>
      <div className={row}><Done label="Analysis Complete" /><span className="font-mono text-[10px] text-muted-foreground">{HERO.analyzed}/{HERO.tracks} tracks</span></div>
    </div>
  );
}

// ── 1. Spotlight Banner ──────────────────────────────────────────────────────
// A blue-lit banner with a faint dot grid. Everything sits in one row, left to right, in the order you read it.

function HeroSpotlight() {
  return (
    <HeroFrame className="rounded-2xl border border-[var(--color-border-subtle)] bg-[linear-gradient(105deg,rgba(2,12,25,0.98)_0%,rgba(3,25,52,0.95)_50%,rgba(2,11,24,0.98)_100%)]">
      <Texture background="radial-gradient(circle at 16% 30%, rgba(16,103,220,0.4), transparent 38%), radial-gradient(circle at 84% 70%, rgba(24,94,190,0.2), transparent 32%)" />
      <Texture background={DOTS} />
      <div className="relative flex h-full items-center gap-5 px-6">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <Avatar size={68} />
          <div>
            <h2 className="text-[28px] font-black uppercase leading-none tracking-tight">{HERO.name}</h2>
            <p className="mt-1.5 whitespace-nowrap text-[11px] font-semibold text-muted-foreground">{HERO.tracks} tracks · {HERO.playlists} playlists</p>
            <Socials size={14} className="mt-2.5" />
          </div>
        </div>
        <StatusCards width={176} />
        <Group title="Top Genres"><GenreList /></Group>
        <Group title="BPM Distribution"><BpmChart /></Group>
        <Group title="Camelot Wheel"><Wheel /></Group>
      </div>
    </HeroFrame>
  );
}

// ── 2. Bento Grid ────────────────────────────────────────────────────────────
// Separate glass tiles on a dark grid; each tile is sized to what it holds, with a colour edge on the chart tiles.

function BentoTile({ children, accent, className, style }: { children: ReactNode; accent?: string; className?: string; style?: CSSProperties }) {
  return (
    <div className={cn('relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]', className)} style={style}>
      {accent && <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: accent }} />}
      {children}
    </div>
  );
}

function HeroBento() {
  return (
    <HeroFrame className="w-fit max-w-full rounded-2xl bg-[#080b10]">
      <Texture background={GRAPH} opacity={0.6} />
      <div className="relative flex h-full items-stretch gap-3 p-3">
        <BentoTile className="flex w-[150px] shrink-0 flex-col items-center justify-center px-3 text-center">
          <Avatar size={56} />
          <h2 className="mt-3 text-[19px] font-black uppercase leading-none tracking-tight">{HERO.name}</h2>
          <Socials size={13} className="mt-2 justify-center" />
          <ImportButton className="mt-3 w-full" />
        </BentoTile>
        <BentoTile className="flex w-[176px] shrink-0 flex-col justify-center gap-3 px-3.5">
          <div><Eyebrow className="mb-1.5">USB Import</Eyebrow><Done label="Import Complete" />
            <p className="mt-1.5 flex items-center gap-1.5 whitespace-nowrap font-mono text-[10px] text-muted-foreground"><Calendar size={11} /> {HERO.lastImport}</p></div>
          <div className="border-t border-white/10 pt-3"><Eyebrow className="mb-1.5">Track Analysis</Eyebrow><Done label="Analysis Complete" />
            <div className="mt-2 flex items-center gap-2"><ProgressBar /><span className="font-mono text-[10px] text-muted-foreground">{HERO.analyzed}/{HERO.tracks}</span></div></div>
        </BentoTile>
        <BentoTile accent={GENRE_RANK_COLORS[0]} className="flex shrink-0 flex-col justify-center px-4"><Eyebrow className="mb-2.5">Top Genres</Eyebrow><GenreList /></BentoTile>
        <BentoTile accent={PEAK_RED} className="flex shrink-0 flex-col justify-center px-4"><Eyebrow className="mb-2.5">BPM Distribution</Eyebrow><BpmChart /></BentoTile>
        <BentoTile accent="#a855f7" className="flex shrink-0 flex-col items-center justify-center px-2.5 pb-2 pt-3"><Eyebrow className="mb-1.5 self-start pl-1.5">Camelot Wheel</Eyebrow><Wheel /></BentoTile>
      </div>
    </HeroFrame>
  );
}

// ── 3. Editorial Cover ───────────────────────────────────────────────────────
// The wheel is the cover art, framed on the left. A big uppercase name, hatched paper texture, two charts to the right.

function HeroEditorial() {
  return (
    <HeroFrame className="rounded-2xl border border-[var(--color-border-subtle)] bg-[#050b16]">
      <Texture background={HATCH} />
      <div className="absolute -left-16 -top-24 h-72 w-72 rounded-full bg-primary/25 blur-3xl pointer-events-none" />
      <div className="relative flex h-full items-center gap-6 pr-7">
        <div className="flex h-full shrink-0 items-center border-r border-white/10 bg-black/25 px-4"><Wheel size={186} /></div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Eyebrow>Artist Library</Eyebrow>
          <h2 className="text-[52px] font-black uppercase leading-[0.88] tracking-[-0.04em]">{HERO.name}</h2>
          <div className="flex items-center gap-4 text-[11px] font-semibold text-muted-foreground"><span>{HERO.tracks} tracks</span><span>{HERO.playlists} playlists</span><Socials size={14} /></div>
          <StatusLines />
        </div>
        <Group title="Top Genres"><GenreList /></Group>
        <Group title="BPM Distribution"><BpmChart /></Group>
      </div>
    </HeroFrame>
  );
}

// ── 4. Typographic Header ────────────────────────────────────────────────────
// No box at all: just type, hairlines and one closing rule. The wheel closes the row on the right.

function HeroTypographic() {
  return (
    <HeroFrame className="border-b border-[var(--color-border-subtle)]">
      <div className="flex h-full items-center gap-6 pb-5">
        <div className="min-w-0 flex-1">
          <p className="mb-3 flex items-center gap-2 text-[11px] text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Library up to date · {HERO.usb} · {HERO.lastImport}</p>
          <h2 className="text-[46px] font-light leading-none tracking-[-0.025em]">{HERO.name}</h2>
          <div className="mt-3 flex items-center gap-4 text-[12px] text-muted-foreground"><span>{HERO.tracks} tracks</span><span>{HERO.playlists} playlists</span><span>{HERO.analyzed} analyzed</span><Socials size={13} className="gap-2.5" /></div>
          <ImportButton className="mt-4" />
        </div>
        <div className="flex shrink-0 items-center gap-8">
          <Group title="Top Genres" className="border-l border-[var(--color-border-subtle)] pl-6"><GenreList /></Group>
          <Group title="BPM Distribution" className="border-l border-[var(--color-border-subtle)] pl-6"><BpmChart /></Group>
          <Group title="Camelot Wheel" className="border-l border-[var(--color-border-subtle)] pl-6"><Wheel /></Group>
        </div>
      </div>
    </HeroFrame>
  );
}

// ── 5. Gallery Plates ────────────────────────────────────────────────────────
// Numbered plates on a grained dark mount, like a catalogue spread. Each plate is one thing.

function Plate({ n, title, children, className }: { n: string; title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('relative flex flex-col rounded-lg border border-white/12 bg-[#0d1117]/90 p-3', className)}>
      <div className="mb-2 flex items-baseline justify-between"><Eyebrow>{title}</Eyebrow><span className="font-mono text-[9px] text-muted-foreground/60">{n}</span></div>
      <div className="flex flex-1 items-center justify-center">{children}</div>
    </div>
  );
}

function HeroPlates() {
  return (
    <HeroFrame className="w-fit max-w-full rounded-2xl bg-[#07090d]">
      <Texture background={GRAIN} opacity={0.12} blend="screen" />
      <div className="relative flex h-full items-stretch gap-2.5 p-3">
        <Plate n="01" title="Profile" className="w-[160px] shrink-0">
          <div className="flex flex-col items-center text-center"><Avatar size={50} /><h2 className="mt-2.5 text-[17px] font-black uppercase tracking-tight">{HERO.name}</h2><p className="mt-1 text-[10px] text-muted-foreground">{HERO.tracks} tracks · {HERO.playlists} playlists</p><Socials size={13} className="mt-2" /></div>
        </Plate>
        <Plate n="02" title="Status" className="w-[168px] shrink-0"><StatusLines stacked className="space-y-3.5" /></Plate>
        <Plate n="03" title="Top Genres" className="w-[172px] shrink-0"><GenreList width={146} /></Plate>
        <Plate n="04" title="BPM Distribution" className="w-[192px] shrink-0"><BpmChart width={166} /></Plate>
        <Plate n="05" title="Camelot Wheel" className="w-[186px] shrink-0"><Wheel size={162} /></Plate>
      </div>
    </HeroFrame>
  );
}

// ── 6. Swiss Index ───────────────────────────────────────────────────────────
// A strict grid with hairline cells, mono labels and a vertical index rail. The wheel cell gets graph paper.

function IndexCell({ label, children, className, style }: { label: string; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={cn('flex min-w-0 flex-col justify-between border-r border-white/[0.09] p-3.5 last:border-r-0', className)} style={style}>
      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function HeroSwiss() {
  return (
    <HeroFrame className="w-fit max-w-full border border-white/[0.12] bg-[var(--color-panel)]">
      <div className="flex h-full">
        <div className="flex w-[38px] shrink-0 items-center justify-center border-r border-white/[0.09] bg-black/30"><span className="font-mono text-[9px] tracking-[0.26em] text-muted-foreground [writing-mode:vertical-rl]">DROPDEX / LIBRARY</span></div>
        <IndexCell label="Profile" className="w-[190px] shrink-0">
          <h2 className="text-[34px] font-semibold leading-[0.9] tracking-[-0.05em]">{HERO.name}</h2>
          <p className="mt-2 font-mono text-[10px] text-muted-foreground">{HERO.tracks} TRACKS · {HERO.playlists} PLAYLISTS</p>
          <Socials size={13} className="mt-3 gap-2.5" />
        </IndexCell>
        <IndexCell label="Source / Analysis" className="w-[176px] shrink-0">
          <StatusLines stacked className="space-y-2.5" />
          <ImportButton className="mt-3 w-full rounded-none" />
        </IndexCell>
        <IndexCell label="Genres" className="w-[176px] shrink-0"><GenreList width={146} /></IndexCell>
        <IndexCell label="Tempo" className="w-[192px] shrink-0"><BpmChart width={164} height={82} /></IndexCell>
        <IndexCell label="Key wheel" className="w-[190px] shrink-0" style={{ background: GRAPH }}><Wheel size={162} /></IndexCell>
      </div>
    </HeroFrame>
  );
}

// ── 7. Radial Hub ────────────────────────────────────────────────────────────
// The wheel sits in the middle on faint concentric rings. Who and what on its left, the two charts on its right.

function HeroHub() {
  return (
    <HeroFrame className="rounded-2xl border border-[var(--color-border-subtle)] bg-[#070d17]">
      <div className="absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2" style={{ background: RINGS, borderRadius: '50%', maskImage: 'radial-gradient(circle, #000 30%, transparent 70%)', WebkitMaskImage: 'radial-gradient(circle, #000 30%, transparent 70%)' }} />
      <div className="relative flex h-full items-center gap-6 px-6">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center gap-3"><Avatar size={52} /><div><h2 className="text-[22px] font-black uppercase leading-none tracking-tight">{HERO.name}</h2><p className="mt-1 text-[10px] text-muted-foreground">{HERO.tracks} tracks · {HERO.playlists} playlists</p></div></div>
          <StatusLines />
          <div className="flex items-center gap-4"><ImportButton /><Socials size={13} className="gap-2.5" /></div>
        </div>
        <Wheel size={188} />
        <Group title="Top Genres"><GenreList /></Group>
        <Group title="BPM Distribution"><BpmChart /></Group>
      </div>
    </HeroFrame>
  );
}

// ── 8. Split Ledger ──────────────────────────────────────────────────────────
// Two halves: a lighter identity panel, and a ruled ledger sheet of readings on the right.

function HeroLedger() {
  return (
    <HeroFrame className="grid w-fit max-w-full grid-cols-[330px_auto] rounded-2xl border border-[var(--color-border-subtle)]">
      <div className="relative flex flex-col justify-between border-r border-white/10 bg-[#101722] p-5">
        <Texture background={RULES} />
        <div className="relative flex items-center justify-between"><Eyebrow>Collection owner</Eyebrow><span className="font-mono text-[9px] text-muted-foreground">{HERO.initials}—26</span></div>
        <div className="relative"><h2 className="text-[40px] font-semibold leading-none tracking-[-0.04em]">{HERO.name}</h2>
          <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground"><span>{HERO.tracks} tracks · {HERO.playlists} playlists</span><Socials size={13} className="gap-2.5" /></div></div>
        <div className="relative flex flex-col items-start gap-2.5"><StatusLines /><ImportButton /></div>
      </div>
      <div className="relative flex items-center gap-8 bg-[#080c13] px-6">
        <Texture background={RULES} opacity={0.6} />
        <Group title="Top Genres" className="relative"><GenreList /></Group>
        <Group title="BPM Distribution" className="relative"><BpmChart /></Group>
        <Group title="Camelot Wheel" className="relative"><Wheel /></Group>
      </div>
    </HeroFrame>
  );
}

// ── 9. Studio Monograph ──────────────────────────────────────────────────────
// A catalogue-number layout in mono type on a grained surface, with a big index figure on the left rail.

function HeroMonograph() {
  return (
    <HeroFrame className="border border-white/[0.12] bg-[#0b0e13]">
      <Texture background={GRAIN} opacity={0.1} blend="screen" />
      <div className="relative flex h-full items-center gap-5 px-5">
        <div className="flex h-[176px] shrink-0 flex-col justify-between border-r border-white/10 pr-5" style={{ fontFamily: MONO }}>
          <span className="text-[9px] tracking-[0.22em] text-muted-foreground">CATALOG</span>
          <span className="text-[44px] font-light leading-none tabular-nums">0{HERO.tracks}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="mb-2 flex items-center gap-2 text-[10px] text-muted-foreground" style={{ fontFamily: MONO }}><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> SYNCED {HERO.lastImport.toUpperCase()}</p>
          <h2 className="text-[40px] font-medium leading-none tracking-[-0.05em]">{HERO.name}</h2>
          <div className="mt-3 flex items-center gap-4 text-[10px] text-muted-foreground" style={{ fontFamily: MONO }}><span>{HERO.playlists} PLAYLISTS</span><span>{HERO.analyzed} ANALYZED</span><Socials size={13} className="gap-2.5" /></div>
          <div className="mt-4 flex items-center gap-3"><ImportButton /><span className="text-[10px] text-muted-foreground" style={{ fontFamily: MONO }}>USB / {HERO.usb}</span></div>
        </div>
        <Group title="Genres" className="border-l border-white/10 pl-5"><GenreList width={146} /></Group>
        <Group title="BPM" className="border-l border-white/10 pl-5"><BpmChart /></Group>
        <Group title="Camelot" className="border-l border-white/10 pl-5"><Wheel /></Group>
      </div>
    </HeroFrame>
  );
}

// ── 10. Instrument Panel ─────────────────────────────────────────────────────
// Grey hardware: mono readouts, an LED-segment genre meter and stepped tempo columns, with the wheel as the main dial.

function LedGenres() {
  return (
    <div className="space-y-2.5" style={{ width: 150, fontFamily: MONO }}>
      {NAMED_GENRES.map(([name, n], i) => {
        const lit = Math.max(1, Math.round((n / NAMED_GENRES[0][1]) * 12));
        return (
          <div key={name}>
            <div className="flex justify-between text-[10px] uppercase" style={{ color: i === 0 ? '#fff' : '#8b929b' }}><span className="truncate">{name}</span><span className="tabular-nums">{Math.round((n / GENRE_TOTAL) * 100)}</span></div>
            <div className="mt-[3px] flex gap-[2px]">{Array.from({ length: 12 }, (_, s) => <div key={s} className="h-[4px] flex-1" style={{ background: s < lit ? (i === 0 ? '#fff' : '#9aa1aa') : 'rgba(255,255,255,0.09)' }} />)}</div>
          </div>
        );
      })}
    </div>
  );
}

function LedTempo() {
  return (
    <div style={{ width: 168, fontFamily: MONO }}>
      <p className="whitespace-nowrap text-[15px] font-medium tabular-nums leading-none">{BPM_PEAK[0]} <span className="text-[9px] text-muted-foreground">BPM</span> {BPM_PEAK_PCT}%</p>
      <div className="mt-3 flex items-end gap-[5px]" style={{ height: 88 }}>
        {SAMPLE_BPM.map(([range, n]) => (
          <div key={range} className="flex flex-1 flex-col-reverse gap-[2px]">
            {Array.from({ length: Math.max(1, Math.round((n / BPM_MAX) * 9)) }, (_, i) => <div key={i} className="h-[6px]" style={{ background: n === BPM_MAX ? '#fff' : '#555b64' }} />)}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[5px] text-[9px] tabular-nums text-muted-foreground">{SAMPLE_BPM.map(([range]) => <span key={range} className="flex-1 text-center">{range.split('–')[0]}</span>)}</div>
    </div>
  );
}

function HeroInstrument() {
  const readouts: [string, string][] = [['TRK', String(HERO.tracks).padStart(3, '0')], ['PLY', String(HERO.playlists).padStart(2, '0')], ['ANL', `${HERO.progress}%`]];
  return (
    <HeroFrame className="rounded-xl border border-[#3a3e45] bg-[linear-gradient(160deg,#23262b,#121417)]">
      <Texture background="repeating-linear-gradient(90deg, rgba(255,255,255,0.02) 0 1px, transparent 1px 3px)" />
      <div className="relative flex h-full items-center gap-5 px-5">
        <div className="flex h-[176px] min-w-0 flex-1 flex-col justify-between" style={{ fontFamily: MONO }}>
          <div className="flex items-center justify-between gap-6 text-[9px] uppercase tracking-[0.24em] text-muted-foreground"><span>Library / 01</span><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Synced</span></div>
          <h2 className="text-[36px] font-semibold uppercase leading-none tracking-[0.08em]">{HERO.name}</h2>
          <div className="flex gap-5">{readouts.map(([k, v]) => <div key={k}><div className="text-[8px] tracking-[0.22em] text-muted-foreground">{k}</div><div className="text-[18px] leading-tight tabular-nums">{v}</div></div>)}</div>
          <div className="flex items-center gap-3"><ImportButton className="rounded-md" /><Socials size={13} className="gap-2.5" /></div>
        </div>
        <Group title="Genres" className="border-l border-white/10 pl-5"><LedGenres /></Group>
        <Group title="Tempo" className="border-l border-white/10 pl-5"><LedTempo /></Group>
        <Group title="Key dial" className="border-l border-white/10 pl-5"><Wheel /></Group>
      </div>
    </HeroFrame>
  );
}

// ── Tab content ──────────────────────────────────────────────────────────────

function HeroMockupCard({ n, title, concept, children }: { n: number; title: string; concept: string; children: ReactNode }) {
  return (
    <section className="mb-12">
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/15 text-[11px] font-extrabold text-primary">{n}</div>
        <span className="text-[13px] font-bold text-foreground">{title}</span>
        <span className="text-[11px] text-muted-foreground">{concept}</span>
      </div>
      {children}
    </section>
  );
}

export function HeroMockupsContent() {
  return (
    <div className="h-full overflow-y-auto bg-[var(--color-background)] px-8 pb-12 pt-7">
      <div className="mb-7">
        <div className="mb-1 text-sm font-extrabold text-foreground">Library Hero Concepts</div>
        <div className="text-[11px] leading-relaxed text-muted-foreground">
          Ten hero directions, all 218px tall like the production hero. Each shows the profile, socials, USB import, track analysis, top genres, BPM distribution and a Camelot wheel big enough to read every key.
        </div>
      </div>
      <HeroMockupCard n={1} title="Spotlight Banner" concept="One blue-lit banner, a faint dot grid, everything in reading order"><HeroSpotlight /></HeroMockupCard>
      <HeroMockupCard n={2} title="Bento Grid" concept="Separate glass tiles on graph paper, each sized to its content"><HeroBento /></HeroMockupCard>
      <HeroMockupCard n={3} title="Editorial Cover" concept="The wheel framed as cover art, a big name, hatched texture"><HeroEditorial /></HeroMockupCard>
      <HeroMockupCard n={4} title="Typographic Header" concept="No box: light type, hairline dividers, one closing rule"><HeroTypographic /></HeroMockupCard>
      <HeroMockupCard n={5} title="Gallery Plates" concept="Numbered plates on a grained mount, one subject per plate"><HeroPlates /></HeroMockupCard>
      <HeroMockupCard n={6} title="Swiss Index" concept="A strict hairline grid with mono labels and graph paper behind the wheel"><HeroSwiss /></HeroMockupCard>
      <HeroMockupCard n={7} title="Radial Hub" concept="The wheel in the middle on faint rings, people left, charts right"><HeroHub /></HeroMockupCard>
      <HeroMockupCard n={8} title="Split Ledger" concept="A lighter identity panel beside a ruled sheet of readings"><HeroLedger /></HeroMockupCard>
      <HeroMockupCard n={9} title="Studio Monograph" concept="A catalogue-number layout in mono type on a grained surface"><HeroMonograph /></HeroMockupCard>
      <HeroMockupCard n={10} title="Instrument Panel" concept="Grey hardware: mono readouts, LED meters, the wheel as the main dial"><HeroInstrument /></HeroMockupCard>
    </div>
  );
}
