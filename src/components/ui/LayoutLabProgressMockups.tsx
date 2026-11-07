import { useEffect, useState, type ReactNode } from 'react';
import { Checkmark, CheckmarkFilled, CircleDash, Pause, Play } from '@carbon/icons-react';
import { cn } from '../../lib/utils';
import { PROCESSES, progressModel, type ProgressModel } from './layoutLabProgressData';
import './layout-lab-progress.css';

// Ten ways to show progress, all in the graphite look of Audition and Discovery (the Quiet Figure row is the reference). Every row
// shows the same three jobs (the Rekordbox import, the artist set search and the cloud sync) and every look names every phase of
// the job, numbered, with the finished ones, the current one and the ones still to come told apart. One shared slider moves all of them.

// The palette of the graphite look: one coral accent, a soft mint for finished work, and quiet greys.
const GREEN = '#34d399';
const RED = '#f56b70';
const ACCENT = '#f56b70';
const ACCENT_2 = '#f78361';
const MINT = '#6fd9a4';
const IDLE = '#566074';
const MUTED = '#9aa5b8';

type PhaseState = 'done' | 'active' | 'todo';
const stateOf = (m: ProgressModel, index: number): PhaseState => (m.done || index < m.stageIndex ? 'done' : index === m.stageIndex ? 'active' : 'todo');
const toneOf = (m: ProgressModel, index: number) => { const state = stateOf(m, index); return state === 'done' ? MINT : state === 'active' ? ACCENT : IDLE; };
const num = (index: number) => String(index + 1).padStart(2, '0');
const statusText = (m: ProgressModel, index: number) => { const state = stateOf(m, index); return state === 'done' ? 'Done' : state === 'active' ? `${m.stagePercent}%` : 'Waiting'; };

function Headline({ m, className }: { m: ProgressModel; className?: string }) {
  return <p className={cn('text-[12px] leading-tight text-[#cdd3dd]', className)}>{m.headline}</p>;
}

/** The three figures of a job: light 20px numbers over 9px spaced labels, with hairlines between (the Audition header stats). `centered` puts each value and its label in the middle of its own cell. */
function Figures({ m, className, centered = false }: { m: ProgressModel; className?: string; centered?: boolean }) {
  return (
    <div className={cn('lp-figures', centered && 'lp-figures-centered', className)}>
      {m.figures.map(({ label, value }) => (
        <div key={label}><p>{value}</p><small>{label}</small></div>
      ))}
    </div>
  );
}

/** The big light percentage and where the job is, shared by the looks that lead with a figure. */
function PercentHead({ m }: { m: ProgressModel }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <p className="lp-percent">{Math.round(m.percent)}<span>%</span></p>
      <p className="lp-label pb-1 text-right">Phase {m.stageIndex + 1} of {m.process.steps.length}</p>
    </div>
  );
}

// ── The ten looks ────────────────────────────────────────────────────────────

