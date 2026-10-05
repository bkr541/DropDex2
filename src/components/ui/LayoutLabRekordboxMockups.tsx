import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

// Sample track, taken from the Cue Points timeline: Disappearance w EVOKE45 (144 bars).
const TOTAL_BARS = 144.2;
const BEATS_PER_BAR = 4;
const INSET = 24; // same inline inset the Cue Points timeline uses

type SectionKind = 'intro' | 'build' | 'verse' | 'bridge';

const SECTION_STYLE: Record<SectionKind, { label: string; color: string }> = {
  intro: { label: 'INTRO', color: '#2f9bff' },
  build: { label: 'BUILD', color: '#ff8a1f' },
  verse: { label: 'VERSE', color: '#b266ff' },
  bridge: { label: 'BRIDGE', color: '#2dd4bf' },
};

// Section edges as fractions of the track, measured from the screenshot.
const SECTION_EDGES: Array<[SectionKind, number, number]> = [
  ['intro', 70, 223], ['build', 223, 327], ['verse', 327, 431], ['verse', 431, 531], ['build', 531, 635],
  ['verse', 635, 737], ['verse', 737, 943], ['build', 943, 1045], ['verse', 1045, 1149], ['verse', 1149, 1355],
  ['build', 1355, 1457], ['verse', 1457, 1535], ['verse', 1535, 1637], ['verse', 1637, 1767], ['verse', 1767, 1870],
  ['bridge', 1870, 1925],
];
const X0 = 70;
const XW = 1925 - 70;
const SECTIONS = SECTION_EDGES.map(([kind, a, b]) => ({ kind, from: (a - X0) / XW, to: (b - X0) / XW }));

const CUES = [
  { letter: 'B', at: (532 - X0) / XW, color: '#1fb6ff' },
  { letter: 'C', at: (636 - X0) / XW, color: '#2be02b' },
  { letter: 'D', at: (739 - X0) / XW, color: '#5a22f2' },
];

const BAR_LABELS = Array.from({ length: 21 }, (_, i) => 1 + i * 7);

const panelStyle: CSSProperties = { background: 'var(--color-background)' };
const LINE = 'border-[var(--color-border-faint)]';

// ── Pieces ───────────────────────────────────────────────────────────────────

function Lane({ height, className, style, children }: { height: number; className?: string; style?: CSSProperties; children?: ReactNode }) {
  return (
    <div className={cn('relative', className)} style={{ height, paddingInline: INSET, ...style }}>
      <div className="relative h-full w-full">{children}</div>
    </div>
  );
}

function CueBadge({ letter, color, size = 28 }: { letter: string; color: string; size?: number }) {
  return (
    <svg width={size} height={size * 1.12} viewBox="0 0 28 32" aria-label={`Cue ${letter}`}>
      <path d="M3 2h22a1 1 0 0 1 1 1v17.5a2 2 0 0 1-.9 1.7L14 30 2.9 22.2A2 2 0 0 1 2 20.5V3a1 1 0 0 1 1-1z" fill={`${color}22`} stroke={color} strokeWidth="2" />
      <text x="14" y="17" textAnchor="middle" fontSize="13" fontWeight="800" fontFamily="ui-monospace, monospace" fill={color}>{letter}</text>
    </svg>
  );
}

function CueBadgesLane({ height, size = 28, align = 'center' }: { height: number; size?: number; align?: 'center' | 'bottom' }) {
  return (
    <Lane height={height}>
      {CUES.map((cue) => (
        <div
          key={cue.letter}
          className="absolute -translate-x-1/2"
          style={{ left: `${cue.at * 100}%`, top: align === 'center' ? '50%' : undefined, bottom: align === 'bottom' ? 2 : undefined, transform: align === 'center' ? 'translate(-50%, -50%)' : 'translateX(-50%)' }}
        >
          <CueBadge letter={cue.letter} color={cue.color} size={size} />
        </div>
      ))}
    </Lane>
  );
}

