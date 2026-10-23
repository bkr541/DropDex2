import type { ReactNode } from 'react';

const SECTIONS = [
  { label: 'INTRO', from: 0, to: 11, color: '#2f9bff', fill: null },
  { label: 'VERSE', from: 11, to: 24, color: '#8069ff', fill: 22 },
  { label: 'UP', from: 24, to: 35, color: '#ff9b32', fill: 33 },
  { label: 'CHORUS', from: 35, to: 52, color: '#e45cff', fill: null },
  { label: 'DOWN', from: 52, to: 64, color: '#23c6b8', fill: null },
  { label: 'VERSE', from: 64, to: 73, color: '#8069ff', fill: 71 },
  { label: 'CHORUS', from: 73, to: 90, color: '#e45cff', fill: null },
  { label: 'OUTRO', from: 90, to: 100, color: '#2f9bff', fill: null },
];

const CUES = [
  { label: 'B', name: 'BUILD', at: 31, bar: '045.1', time: '01:12.4', color: '#20b8ff', family: 'Hot Cue', type: 'Cue' },
  { label: 'C', name: 'DROP', at: 38, bar: '054.1', time: '01:26.8', color: '#45e477', family: 'Hot Cue', type: 'Cue' },
  { label: 'D', name: 'SWITCH', at: 44, bar: '063.1', time: '01:40.9', color: '#a567ff', family: 'Hot Cue', type: 'Cue' },
];

function makeSignal(length: number, seed: number) {
  let state = seed >>> 0;
  return Array.from({ length }, (_, index) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const random = state / 0xffffffff;
    const position = index / Math.max(1, length - 1);
    const section = SECTIONS.find((item) => position * 100 >= item.from && position * 100 < item.to);
    const envelope = section?.label === 'CHORUS' ? .92 : section?.label === 'DOWN' ? .34 : section?.label === 'UP' ? .62 : .46;
    return Math.max(.1, Math.min(1, envelope * (.48 + random * .72)));
  });
}

const SIGNAL = makeSignal(224, 128);

function waveformColor(index: number, value: number) {
  if (value > .78) return index % 5 === 0 ? '#ff9438' : '#ae61ff';
  if (value > .48) return index % 4 === 0 ? '#25c1dd' : '#318cff';
  return '#286ca8';
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

function TrackArtwork({ size = 36 }: { size?: number }) {
  return (
    <div className="grid shrink-0 place-items-center rounded-[6px] border border-[#34414d] bg-[#0a1016]" style={{ width: size, height: size }}>
      <svg viewBox="0 0 32 32" width={size * .68} height={size * .68} fill="none" aria-hidden="true">
        <circle cx="16" cy="16" r="13" stroke="#d7e2ec" strokeWidth="1.4" />
        <circle cx="16" cy="16" r="8.5" stroke="#72808d" strokeWidth="1" />
        <circle cx="16" cy="16" r="3.5" stroke="#35a2ff" strokeWidth="1.6" />
        <circle cx="16" cy="16" r="1" fill="#d7e2ec" />
      </svg>
    </div>
  );
}

function HeaderButton({ children, primary = false, iconOnly = false }: { children: ReactNode; primary?: boolean; iconOnly?: boolean }) {
  return (
    <button type="button" className={`inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] border px-2 text-[8px] font-bold ${primary ? 'border-[#35a2ff] bg-[#168cf0] text-white' : 'border-[#34404b] bg-[#151d25] text-[#aab6c1]'} ${iconOnly ? 'w-7 px-0' : ''}`}>
      {children}
    </button>
  );
}

function HeaderActions({ iconOnly = false }: { iconOnly?: boolean }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <HeaderButton iconOnly={iconOnly}>{iconOnly ? '0' : 'Pending 0'}</HeaderButton>
      <HeaderButton iconOnly={iconOnly}>{iconOnly ? '✦' : '✦ Auto Cue'}</HeaderButton>
      <div className="flex">
        <HeaderButton primary iconOnly={iconOnly}>{iconOnly ? '↥' : '↥ Apply All (0)'}</HeaderButton>
        {!iconOnly && <button type="button" className="h-7 w-6 rounded-r-[5px] border border-l-0 border-[#35a2ff] bg-[#168cf0] text-[8px] text-white">⌄</button>}
      </div>
    </div>
  );
}

function EditingStatus() {
  return <span className="rounded-[3px] border border-[#35a2ff]/30 bg-[#35a2ff]/10 px-1.5 py-0.5 text-[7px] font-black uppercase tracking-[.12em] text-[#65b9ff]">Editing · Original</span>;
}

