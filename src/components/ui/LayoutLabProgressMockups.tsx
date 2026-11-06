import { useEffect, useState, type ReactNode } from 'react';
import { Checkmark, CheckmarkFilled, CircleDash, Pause, Play } from '@carbon/icons-react';
import { cn } from '../../lib/utils';
import { StageStepper } from '../StageStepper';
import { PROCESSES, progressModel, type ProgressModel } from './layoutLabProgressData';

// Ten ways to show progress. Every row shows the same three jobs (the Rekordbox import, the artist set search and the cloud
// sync) so the looks can be compared like for like. One shared slider moves all of them at once.

const BLUE = '#168cff';
const GREEN = '#34d399';
const RED = '#f56b70';
const IDLE = '#3a4251';

const tone = (m: ProgressModel, index: number) => (m.done || index < m.stageIndex ? GREEN : index === m.stageIndex ? BLUE : IDLE);
const stateOf = (m: ProgressModel, index: number) => (m.done || index < m.stageIndex ? 'done' : index === m.stageIndex ? 'active' : 'todo');

function Headline({ m, className }: { m: ProgressModel; className?: string }) {
  return <p className={cn('text-[13px] font-bold leading-tight', className)}>{m.headline}</p>;
}

function Figures({ m, className }: { m: ProgressModel; className?: string }) {
  return (
    <div className={cn('grid grid-cols-3 gap-2', className)}>
      {m.figures.map(({ label, value }) => (
        <div key={label} className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-1.5">
          <p className="truncate font-mono text-[13px] font-black tabular-nums">{value}</p>
          <p className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
        </div>
      ))}
    </div>
  );
}

// ── The ten looks ────────────────────────────────────────────────────────────

/** 1. Stage Rail: the look of the Rekordbox import now. */
function StageRail({ m }: { m: ProgressModel }) {
  return <div className="space-y-3"><StageStepper steps={m.process.steps} activeIndex={m.stageIndex} ariaLabel={`${m.process.title} progress`} /><Headline m={m} className="text-center" /></div>;
}

/** 2. Segmented Bar: one segment per stage; the current one fills as it goes. */
function Segmented({ m }: { m: ProgressModel }) {
  return (
    <div className="space-y-2.5">
      <div className="flex gap-1.5">
        {m.process.steps.map((step, i) => (
          <div key={step.id} className="min-w-0 flex-1">
            <div className="h-2 overflow-hidden rounded-full bg-white/[0.08]">
              <div className="h-full rounded-full transition-all" style={{ width: stateOf(m, i) === 'done' ? '100%' : stateOf(m, i) === 'active' ? `${m.stagePercent}%` : '0%', background: tone(m, i) }} />
            </div>
            <p className="mt-1.5 truncate text-[8px] font-bold uppercase tracking-widest" style={{ color: tone(m, i) }}>{step.label}</p>
          </div>
        ))}
      </div>
      <Headline m={m} />
    </div>
  );
}

/** 3. Chevron Steps: arrow-shaped blocks pointing the way. */
function Chevrons({ m }: { m: ProgressModel }) {
  return (
    <div className="space-y-3">
      <div className="flex">
        {m.process.steps.map((step, i) => {
          const state = stateOf(m, i);
          return (
            <div
              key={step.id}
              className={cn('flex h-9 min-w-0 flex-1 items-center justify-center px-3 text-[9px] font-bold uppercase tracking-wider', i > 0 && '-ml-2')}
              style={{
                clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%, 10px 50%)',
                background: state === 'done' ? 'rgba(52,211,153,0.16)' : state === 'active' ? 'rgba(22,140,255,0.22)' : 'rgba(255,255,255,0.05)',
                color: tone(m, i),
              }}
            >
              <span className="truncate">{step.label}</span>
            </div>
          );
        })}
      </div>
      <Headline m={m} />
    </div>
  );
}

/** 4. Ring Gauge: a ring with the percentage inside, the stage and figures beside it. */
function Ring({ m }: { m: ProgressModel }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-4">
      <div className="relative h-[76px] w-[76px] shrink-0">
        <svg viewBox="0 0 76 76" className="-rotate-90">
          <circle cx="38" cy="38" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
          <circle cx="38" cy="38" r={r} fill="none" stroke={m.done ? GREEN : BLUE} strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - m.percent / 100)} style={{ transition: 'stroke-dashoffset 200ms' }} />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-mono text-[15px] font-black tabular-nums">{m.done ? <Checkmark size={22} className="text-emerald-400" /> : `${Math.round(m.percent)}%`}</span>
      </div>
      <div className="min-w-0 space-y-1">
        <p className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: tone(m, m.stageIndex) }}>{m.process.steps[m.stageIndex].label}</p>
        <Headline m={m} />
      </div>
    </div>
  );
}

