import type { ReactNode } from 'react';

const SECTIONS = [
  { label: 'INTRO', from: 0, to: 11, color: '#2f9bff' },
  { label: 'VERSE', from: 11, to: 24, color: '#8069ff' },
  { label: 'BUILD', from: 24, to: 35, color: '#ff9b32' },
  { label: 'DROP 1', from: 35, to: 52, color: '#e45cff' },
  { label: 'BREAK', from: 52, to: 64, color: '#23c6b8' },
  { label: 'BUILD', from: 64, to: 73, color: '#ff9b32' },
  { label: 'DROP 2', from: 73, to: 90, color: '#e45cff' },
  { label: 'OUTRO', from: 90, to: 100, color: '#2f9bff' },
];

const CUES = [
  { label: 'A', name: 'MIX IN', at: 5, bar: '009.1', time: '00:15.0', color: '#20b8ff' },
  { label: 'B', name: 'BUILD', at: 24, bar: '033.1', time: '01:00.0', color: '#ff9b32' },
  { label: 'C', name: 'DROP 1', at: 35, bar: '049.1', time: '01:30.0', color: '#45e477' },
  { label: 'D', name: 'BREAK', at: 52, bar: '073.1', time: '02:15.0', color: '#ff597b' },
  { label: 'E', name: 'DROP 2', at: 73, bar: '105.1', time: '03:15.0', color: '#a567ff' },
  { label: 'F', name: 'MIX OUT', at: 91, bar: '133.1', time: '04:07.5', color: '#20b8ff' },
];

function makeSignal(length: number, seed: number) {
  let state = seed >>> 0;
  return Array.from({ length }, (_, index) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const random = state / 0xffffffff;
    const position = index / Math.max(1, length - 1);
    const section = SECTIONS.find((item) => position * 100 >= item.from && position * 100 < item.to);
    const envelope = section?.label.includes('DROP') ? .92 : section?.label === 'BREAK' ? .34 : section?.label === 'BUILD' ? .62 : .46;
    return Math.max(.1, Math.min(1, envelope * (.48 + random * .72)));
  });
}

const SIGNAL = makeSignal(224, 128);

function sectionAt(position: number) {
  return SECTIONS.find((section) => position >= section.from && position < section.to) ?? SECTIONS[SECTIONS.length - 1];
}

function ConceptFrame({ number, title, premise, children }: { number: number; title: string; premise: string; children: ReactNode }) {
  return (
    <section className="mb-14">
      <div className="mb-3 flex items-baseline gap-3">
        <span className="font-mono text-[9px] font-black text-muted-foreground">{String(number).padStart(2, '0')}</span>
        <h2 className="text-[13px] font-extrabold text-foreground">{title}</h2>
        <p className="hidden text-[10px] text-muted-foreground sm:block">{premise}</p>
      </div>
      <div className="overflow-hidden rounded-[10px] border border-[#2b3541] bg-[#090e13] shadow-[0_22px_60px_rgba(0,0,0,.3)]">{children}</div>
    </section>
  );
}

