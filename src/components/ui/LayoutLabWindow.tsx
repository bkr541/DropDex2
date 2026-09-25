import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Close, Subtract, Maximize, Add } from '@carbon/icons-react';
import { cn } from '../../lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

interface Position { x: number; y: number }
interface Size { width: number; height: number }
interface Tab { id: string; label: string }

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface DragRef  { mouseX: number; mouseY: number; winX: number; winY: number }
interface ResizeRef { mouseX: number; mouseY: number; startX: number; startY: number; startW: number; startH: number; edge: ResizeEdge }

// ── Constants ────────────────────────────────────────────────────────────────

const MIN_WIDTH = 320;
const MIN_HEIGHT = 200;
const TITLE_BAR_HEIGHT = 44;
const TAB_BAR_HEIGHT = 36;

const DEFAULT_TABS: Tab[] = [
  { id: 'ui-components', label: 'UI Components' },
  { id: 'scratch-pad',   label: 'Scratch Pad'   },
];

let tabCounter = 0;
function newTabId() { return `tab-${++tabCounter}`; }

// ── Helpers ──────────────────────────────────────────────────────────────────

function fullscreenState(): { pos: Position; size: Size } {
  return { pos: { x: 0, y: 0 }, size: { width: window.innerWidth, height: window.innerHeight } };
}

// ── Waveform SVG ─────────────────────────────────────────────────────────────

const VC = '#22d3ee'; // vocal: cyan-400
const IC = '#f97316'; // instrumental: orange-500

function Waveform({ color, seed = 1, bars = 160, mirrored = true, opacity = 1 }: {
  color: string; seed?: number; bars?: number; mirrored?: boolean; opacity?: number;
}) {
  const d = useMemo(() => {
    let s = (seed * 2654435761) >>> 0;
    const rand = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s >>> 0) / 0xffffffff; };
    const raw = Array.from({ length: bars }, () => Math.pow(rand(), 0.55));
    const smooth = raw.map((_, i) => {
      let sum = 0, n = 0;
      for (let j = Math.max(0, i - 5); j <= Math.min(bars - 1, i + 5); j++) { sum += raw[j]; n++; }
      return sum / n;
    });
    const vw = 400, vh = 60, mid = vh / 2, bw = vw / bars;
    return smooth.map((amp, i) => {
      const x = i * bw + bw / 2;
      const h = Math.max(1.5, amp * mid * 0.91);
      return mirrored ? `M${x.toFixed(1)} ${(mid - h).toFixed(1)}L${x.toFixed(1)} ${(mid + h).toFixed(1)}`
                      : `M${x.toFixed(1)} ${mid}L${x.toFixed(1)} ${(mid - h).toFixed(1)}`;
    }).join(' ');
  }, [seed, bars, mirrored]);

  return (
    <svg viewBox="0 0 400 60" preserveAspectRatio="none"
      style={{ width: '100%', height: '100%', display: 'block', opacity }}>
      <path d={d} stroke={color} strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </svg>
  );
}

// ── Shared mini primitives for mockups ────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  bg0:   { background: '#08080f' },
  bg1:   { background: '#0d0d18' },
  bg2:   { background: '#131320' },
  bdr:   { border: '1px solid rgba(255,255,255,0.07)' },
  bdrV:  { border: '1px solid rgba(34,211,238,0.18)' },
  bdrI:  { border: '1px solid rgba(249,115,22,0.18)' },
};

function Dot({ color }: { color: string }) {
  return <span style={{ width: 7, height: 7, borderRadius: 7, background: color, flexShrink: 0, display: 'inline-block' }} />;
}

function CamelotBadge({ k }: { k: string }) {
  return (
    <span style={{ padding: '1px 7px', borderRadius: 4, background: 'rgba(16,185,129,0.13)',
      border: '1px solid rgba(16,185,129,0.28)', color: '#34d399', fontSize: 10, fontWeight: 700 }}>
      {k}
    </span>
  );
}

function BpmTag({ bpm }: { bpm: string }) {
  return <span style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', fontVariantNumeric: 'tabular-nums' }}>{bpm}</span>;
}

function Pill({ label, color = 'rgba(255,255,255,0.08)' }: { label: string; color?: string }) {
  return (
    <span style={{ padding: '2px 8px', borderRadius: 4, background: color,
      fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: '#fff' }}>
      {label}
    </span>
  );
}

