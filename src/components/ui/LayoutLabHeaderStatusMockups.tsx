import { useState, type CSSProperties, type ReactNode } from 'react';
import { Asterisk, Checkmark, ChevronDown, Document, Export, Idea, Pending, Repeat, Save, Time, VolumeUp, WarningAlt } from '@carbon/icons-react';
import { Grip, Magnet, Ruler } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Artwork } from './display';
import { camelotKeyColor } from './display/camelotKey';
import './layout-lab-track-headers.css';

// The Cue Points track header row (artwork, title, artist + stats, icon toolbar)
// with five ways to show the draft state that is currently "Editing" + a boxed badge.

type CueState = 'Original' | 'Unsaved' | 'Saved' | 'Needs Apply' | 'Applied' | 'Needs Verification';

const STATES: Array<{ id: CueState; color: string; note: string }> = [
  { id: 'Original', color: '#9aa5b8', note: 'Nothing saved yet' },
  { id: 'Unsaved', color: '#f0b35a', note: 'Edits not saved' },
  { id: 'Saved', color: '#5fb8e8', note: 'Saved as a draft' },
  { id: 'Needs Apply', color: '#a99bff', note: 'Ready to apply to Rekordbox' },
  { id: 'Applied', color: '#6fd9a4', note: 'Written to Rekordbox' },
  { id: 'Needs Verification', color: '#f27d96', note: 'Could not confirm against Rekordbox' },
];

const TRACK = { title: 'CID - Fancy. $hit (KALYP Remix) - Final 2026', artist: 'Artist Not Available', bpm: '140.00', key: '04A', duration: '2:31', cues: 3 };

// ── Header pieces ────────────────────────────────────────────────────────────

const ICON_BTN = 'lt-icon-btn';

function IconBtn({ children, active = false, dimmed = false, title, dot, color }: { children: ReactNode; active?: boolean; dimmed?: boolean; title?: string; dot?: string; color?: string }) {
  return (
    <button type="button" title={title} aria-label={title} style={color ? { color } : undefined} className={cn(ICON_BTN, active && 'is-active', dimmed && 'opacity-40')}>
      {children}
      {dot && <span className="absolute right-[6px] top-[6px] h-2 w-2 rounded-full ring-2 ring-[#252a36]" style={{ background: dot }} />}
    </button>
  );
}

/** Same icon-only row as production: Snap, Beat Count, grid, repeat, volume | Pending, Auto Cue, Apply All, menu. */
function Toolbar({ applyDot, applyTitle, statusIcon }: { applyDot?: string; applyTitle?: string; statusIcon?: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {statusIcon && (
        <>
          {statusIcon}
          <span className="mx-1.5 h-5 w-px bg-[#ffffff1a]" aria-hidden="true" />
        </>
      )}
      <IconBtn title="Snap: 1 Beat" active><Magnet size={18} /></IconBtn>
      <IconBtn title="Beat Count: Beats"><Ruler size={18} /></IconBtn>
      <IconBtn title="Hide grid" active><Grip size={18} /></IconBtn>
      <IconBtn title="Repeat current track"><Repeat size={20} /></IconBtn>
      <IconBtn title="Volume"><VolumeUp size={20} /></IconBtn>
      <span className="mx-1.5 h-5 w-px bg-[#ffffff1a]" aria-hidden="true" />
      <IconBtn title="Pending changes"><Pending size={20} /></IconBtn>
      <IconBtn title="Auto Cue"><Idea size={20} /></IconBtn>
      <IconBtn title={applyTitle ?? 'Apply All'} dot={applyDot}><Export size={20} /></IconBtn>
      <button type="button" aria-label="Open Apply menu" className="flex h-9 w-6 items-center justify-center text-muted-foreground hover:text-foreground"><ChevronDown size={15} /></button>
    </div>
  );
}

const LABEL = 'lt-label';

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return <span><span className={LABEL}>{label}</span> <strong className="ml-1 text-foreground/90">{children}</strong></span>;
}

function BaseStats({ cuesExtra }: { cuesExtra?: ReactNode }) {
  return (
    <>
      <Stat label="BPM">{TRACK.bpm}</Stat>
      <span><span className={LABEL}>Key</span> <strong className="ml-1" style={{ color: camelotKeyColor(TRACK.key) }}>{TRACK.key}</strong></span>
      <Stat label="Duration">{TRACK.duration}</Stat>
      <span className="flex items-center gap-1.5">
        <span className={LABEL}>Cues</span>
        <strong className="text-foreground/90">{TRACK.cues}</strong>
        {cuesExtra}
      </span>
    </>
  );
}

/** One icon per state, used by the toolbar icon (option 1) and the album art badge (option 4). */
function stateIcon(state: CueState, size: number): ReactNode {
  switch (state) {
    case 'Original': return <Document size={size} />;
    case 'Unsaved': return <Asterisk size={size} />;
    case 'Saved': return <Save size={size} />;
    case 'Needs Apply': return <Time size={size} />;
    case 'Applied': return <Checkmark size={size + 1} />;
    case 'Needs Verification': return <WarningAlt size={size} />;
  }
}