/** 1. Stage Rail: an icon and name for every phase over one hairline rail with a dot per phase. */
function StageRail({ m }: { m: ProgressModel }) {
  const steps = m.process.steps;
  const column = 100 / steps.length;
  const edge = column / 2;
  return (
    <div className="space-y-3">
      <ol aria-label={`${m.process.title} phases`} className="grid" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((step, i) => {
          const state = stateOf(m, i);
          return (
            <li key={step.id} data-phase-state={state} aria-current={state === 'active' && !m.done ? 'step' : undefined} className="flex flex-col items-center gap-1.5">
              <span className="relative" style={{ color: toneOf(m, i) }}>
                <step.Icon size={18} />
                {state === 'done' && <span className="lp-tick"><Checkmark size={8} /></span>}
              </span>
              <span className="text-[11px] font-light leading-none tabular-nums" style={{ color: state === 'todo' ? IDLE : '#f6f7fa' }}>{num(i)}</span>
              <span className="break-words text-center text-[9px] uppercase leading-[1.3] tracking-[0.16em]" style={{ color: state === 'todo' ? IDLE : state === 'active' ? '#f6f7fa' : MUTED }}>{step.label}</span>
            </li>
          );
        })}
      </ol>
      <div className="relative h-3" aria-hidden="true">
        <div className="absolute top-1/2 h-px bg-white/10" style={{ left: `${edge}%`, right: `${edge}%` }} />
        <div className="absolute top-1/2 h-px transition-all" style={{ left: `${edge}%`, width: `${m.stageIndex * column}%`, background: m.done ? MINT : ACCENT }} />
        {steps.map((step, i) => (
          <span key={step.id} className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${edge + i * column}%`, background: stateOf(m, i) === 'todo' ? '#1d2129' : toneOf(m, i), border: stateOf(m, i) === 'todo' ? '1px solid #ffffff1f' : 'none', boxShadow: stateOf(m, i) === 'active' ? `0 0 8px ${ACCENT}` : 'none' }} />
        ))}
      </div>
      <Headline m={m} className="text-center" />
    </div>
  );
}

/** 2. Segmented Bar: a sunken segment for each phase that fills in coral, with the phase's number and name under it. */
function Segmented({ m }: { m: ProgressModel }) {
  return (
    <div className="space-y-3.5">
      <PercentHead m={m} />
      <ol aria-label={`${m.process.title} phases`} className="flex gap-1.5">
        {m.process.steps.map((step, i) => {
          const state = stateOf(m, i);
          const fill = state === 'done' ? 100 : state === 'active' ? m.stagePercent : 0;
          return (
            <li key={step.id} data-phase-state={state} aria-current={state === 'active' && !m.done ? 'step' : undefined} className="min-w-0 flex-1">
              <div className="lp-well h-2 overflow-hidden rounded-full"><div className="h-full rounded-full transition-all" style={{ width: `${fill}%`, background: state === 'done' ? MINT : `linear-gradient(90deg, ${ACCENT}, ${ACCENT_2})` }} /></div>
              <p className="mt-2 text-[11px] font-light leading-none tabular-nums" style={{ color: state === 'todo' ? IDLE : '#f6f7fa' }}>{num(i)}</p>
              <p className="mt-1 break-words text-[9px] uppercase leading-[1.3] tracking-[0.16em]" style={{ color: state === 'active' ? ACCENT_2 : state === 'done' ? MUTED : IDLE }}>{step.label}</p>
            </li>
          );
        })}
      </ol>
      <Headline m={m} />
    </div>
  );
}

/** 3. Chevron Steps: raised graphite arrows pointing the way. Finished ones are lit, the current one is warmed with coral, the rest are sunk. */
function Chevrons({ m }: { m: ProgressModel }) {
  return (
    <div className="space-y-3">
      <ol aria-label={`${m.process.title} phases`} className="flex">
        {m.process.steps.map((step, i) => {
          const state = stateOf(m, i);
          return (
            <li
              key={step.id}
              data-phase-state={state}
              aria-current={state === 'active' && !m.done ? 'step' : undefined}
              className={cn('lp-chevron', i > 0 && '-ml-2')}
              style={{
                background: state === 'done' ? 'linear-gradient(165deg, #434b5b, #323946)' : state === 'active' ? `linear-gradient(165deg, ${ACCENT}66, ${ACCENT}26)` : '#14171d',
                color: state === 'todo' ? IDLE : state === 'active' ? '#fff' : MINT,
              }}
            >
              <span className="text-[11px] font-light tabular-nums">{num(i)}</span>
              <span className="break-words text-center text-[9px] uppercase leading-[1.2] tracking-[0.12em]">{step.label}</span>
            </li>
          );
        })}
      </ol>
      <Headline m={m} />
    </div>
  );
}

/** 4. Ring Gauge: a thin coral ring with the light percentage inside, and every phase listed beside it. */
function Ring({ m }: { m: ProgressModel }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const id = `lp-ring-${m.process.id}`;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-5">
        <div className="relative h-[88px] w-[88px] shrink-0">
          <svg viewBox="0 0 88 88" className="-rotate-90" aria-hidden="true">
            <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={ACCENT_2} /><stop offset="1" stopColor={ACCENT} /></linearGradient></defs>
            <circle cx="44" cy="44" r={r} fill="none" stroke="#13161c" strokeWidth="6" />
            <circle cx="44" cy="44" r={r} fill="none" stroke={m.done ? MINT : `url(#${id})`} strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - m.percent / 100)} style={{ transition: 'stroke-dashoffset 200ms', filter: `drop-shadow(0 0 4px ${m.done ? MINT : ACCENT}80)` }} />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[22px] font-light tabular-nums tracking-[-0.04em]">{m.done ? <Checkmark size={24} style={{ color: MINT }} /> : `${Math.round(m.percent)}`}</span>
        </div>
        <ol aria-label={`${m.process.title} phases`} className="min-w-0 flex-1 space-y-1.5">
          {m.process.steps.map((step, i) => {
            const state = stateOf(m, i);
            return (
              <li key={step.id} data-phase-state={state} aria-current={state === 'active' && !m.done ? 'step' : undefined} className="flex items-center gap-2 text-[9px] uppercase leading-none tracking-[0.16em]" style={{ color: state === 'active' ? '#f6f7fa' : state === 'done' ? MUTED : IDLE }}>
                <span className="w-4 text-[11px] font-light tabular-nums">{num(i)}</span>
                <span className="truncate">{step.label}</span>
                <span className="ml-auto h-1.5 w-1.5 rounded-full" style={{ background: state === 'todo' ? 'transparent' : toneOf(m, i), border: state === 'todo' ? '1px solid #ffffff26' : 'none', boxShadow: state === 'active' ? `0 0 6px ${ACCENT}` : 'none' }} />
              </li>
            );
          })}
        </ol>
      </div>
      <Headline m={m} />
    </div>
  );
}

/** 5. Timeline: a numbered list, one row for every phase, with hairlines between them and a status on the right. */
function Timeline({ m }: { m: ProgressModel }) {
  return (
    <ol aria-label={`${m.process.title} phases`} className="lp-timeline">
      {m.process.steps.map((step, i) => {
        const state = stateOf(m, i);
        return (
          <li key={step.id} data-phase-state={state} aria-current={state === 'active' && !m.done ? 'step' : undefined}>
            <span className="lp-glyph" style={{ borderColor: state === 'todo' ? '#ffffff26' : toneOf(m, i), background: state === 'done' ? MINT : 'transparent', boxShadow: state === 'active' ? `0 0 8px ${ACCENT}80` : 'none' }}>
              {state === 'done' ? <Checkmark size={9} className="text-[#14171d]" /> : state === 'active' ? <CircleDash size={9} className="animate-spin" style={{ color: ACCENT }} /> : null}
            </span>
            <span className="w-5 text-[11px] font-light tabular-nums" style={{ color: state === 'todo' ? IDLE : MUTED }}>{num(i)}</span>
            <span className="text-[12px]" style={{ color: state === 'todo' ? IDLE : '#f6f7fa' }}>{step.label}</span>
            <span className="ml-auto text-[9px] uppercase tracking-[0.16em] tabular-nums" style={{ color: state === 'active' ? ACCENT_2 : state === 'done' ? MINT : IDLE }}>{statusText(m, i)}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * 6. Quiet Figure: a light percentage and, underneath, the phases as hairline segments with numbered spaced-caps labels
 * (the Audition style). Finished phases are filled, the current one fills as it goes, the rest are empty.
 */
function QuietFigure({ m }: { m: ProgressModel }) {
  const steps = m.process.steps;
  const accent = m.done ? GREEN : RED;
  return (
    <div className="space-y-3.5" style={{ fontFamily: "'Helvetica Neue','Segoe UI',Arial,sans-serif" }}>
      <div className="flex items-end justify-between gap-3">
        <p className="text-[34px] font-light leading-none tracking-[-0.04em] tabular-nums">{Math.round(m.percent)}<span className="text-[16px] text-muted-foreground">%</span></p>
        <p className="pb-1 text-right text-[9px] uppercase tracking-[0.16em] text-[#9aa5b8]">
          Phase {m.stageIndex + 1} of {steps.length}
        </p>
      </div>
      <ol aria-label={`${m.process.title} phases`} className="flex gap-1.5" data-testid="quiet-phases">
        {steps.map((step, i) => {
          const state = stateOf(m, i);
          const fill = state === 'done' ? 100 : state === 'active' ? m.stagePercent : 0;
          return (
            <li key={step.id} data-phase-state={state} className="min-w-0 flex-1" aria-current={state === 'active' && !m.done ? 'step' : undefined}>
              <div className="h-px w-full bg-white/10"><div className="h-px transition-all" style={{ width: `${fill}%`, background: accent }} /></div>
              <p className="mt-2 font-light tabular-nums leading-none" style={{ fontSize: 11, color: state === 'todo' ? '#566074' : '#f6f7fa' }}>{String(i + 1).padStart(2, '0')}</p>
              <p className="mt-1 break-words text-[9px] uppercase leading-[1.3] tracking-[0.16em]" style={{ color: state === 'active' ? accent : state === 'done' ? '#9aa5b8' : '#566074' }}>{step.label}</p>
            </li>
          );
        })}
      </ol>
      <p className="text-[11px] text-[#a4adbd]">{m.headline}</p>
    </div>
  );
}

/** 7. Stage Bars: every phase, the last one too, has its own sunken bar and a status, like a checklist. */
function StageBars({ m }: { m: ProgressModel }) {
  return (
    <ol aria-label={`${m.process.title} phases`} className="space-y-2.5">
      {m.process.steps.map((step, i) => {
        const state = stateOf(m, i);
        const pct = state === 'done' ? 100 : state === 'active' ? m.stagePercent : 0;
        return (
          <li key={step.id} data-phase-state={state} aria-current={state === 'active' && !m.done ? 'step' : undefined}>
            <div className="mb-1.5 flex items-baseline gap-2">
              <span className="w-5 text-[11px] font-light tabular-nums" style={{ color: state === 'todo' ? IDLE : MUTED }}>{num(i)}</span>
              <span className="text-[9px] uppercase tracking-[0.16em]" style={{ color: state === 'active' ? '#f6f7fa' : state === 'done' ? MUTED : IDLE }}>{step.label}</span>
              <span className="ml-auto text-[9px] uppercase tracking-[0.16em] tabular-nums" style={{ color: state === 'active' ? ACCENT_2 : state === 'done' ? MINT : IDLE }}>{statusText(m, i)}</span>
            </div>
            <div className="lp-well h-1 overflow-hidden rounded-full"><div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: state === 'done' ? MINT : `linear-gradient(90deg, ${ACCENT}, ${ACCENT_2})` }} /></div>
          </li>
        );
      })}
    </ol>
  );
}

/** 8. Waveform: the progress fills a gray waveform like a track playing; the phases are marked along it, each named under its stretch. */
function WaveBars({ m }: { m: ProgressModel }) {
  const bars = 64;
  const steps = m.process.steps;
  const working = steps.length - 1;
  return (
    <div className="space-y-2.5">
      <div className="relative flex h-[46px] items-center gap-[1px]">
        {Array.from({ length: bars }).map((_, i) => {
          const h = 18 + Math.abs(Math.sin(i * 0.7) * 22 + Math.sin(i * 0.23) * 14);
          const filled = (i / bars) * 100 < m.percent;
          return <span key={i} className="flex-1 rounded-full transition-colors" style={{ height: `${h}px`, background: '#8997AE', opacity: filled ? 1 : 0.32 }} />;
        })}
        {Array.from({ length: working - 1 }).map((_, k) => <span key={k} className="absolute inset-y-0 w-px bg-white/15" style={{ left: `${((k + 1) / working) * 100}%` }} aria-hidden="true" />)}
        {!m.done && m.percent > 0 && <span className="absolute inset-y-[-3px] w-0.5 rounded-full" style={{ left: `${m.percent}%`, background: ACCENT_2, boxShadow: `0 0 8px ${ACCENT_2}` }} aria-hidden="true" />}
      </div>
      <ol aria-label={`${m.process.title} phases`} className="flex">
        {steps.slice(0, working).map((step, i) => {
          const state = stateOf(m, i);
          return (
            <li key={step.id} data-phase-state={state} aria-current={state === 'active' && !m.done ? 'step' : undefined} className="min-w-0 flex-1 pr-1">
              <p className="text-[11px] font-light leading-none tabular-nums" style={{ color: state === 'todo' ? IDLE : '#f6f7fa' }}>{num(i)}</p>
              <p className="mt-1 break-words text-[9px] uppercase leading-[1.3] tracking-[0.16em]" style={{ color: state === 'active' ? ACCENT_2 : state === 'done' ? MUTED : IDLE }}>{step.label}</p>
            </li>
          );
        })}
        <li data-phase-state={stateOf(m, working)} className="shrink-0 text-right">
          <p className="text-[11px] font-light leading-none tabular-nums" style={{ color: m.done ? '#f6f7fa' : IDLE }}>{num(working)}</p>
          <p className="mt-1 text-[9px] uppercase leading-[1.3] tracking-[0.16em]" style={{ color: m.done ? MINT : IDLE }}>{steps[working].label}</p>
        </li>
      </ol>
      <Headline m={m} />
    </div>
  );
}

/** 9. Pills: a raised graphite capsule for every phase. Finished ones carry a mint tick, the current one glows coral. */
function Pills({ m }: { m: ProgressModel }) {
  return (
    <div className="space-y-3">
      <ol aria-label={`${m.process.title} phases`} className="flex flex-wrap gap-2">
        {m.process.steps.map((step, i) => {
          const state = stateOf(m, i);
          return (
            <li key={step.id} data-phase-state={state} aria-current={state === 'active' && !m.done ? 'step' : undefined} className={cn('lp-pill', `lp-pill-${state}`)}>
              {state === 'done' ? <Checkmark size={11} /> : state === 'active' ? <CircleDash size={11} className="animate-spin" /> : null}
              <span className="text-[11px] font-light tabular-nums">{num(i)}</span>
              <span className="text-[9px] uppercase tracking-[0.16em]">{step.label}</span>
              {state === 'active' && <span className="text-[9px] tabular-nums tracking-[0.08em]">{m.stagePercent}%</span>}
            </li>
          );
        })}
      </ol>
      <Headline m={m} />
    </div>
  );
}

/** 10. LED Meter: lit segments in a group for each phase, the phase's number and name under its group, a mono readout above. */
function LedMeter({ m }: { m: ProgressModel }) {
  const steps = m.process.steps;
  const working = steps.length - 1;
  const perGroup = Math.round(28 / working);
  const lit = Math.round((m.percent / 100) * perGroup * working);
  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline justify-between text-[9px] uppercase tracking-[0.16em]" style={{ color: MUTED }}>
        <span>Level</span><span className="font-mono tabular-nums text-[#f6f7fa]">{String(Math.round(m.percent)).padStart(3, '0')}%</span>
      </div>
      <ol aria-label={`${m.process.title} phases`} className="flex gap-3">
        {steps.slice(0, working).map((step, g) => {
          const state = stateOf(m, g);
          return (
            <li key={step.id} data-phase-state={state} aria-current={state === 'active' && !m.done ? 'step' : undefined} className="min-w-0 flex-1">
              <div className="flex gap-[2px]">
                {Array.from({ length: perGroup }).map((_, k) => {
                  const on = g * perGroup + k < lit;
                  return <span key={k} className="h-4 flex-1 rounded-[2px]" style={{ background: on ? (m.done ? MINT : state === 'done' ? MINT : `linear-gradient(180deg, ${ACCENT_2}, ${ACCENT})`) : '#13161c', boxShadow: on ? `0 0 6px ${m.done || state === 'done' ? MINT : ACCENT}59` : 'inset 0 1px 2px #000000a6' }} />;
                })}
              </div>
              <p className="mt-2 text-[11px] font-light leading-none tabular-nums" style={{ color: state === 'todo' ? IDLE : '#f6f7fa' }}>{num(g)}</p>
              <p className="mt-1 break-words text-[9px] uppercase leading-[1.3] tracking-[0.16em]" style={{ color: state === 'active' ? ACCENT_2 : state === 'done' ? MUTED : IDLE }}>{step.label}</p>
            </li>
          );
        })}
        <li data-phase-state={stateOf(m, working)} className="shrink-0 text-right">
          <div className="flex justify-end"><span className="h-4 w-3 rounded-[2px]" style={{ background: m.done ? MINT : '#13161c', boxShadow: m.done ? `0 0 6px ${MINT}59` : 'inset 0 1px 2px #000000a6' }} /></div>
          <p className="mt-2 text-[11px] font-light leading-none tabular-nums" style={{ color: m.done ? '#f6f7fa' : IDLE }}>{num(working)}</p>
          <p className="mt-1 text-[9px] uppercase leading-[1.3] tracking-[0.16em]" style={{ color: m.done ? MINT : IDLE }}>{steps[working].label}</p>
        </li>
      </ol>
      <Headline m={m} />
    </div>
  );
}

const PROGRESS_LOOKS: { id: string; title: string; concept: string; Look: (props: { m: ProgressModel }) => ReactNode; withFigures?: boolean; centerFigures?: boolean }[] = [
  { id: 'stage-rail', title: 'Stage Rail', concept: 'An icon and name for every phase over one hairline rail with a dot per phase', Look: StageRail, withFigures: true },
  { id: 'segmented', title: 'Segmented Bar', concept: 'A sunken segment for each phase, filling in coral, with its number and name', Look: Segmented, withFigures: true },
  { id: 'chevrons', title: 'Chevron Steps', concept: 'Raised graphite arrows: finished ones lit, the current one warmed with coral', Look: Chevrons, withFigures: true },
  { id: 'ring', title: 'Ring Gauge', concept: 'A thin coral ring with the percentage inside and every phase listed beside it', Look: Ring, withFigures: true },
  { id: 'timeline', title: 'Timeline', concept: 'A numbered list, one row per phase, with a status on the right', Look: Timeline },
  { id: 'quiet', title: 'Quiet Figure', concept: 'A light percentage over numbered phase hairlines, in the Audition style', Look: QuietFigure, withFigures: true, centerFigures: true },
  { id: 'stage-bars', title: 'Stage Bars', concept: 'Every phase gets its own sunken bar and a status, like a checklist', Look: StageBars },
  { id: 'waveform', title: 'Waveform', concept: 'A gray waveform that fills like a track playing, with each phase named along it', Look: WaveBars },
  { id: 'pills', title: 'Pills', concept: 'A raised capsule for every phase; the current one glows coral', Look: Pills, withFigures: true },
  { id: 'led', title: 'LED Meter', concept: 'Lit segments in a group for each phase, named under its group', Look: LedMeter },
];

// ── Tab content ──────────────────────────────────────────────────────────────

export function ProgressMockupsContent() {
  const [percent, setPercent] = useState(62);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setInterval(() => setPercent((p) => (p >= 100 ? 0 : Math.min(100, p + 1))), 90);
    return () => window.clearInterval(timer);
  }, [playing]);

  return (
    <div className="lp-lab h-full overflow-y-auto bg-[var(--color-background)] px-8 pb-12 pt-7" data-testid="progress-mockups">
      <div className="mb-5 max-w-[860px]">
        <div className="mb-1 text-foreground" style={{ fontWeight: 300, fontSize: 24, letterSpacing: '-0.03em' }}>Progress Concepts</div>
        <div className="text-[11px] leading-relaxed text-muted-foreground">
          Ten ways to show a long job moving along. Every row shows the same three jobs (the Rekordbox import, the artist set search and the cloud sync), so the looks can be compared side by side. Drag the slider, or press play, to move all of them together.
        </div>
      </div>

      <div className="lp-sticky">
        <button type="button" aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying((p) => !p)} className="lp-play">
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <input type="range" min={0} max={100} value={percent} onChange={(e) => { setPlaying(false); setPercent(Number(e.target.value)); }} className="flex-1" aria-label="Progress" style={{ accentColor: ACCENT }} />
        <span className="w-12 text-right text-[12px] font-light tabular-nums">{percent}%</span>
        <button type="button" onClick={() => { setPlaying(false); setPercent(100); }} className="flex items-center gap-1.5 text-[11px]" style={{ color: MINT }}><CheckmarkFilled size={13} /> Finish</button>
      </div>

      {PROGRESS_LOOKS.map(({ id, title, concept, Look, withFigures, centerFigures }, index) => (
        <section key={id} className="mb-10" data-testid="progress-look" data-look={id}>
          <div className="mb-3 flex items-center gap-2.5">
            <div className="lp-number">{index + 1}</div>
            <span className="text-[13px] font-medium text-foreground">{title}</span>
            <span className="text-[11px] text-muted-foreground">{concept}</span>
          </div>
          <div className="lp-stage grid grid-cols-1 gap-4 xl:grid-cols-3">
            {PROCESSES.map((process) => {
              const m = progressModel(process, percent);
              return (
                <div key={process.id} data-process={process.id} className="lp-card">
                  <p className="lp-label mb-3">{process.title}</p>
                  <Look m={m} />
                  {withFigures && <Figures m={m} className="mt-4" centered={centerFigures} />}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
