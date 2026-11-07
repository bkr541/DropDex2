import type { CSSProperties, ElementType, ReactNode } from 'react';
import { Cloud, CheckmarkFilled, Flag, Music, Playlist, Tag, Upload, Usb, Waveform } from '@carbon/icons-react';
import { cn } from '../../lib/utils';
import { ControlButton } from './controls/ControlButton';
import { Socials } from './LayoutLabHeroParts';
import { HERO } from './layoutLabHeroSample';
import './layout-lab-hero.css';

// Five hero directions. Every one is 218px tall (the production hero's height) and shows only who the artist is and what is in
// their library: profile, socials, USB import and the library counts. There is no track analysis and none of the insight
// groups (top genres, BPM distribution, Camelot key wheel). All five are in the graphite look of Audition and Discovery.

// Textures, as CSS backgrounds.
const DOTS = 'radial-gradient(rgba(255,255,255,0.075) 1px, transparent 1px) 0 0 / 14px 14px';
const RULES = 'repeating-linear-gradient(0deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 24px)';

const LAST_IMPORT = HERO.lastImport.replace(', 2026', '');

// ── Shared pieces ────────────────────────────────────────────────────────────

function HeroFrame({ className, style, children }: { className?: string; style?: CSSProperties; children: ReactNode }) {
  return <div className={cn('lh-frame relative h-[218px] overflow-hidden', className)} style={style}>{children}</div>;
}

function Texture({ background, opacity = 1 }: { background: string; opacity?: number }) {
  return <div className="pointer-events-none absolute inset-0" style={{ background, opacity }} />;
}

function Eyebrow({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <p className={cn('lh-label', className)} style={style}>{children}</p>;
}

function Avatar({ size = 64, ring = true }: { size?: number; ring?: boolean }) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {ring && <div className="lh-avatar-ring" />}
      <div className="lh-avatar h-full w-full" style={{ fontSize: size * 0.3 }}>
        <span className="font-light tracking-[0.06em] text-primary">{HERO.initials}</span>
      </div>
      <span className="absolute rounded-full border-2 border-[#20242d] bg-[#6fd9a4]" style={{ width: 12, height: 12, right: 0, bottom: 2 }} />
    </div>
  );
}

/** The one shared primary button, so the mockups match the app. */
function ImportButton({ className }: { className?: string }) {
  return <ControlButton variant="primary" className={cn('!min-h-8 whitespace-nowrap text-[11px]', className)}><Upload size={12} /> Import Library</ControlButton>;
}

function Done({ label }: { label: string }) {
  return <span className="lh-done"><CheckmarkFilled size={12} /> {label}</span>;
}

function UsbLine({ className }: { className?: string }) {
  return <p className={cn('flex items-center gap-1.5 whitespace-nowrap font-mono text-[10px] text-muted-foreground', className)}><Usb size={11} /> {HERO.usb} · {LAST_IMPORT}</p>;
}

/** A figure over a small label. */
function Stat({ value, label, className, valueClassName }: { value: ReactNode; label: string; className?: string; valueClassName?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className={cn('lh-figure truncate text-[26px]', valueClassName)}>{value}</p>
      <Eyebrow className="mt-1.5">{label}</Eyebrow>
    </div>
  );
}

// ── 1. Aurora Banner ─────────────────────────────────────────────────────────
// A wide banner lit from the corners. The artist on the left, the library in three big figures, the USB import on the right.

