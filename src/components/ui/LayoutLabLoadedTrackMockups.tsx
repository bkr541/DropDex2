import type { ReactNode } from 'react';
import { ChevronDown, Export, Idea } from '@carbon/icons-react';
import { cn } from '../../lib/utils';
import { camelotKeyColor } from './display/camelotKey';
import { KeyBadge } from './display/KeyBadge';

// Sample data from the Cue Points loaded-track group.
const TRACK = {
  title: 'Disappearance w EVOKE45',
  artist: 'Artist Not Available',
  bpm: '150.00',
  key: '10A',
  duration: '3:51',
  cues: 3,
  status: 'Original',
  pending: 0,
  applyAll: 0,
};

const KEY_COLOR = camelotKeyColor(TRACK.key);
const LINE = 'border-[var(--color-border-faint)]';

// ── Shared pieces ────────────────────────────────────────────────────────────

function Vinyl({ size }: { size: number }) {
  return (
    <div
      className="shrink-0 rounded-[6px] border border-[var(--color-border-subtle)] bg-[var(--color-panel)] flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 32 32" width={size * 0.66} height={size * 0.66} fill="none" stroke="currentColor" strokeWidth="1.4" className="text-foreground/85" aria-hidden="true">
        <circle cx="16" cy="16" r="13" />
        <circle cx="16" cy="16" r="8.5" opacity="0.5" />
        <circle cx="16" cy="16" r="4" className="text-primary" stroke="var(--color-primary)" />
        <circle cx="16" cy="16" r="1" fill="currentColor" />
      </svg>
    </div>
  );
}

function Btn({ children, variant = 'surface', disabled = false, icon, className }: {
  children?: ReactNode; variant?: 'surface' | 'primary' | 'ghost'; disabled?: boolean; icon?: ReactNode; className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-[11px] font-medium transition-colors whitespace-nowrap',
        variant === 'surface' && 'border border-[var(--color-border-subtle)] bg-[var(--color-panel)] text-foreground hover:bg-white/[0.06]',
        variant === 'ghost' && 'text-muted-foreground hover:text-foreground hover:bg-white/[0.06]',
        variant === 'primary' && 'bg-primary text-white hover:brightness-110',
        disabled && 'opacity-45 pointer-events-none',
        className,
      )}
    >
      {icon}{children}
    </button>
  );
}

function SplitApply({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex">
      <Btn variant="primary" icon={<Export size={14} />} className={cn('rounded-r-none opacity-60', compact && 'px-2')}>
        Apply All ({TRACK.applyAll})
      </Btn>
      <Btn variant="primary" className="rounded-l-none border-l border-white/15 w-7 justify-center px-0">
        <ChevronDown size={14} />
      </Btn>
    </div>
  );
}

