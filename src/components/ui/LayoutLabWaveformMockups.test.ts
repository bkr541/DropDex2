import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WaveformPreviewMockupsContent } from './LayoutLabWaveformMockups';
import { PREVIEW_TRACKS, waveformAmplitudes } from './layoutLabWaveformData';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const markup = renderToStaticMarkup(createElement(WaveformPreviewMockupsContent));
const css = read('./layout-lab-waveform.css');
const rowSlice = (style: string) => {
  const start = markup.indexOf(`data-testid="waveform-row" data-style="${style}"`);
  const next = markup.indexOf('data-testid="waveform-row"', start + 10);
  return markup.slice(start, next === -1 ? undefined : next);
};

describe('Layout Lab Waveform Preview tab', () => {
  it('is a tab called Waveform Preview', () => {
    const win = read('./LayoutLabWindow.tsx');
    expect(win).toContain("{ id: 'waveform-preview', label: 'Waveform Preview' }");
    expect(win).toContain("activeId === 'waveform-preview'");
    expect(win).toContain('<WaveformPreviewMockupsContent />');
  });

  it('has five rows, each with five tracks in the production Audition table', () => {
    const styles = [...markup.matchAll(/data-testid="waveform-row" data-style="([a-z]+)"/g)].map((m) => m[1]);
    expect(styles).toEqual(['bars', 'pill', 'mirror', 'twotone', 'fade']);
    expect(PREVIEW_TRACKS).toHaveLength(5);
    for (const style of styles) {
      const row = rowSlice(style);
      expect(row.match(/cue-browser__row /g), style).toHaveLength(5);
      expect(row).toContain('studio audition-studio wp-stage');
      expect(row).toContain(style === 'pill' ? 'track-listing' : 'audition-library cue-browser');
      expect(row).toContain('cue-browser__table');
      for (const heading of ['Track', 'BPM', 'Key', 'Genre', 'Format', 'Playlists', 'Duration']) expect(row).toContain(heading);
      expect(row).toContain('CID - Fancy. $hit (KALYP Remix) - Final 2026');
    }
  });

  it('gives every row a different waveform style and a different cue marker style', () => {
    const waves = { bars: 'wp-bars', pill: 'wp-pill', mirror: 'wp-mirror', twotone: 'wp-twotone', fade: 'wp-fade' };
    const cues = { bars: 'wp-cues-dots', pill: 'wp-cue-bar', mirror: 'wp-cue-col', twotone: 'wp-cue-two', fade: 'wp-cue-fade' };
    for (const [style, wave] of Object.entries(waves)) {
      const row = rowSlice(style);
      expect(row, style).toContain(`wp-wave ${wave}`);
      expect(row, style).toContain(cues[style as keyof typeof cues]);
      for (const [other, otherWave] of Object.entries(waves)) if (other !== style) expect(row, `${style} vs ${other}`).not.toContain(`wp-wave ${otherWave}`);
    }
    for (const cls of Object.values(cues)) expect(css).toContain(`.${cls}`);
  });

  it('marks each track\'s cues, and leaves a track without cues unmarked', () => {
    const row = rowSlice('fade');
    expect(row.match(/title="Cue [A-D]"/g)).toHaveLength(PREVIEW_TRACKS.reduce((sum, t) => sum + t.cues.length, 0));
    expect(PREVIEW_TRACKS[4].cues).toHaveLength(0);
  });

  it('uses the Audition gray and drop colour, and draws repeatable bar heights', () => {
    expect(markup).toContain('#8997AE');
    expect(read('./LayoutLabWaveformMockups.tsx')).toContain("const DROP = '#f78361';");
    const a = waveformAmplitudes(3, 120);
    expect(a).toEqual(waveformAmplitudes(3, 120));
    expect(a).not.toEqual(waveformAmplitudes(4, 120));
    expect(Math.min(...a)).toBeGreaterThanOrEqual(0.12);
    expect(Math.max(...a)).toBeLessThanOrEqual(1);
  });

  it('keeps every waveform made of bars, and every cue a dot above only in row 1; in rows 2 to 5 it is a coloured bar of the waveform', () => {
    for (const gone of ['WaveSilhouette', 'WaveBands', 'WaveLed', 'WaveLine', 'wp-cues-flags', 'wp-cues-diamonds', 'wp-cues-badges', '<svg viewBox="0 0 100 20"']) expect(read('./LayoutLabWaveformMockups.tsx')).not.toContain(gone);
    for (const gone of ['.wp-cues-flags', '.wp-cues-diamonds', '.wp-cues-badges', '.wp-cues-pins']) expect(css).not.toContain(gone);
    for (const style of ['pill', 'mirror', 'twotone', 'fade']) expect(rowSlice(style)).toMatch(/<i [^>]*style="height:/);
  });

  it('gives each row a different selected track, and leaves row 1 as the production one', () => {
    const selected = (style: string) => css.match(new RegExp(`\\.wp-stage\\.wp-style-${style} \\.cue-browser__row--selected, [^{]*\\{([^}]*)\\}`))?.[1];
    expect(selected('bars')).toBeUndefined();
    // Row 2's selected state lives in the reusable listing's own stylesheet; rows 3 to 5 keep theirs here.
    expect(selected('pill')).toBeUndefined();
    expect(read('./display/track-listing.css')).toContain('inset 4px 0 0 #f56b70');
    const treatments = ['mirror', 'twotone', 'fade'].map((style) => selected(style));
    for (const t of treatments) expect(t).toBeTruthy();
    expect(new Set(treatments).size).toBe(3);
    expect(treatments[0]).toContain('inset 0 1px 0 #ffffff29');
    expect(treatments[1]).toContain('outline: 1px solid #f56b70b3');
    expect(treatments[2]).toContain('inset 0 -2px 0 #f56b70');
    for (const style of ['bars', 'pill', 'mirror', 'twotone', 'fade']) expect(rowSlice(style)).toContain('cue-browser__row--selected');
    expect(rowSlice('bars')).toContain('Selected: coral title');
  });

  it('gives row 2 the same bars as row 1: one bar per amplitude, no mirrored halves, and no dots above', () => {
    const bars = (style: string) => [...rowSlice(style).matchAll(/<i [^>]*style="height:([\d.]+)%/g)].map((m) => m[1]);
    expect(bars('pill')).toHaveLength(120 * PREVIEW_TRACKS.length);
    expect(bars('pill')).toEqual(bars('bars'));
    expect(rowSlice('pill')).toContain('wp-wave wp-pill');
    const pill = rowSlice('pill');
    for (const gone of ['class="up"', 'class="down"', 'wp-cues', 'wp-cue-col']) expect(pill).not.toContain(gone);
    expect(css).toMatch(/\.wp-pill \.wp-body i \{ flex: 1; min-width: 1px; border-radius: 1px; \}/);
    expect(css).not.toMatch(/\.wp-pill[^{]*(i\.down|i\.up|> span)/);
    expect(pill).toContain('#8997AE');
  });

  it('marks the cues in row 2 as bars in their own soft colours, each topped with an upside-down triangle', () => {
    const row = rowSlice('pill');
    const cueTotal = PREVIEW_TRACKS.reduce((sum, t) => sum + t.cues.length, 0);
    expect(row.match(/<i class="wp-cue-bar" title="Cue [A-D]"/g)).toHaveLength(cueTotal);
    const byLetter = new Map<string, Set<string>>();
    for (const m of row.matchAll(/<i class="wp-cue-bar" title="Cue ([A-D])" style="[^"]*--wp-bar:(#[0-9a-fA-F]+)/g)) byLetter.set(m[1], (byLetter.get(m[1]) ?? new Set()).add(m[2].toLowerCase()));
    expect([...byLetter.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, set]) => [...set][0])).toEqual(['#f27d96', '#5fb8e8', '#6fd9a4', '#a99bff']);
    for (const set of byLetter.values()) expect(set.size).toBe(1);
    expect(css).not.toMatch(/drop-shadow|flex: 0 0 4px/);
    expect(css).toMatch(/\.wp-pill \.wp-cue-bar::before \{[^}]*bottom: 100%;[^}]*border-top: 5px solid var\(--wp-bar\);/);
    // Each cue sits on the bar at its own position along the 120.
    const first = row.slice(row.indexOf('wp-wave wp-pill'), row.indexOf('</div></div>', row.indexOf('wp-wave wp-pill')));
    const bars = [...first.matchAll(/<i [^>]*><\/i>/g)].map((m) => m[0]);
    expect(bars).toHaveLength(120);
    PREVIEW_TRACKS[0].cues.forEach((cue) => expect(bars[Math.floor((cue.pct / 100) * 120)]).toContain(`title="Cue ${cue.letter}"`));
  });

  it('draws row 2 with the reusable TrackListing: coral edge, a wash gone by 560px, capital headings, an Actions column and larger headings', () => {
    const listing = read('./display/track-listing.css');
    const rule = listing.match(/\.track-listing \.cue-browser__row--selected, [^{]*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('inset 4px 0 0 #f56b70');
    expect(rule).not.toMatch(/0 0 24px/);
    const stops = [...rule.matchAll(/#f56b70([0-9a-f]{2}) (\d+)px/g)].map((m) => [m[1], Number(m[2])] as const);
    expect(stops[stops.length - 1]).toEqual(['00', 560]);
    expect(stops.map(([alpha]) => parseInt(alpha, 16))).toEqual([...stops.map(([alpha]) => parseInt(alpha, 16))].sort((a, b) => b - a));
    expect(listing).toMatch(/thead \{[^}]*font-size: 11px;/);
    const pill = rowSlice('pill');
    expect(pill).toContain('>Actions<');
    expect(pill.match(/aria-label="Actions for /g)).toHaveLength(PREVIEW_TRACKS.length);
    expect(pill.indexOf('>Actions<')).toBeGreaterThan(pill.indexOf('>Duration<'));
    for (const style of ['bars', 'mirror', 'twotone', 'fade']) expect(rowSlice(style), style).not.toContain('Actions');
    expect(read('./LayoutLabWaveformMockups.tsx')).toContain('<TrackListing');
  });

  it('shows the analysis status in a different place and form in every row', () => {
    expect(PREVIEW_TRACKS.map((t) => t.status)).toEqual(['ready', 'ready', 'warning', 'error', 'none']);
    // Row 1: the production dot, left of the play button, and none of the other forms.
    const bars = rowSlice('bars');
    expect(bars).toContain('bg-emerald-400');
    for (const gone of ['wp-status-word', 'wp-status-rule', 'wp-status-arc']) expect(bars, gone).not.toContain(gone);
    // Row 2 has the same dot as row 1. Rows 3 to 5: no dot, and one form each.
    const pillRow = rowSlice('pill');
    expect(pillRow).toContain('bg-emerald-400');
    for (const gone of ['wp-status-word', 'wp-status-rule', 'wp-status-arc']) expect(pillRow, gone).not.toContain(gone);
    const forms = {  mirror: 'wp-status-word', twotone: 'wp-status-rule', fade: 'wp-status-arc' } as const;
    for (const [style, form] of Object.entries(forms)) {
      const row = rowSlice(style);
      expect(row.match(new RegExp(`class="${form}`, 'g')), style).toHaveLength(PREVIEW_TRACKS.length);
      expect(row, style).not.toContain('h-1.5 w-1.5 shrink-0 rounded-full');
      for (const [other, otherForm] of Object.entries(forms)) if (other !== style) expect(row, `${style} vs ${other}`).not.toContain(otherForm);
    }
    // Where each one sits.
    expect(rowSlice('mirror')).toMatch(/Artist Not Available<span class="wp-status-word"/);
    expect(rowSlice('fade').indexOf('wp-status-arc')).toBeGreaterThan(rowSlice('fade').indexOf('2:31'));
  });

  it('counts analysis as three steps in the arcs: ready 3, partial 2, failed 1, pending 0', () => {
    const arcs = rowSlice('fade');
    expect(arcs).toContain('Analysis partial: 2 of 3 steps done, still needs cues');
    expect(arcs).toContain('Analysis failed: 1 of 3 steps done, still needs beat grid and cues');
    expect(arcs.match(/class="wp-arc-fill"/g)).toHaveLength(4);
    expect(arcs.match(/stroke-dasharray="1\.5 2\.6"/g)).toHaveLength(1);
  });

  it('writes the column names of row 2 in capitals, and leaves the other rows as they were', () => {
    const head = (style: string) => rowSlice(style).match(/<th[\s\S]*?<\/thead>/)?.[0] ?? '';
    expect(head('pill')).not.toContain('normal-case');
    expect(head('bars')).toContain('normal-case');
  });

  it('draws the status in the app\'s own language: hairlines, light figures, 9px caps and thin arcs, nothing filled or glowing, and ready kept quiet', () => {
    const block = css.slice(css.indexOf('The status mark (the green dot)'));
    for (const loud of ['box-shadow', 'drop-shadow', 'text-shadow', 'filter:', 'border-radius: 999px', 'background: color-mix']) expect(block, loud).not.toContain(loud);
    expect(block).toMatch(/\.wp-status-word \{[^}]*font-size: 9px;[^}]*letter-spacing: \.16em;[^}]*text-transform: uppercase;/);
    expect(block).toMatch(/\.wp-status-rule \{[^}]*height: 1px;/);
    expect(block).toMatch(/\.wp-arc-fill \{[^}]*stroke-width: 1\.5;/);
    // Ready is the quiet one: grey word, a dimmed rule and arc. Only partial and failed words take their colour.
    expect(block).toMatch(/\.wp-status-word \{[^}]*color: #7b879c;/);
    expect(block).toMatch(/\.wp-status-word\[data-status="warning"\], \.wp-status-word\[data-status="error"\] \{ color: var\(--wp-status\); \}/);
    expect(block).toMatch(/\.wp-status-rule\[data-status="ready"\] \{ opacity: \.6; \}/);
    const source = read('./LayoutLabWaveformMockups.tsx');
    expect(source).toContain("ready: '#34d399', warning: '#f0b35a', error: '#f27d96', none: '#566074'");
    for (const gone of ['StatusMark', 'wp-status-badge', 'wp-status-strip', 'wp-status-ring', 'wp-status-glyph', 'Checkmark', 'WarningAlt']) expect(source, gone).not.toContain(gone);
  });
});
