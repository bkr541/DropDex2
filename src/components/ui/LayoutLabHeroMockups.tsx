import type { CSSProperties, ReactNode } from 'react';
import { CheckmarkFilled, Upload, Usb } from '@carbon/icons-react';
import { cn } from '../../lib/utils';
import { ControlButton } from './controls/ControlButton';
import { Socials } from './LayoutLabHeroParts';
import { HERO } from './layoutLabHeroSample';

// Five hero directions. Every one is 218px tall (the production hero's height) and shows only who the artist is and what is in
// their library: profile, socials, USB import and the library counts. There is no track analysis and none of the insight
// groups (top genres, BPM distribution, Camelot key wheel).

// Textures, as CSS backgrounds.
const DOTS = 'radial-gradient(rgba(255,255,255,0.075) 1px, transparent 1px) 0 0 / 14px 14px';
const HATCH = 'repeating-linear-gradient(135deg, rgba(255,255,255,0.03) 0 1px, transparent 1px 7px)';
const RULES = 'repeating-linear-gradient(0deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 24px)';

const LAST_IMPORT = HERO.lastImport.replace(', 2026', '');

// ── Shared pieces ────────────────────────────────────────────────────────────

function HeroFrame({ className, style, children }: { className?: string; style?: CSSProperties; children: ReactNode }) {
  return <div className={cn('relative h-[218px] overflow-hidden', className)} style={style}>{children}</div>;
}

function Texture({ background, opacity = 1 }: { background: string; opacity?: number }) {
  return <div className="pointer-events-none absolute inset-0" style={{ background, opacity }} />;
}