function OneLineTrackHeader() {
  return (
    <header className="flex h-[48px] items-center gap-3 overflow-hidden border-b border-[#2a3540] bg-[#0f161d] px-3">
      <TrackArtwork size={28} /><TrackIdentity compact /><span className="hidden text-[8px] text-[#687582] sm:inline">Artist Not Available</span><span className="h-5 w-px bg-[#2b3540]" />
      <div className="hidden shrink-0 items-center gap-3 font-mono text-[8px] md:flex"><span>150.00 <b className="text-[#64717d]">BPM</b></span><span className="rounded bg-[#35a2ff]/15 px-1.5 py-0.5 font-black text-[#35a2ff]">10A</span><span>03:51</span><span>3 <b className="text-[#64717d]">CUES</b></span><EditingStatus /></div>
      <div className="ml-auto"><HeaderActions iconOnly /></div>
    </header>
  );
}

function TwoTierTrackHeader() {
  return (
    <header className="border-b border-[#2a3540] bg-[#111820]">
      <div className="flex h-[42px] items-center gap-3 px-4"><TrackArtwork size={28} /><TrackIdentity compact /><span className="text-[9px] text-[#74818d]">Artist Not Available</span><div className="ml-auto"><HeaderActions /></div></div>
      <div className="flex h-[27px] items-center gap-5 border-t border-[#26313b] bg-[#090f14] px-4 font-mono text-[8px] text-[#a5b0ba]"><span><b className="text-[#596672]">BPM</b> 150.00</span><span><b className="text-[#596672]">KEY</b> <em className="not-italic text-[#35a2ff]">10A / Bm</em></span><span><b className="text-[#596672]">DURATION</b> 03:51.0</span><span><b className="text-[#596672]">CUES</b> 3</span><EditingStatus /></div>
    </header>
  );
}

function HeaderCell({ label, value, accent = false }: { label: string; value: ReactNode; accent?: boolean }) {
  return <div className="flex h-full min-w-[68px] flex-col justify-center border-l border-[#2a3540] px-3"><span className="text-[7px] font-bold uppercase tracking-[.13em] text-[#5f6c78]">{label}</span><span className={`mt-1 font-mono text-[11px] font-bold ${accent ? 'text-[#35a2ff]' : 'text-[#dce5ed]'}`}>{value}</span></div>;
}

function ReadoutTrackHeader() {
  return (
    <header className="flex h-[56px] items-stretch overflow-hidden border-b border-[#2a3540] bg-[#10171e]">
      <div className="flex min-w-0 flex-1 items-center gap-3 px-4"><TrackArtwork size={36} /><div><TrackIdentity compact /><p className="mt-0.5 text-[8px] text-[#71808d]">Artist Not Available · <span className="text-[#65b9ff]">Editing · Original</span></p></div></div>
      <div className="hidden items-stretch lg:flex"><HeaderCell label="BPM" value="150.00" /><HeaderCell label="Key" value="10A" accent /><HeaderCell label="Duration" value="03:51" /><HeaderCell label="Cues" value="3" /><HeaderCell label="Mode" value={<EditingStatus />} /></div>
      <div className="flex items-center border-l border-[#2a3540] px-3"><HeaderActions /></div>
    </header>
  );
}

function KeyRibbonTrackHeader() {
  return (
    <header className="relative flex min-h-[58px] flex-wrap items-center gap-3 overflow-hidden border-b border-[#2a3540] bg-[#10171e] px-4 py-2" style={{ backgroundImage: 'linear-gradient(90deg, rgb(53 162 255 / .14), transparent 42%)' }}>
      <span className="absolute inset-y-0 left-0 w-[3px] bg-[#35a2ff]" /><TrackArtwork size={34} /><div className="min-w-0"><TrackIdentity compact /><p className="text-[8px] text-[#71808d]">Artist Not Available</p></div>
      <div className="ml-2 hidden items-center gap-4 font-mono text-[10px] md:flex"><span className="font-black">150.00 <small className="text-[7px] text-[#64717d]">BPM</small></span><span className="rounded bg-[#35a2ff]/15 px-2 py-1 font-black text-[#35a2ff]">10A</span><span>03:51</span><span>3 <small className="text-[7px] text-[#64717d]">CUES</small></span><EditingStatus /></div>
      <div className="ml-auto"><HeaderActions iconOnly /></div>
    </header>
  );
}