/** The header row itself. Each option fills different slots and styles the row differently. */
function HeaderRow({
  stats, toolbar, titleExtra, eyebrow, artworkOverlay, rightCaption, rowStyle, rowClassName, footer, rail, surface = 'lt-s-panel',
}: {
  stats: ReactNode;
  toolbar: ReactNode;
  titleExtra?: ReactNode;
  eyebrow?: ReactNode;
  artworkOverlay?: ReactNode;
  rightCaption?: ReactNode;
  rowStyle?: CSSProperties;
  rowClassName?: string;
  footer?: ReactNode;
  rail?: string;
  /** The strip's surface: one of the lt-s-* classes. */
  surface?: string;
}) {
  return (
    <div className={cn('relative overflow-hidden', surface)} style={rowStyle}>
      {rail && <span className="lt-rail" style={{ '--lt-key': rail } as CSSProperties} />}
      <div className={cn('flex flex-row items-center justify-between gap-3 px-5 py-2', rowClassName)}>
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          <div className="relative shrink-0">
            <div className="lt-art h-9 w-9 rounded-[10px]"><Artwork src={null} alt="" fallbackTitle="No artwork" className="h-full w-full rounded-[10px] bg-transparent" /></div>
            {artworkOverlay}
          </div>
          <div className="min-w-0 flex-1">
            {eyebrow}
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-medium leading-tight tracking-[-0.02em] text-white md:text-[18px]">{TRACK.title}</h1>
              {titleExtra}
            </div>
            <div className="flex min-w-0 items-center gap-4">
              <p className="min-w-0 truncate text-xs font-medium leading-tight text-muted-foreground">{TRACK.artist}</p>
              <div className="flex shrink-0 items-center gap-x-4 text-[10px] font-semibold text-muted-foreground">{stats}</div>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end">
          {toolbar}
          {rightCaption}
        </div>
      </div>
      {footer}
    </div>
  );
}

// ── The options ──────────────────────────────────────────────────────────────

const colorOf = (state: CueState) => STATES.find((s) => s.id === state)!.color;

/** Today: static "Editing" plus a boxed badge. */
function Current({ state }: { state: CueState }) {
  return (
    <HeaderRow
      toolbar={<Toolbar />}
      stats={<BaseStats cuesExtra={(
        <>
          <span className="lt-editing">Editing</span>
          <span className="lt-chip">{state}</span>
        </>
      )}
      />}
    />
  );
}

/** 1. An icon-only status button at the far left of the toolbar: one icon and one color per state. */
function ToolbarIcon({ state }: { state: CueState }) {
  return (
    <HeaderRow
      surface="lt-s-raised"
      stats={<BaseStats />}
      toolbar={<Toolbar statusIcon={<IconBtn title={`Cue state: ${state}`} color={colorOf(state)}>{stateIcon(state, 20)}</IconBtn>} />}
    />
  );
}

/** 2. A color rail down the left edge with a soft wash, and a small label above the title. */
function RailAndEyebrow({ state }: { state: CueState }) {
  const color = colorOf(state);
  return (
    <HeaderRow
      surface="lt-s-tinted"
      rail={color}
      rowStyle={{ '--lt-key': color } as CSSProperties}
      eyebrow={<div className="mb-0.5 text-[9px] font-bold uppercase leading-none tracking-[0.22em]" style={{ color }}>{state}</div>}
      stats={<BaseStats />}
      toolbar={<Toolbar />}
    />
  );
}

/** 3. A workflow strip along the bottom edge showing where the cues are in the process. */
const STEPS: Array<{ label: string; states: CueState[] }> = [
  { label: 'Original', states: ['Original', 'Unsaved'] },
  { label: 'Saved', states: ['Saved'] },
  { label: 'Needs apply', states: ['Needs Apply'] },
  { label: 'Applied', states: ['Applied', 'Needs Verification'] },
];