function Actions({ iconOnly = false }: { iconOnly?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <Btn>Pending {TRACK.pending}</Btn>
      <Btn icon={<Idea size={14} />} className={cn(iconOnly && 'w-7 justify-center px-0')}>{!iconOnly && 'Auto Cue'}</Btn>
      <SplitApply />
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-foreground/45">{children}</span>;
}

function StatusChip() {
  return (
    <span className="rounded-[4px] border border-[var(--color-border-faint)] bg-white/[0.015] px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
      {TRACK.status}
    </span>
  );
}

function Editing() {
  return <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-primary/75">Editing</span>;
}

function MockupCard({ n, title, concept, height, children }: { n: number; title: string; concept: string; height: string; children: ReactNode }) {
  return (
    <section className="mb-10">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-[26px] h-[26px] rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center text-primary text-[11px] font-extrabold shrink-0">{n}</div>
        <span className="text-[13px] font-bold text-foreground">{title}</span>
        <span className="text-[11px] text-muted-foreground">{concept}</span>
        <span className="ml-auto rounded-[4px] border border-[var(--color-border-subtle)] px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">{height}</span>
      </div>
      {children}
    </section>
  );
}

// ── Reference: the current group (for comparison) ────────────────────────────

function CurrentReference() {
  return (
    <div className={cn('flex items-center justify-between gap-3 border-y px-5 py-3 bg-[var(--color-card)]', LINE)}>
      <div className="flex items-center gap-3.5 min-w-0">
        <Vinyl size={64} />
        <div className="min-w-0">
          <div className="text-[21px] font-bold tracking-[-0.02em] truncate">{TRACK.title}</div>
          <div className="mt-0.5 text-xs font-medium text-muted-foreground">{TRACK.artist}</div>
          <div className="mt-2 flex items-center gap-4 text-[10px] font-semibold text-muted-foreground">
            <span><Label>BPM</Label> <strong className="ml-1 text-foreground/90">{TRACK.bpm}</strong></span>
            <span><Label>Key</Label> <strong className="ml-1" style={{ color: KEY_COLOR }}>{TRACK.key}</strong></span>
            <span><Label>Duration</Label> <strong className="ml-1 text-foreground/90">{TRACK.duration}</strong></span>
            <span className="flex items-center gap-1.5"><Label>Cues</Label><strong className="text-foreground/90">{TRACK.cues}</strong><Editing /><StatusChip /></span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <Btn className="h-[34px]">Pending {TRACK.pending}</Btn>
        <Btn className="h-[34px]" icon={<Idea size={16} />}>Auto Cue</Btn>
        <SplitApply />
      </div>
    </div>
  );
}

// ── 1. Compact Row ───────────────────────────────────────────────────────────
// Same structure as today, tightened: smaller artwork, title and artist share
// a line, stats sit directly under.

function LoadedCompact() {
  return (
    <div className={cn('flex items-center justify-between gap-3 border-y px-4 h-[60px] bg-[var(--color-card)]', LINE)}>
      <div className="flex items-center gap-3 min-w-0">
        <Vinyl size={40} />
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-[15px] font-bold tracking-[-0.01em] truncate">{TRACK.title}</span>
            <span className="text-[11px] text-muted-foreground truncate">{TRACK.artist}</span>
          </div>
          <div className="mt-1 flex items-center gap-3.5 text-[10px] font-semibold">
            <span><Label>BPM</Label> <strong className="ml-1 text-foreground/90">{TRACK.bpm}</strong></span>
            <span><Label>Key</Label> <strong className="ml-1" style={{ color: KEY_COLOR }}>{TRACK.key}</strong></span>
            <span><Label>Dur</Label> <strong className="ml-1 text-foreground/90">{TRACK.duration}</strong></span>
            <span className="flex items-center gap-1.5"><Label>Cues</Label><strong className="text-foreground/90">{TRACK.cues}</strong><Editing /><StatusChip /></span>
          </div>
        </div>
      </div>
      <Actions />
    </div>
  );
}

// ── 2. One-Line Bar ──────────────────────────────────────────────────────────
// Everything on a single 44px line: the smallest the group can get while
// keeping every value and button.

function LoadedOneLine() {
  return (
    <div className={cn('flex items-center gap-4 border-y px-4 h-[44px] bg-[var(--color-card)]', LINE)}>
      <Vinyl size={28} />
      <div className="flex items-baseline gap-2 min-w-0 shrink">
        <span className="text-sm font-bold truncate">{TRACK.title}</span>
        <span className="text-[11px] text-muted-foreground truncate">{TRACK.artist}</span>
      </div>
      <span className="h-4 w-px bg-[var(--color-border-subtle)] shrink-0" />
      <div className="flex items-center gap-3.5 text-[10px] font-semibold shrink-0">
        <span><Label>BPM</Label> <strong className="ml-1">{TRACK.bpm}</strong></span>
        <KeyBadge camelotKey={TRACK.key} className="!py-0.5 !text-[11px]" />
        <span><Label>Dur</Label> <strong className="ml-1">{TRACK.duration}</strong></span>
        <span><Label>Cues</Label> <strong className="ml-1">{TRACK.cues}</strong></span>
        <Editing /><StatusChip />
      </div>
      <div className="ml-auto"><Actions iconOnly /></div>
    </div>
  );
}

// ── 3. Two-Tier Slim ─────────────────────────────────────────────────────────
// Title line on top with actions; a quieter metadata line below on a darker
// band, like a DAW's track info row.

function LoadedTwoTier() {
  return (
    <div className={cn('border-y bg-[var(--color-card)]', LINE)}>
      <div className="flex items-center gap-3 px-4 h-[40px]">
        <Vinyl size={26} />
        <span className="text-[15px] font-bold tracking-[-0.01em] truncate">{TRACK.title}</span>
        <span className="text-[11px] text-muted-foreground truncate">{TRACK.artist}</span>
        <div className="ml-auto"><Actions /></div>
      </div>
      <div className={cn('flex items-center gap-5 px-4 h-[26px] border-t bg-black/20 text-[10px] font-semibold', LINE)}>
        <span><Label>BPM</Label> <strong className="ml-1">{TRACK.bpm}</strong></span>
        <span><Label>Key</Label> <strong className="ml-1" style={{ color: KEY_COLOR }}>{TRACK.key}</strong></span>
        <span><Label>Duration</Label> <strong className="ml-1">{TRACK.duration}</strong></span>
        <span><Label>Cues</Label> <strong className="ml-1">{TRACK.cues}</strong></span>
        <span className="flex items-center gap-2"><Editing /><StatusChip /></span>
      </div>
    </div>
  );
}

// ── 4. Readout Cells ─────────────────────────────────────────────────────────
// Stats become labeled cells with hairline dividers (label over value), the
// way hardware and DAW inspectors present them.

function Cell({ label, children, last = false }: { label: string; children: ReactNode; last?: boolean }) {
  return (
    <div className={cn('flex flex-col justify-center gap-0.5 px-4 h-full', !last && 'border-r', LINE)}>
      <Label>{label}</Label>
      <span className="text-[13px] font-semibold tabular-nums leading-none">{children}</span>
    </div>
  );
}

function LoadedCells() {
  return (
    <div className={cn('flex items-stretch border-y h-[56px] bg-[var(--color-card)]', LINE)}>
      <div className={cn('flex items-center gap-3 px-4 min-w-0 flex-1 border-r', LINE)}>
        <Vinyl size={36} />
        <div className="min-w-0">
          <div className="text-sm font-bold truncate leading-tight">{TRACK.title}</div>
          <div className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5">{TRACK.artist}</div>
        </div>
      </div>
      <Cell label="BPM">{TRACK.bpm}</Cell>
      <Cell label="Key"><span style={{ color: KEY_COLOR }}>{TRACK.key}</span></Cell>
      <Cell label="Duration">{TRACK.duration}</Cell>
      <Cell label="Cues">{TRACK.cues}</Cell>
      <Cell label="Mode" last><span className="flex items-center gap-1.5"><Editing /><StatusChip /></span></Cell>
      <div className={cn('flex items-center px-4 border-l', LINE)}><Actions /></div>
    </div>
  );
}

// ── 5. Key-Colored Ribbon ────────────────────────────────────────────────────
// The track's Camelot color runs down the left edge and tints the strip;
// monospace readout, icon-only secondary buttons so Apply All stays the focus.

function LoadedRibbon() {
  return (
    <div
      className={cn('relative flex items-center gap-4 border-y pl-5 pr-4 h-[50px] bg-[var(--color-card)] overflow-hidden', LINE)}
      style={{ backgroundImage: `linear-gradient(90deg, ${KEY_COLOR}14, transparent 38%)` }}
    >
      <span className="absolute left-0 inset-y-0 w-[3px]" style={{ background: KEY_COLOR }} />
      <Vinyl size={32} />
      <div className="min-w-0 leading-tight">
        <div className="text-sm font-bold truncate">{TRACK.title}</div>
        <div className="text-[10px] text-muted-foreground truncate">{TRACK.artist}</div>
      </div>
      <div className="flex items-center gap-4 ml-4 font-mono text-[12px] tabular-nums">
        <span className="font-bold">{TRACK.bpm}<span className="ml-1 text-[9px] font-sans font-semibold text-foreground/45">BPM</span></span>
        <KeyBadge camelotKey={TRACK.key} className="!text-[12px] !py-0.5" />
        <span>{TRACK.duration}</span>
        <span>{TRACK.cues}<span className="ml-1 text-[9px] font-sans font-semibold text-foreground/45">CUES</span></span>
        <span className="flex items-center gap-2 font-sans"><Editing /><StatusChip /></span>
      </div>
      <div className="ml-auto"><Actions iconOnly /></div>
    </div>
  );
}

// ── Tab content ──────────────────────────────────────────────────────────────

export function LoadedTrackMockupsContent() {
  return (
    <div className="h-full overflow-y-auto px-8 pt-7 pb-12 bg-[var(--color-background)]">
      <div className="mb-7">
        <div className="text-sm font-extrabold text-foreground mb-1">Loaded Track Header Concepts</div>
        <div className="text-[11px] text-muted-foreground leading-relaxed">
          Five restyles of the track group at the top of Cue Points. Each keeps the same content (artwork, title, artist, BPM, key, duration, cues, editing status, Pending, Auto Cue, Apply All) in less height than the current group.
        </div>
      </div>

      <MockupCard n={0} title="Current" concept="Reference, for height comparison" height="~90px">
        <CurrentReference />
      </MockupCard>
      <MockupCard n={1} title="Compact Row" concept="Same layout, tightened: title and artist share a line" height="60px">
        <LoadedCompact />
      </MockupCard>
      <MockupCard n={2} title="One-Line Bar" concept="Everything on one line; secondary buttons become icons" height="44px">
        <LoadedOneLine />
      </MockupCard>
      <MockupCard n={3} title="Two-Tier Slim" concept="Title and actions on top, quiet metadata band underneath" height="66px">
        <LoadedTwoTier />
      </MockupCard>
      <MockupCard n={4} title="Readout Cells" concept="Stats as labeled cells with hairline dividers" height="56px">
        <LoadedCells />
      </MockupCard>
      <MockupCard n={5} title="Key-Colored Ribbon" concept="Camelot color down the left edge, monospace readout" height="50px">
        <LoadedRibbon />
      </MockupCard>
    </div>
  );
}