function Knob({ color = '#22d3ee' }: { color?: string }) {
  return (
    <div style={{ width: 30, height: 30, borderRadius: '50%',
      border: `2px solid rgba(255,255,255,0.13)`, background: 'rgba(255,255,255,0.04)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <div style={{ width: 2, height: 9, borderRadius: 2, background: color }} />
    </div>
  );
}

function MuteSolo() {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {['M', 'S'].map(l => (
        <div key={l} style={{ width: 22, height: 22, borderRadius: 4,
          border: '1px solid rgba(255,255,255,0.12)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.45)' }}>{l}</div>
      ))}
    </div>
  );
}

function Btn({ label, variant = 'ghost', full = false }: { label: string; variant?: 'ghost' | 'primary' | 'roulette' | 'hq'; full?: boolean }) {
  const styles: Record<string, React.CSSProperties> = {
    ghost:   { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' },
    primary: { background: '#22d3ee', border: '1px solid #22d3ee', color: '#000', fontWeight: 800 },
    roulette:{ background: 'linear-gradient(135deg,#f59e0b,#ef4444)', border: 'none', color: '#000', fontWeight: 800 },
    hq:      { background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.3)', color: '#f97316', fontWeight: 700 },
  };
  return (
    <button style={{ padding: '8px 14px', borderRadius: 8, fontSize: 11, fontWeight: 600,
      cursor: 'pointer', letterSpacing: '0.04em', width: full ? '100%' : undefined, ...styles[variant] }}>
      {label}
    </button>
  );
}

// ── MockupCard wrapper ────────────────────────────────────────────────────────

function MockupCard({ n, title, concept, children }: {
  n: number; title: string; concept: string; children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 40 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ width: 26, height: 26, borderRadius: 8, background: 'rgba(245,158,11,0.14)',
          border: '1px solid rgba(245,158,11,0.28)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: '#f59e0b', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
          {n}
        </div>
        <div>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{title}</span>
          <span style={{ marginLeft: 8, fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{concept}</span>
        </div>
      </div>
      <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', ...S.bg0 }}>
        {children}
      </div>
    </div>
  );
}

// ── MOCKUP 1: Convergence Bridge ──────────────────────────────────────────────
// Three columns: vocal source | bridge controls | instrumental source

function Mockup1() {
  return (
    <MockupCard n={1} title="Convergence Bridge" concept="Three-panel layout — sources flank the mix bridge">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.15fr 1fr', minHeight: 340 }}>

        {/* VOCAL */}
        <div style={{ padding: 18, borderRight: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 14 }}>
            <Dot color={VC} />
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', color: VC }}>VOCAL SOURCE</span>
            <span style={{ marginLeft: 'auto', padding: '2px 8px', borderRadius: 4,
              background: 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.22)',
              color: VC, fontSize: 9, fontWeight: 700 }}>READY</span>
          </div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <div style={{ width: 52, height: 52, borderRadius: 8, flexShrink: 0,
              background: 'linear-gradient(135deg,#1a3a5c,#0a1a2e)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>🎤</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 2 }}>Don't Start Now</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 5 }}>Dua Lipa</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <BpmTag bpm="124 BPM" />
                <CamelotBadge k="4A" />
              </div>
            </div>
          </div>
          <div style={{ height: 54, borderRadius: 6, overflow: 'hidden', marginBottom: 10,
            background: 'rgba(34,211,238,0.04)', ...S.bdrV }}>
            <Waveform color={VC} seed={11} bars={110} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Gain</span>
            <Knob color={VC} />
            <div style={{ marginLeft: 'auto' }}><MuteSolo /></div>
          </div>
          <Btn label="Change Vocal" full />
        </div>

        {/* BRIDGE */}
        <div style={{ padding: 18, borderRight: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.14em',
            color: 'rgba(255,255,255,0.35)', marginBottom: 14 }}>CONVERGENCE BRIDGE</div>
          <div style={{ fontSize: 30, fontWeight: 900, color: '#fff', lineHeight: 1, marginBottom: 2 }}>124.0</div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em', marginBottom: 14 }}>MASTER BPM</div>

          <div style={{ width: '100%', padding: '7px 10px', borderRadius: 6, textAlign: 'center',
            background: 'rgba(34,211,238,0.07)', border: '1px solid rgba(34,211,238,0.18)', marginBottom: 10 }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: VC, letterSpacing: '0.1em' }}>PHBASE SYNC</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 2 }}>16 Bars Locked</div>
          </div>

          {/* blended waveform */}
          <div style={{ width: '100%', height: 58, borderRadius: 6, overflow: 'hidden', position: 'relative',
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', marginBottom: 10 }}>
            <div style={{ position: 'absolute', inset: 0 }}><Waveform color={VC} seed={11} bars={110} opacity={0.55} /></div>
            <div style={{ position: 'absolute', inset: 0 }}><Waveform color={IC} seed={22} bars={110} opacity={0.45} /></div>
          </div>

          <div style={{ width: '100%', padding: '7px 10px', borderRadius: 6, textAlign: 'center',
            background: 'rgba(249,115,22,0.07)', border: '1px solid rgba(249,115,22,0.22)', marginBottom: 16 }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: '#fb923c', letterSpacing: '0.1em' }}>HARMONIC MATCH</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 2 }}>4A + 5A · Perfect 5th</div>
          </div>

          <div style={{ display: 'flex', gap: 8, width: '100%', marginBottom: 8 }}>
            <Btn label="▶  PLAY" variant="primary" full />
            <Btn label="■  STOP" full />
          </div>
          <Btn label="🎲  ROULETTE BOTH" variant="roulette" full />

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 14 }}>
            <Dot color="#22c55e" />
            <span style={{ fontSize: 9, color: '#22c55e', fontWeight: 700, letterSpacing: '0.06em' }}>COMPATIBLE PAIR · AVAILABLE</span>
          </div>
        </div>

        {/* INSTRUMENTAL */}
        <div style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 14 }}>
            <Dot color={IC} />
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', color: IC }}>INSTRUMENTAL SOURCE</span>
          </div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <div style={{ width: 52, height: 52, borderRadius: 8, flexShrink: 0,
              background: 'linear-gradient(135deg,#3a1800,#180b00)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>🎵</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 2 }}>Innerbloom</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 5 }}>Rufus Du Sol</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <BpmTag bpm="123 BPM" />
                <CamelotBadge k="10A" />
              </div>
            </div>
          </div>
          <div style={{ height: 54, borderRadius: 6, overflow: 'hidden', marginBottom: 10,
            background: 'rgba(249,115,22,0.04)', ...S.bdrI }}>
            <Waveform color={IC} seed={22} bars={110} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Gain</span>
            <Knob color={IC} />
            <div style={{ marginLeft: 'auto' }}><MuteSolo /></div>
          </div>
          <Btn label="Change Instrumental" full />
        </div>
      </div>
    </MockupCard>
  );
}

// ── MOCKUP 2: Dual Deck Pro ───────────────────────────────────────────────────
// Full-width waveform rows + compact right sidebar, bar markers below each track