function WorkflowStrip({ state }: { state: CueState }) {
  const color = colorOf(state);
  const current = STEPS.findIndex((step) => step.states.includes(state));
  return (
    <HeaderRow
      surface="lt-s-tier"
      stats={<BaseStats />}
      toolbar={<Toolbar />}
      footer={(
        <div className="lt-tier-wash grid grid-cols-4 gap-1.5 px-5 pb-2 pt-2">
          {STEPS.map((step, i) => {
            const done = i < current;
            const active = i === current;
            return (
              <div key={step.label} className="min-w-0">
                <div className="h-[2px] rounded-full" style={{ background: done || active ? color : 'rgba(255,255,255,0.1)', opacity: done ? 0.45 : 1 }} />
                <div className="mt-1 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: active ? color : 'rgba(255,255,255,0.28)' }}>
                  {step.label}
                  {active && state !== step.label && <span className="font-semibold normal-case tracking-normal opacity-80">· {state}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    />
  );
}

/** 4. A small icon badge on the corner of the album art, with a state-colored ring. */

function ArtBadge({ state }: { state: CueState }) {
  const color = colorOf(state);
  return (
    <HeaderRow
      surface="lt-s-well"
      stats={<BaseStats />}
      toolbar={<Toolbar />}
      artworkOverlay={(
        <>
          <span className="pointer-events-none absolute inset-0 rounded-[7px]" style={{ boxShadow: `inset 0 0 0 1.5px ${color}` }} />
          <span
            title={state}
            aria-label={`Cue state: ${state}`}
            className="absolute -bottom-1.5 -right-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full text-[#14171d] ring-2 ring-[#1b1f28]"
            style={{ background: color }}
          >
            {stateIcon(state, 10)}
          </span>
        </>
      )}
    />
  );
}

/** 5. A plain-language caption under the toolbar icons, right-aligned. */
const CAPTION: Record<CueState, string> = {
  Original: 'No changes yet',
  Unsaved: 'Unsaved edits',
  Saved: 'Draft saved',
  'Needs Apply': 'Ready to apply',
  Applied: 'Applied to Rekordbox',
  'Needs Verification': "Couldn't verify with Rekordbox",
};

function ToolbarCaption({ state }: { state: CueState }) {
  const color = colorOf(state);
  return (
    <HeaderRow
      surface="lt-s-brushed"
      stats={<BaseStats />}
      toolbar={<Toolbar />}
      rightCaption={(
        <div className="-mt-0.5 flex items-center gap-1.5 text-[11px] font-medium" style={{ color }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
          {CAPTION[state]}
        </div>
      )}
    />
  );
}

const OPTIONS: Array<{ n: number; title: string; where: string; render: (state: CueState) => ReactNode }> = [
  { n: 0, title: 'Current', where: 'Static "Editing" plus a boxed badge after the cue count', render: (s) => <Current state={s} /> },
  { n: 1, title: 'Toolbar icon', where: 'Top right: one icon-only button at the far left of the icon row, in the same size as the others; each state has its own icon and its own color, and hovering names it', render: (s) => <ToolbarIcon state={s} /> },
  { n: 2, title: 'Color rail + label', where: 'Left edge: a full-height color rail and soft wash, with the state as a small label above the title', render: (s) => <RailAndEyebrow state={s} /> },
  { n: 3, title: 'Workflow strip', where: 'Bottom edge: a four-step strip (Original, Saved, Needs apply, Applied) with your position highlighted', render: (s) => <WorkflowStrip state={s} /> },
  { n: 4, title: 'Album art badge', where: 'On the album art: a colored ring and a corner badge with an icon for each state', render: (s) => <ArtBadge state={s} /> },
  { n: 5, title: 'Caption under the icons', where: 'Bottom right: a plain-language sentence under the toolbar, like "Ready to apply"', render: (s) => <ToolbarCaption state={s} /> },
];

// ── Tab content ──────────────────────────────────────────────────────────────

export function HeaderStatusMockupsContent() {
  const [state, setState] = useState<CueState>('Unsaved');
  const info = STATES.find((s) => s.id === state)!;
  return (
    <div className="lt-lab h-full overflow-y-auto bg-[var(--color-background)] px-8 pb-16 pt-7">
      <div className="mb-5">
        <div className="mb-1 text-foreground" style={{ fontWeight: 300, fontSize: 24, letterSpacing: '-0.03em' }}>Track Header: Cue State</div>
        <div className="max-w-[900px] text-[11px] leading-relaxed text-muted-foreground">
          The full header row above the cue timeline, at production size, with the icon-only toolbar and the 36px artwork. Option 0 is today's header. Options 1 to 5 each show the cue state in a different place with a different look: an icon in the toolbar, a color rail with a label, a workflow strip, a badge on the album art, and a caption under the icons. Pick a state below and every header updates, so you can compare how each option handles each state. Hover the badge in 4 for its tooltip.
        </div>
      </div>

      <div className="lt-sticky">
        <div className="flex flex-wrap items-center gap-2">
          <span className="lt-label mr-1">State</span>
          {STATES.map((s) => (
            <button key={s.id} type="button" onClick={() => setState(s.id)} aria-pressed={state === s.id} className="lt-state-btn">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.id}
            </button>
          ))}
          <span className="ml-2 text-[11px] text-muted-foreground">{info.note}</span>
        </div>
      </div>

      {OPTIONS.map((o) => (
        <section key={o.n} className="mb-9">
          <div className="mb-2 flex items-center gap-2.5">
            <div className="lt-number">{o.n}</div>
            <span className="text-[13px] font-bold text-foreground">{o.title}</span>
            <span className="text-[11px] text-muted-foreground">{o.where}</span>
          </div>
          <div className="lt-stage">
            <div className="lt-inner">{o.render(state)}</div>
          </div>
        </section>
      ))}
    </div>
  );
}
