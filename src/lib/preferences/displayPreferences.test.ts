import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DisplayPreferencesGroup } from '../../components/profile/DisplayPreferencesGroup';
import { DEFAULT_WAVEFORM_STYLE, WAVEFORM_STYLES, waveformStyleById } from './waveformStyles';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const style = (id: string) => waveformStyleById(id);

describe('waveform styles', () => {
  it('offers five styles from the industry: classic blue, RGB, 3-Band and Infrared, beside today\'s single colour as the default', () => {
    expect(WAVEFORM_STYLES.map((s) => s.id)).toEqual(['slate', 'blue', 'rgb', 'three-band', 'infrared']);
    expect(DEFAULT_WAVEFORM_STYLE).toBe('slate');
    expect(style('slate').colorFor).toBeNull();
  });

  it('colours RGB by frequency: bass red, mids green, highs blue', () => {
    const rgb = style('rgb').colorFor!;
    const [r1, g1] = rgb({ r: 255, g: 0, b: 0 });
    expect(r1).toBeGreaterThan(g1);
    const [, g2, b2] = rgb({ r: 0, g: 255, b: 0 });
    expect(g2).toBeGreaterThan(b2);
    const [r3, , b3] = rgb({ r: 0, g: 0, b: 255 });
    expect(b3).toBeGreaterThan(r3);
  });

  it('colours 3-Band by frequency: bass blue, mids amber, highs white', () => {
    const band = style('three-band').colorFor!;
    expect(band({ r: 255, g: 0, b: 0 })).toEqual([47, 111, 237]);
    expect(band({ r: 0, g: 255, b: 0 })).toEqual([245, 166, 35]);
    expect(band({ r: 0, g: 0, b: 255 })).toEqual([255, 255, 255]);
  });

  it('makes the one-hue styles brighter where it is louder, and handles mono waveforms', () => {
    for (const id of ['blue', 'infrared']) {
      const f = style(id).colorFor!;
      const quiet = f({ i: 0 });
      const loud = f({ i: 1 });
      expect(loud[0] + loud[1] + loud[2], id).toBeGreaterThan(quiet[0] + quiet[1] + quiet[2]);
    }
    for (const s of WAVEFORM_STYLES.slice(1)) expect(s.colorFor!({ i: 0.5 }), s.id).toHaveLength(3);
  });
});

describe('Display preferences', () => {
  it('shows five style cards with a swatch each, and the default selected', () => {
    const markup = renderToStaticMarkup(createElement(DisplayPreferencesGroup));
    expect(markup.match(/role="radio"/g)).toHaveLength(5);
    for (const s of WAVEFORM_STYLES) expect(markup).toContain(`waveform-swatch-${s.id}`);
    expect(markup).toMatch(/aria-checked="true"[^>]*>[\s\S]*?Slate/);
    expect(read('../../App.tsx')).toContain('<DisplayPreferencesGroup />');
  });

  it('is what the timeline paints with, through the renderer\'s gradient', () => {
    const timeline = read('../../components/ui/media/TrackTimeline.tsx');
    expect(timeline).toContain('useWaveformStyle()');
    expect(timeline).toContain('waveformStyle={waveformStyle}');
    const renderer = read('../../components/library/RekordboxPreviewWaveform.tsx');
    expect(renderer).toContain('style?.colorFor ? style.colorFor(');
  });
});
