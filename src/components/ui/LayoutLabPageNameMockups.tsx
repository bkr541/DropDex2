import type { ReactNode } from 'react';
import { Growth, Music, Radio, Search, Shuffle } from '@carbon/icons-react';
import { camelotKeyColor } from './display/camelotKey';
import { cn } from '../../lib/utils';

// Seven left-nav pages, each showing its name a different way. Every technique
// uses space the screens already have (24px outer padding, borders, the nav
// rail) so nothing on the page is moved, resized or covered.

const PAGES = ['Library', 'Review', 'Cue Points', 'Audition', 'Discover', 'Search', 'Flip Lab'] as const;
type Page = (typeof PAGES)[number];

const PAD = 24;
const HEIGHT = 250;

// ── Wireframe pieces ─────────────────────────────────────────────────────────

function Block({ className, children }: { className?: string; children?: ReactNode }) {
  return <div className={cn('rounded-lg border border-white/[0.07] bg-white/[0.035]', className)}>{children}</div>;
}

function Bar({ w = '100%', h = 6, className }: { w?: string | number; h?: number; className?: string }) {
  return <div className={cn('rounded-full bg-white/[0.09]', className)} style={{ width: w, height: h }} />;
}

function TableWire() {
  return (
    <div className="flex h-full flex-col gap-2">
      <Block className="h-[58px] shrink-0 p-3"><Bar w="30%" h={9} /><Bar w="55%" className="mt-2" /></Block>
      <div className="flex-1 space-y-1.5 overflow-hidden">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-md border border-white/[0.05] bg-white/[0.02] px-3 py-2">
            <div className="h-5 w-5 rounded bg-white/[0.08]" /><Bar w="26%" /><Bar w="18%" className="ml-auto" /><Bar w="8%" />
          </div>
        ))}
      </div>
    </div>
  );
}

function GridWire() {
  return (
    <div className="grid h-full grid-cols-3 gap-2">
      {Array.from({ length: 6 }, (_, i) => (
        <Block key={i} className="p-3"><div className="mb-2 h-10 rounded bg-white/[0.06]" /><Bar w="70%" /><Bar w="40%" className="mt-1.5" /></Block>
      ))}
    </div>
  );
}

function SplitWire() {
  return (
    <div className="grid h-full grid-cols-2 gap-2">
      {[0, 1].map((i) => (
        <Block key={i} className="p-3">
          <Bar w="40%" h={8} />
          <div className="mt-3 space-y-1.5">{Array.from({ length: 5 }, (_, j) => <Bar key={j} w={`${90 - j * 8}%`} h={14} className="rounded-md" />)}</div>
        </Block>
      ))}
    </div>
  );
}

function TimelineWire() {
  return (
    <div className="flex h-full flex-col gap-2">
      <Block className="h-[40px] shrink-0 p-3"><Bar w="35%" h={8} /></Block>
      <Block className="flex-1 p-3"><div className="h-full rounded bg-[repeating-linear-gradient(90deg,rgb(255_255_255/0.08)_0_2px,transparent_2px_7px)]" /></Block>
      <Block className="h-[34px] shrink-0" />
    </div>
  );
}

function SearchWire() {
  return (
    <div className="flex h-full flex-col gap-2">
      <Block className="h-[34px] shrink-0 px-3 py-2.5"><Bar w="28%" /></Block>
      <div className="grid flex-1 grid-cols-4 gap-2">
        {Array.from({ length: 8 }, (_, i) => <Block key={i} className="p-2"><div className="h-10 rounded bg-white/[0.06]" /><Bar w="70%" className="mt-2" /></Block>)}
      </div>
    </div>
  );
}

const WIRES: Record<Page, () => ReactNode> = {
  Library: TableWire,
  Review: SplitWire,
  'Cue Points': TimelineWire,
  Audition: GridWire,
  Discover: GridWire,
  Search: SearchWire,
  'Flip Lab': SplitWire,
};

/** The app frame: nav rail on the left, 24px-padded content area. `rail` lets a technique decorate the nav. */
function ScreenFrame({ page, children, rail }: { page: Page; children?: ReactNode; rail?: ReactNode }) {
  const Wire = WIRES[page];
  return (
    <div className="relative flex overflow-hidden rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-background)]" style={{ height: HEIGHT }}>
      <div className="relative flex w-[56px] shrink-0 flex-col items-center gap-2 border-r border-[var(--color-border-faint)] bg-[var(--color-card)] py-3">
        <div className="mb-1 h-6 w-6 rounded-md bg-primary/80" />
        {PAGES.map((p) => (
          <div key={p} className={cn('h-8 w-8 rounded-lg border', p === page ? 'border-primary/30 bg-primary/15' : 'border-transparent bg-white/[0.04]')} />
        ))}
        {rail}
      </div>
      <div className="relative min-w-0 flex-1" style={{ padding: PAD }}>
        <Wire />
        {children}
      </div>
    </div>
  );
}

function MockupCard({ n, page, title, concept, children }: { n: number; page: Page; title: string; concept: string; children: ReactNode }) {
  return (
    <section className="mb-10">
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/15 text-[11px] font-extrabold text-primary">{n}</div>
        <span className="text-[13px] font-bold text-foreground">{page}</span>
        <span className="text-[13px] text-foreground/60">·</span>
        <span className="text-[13px] font-semibold text-foreground">{title}</span>
        <span className="text-[11px] text-muted-foreground">{concept}</span>
      </div>
      {children}
    </section>
  );
}

// ── Top-center page name, seven styles ───────────────────────────────────────
// Every option sits in exactly the same place: horizontally centered at the top
// edge of the page, inside the 24px padding strip. Only the styling changes, and
// each style is taken from something the app already uses.