function Eyebrow({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <p className={cn('text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground', className)} style={style}>{children}</p>;
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

/** The one shared primary button, so the mockups match the app. */
function ImportButton({ className }: { className?: string }) {
  return <ControlButton variant="primary" className={cn('!min-h-8 whitespace-nowrap text-[11px]', className)}><Upload size={12} /> Import Library</ControlButton>;
}

function Done({ label }: { label: string }) {
  return <span className="flex items-center gap-1.5 whitespace-nowrap text-[13px] font-black leading-none text-emerald-500"><CheckmarkFilled size={13} /> {label}</span>;
}

function UsbLine({ className }: { className?: string }) {
  return <p className={cn('flex items-center gap-1.5 whitespace-nowrap font-mono text-[10px] text-muted-foreground', className)}><Usb size={11} /> {HERO.usb} · {LAST_IMPORT}</p>;
}

/** A figure over a small label. */
function Stat({ value, label, className, valueClassName }: { value: ReactNode; label: string; className?: string; valueClassName?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className={cn('truncate text-[26px] font-black leading-none tabular-nums', valueClassName)}>{value}</p>
      <Eyebrow className="mt-1.5">{label}</Eyebrow>
    </div>
  );
}

// ── 1. Aurora Banner ─────────────────────────────────────────────────────────
// A wide banner lit from the corners. The artist on the left, the library in three big figures, the USB import on the right.

export function HeroAurora() {
  return (
    <HeroFrame className="rounded-2xl border border-[var(--color-border-subtle)] bg-[linear-gradient(105deg,rgba(18,10,32,0.98)_0%,rgba(30,16,50,0.95)_50%,rgba(10,16,34,0.98)_100%)]">
      <Texture background="radial-gradient(circle at 12% 25%, rgba(245,107,112,0.32), transparent 38%), radial-gradient(circle at 88% 80%, rgba(80,110,255,0.26), transparent 34%)" />
      <Texture background={DOTS} />
      <div className="relative flex h-full items-center gap-6 px-6">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <Avatar size={72} />
          <div className="min-w-0">
            <h2 className="truncate text-[30px] font-black uppercase leading-none tracking-tight">{HERO.name}</h2>
            <p className="mt-1.5 whitespace-nowrap text-[11px] font-semibold text-muted-foreground">Artist library</p>
            <Socials size={14} className="mt-3" />
          </div>
        </div>
        <div className="hidden shrink-0 items-center gap-6 lg:flex">
          <Stat value={HERO.tracks} label="Tracks" />
          <div className="h-12 w-px bg-white/10" />
          <Stat value={HERO.playlists} label="Playlists" />
          <div className="h-12 w-px bg-white/10" />
          <Stat value={HERO.largestPlaylist} label="Largest playlist" valueClassName="text-[18px] leading-[26px]" />
        </div>
        <div className="w-[190px] shrink-0 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3">
          <Eyebrow className="mb-1.5">USB Import</Eyebrow>
          <Done label="Import Complete" />
          <UsbLine className="mt-1.5" />
          <ImportButton className="mt-2.5 w-full" />
        </div>
      </div>
    </HeroFrame>
  );
}

// ── 2. Glass Duo ─────────────────────────────────────────────────────────────
// Two separate glass panels on a soft glow: who you are on the left, what is in your library on the right.

export function HeroGlassDuo() {
  return (
    <HeroFrame className="rounded-2xl border border-[var(--color-border-subtle)] bg-[#0b0f17]">
      <Texture background="radial-gradient(circle at 20% 20%, rgba(56,120,255,0.22), transparent 42%), radial-gradient(circle at 85% 85%, rgba(245,107,112,0.16), transparent 40%)" />
      <div className="relative grid h-full grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-3 p-3.5">
        <div className="flex min-w-0 items-center gap-4 rounded-xl border border-white/10 bg-white/[0.05] px-5 backdrop-blur-sm">
          <Avatar size={66} />
          <div className="min-w-0">
            <h2 className="truncate text-[24px] font-black uppercase leading-none tracking-tight">{HERO.name}</h2>
            <Socials size={14} className="mt-3" />
          </div>
        </div>
        <div className="flex min-w-0 flex-col justify-between rounded-xl border border-white/10 bg-white/[0.05] px-5 py-3.5 backdrop-blur-sm">
          <div className="flex items-center gap-8">
            <Stat value={HERO.tracks} label="Tracks" />
            <Stat value={HERO.playlists} label="Playlists" />
            <Stat value={HERO.largestPlaylist} label="Largest playlist" valueClassName="text-[16px] leading-[26px]" />
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] pt-3">
            <div className="min-w-0 space-y-1.5"><Done label="Import Complete" /><UsbLine /></div>
            <ImportButton />
          </div>
        </div>
      </div>
    </HeroFrame>
  );
}

// ── 3. Centered Poster ───────────────────────────────────────────────────────
// Everything on one centre line, like a poster: the avatar, the name, the socials, then the library figures. USB and import sit in the corners.

export function HeroPoster() {
  return (
    <HeroFrame className="rounded-2xl border border-[var(--color-border-subtle)] bg-[linear-gradient(180deg,#141a26_0%,#0c1018_100%)]">
      <Texture background={HATCH} />
      <div className="absolute left-5 top-4"><Done label="Import Complete" /><UsbLine className="mt-1.5" /></div>
      <div className="absolute right-5 top-4"><ImportButton /></div>
      <div className="relative flex h-full flex-col items-center justify-center gap-2 px-6 pt-3">
        <Avatar size={52} />
        <h2 className="text-[26px] font-black uppercase leading-none tracking-[0.12em]">{HERO.name}</h2>
        <Socials size={14} />
        <div className="mt-2 flex items-center gap-6 border-t border-white/10 pt-3">
          {[[HERO.tracks, 'Tracks'], [HERO.playlists, 'Playlists'], [HERO.largestPlaylist, 'Largest playlist']].map(([value, label], i) => (
            <div key={label} className="flex items-center gap-6">
              {i > 0 && <span className="h-6 w-px bg-white/10" />}
              <div className="text-center"><p className="text-[16px] font-black leading-none tabular-nums">{value}</p><Eyebrow className="mt-1">{label}</Eyebrow></div>
            </div>
          ))}
        </div>
      </div>
    </HeroFrame>
  );
}

// ── 4. Studio Strip ──────────────────────────────────────────────────────────
// The Audition look: one soft gradient panel, hairline dividers, light 20px figures over 9px spaced labels and a single coral accent.

export function HeroStudioStrip() {
  const coral = '#f56b70';
  return (
    <HeroFrame className="rounded-3xl border border-[#ffffff13] shadow-[inset_0_1px_0_#ffffff06,0_16px_40px_#00000026]" style={{ background: 'linear-gradient(165deg, #292d37 0%, #20242e 36%, #191d25 100%)', fontFamily: "'Helvetica Neue','Segoe UI',Arial,sans-serif" }}>
      <div className="relative flex h-full flex-col">
        <div className="flex flex-1 items-center gap-5 px-6">
          <div className="flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-[18px] font-light tracking-wider" style={{ color: coral }}>{HERO.initials}</div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[22px] font-light uppercase tracking-[0.14em] text-[#f6f7fa]">{HERO.name}</h2>
            <Socials size={13} className="mt-2" />
          </div>
          <div className="flex shrink-0 items-center gap-7">
            {[[HERO.tracks, 'Tracks'], [HERO.playlists, 'Playlists'], [HERO.largestPlaylist, 'Largest playlist']].map(([value, label]) => (
              <div key={label}><p className="text-[20px] font-light leading-none tracking-[-0.04em] text-[#f6f7fa] tabular-nums">{value}</p><p className="mt-1.5 text-[9px] uppercase tracking-[0.16em] text-[#9aa5b8]">{label}</p></div>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-[#ffffff0d] bg-black/[0.07] px-6 py-3">
          <div className="flex min-w-0 items-center gap-4">
            <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em]" style={{ color: coral }}><CheckmarkFilled size={12} /> Import complete</span>
            <UsbLine />
          </div>
          <ImportButton />
        </div>
      </div>
    </HeroFrame>
  );
}

// ── 5. Split Cover ───────────────────────────────────────────────────────────
// A cover panel on the left with the initials as a watermark, and a ruled sheet of facts on the right.

export function HeroSplitCover() {
  const rows: [string, ReactNode][] = [
    ['USB', <UsbLine key="u" />],
    ['Last import', LAST_IMPORT],
    ['Tracks', HERO.tracks],
    ['Playlists', HERO.playlists],
    ['Largest playlist', HERO.largestPlaylist],
  ];
  return (
    <HeroFrame className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] rounded-2xl border border-[var(--color-border-subtle)] bg-[#0d121b]">
      <div className="relative overflow-hidden border-r border-white/[0.08] bg-[linear-gradient(150deg,rgba(245,107,112,0.3),rgba(70,90,200,0.22)_60%,rgba(10,14,22,0.2))]">
        <span className="pointer-events-none absolute -bottom-6 -right-2 select-none text-[150px] font-black leading-none text-white/[0.08]">{HERO.initials}</span>
        <div className="relative flex h-full flex-col justify-end gap-2.5 p-5">
          <Done label="Import Complete" />
          <h2 className="truncate text-[28px] font-black uppercase leading-none tracking-tight">{HERO.name}</h2>
          <Socials size={14} />
        </div>
      </div>
      <div className="relative flex flex-col justify-center px-6">
        <Texture background={RULES} opacity={0.5} />
        <dl className="relative">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 border-b border-white/[0.07] py-[7px]">
              <dt><Eyebrow>{label}</Eyebrow></dt>
              <dd className="font-mono text-[12px] font-bold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <ImportButton className="relative mt-3 w-full" />
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
          Five hero directions, all 218px tall like the production hero. Each shows the profile, socials, USB import and the library counts. None of them show track analysis, top genres, BPM distribution or the Camelot key wheel.
        </div>
      </div>
      <HeroMockupCard n={1} title="Aurora Banner" concept="One banner lit from the corners: the artist, three big figures, the USB import"><HeroAurora /></HeroMockupCard>
      <HeroMockupCard n={2} title="Glass Duo" concept="Two glass panels: who you are, and what is in your library"><HeroGlassDuo /></HeroMockupCard>
      <HeroMockupCard n={3} title="Centered Poster" concept="Everything on one centre line, with USB and import in the corners"><HeroPoster /></HeroMockupCard>
      <HeroMockupCard n={4} title="Studio Strip" concept="The Audition look: a soft gradient panel, hairlines, light figures and one coral accent"><HeroStudioStrip /></HeroMockupCard>
      <HeroMockupCard n={5} title="Split Cover" concept="A cover panel with the initials as a watermark beside a ruled sheet of facts"><HeroSplitCover /></HeroMockupCard>
    </div>
  );
}
