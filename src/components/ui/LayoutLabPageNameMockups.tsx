import type { ReactNode } from 'react';
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

// ── 1. Library: Watermark ────────────────────────────────────────────────────
// Oversized outlined text sits behind the content, at very low contrast.
// Cards and rows paint over it, so nothing is hidden.

function Watermark() {
  return (
    <ScreenFrame page="Library">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-0 flex items-end justify-end overflow-hidden" style={{ zIndex: 0 }}>
        <span
          className="select-none pr-4 font-black uppercase leading-[0.8] tracking-tighter"
          style={{ fontSize: 120, color: 'transparent', WebkitTextStroke: '1px rgb(255 255 255 / 0.07)', transform: 'translateY(18%)' }}
        >
          Library
        </span>
      </div>
    </ScreenFrame>
  );
}

// ── 2. Review: Edge label ────────────────────────────────────────────────────
// Vertical text in the left 24px gutter, reading bottom to top.

function EdgeLabel() {
  return (
    <ScreenFrame page="Review">
      <div className="absolute inset-y-0 left-0 flex w-[24px] items-center justify-center">
        <span className="select-none text-[10px] font-bold uppercase tracking-[0.32em] text-muted-foreground" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
          Review
        </span>
      </div>
    </ScreenFrame>
  );
}

// ── 3. Cue Points: Legend in the border ──────────────────────────────────────
// The name is set into the top hairline of the main panel, like a form legend.

function BorderLegend() {
  return (
    <ScreenFrame page="Cue Points">
      <div className="pointer-events-none absolute inset-x-[24px] top-[24px] -translate-y-1/2">
        <span className="ml-4 inline-block bg-[var(--color-background)] px-2 text-[10px] font-bold uppercase tracking-[0.22em] text-primary">Cue Points</span>
      </div>
    </ScreenFrame>
  );
}

// ── 4. Audition: Top strip ───────────────────────────────────────────────────
// One line of small caps in the 24px top padding, with a hairline under it.

function TopStrip() {
  return (
    <ScreenFrame page="Audition">
      <div className="absolute inset-x-0 top-0 flex items-center justify-between border-b border-[var(--color-border-faint)] px-[24px]" style={{ height: PAD - 4 }}>
        <span className="text-[9px] font-bold uppercase tracking-[0.28em] text-foreground/70">Audition</span>
        <span className="text-[9px] uppercase tracking-[0.2em] text-foreground/30">DropDex</span>
      </div>
    </ScreenFrame>
  );
}

// ── 5. Discover: Status tag ──────────────────────────────────────────────────
// A small pill in the bottom-right corner of the bottom padding, like a
// status-bar mode indicator in an editor.

function StatusTag() {
  return (
    <ScreenFrame page="Discover">
      <div className="absolute bottom-[5px] right-[24px] flex items-center gap-1.5 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-card)] px-2.5 py-[3px]">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-foreground/80">Discover</span>
      </div>
    </ScreenFrame>
  );
}

// ── 6. Search: Nav rail label ────────────────────────────────────────────────
// The active nav icon grows a permanent label that slides out into the page's
// left padding; the icon stays where it is.

function RailLabel() {
  const index = PAGES.indexOf('Search');
  const top = 12 + 24 + 8 + index * 40; // logo + gap + preceding icons
  return (
    <ScreenFrame
      page="Search"
      rail={
        <div
          className="absolute left-[44px] z-10 flex h-8 items-center whitespace-nowrap rounded-r-lg border border-l-0 border-primary/30 bg-primary/15 pl-4 pr-3 text-[10px] font-bold uppercase tracking-[0.18em] text-primary"
          style={{ top }}
        >
          Search
        </div>
      }
    />
  );
}

// ── 7. Flip Lab: Top-edge notch ──────────────────────────────────────────────
// A small tab hangs from the very top edge, centered, in the padding strip.

function TopNotch() {
  return (
    <ScreenFrame page="Flip Lab">
      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
        <span className="rounded-b-lg border border-t-0 border-primary/30 bg-primary/15 px-4 py-[3px] text-[9px] font-bold uppercase tracking-[0.24em] text-primary" style={{ marginLeft: -PAD }}>
          Flip Lab
        </span>
      </div>
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
          Seven ways to show the current page name, one per left-nav page. Each uses space the screen already has (the 24px padding, a border, or the nav rail), so no content moves, shrinks or gets covered. The grey blocks are stand-ins for each page's real content.
        </div>
      </div>
      <MockupCard n={1} page="Library" title="Watermark" concept="Huge outlined text behind the content at very low contrast"><Watermark /></MockupCard>
      <MockupCard n={2} page="Review" title="Edge Label" concept="Vertical text in the left padding gutter"><EdgeLabel /></MockupCard>
      <MockupCard n={3} page="Cue Points" title="Border Legend" concept="Name set into the top border of the main panel"><BorderLegend /></MockupCard>
      <MockupCard n={4} page="Audition" title="Top Strip" concept="A single line of small caps in the top padding"><TopStrip /></MockupCard>
      <MockupCard n={5} page="Discover" title="Status Tag" concept="Small pill in the bottom-right corner, like an editor's mode indicator"><StatusTag /></MockupCard>
      <MockupCard n={6} page="Search" title="Rail Label" concept="The active nav icon gets a label that slides out into the margin"><RailLabel /></MockupCard>
      <MockupCard n={7} page="Flip Lab" title="Top Notch" concept="A small tab hanging from the top edge, centered"><TopNotch /></MockupCard>
    </div>
  );
}