function TopCenter({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute top-0 z-10" style={{ left: '50%', transform: 'translateX(-50%)' }}>
      {children}
    </div>
  );
}

// 1. Nav pill: the left nav's active-item style (primary/10 fill, primary/20 border, soft glow text).
function NavPill() {
  return (
    <ScreenFrame page="Library">
      <TopCenter>
        <span className="mt-[3px] flex items-center gap-1.5 rounded-xl border border-primary/20 bg-primary/10 px-3 py-[2px] text-[10px] font-semibold text-primary neon-text-blue">
          <Music size={12} /> Library
        </span>
      </TopCenter>
    </ScreenFrame>
  );
}

// 2. Glass card: the app's `glass` surface (panel-alt fill, subtle border, surface shadow) attached to the top edge.
function GlassCard() {
  return (
    <ScreenFrame page="Review">
      <TopCenter>
        <span className="glass flex items-center gap-2 rounded-b-xl border-t-0 px-4 py-[3px] text-[10px] font-bold uppercase tracking-[0.2em] text-foreground">
          <Growth size={12} className="text-secondary" /> Review
        </span>
      </TopCenter>
    </ScreenFrame>
  );
}

// 3. Section label: the Cue Points timeline's section labels (mono, bold, colored, 2px underline).
function SectionLabel() {
  return (
    <ScreenFrame page="Cue Points">
      <TopCenter>
        <span
          className="mt-[3px] block px-5 pb-[2px] font-mono text-[10px] font-bold tracking-wider"
          style={{ color: '#b266ff', borderBottom: '2px solid #b266ff' }}
        >
          CUE POINTS
        </span>
      </TopCenter>
    </ScreenFrame>
  );
}

// 4. Key badge: the track table's key badge (white/5 fill, colored 3px bar, mono bold), in a Camelot color.
function KeyBadgeStyle() {
  const color = camelotKeyColor('10A');
  return (
    <ScreenFrame page="Audition">
      <TopCenter>
        <span className="mt-[3px] inline-flex items-center rounded-[5px] bg-white/[0.05] py-[3px] pl-[3px] pr-3 font-mono text-[11px] font-bold" style={{ color }}>
          <span className="mr-2 h-[14px] w-[3px] shrink-0 rounded-full" style={{ backgroundColor: color }} />
          AUDITION
        </span>
      </TopCenter>
    </ScreenFrame>
  );
}

// 5. Outline button: the hero's Import Library button (blue outline, transparent, bold caps, wide tracking).
function OutlineButtonStyle() {
  return (
    <ScreenFrame page="Discover">
      <TopCenter>
        <span className="mt-[3px] flex items-center gap-1.5 rounded-xl border border-blue-500 bg-transparent px-3 py-[2px] text-[9px] font-bold uppercase tracking-widest text-blue-400">
          <Radio size={11} /> Discover
        </span>
      </TopCenter>
    </ScreenFrame>
  );
}

// 6. Brand gradient: the app's `brand-gradient` (coral to peach), attached to the top edge.
function BrandGradientStyle() {
  return (
    <ScreenFrame page="Search">
      <TopCenter>
        <span className="brand-gradient flex items-center gap-1.5 rounded-b-xl px-4 py-[3px] text-[9px] font-black uppercase tracking-[0.24em] text-white shadow-[0_4px_14px_rgb(207_107_101_/_0.3)]">
          <Search size={11} /> Search
        </span>
      </TopCenter>
    </ScreenFrame>
  );
}

// 7. Primary tint notch: the original. Primary/15 fill and primary/30 border, attached to the top edge.
function TintNotch() {
  return (
    <ScreenFrame page="Flip Lab">
      <TopCenter>
        <span className="flex items-center gap-1.5 rounded-b-lg border border-t-0 border-primary/30 bg-primary/15 px-4 py-[3px] text-[9px] font-bold uppercase tracking-[0.24em] text-primary">
          <Shuffle size={11} /> Flip Lab
        </span>
      </TopCenter>
    </ScreenFrame>
  );
}

// ── Tab content ──────────────────────────────────────────────────────────────

export function PageNameMockupsContent() {
  return (
    <div className="h-full overflow-y-auto bg-[var(--color-background)] px-8 pb-12 pt-7">
      <div className="mb-7">
        <div className="mb-1 text-sm font-extrabold text-foreground">Page Name Concepts</div>
        <div className="text-[11px] leading-relaxed text-muted-foreground">
          The page name floats at the top center of the page, in the same spot for all seven. Only the styling differs, and each style is borrowed from something already in the app (nav, glass surface, timeline labels, key badge, hero button, brand gradient). Number 7 is the original. No content moves, shrinks or gets covered. The grey blocks are stand-ins for each page's real content.
        </div>
      </div>
      <MockupCard n={1} page="Library" title="Nav Pill" concept="The left nav's active-item style"><NavPill /></MockupCard>
      <MockupCard n={2} page="Review" title="Glass Card" concept="The app's glass surface, attached to the top edge"><GlassCard /></MockupCard>
      <MockupCard n={3} page="Cue Points" title="Section Label" concept="The timeline's section labels: mono, colored, 2px underline"><SectionLabel /></MockupCard>
      <MockupCard n={4} page="Audition" title="Key Badge" concept="The track table's key badge, in a Camelot color"><KeyBadgeStyle /></MockupCard>
      <MockupCard n={5} page="Discover" title="Outline Button" concept="The hero's Import Library button style"><OutlineButtonStyle /></MockupCard>
      <MockupCard n={6} page="Search" title="Brand Gradient" concept="The app's coral brand gradient, attached to the top edge"><BrandGradientStyle /></MockupCard>
      <MockupCard n={7} page="Flip Lab" title="Tint Notch" concept="The original: primary-tinted tab on the top edge"><TintNotch /></MockupCard>
    </div>
  );
}
