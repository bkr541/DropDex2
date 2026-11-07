import { useState, type CSSProperties, type ElementType, type ReactNode } from 'react';
import { Calendar, Cloud, CheckmarkFilled, Flag, Music, Pause, Playlist, Renew, Tag, Upload, Usb, WarningAlt, Waveform } from '@carbon/icons-react';
import { cn } from '../../lib/utils';
import { ControlButton } from './controls/ControlButton';
import { Socials } from './LayoutLabHeroParts';
import { HERO } from './layoutLabHeroSample';
import './layout-lab-hero.css';

// Five hero directions. Every one is 218px tall (the production hero's height) and shows only who the artist is and what is in
// their library: profile, socials, USB import and the library counts. There is no track analysis and none of the insight
// groups (top genres, BPM distribution, Camelot key wheel). All five are in the graphite look of Audition and Discovery.

// Textures, as CSS backgrounds.
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

// ── One to four: the Ghost Banner look, with the import status ──────────────
// These four share the style of mockup 7 (Ghost Banner): the artist's name rises from the bottom edge as a huge faint word, the picture and
// social icons are large, and the seven library values run in one line between hairlines. The artist name is set like the one on the
// left of Split Cover (28px, light, capitals, 0.1em spacing). Each also shows where the import stands (complete, paused, importing or
// failed: click it to see them all), the USB if one is loaded, the date of the last import, and the primary Import Library button.

type ImportState = 'complete' | 'paused' | 'importing' | 'failed';
const IMPORT_STATES: Record<ImportState, { label: string; Icon: ElementType; next: ImportState }> = {
  complete: { label: 'Import complete', Icon: CheckmarkFilled, next: 'paused' },
  paused: { label: 'Import paused', Icon: Pause, next: 'importing' },
  importing: { label: 'Importing', Icon: Renew, next: 'failed' },
  failed: { label: 'Import failed', Icon: WarningAlt, next: 'complete' },
};

/** Where the import stands. Click to step through the four states. */
function ImportStatus({ initial = 'complete', className }: { initial?: ImportState; className?: string }) {
  const [state, setState] = useState<ImportState>(initial);
  const { label, Icon, next } = IMPORT_STATES[state];
  return (
    <button type="button" className={cn('lh-status', className)} data-state={state} data-testid="hero-import-status" onClick={() => setState(next)} title="Click to see the other import states">
      <Icon size={12} /> {label}
    </button>
  );
}

/** The USB that is loaded, or a plain note when none is. */
function UsbName({ usb = HERO.usb, className }: { usb?: string | null; className?: string }) {
  return <p className={cn('flex items-center gap-1.5 whitespace-nowrap font-mono text-[10px] text-muted-foreground', className)} data-testid="hero-usb"><Usb size={11} /> {usb ?? 'No USB loaded'}</p>;
}

function LastImport({ className }: { className?: string }) {
  return <p className={cn('flex items-center gap-1.5 whitespace-nowrap font-mono text-[10px] text-muted-foreground', className)} data-testid="hero-last-import"><Calendar size={11} /> Last import {LAST_IMPORT}</p>;
}

/** The artist as mockup 7 draws them, with the name set like the left of Split Cover. */
function GhostIdentity({ avatar = 150, socials = 26, className }: { avatar?: number; socials?: number; className?: string }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-6', className)} data-testid="hero-identity">
      <Avatar size={avatar} />
      <div className="flex min-w-0 flex-col justify-center gap-3">
        <p className="lh-label">Artist library</p>
        <h2 className="truncate text-[28px] font-light uppercase leading-none tracking-[0.1em]" data-testid="hero-name">{HERO.name}</h2>
        <Socials size={socials} className="gap-5" />
      </div>
    </div>
  );
}

/** The seven values of mockup 7, in one line between hairlines. */
function SevenLine({ figureClass = 'text-[24px]', cellClass = 'px-4', className }: { figureClass?: string; cellClass?: string; className?: string }) {
  return (
    <div className={cn('flex items-center', className)}>
      {SEVEN.map(({ label, value }, i) => (
        <div key={label} className={cn('min-w-0', cellClass, i > 0 && 'border-l border-[#ffffff14]')} data-testid="hero-value"><p className={cn('lh-figure', figureClass)}>{value}</p><Eyebrow className="mt-1.5 whitespace-nowrap">{label}</Eyebrow></div>
      ))}
    </div>
  );
}

// 1. Ghost Stacked: the picture and name on the left; on the right the seven values, and under them the import row.

export function HeroAurora() {
  return (
    <HeroFrame className="lh-f-ghost">
      <Watermark className="lh-wm-up" />
      <div className="relative flex h-full items-center gap-8 px-7" style={{ minWidth: 1180 }}>
        <GhostIdentity avatar={150} />
        <div className="ml-auto flex shrink-0 flex-col gap-4">
          <SevenLine />
          <div className="flex items-center justify-between gap-6 border-t border-[#ffffff14] pt-3.5">
            <div className="flex items-center gap-5"><ImportStatus /><UsbName /><LastImport /></div>
            <ImportButton />
          </div>
        </div>
      </div>
    </HeroFrame>
  );
}

// 2. Ghost Two Rows: identity and the import block on top, the seven values as a band across the whole width underneath.