function SectionLabelsLane({ height, underline = true, fontSize = 10 }: { height: number; underline?: boolean; fontSize?: number }) {
  return (
    <Lane height={height}>
      {SECTIONS.map((s, i) => {
        const c = SECTION_STYLE[s.kind];
        return (
          <div key={i} className="absolute top-0 bottom-0" style={{ left: `${s.from * 100}%`, width: `${(s.to - s.from) * 100}%` }}>
            <div className="absolute inset-x-0 text-center font-mono font-bold tracking-wider" style={{ color: c.color, fontSize, bottom: underline ? 5 : 0 }}>
              {c.label}
            </div>
            {underline && <div className="absolute inset-x-0 bottom-0 h-[2px]" style={{ background: c.color }} />}
          </div>
        );
      })}
    </Lane>
  );
}

/** Section names inside a solid colored ribbon instead of text over an underline. */
function SectionRibbonLane({ height }: { height: number }) {
  return (
    <Lane height={height}>
      {SECTIONS.map((s, i) => {
        const c = SECTION_STYLE[s.kind];
        return (
          <div
            key={i}
            className="absolute inset-y-0 flex items-center justify-center overflow-hidden border-r border-black/50 font-mono text-[9px] font-bold tracking-wider"
            style={{ left: `${s.from * 100}%`, width: `${(s.to - s.from) * 100}%`, background: `${c.color}38`, color: c.color, boxShadow: `inset 0 -2px 0 ${c.color}` }}
          >
            {c.label}
          </div>
        );
      })}
    </Lane>
  );
}

function makeRand(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0xffffffff; };
}

function WaveformSvg({ height, mono = false }: { height: number; mono?: boolean }) {
  const paths = useMemo(() => {
    const cols = 900;
    const rand = makeRand(7);
    let spike = 0;
    const amp: number[] = [];
    for (let i = 0; i < cols; i++) {
      const f = i / cols;
      const section = SECTIONS.find((s) => f >= s.from && f < s.to) ?? SECTIONS[SECTIONS.length - 1];
      let a: number;
      if (section.kind === 'intro') a = 0.2 + rand() * 0.05;
      else if (section.kind === 'build') a = 0.3 + ((f - section.from) / (section.to - section.from)) * 0.1 + rand() * 0.08;
      else if (section.kind === 'bridge') a = 0.28 + rand() * 0.08;
      else {
        if (i % 22 === 0 && rand() > 0.35) spike = 0.5 + rand() * 0.45;
        spike *= 0.82;
        a = 0.36 + rand() * 0.14 + spike;
      }
      amp.push(Math.min(0.98, a));
    }
    const out = new Map<string, string>();
    amp.forEach((a, i) => {
      const f = i / cols;
      const section = SECTIONS.find((s) => f >= s.from && f < s.to) ?? SECTIONS[SECTIONS.length - 1];
      const h = a * 48;
      const seg = `M${i + 0.5} ${50 - h}V${50 + h}`;
      const color = mono ? '#8fa3bd' : SECTION_STYLE[section.kind].color;
      out.set(color, (out.get(color) ?? '') + seg);
    });
    return [...out.entries()];
  }, [mono]);
  return (
    <svg viewBox="0 0 900 100" preserveAspectRatio="none" width="100%" height={height} style={{ display: 'block' }}>
      {paths.map(([color, d]) => <path key={color} d={d} stroke={color} strokeWidth="1.2" fill="none" />)}
    </svg>
  );
}

function WaveformLane({ height, cueLines = true, mono = false, children }: { height: number; cueLines?: boolean; mono?: boolean; children?: ReactNode }) {
  return (
    <Lane height={height}>
      <div className="absolute inset-0 opacity-[0.16]" style={{ backgroundImage: 'linear-gradient(90deg, rgb(255 255 255 / 0.5) 1px, transparent 1px)', backgroundSize: `${100 / TOTAL_BARS}% 100%` }} />
      <WaveformSvg height={height} mono={mono} />
      {cueLines && CUES.map((cue) => (
        <div key={cue.letter} className="absolute inset-y-0 w-[2px] -translate-x-1/2" style={{ left: `${cue.at * 100}%`, background: cue.color }} />
      ))}
      {children}
    </Lane>
  );
}