export function HeroAurora() {
  return (
    <HeroFrame className="lh-f-aurora">
      <Texture background="radial-gradient(circle at 10% 20%, rgba(255,255,255,0.10), transparent 40%), radial-gradient(circle at 92% 90%, rgba(255,255,255,0.05), transparent 36%)" />
      <Texture background={DOTS} />
      <div className="relative flex h-full items-center gap-6 px-6">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <Avatar size={72} />
          <div className="min-w-0">
            <h2 className="truncate text-[30px] font-light uppercase leading-none tracking-[0.1em]">{HERO.name}</h2>
            <p className="lh-label mt-2 whitespace-nowrap">Artist library</p>
            <Socials size={14} className="mt-3" />
          </div>
        </div>
        <div className="hidden shrink-0 items-center gap-6 lg:flex">
          <Stat value={HERO.tracks} label="Tracks" />
          <div className="h-12 w-px bg-[#ffffff14]" />
          <Stat value={HERO.playlists} label="Playlists" />
          <div className="h-12 w-px bg-[#ffffff14]" />
          <Stat value={HERO.largestPlaylist} label="Largest playlist" valueClassName="text-[18px] leading-[26px]" />
        </div>
        <div className="lh-card w-[190px] shrink-0 px-3.5 py-3">
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
    <HeroFrame className="lh-f-glass">
      <Texture background="radial-gradient(circle at 18% 18%, rgba(255,255,255,0.10), transparent 42%), radial-gradient(circle at 86% 88%, rgba(255,255,255,0.05), transparent 40%)" />
      <div className="relative grid h-full grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-3 p-3.5">
        <div className="lh-glass flex min-w-0 items-center gap-4 px-5">
          <Avatar size={66} />
          <div className="min-w-0">
            <h2 className="truncate text-[24px] font-light uppercase leading-none tracking-[0.1em]">{HERO.name}</h2>
            <Socials size={14} className="mt-3" />
          </div>
        </div>
        <div className="lh-glass flex min-w-0 flex-col justify-between px-5 py-3.5">
          <div className="flex items-center gap-8">
            <Stat value={HERO.tracks} label="Tracks" />
            <Stat value={HERO.playlists} label="Playlists" />
            <Stat value={HERO.largestPlaylist} label="Largest playlist" valueClassName="text-[16px] leading-[26px]" />
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-[#ffffff14] pt-3">
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
    <HeroFrame className="lh-f-poster">
      <div className="absolute left-5 top-4"><Done label="Import Complete" /><UsbLine className="mt-1.5" /></div>
      <div className="absolute right-5 top-4"><ImportButton /></div>
      <div className="relative flex h-full flex-col items-center justify-center gap-2 px-6 pt-3">
        <Avatar size={52} />
        <h2 className="text-[26px] font-light uppercase leading-none tracking-[0.2em]">{HERO.name}</h2>
        <Socials size={14} />
        <div className="mt-2 flex items-center gap-6 border-t border-[#ffffff14] pt-3">
          {[[HERO.tracks, 'Tracks'], [HERO.playlists, 'Playlists'], [HERO.largestPlaylist, 'Largest playlist']].map(([value, label], i) => (
            <div key={label} className="flex items-center gap-6">
              {i > 0 && <span className="h-6 w-px bg-[#ffffff14]" />}
              <div className="text-center"><p className="lh-figure text-[20px]">{value}</p><Eyebrow className="mt-1.5">{label}</Eyebrow></div>
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
    <HeroFrame className="lh-f-strip">
      <div className="relative flex h-full flex-col">
        <div className="flex flex-1 items-center gap-5 px-6">
          <div className="lh-avatar h-[60px] w-[60px] shrink-0 text-[18px] font-light tracking-wider" style={{ color: coral }}>{HERO.initials}</div>
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
        <div className="flex items-center justify-between gap-4 border-t border-[#ffffff0d] bg-[#00000026] px-6 py-3">
          <div className="flex min-w-0 items-center gap-4">
            <span className="lh-done"><CheckmarkFilled size={12} /> Import complete</span>
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
    <HeroFrame className="lh-f-cover grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="lh-cover">
        <span className="pointer-events-none absolute -bottom-6 -right-2 select-none text-[150px] font-light leading-none tracking-[-0.04em] text-white/[0.07]">{HERO.initials}</span>
        <div className="relative flex h-full flex-col justify-end gap-2.5 p-5">
          <Done label="Import Complete" />
          <h2 className="truncate text-[28px] font-light uppercase leading-none tracking-[0.1em]">{HERO.name}</h2>
          <Socials size={14} />
        </div>
      </div>
      <div className="relative flex flex-col justify-center px-6">
        <Texture background={RULES} opacity={0.5} />
        <dl className="relative">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 border-b border-[#ffffff0d] py-[7px]">
              <dt><Eyebrow>{label}</Eyebrow></dt>
              <dd className="font-mono text-[12px] tabular-nums text-[#f6f7fa]">{value}</dd>
            </div>
          ))}
        </dl>
        <ImportButton className="relative mt-3 w-full" />
      </div>
    </HeroFrame>
  );
}


// ── Six to ten: the artist name in the background, seven values ─────────────
// These five share three rules. The artist's name is also the background: huge, light and faded into the graphite so the two read
// as one surface (as the initials do in Split Cover). The profile picture, the name and the social icons are large enough to fill
// the height of the strip. And each shows seven values taken from what DropDex keeps about a user: the tracks, playlists, USBs,
// cue points, genres and analysis of their library, and how much of it is in the cloud.

const SEVEN: { label: string; value: ReactNode; Icon: ElementType }[] = [
  { label: 'Tracks', value: HERO.tracks, Icon: Music },
  { label: 'Playlists', value: HERO.playlists, Icon: Playlist },
  { label: 'USBs', value: HERO.usbs, Icon: Usb },
  { label: 'Cue points', value: HERO.cuePoints, Icon: Flag },
  { label: 'Genres', value: HERO.genreCount, Icon: Tag },
  { label: 'Analysed', value: HERO.analysedPct, Icon: Waveform },
  { label: 'In the cloud', value: HERO.cloudSynced, Icon: Cloud },
];

/** The artist's name as a huge, faint word in the background. */
function Watermark({ className, children }: { className: string; children?: ReactNode }) {
  return <span aria-hidden="true" className={cn('lh-watermark', className)} data-testid="hero-watermark">{children ?? HERO.name}</span>;
}

/** The large identity block: a picture that nearly fills the strip, the name beside it, and the social icons under the name. */
function Identity({ avatar = 172, nameClass = 'text-[44px]', square = false }: { avatar?: number; nameClass?: string; square?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-7" data-testid="hero-identity">
      {square ? (
        <div className="lh-avatar shrink-0 !rounded-[28px]" style={{ width: avatar, height: avatar, fontSize: avatar * 0.3 }}><span className="font-light tracking-[0.06em] text-primary">{HERO.initials}</span></div>
      ) : <Avatar size={avatar} />}
      <div className="flex min-w-0 flex-col justify-center gap-3.5">
        <p className="lh-label">Artist library</p>
        <h2 className={cn('truncate font-light uppercase leading-none tracking-[0.06em]', nameClass)}>{HERO.name}</h2>
        <Socials size={26} className="gap-5" />
      </div>
    </div>
  );
}

function SevenFigures({ className, figureClass = 'text-[30px]' }: { className?: string; figureClass?: string }) {
  return (
    <div className={className}>
      {SEVEN.map(({ label, value }) => (
        <div key={label} className="min-w-0" data-testid="hero-value"><p className={cn('lh-figure truncate', figureClass)}>{value}</p><Eyebrow className="mt-1.5 whitespace-nowrap">{label}</Eyebrow></div>
      ))}
    </div>
  );
}

// 6. Name Wash: the name fades in from the right edge behind everything; the seven values sit in a four-over-three grid.

export function HeroNameWash() {
  return (
    <HeroFrame className="lh-f-wash">
      <Watermark className="lh-wm-right" />
      <div className="relative flex h-full items-center gap-8 px-7" style={{ minWidth: 1080 }}>
        <Identity />
        <SevenFigures className="ml-auto grid shrink-0 grid-cols-4 gap-x-9 gap-y-7" />
      </div>
    </HeroFrame>
  );
}

// 7. Ghost Banner: the name rises from the bottom edge and fades upward; the seven values run in one line between hairlines.

export function HeroGhostBanner() {
  return (
    <HeroFrame className="lh-f-ghost">
      <Watermark className="lh-wm-up" />
      <div className="relative flex h-full items-center gap-8 px-7" style={{ minWidth: 1080 }}>
        <Identity avatar={164} nameClass="text-[40px]" />
        <div className="ml-auto flex shrink-0 items-center">
          {SEVEN.map(({ label, value }, i) => (
            <div key={label} className={cn('min-w-0 px-5', i > 0 && 'border-l border-[#ffffff14]')} data-testid="hero-value"><p className="lh-figure text-[26px]">{value}</p><Eyebrow className="mt-1.5 whitespace-nowrap">{label}</Eyebrow></div>
          ))}
        </div>
      </div>
    </HeroFrame>
  );
}

// 8. Ledger: a square picture, the name drawn only as an outline in the background, and the seven values as a ruled ledger in a well.

export function HeroLedger() {
  return (
    <HeroFrame className="lh-f-ledger">
      <Watermark className="lh-wm-outline" />
      <div className="relative flex h-full items-center gap-8 px-7" style={{ minWidth: 1080 }}>
        <Identity avatar={176} square />
        <dl className="lh-well ml-auto w-[300px] shrink-0 px-5 py-2.5">
          {SEVEN.map(({ label, value }) => (
            <div key={label} className="flex items-baseline justify-between gap-4 border-b border-[#ffffff0d] py-[5px] last:border-b-0" data-testid="hero-value">
              <dt><Eyebrow>{label}</Eyebrow></dt>
              <dd className="lh-figure text-[17px]">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </HeroFrame>
  );
}

// 9. Tile Wall: the name sits behind a wall of seven raised tiles, each with a small icon; the tracks tile is double width.

export function HeroTileWall() {
  return (
    <HeroFrame className="lh-f-tiles">
      <Watermark className="lh-wm-center" />
      <div className="relative flex h-full items-center gap-8 px-7" style={{ minWidth: 1080 }}>
        <Identity avatar={168} nameClass="text-[42px]" />
        <div className="ml-auto grid w-[520px] shrink-0 grid-cols-4 gap-2.5">
          {SEVEN.map(({ label, value, Icon }, i) => (
            <div key={label} className={cn('lh-tile', i === 0 && 'col-span-2')} data-testid="hero-value">
              <Icon size={15} className="text-[#9aa5b8]" />
              <p className="lh-figure text-[28px]">{value}</p>
              <Eyebrow className="whitespace-nowrap">{label}</Eyebrow>
            </div>
          ))}
        </div>
      </div>
    </HeroFrame>
  );
}

// 10. Split Name: the name is split in two huge lines across the right; the seven values are a two-column list in front of it.

export function HeroSplitName() {
  return (
    <HeroFrame className="lh-f-two">
      <Watermark className="lh-wm-two"><span>DVY</span><span>DRM</span></Watermark>
      <div className="relative flex h-full items-center gap-8 px-7" style={{ minWidth: 1080 }}>
        <Identity avatar={180} nameClass="text-[46px]" />
        <dl className="ml-auto grid w-[430px] shrink-0 grid-flow-col grid-cols-2 grid-rows-4 gap-x-10">
          {SEVEN.map(({ label, value }) => (
            <div key={label} className="flex items-baseline justify-between gap-4 border-b border-[#ffffff14] py-2" data-testid="hero-value">
              <dt><Eyebrow>{label}</Eyebrow></dt>
              <dd className="lh-figure text-[20px]">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </HeroFrame>
  );
}

// ── Tab content ──────────────────────────────────────────────────────────────

function HeroMockupCard({ n, title, concept, children }: { n: number; title: string; concept: string; children: ReactNode }) {
  return (
    <section className="mb-12" data-testid="hero-mockup">
      <div className="mb-3 flex items-center gap-2.5">
        <div className="lh-number">{n}</div>
        <span className="text-[13px] font-medium text-foreground">{title}</span>
        <span className="text-[11px] text-muted-foreground">{concept}</span>
      </div>
      <div className="lh-stage">{children}</div>
    </section>
  );
}

export function HeroMockupsContent() {
  return (
    <div className="lh-lab h-full overflow-y-auto bg-[var(--color-background)] px-8 pb-12 pt-7">
      <div className="mb-7">
        <div className="mb-1 text-foreground" style={{ fontWeight: 300, fontSize: 24, letterSpacing: '-0.03em' }}>Library Hero Concepts</div>
        <div className="text-[11px] leading-relaxed text-muted-foreground">
          Ten hero directions, all 218px tall like the production hero and all in the graphite look of Audition and Discovery. The first five show the profile, socials, USB import and three library counts. Six to ten put the artist's name in the background, faded into the surface, make the picture, name and social icons fill the height of the strip, and show seven values from the user's data: tracks, playlists, USBs, cue points, genres, how much is analysed and how much is in the cloud. None of them show the genre, BPM or Camelot key charts.
        </div>
      </div>
      <HeroMockupCard n={1} title="Aurora Banner" concept="One banner lit from the corners: the artist, three big figures, the USB import"><HeroAurora /></HeroMockupCard>
      <HeroMockupCard n={2} title="Glass Duo" concept="Two glass panels: who you are, and what is in your library"><HeroGlassDuo /></HeroMockupCard>
      <HeroMockupCard n={3} title="Centered Poster" concept="Everything on one centre line, with USB and import in the corners"><HeroPoster /></HeroMockupCard>
      <HeroMockupCard n={4} title="Studio Strip" concept="The Audition look: a soft gradient panel, hairlines, light figures and one coral accent"><HeroStudioStrip /></HeroMockupCard>
      <HeroMockupCard n={5} title="Split Cover" concept="A cover panel with the initials as a watermark beside a ruled sheet of facts"><HeroSplitCover /></HeroMockupCard>
      <HeroMockupCard n={6} title="Name Wash" concept="The name fades in from the right edge behind a big picture; seven values in a four-over-three grid"><HeroNameWash /></HeroMockupCard>
      <HeroMockupCard n={7} title="Ghost Banner" concept="The name rises from the bottom edge and fades upward; seven values in one line between hairlines"><HeroGhostBanner /></HeroMockupCard>
      <HeroMockupCard n={8} title="Ledger" concept="A square picture, the name drawn as an outline in the background, seven values as a ruled ledger"><HeroLedger /></HeroMockupCard>
      <HeroMockupCard n={9} title="Tile Wall" concept="The name behind a wall of seven raised tiles, each with a small icon"><HeroTileWall /></HeroMockupCard>
      <HeroMockupCard n={10} title="Split Name" concept="The name split into two huge lines on the right, seven values as a two-column list"><HeroSplitName /></HeroMockupCard>
    </div>
  );
}
