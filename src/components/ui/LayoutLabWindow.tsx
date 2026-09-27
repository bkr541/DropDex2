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

// ── MOCKUP 6: Split Deck + EQ Knobs (MASHUP style) ───────────────────────────
// Top nav bar; vocal/instrumental rows each with album art, BPM, KEY, EQ knobs;
// full-width waveforms with S/M buttons; bottom transport with LOOP + MIX slider

function Mockup6() {
  return (
    <MockupCard n={6} title="Split Deck + EQ Knobs" concept="DJ performance layout — vocal/instrumental rows with inline EQ and bottom transport">
      {/* Nav header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0,
        borderBottom: '1px solid rgba(255,255,255,0.07)', ...S.bg1 }}>
        <div style={{ padding: '0 18px', display: 'flex', alignItems: 'center', gap: 14, height: 42,
          borderRight: '1px solid rgba(255,255,255,0.07)' }}>
          <span style={{ fontSize: 13, fontWeight: 900, color: '#fff', letterSpacing: '0.04em' }}>DROPDEX</span>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.15em' }}>ROULETTE ENGINE</span>
        </div>
        <div style={{ display: 'flex', gap: 0 }}>
          {['PERFORMANCE', 'LIBRARY', 'SETTINGS'].map((t, i) => (
            <span key={t} style={{ padding: '0 16px', height: 42, display: 'flex', alignItems: 'center',
              fontSize: 10, fontWeight: 700, letterSpacing: '0.09em', cursor: 'pointer',
              color: i === 0 ? '#fff' : 'rgba(255,255,255,0.35)',
              borderBottom: i === 0 ? '2px solid #22d3ee' : '2px solid transparent' }}>{t}</span>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', padding: '0 18px', textAlign: 'right' }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em' }}>MASTER BPM</div>
          <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>122.0</div>
        </div>
      </div>

      {/* Vocal deck row */}
      <div style={{ display: 'flex', alignItems: 'stretch', borderBottom: '1px solid rgba(255,255,255,0.07)', ...S.bg2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
          borderRight: '1px solid rgba(255,255,255,0.07)', minWidth: 200 }}>
          <div style={{ width: 42, height: 42, borderRadius: 8, background: 'linear-gradient(135deg,#1a3a5c,#0a1a2e)',
            flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 30, height: 30, borderRadius: 6, background: 'rgba(34,211,238,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🎤</div>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 8, fontWeight: 800, color: VC, letterSpacing: '0.12em', marginBottom: 2 }}>VOCAL</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Levitating (Vocal Stem)</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>Dua Lipa</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 20px',
          borderRight: '1px solid rgba(255,255,255,0.07)', minWidth: 120 }}>
          <div>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em', marginBottom: 1 }}>BPM</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>120</div>
          </div>
          <div>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em', marginBottom: 1 }}>KEY</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>4A / F# minor</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '10px 20px', marginLeft: 'auto' }}>
          {[['LOW', '-2.1 dB'], ['MID', '+1.4 dB'], ['HIGH', '+0.8 dB']].map(([l, v]) => (
            <div key={l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em' }}>{l}</div>
              <Knob color={VC} />
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)', fontVariantNumeric: 'tabular-nums' }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Vocal waveform */}
      <div style={{ position: 'relative', background: 'rgba(34,211,238,0.03)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 32,
          display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4,
          padding: '0 6px', borderRight: '1px solid rgba(255,255,255,0.05)', zIndex: 1 }}>
          {['S','M'].map(l => (
            <div key={l} style={{ width: 20, height: 20, borderRadius: 4, background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,0.4)' }}>{l}</div>
          ))}
        </div>
        <div style={{ marginLeft: 32, height: 72, position: 'relative', overflow: 'hidden' }}>
          <Waveform color={VC} seed={101} bars={220} />
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: '45%', width: 1, background: 'rgba(255,255,255,0.7)' }} />
        </div>
        <div style={{ marginLeft: 32, display: 'flex', padding: '2px 0 4px', borderTop: '1px solid rgba(255,255,255,0.03)' }}>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} style={{ flex: 1, fontSize: 8, color: 'rgba(255,255,255,0.2)', paddingLeft: 2 }}>{i + 1}</div>
          ))}
        </div>
      </div>

      {/* Instrumental deck row */}
      <div style={{ display: 'flex', alignItems: 'stretch', borderBottom: '1px solid rgba(255,255,255,0.07)', ...S.bg2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
          borderRight: '1px solid rgba(255,255,255,0.07)', minWidth: 200 }}>
          <div style={{ width: 42, height: 42, borderRadius: 8, background: 'linear-gradient(135deg,#3a1800,#180b00)',
            flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 30, height: 30, borderRadius: 6, background: 'rgba(249,115,22,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🎵</div>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 8, fontWeight: 800, color: IC, letterSpacing: '0.12em', marginBottom: 2 }}>INSTRUMENTAL</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>This Is What You Came For</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>Calvin Harris ft. Rihanna</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 20px',
          borderRight: '1px solid rgba(255,255,255,0.07)', minWidth: 120 }}>
          <div>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em', marginBottom: 1 }}>BPM</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>124</div>
          </div>
          <div>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em', marginBottom: 1 }}>KEY</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>5A / B minor</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '10px 20px', marginLeft: 'auto' }}>
          {[['LOW', '+1.2 dB'], ['MID', '-0.6 dB'], ['HIGH', '+1.0 dB']].map(([l, v]) => (
            <div key={l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em' }}>{l}</div>
              <Knob color={IC} />
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)', fontVariantNumeric: 'tabular-nums' }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Instrumental waveform */}
      <div style={{ position: 'relative', background: 'rgba(249,115,22,0.03)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 32,
          display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4,
          padding: '0 6px', borderRight: '1px solid rgba(255,255,255,0.05)', zIndex: 1 }}>
          {['S','M'].map(l => (
            <div key={l} style={{ width: 20, height: 20, borderRadius: 4, background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,0.4)' }}>{l}</div>
          ))}
        </div>
        <div style={{ marginLeft: 32, height: 72, position: 'relative', overflow: 'hidden' }}>
          <Waveform color={IC} seed={202} bars={220} />
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: '45%', width: 1, background: 'rgba(255,255,255,0.7)' }} />
        </div>
        <div style={{ marginLeft: 32, display: 'flex', padding: '2px 0 4px', borderTop: '1px solid rgba(255,255,255,0.03)' }}>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} style={{ flex: 1, fontSize: 8, color: 'rgba(255,255,255,0.2)', paddingLeft: 2 }}>{i + 1}</div>
          ))}
        </div>
      </div>

      {/* Transport bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', ...S.bg1 }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginRight: 2 }}>LOOP</span>
          {['‹','›'].map((c, i) => (
            <button key={i} style={{ width: 22, height: 22, borderRadius: 5, background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', fontSize: 11, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{c}</button>
          ))}
          {['1/2','1','2','4','8','16'].map((l, i) => (
            <button key={l} style={{ padding: '3px 7px', borderRadius: 4, fontSize: 9, fontWeight: 700, cursor: 'pointer',
              background: i === 3 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)',
              border: i === 3 ? '1px solid rgba(255,255,255,0.25)' : '1px solid rgba(255,255,255,0.07)',
              color: i === 3 ? '#fff' : 'rgba(255,255,255,0.4)' }}>{l}</button>
          ))}
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <button style={{ padding: '6px 14px', borderRadius: 7, background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>CUE</button>
          {['⏮','▶','⏭'].map((c, i) => (
            <button key={i} style={{ width: i === 1 ? 38 : 30, height: i === 1 ? 38 : 30, borderRadius: '50%',
              background: i === 1 ? '#22c55e' : 'rgba(255,255,255,0.07)',
              border: i === 1 ? 'none' : '1px solid rgba(255,255,255,0.1)',
              color: i === 1 ? '#000' : 'rgba(255,255,255,0.7)',
              fontSize: i === 1 ? 14 : 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{c}</button>
          ))}
          <button style={{ padding: '6px 14px', borderRadius: 7, background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>SYNC</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em' }}>MASTER BPM</div>
            <div style={{ fontSize: 16, fontWeight: 900, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>122.0</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <button style={{ width: 14, height: 14, borderRadius: 3, background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', fontSize: 8, color: 'rgba(255,255,255,0.5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>▲</button>
            <button style={{ width: 14, height: 14, borderRadius: 3, background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', fontSize: 8, color: 'rgba(255,255,255,0.5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>▼</button>
          </div>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginLeft: 6 }}>MIX</span>
          <div style={{ width: 80, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', position: 'relative' }}>
            <div style={{ position: 'absolute', right: 8, top: -4, width: 12, height: 12, borderRadius: '50%',
              background: '#fff', border: '2px solid rgba(255,255,255,0.3)' }} />
          </div>
        </div>
      </div>
    </MockupCard>
  );
}

// ── MOCKUP 7: Stacked Decks + Compatibility Bridge (MIXFORGE style) ───────────
// Vocal deck on top with knobs; compatibility info strip in the middle;
// instrumental deck on bottom; full-width waveforms between

function Mockup7() {
  return (
    <MockupCard n={7} title="Stacked Decks + Compatibility Bridge" concept="Vocal and instrumental decks frame a waveform block; BPM/key compatibility strip in the middle">
      {/* App header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14,
        padding: '0 18px', height: 44, borderBottom: '1px solid rgba(255,255,255,0.07)', ...S.bg1 }}>
        <div style={{ width: 26, height: 26, borderRadius: 6, background: 'rgba(34,211,238,0.18)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 900, color: VC }}>D</div>
        <span style={{ fontSize: 12, fontWeight: 800, color: '#fff' }}>DROPDEX</span>
        <div style={{ display: 'flex', gap: 0, marginLeft: 16 }}>
          {['Mashup','Stems','Library','Effects','Export'].map((t, i) => (
            <span key={t} style={{ padding: '0 14px', height: 44, display: 'flex', alignItems: 'center',
              fontSize: 10, fontWeight: 700, cursor: 'pointer',
              color: i === 0 ? '#22d3ee' : 'rgba(255,255,255,0.4)',
              borderBottom: i === 0 ? '2px solid #22d3ee' : '2px solid transparent' }}>{t}</span>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontVariantNumeric: 'tabular-nums' }}>Project 01</span>
        </div>
      </div>

      {/* VOCAL deck top */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.07)', ...S.bg2 }}>
        <div style={{ width: 44, height: 44, borderRadius: 8, background: 'linear-gradient(135deg,#1a3a5c,#0a1a2e)',
          flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🎤</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 8, fontWeight: 800, color: VC, letterSpacing: '0.12em', marginBottom: 2 }}>VOCAL</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>Levitating</div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>Dua Lipa</div>
        </div>
        <div style={{ display: 'flex', gap: 16, marginLeft: 12 }}>
          {[['LOW','-2.1 dB',VC],['MID','+1.4 dB',VC],['HIGH','+0.8 dB',VC]].map(([l, v, c]) => (
            <div key={l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <Knob color={c} />
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.08em' }}>{l}</div>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)' }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', alignItems: 'center' }}>
          <button style={{ padding: '5px 10px', borderRadius: 6, fontSize: 9, fontWeight: 700, cursor: 'pointer',
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }}>FX</button>
          <button style={{ padding: '5px 10px', borderRadius: 6, fontSize: 9, fontWeight: 700, cursor: 'pointer',
            background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.2)', color: VC }}>Vocal Isolate</button>
          <MuteSolo />
          <div style={{ width: 6, height: 32, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '75%',
              background: 'linear-gradient(to top,#22c55e,#22d3ee)', borderRadius: 3 }} />
          </div>
        </div>
      </div>

      {/* Vocal waveform */}
      <div style={{ height: 80, background: 'rgba(34,211,238,0.03)', position: 'relative', overflow: 'hidden' }}>
        <Waveform color={VC} seed={301} bars={240} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: '52%', width: 1, background: 'rgba(255,255,255,0.7)' }} />
      </div>

      {/* Compatibility bridge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px',
        background: 'rgba(255,255,255,0.02)', borderTop: '1px solid rgba(255,255,255,0.06)',
        borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ width: 32, height: 32, borderRadius: 6, background: 'rgba(34,211,238,0.1)', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 22, height: 22, borderRadius: 4, background: 'rgba(34,211,238,0.2)' }} />
        </div>
        <div>
          <div style={{ fontSize: 9, color: VC, fontWeight: 700 }}>Levitating</div>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)' }}>Dua Lipa · 120 BPM</div>
        </div>
        <div style={{ marginLeft: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b' }}>+3.3% BPM</span>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>→</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.6)' }}>4A → 5A</span>
          <span style={{ padding: '3px 8px', borderRadius: 5, fontSize: 9, fontWeight: 700,
            background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)', color: '#22c55e' }}>● Compatible</span>
          <span style={{ padding: '3px 8px', borderRadius: 5, fontSize: 9, fontWeight: 700,
            background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.2)', color: VC }}>⟳ Synced</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <div>
            <div style={{ fontSize: 9, color: IC, fontWeight: 700 }}>This Is What You Came For</div>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)' }}>Calvin Harris · 124 BPM</div>
          </div>
          <div style={{ width: 32, height: 32, borderRadius: 6, background: 'rgba(249,115,22,0.1)', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 22, height: 22, borderRadius: 4, background: 'rgba(249,115,22,0.2)' }} />
          </div>
        </div>
      </div>

      {/* Instrumental waveform */}
      <div style={{ height: 80, background: 'rgba(249,115,22,0.03)', position: 'relative', overflow: 'hidden' }}>
        <Waveform color={IC} seed={402} bars={240} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: '52%', width: 1, background: 'rgba(255,255,255,0.7)' }} />
      </div>

      {/* INSTRUMENTAL deck bottom */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 16px',
        borderTop: '1px solid rgba(255,255,255,0.07)', ...S.bg2 }}>
        <div style={{ width: 44, height: 44, borderRadius: 8, background: 'linear-gradient(135deg,#3a1800,#180b00)',
          flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🎵</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 8, fontWeight: 800, color: IC, letterSpacing: '0.12em', marginBottom: 2 }}>INSTRUMENTAL</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>This Is What You Came For</div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>Calvin Harris ft. Rihanna</div>
        </div>
        <div style={{ display: 'flex', gap: 16, marginLeft: 12 }}>
          {[['LOW','+1.2 dB',IC],['MID','-0.6 dB',IC],['HIGH','+1.8 dB',IC]].map(([l, v, c]) => (
            <div key={l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <Knob color={c} />
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.08em' }}>{l}</div>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)' }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', alignItems: 'center' }}>
          <button style={{ padding: '5px 10px', borderRadius: 6, fontSize: 9, fontWeight: 700, cursor: 'pointer',
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }}>FX</button>
          <button style={{ padding: '5px 10px', borderRadius: 6, fontSize: 9, fontWeight: 700, cursor: 'pointer',
            background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.2)', color: IC }}>Stem Isolate</button>
          <MuteSolo />
          <div style={{ width: 6, height: 32, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '68%',
              background: 'linear-gradient(to top,#22c55e,#f97316)', borderRadius: 3 }} />
          </div>
        </div>
      </div>

      {/* Transport */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px',
        borderTop: '1px solid rgba(255,255,255,0.07)', ...S.bg1 }}>
        <div>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em' }}>MASTER BPM</div>
          <div style={{ fontSize: 17, fontWeight: 900, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>124.0</div>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <button style={{ padding: '6px 12px', borderRadius: 7, background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>CUE</button>
          {['⏮','▶','⏭'].map((c, i) => (
            <button key={i} style={{ width: i === 1 ? 36 : 28, height: i === 1 ? 36 : 28, borderRadius: '50%',
              background: i === 1 ? '#22c55e' : 'rgba(255,255,255,0.07)',
              border: i === 1 ? 'none' : '1px solid rgba(255,255,255,0.1)',
              color: i === 1 ? '#000' : 'rgba(255,255,255,0.7)',
              fontSize: i === 1 ? 13 : 9, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{c}</button>
          ))}
          <button style={{ padding: '6px 12px', borderRadius: 7, background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>SYNC ▾</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>Loop</span>
          <span style={{ padding: '3px 10px', borderRadius: 5, fontSize: 10, fontWeight: 700,
            background: 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.2)', color: VC }}>4 Bars ▾</span>
        </div>
      </div>
    </MockupCard>
  );
}

// ── MOCKUP 8: Clean Waveform Split + Bottom 3-Col EQ (clean MASHUP style) ─────
// Header tabs; vocal strip + waveform; inst strip + waveform;
// bottom three columns: VOCAL EQ | center transport | INST EQ

function LargeKnob({ color = '#22d3ee', size = 44 }: { color?: string; size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%',
      border: `2px solid ${color}40`, background: 'rgba(255,255,255,0.03)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: `0 0 10px ${color}20`, flexShrink: 0 }}>
      <div style={{ width: 3, height: size * 0.35, borderRadius: 3, background: color,
        transform: 'translateY(-4px)' }} />
    </div>
  );
}

function Mockup8() {
  return (
    <MockupCard n={8} title="Clean Waveform Split + Bottom EQ" concept="Minimal split with per-deck track strips and a 3-column bottom EQ panel">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, height: 40,
        borderBottom: '1px solid rgba(255,255,255,0.07)', ...S.bg1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px',
          borderRight: '1px solid rgba(255,255,255,0.07)', height: '100%' }}>
          <div style={{ width: 22, height: 22, borderRadius: 5, background: 'rgba(255,255,255,0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>🎲</div>
          <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', letterSpacing: '0.04em' }}>DROPDEX</span>
        </div>
        <div style={{ display: 'flex' }}>
          {['MIX','STEMS','FX','SAMPLES'].map((t, i) => (
            <span key={t} style={{ padding: '0 14px', height: 40, display: 'flex', alignItems: 'center',
              fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', cursor: 'pointer',
              background: i === 0 ? 'rgba(34,211,238,0.08)' : 'transparent',
              color: i === 0 ? VC : 'rgba(255,255,255,0.4)',
              borderBottom: i === 0 ? `2px solid ${VC}` : '2px solid transparent' }}>{t}</span>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', padding: '0 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 900, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>120.0</span>
          <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em' }}>BPM</span>
        </div>
      </div>

      {/* Vocal strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 9, fontWeight: 800,
          background: 'rgba(34,211,238,0.12)', border: `1px solid ${VC}30`, color: VC, letterSpacing: '0.08em' }}>VOCAL</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>Levitating</span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>Dua Lipa</span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>|</span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', fontVariantNumeric: 'tabular-nums' }}>120 BPM</span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>4A / F# minor</span>
        <span style={{ marginLeft: 'auto', fontSize: 9, color: '#22c55e', fontWeight: 700 }}>● Stem Ready</span>
      </div>
      <div style={{ height: 88, position: 'relative', overflow: 'hidden', background: 'rgba(34,211,238,0.03)' }}>
        <Waveform color={VC} seed={501} bars={220} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: '48%', width: 1.5, background: 'rgba(255,255,255,0.75)' }} />
      </div>

      {/* Instrumental strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 14px',
        borderTop: '1px solid rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 9, fontWeight: 800,
          background: 'rgba(249,115,22,0.12)', border: `1px solid ${IC}30`, color: IC, letterSpacing: '0.08em' }}>INST</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>This Is What You Came For</span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>Calvin Harris ft. Rihanna</span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>|</span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', fontVariantNumeric: 'tabular-nums' }}>124 BPM</span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>5A / B minor</span>
        <span style={{ marginLeft: 'auto', fontSize: 9, color: '#f59e0b', fontWeight: 700 }}>⟳ Synced</span>
      </div>
      <div style={{ height: 88, position: 'relative', overflow: 'hidden', background: 'rgba(249,115,22,0.03)' }}>
        <Waveform color={IC} seed={602} bars={220} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: '48%', width: 1.5, background: 'rgba(255,255,255,0.75)' }} />
      </div>

      {/* Bottom 3-col panel */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr',
        borderTop: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.3)', minHeight: 100 }}>
        {/* Vocal EQ */}
        <div style={{ padding: '12px 16px', borderRight: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: VC }} />
            <span style={{ fontSize: 9, fontWeight: 800, color: VC, letterSpacing: '0.1em' }}>VOCAL EQ</span>
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end' }}>
            {[['LOW','-1.5'], ['MID','+0.8'], ['HIGH','+2.1']].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <LargeKnob color={VC} size={38} />
                <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em' }}>{l}</div>
                <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)', fontVariantNumeric: 'tabular-nums' }}>{v} dB</div>
              </div>
            ))}
          </div>
        </div>

        {/* Center transport */}
        <div style={{ padding: '12px 20px', display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: 8, borderRight: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em' }}>MASTER BPM</span>
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: '#fff', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>120.0</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {['⏮','▶','⏭'].map((c, i) => (
              <button key={i} style={{ width: i === 1 ? 40 : 30, height: i === 1 ? 40 : 30, borderRadius: '50%',
                background: i === 1 ? '#22c55e' : 'rgba(255,255,255,0.07)',
                border: i === 1 ? 'none' : '1px solid rgba(255,255,255,0.1)',
                color: i === 1 ? '#000' : 'rgba(255,255,255,0.6)',
                fontSize: i === 1 ? 15 : 9, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{c}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {['CUE','LOOP','SYNC'].map(l => (
              <button key={l} style={{ padding: '4px 8px', borderRadius: 5, fontSize: 8, fontWeight: 700, cursor: 'pointer',
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                color: 'rgba(255,255,255,0.6)' }}>{l}</button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)' }}>LOOP LENGTH</span>
            <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 9, fontWeight: 700,
              background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)', color: '#f59e0b' }}>4 Bars ▾</span>
          </div>
        </div>

        {/* Inst EQ */}
        <div style={{ padding: '12px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: IC }} />
            <span style={{ fontSize: 9, fontWeight: 800, color: IC, letterSpacing: '0.1em' }}>INST EQ</span>
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end' }}>
            {[['LOW','+1.2'], ['MID','-0.6'], ['HIGH','+1.8']].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <LargeKnob color={IC} size={38} />
                <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em' }}>{l}</div>
                <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)', fontVariantNumeric: 'tabular-nums' }}>{v} dB</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </MockupCard>
  );
}

// ── MOCKUP 9: Timeline + Section Labels (MIXED style) ─────────────────────────
// Left sidebar with track cards; main waveform area with phrase labels overlaid;
// vertical VOCAL/INSTRUMENTAL labels; bottom dual EQ sliders + tools + transport

function EQSlider({ color, val }: { color: string; val: string }) {
  const pct = parseFloat(val) > 0 ? 50 + parseFloat(val) * 6 : 50 + parseFloat(val) * 6;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
      <div style={{ width: 80, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', position: 'relative', flex: 1 }}>
        <div style={{ position: 'absolute', top: -4, left: `${Math.max(0, Math.min(90, pct))}%`,
          width: 12, height: 12, borderRadius: '50%', background: color, transform: 'translateX(-50%)',
          border: '2px solid rgba(0,0,0,0.3)' }} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1,
          background: 'rgba(255,255,255,0.15)' }} />
      </div>
      <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', fontVariantNumeric: 'tabular-nums',
        minWidth: 36, textAlign: 'right' }}>{val} dB</span>
    </div>
  );
}

function Mockup9() {
  const sections = [
    { label: 'Verse 1', color: '#6366f1', start: 0, end: 26 },
    { label: 'Build', color: '#8b5cf6', start: 26, end: 45 },
    { label: 'Chorus', color: '#ec4899', start: 45, end: 74 },
    { label: 'Drop', color: '#ef4444', start: 74, end: 100 },
  ];
  const iSections = [
    { label: 'Intro', color: '#f59e0b', start: 0, end: 22 },
    { label: 'Verse', color: '#d97706', start: 22, end: 48 },
    { label: 'Build', color: '#b45309', start: 48, end: 70 },
    { label: 'Drop', color: '#92400e', start: 70, end: 100 },
  ];

  return (
    <MockupCard n={9} title="Timeline + Section Labels" concept="Left sidebar with track info; full-width waveforms with phrase labels overlaid">
      <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr', minHeight: 400 }}>
        {/* Left sidebar */}
        <div style={{ borderRight: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column' }}>
          {/* Vocal card */}
          <div style={{ flex: 1, padding: 14, borderBottom: '1px solid rgba(255,255,255,0.07)',
            display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ width: 54, height: 54, borderRadius: 8, background: 'linear-gradient(135deg,#1a3a5c,#0a1a2e)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>🎤</div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', marginBottom: 1 }}>Levitating (Vocal Stem)</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>Dua Lipa</div>
              <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: '#f59e0b', fontWeight: 700 }}>120 BPM</span>
                <CamelotBadge k="4A" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 5, marginTop: 'auto' }}>
              {['S','M','···'].map(l => (
                <button key={l} style={{ width: l === '···' ? 28 : 22, height: 22, borderRadius: 5,
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                  color: 'rgba(255,255,255,0.5)', fontSize: l === '···' ? 10 : 9, fontWeight: 700, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{l}</button>
              ))}
            </div>
          </div>
          {/* Instrumental card */}
          <div style={{ flex: 1, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ width: 54, height: 54, borderRadius: 8, background: 'linear-gradient(135deg,#1a2a3c,#0a1020)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>⚡</div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', marginBottom: 1 }}>This Is What You Came For</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>Calvin Harris ft. Rihanna</div>
              <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: '#f59e0b', fontWeight: 700 }}>124 BPM</span>
                <CamelotBadge k="5A" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 5, marginTop: 'auto' }}>
              {['S','M','···'].map(l => (
                <button key={l} style={{ width: l === '···' ? 28 : 22, height: 22, borderRadius: 5,
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                  color: 'rgba(255,255,255,0.5)', fontSize: l === '···' ? 10 : 9, fontWeight: 700, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{l}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Main waveform + bottom panel */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Bar ruler */}
          <div style={{ display: 'flex', padding: '3px 8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', ...S.bg1 }}>
            <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', marginRight: 4 }}>BAR</span>
            {[1,5,9,13,17,21,25,29,33,37,41,45,49,53,57,61].map(n => (
              <div key={n} style={{ flex: 1, fontSize: 7, color: 'rgba(255,255,255,0.2)' }}>{n}</div>
            ))}
          </div>

          {/* Vocal waveform with section labels */}
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: 'rgba(34,211,238,0.02)',
            borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <div style={{ position: 'absolute', top: 4, left: 0, right: 0, display: 'flex', zIndex: 2 }}>
              {sections.map(s => (
                <div key={s.label} style={{ position: 'absolute', left: `${s.start}%`, width: `${s.end - s.start}%`,
                  padding: '2px 6px', background: `${s.color}26`, borderRight: `2px solid ${s.color}60` }}>
                  <span style={{ fontSize: 8, fontWeight: 700, color: s.color }}>{s.label}</span>
                </div>
              ))}
            </div>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 18,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRight: '1px solid rgba(255,255,255,0.05)', zIndex: 3 }}>
              <span style={{ fontSize: 7, fontWeight: 800, color: VC, letterSpacing: '0.15em',
                transform: 'rotate(-90deg)', whiteSpace: 'nowrap' }}>VOCAL</span>
            </div>
            <div style={{ height: 80, marginLeft: 18, marginTop: 18, overflow: 'hidden' }}>
              <Waveform color={VC} seed={701} bars={260} />
            </div>
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: '62%', width: 1.5,
              background: 'rgba(255,255,255,0.7)', zIndex: 4 }} />
          </div>

          {/* Instrumental waveform with section labels */}
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: 'rgba(249,115,22,0.02)',
            borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <div style={{ position: 'absolute', top: 4, left: 0, right: 0, display: 'flex', zIndex: 2 }}>
              {iSections.map(s => (
                <div key={s.label} style={{ position: 'absolute', left: `${s.start}%`, width: `${s.end - s.start}%`,
                  padding: '2px 6px', background: `${s.color}26`, borderRight: `2px solid ${s.color}60` }}>
                  <span style={{ fontSize: 8, fontWeight: 700, color: s.color }}>{s.label}</span>
                </div>
              ))}
            </div>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 18,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRight: '1px solid rgba(255,255,255,0.05)', zIndex: 3 }}>
              <span style={{ fontSize: 7, fontWeight: 800, color: IC, letterSpacing: '0.15em',
                transform: 'rotate(-90deg)', whiteSpace: 'nowrap' }}>INSTRUMENTAL</span>
            </div>
            <div style={{ height: 80, marginLeft: 18, marginTop: 18, overflow: 'hidden' }}>
              <Waveform color={IC} seed={802} bars={260} />
            </div>
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: '62%', width: 1.5,
              background: 'rgba(255,255,255,0.7)', zIndex: 4 }} />
          </div>

          {/* Bar ruler bottom */}
          <div style={{ display: 'flex', padding: '3px 8px 4px', borderBottom: '1px solid rgba(255,255,255,0.07)', ...S.bg1 }}>
            <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', marginRight: 4 }}>BAR</span>
            {[1,5,9,13,17,21,25,29,33,37,41,45,49,53,57,61].map(n => (
              <div key={n} style={{ flex: 1, fontSize: 7, color: 'rgba(255,255,255,0.2)' }}>{n}</div>
            ))}
          </div>

          {/* Bottom panel: dual EQ + tools + transport */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', ...S.bg1 }}>
            {/* Vocal EQ */}
            <div style={{ padding: '10px 14px', borderRight: '1px solid rgba(255,255,255,0.07)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: VC }} />
                <span style={{ fontSize: 9, fontWeight: 800, color: VC, letterSpacing: '0.1em' }}>VOCAL EQ</span>
                <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', marginLeft: 4 }}>Levitating (Vocal Stem)</span>
              </div>
              {[['Low','-1.5'],['Mid','+0.8'],['High','+2.1']].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', width: 22 }}>{l}</span>
                  <EQSlider color={VC} val={v} />
                </div>
              ))}
            </div>

            {/* Transport + tools */}
            <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 7, borderRight: '1px solid rgba(255,255,255,0.07)', minWidth: 160 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {['Snap','Grid','Auto','Quantize','Fade'].map(t => (
                  <div key={t} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                    <div style={{ width: 22, height: 22, borderRadius: 5, background: t === 'Snap' ? 'rgba(34,211,238,0.15)' : 'rgba(255,255,255,0.05)',
                      border: t === 'Snap' ? `1px solid ${VC}30` : '1px solid rgba(255,255,255,0.08)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9 }}>
                      {t === 'Snap' ? '⊞' : t === 'Grid' ? '⣿' : t === 'Auto' ? '∿' : t === 'Quantize' ? '∧' : '▓'}
                    </div>
                    <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.04em' }}>{t}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button style={{ padding: '5px 10px', borderRadius: 6, fontSize: 9, fontWeight: 700, cursor: 'pointer',
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }}>LOOP</button>
                <span style={{ padding: '3px 8px', borderRadius: 5, fontSize: 9, fontWeight: 700,
                  background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)', color: '#f59e0b' }}>8 Bars ▾</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {['⏮','⏪','▶','⏩','⏭'].map((c, i) => (
                  <button key={i} style={{ width: i === 2 ? 34 : 24, height: i === 2 ? 34 : 24, borderRadius: '50%',
                    background: i === 2 ? '#22c55e' : 'rgba(255,255,255,0.05)',
                    border: i === 2 ? 'none' : '1px solid rgba(255,255,255,0.08)',
                    color: i === 2 ? '#000' : 'rgba(255,255,255,0.6)',
                    fontSize: i === 2 ? 12 : 8, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{c}</button>
                ))}
                <button style={{ padding: '5px 10px', borderRadius: 6, fontSize: 9, fontWeight: 700, cursor: 'pointer',
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }}>SYNC</button>
              </div>
              <div>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>MASTER BPM </span>
                <span style={{ fontSize: 16, fontWeight: 900, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>120.0</span>
              </div>
            </div>

            {/* Inst EQ */}
            <div style={{ padding: '10px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: IC }} />
                <span style={{ fontSize: 9, fontWeight: 800, color: IC, letterSpacing: '0.1em' }}>INSTRUMENTAL EQ</span>
                <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', marginLeft: 4 }}>This Is What You Came For</span>
              </div>
              {[['Low','+0.5'],['Mid','-1.2'],['High','+1.8']].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', width: 22 }}>{l}</span>
                  <EQSlider color={IC} val={v} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </MockupCard>
  );
}

// ── MOCKUP 10: Side-by-Side Decks (MASHUP PRO style) ─────────────────────────
// Left deck panel (vocal, pink); center large dual waveforms; right deck panel
// (instrumental, blue); bottom transport with per-deck BPM + master output

const PC = '#ec4899'; // vocal: pink
const BC = '#3b82f6'; // instrumental: blue

function Mockup10() {
  return (
    <MockupCard n={10} title="Side-by-Side Decks" concept="Left vocal deck + right instrumental deck flank a full-height waveform center">
      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr 200px', minHeight: 400 }}>

        {/* Left: VOCAL deck */}
        <div style={{ padding: 16, borderRight: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', flexDirection: 'column', gap: 10, ...S.bg2 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ padding: '3px 9px', borderRadius: 5, fontSize: 9, fontWeight: 800,
              background: 'rgba(236,72,153,0.15)', border: '1px solid rgba(236,72,153,0.3)', color: PC, letterSpacing: '0.08em' }}>VOCAL</span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>···</span>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', marginBottom: 1 }}>Levitating</div>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#ec4899', marginBottom: 4 }}>(Vocal Stem)</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginBottom: 8 }}>Dua Lipa</div>
            <div style={{ width: 56, height: 56, borderRadius: 10, background: 'linear-gradient(135deg,#3a1030,#180816)',
              marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>🎤</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>BPM</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: '#fff', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>120</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>KEY</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>4A / F# minor</div>
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <div>
            <div style={{ fontSize: 9, fontWeight: 800, color: PC, letterSpacing: '0.1em', marginBottom: 6 }}>VOCAL MIX</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[['LOW','-2.1'], ['MID','+1.4'], ['HIGH','+0.8']].map(([l, v]) => (
                <div key={l} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                  <LargeKnob color={PC} size={30} />
                  <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.08em' }}>{l}</div>
                  <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.45)' }}>{v} dB</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 5, marginTop: 8 }}>
              <MuteSolo />
              <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden',
                alignSelf: 'center', position: 'relative' }}>
                <div style={{ position: 'absolute', right: 0, top: -4, bottom: -4, width: 14, borderRadius: '50%',
                  background: '#fff', border: `2px solid ${PC}60` }} />
                <div style={{ height: '100%', width: '85%', background: `linear-gradient(to right,${PC}60,${PC})`,
                  borderRadius: 4 }} />
              </div>
            </div>
          </div>
        </div>

        {/* Center: dual waveforms */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Bar ruler top */}
          <div style={{ display: 'flex', padding: '3px 4px', borderBottom: '1px solid rgba(255,255,255,0.05)', ...S.bg1 }}>
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} style={{ flex: 1, fontSize: 7, color: 'rgba(255,255,255,0.2)', paddingLeft: 2 }}>{i + 1}</div>
            ))}
          </div>
          {/* Vocal waveform (pink) */}
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: `rgba(236,72,153,0.04)` }}>
            <Waveform color={PC} seed={901} bars={200} />
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1.5,
              background: 'rgba(255,255,255,0.7)' }} />
          </div>
          {/* Instrumental waveform (blue) */}
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: `rgba(59,130,246,0.04)` }}>
            <Waveform color={BC} seed={1002} bars={200} />
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1.5,
              background: 'rgba(255,255,255,0.7)' }} />
          </div>
          {/* Bar ruler bottom */}
          <div style={{ display: 'flex', padding: '3px 4px', borderTop: '1px solid rgba(255,255,255,0.05)', ...S.bg1 }}>
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} style={{ flex: 1, fontSize: 7, color: 'rgba(255,255,255,0.2)', paddingLeft: 2 }}>{i + 1}</div>
            ))}
          </div>
          {/* Bottom transport */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 12px', borderTop: '1px solid rgba(255,255,255,0.07)', ...S.bg0 }}>
            <div style={{ display: 'flex', gap: 5 }}>
              <span style={{ padding: '3px 7px', borderRadius: 4, fontSize: 8, fontWeight: 700, cursor: 'pointer',
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)' }}>4 Bars ▾</span>
              {['⟳','IN','OUT','↺'].map(l => (
                <button key={l} style={{ padding: '3px 6px', borderRadius: 4, fontSize: l.length > 1 ? 8 : 11, fontWeight: 700,
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
                  color: 'rgba(255,255,255,0.5)', cursor: 'pointer' }}>{l}</button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {['⏮','⏸','⏭'].map((c, i) => (
                <button key={i} style={{ width: i === 1 ? 38 : 28, height: i === 1 ? 38 : 28, borderRadius: '50%',
                  background: i === 1 ? '#22c55e' : 'rgba(255,255,255,0.06)',
                  border: i === 1 ? 'none' : '1px solid rgba(255,255,255,0.1)',
                  color: i === 1 ? '#000' : 'rgba(255,255,255,0.6)',
                  fontSize: i === 1 ? 14 : 9, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{c}</button>
              ))}
              <button style={{ padding: '5px 10px', borderRadius: 6, fontSize: 9, fontWeight: 700, cursor: 'pointer',
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }}>SYNC</button>
            </div>
            <div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 7, color: PC, letterSpacing: '0.1em' }}>VOCAL</div>
                  <div style={{ fontSize: 12, fontWeight: 900, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>120.00</div>
                </div>
                <div>
                  <div style={{ fontSize: 7, color: BC, letterSpacing: '0.1em' }}>INSTRUMENTAL</div>
                  <div style={{ fontSize: 12, fontWeight: 900, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>124.00</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: INSTRUMENTAL deck */}
        <div style={{ padding: 16, borderLeft: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', flexDirection: 'column', gap: 10, ...S.bg2 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ padding: '3px 9px', borderRadius: 5, fontSize: 9, fontWeight: 800,
              background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', color: BC, letterSpacing: '0.08em' }}>INSTRUMENTAL</span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>···</span>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', marginBottom: 1 }}>This Is What You Came For</div>
            <div style={{ fontSize: 9, fontWeight: 700, color: BC, marginBottom: 4 }}>(Instrumental)</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginBottom: 8 }}>Calvin Harris ft. Rihanna</div>
            <div style={{ width: 56, height: 56, borderRadius: 10, background: 'linear-gradient(135deg,#0a1a3c,#050e1e)',
              marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>⚡</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>BPM</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: '#fff', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>124</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>KEY</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>5A / B minor</div>
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <div>
            <div style={{ fontSize: 9, fontWeight: 800, color: BC, letterSpacing: '0.1em', marginBottom: 6 }}>INSTRUMENTAL MIX</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[['LOW','-1.3'], ['MID','+0.6'], ['HIGH','+1.9']].map(([l, v]) => (
                <div key={l} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                  <LargeKnob color={BC} size={30} />
                  <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.08em' }}>{l}</div>
                  <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.45)' }}>{v} dB</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 5, marginTop: 8 }}>
              <MuteSolo />
              <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden',
                alignSelf: 'center', position: 'relative' }}>
                <div style={{ position: 'absolute', right: 0, top: -4, bottom: -4, width: 14, borderRadius: '50%',
                  background: '#fff', border: `2px solid ${BC}60` }} />
                <div style={{ height: '100%', width: '90%', background: `linear-gradient(to right,${BC}60,${BC})`,
                  borderRadius: 4 }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </MockupCard>
  );
}

// ── MOCKUP 11: Full-Bleed Minimal (Outer Rails style) ─────────────────────────
// No borders; full-width waveforms flush edge-to-edge; minimal track header
// strips; bottom EQ knobs on each side with center transport

function Mockup11() {
  const vSections = [
    { label: 'Verse 1', color: '#22d3ee', start: 0, end: 28 },
    { label: 'Build',   color: '#06b6d4', start: 28, end: 46 },
    { label: 'Chorus',  color: '#0891b2', start: 46, end: 75 },
    { label: 'Drop',    color: '#0e7490', start: 75, end: 100 },
  ];
  const iSections = [
    { label: 'Intro', color: '#f97316', start: 0,  end: 22 },
    { label: 'Verse', color: '#ea6e0e', start: 22, end: 48 },
    { label: 'Build', color: '#d96506', start: 48, end: 70 },
    { label: 'Drop',  color: '#c45b00', start: 70, end: 100 },
  ];

  return (
    <MockupCard n={11} title="Full-Bleed Minimal" concept="Borderless waveforms flush edge-to-edge; track strips above/below; bottom split EQ + transport">
      {/* Minimal nav */}
      <div style={{ display: 'flex', alignItems: 'center', height: 44, padding: '0 18px',
        borderBottom: '1px solid rgba(255,255,255,0.06)', ...S.bg1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginRight: 20 }}>
          <div style={{ display: 'flex', gap: 2 }}>
            {[4,3,5,3,4].map((h, i) => (
              <div key={i} style={{ width: 3, height: h * 3, borderRadius: 2, background: VC, opacity: 0.8 + i * 0.04 }} />
            ))}
          </div>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#fff', letterSpacing: '0.04em' }}>DROPDEX</span>
        </div>
        <div style={{ display: 'flex', gap: 2 }}>
          {['Mashup','Stems','Library'].map((t, i) => (
            <span key={t} style={{ padding: '4px 14px', borderRadius: 20, fontSize: 10, fontWeight: 700, cursor: 'pointer',
              background: i === 0 ? '#fff' : 'transparent',
              color: i === 0 ? '#000' : 'rgba(255,255,255,0.45)' }}>{t}</span>
          ))}
        </div>
        <div style={{ flex: 1, margin: '0 16px', position: 'relative' }}>
          <div style={{ padding: '5px 12px 5px 30px', borderRadius: 8, background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)', fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>
            Search tracks, artists, or paste a link…
          </div>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
            fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>⌕</span>
        </div>
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />
      </div>

      {/* Vocal track header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 18px',
        borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <div style={{ width: 38, height: 38, borderRadius: 7, background: 'linear-gradient(135deg,#1a3a5c,#0a1a2e)',
          flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>🎤</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>Levitating (Vocal Stem)</div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>Dua Lipa</div>
        </div>
        <span style={{ padding: '3px 9px', borderRadius: 5, fontSize: 9, fontWeight: 800,
          background: 'rgba(34,211,238,0.12)', border: `1px solid ${VC}30`, color: VC, letterSpacing: '0.08em' }}>VOCAL</span>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)' }}>BPM</div>
            <div style={{ fontSize: 14, fontWeight: 900, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>120</div>
          </div>
          <CamelotBadge k="4A" />
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>···</span>
        </div>
      </div>

      {/* Beat grid — shared reference for both waveforms */}
      <div style={{ display: 'flex', alignItems: 'center', height: 14, padding: '0 18px',
        borderBottom: '1px solid rgba(255,255,255,0.06)', ...S.bg1 }}>
        <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.25)', marginRight: 4, flexShrink: 0 }}>BAR</span>
        {[1,5,9,13,17,21,25,29,33,37,41,45,49,53,57,61].map(n => (
          <div key={n} style={{ flex: 1, fontSize: 7, color: 'rgba(255,255,255,0.2)' }}>{n}</div>
        ))}
      </div>

      {/* Vocal section labels row */}
      <div style={{ position: 'relative', height: 20, margin: '0 18px',
        borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        {vSections.map(s => (
          <div key={s.label} style={{ position: 'absolute', left: `${s.start}%`, width: `${s.end - s.start}%`,
            height: '100%', display: 'flex', alignItems: 'center',
            padding: '0 5px', background: `${s.color}22`, borderRight: `2px solid ${s.color}55` }}>
            <span style={{ fontSize: 8, fontWeight: 700, color: s.color }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Vocal waveform */}
      <div style={{ height: 70, position: 'relative', overflow: 'hidden',
        background: 'rgba(34,211,238,0.04)', padding: '0 18px' }}>
        <Waveform color={VC} seed={1101} bars={260} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: '55%', width: 1.5,
          background: 'rgba(255,255,255,0.75)' }} />
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(to right, ${IC}00, ${IC}60, ${VC}60, ${VC}00)` }} />
      </div>

      {/* Instrumental section labels row */}
      <div style={{ position: 'relative', height: 20, margin: '0 18px',
        borderBottom: '1px solid rgba(255,255,255,0.06)', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        {iSections.map(s => (
          <div key={s.label} style={{ position: 'absolute', left: `${s.start}%`, width: `${s.end - s.start}%`,
            height: '100%', display: 'flex', alignItems: 'center',
            padding: '0 5px', background: `${s.color}22`, borderRight: `2px solid ${s.color}55` }}>
            <span style={{ fontSize: 8, fontWeight: 700, color: s.color }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Instrumental waveform */}
      <div style={{ height: 70, position: 'relative', overflow: 'hidden',
        background: 'rgba(249,115,22,0.04)', padding: '0 18px' }}>
        <Waveform color={IC} seed={1202} bars={260} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: '55%', width: 1.5,
          background: 'rgba(255,255,255,0.75)' }} />
      </div>

      {/* Instrumental track header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 18px',
        borderTop: '1px solid rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ width: 38, height: 38, borderRadius: 7, background: 'linear-gradient(135deg,#1a3a3c,#0a2020)',
          flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>⚡</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>This Is What You Came For</div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>Calvin Harris ft. Rihanna</div>
        </div>
        <span style={{ padding: '3px 9px', borderRadius: 5, fontSize: 9, fontWeight: 800,
          background: 'rgba(249,115,22,0.12)', border: `1px solid ${IC}30`, color: IC, letterSpacing: '0.08em' }}>INSTRUMENTAL</span>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)' }}>BPM</div>
            <div style={{ fontSize: 14, fontWeight: 900, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>124</div>
          </div>
          <CamelotBadge k="5A" />
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>···</span>
        </div>
      </div>

      {/* Bottom: split EQ + transport */}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', ...S.bg0 }}>
        {/* Vocal EQ knobs */}
        <div style={{ padding: '12px 18px', borderRight: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: 8, fontWeight: 800, color: VC, letterSpacing: '0.1em', marginBottom: 8 }}>VOCAL EQ</div>
          <div style={{ display: 'flex', gap: 14 }}>
            {[['LOW','-2.0'], ['MID','+1.5'], ['HIGH','+3.0']].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <LargeKnob color={VC} size={36} />
                <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em' }}>{l}</div>
                <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)' }}>{v} dB</div>
              </div>
            ))}
          </div>
        </div>

        {/* Center transport */}
        <div style={{ padding: '12px 18px', display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: 6, borderRight: '1px solid rgba(255,255,255,0.06)', minWidth: 180 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button style={{ padding: '4px 8px', borderRadius: 6, fontSize: 8, fontWeight: 700, cursor: 'pointer',
              background: 'rgba(34,211,238,0.1)', border: `1px solid ${VC}30`, color: VC }}>⊞ SYNC ▾</button>
            <div>
              <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em' }}>BPM</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <div style={{ fontSize: 16, fontWeight: 900, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>125.0</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.3)', cursor: 'pointer' }}>▲</span>
                  <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.3)', cursor: 'pointer' }}>▼</span>
                </div>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {['⏮','⏪','▶','⏩','⏭'].map((c, i) => (
              <button key={i} style={{ width: i === 2 ? 36 : 26, height: i === 2 ? 36 : 26, borderRadius: '50%',
                background: i === 2 ? '#22c55e' : 'rgba(255,255,255,0.06)',
                border: i === 2 ? `2px solid #22c55e40` : '1px solid rgba(255,255,255,0.09)',
                color: i === 2 ? '#000' : 'rgba(255,255,255,0.6)',
                fontSize: i === 2 ? 13 : 8, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{c}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)' }}>LOOP</span>
            <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 9, fontWeight: 700,
              background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)', color: '#f59e0b' }}>16 Bars ▾</span>
            <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)' }}>MIX</span>
            <div style={{ width: 60, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', position: 'relative' }}>
              <div style={{ position: 'absolute', right: 6, top: -4, width: 12, height: 12, borderRadius: '50%',
                background: '#fff', border: '2px solid rgba(34,211,238,0.4)' }} />
            </div>
          </div>
        </div>

        {/* Instrumental EQ knobs */}
        <div style={{ padding: '12px 18px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <div style={{ fontSize: 8, fontWeight: 800, color: IC, letterSpacing: '0.1em', marginBottom: 8 }}>INSTRUMENTAL EQ</div>
          <div style={{ display: 'flex', gap: 14 }}>
            {[['LOW','+1.0'], ['MID','-1.0'], ['HIGH','+2.0']].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <LargeKnob color={IC} size={36} />
                <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em' }}>{l}</div>
                <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)' }}>{v} dB</div>
              </div>
            ))}
          </div>
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
            Ten independent layout explorations. Each optimised for a different DJ workflow.
          </div>
        </div>
        <Mockup2 />
        <Mockup4 />
        <Mockup5 />
        <Mockup6 />
        <Mockup7 />
        <Mockup8 />
        <Mockup9 />
        <Mockup10 />
        <Mockup11 />
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