function BeatRuler({ start = 1, end = 145 }: { start?: number; end?: number }) {
  const labels = Array.from({ length: 9 }, (_, index) => Math.round(start + (end - start) * index / 8));
  return <div className="grid h-5 grid-cols-9 border-y border-[#202a34] bg-[#0b1117] px-2 font-mono text-[7px] text-[#637180]">{labels.map((label, index) => <span key={`${label}-${index}`} className={index === 8 ? 'text-right' : ''}>{label}.1</span>)}</div>;
}

function PhraseRail({ labels = true }: { labels?: boolean }) {
  return (
    <div className="flex h-7 gap-px bg-[#080d12]" aria-label="Phrase analysis">
      {SECTIONS.map((section) => <div key={`${section.label}-${section.from}`} className="relative flex min-w-0 items-center justify-center border-t-2 px-1" style={{ width: `${section.to - section.from}%`, borderColor: section.color, background: `${section.color}18` }}>{labels && <span className="truncate text-[7px] font-black tracking-[.08em]" style={{ color: section.color }}>{section.label}</span>}{section.fill != null && <span className="absolute bottom-0 right-0 h-1.5 w-px bg-[#f3bd44]" title="Rekordbox phrase fill" />}</div>)}
    </div>
  );
}

function Waveform({ height = 120, cues = true, playhead = 43, viewport, selectedCue }: { height?: number; cues?: boolean; playhead?: number; viewport?: { from: number; to: number }; selectedCue?: string }) {
  return (
    <div className="relative overflow-hidden border-y border-[#26313b] bg-[#060a0e]" style={{ height }}>
      <div className="absolute inset-0 opacity-55" style={{ backgroundImage: 'repeating-linear-gradient(90deg, transparent 0 calc(6.25% - 1px), #2b3540 calc(6.25% - 1px) 6.25%)' }} />
      <svg viewBox="0 0 224 100" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-label="Rekordbox color waveform">
        {SIGNAL.map((value, index) => {
          const high = Math.max(2, value * 32);
          return <line key={index} x1={index + .5} x2={index + .5} y1={50 - high} y2={50 + high} stroke={waveformColor(index, value)} strokeWidth=".78" opacity=".9" />;
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
      <ReadoutTrackHeader />
      <div className="px-4 pb-4 pt-3">
        <div className="mb-1 flex items-center justify-between text-[7px] font-bold uppercase tracking-[.15em] text-[#687685]"><span>PWV5 track overview</span><span>144.2 bars · 3 Hot Cues</span></div>
        <Waveform height={46} cues={false} playhead={43} viewport={{ from: 18, to: 67 }} />
        <div className="mt-3 flex items-center justify-between text-[7px] font-bold uppercase tracking-[.15em] text-[#687685]"><span>Detail waveform</span><span className="text-[#31a4ff]">Beatgrid 1/4</span></div>
        <BeatRuler /><Waveform height={138} selectedCue="C" /><PhraseRail />
      </div>
    </div>
  );
}

function CueDetailWorkspace() {
  return (
    <div className="min-h-[350px] bg-[#0a0f14] text-[#dce5ed]">
      <ReadoutTrackHeader />
      <div className="grid md:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 border-b border-[#2a3540] p-4 md:border-b-0 md:border-r">
          <div className="mb-3 flex items-center justify-between"><span className="text-[8px] font-black uppercase tracking-[.18em] text-[#778592]">Detailed waveform</span><span className="rounded border border-[#45e477]/35 bg-[#45e477]/10 px-2 py-1 text-[7px] font-bold uppercase tracking-wider text-[#45e477]">Cue edit</span></div>
          <BeatRuler /><Waveform height={190} playhead={35} selectedCue="C" /><PhraseRail />
          <div className="mt-3 flex justify-between font-mono text-[8px] text-[#71808e]"><span>ZOOM 1 BAR</span><span>SNAP 1/4 BEAT</span><span className="text-[#45e477]">C · DROP · 01:26.8</span></div>
        </div>
        <aside className="bg-[#10171e] p-4">
          <div className="flex items-center justify-between"><p className="text-[8px] font-black uppercase tracking-[.18em] text-[#8c99a6]">Imported cues</p><span className="font-mono text-[8px] text-[#65717e]">3 HOT · 0 MEMORY</span></div>
          <div className="mt-3 space-y-1.5">{CUES.map((cue) => <div key={cue.label} className={`grid grid-cols-[24px_1fr_auto] items-center gap-2 rounded border px-2 py-2 ${cue.label === 'C' ? 'border-[#45e477]/60 bg-[#45e477]/8' : 'border-[#27313b] bg-[#0c1218]'}`}><span className="grid size-5 place-items-center rounded-[2px] font-mono text-[8px] font-black text-[#081015]" style={{ background: cue.color }}>{cue.label}</span><div><p className="text-[8px] font-bold text-[#dce5ed]">{cue.name}</p><p className="font-mono text-[7px] text-[#65717e]">{cue.family} · {cue.type} · BAR {cue.bar}</p></div><span className="font-mono text-[7px] text-[#8d99a5]">{cue.time}</span></div>)}</div>
        </aside>
      </div>
    </div>
  );
}

function AnalysisLane({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid grid-cols-[58px_1fr] border-t border-[#222d37]"><div className="flex items-center px-2 text-[7px] font-black uppercase tracking-[.12em] text-[#697786]">{label}</div><div className="min-w-0 border-l border-[#222d37]">{children}</div></div>;
}

function PhraseVocalWorkspace() {
  return (
    <div className="bg-[#0a1015] text-[#dce5ed]">
      <ReadoutTrackHeader />
      <div className="p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div><p className="text-[8px] font-black uppercase tracking-[.17em] text-[#8b98a4]">Rekordbox song structure</p><p className="mt-1 text-[8px] text-[#606d79]">PSSI · high_energy mood · 8 phrases</p></div><div className="flex gap-2"><span className="rounded border border-[#f3bd44]/30 bg-[#f3bd44]/10 px-2 py-1 text-[7px] font-bold text-[#f3bd44]">3 PHRASE FILLS</span><span className="rounded border border-[#31c0d8]/30 bg-[#31c0d8]/10 px-2 py-1 text-[7px] font-bold text-[#31c0d8]">PVDI VALID</span></div></div>
        <BeatRuler /><Waveform height={104} playhead={64} />
        <AnalysisLane label="Phrase"><PhraseRail /></AnalysisLane>
        <AnalysisLane label="Fills"><div className="relative h-7 bg-[#090e13]">{[22, 33, 71].map((position) => <div key={position} className="absolute inset-y-1 w-px bg-[#f3bd44]" style={{ left: `${position}%` }}><span className="absolute -left-1 top-0 size-2 rotate-45 border border-[#f3bd44] bg-[#211c10]" /></div>)}</div></AnalysisLane>
        <AnalysisLane label="Vocal"><div className="relative h-8 bg-[#090e13]">{[{ left: 12, width: 10, confidence: '.91' }, { left: 38, width: 11, confidence: '.87' }, { left: 55, width: 8, confidence: '.94' }, { left: 77, width: 12, confidence: '.89' }].map((block, index) => <div key={index} className="absolute inset-y-1 flex items-center rounded-sm border border-[#31c0d8]/45 bg-[#31c0d8]/20 px-1" style={{ left: `${block.left}%`, width: `${block.width}%` }}><span className="truncate font-mono text-[6px] text-[#62d5e7]">{block.confidence}</span></div>)}</div></AnalysisLane>
        <div className="mt-2 text-right font-mono text-[7px] text-[#5f6d79]">Vocal lane shown only for complete, valid PVDI analysis</div>
      </div>
    </div>
  );
}

function BeatgridInspector() {
  return (
    <div className="bg-[#0a0f14] text-[#dce5ed]">
      <ReadoutTrackHeader />
      <div className="p-4">
        <div className="grid gap-2 sm:grid-cols-5">{[['SOURCE', 'PQTZ'], ['BEATS', '578'], ['BARS', '144.2'], ['BPM RANGE', '149.98–150.02'], ['TEMPO', 'CONSTANT']].map(([label, value]) => <div key={label} className="rounded border border-[#26323d] bg-[#10171e] px-3 py-2"><p className="text-[7px] font-black uppercase tracking-[.14em] text-[#667481]">{label}</p><p className="mt-1 font-mono text-[9px] font-bold text-[#dce5ed]">{value}</p></div>)}</div>
        <div className="mb-1 mt-3 flex justify-between text-[7px] uppercase tracking-wider text-[#6b7885]"><span>PWV5 full-track waveform</span><span>Viewport: bars 49–65</span></div><Waveform height={52} cues={false} playhead={-1} viewport={{ from: 33, to: 45 }} />
        <div className="mt-3 flex justify-between text-[7px] font-bold uppercase tracking-wider text-[#6b7885]"><span>Beatgrid detail</span><span className="text-[#35a2ff]">First downbeat 00:00.018</span></div><BeatRuler start={49} end={65} />
        <div className="relative"><Waveform height={142} cues={false} playhead={44} />{Array.from({ length: 17 }, (_, index) => <div key={index} className={`absolute inset-y-0 w-px ${index % 4 === 0 ? 'bg-white/35' : 'bg-white/10'}`} style={{ left: `${index * 6.25}%` }}>{index % 4 === 0 && <span className="absolute bottom-1 left-1 font-mono text-[6px] text-[#8d9aa6]">{49 + index}</span>}</div>)}</div>
        <div className="grid grid-cols-3 gap-2 pt-3 text-[8px]"><div className="rounded border border-[#25313b] bg-[#10171e] p-2"><span className="text-[#697786]">DOWNBEATS</span><b className="float-right text-[#dce5ed]">145</b></div><div className="rounded border border-[#25313b] bg-[#10171e] p-2"><span className="text-[#697786]">GRID SOURCE</span><b className="float-right text-[#35a2ff]">ANLZ</b></div><div className="rounded border border-[#25313b] bg-[#10171e] p-2"><span className="text-[#697786]">PARSE STATUS</span><b className="float-right text-[#45e477]">COMPLETE</b></div></div>
      </div>
    </div>
  );
}

function AnalysisApplyConsole() {
  return (
    <div className="bg-[#080d12] text-[#dce5ed]">
      <ReadoutTrackHeader />
      <div className="p-4"><BeatRuler /><Waveform height={126} playhead={35} selectedCue="C" /><PhraseRail />
        <div className="mt-3 grid grid-cols-4 gap-1.5 sm:grid-cols-8">{Array.from({ length: 8 }, (_, index) => { const letter = String.fromCharCode(65 + index); const cue = CUES.find((item) => item.label === letter); return <div key={letter} className={`rounded border p-2 ${cue ? 'border-[#33404b] bg-[#111820]' : 'border-dashed border-[#28333d] bg-[#0b1117]'}`}><div className="flex items-center justify-between"><span className="font-mono text-[10px] font-black" style={{ color: cue?.color ?? '#4e5b67' }}>{letter}</span><span className="size-1.5 rounded-full" style={{ background: cue?.color ?? '#27313b' }} /></div><p className="mt-2 truncate text-[7px] font-bold text-[#8995a1]">{cue?.name ?? 'EMPTY'}</p><p className="mt-0.5 font-mono text-[7px] text-[#596673]">{cue?.bar ?? '—'}</p></div>; })}</div>
        <div className="mt-3 grid gap-2 border-t border-[#26313b] pt-3 sm:grid-cols-[1fr_auto]"><div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[7px] font-bold uppercase tracking-[.12em] text-[#7c8995]">{['Beat grid · completed', 'Waveform · completed', 'Cues · completed', 'Phrases · completed', 'PVDI · valid'].map((item) => <span key={item} className="flex items-center gap-1.5"><i className="size-1.5 rounded-full bg-[#45e477]" />{item}</span>)}</div><div className="flex items-center gap-3 font-mono text-[7px] text-[#6b7885]"><span>MP3</span><span>320 KBPS</span><span>44.1 KHZ</span><span>16 BIT</span></div></div>
      </div>
    </div>
  );
}

export function RekordboxExperimentalConcepts() {
  return (
    <>
      <div className="mb-8 mt-2 border-y border-[var(--color-border-faint)] py-5"><p className="font-mono text-[8px] font-black uppercase tracking-[.2em] text-primary">Rekordbox data studies</p><p className="mt-1 max-w-3xl text-[10px] leading-relaxed text-muted-foreground">Five waveform-first directions using only metadata DropDex currently imports, validates, displays, or uses for cue editing.</p></div>
      <ConceptFrame number={6} title="Full-Track Preparation" premise="PWV5 waveform, exact beatgrid, imported cues, and PSSI phrases in one scan."><PreparationWorkspace /></ConceptFrame>
      <ConceptFrame number={7} title="Cue Precision Editor" premise="A detailed waveform paired with editable Rekordbox cue fields and timing."><CueDetailWorkspace /></ConceptFrame>
      <ConceptFrame number={8} title="Phrase & Vocal Map" premise="PSSI sections and fills with optional validated PVDI vocal regions."><PhraseVocalWorkspace /></ConceptFrame>
      <ConceptFrame number={9} title="Beatgrid Inspector" premise="PQTZ beat/downbeat timing, BPM range, and waveform detail without inference."><BeatgridInspector /></ConceptFrame>
      <ConceptFrame number={10} title="Analysis & Apply Console" premise="Imported cue slots, media metadata, feature status, and Apply controls."><AnalysisApplyConsole /></ConceptFrame>
    </>
  );
}
