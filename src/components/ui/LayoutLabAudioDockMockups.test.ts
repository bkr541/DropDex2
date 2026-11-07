import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AudioDockMockupsContent } from './LayoutLabAudioDockMockups';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const css = read('./layout-lab-audio-dock.css');
const markup = renderToStaticMarkup(createElement(AudioDockMockupsContent));

describe('Layout Lab Audio Dock tab, in the graphite look', () => {
  it('has the fourteen dock concepts', () => {
    for (const kind of ['edge', 'center', 'capsule', 'waveform', 'islands', 'console', 'editorial', 'vinyl', 'shelf', 'compact', 'fshelf', 'frail', 'fwave', 'fflip']) expect(markup).toContain(`adl-style-${kind}`);
  });

  it('sits on the Discovery graphite backdrop and uses its type, not the old fonts and blues', () => {
    expect(css).toContain('background: linear-gradient(165deg, #292d37 0%, #20242e 36%, #191d25 100%);');
    expect(css).toContain("font-family: 'Helvetica Neue', 'Segoe UI', Arial, sans-serif;");
    for (const legacy of ['#0b0f14', '#131920', '#172127', '#101b25', '#161b27', '#19202d', '#121d1b', '#19171d', '#0e1217', 'var(--font-mono)', 'var(--font-sans)']) expect(css, legacy).not.toContain(legacy);
  });

  it('has one coral accent: a coral play disc and coral progress, and the Audition gray waveform', () => {
    expect(css).toContain('--adl-accent: #f56b70;');
    expect(css).toMatch(/\.adl-icon-button\.adl-play \{[^}]*linear-gradient\(145deg, #f78361 0%, #f56b70 100%\)/);
    expect(css).toMatch(/\.adl-progress-rail > span \{[^}]*linear-gradient\(90deg, #f56b70, #f78361\)/);
    expect(css).toContain('.adl-wave-played { fill: #8997AE; }');
    expect(markup.match(/--adl-accent:#f56b70/g)).toHaveLength(14);
  });

  it('gives the floating pieces the raised nav recipe: lit rim, grain and three layered shadows', () => {
    expect(css).toMatch(/\.adl-style-capsule \.adl-dock, \.adl-island, \.adl-style-compact \.adl-dock, \.adl-float \{[^}]*box-shadow: inset 0 1px 0 #ffffff24, inset 0 -1px 0 #00000059, 0 1px 2px #00000080, 0 10px 24px -6px #0000008c, 0 24px 48px -14px #000000a6;/);
    expect(css).toContain('linear-gradient(155deg, #ffffff47 0%');
    expect(css).toContain('feTurbulence');
  });

  it('uses recessed wells for the rail, the readout and the waveform, and hairlines for bands', () => {
    expect(css).toMatch(/\.adl-progress-rail \{[^}]*inset 0 1px 3px #000000a6/);
    expect(css).toMatch(/\.adl-console-readout \{[^}]*inset 0 3px 8px #000000b3/);
    expect(css).toMatch(/\.adl-style-waveform \.adl-timeline \{[^}]*background: #13161c/);
    expect(css).toMatch(/\.adl-dock \{[^}]*border-top: 1px solid #ffffff14/);
  });

  it('labels in 9px spaced capitals and shows figures light', () => {
    expect(css).toMatch(/\.adl-eyebrow \{[^}]*font-size: 9px[^}]*letter-spacing: \.16em[^}]*text-transform: uppercase/);
    expect(css).toMatch(/\.adl-console-readout strong \{[^}]*font-size: 26px[^}]*font-weight: 300/);
    expect(css).toMatch(/\.adl-intro h2 \{[^}]*font-weight: 300/);
  });

  describe('controls first, and everything centred', () => {
    const concepts = ['edge', 'center', 'capsule', 'waveform', 'islands', 'console', 'editorial', 'vinyl', 'shelf', 'compact', 'fshelf', 'frail', 'fwave', 'fflip'];
    const dockOf = (kind: string) => {
      const start = markup.indexOf(`adl-style-${kind}`);
      const next = markup.indexOf('adl-concept', start + 10);
      const dock = markup.slice(start, next === -1 ? undefined : next);
      return dock.slice(dock.indexOf('class="adl-dock'));
    };

    it('puts the playback controls before the track information in every dock', () => {
      for (const kind of concepts) {
        const dock = dockOf(kind);
        const controls = Math.min(...['adl-transport', 'adl-vinyl-controls', 'aria-label="Previous track"'].map((m) => (dock.indexOf(m) < 0 ? Infinity : dock.indexOf(m))));
        const info = dock.indexOf('adl-identity');
        expect(controls, kind).toBeLessThan(Infinity);
        expect(info, kind).toBeGreaterThan(-1);
        expect(controls, kind).toBeLessThan(info);
        // Nothing else comes before the controls inside the dock, so they are its first element.
        const firstTag = /<div class="adl-(left-group|island adl-track-island|console-identity|capsule-top|waveform-bottom|editorial-top|shelf-top|pocket-top|transport|vinyl-controls|fs-top|fr-controls|fw-top|ff-top)/.exec(dock);
        expect(firstTag, kind).not.toBeNull();
      }
    });

    it('lists the controls first in the source of every concept', () => {
      const src = read('./LayoutLabAudioDockMockups.tsx');
      const cases = src.slice(src.indexOf('function dockContent'), src.indexOf('return <div className="adl-preview-scroll"'));
      expect(cases).toContain("case 'edge': return <>{transport()}{identity()}");
      expect(cases).toContain('<div className="adl-left-group">{transport()}{identity(true, true)}</div>');
      expect(cases).toContain('<div className="adl-capsule-top">{transport()}{identity()}');
      expect(cases).toContain('<div className="adl-waveform-bottom">{transport()}{identity()}');
      expect(cases).toContain('<div className="adl-island adl-track-island">{transport()}{identity(true, true)}</div>');
      expect(cases).toContain('<div className="adl-console-identity">{transport()}');
      expect(cases).toContain('<div className="adl-editorial-top">{transport()}{identity(false, true)}');
      expect(cases.indexOf('adl-vinyl-controls')).toBeLessThan(cases.indexOf('adl-vinyl-track'));
      expect(cases).toContain('<div className="adl-shelf-top">{transport()}{identity(false)}');
      expect(cases.slice(cases.indexOf("case 'compact'")).indexOf('Previous track')).toBeLessThan(cases.slice(cases.indexOf("case 'compact'")).indexOf('{identity()}'));
    });

    it('centres the controls and the elements on the right in the middle of the dock', () => {
      expect(css).toMatch(/\.adl-dock \{[^}]*display: flex; align-items: center;/);
      expect(css).toMatch(/\.adl-style-center \.adl-dock \{[^}]*align-items: center;/);
      expect(css).toMatch(/\.adl-style-console \.adl-dock \{[^}]*align-items: center;/);
      expect(css).toMatch(/\.adl-right-stack \{[^}]*justify-content: center;/);
      expect(css).toMatch(/\.adl-left-group \{ display: flex; align-items: center;/);
      expect(css).toMatch(/\.adl-console-identity \{ display: flex; align-items: center;/);
      expect(css).toMatch(/\.adl-vinyl-controls \{ display: flex; align-items: center;/);
      for (const row of ['capsule-top', 'waveform-bottom', 'editorial-top', 'shelf-top', 'shelf-bottom', 'pocket-top']) expect(css, row).toMatch(new RegExp(`\\.adl-${row} \\{[^}]*align-items: center`));
    });
  });

  describe('the four floating shelf docks (11 to 14)', () => {
    const floats = ['fshelf', 'frail', 'fwave', 'fflip'];
    const dockOf = (kind: string) => {
      const start = markup.indexOf(`adl-style-${kind}`);
      const next = markup.indexOf('adl-concept', start + 10);
      const part = markup.slice(start, next === -1 ? undefined : next);
      return part.slice(part.indexOf('class="adl-dock'));
    };

    it('is four more docks, after the Pocket Dock, each with the floating raised look', () => {
      const order = [...markup.matchAll(/adl-style-([a-z]+)/g)].map((m) => m[1]).filter((k, i, all) => all.indexOf(k) === i);
      expect(order.slice(-5)).toEqual(['compact', ...floats]);
      for (const kind of floats) expect(dockOf(kind), kind).toContain('adl-float');
      expect(css).toContain('.adl-float::after');
      expect(css).toContain('.adl-float::before');
    });

    it('has the Context Shelf\'s two tiers and its full width, lifted off the bottom like the Pocket Dock', () => {
      expect(css).toMatch(/\.adl-style-fshelf \.adl-dock-placement[^{]*\{ left: 14px; right: 14px; bottom: 16px; \}/);
      expect(css).toMatch(/\.adl-style-fshelf \.adl-dock, \.adl-style-fwave \.adl-dock, \.adl-style-fflip \.adl-dock \{ flex-direction: column;/);
      expect(css).toMatch(/border-radius: 30px/);
      // The shelf is full width; the Pocket Dock is a fixed 760px, so these are not that.
      expect(css).not.toMatch(/\.adl-style-f(shelf|rail|wave|flip) \.adl-dock-placement[^{]*\{[^}]*width: 760px/);
    });

    it('places the elements differently in each, with the controls first', () => {
      const a = dockOf('fshelf'), b = dockOf('frail'), c = dockOf('fwave'), d = dockOf('fflip');
      // 11: controls and track share the top tier, the timeline is beneath.
      expect(a.indexOf('adl-fs-top')).toBeLessThan(a.indexOf('adl-transport'));
      expect(a.indexOf('adl-identity')).toBeLessThan(a.indexOf('adl-fs-bottom'));
      expect(a.indexOf('adl-fs-bottom')).toBeLessThan(a.indexOf('adl-timeline'));
      // 12: a control rail first, then a column holding the two tiers.
      expect(b.indexOf('adl-fr-controls')).toBeLessThan(b.indexOf('adl-fr-main'));
      expect(b.indexOf('adl-transport')).toBeLessThan(b.indexOf('adl-identity'));
      // 13: the lower tier is the waveform.
      expect(c.indexOf('adl-fw-bottom')).toBeLessThan(c.indexOf('adl-timeline-wave'));
      // 14: the timeline is on the top tier with the controls, and the track information is underneath.
      expect(d.indexOf('adl-ff-top')).toBeLessThan(d.indexOf('adl-transport'));
      expect(d.indexOf('adl-timeline')).toBeLessThan(d.indexOf('adl-ff-bottom'));
      expect(d.indexOf('adl-ff-bottom')).toBeLessThan(d.indexOf('adl-identity'));
    });

    it('gives each its own finish: raised graphite, frosted glass, brushed deep graphite and satin', () => {
      expect(css).toMatch(/\.adl-style-frail \.adl-dock \{[^}]*backdrop-filter: blur\(16px\)/);
      expect(css).toMatch(/\.adl-style-fwave \.adl-dock \{[^}]*repeating-linear-gradient\(0deg, #ffffff06 0 1px/);
      expect(css).toMatch(/\.adl-style-fflip \.adl-dock \{[^}]*linear-gradient\(115deg, transparent 36%, #ffffff0d 46%/);
      expect(css).toMatch(/\.adl-fw-bottom \{[^}]*background: #13161c/);
    });
  });
});