function BeatGridSvg({ height }: { height: number }) {
  const { beats, bars } = useMemo(() => {
    const totalBeats = Math.floor(TOTAL_BARS * BEATS_PER_BAR);
    let b = '';
    let r = '';
    for (let i = 0; i <= totalBeats; i++) {
      if (i % BEATS_PER_BAR === 0) r += `M${i} 35V100`;
      else b += `M${i} 0V62`;
      if (i % BEATS_PER_BAR === 0) b += `M${i} 0V62`;
    }
    return { beats: b, bars: r };
  }, []);
  return (
    <svg viewBox={`0 0 ${Math.floor(TOTAL_BARS * BEATS_PER_BAR)} 100`} preserveAspectRatio="none" width="100%" height={height} style={{ display: 'block' }}>
      <path d={beats} stroke="#3ddc84" strokeWidth="0.55" fill="none" vectorEffect="non-scaling-stroke" strokeOpacity="0.85" />
      <path d={bars} stroke="#ff6b6b" strokeWidth="1" fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function BeatGridLane({ height }: { height: number }) {
  return <Lane height={height}><BeatGridSvg height={height} /></Lane>;
}

function BarNumbersLane({ height, size = 11 }: { height: number; size?: number }) {
  return (
    <Lane height={height}>
      {BAR_LABELS.map((n) => (
        <span key={n} className="absolute font-mono text-muted-foreground tabular-nums" style={{ left: `${((n - 1) / TOTAL_BARS) * 100}%`, top: 0, fontSize: size, lineHeight: `${height}px` }}>
          {n}
        </span>
      ))}
    </Lane>
  );
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
      <div className={cn('overflow-hidden border-y', LINE)} style={panelStyle}>{children}</div>
    </section>
  );
}

// ── Current (reference): 52 + 40 + 88 + 58 = 238px ───────────────────────────

function Current() {
  return (
    <>
      <div style={{ paddingTop: 12 }}><CueBadgesLane height={40} /></div>
      <SectionLabelsLane height={40} />
      <WaveformLane height={88} />
      <div style={{ height: 58 }}>
        <BeatGridLane height={26} />
        <BarNumbersLane height={32} />
      </div>
    </>
  );
}

// ── 1. Tight Stack (~204px) ──────────────────────────────────────────────────
// Same order and lanes as today with the dead space between them trimmed.

function TightStack() {
  return (
    <div style={{ paddingTop: 6 }}>
      <CueBadgesLane height={34} size={26} align="bottom" />
      <SectionLabelsLane height={30} />
      <WaveformLane height={84} />
      <div style={{ height: 6 }} />
      <BeatGridLane height={22} />
      <BarNumbersLane height={22} />
    </div>
  );
}

// ── 2. Ruler Row (~198px) ────────────────────────────────────────────────────
// Bar numbers move into the beat grid itself: ticks on the left of each label,
// so the grid and numbers share one 30px row.

function RulerRow() {
  return (
    <div style={{ paddingTop: 4 }}>
      <CueBadgesLane height={34} size={26} align="bottom" />
      <SectionLabelsLane height={30} />
      <WaveformLane height={92} />
      <Lane height={34} className="mt-1">
        <div className="absolute inset-x-0 top-0"><BeatGridSvg height={18} /></div>
        <div className="absolute inset-x-0 bottom-0 h-[14px]">
          {BAR_LABELS.map((n) => (
            <span key={n} className="absolute font-mono text-[10px] leading-[14px] text-muted-foreground tabular-nums" style={{ left: `${((n - 1) / TOTAL_BARS) * 100}%` }}>{n}</span>
          ))}
        </div>
      </Lane>
    </div>
  );
}

// ── 3. Section Ribbon (~200px) ───────────────────────────────────────────────
// Sections become a solid ribbon directly above the waveform, with cue badges
// as pins hanging from it, which removes the separate cue-badge lane.

function SectionRibbon() {
  return (
    <div style={{ paddingTop: 6 }}>
      <Lane height={46}>
        {CUES.map((cue) => (
          <div key={cue.letter} className="absolute bottom-0 -translate-x-1/2" style={{ left: `${cue.at * 100}%` }}>
            <CueBadge letter={cue.letter} color={cue.color} size={26} />
          </div>
        ))}
      </Lane>
      <SectionRibbonLane height={20} />
      <WaveformLane height={86} />
      <div style={{ height: 4 }} />
      <BeatGridLane height={20} />
      <BarNumbersLane height={18} size={10} />
    </div>
  );
}

// ── 4. Lane Gutter (~208px) ──────────────────────────────────────────────────
// DAW-style: a narrow gutter on the left names each lane (CUES, SECTIONS,
// WAVE, GRID), so lanes can be tighter without losing labels.

function GutterRow({ label, height, children }: { label: string; height: number; children: ReactNode }) {
  return (
    <div className={cn('flex border-b last:border-b-0', LINE)} style={{ height }}>
      <div className={cn('w-[52px] shrink-0 border-r flex items-center justify-end pr-2 font-mono text-[8px] font-semibold uppercase tracking-[0.14em] text-foreground/40', LINE)}>
        {label}
      </div>
      <div className="min-w-0 flex-1 relative">{children}</div>
    </div>
  );
}

function LaneGutter() {
  return (
    <div>
      <GutterRow label="Cues" height={40}><CueBadgesLane height={40} size={24} /></GutterRow>
      <GutterRow label="Sections" height={26}><SectionLabelsLane height={26} /></GutterRow>
      <GutterRow label="Wave" height={92}><WaveformLane height={92} /></GutterRow>
      <GutterRow label="Grid" height={26}><BeatGridLane height={26} /></GutterRow>
      <GutterRow label="Bars" height={20}><BarNumbersLane height={20} size={10} /></GutterRow>
    </div>
  );
}

// ── 5. Overlay Cues (~178px) ─────────────────────────────────────────────────
// Cue badges and bar numbers sit on top of the waveform and grid instead of
// getting lanes of their own, so every item is kept in the shortest stack.

function OverlayCues() {
  return (
    <div style={{ paddingTop: 4 }}>
      <SectionLabelsLane height={28} />
      <WaveformLane height={116}>
        {CUES.map((cue) => (
          <div key={cue.letter} className="absolute top-1 -translate-x-1/2" style={{ left: `${cue.at * 100}%` }}>
            <CueBadge letter={cue.letter} color={cue.color} size={22} />
          </div>
        ))}
      </WaveformLane>
      <div className="relative" style={{ height: 30 }}>
        <BeatGridLane height={30} />
        <div className="absolute inset-x-0 bottom-0">
          <Lane height={13}>
            {BAR_LABELS.map((n) => (
              <span
                key={n}
                className="absolute bottom-0 rounded-[2px] bg-[var(--color-background)]/80 px-[3px] font-mono text-[9px] leading-[13px] text-muted-foreground tabular-nums"
                style={{ left: `${((n - 1) / TOTAL_BARS) * 100}%` }}
              >
                {n}
              </span>
            ))}
          </Lane>
        </div>
      </div>
    </div>
  );
}

// ── Tab content ──────────────────────────────────────────────────────────────

export function RekordboxMockupsContent() {
  return (
    <div className="h-full overflow-y-auto px-8 pt-7 pb-12 bg-[var(--color-background)]">
      <div className="mb-7">
        <div className="text-sm font-extrabold text-foreground mb-1">Rekordbox Timeline Concepts</div>
        <div className="text-[11px] text-muted-foreground leading-relaxed">
          Five restyles of the Cue Points timeline group. Every one keeps the cue badges and cue lines, section labels, the colored waveform, the beat grid (green beats, red bars) and the bar numbers, in a shorter stack than today's 238px.
        </div>
      </div>

      <MockupCard n={0} title="Current" concept="Reference, for height comparison" height="238px">
        <Current />
      </MockupCard>
      <MockupCard n={1} title="Tight Stack" concept="Same lanes and order, dead space between lanes trimmed" height="204px">
        <TightStack />
      </MockupCard>
      <MockupCard n={2} title="Ruler Row" concept="Beat grid and bar numbers share one row" height="198px">
        <RulerRow />
      </MockupCard>
      <MockupCard n={3} title="Section Ribbon" concept="Solid section ribbon, cue badges hang from it" height="200px">
        <SectionRibbon />
      </MockupCard>
      <MockupCard n={4} title="Lane Gutter" concept="Left gutter names each lane, like a DAW arrangement view" height="208px">
        <LaneGutter />
      </MockupCard>
      <MockupCard n={5} title="Overlay Cues" concept="Cue badges and bar numbers sit on the waveform and grid" height="178px">
        <OverlayCues />
      </MockupCard>
    </div>
  );
}