export function HeroGlassDuo() {
  return (
    <HeroFrame className="lh-f-ghost">
      <Watermark className="lh-wm-up" />
      <div className="relative flex h-full flex-col" style={{ minWidth: 1180 }}>
        <div className="flex flex-1 items-center gap-8 px-7">
          <GhostIdentity avatar={92} socials={22} />
          <div className="ml-auto flex shrink-0 items-center gap-7">
            <div className="space-y-1.5"><ImportStatus initial="paused" /><UsbName /><LastImport /></div>
            <ImportButton />
          </div>
        </div>
        <div className="grid grid-cols-7 border-t border-[#ffffff14] bg-[#00000026] py-3">
          {SEVEN.map(({ label, value }, i) => (
            <div key={label} className={cn('min-w-0 px-6', i > 0 && 'border-l border-[#ffffff14]')} data-testid="hero-value"><p className="lh-figure text-[22px]">{value}</p><Eyebrow className="mt-1.5 whitespace-nowrap">{label}</Eyebrow></div>
          ))}
        </div>
      </div>
    </HeroFrame>
  );
}

// 3. Ghost Centered: picture, name and socials on the centre line, the seven values under them; the import status sits in the top left and the button in the top right.

export function HeroPoster() {
  return (
    <HeroFrame className="lh-f-ghost">
      <Watermark className="lh-wm-up" />
      <div className="relative h-full" style={{ minWidth: 1180 }}>
        <div className="absolute left-6 top-4 space-y-1.5"><ImportStatus initial="importing" /><UsbName /><LastImport /></div>
        <div className="absolute right-6 top-4"><ImportButton /></div>
        <div className="flex h-full flex-col items-center justify-end gap-4 pb-4">
          <GhostIdentity avatar={78} socials={22} className="justify-center" />
          <SevenLine className="border-t border-[#ffffff14] pt-3.5" figureClass="text-[22px]" cellClass="px-5" />
        </div>
      </div>
    </HeroFrame>
  );
}

// 4. Ghost Footer: identity and the seven values above, and a footer band for the import status, the USB, the last import date and the button.

export function HeroStudioStrip() {
  return (
    <HeroFrame className="lh-f-ghost">
      <Watermark className="lh-wm-up" />
      <div className="relative flex h-full flex-col" style={{ minWidth: 1180 }}>
        <div className="flex flex-1 items-center gap-8 px-7">
          <GhostIdentity avatar={104} socials={24} />
          <SevenLine className="ml-auto shrink-0" />
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-[#ffffff0d] bg-[#00000026] px-7 py-3">
          <div className="flex min-w-0 items-center gap-6"><ImportStatus initial="failed" /><UsbName /><LastImport /></div>
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
          Ten hero directions, all 218px tall like the production hero and all in the graphite look of Audition and Discovery. The first four are redone in the style of mockup 7 with the artist name from Split Cover, the seven values, the import status (click it to step through complete, paused, importing and failed), the USB, the last import date and the Import Library button. Five shows the profile, socials, USB import and three library counts. Six to ten put the artist's name in the background, faded into the surface, make the picture, name and social icons fill the height of the strip, and show seven values from the user's data: tracks, playlists, USBs, cue points, genres, how much is analysed and how much is in the cloud. None of them show the genre, BPM or Camelot key charts.
        </div>
      </div>
      <HeroMockupCard n={1} title="Ghost Stacked" concept="Mockup 7's look: the picture and name left; the seven values over the import row on the right"><HeroAurora /></HeroMockupCard>
      <HeroMockupCard n={2} title="Ghost Two Rows" concept="Identity and the import block on top; the seven values as a band across the width"><HeroGlassDuo /></HeroMockupCard>
      <HeroMockupCard n={3} title="Ghost Centered" concept="Picture, name and socials on the centre line, the values below; import status and button in the corners"><HeroPoster /></HeroMockupCard>
      <HeroMockupCard n={4} title="Ghost Footer" concept="Identity and the seven values above; a footer band for import status, USB, last import and the button"><HeroStudioStrip /></HeroMockupCard>
      <HeroMockupCard n={5} title="Split Cover" concept="A cover panel with the initials as a watermark beside a ruled sheet of facts"><HeroSplitCover /></HeroMockupCard>
      <HeroMockupCard n={6} title="Name Wash" concept="The name fades in from the right edge behind a big picture; seven values in a four-over-three grid"><HeroNameWash /></HeroMockupCard>
      <HeroMockupCard n={7} title="Ghost Banner" concept="The name rises from the bottom edge and fades upward; seven values in one line between hairlines"><HeroGhostBanner /></HeroMockupCard>
      <HeroMockupCard n={8} title="Ledger" concept="A square picture, the name drawn as an outline in the background, seven values as a ruled ledger"><HeroLedger /></HeroMockupCard>
      <HeroMockupCard n={9} title="Tile Wall" concept="The name behind a wall of seven raised tiles, each with a small icon"><HeroTileWall /></HeroMockupCard>
      <HeroMockupCard n={10} title="Split Name" concept="The name split into two huge lines on the right, seven values as a two-column list"><HeroSplitName /></HeroMockupCard>
    </div>
  );
}
