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
        const firstTag = /<div class="adl-(left-group|island adl-track-island|console-identity|capsule-top|waveform-bottom|editorial-controls|shelf-top|pocket-top|transport|vinyl-controls|fs-top|fr-controls|fw-top|ff-top)/.exec(dock);
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
      expect(cases).toContain('<div className="adl-editorial-controls">{transport()}</div><div className="adl-editorial-main">{identity(false, true)}{timeline()}</div><div className="adl-editorial-output">{output()}</div>');
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
      for (const row of ['capsule-top', 'waveform-bottom', 'shelf-top', 'shelf-bottom', 'pocket-top']) expect(css, row).toMatch(new RegExp(`\\.adl-${row} \\{[^}]*align-items: center`));
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
      expect(css).toMatch(/\.adl-style-fshelf \.adl-dock, \.adl-style-fwave \.adl-dock, \.adl-style-fflip \.adl-dock \{[^}]*border-radius: 26px/);
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

  describe('Open Type (07): controls and output float in the middle, the track and scrubber between them', () => {
    const start = markup.indexOf('adl-style-editorial');
    const next = markup.indexOf('adl-concept', start + 10);
    const dock = markup.slice(start, next === -1 ? undefined : next);

    it('puts the controls first, then the track and scrubber, then the output', () => {
      const controls = dock.indexOf('adl-editorial-controls');
      const main = dock.indexOf('adl-editorial-main');
      const output = dock.indexOf('adl-editorial-output');
      expect(controls).toBeGreaterThan(-1);
      expect(controls).toBeLessThan(main);
      expect(main).toBeLessThan(output);
      // The controls (transport) are in the left column, the track information and the scrubber in the middle, the output on the right.
      expect(dock.indexOf('adl-transport')).toBeLessThan(main);
      expect(dock.indexOf('adl-identity')).toBeGreaterThan(main);
      expect(dock.indexOf('adl-timeline')).toBeGreaterThan(dock.indexOf('adl-identity'));
      expect(dock.indexOf('adl-timeline')).toBeLessThan(output);
      expect(dock.indexOf('adl-output')).toBeGreaterThan(output);
    });

    it('lays the dock out as one row with both button groups centred in its height and the middle column taking the rest', () => {
      expect(css).toMatch(/\.adl-style-editorial \.adl-dock \{[^}]*flex-direction: row; align-items: center;/);
      expect(css).toMatch(/\.adl-editorial-controls, \.adl-editorial-output \{ display: flex; align-items: center; flex: none; height: 52px; \}/);
      expect(css).toMatch(/\.adl-editorial-main \{[^}]*flex: 1;[^}]*flex-direction: column;[^}]*min-width: 0;/);
      expect(css).not.toContain('.adl-editorial-top');
    });

    it('is a short dock: 7px of padding, a slim scrubber, and tight rows in the track column', () => {
      expect(css).toMatch(/\.adl-style-editorial \.adl-dock \{[^}]*padding: 7px 28px; min-height: 0;/);
      expect(css).toMatch(/\.adl-style-editorial \.adl-timeline \{ flex: initial; height: 16px; \}/);
      expect(css).toMatch(/\.adl-editorial-main \.adl-identity strong \{ height: 18px; font-size: 18px; line-height: 18px;/);
      expect(css).toMatch(/\.adl-editorial-main \.adl-identity-text \{ line-height: 14px; \}/);
      expect(css).toMatch(/\.adl-editorial-main \.adl-inline-metadata \{[^}]*height: 14px;[^}]*margin-top: 0;/);
    });

    it('gives the play button and the track title exactly the same distance from the top of the dock', () => {
      // The controls column and the track column are the same fixed height and both start at the top of the dock's padding box, so the top of
      // the play button and the top of the track title are level. The play button fills its column and the scrubber ends where it ends.
      expect(css).toMatch(/\.adl-editorial-controls, \.adl-editorial-output \{[^}]*height: 52px;/);
      expect(css).toMatch(/\.adl-editorial-main \{[^}]*justify-content: space-between; height: 52px;/);
      expect(css).toMatch(/\.adl-style-editorial \.adl-play \{ width: 52px; height: 52px; flex-basis: 52px;/);
      // The title is the first thing in its column (nothing above it) and is not pushed down by a margin or padding.
      expect(css).not.toMatch(/\.adl-editorial-main[^{]*\{[^}]*(padding-top|margin-top: [1-9])/);
    });
  });

  describe('the Pocket Dock, Floating Shelf and Floating Rail (10 to 12) are about 40% shorter', () => {
    it('closes up the rows and the padding of each, down from 126, 118 and 124px to about 78, 72 and 70px', () => {
      // Pocket Dock: the top row, the scrubber row and the details row.
      expect(css).toMatch(/\.adl-style-compact \.adl-dock \{ display: block; min-height: 0; padding: 0 14px; border-radius: 22px; \}/);
      expect(css).toMatch(/\.adl-pocket-top \{[^}]*min-height: 34px;/);
      expect(css).toMatch(/\.adl-pocket-expanded \{ min-height: 0; padding-bottom: 3px;/);
      expect(css).toMatch(/\.adl-pocket-seek \{[^}]*height: 18px;/);
      // Floating Shelf: both tiers.
      expect(css).toMatch(/\.adl-fs-top \{ min-height: 38px; \}/);
      expect(css).toMatch(/\.adl-fs-bottom \{ min-height: 34px;/);
      // Floating Rail: no minimum height, and both tiers.
      expect(css).toMatch(/\.adl-style-frail \.adl-dock \{[^}]*min-height: 0;/);
      expect(css).toMatch(/\.adl-fr-top \{ min-height: 36px; \}/);
      expect(css).toMatch(/\.adl-fr-bottom \{ min-height: 34px;/);
      // The old tall rows are gone.
      for (const old of ['.adl-style-frail .adl-dock { display: flex; align-items: center; gap: 24px; min-height: 124px', '.adl-fs-top { min-height: 62px', '.adl-fr-top { min-height: 58px', '.adl-fs-bottom { min-height: 56px']) expect(css, old).not.toContain(old);
    });

    it('shrinks the controls, artwork and scrubber in those three so the rows can close up', () => {
      expect(css).toMatch(/\.adl-style-compact \.adl-icon-button, \.adl-style-fshelf \.adl-icon-button, \.adl-style-frail \.adl-icon-button \{ width: 26px; height: 26px;/);
      expect(css).toMatch(/\.adl-icon-button\.adl-play[^{]*\{ width: 32px; height: 32px;/);
      expect(css).toMatch(/\.adl-style-compact \.adl-art[^{]*\{ width: 28px; height: 28px;/);
      expect(css).toMatch(/\.adl-style-compact \.adl-seek[^{]*\{ height: 18px; \}/);
      expect(css).toMatch(/\.adl-fr-controls \.adl-icon-button\.adl-play \{ width: 36px; height: 36px;/);
    });
  });
});