/** 5. Timeline: a short list down the page with a tick, a spinner or an empty circle for every stage. */
function Timeline({ m }: { m: ProgressModel }) {
  return (
    <ol className="space-y-0">
      {m.process.steps.map((step, i) => {
        const state = stateOf(m, i);
        const last = i === m.process.steps.length - 1;
        return (
          <li key={step.id} className="relative flex items-center gap-3 pb-2.5 last:pb-0">
            {!last && <span className="absolute left-[8px] top-[18px] h-[calc(100%-10px)] w-px" style={{ background: state === 'done' ? GREEN : IDLE }} />}
            <span className="relative flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full border" style={{ borderColor: tone(m, i), background: state === 'done' ? GREEN : 'transparent' }}>
              {state === 'done' ? <Checkmark size={11} className="text-[#0b1017]" /> : state === 'active' ? <CircleDash size={11} className="animate-spin" style={{ color: BLUE }} /> : null}
            </span>
            <span className="text-[11px] font-semibold" style={{ color: state === 'todo' ? '#6b7586' : undefined }}>{step.label}</span>
            {state === 'active' && !m.done && <span className="ml-auto font-mono text-[10px] text-muted-foreground tabular-nums">{m.stagePercent}%</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** 6. Quiet Figure: a light 20px percentage over one hairline, in the Audition style. */
function QuietFigure({ m }: { m: ProgressModel }) {
  return (
    <div className="space-y-2" style={{ fontFamily: "'Helvetica Neue','Segoe UI',Arial,sans-serif" }}>
      <div className="flex items-end justify-between">
        <p className="text-[34px] font-light leading-none tracking-[-0.04em] tabular-nums">{Math.round(m.percent)}<span className="text-[16px] text-muted-foreground">%</span></p>
        <p className="pb-1 text-[9px] uppercase tracking-[0.16em] text-[#9aa5b8]">{m.process.steps[m.stageIndex].label}</p>
      </div>
      <div className="h-px w-full bg-white/10"><div className="h-px transition-all" style={{ width: `${m.percent}%`, background: m.done ? GREEN : RED }} /></div>
      <p className="text-[11px] text-[#a4adbd]">{m.headline}</p>
    </div>
  );
}

/** 7. Stage Bars: every stage has its own bar and a status on the right, like a checklist. */
function StageBars({ m }: { m: ProgressModel }) {
  return (
    <div className="space-y-2">
      {m.process.steps.slice(0, -1).map((step, i) => {
        const state = stateOf(m, i);
        const pct = state === 'done' ? 100 : state === 'active' ? m.stagePercent : 0;
        return (
          <div key={step.id}>
            <div className="mb-1 flex items-baseline justify-between text-[10px]">
              <span className="font-semibold" style={{ color: state === 'todo' ? '#6b7586' : undefined }}>{step.label}</span>
              <span className="font-mono tabular-nums text-muted-foreground">{state === 'done' ? 'Done' : state === 'active' ? `${pct}%` : 'Waiting'}</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-white/[0.08]"><div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: tone(m, i) }} /></div>
          </div>
        );
      })}
    </div>
  );
}

/** 8. Waveform: the progress is a waveform that fills like a track playing. */
function WaveBars({ m }: { m: ProgressModel }) {
  const bars = 56;
  return (
    <div className="space-y-2">
      <div className="relative flex h-[46px] items-center gap-[2px]">
        {Array.from({ length: bars }).map((_, i) => {
          const h = 18 + Math.abs(Math.sin(i * 0.7) * 22 + Math.sin(i * 0.23) * 14);
          const filled = (i / bars) * 100 < m.percent;
          return <span key={i} className="flex-1 rounded-full transition-colors" style={{ height: `${h}px`, background: filled ? (m.done ? GREEN : BLUE) : 'rgba(255,255,255,0.12)' }} />;
        })}
        {!m.done && m.percent > 0 && <span className="absolute top-0 h-full w-px bg-white/70" style={{ left: `${m.percent}%` }} />}
      </div>
      <div className="flex items-baseline justify-between"><Headline m={m} /><span className="font-mono text-[10px] text-muted-foreground tabular-nums">{Math.round(m.percent)}%</span></div>
    </div>
  );
}

/** 9. Pills: a pill for each stage; the current one opens up and shows what it is doing. */
function Pills({ m }: { m: ProgressModel }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {m.process.steps.map((step, i) => {
          const state = stateOf(m, i);
          return (
            <span key={step.id} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold" style={{ borderColor: tone(m, i), color: tone(m, i), background: state === 'todo' ? 'transparent' : `${tone(m, i)}1f` }}>
              {state === 'done' ? <Checkmark size={11} /> : state === 'active' ? <CircleDash size={11} className="animate-spin" /> : <step.Icon size={11} />}
              {step.label}
              {state === 'active' && <span className="font-mono tabular-nums opacity-80">{m.stagePercent}%</span>}
            </span>
          );
        })}
      </div>
      <Headline m={m} />
    </div>
  );
}

/** 10. LED Meter: a row of lights like studio hardware, with a mono readout. */
function LedMeter({ m }: { m: ProgressModel }) {
  const leds = 28;
  const lit = Math.round((m.percent / 100) * leds);
  return (
    <div className="space-y-2.5">
      <div className="flex gap-[3px]">
        {Array.from({ length: leds }).map((_, i) => (
          <span key={i} className="h-5 flex-1 rounded-[2px]" style={{ background: i < lit ? (m.done ? GREEN : i > leds * 0.85 ? RED : i > leds * 0.6 ? '#fbbf24' : BLUE) : 'rgba(255,255,255,0.07)', boxShadow: i < lit ? '0 0 6px rgba(22,140,255,0.35)' : 'none' }} />
        ))}
      </div>
      <div className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>{m.process.steps[m.stageIndex].label}</span><span className="tabular-nums text-foreground">{String(Math.round(m.percent)).padStart(3, '0')}%</span>
      </div>
      <p className="font-mono text-[11px]">{m.headline}</p>
    </div>
  );
}

const PROGRESS_LOOKS: { id: string; title: string; concept: string; Look: (props: { m: ProgressModel }) => ReactNode; withFigures?: boolean }[] = [
  { id: 'stage-rail', title: 'Stage Rail', concept: 'The look of the Rekordbox import now: icons, labels, a rail and dots', Look: StageRail, withFigures: true },
  { id: 'segmented', title: 'Segmented Bar', concept: 'One segment per stage; the current one fills as it goes', Look: Segmented, withFigures: true },
  { id: 'chevrons', title: 'Chevron Steps', concept: 'Arrow-shaped blocks pointing the way forward', Look: Chevrons, withFigures: true },
  { id: 'ring', title: 'Ring Gauge', concept: 'A ring with the percentage inside and the stage beside it', Look: Ring, withFigures: true },
  { id: 'timeline', title: 'Timeline', concept: 'A short list with a tick, a spinner or an empty circle for each stage', Look: Timeline },
  { id: 'quiet', title: 'Quiet Figure', concept: 'A light percentage over one hairline, in the Audition style', Look: QuietFigure },
  { id: 'stage-bars', title: 'Stage Bars', concept: 'Every stage gets its own bar and a status, like a checklist', Look: StageBars },
  { id: 'waveform', title: 'Waveform', concept: 'The progress fills a waveform like a track playing', Look: WaveBars },
  { id: 'pills', title: 'Pills', concept: 'A pill for each stage; the current one shows its percentage', Look: Pills, withFigures: true },
  { id: 'led', title: 'LED Meter', concept: 'A row of lights like studio hardware, with a mono readout', Look: LedMeter },
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
    <div className="h-full overflow-y-auto bg-[var(--color-background)] px-8 pb-12 pt-7" data-testid="progress-mockups">
      <div className="mb-5 max-w-[860px]">
        <div className="mb-1 text-sm font-extrabold text-foreground">Progress Concepts</div>
        <div className="text-[11px] leading-relaxed text-muted-foreground">
          Ten ways to show a long job moving along. Every row shows the same three jobs (the Rekordbox import, the artist set search and the cloud sync), so the looks can be compared side by side. Drag the slider, or press play, to move all of them together.
        </div>
      </div>

      <div className="sticky top-0 z-10 mb-8 flex items-center gap-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-panel)] px-4 py-3">
        <button type="button" aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying((p) => !p)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--color-border-subtle)] text-foreground hover:bg-white/5">
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <input type="range" min={0} max={100} value={percent} onChange={(e) => { setPlaying(false); setPercent(Number(e.target.value)); }} className="flex-1" aria-label="Progress" />
        <span className="w-12 text-right font-mono text-[12px] font-bold tabular-nums">{percent}%</span>
        <button type="button" onClick={() => { setPlaying(false); setPercent(100); }} className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400"><CheckmarkFilled size={13} /> Finish</button>
      </div>

      {PROGRESS_LOOKS.map(({ id, title, concept, Look, withFigures }, index) => (
        <section key={id} className="mb-10" data-testid="progress-look" data-look={id}>
          <div className="mb-3 flex items-center gap-2.5">
            <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/15 text-[11px] font-extrabold text-primary">{index + 1}</div>
            <span className="text-[13px] font-bold text-foreground">{title}</span>
            <span className="text-[11px] text-muted-foreground">{concept}</span>
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            {PROCESSES.map((process) => {
              const m = progressModel(process, percent);
              return (
                <div key={process.id} data-process={process.id} className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-panel)] p-5">
                  <p className="mb-3 text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{process.title}</p>
                  <Look m={m} />
                  {withFigures && <Figures m={m} className="mt-4" />}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