function BarMarkers({ count = 8 }: { count?: number }) {
  return (
    <div style={{ display: 'flex', paddingTop: 3 }}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{ flex: 1, fontSize: 8, color: 'rgba(255,255,255,0.25)',
          fontVariantNumeric: 'tabular-nums', paddingLeft: 2 }}>
          {i === 0 ? 'Bar 1' : i % 2 === 0 ? i + 1 : ''}
        </div>
      ))}
    </div>
  );
}

function Mockup2() {
  return (
    <MockupCard n={2} title="Dual Deck Pro" concept="Full-width waveform rows with beat markers and right-panel engine">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', minHeight: 340 }}>
        <div style={{ borderRight: '1px solid rgba(255,255,255,0.07)' }}>
          {/* Top bar */}
          <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)',
            display: 'flex', alignItems: 'center', gap: 10, ...S.bg1 }}>
            <Dot color={VC} />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>Dua Lipa — Levitating (Vocal Mix)</span>
            <span style={{ marginLeft: 'auto', fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>PLAYHEAD</span>
          </div>
          {/* Vocal waveform */}
          <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ height: 72, borderRadius: 4, overflow: 'hidden',
              background: 'rgba(34,211,238,0.04)', position: 'relative' }}>
              <Waveform color={VC} seed={33} bars={200} />
              {/* playhead line */}
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: '38%',
                width: 1, background: 'rgba(255,255,255,0.6)' }} />
            </div>
            <BarMarkers count={9} />
            {/* lyrics overlay line */}
            <div style={{ display: 'flex', gap: 0, marginTop: 2 }}>
              {['I got you, moonlight…', 'I got you, moonlight…', 'I got you…', 'I got you…', 'I got…'].map((t, i) => (
                <div key={i} style={{ flex: 1, fontSize: 8, color: 'rgba(255,255,255,0.2)', overflow: 'hidden',
                  whiteSpace: 'nowrap', paddingLeft: 2 }}>{t}</div>
              ))}
            </div>
          </div>

          {/* Instrumental waveform */}
          <div style={{ padding: '10px 16px 12px', ...S.bg1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <Dot color={IC} />
              <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>Disclosure — Higher Love</span>
            </div>
            <div style={{ height: 72, borderRadius: 4, overflow: 'hidden',
              background: 'rgba(249,115,22,0.04)', position: 'relative' }}>
              <Waveform color={IC} seed={44} bars={200} />
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: '38%',
                width: 1, background: 'rgba(255,255,255,0.6)' }} />
            </div>
            <BarMarkers count={9} />
            {/* section labels */}
            <div style={{ display: 'flex', gap: 0, marginTop: 2 }}>
              {[['Verse 1',''], ['','Chorus 1'], ['','Chorus']].map(([a, b], i) => (
                <div key={i} style={{ flex: 1 }}>
                  {a && <span style={{ fontSize: 8, color: '#f59e0b', paddingLeft: 2 }}>{a}</span>}
                  {b && <span style={{ fontSize: 8, color: '#f59e0b', paddingLeft: 2 }}>{b}</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Transport bar */}
          <div style={{ padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,0.07)',
            display: 'flex', alignItems: 'center', gap: 16, ...S.bg0 }}>
            <div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginBottom: 1 }}>Master BPM</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>125.0</div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {['⏮', '■', '▶', '■', '⏭'].map((c, i) => (
                <button key={i} style={{ width: 30, height: 30, borderRadius: 6,
                  background: i === 2 ? '#22c55e' : 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: i === 2 ? '#000' : 'rgba(255,255,255,0.7)',
                  fontSize: i === 2 ? 13 : 10, cursor: 'pointer', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{c}</button>
              ))}
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Loop</span>
              <span style={{ padding: '4px 10px', borderRadius: 5,
                background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)',
                color: '#f59e0b', fontSize: 10, fontWeight: 700 }}>16 Bars</span>
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.35)' }}>ROULETTE ENGINE</div>

          <div style={{ padding: 12, borderRadius: 8, background: 'rgba(34,211,238,0.06)', border: '1px solid rgba(34,211,238,0.15)' }}>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', marginBottom: 3 }}>COMPATIBILITY</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#22c55e' }}>Excellent</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginTop: 1 }}>BPM/Key match</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              ['BPM Difference', '1.0 BPM'],
              ['Master BPM', '125.0'],
              ['Camelot Keys', '4A / 10A'],
              ['Key Relation', 'Minor 7th'],
              ['Tempo Adj.', '+0.8%'],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>{k}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.75)' }}>{v}</span>
              </div>
            ))}
          </div>

          <div style={{ flex: 1 }} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <Btn label="🎲  ROULETTE BOTH" variant="roulette" full />
            <Btn label="HQ Stems" variant="hq" full />
            <Btn label="Change Vocal" full />
            <Btn label="Change Instrumental" full />
          </div>
        </div>
      </div>
    </MockupCard>
  );
}

// ── MOCKUP 3: Mashup Studio ───────────────────────────────────────────────────
// Header strip + two-column deck cards + central spine + action footer