function TrackIdentity({ compact = false }: { compact?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[13px] font-bold text-[#edf3fa]">Disappearance w EVOKE45</p>
      {!compact && <p className="mt-0.5 truncate text-[9px] text-[#7e8996]">Artist Not Available · DropDex Library</p>}
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-[62px] border-l border-[#26313c] pl-3">
      <p className="text-[7px] font-bold uppercase tracking-[.17em] text-[#65717e]">{label}</p>
      <p className={`mt-1 font-mono text-[11px] font-bold ${accent ? 'text-[#35a2ff]' : 'text-[#dce5ed]'}`}>{value}</p>
    </div>
  );
}

function BeatRuler({ start = 1, end = 145 }: { start?: number; end?: number }) {
  const labels = Array.from({ length: 9 }, (_, index) => Math.round(start + (end - start) * index / 8));
  return <div className="grid h-5 grid-cols-9 border-y border-[#202a34] bg-[#0b1117] px-2 font-mono text-[7px] text-[#637180]">{labels.map((label, index) => <span key={`${label}-${index}`} className={index === 8 ? 'text-right' : ''}>{label}.1</span>)}</div>;
}

function PhraseRail({ labels = true }: { labels?: boolean }) {
  return (
    <div className="flex h-7 gap-px bg-[#080d12]" aria-label="Phrase analysis">
      {SECTIONS.map((section) => <div key={`${section.label}-${section.from}`} className="flex min-w-0 items-center justify-center border-t-2 px-1" style={{ width: `${section.to - section.from}%`, borderColor: section.color, background: `${section.color}18` }}>{labels && <span className="truncate text-[7px] font-black tracking-[.08em]" style={{ color: section.color }}>{section.label}</span>}</div>)}
    </div>
  );
}

function Waveform({ height = 120, cues = true, playhead = 43, viewport, selectedCue }: { height?: number; cues?: boolean; playhead?: number; viewport?: { from: number; to: number }; selectedCue?: string }) {
  return (
    <div className="relative overflow-hidden border-y border-[#26313b] bg-[#060a0e]" style={{ height }}>
      <div className="absolute inset-0 opacity-55" style={{ backgroundImage: 'repeating-linear-gradient(90deg, transparent 0 calc(6.25% - 1px), #2b3540 calc(6.25% - 1px) 6.25%)' }} />
      <svg viewBox="0 0 224 100" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-label="Three-band track waveform">
        {SIGNAL.map((value, index) => {
          const position = index / (SIGNAL.length - 1) * 100;
          const color = sectionAt(position).color;
          const high = Math.max(2, value * 32);
          const mid = Math.max(1.5, value * 21);
          const low = Math.max(1, value * 12);
          return <g key={index}><line x1={index + .5} x2={index + .5} y1={50 - high} y2={50 + high} stroke={color} strokeWidth=".72" opacity=".72" /><line x1={index + .5} x2={index + .5} y1={50 - mid} y2={50 + mid} stroke="#32b9ff" strokeWidth=".48" opacity=".75" /><line x1={index + .5} x2={index + .5} y1={50 - low} y2={50 + low} stroke="#ff9f3f" strokeWidth=".32" opacity=".85" /></g>;
        })}
        <line x1="0" x2="224" y1="50" y2="50" stroke="#a9bac9" strokeWidth=".25" opacity=".3" />
      </svg>
      {viewport && <div className="absolute inset-y-0 border-x-2 border-[#f3bd44] bg-[#f3bd44]/10" style={{ left: `${viewport.from}%`, width: `${viewport.to - viewport.from}%` }} />}
      {cues && CUES.map((cue) => <div key={cue.label} className="absolute inset-y-0 z-10 w-px" style={{ left: `${cue.at}%`, background: `${cue.color}bb` }}><span className={`absolute left-1/2 top-1 -translate-x-1/2 rounded-[2px] px-1.5 py-0.5 font-mono text-[7px] font-black text-[#071019] ${selectedCue === cue.label ? 'ring-2 ring-white' : ''}`} style={{ background: cue.color }}>{cue.label}</span></div>)}
      {playhead >= 0 && <div className="absolute inset-y-0 z-20 w-px bg-white shadow-[0_0_7px_rgba(255,255,255,.8)]" style={{ left: `${playhead}%` }}><span className="absolute -left-[4px] top-0 size-2 rotate-45 bg-white" /></div>}
    </div>
  );
}

function PreparationWorkspace() {
  return (
    <div className="bg-[#0b1016] text-[#dce5ed]">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#2a3540] bg-[#111820] px-5 py-4"><TrackIdentity /><div className="flex gap-4"><Metric label="BPM" value="128.00" accent /><Metric label="Key" value="7A / Dm" /><Metric label="Length" value="04:30.0" /><Metric label="Grid" value="LOCKED" /></div></header>
      <div className="px-4 pb-4 pt-3">
        <div className="mb-1 flex items-center justify-between text-[7px] font-bold uppercase tracking-[.15em] text-[#687685]"><span>Track overview</span><span>144.2 bars · 6 memory cues</span></div>
        <Waveform height={46} cues={false} playhead={43} viewport={{ from: 18, to: 67 }} />
        <div className="mt-3 flex items-center justify-between text-[7px] font-bold uppercase tracking-[.15em] text-[#687685]"><span>Detail waveform</span><span className="text-[#31a4ff]">Beatgrid 1/4</span></div>
        <BeatRuler /><Waveform height={138} selectedCue="C" /><PhraseRail />
      </div>
    </div>
  );
}

function CueDetailWorkspace() {
  return (
    <div className="grid min-h-[350px] bg-[#0a0f14] text-[#dce5ed] md:grid-cols-[minmax(0,1fr)_260px]">
      <div className="min-w-0 border-b border-[#2a3540] p-4 md:border-b-0 md:border-r">
        <div className="mb-3 flex items-center justify-between"><TrackIdentity compact /><span className="rounded border border-[#45e477]/35 bg-[#45e477]/10 px-2 py-1 text-[7px] font-bold uppercase tracking-wider text-[#45e477]">Cue edit</span></div>
        <BeatRuler /><Waveform height={190} playhead={35} selectedCue="C" /><PhraseRail />
        <div className="mt-3 flex justify-between font-mono text-[8px] text-[#71808e]"><span>ZOOM 1 BAR</span><span>SNAP 1/4 BEAT</span><span className="text-[#45e477]">C · DROP 1 · 01:30.0</span></div>
      </div>
      <aside className="bg-[#10171e] p-4">
        <div className="flex items-center justify-between"><p className="text-[8px] font-black uppercase tracking-[.18em] text-[#8c99a6]">Cue map</p><span className="font-mono text-[8px] text-[#65717e]">6 / 8</span></div>
        <div className="mt-3 space-y-1.5">{CUES.map((cue) => <div key={cue.label} className={`grid grid-cols-[24px_1fr_auto] items-center gap-2 rounded border px-2 py-2 ${cue.label === 'C' ? 'border-[#45e477]/60 bg-[#45e477]/8' : 'border-[#27313b] bg-[#0c1218]'}`}><span className="grid size-5 place-items-center rounded-[2px] font-mono text-[8px] font-black text-[#081015]" style={{ background: cue.color }}>{cue.label}</span><div><p className="text-[8px] font-bold text-[#dce5ed]">{cue.name}</p><p className="font-mono text-[7px] text-[#65717e]">BAR {cue.bar}</p></div><span className="font-mono text-[7px] text-[#8d99a5]">{cue.time}</span></div>)}</div>
      </aside>
    </div>
  );
}

function AnalysisLane({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid grid-cols-[58px_1fr] border-t border-[#222d37]"><div className="flex items-center px-2 text-[7px] font-black uppercase tracking-[.12em] text-[#697786]">{label}</div><div className="min-w-0 border-l border-[#222d37]">{children}</div></div>;
}

function PhraseEnergyWorkspace() {
  return (
    <div className="bg-[#0a1015] text-[#dce5ed]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#29343e] px-4 py-3"><TrackIdentity compact /><div className="flex gap-4"><Metric label="BPM" value="128.00" /><Metric label="Key" value="7A" /><Metric label="Phrase" value="ANALYZED" accent /></div></header>
      <div className="p-4">
        <BeatRuler /><Waveform height={108} playhead={64} />
        <AnalysisLane label="Phrase"><PhraseRail /></AnalysisLane>
        <AnalysisLane label="Energy"><div className="flex h-9 items-end gap-px px-1 py-1">{SIGNAL.filter((_, index) => index % 4 === 0).map((value, index) => <span key={index} className="flex-1 rounded-t-sm bg-[#f05b70]" style={{ height: `${20 + value * 75}%`, opacity: .35 + value * .55 }} />)}</div></AnalysisLane>
        <AnalysisLane label="Vocal"><div className="relative h-7 bg-[#090e13]">{[{ left: 12, width: 10 }, { left: 38, width: 11 }, { left: 55, width: 8 }, { left: 77, width: 12 }].map((block, index) => <div key={index} className="absolute inset-y-1 rounded-sm border border-[#31c0d8]/45 bg-[#31c0d8]/20" style={{ left: `${block.left}%`, width: `${block.width}%` }} />)}</div></AnalysisLane>
        <AnalysisLane label="Mix zones"><div className="relative h-8 bg-[#090e13]"><div className="absolute inset-y-1 left-[2%] w-[18%] rounded-sm border border-[#35a2ff]/50 bg-[#35a2ff]/15 px-2 text-[7px] font-bold leading-5 text-[#35a2ff]">INTRO · 24 BARS</div><div className="absolute inset-y-1 right-[2%] w-[18%] rounded-sm border border-[#35a2ff]/50 bg-[#35a2ff]/15 px-2 text-right text-[7px] font-bold leading-5 text-[#35a2ff]">OUTRO · 24 BARS</div></div></AnalysisLane>
      </div>
    </div>
  );
}

function TransitionPlanner() {
  return (
    <div className="bg-[#0a0f14] text-[#dce5ed]">
      <header className="grid gap-3 border-b border-[#29343e] bg-[#111820] px-4 py-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center"><div><p className="text-[7px] font-black uppercase tracking-[.17em] text-[#35a2ff]">Outgoing track</p><TrackIdentity compact /></div><div className="rounded border border-[#f3bd44]/40 bg-[#f3bd44]/10 px-4 py-2 text-center"><p className="text-[7px] font-bold uppercase tracking-widest text-[#f3bd44]">Selected mix window</p><p className="mt-1 font-mono text-[11px] font-bold">32 BARS · 01:00</p></div><div className="text-left sm:text-right"><p className="text-[7px] font-black uppercase tracking-[.17em] text-[#a567ff]">Target</p><p className="text-[11px] font-bold">Ring The Alarm (HAHNER Edit)</p></div></header>
      <div className="p-4">
        <div className="mb-1 flex justify-between text-[7px] uppercase tracking-wider text-[#6b7885]"><span>Full track</span><span>Viewport: bars 33–81</span></div><Waveform height={52} cues={false} playhead={-1} viewport={{ from: 22, to: 55 }} />
        <div className="mt-3 flex justify-between text-[7px] font-bold uppercase tracking-wider text-[#6b7885]"><span>Transition detail</span><span className="text-[#f3bd44]">Phrase aligned · 128 → 128 BPM</span></div><BeatRuler start={33} end={81} />
        <div className="relative"><Waveform height={150} cues={false} playhead={52} /><div className="absolute inset-y-0 left-[12%] border-l-2 border-[#35a2ff]"><span className="absolute left-1 top-2 whitespace-nowrap rounded bg-[#35a2ff] px-1.5 py-1 text-[7px] font-black text-[#071019]">MIX IN</span></div><div className="absolute inset-y-0 left-[78%] border-l-2 border-[#f3bd44]"><span className="absolute right-1 top-2 whitespace-nowrap rounded bg-[#f3bd44] px-1.5 py-1 text-[7px] font-black text-[#17120a]">BASS SWAP</span></div><div className="absolute bottom-4 left-[12%] h-3 w-[66%] border-x border-t border-[#f3bd44]"><span className="absolute -top-4 left-1/2 -translate-x-1/2 font-mono text-[7px] font-bold text-[#f3bd44]">32 BAR BLEND</span></div></div>
        <div className="grid grid-cols-3 gap-2 pt-3 text-[8px]"><div className="rounded border border-[#25313b] bg-[#10171e] p-2"><span className="text-[#697786]">KEY MOVE</span><b className="float-right text-[#dce5ed]">7A → 8A</b></div><div className="rounded border border-[#25313b] bg-[#10171e] p-2"><span className="text-[#697786]">TEMPO</span><b className="float-right text-[#45e477]">MATCHED</b></div><div className="rounded border border-[#25313b] bg-[#10171e] p-2"><span className="text-[#697786]">VOCAL CLASH</span><b className="float-right text-[#45e477]">CLEAR</b></div></div>
      </div>
    </div>
  );
}

function PerformanceReadiness() {
  return (
    <div className="bg-[#080d12] text-[#dce5ed]">
      <header className="grid grid-cols-[1fr_auto] items-center border-b border-[#2b3540] bg-[#0f161d] px-4 py-3"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-full border border-[#35a2ff]/50 bg-[#35a2ff]/10 text-[#35a2ff]">▶</span><TrackIdentity /></div><div className="hidden items-end gap-5 sm:flex"><div className="text-right"><p className="text-[7px] uppercase tracking-widest text-[#697786]">BPM</p><p className="font-mono text-xl font-black text-[#eef5fb]">128.00</p></div><div className="text-right"><p className="text-[7px] uppercase tracking-widest text-[#697786]">Key</p><p className="font-mono text-xl font-black text-[#35a2ff]">7A</p></div></div></header>
      <div className="p-4"><BeatRuler /><Waveform height={126} playhead={35} selectedCue="C" /><PhraseRail />
        <div className="mt-3 grid grid-cols-4 gap-1.5 sm:grid-cols-8">{Array.from({ length: 8 }, (_, index) => { const cue = CUES[index]; return <div key={index} className={`rounded border p-2 ${cue ? 'border-[#33404b] bg-[#111820]' : 'border-dashed border-[#28333d] bg-[#0b1117]'}`}><div className="flex items-center justify-between"><span className="font-mono text-[10px] font-black" style={{ color: cue?.color ?? '#4e5b67' }}>{String.fromCharCode(65 + index)}</span><span className="size-1.5 rounded-full" style={{ background: cue?.color ?? '#27313b' }} /></div><p className="mt-2 truncate text-[7px] font-bold text-[#8995a1]">{cue?.name ?? 'EMPTY'}</p><p className="mt-0.5 font-mono text-[7px] text-[#596673]">{cue?.bar ?? '—'}</p></div>; })}</div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[#26313b] pt-3 text-[7px] font-bold uppercase tracking-[.12em] text-[#7c8995]">{['Beatgrid locked', 'Phrase analyzed', '6 cues assigned', 'USB export ready'].map((item) => <span key={item} className="flex items-center gap-1.5"><i className="size-1.5 rounded-full bg-[#45e477]" />{item}</span>)}</div>
      </div>
    </div>
  );
}

export function RekordboxExperimentalConcepts() {
  return (
    <>
      <div className="mb-8 mt-2 border-y border-[var(--color-border-faint)] py-5"><p className="font-mono text-[8px] font-black uppercase tracking-[.2em] text-primary">Professional workflow studies</p><p className="mt-1 max-w-3xl text-[10px] leading-relaxed text-muted-foreground">Five waveform-first directions for track preparation. Each preserves horizontal musical time while changing the information hierarchy for a specific DJ task.</p></div>
      <ConceptFrame number={6} title="Full-Track Preparation" premise="Overview, zoomed waveform, grid, cues, and phrases in one scan."><PreparationWorkspace /></ConceptFrame>
      <ConceptFrame number={7} title="Cue Detail Workspace" premise="A precise waveform editor paired with a time-and-bar cue map."><CueDetailWorkspace /></ConceptFrame>
      <ConceptFrame number={8} title="Phrase & Energy Analysis" premise="Arrangement, energy, vocals, and mix zones share one timeline."><PhraseEnergyWorkspace /></ConceptFrame>
      <ConceptFrame number={9} title="Transition Window Planner" premise="A phrase-aligned 32-bar blend with compatibility checks."><TransitionPlanner /></ConceptFrame>
      <ConceptFrame number={10} title="Performance Readiness" premise="Hot cues and analysis state validated before USB export."><PerformanceReadiness /></ConceptFrame>
    </>
  );
}
