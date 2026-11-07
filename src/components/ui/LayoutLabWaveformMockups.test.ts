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
      expect(row).toContain('audition-library cue-browser');
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
    const treatments = ['pill', 'mirror', 'twotone', 'fade'].map((style) => selected(style));
    for (const t of treatments) expect(t).toBeTruthy();
    expect(new Set(treatments).size).toBe(4);
    expect(treatments[0]).toContain('inset 4px 0 0 #f56b70');
    expect(treatments[1]).toContain('inset 0 1px 0 #ffffff29');
    expect(treatments[2]).toContain('outline: 1px solid #f56b70b3');
    expect(treatments[3]).toContain('inset 0 -2px 0 #f56b70');
    for (const style of ['bars', 'pill', 'mirror', 'twotone', 'fade']) expect(rowSlice(style)).toContain('cue-browser__row--selected');
    expect(rowSlice('bars')).toContain('Selected: coral title');
  });

  it('gives row 2 the same mirrored bars as row 3: 120 columns per track, each with an upper and a fainter lower half', () => {
    const columns = (style: string) => (rowSlice(style).match(/<span [^>]*style="--wp-bar:[^"]*"><i class="up" style="height:[\d.]+%"><\/i><i class="down" style="height:[\d.]+%"><\/i><\/span>/g) ?? []).length / PREVIEW_TRACKS.length;
    expect(columns('mirror')).toBe(120);
    expect(columns('pill')).toBe(120);
    expect(rowSlice('pill')).toContain('wp-wave wp-pill');
    expect(css).toMatch(/\.wp-pill \.wp-body > span \{ flex: 1; min-width: 1px; display: flex; flex-direction: column;/);
    expect(css).toMatch(/\.wp-pill \.wp-body i\.down \{ opacity: \.42; \}/);
    expect(css).toMatch(/\.wp-mirror \.wp-body i\.down \{ opacity: \.42; \}/);
    // The same heights as row 3 for the same track: upper half 50%, lower half 34% of each bar.
    const heights = (style: string) => [...rowSlice(style).matchAll(/<i class="(up|down)" style="height:([\d.]+)%"/g)].slice(0, 240).map((m) => `${m[1]}${m[2]}`);
    expect(heights('pill')).toEqual(heights('mirror'));
    expect(read('./LayoutLabWaveformMockups.tsx')).not.toContain('amps.flatMap');
    expect(rowSlice('pill')).toContain('#8997AE');
  });

  it('marks the cue columns in row 2 in their own soft colours, each topped with an upside-down triangle', () => {
    const row = rowSlice('pill');
    const cueTotal = PREVIEW_TRACKS.reduce((sum, t) => sum + t.cues.length, 0);
    expect(row.match(/<span class="wp-cue-bar" title="Cue [A-D]"/g)).toHaveLength(cueTotal);
    const byLetter = new Map<string, Set<string>>();
    for (const m of row.matchAll(/<span class="wp-cue-bar" title="Cue ([A-D])" style="--wp-bar:(#[0-9a-fA-F]+)"/g)) byLetter.set(m[1], (byLetter.get(m[1]) ?? new Set()).add(m[2].toLowerCase()));
    expect([...byLetter.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, set]) => [...set][0])).toEqual(['#f27d96', '#5fb8e8', '#6fd9a4', '#a99bff']);
    for (const set of byLetter.values()) expect(set.size).toBe(1);
    // The vivid, wider, glowing treatment is gone.
    expect(css).not.toMatch(/drop-shadow|flex: 0 0 4px|i\.up \{ opacity: \.8/);
    // A downward triangle on the top end of the column's upper half, in the cue's colour.
    expect(css).toMatch(/\.wp-pill \.wp-cue-bar i\.up::before \{[^}]*bottom: 100%;[^}]*border-top: 5px solid var\(--wp-bar\);/);
    // Still the waveform's own columns, never a separate marker over or beyond it.
    for (const gone of ['<u ', 'wp-cue-line', 'wp-cues-rings', 'wp-cues ']) expect(row).not.toContain(gone);
    // Each cue sits on the column at its own position along the 120.
    const first = row.slice(row.indexOf('wp-wave wp-pill'), row.indexOf('</div></div>', row.indexOf('wp-wave wp-pill')));
    const columns = [...first.matchAll(/<span [^>]*><i class="up"[^>]*><\/i><i class="down"[^>]*><\/i><\/span>/g)].map((m) => m[0]);
    expect(columns).toHaveLength(120);
    PREVIEW_TRACKS[0].cues.forEach((cue) => expect(columns[Math.floor((cue.pct / 100) * 120)]).toContain(`title="Cue ${cue.letter}"`));
  });


  it('has no orange in rows 2 to 5: every bar is the one gray except the cue bars, and only row 1 keeps the coral drop', () => {
    const soft = ['#5fb8e8', '#6fd9a4', '#a99bff', '#f27d96'];
    for (const style of ['pill', 'mirror', 'twotone', 'fade']) {
      const row = rowSlice(style).toLowerCase();
      const colours = new Set([...row.matchAll(/--wp-bar:(#[0-9a-f]+)/g)].map((m) => m[1]));
      // Rows 2 and 3 set every bar's colour inline (gray, or a cue colour); rows 4 and 5 draw the gray in CSS, so only the cue bars set one.
      const expected = style === 'pill' || style === 'mirror' ? ['#8997ae', ...soft] : soft;
      expect([...colours].sort(), style).toEqual([...expected].sort());
      for (const orange of ['#f78361', '#ffa07f', '#d96a4a', '#f783612e', 'is-drop']) expect(row, `${style} ${orange}`).not.toContain(orange);
    }
    expect(css).not.toMatch(/is-drop/);
    expect(css).not.toMatch(/\.wp-(pill|mirror|twotone|fade)[^{]*\{[^}]*(#f78361|#f56b70|#ffa07f|#d96a4a)/i);
    // Row 1 is the production reference and keeps its coral drop.
    expect(rowSlice('bars').toLowerCase()).toContain('#f78361');
  });

  it('marks every cue in rows 3 to 5 inside the waveform too, at its position, with no dot above', () => {
    const cueTotal = PREVIEW_TRACKS.reduce((sum, t) => sum + t.cues.length, 0);
    const forms = { mirror: /<span class="wp-cue-col" title="Cue ([A-D])"/g, twotone: /<i class="wp-cue-two" title="Cue ([A-D])"/g, fade: /<i class="wp-cue-fade" title="Cue ([A-D])"/g };
    for (const [style, pattern] of Object.entries(forms)) {
      const row = rowSlice(style);
      expect([...row.matchAll(pattern)], style).toHaveLength(cueTotal);
      expect(row, style).not.toContain('wp-cues ');
      for (const gone of ['wp-cues-glow', 'wp-cues-stems', 'wp-cues-outlined', '<u ']) expect(row, `${style} ${gone}`).not.toContain(gone);
    }
    // Only row 1 keeps the dots above.
    expect(rowSlice('bars')).toContain('wp-cues wp-cues-dots');
    for (const gone of ['.wp-cues-glow', '.wp-cues-stems', '.wp-cues-outlined']) expect(css).not.toContain(gone);
  });

  it('puts each cue in rows 3 to 5 on the bar at its own position, in the same soft colours as row 2', () => {
    for (const [style, tag] of [['mirror', 'span'], ['twotone', 'i'], ['fade', 'i']] as const) {
      const row = rowSlice(style);
      const start = row.indexOf(`wp-wave wp-${style}`);
      const body = row.slice(start, row.indexOf('</div></div>', start));
      const bars = [...body.matchAll(tag === 'span' ? /<span[^>]*>(?:<i[^>]*><\/i>){2}<\/span>/g : /<i[^>]*><\/i>/g)].map((m) => m[0]);
      expect(bars, style).toHaveLength(120);
      PREVIEW_TRACKS[0].cues.forEach((cue) => expect(bars[Math.floor((cue.pct / 100) * 120)], `${style} ${cue.letter}`).toContain(`title="Cue ${cue.letter}"`));
    }
    const colours = (style: string) => [...rowSlice(style).matchAll(/title="Cue ([A-D])" style="[^"]*--wp-bar:(#[0-9a-fA-F]+)/g)].map((m) => `${m[1]}${m[2].toLowerCase()}`);
    const expected = new Set(['A#f27d96', 'B#5fb8e8', 'C#6fd9a4', 'D#a99bff']);
    for (const style of ['mirror', 'twotone', 'fade']) expect(new Set(colours(style)), style).toEqual(expected);
  });
});