function DeckCard({ side, track, artist, bpm, key: camelot, seed, color, status }: {
  side: 'vocal' | 'instrumental'; track: string; artist: string;
  bpm: string; key: string; seed: number; color: string; status?: string;
}) {
  const emoji = side === 'vocal' ? '🎤' : '🎵';
  const gradFrom = side === 'vocal' ? '#1a3a5c' : '#3a1800';
  const gradTo   = side === 'vocal' ? '#0a1a2e' : '#1a0a00';
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Dot color={color} />
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', color }}>
          {side === 'vocal' ? 'VOCAL STEM' : 'INSTRUMENTAL STEM'}
        </span>
        {status && (
          <span style={{ marginLeft: 'auto', padding: '2px 7px', borderRadius: 4,
            background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)',
            fontSize: 9, fontWeight: 700, color: '#22c55e' }}>{status}</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ width: 58, height: 58, borderRadius: 10, flexShrink: 0,
          background: `linear-gradient(135deg,${gradFrom},${gradTo})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>{emoji}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>{artist}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <BpmTag bpm={bpm} />
            <CamelotBadge k={camelot} />
            <span style={{ marginLeft: 'auto', fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>HQ Stem ✓</span>
          </div>
        </div>
      </div>
      <div style={{ height: 60, borderRadius: 6, overflow: 'hidden',
        background: `rgba(${side === 'vocal' ? '34,211,238' : '249,115,22'},0.05)`,
        border: `1px solid rgba(${side === 'vocal' ? '34,211,238' : '249,115,22'},0.14)` }}>
        <Waveform color={color} seed={seed} bars={130} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Gain</span>
        <Knob color={color} />
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginLeft: 6 }}>-1.5 dB</span>
        <div style={{ marginLeft: 'auto' }}><MuteSolo /></div>
      </div>
    </div>
  );
}

function Mockup3() {
  return (
    <MockupCard n={3} title="Mashup Studio" concept="Deck-card layout with central spine and prominent album art">
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 18px',
        borderBottom: '1px solid rgba(255,255,255,0.07)', ...S.bg1 }}>
        <div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Master BPM</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#fff', lineHeight: 1 }}>123.0</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 9, fontWeight: 800,
            background: 'rgba(34,197,94,0.13)', border: '1px solid rgba(34,197,94,0.28)', color: '#22c55e' }}>PREVIEW-READY</span>
          <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 9, fontWeight: 800,
            background: 'rgba(245,158,11,0.13)', border: '1px solid rgba(245,158,11,0.28)', color: '#f59e0b' }}>PREPARING</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button style={{ padding: '6px 14px', borderRadius: 7,
            background: '#22c55e', border: 'none', color: '#000', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>▶</button>
          <button style={{ padding: '6px 14px', borderRadius: 7,
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
            color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>■</button>
          <button style={{ padding: '6px 12px', borderRadius: 7,
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
            color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Sync</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
        <div style={{ borderRight: '1px solid rgba(255,255,255,0.07)' }}>
          <DeckCard side="vocal" track="Don't Start Now" artist="Dua Lipa" bpm="124 BPM" key="4A" seed={55} color={VC} status="Ready" />
        </div>
        <div>
          <DeckCard side="instrumental" track="You & Me (Instrumental)" artist="Disclosure" bpm="124 BPM" key="4A" seed={66} color={IC} />
        </div>
      </div>

      {/* action footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px',
        borderTop: '1px solid rgba(255,255,255,0.07)', ...S.bg1 }}>
        <Btn label="🎲  ROULETTE BOTH" variant="roulette" />
        <Btn label="Change Vocal" />
        <Btn label="Change Instrumental" />
        <div style={{ marginLeft: 'auto' }}>
          <Btn label="HQ Stems" variant="hq" />
        </div>
      </div>
    </MockupCard>
  );
}

// ── TAB BAR ───────────────────────────────────────────────────────────────────

interface TabBarProps {
  tabs: Tab[];
  activeId: string;
  editingId: string | null;
  editingValue: string;
  onSelect(id: string): void;
  onAddTab(): void;
  onEditChange(value: string): void;
  onEditCommit(): void;
  onEditKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void;
  editInputRef: React.RefObject<HTMLInputElement | null>;
}

function TabBar({
  tabs, activeId, editingId, editingValue,
  onSelect, onAddTab, onEditChange, onEditCommit, onEditKeyDown, editInputRef,
}: TabBarProps) {
  return (
    <div
      className="flex items-end gap-0 px-3 shrink-0 border-b border-[var(--color-border-subtle)] overflow-x-auto"
      style={{ height: TAB_BAR_HEIGHT, background: 'var(--color-surface)' }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        const isEditing = tab.id === editingId;
        return (
          <button
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            className={cn(
              'relative flex items-center h-[28px] px-3 rounded-t-lg text-[11px] font-semibold tracking-wide transition-all shrink-0 border-x border-t',
              isActive
                ? 'bg-[var(--color-panel)] border-[var(--color-border-subtle)] text-foreground -mb-px z-10'
                : 'bg-transparent border-transparent text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface-hover)]',
            )}
          >
            {isEditing ? (
              <input
                ref={editInputRef}
                value={editingValue}
                onChange={(e) => onEditChange(e.target.value)}
                onBlur={onEditCommit}
                onKeyDown={onEditKeyDown}
                className="bg-transparent outline-none w-24 text-[11px] font-semibold text-foreground placeholder:text-muted-foreground/50"
                placeholder="Tab name…"
              />
            ) : (
              tab.label
            )}
          </button>
        );
      })}

      <button
        onClick={onAddTab}
        aria-label="New tab"
        className="flex items-center justify-center w-7 h-7 mb-0.5 ml-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface-hover)] transition-colors shrink-0"
      >
        <Add size={14} />
      </button>
    </div>
  );
}

// ── MOCKUP 4: Analytics Engine ────────────────────────────────────────────────
// Left: track cards; Center: large dual waveform; Right: compatibility metrics

function CompatBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, borderRadius: 3, background: color }} />
    </div>
  );
}

function Mockup4() {
  return (
    <MockupCard n={4} title="Analytics Engine" concept="Data-forward view — compatibility metrics alongside dual waveform">
      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr 200px', minHeight: 340 }}>

        {/* Left: track cards */}
        <div style={{ borderRight: '1px solid rgba(255,255,255,0.07)', padding: 14,
          display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Vocal card */}
          <div style={{ padding: 12, borderRadius: 8, background: 'rgba(34,211,238,0.05)',
            border: '1px solid rgba(34,211,238,0.14)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
              <Dot color={VC} />
              <span style={{ fontSize: 9, fontWeight: 800, color: VC, letterSpacing: '0.1em' }}>VOCAL</span>
            </div>
            <div style={{ width: 44, height: 44, borderRadius: 8, marginBottom: 8,
              background: 'linear-gradient(135deg,#1a3a5c,#0a1a2e)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🎤</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', marginBottom: 2 }}>Levitating</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>Dua Lipa</div>
            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <BpmTag bpm="120" />
              <CamelotBadge k="4A" />
            </div>
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                <Dot color="#22c55e" />
                <span style={{ fontSize: 9, color: '#22c55e' }}>Rekordbox Synced</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Dot color="#22c55e" />
                <span style={{ fontSize: 9, color: '#22c55e' }}>HQ Stem Ready</span>
              </div>
            </div>
          </div>

          {/* Instrumental card */}
          <div style={{ padding: 12, borderRadius: 8, background: 'rgba(249,115,22,0.05)',
            border: '1px solid rgba(249,115,22,0.14)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
              <Dot color={IC} />
              <span style={{ fontSize: 9, fontWeight: 800, color: IC, letterSpacing: '0.1em' }}>INSTRUMENTAL</span>
            </div>
            <div style={{ width: 44, height: 44, borderRadius: 8, marginBottom: 8,
              background: 'linear-gradient(135deg,#3a1800,#180b00)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🎵</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', marginBottom: 2 }}>This Is What You Came For</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>Calvin Harris ft. Rihanna</div>
            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <BpmTag bpm="124" />
              <CamelotBadge k="5A" />
            </div>
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                <Dot color="#22c55e" />
                <span style={{ fontSize: 9, color: '#22c55e' }}>Rekordbox Synced</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Dot color="#f59e0b" />
                <span style={{ fontSize: 9, color: '#f59e0b' }}>HQ Processing…</span>
              </div>
            </div>
          </div>
        </div>

        {/* Center: dual waveform */}
        <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid rgba(255,255,255,0.07)' }}>
          {/* Vocal track */}
          <div style={{ flex: 1, borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '14px 14px 8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#fff' }}>Dua Lipa — Levitating</span>
              <span style={{ marginLeft: 'auto', fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>Original: 120 · Synced: 124</span>
            </div>
            <div style={{ height: 80, borderRadius: 5, overflow: 'hidden', background: 'rgba(34,211,238,0.04)', position: 'relative' }}>
              <Waveform color={VC} seed={77} bars={180} />
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: '45%', width: 1, background: 'rgba(255,255,255,0.5)' }} />
              {/* section markers */}
              {[['20%','Verse 1'], ['50%','Chorus 1'], ['78%','Chorus']].map(([left, label]) => (
                <div key={label} style={{ position: 'absolute', bottom: 4, left,
                  fontSize: 8, color: '#f59e0b', transform: 'translateX(-50%)' }}>{label}</div>
              ))}
            </div>
          </div>
          {/* Instrumental track */}
          <div style={{ flex: 1, padding: '14px 14px 8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#fff' }}>Calvin Harris — This Is What You Came For</span>
              <span style={{ marginLeft: 'auto', fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>Original: 124</span>
            </div>
            <div style={{ height: 80, borderRadius: 5, overflow: 'hidden', background: 'rgba(249,115,22,0.04)', position: 'relative' }}>
              <Waveform color={IC} seed={88} bars={180} />
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: '45%', width: 1, background: 'rgba(255,255,255,0.5)' }} />
            </div>
          </div>
          {/* mini transport */}
          <div style={{ padding: '8px 14px', borderTop: '1px solid rgba(255,255,255,0.07)',
            display: 'flex', alignItems: 'center', gap: 10, ...S.bg1 }}>
            {['⏮','■','▶','■','⏭'].map((c, i) => (
              <button key={i} style={{ width: 26, height: 26, borderRadius: 5,
                background: i === 2 ? '#22c55e' : 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.09)',
                color: i === 2 ? '#000' : 'rgba(255,255,255,0.65)',
                fontSize: i === 2 ? 10 : 8, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{c}</button>
            ))}
            <span style={{ marginLeft: 'auto', fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>Loop: 16B</span>
          </div>
        </div>

        {/* Right: compatibility panel */}
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.35)' }}>COMPATIBILITY</div>

          <div style={{ padding: 12, borderRadius: 8, background: 'rgba(34,197,94,0.08)',
            border: '1px solid rgba(34,197,94,0.22)', textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 900, color: '#22c55e', lineHeight: 1 }}>94</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>MATCH SCORE</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { label: 'BPM Match', pct: 96, color: '#22c55e', val: '120 → 124' },
              { label: 'Key Match', pct: 88, color: '#f59e0b', val: '4A + 5A' },
              { label: 'Energy', pct: 82, color: VC, val: 'High/High' },
            ].map(({ label, pct, color, val }) => (
              <div key={label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>{label}</span>
                  <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>{val}</span>
                </div>
                <CompatBar pct={pct} color={color} />
              </div>
            ))}
          </div>

          <div style={{ padding: 10, borderRadius: 7, background: 'rgba(245,158,11,0.07)',
            border: '1px solid rgba(245,158,11,0.2)' }}>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', marginBottom: 2 }}>HARMONIC</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b' }}>Perfect 5th</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>4A + 5A · Camelot</div>
          </div>

          <div style={{ flex: 1 }} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Btn label="🎲  Roulette Both" variant="roulette" full />
            <Btn label="HQ Stems" variant="hq" full />
          </div>
        </div>
      </div>
    </MockupCard>
  );
}

// ── MOCKUP 5: Performance Mode ────────────────────────────────────────────────
// Minimal live performance layout — giant BPM, big action button, compact strips

function Mockup5() {
  return (
    <MockupCard n={5} title="Performance Mode" concept="Live-first layout — BPM dominates, one-touch roulette, minimal chrome">
      {/* top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 24px', borderBottom: '1px solid rgba(255,255,255,0.07)', ...S.bg1 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ padding: '4px 12px', borderRadius: 20, fontSize: 10, fontWeight: 800,
            background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}>● LIVE</span>
          <span style={{ padding: '4px 12px', borderRadius: 20, fontSize: 10, fontWeight: 700,
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }}>PREVIEW</span>
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 42, fontWeight: 900, color: '#fff', lineHeight: 1,
            fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>125.0</div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.12em', marginTop: 2 }}>MASTER BPM</div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button style={{ padding: '10px 24px', borderRadius: 9,
            background: '#22c55e', border: 'none', color: '#000', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>▶ PLAY</button>
          <button style={{ padding: '10px 20px', borderRadius: 9,
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
            color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>■ STOP</button>
        </div>
      </div>

      {/* waveform strips */}
      <div style={{ padding: '12px 24px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        {[
          { label: 'Dua Lipa — Levitating (Vocal Mix)', sub: '4A · 124 BPM', color: VC, seed: 99 },
          { label: 'Disclosure — Higher Love (Instrumental)', sub: '8A · 124 BPM', color: IC, seed: 111 },
        ].map(({ label, sub, color, seed }, i) => (
          <div key={i} style={{ marginBottom: i === 0 ? 10 : 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <Dot color={color} />
              <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>{label}</span>
              <span style={{ marginLeft: 'auto', fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{sub}</span>
            </div>
            <div style={{ height: 64, borderRadius: 6, overflow: 'hidden',
              background: `rgba(${color === VC ? '34,211,238' : '249,115,22'},0.05)`,
              border: `1px solid rgba(${color === VC ? '34,211,238' : '249,115,22'},0.12)`,
              position: 'relative' }}>
              <Waveform color={color} seed={seed} bars={180} />
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: '40%', width: 1,
                background: 'rgba(255,255,255,0.55)' }} />
            </div>
          </div>
        ))}
      </div>

      {/* action footer */}
      <div style={{ padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Btn label="Change Vocal" />
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <button style={{ padding: '12px 36px', borderRadius: 10, fontSize: 14, fontWeight: 900,
            background: 'linear-gradient(135deg,#f59e0b,#ef4444)', border: 'none',
            color: '#000', cursor: 'pointer', letterSpacing: '0.05em' }}>
            🎲  ROULETTE BOTH
          </button>
        </div>
        <Btn label="Change Instrumental" />
        <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
          {['4B','8B','16B'].map(l => (
            <button key={l} style={{ padding: '5px 9px', borderRadius: 5, fontSize: 10, fontWeight: 700,
              background: l === '16B' ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.05)',
              border: l === '16B' ? '1px solid rgba(245,158,11,0.3)' : '1px solid rgba(255,255,255,0.08)',
              color: l === '16B' ? '#f59e0b' : 'rgba(255,255,255,0.5)', cursor: 'pointer' }}>{l}</button>
          ))}
        </div>
      </div>
    </MockupCard>
  );
}

// ── MOCKUP 6: Commander ───────────────────────────────────────────────────────
// Split-deck vertical layout with VU meters, transport spine, candidates sidebar

function VUMeter({ active = true }: { active?: boolean }) {
  const levels = [0.95, 0.9, 0.85, 0.8, 0.65, 0.5, 0.35, 0.2, 0.1, 0.05];
  return (
    <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 48 }}>
      {levels.map((h, i) => {
        const green = i < 6, yellow = i === 6 || i === 7, red = i >= 8;
        const color = red ? '#ef4444' : yellow ? '#f59e0b' : '#22c55e';
        return (
          <div key={i} style={{ width: 4, height: `${h * 100}%`, borderRadius: 2,
            background: active ? color : 'rgba(255,255,255,0.1)' }} />
        );
      })}
    </div>
  );
}

function Mockup6() {
  return (
    <MockupCard n={6} title="Commander" concept="Full-deck view with VU meters, status sidebar, and candidates panel">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', minHeight: 360 }}>
        <div>
          {/* Header strip */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.07)', ...S.bg1 }}>
            <div style={{ fontSize: 11, fontWeight: 900, color: '#fff' }}>ROULETTE MASHUP AUDITION</div>
            <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
              <Pill label="● PREVIEW-READY" color="rgba(34,197,94,0.2)" />
              <Pill label="HQ STEM GEN: ON" color="rgba(245,158,11,0.2)" />
              <Pill label="HQ STATUS: GENERATING…" color="rgba(249,115,22,0.15)" />
            </div>
          </div>

          {/* Vocal deck row */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: VC, display: 'inline-block' }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>Dua Lipa — Levitating (Vocal Mix)</span>
              <span style={{ marginLeft: 'auto', fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>PLAYHEAD</span>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ flex: 1, height: 70, borderRadius: 5, overflow: 'hidden',
                background: 'rgba(34,211,238,0.04)', position: 'relative' }}>
                <Waveform color={VC} seed={122} bars={180} />
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: '42%', width: 1, background: 'rgba(255,255,255,0.55)' }} />
              </div>
              <VUMeter />
            </div>
            <BarMarkers count={9} />
          </div>

          {/* Instrumental deck row */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: IC, display: 'inline-block' }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>Disclosure — You & Me (Instrumental)</span>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ flex: 1, height: 70, borderRadius: 5, overflow: 'hidden',
                background: 'rgba(249,115,22,0.04)', position: 'relative' }}>
                <Waveform color={IC} seed={133} bars={180} />
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: '42%', width: 1, background: 'rgba(255,255,255,0.55)' }} />
              </div>
              <VUMeter />
            </div>
            <BarMarkers count={9} />
          </div>

          {/* Transport footer */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', ...S.bg1 }}>
            <div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>Master BPM</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', lineHeight: 1 }}>125.0</div>
            </div>
            <span style={{ padding: '3px 8px', borderRadius: 4, fontSize: 9, fontWeight: 700,
              background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)', color: '#22c55e' }}>SYNC ON</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {['⏮','■','▶','■','⏭'].map((c, i) => (
                <button key={i} style={{ width: 28, height: 28, borderRadius: 6,
                  background: i === 2 ? '#22c55e' : 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.09)',
                  color: i === 2 ? '#000' : 'rgba(255,255,255,0.7)',
                  fontSize: i === 2 ? 11 : 9, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{c}</button>
              ))}
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>Loop</span>
              <span style={{ padding: '3px 9px', borderRadius: 5, fontSize: 9, fontWeight: 700,
                background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)', color: '#f59e0b' }}>16B</span>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginLeft: 4 }}>Loop Active</span>
            </div>
          </div>
        </div>

        {/* Right sidebar: engine + candidates */}
        <div style={{ borderLeft: '1px solid rgba(255,255,255,0.07)', padding: 14,
          display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.35)' }}>ROULETTE ENGINE</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {[['Compatibility', 'Excellent'], ['Status', 'Active & Synced'], ['HQ Stems', 'Ready (Enabled)'], ['Candidates', '104 Matches']].map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>{k}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#22c55e' }}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 10 }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.35)', marginBottom: 8 }}>CANDIDATES</div>
            {[
              { track: 'Rihanna — We Found Love (Vocal)', type: 'Vocal' },
              { track: 'Calvin Harris — This Is What You Came For', type: 'Instrumental' },
            ].map(({ track, type }) => (
              <div key={track} style={{ padding: '8px 10px', borderRadius: 7, marginBottom: 6,
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#fff', marginBottom: 2,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track}</div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>{type}</div>
              </div>
            ))}
          </div>

          <div style={{ flex: 1 }} />
          <Btn label="🎲  Roulette Both" variant="roulette" full />
        </div>
      </div>
    </MockupCard>
  );
}

// ── Scratch Pad content ───────────────────────────────────────────────────────

function ScratchPadContent() {
  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '28px 32px 48px',
      background: '#06060d', fontFamily: 'inherit' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', marginBottom: 4 }}>Roulette UI Concepts</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', lineHeight: 1.5 }}>
            Six independent layout explorations. Each optimised for a different DJ workflow —
            from three-panel source-bridge layouts to live performance minimal views.
          </div>
        </div>
        <Mockup1 />
        <Mockup2 />
        <Mockup3 />
        <Mockup4 />
        <Mockup5 />
        <Mockup6 />
      </div>
    </div>
  );
}

// ── Blank canvas ──────────────────────────────────────────────────────────────

function BlankCanvas() {
  return (
    <>
      <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg" style={{ opacity: 0.3 }}>
        <defs>
          <pattern id="ll-dot-grid" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.8" fill="currentColor" className="text-muted-foreground" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#ll-dot-grid)" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
        <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-muted-foreground/40">
          Blank canvas
        </p>
      </div>
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface LayoutLabWindowProps {
  onClose(): void;
}

export function LayoutLabWindow({ onClose }: LayoutLabWindowProps) {
  const [{ pos, size }, setState] = useState(fullscreenState);
  const [minimized, setMinimized] = useState(false);

  const [tabs, setTabs] = useState<Tab[]>(DEFAULT_TABS);
  const [activeId, setActiveId] = useState(DEFAULT_TABS[0].id);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const editInputRef = useRef<HTMLInputElement | null>(null);

  const dragRef   = useRef<DragRef | null>(null);
  const resizeRef = useRef<ResizeRef | null>(null);

  // ── Viewport resize ────────────────────────────────────────────────────────
  useEffect(() => {
    const onResize = () => {
      setState((prev) => ({
        size: prev.size,
        pos: {
          x: Math.max(0, Math.min(prev.pos.x, window.innerWidth  - prev.size.width)),
          y: Math.max(0, Math.min(prev.pos.y, window.innerHeight - prev.size.height)),
        },
      }));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── Drag & resize ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (dragRef.current) {
        const dx = e.clientX - dragRef.current.mouseX;
        const dy = e.clientY - dragRef.current.mouseY;
        setState((prev) => ({
          size: prev.size,
          pos: {
            x: Math.max(0, Math.min(dragRef.current!.winX + dx, window.innerWidth  - prev.size.width)),
            y: Math.max(0, Math.min(dragRef.current!.winY + dy, window.innerHeight - prev.size.height)),
          },
        }));
        return;
      }
      if (resizeRef.current) {
        const r = resizeRef.current;
        const dx = e.clientX - r.mouseX;
        const dy = e.clientY - r.mouseY;
        setState((prev) => {
          let { x, y } = prev.pos;
          let w = r.startW;
          let h = r.startH;
          if (r.edge.includes('e')) w = Math.max(MIN_WIDTH,  r.startW + dx);
          if (r.edge.includes('s')) h = Math.max(MIN_HEIGHT, r.startH + dy);
          if (r.edge.includes('w')) { const p = Math.max(MIN_WIDTH,  r.startW - dx); x = r.startX + (r.startW - p); w = p; }
          if (r.edge.includes('n')) { const p = Math.max(MIN_HEIGHT, r.startH - dy); y = r.startY + (r.startH - p); h = p; }
          w = Math.min(w, window.innerWidth  - Math.max(0, x));
          h = Math.min(h, window.innerHeight - Math.max(0, y));
          return { pos: { x: Math.max(0, x), y: Math.max(0, y) }, size: { width: w, height: h } };
        });
      }
    };
    const onMouseUp = () => {
      dragRef.current = null;
      resizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup',  onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup',  onMouseUp);
    };
  }, []);

  const onTitleBarMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    document.body.style.userSelect = 'none';
    dragRef.current = { mouseX: e.clientX, mouseY: e.clientY, winX: pos.x, winY: pos.y };
  }, [pos]);

  const onResizeHandleMouseDown = useCallback((edge: ResizeEdge) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    document.body.style.userSelect = 'none';
    resizeRef.current = { mouseX: e.clientX, mouseY: e.clientY, startX: pos.x, startY: pos.y, startW: size.width, startH: size.height, edge };
  }, [pos, size]);

  const restoreFullscreen = useCallback(() => { setState(fullscreenState()); setMinimized(false); }, []);

  // ── Tab management ────────────────────────────────────────────────────────
  const commitEdit = useCallback(() => {
    if (!editingId) return;
    const label = editingValue.trim();
    setTabs((prev) =>
      label
        ? prev.map((t) => t.id === editingId ? { ...t, label } : t)
        : prev.filter((t) => t.id !== editingId),
    );
    if (!label) {
      setActiveId((prev) => prev === editingId ? (tabs[tabs.length - 2]?.id ?? tabs[0]?.id ?? '') : prev);
    }
    setEditingId(null);
    setEditingValue('');
  }, [editingId, editingValue, tabs]);

  const onEditKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') {
      setTabs((prev) => prev.filter((t) => t.id !== editingId));
      setActiveId((prev) => prev === editingId ? (tabs[tabs.length - 2]?.id ?? '') : prev);
      setEditingId(null);
      setEditingValue('');
    }
  }, [commitEdit, editingId, tabs]);

  const addTab = useCallback(() => {
    const id = newTabId();
    setTabs((prev) => [...prev, { id, label: '' }]);
    setActiveId(id);
    setEditingId(id);
    setEditingValue('');
    requestAnimationFrame(() => editInputRef.current?.focus());
  }, []);

  const canvasHeight = size.height - TITLE_BAR_HEIGHT - TAB_BAR_HEIGHT;

  return (
    <div
      className="fixed z-[9999] flex flex-col rounded-2xl border border-[var(--color-border-subtle)] shadow-2xl overflow-hidden"
      style={{
        left: pos.x, top: pos.y,
        width: size.width,
        height: minimized ? TITLE_BAR_HEIGHT : size.height,
        background: 'var(--color-panel)',
      }}
    >
      {/* Resize handles */}
      {!minimized && (
        <>
          <div onMouseDown={onResizeHandleMouseDown('n')}  className="absolute top-0 left-3 right-3 h-1 cursor-ns-resize   z-10" />
          <div onMouseDown={onResizeHandleMouseDown('s')}  className="absolute bottom-0 left-3 right-3 h-1 cursor-ns-resize   z-10" />
          <div onMouseDown={onResizeHandleMouseDown('e')}  className="absolute right-0 top-3 bottom-3 w-1 cursor-ew-resize   z-10" />
          <div onMouseDown={onResizeHandleMouseDown('w')}  className="absolute left-0  top-3 bottom-3 w-1 cursor-ew-resize   z-10" />
          <div onMouseDown={onResizeHandleMouseDown('ne')} className="absolute top-0 right-0  w-3 h-3 cursor-nesw-resize z-20" />
          <div onMouseDown={onResizeHandleMouseDown('nw')} className="absolute top-0 left-0   w-3 h-3 cursor-nwse-resize z-20" />
          <div onMouseDown={onResizeHandleMouseDown('se')} className="absolute bottom-0 right-0 w-3 h-3 cursor-nwse-resize z-20" />
          <div onMouseDown={onResizeHandleMouseDown('sw')} className="absolute bottom-0 left-0  w-3 h-3 cursor-nesw-resize z-20" />
        </>
      )}

      {/* Title bar */}
      <div
        className="flex items-center px-4 shrink-0 border-b border-[var(--color-border-subtle)] cursor-grab active:cursor-grabbing select-none"
        style={{ height: TITLE_BAR_HEIGHT, background: 'var(--color-surface)' }}
        onMouseDown={onTitleBarMouseDown}
      >
        <div className="flex items-center gap-1.5 mr-3">
          <button onClick={onClose} aria-label="Close Layout Lab"
            className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-400 transition-colors flex items-center justify-center group">
            <Close size={8} className="opacity-0 group-hover:opacity-100 text-red-900" />
          </button>
          <button onClick={() => setMinimized((v) => !v)} aria-label={minimized ? 'Restore' : 'Minimize'}
            className="w-3 h-3 rounded-full bg-amber-400 hover:bg-amber-300 transition-colors flex items-center justify-center group">
            <Subtract size={8} className="opacity-0 group-hover:opacity-100 text-amber-900" />
          </button>
          <button onClick={restoreFullscreen} aria-label="Full screen"
            className="w-3 h-3 rounded-full bg-emerald-500 hover:bg-emerald-400 transition-colors flex items-center justify-center group">
            <Maximize size={8} className="opacity-0 group-hover:opacity-100 text-emerald-900" />
          </button>
        </div>
        <span className="text-xs font-bold tracking-widest uppercase text-muted-foreground flex-1 text-center pr-16">
          Layout Lab
        </span>
      </div>

      {/* Tab bar */}
      {!minimized && (
        <TabBar
          tabs={tabs}
          activeId={activeId}
          editingId={editingId}
          editingValue={editingValue}
          onSelect={setActiveId}
          onAddTab={addTab}
          onEditChange={setEditingValue}
          onEditCommit={commitEdit}
          onEditKeyDown={onEditKeyDown}
          editInputRef={editInputRef}
        />
      )}

      {/* Canvas */}
      {!minimized && (
        <div className="relative flex-1 overflow-hidden" style={{ height: canvasHeight }}>
          {activeId === 'scratch-pad' ? (
            <ScratchPadContent />
          ) : (
            <BlankCanvas />
          )}
        </div>
      )}
    </div>
  );
}
