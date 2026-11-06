import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { NavDesignMockupsContent } from './LayoutLabNavDesignMockups';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const tsx = read('./LayoutLabNavDesignMockups.tsx');
const css = read('./layout-lab-nav-design.css');
const markup = renderToStaticMarkup(createElement(NavDesignMockupsContent));

const ACTIVE = ['ember', 'orbit', 'well', 'gem', 'glow', 'shelf', 'beam', 'engraved'];
const HOVER = ['pill', 'bubble', 'reveal', 'tag', 'line', 'glass', 'spring', 'type'];
const LOOKS = ['graphite', 'slate', 'warm', 'deep', 'satin', 'weave', 'frost', 'brushed'];

describe('Layout Lab Nav Design tab', () => {
  it('shows eight studies, each with the production floating capsule on the middle left', () => {
    expect(markup.match(/data-testid="nav-study"/g)).toHaveLength(8);
    expect(markup.match(/sidebar-capsule nd-capsule/g)).toHaveLength(8);
    expect(css).toMatch(/\.nd-preview \.nd-capsule \{[^}]*left: 24px; top: 50%; transform: translateY\(-50%\); width: 64px/);
    expect(read('../navigation/FloatingSidebar.css')).toContain('.sidebar-capsule');
  });

  it('has nothing left of the old nav shapes or the torn-page layers', () => {
    for (const gone of ['TornPage', 'TornNavRail', 'nd-torn', 'nd-contour', 'nd-pods', 'nd-inset', 'nd-spine', 'nd-glass', 'Ring(']) {
      expect(tsx).not.toContain(gone);
      expect(css).not.toContain(gone);
    }
  });

  it('uses the production nav icons and page names', () => {
    expect(tsx).toContain("import { NAV_ICONS } from '../navigation/NavIcons';");
    for (const label of ['Library', 'Review', 'Cue Points', 'Audition', 'Discover', 'Drop Lab', 'Flip Lab', 'USB Management']) expect(markup).toContain(`<b>${label}</b>`);
  });

  it('gives every study its own active icon, its own hover name and its own graphite finish', () => {
    for (const [i, kind, list] of [[0, 'act', ACTIVE], [1, 'hov', HOVER], [2, 'look', LOOKS]] as const) {
      const used = [...markup.matchAll(new RegExp(`nd-${kind}-([a-z]+)`, 'g'))].map((m) => m[1]);
      expect(new Set(used).size, kind).toBe(8);
      expect([...new Set(used)].sort(), `${i}`).toEqual([...list].sort());
    }
    for (const name of ACTIVE) expect(css).toContain(`.nd-act-${name} `);
    for (const name of HOVER) expect(css).toContain(`.nd-hov-${name} `);
    for (const name of LOOKS.slice(1)) expect(css).toContain(`.nd-look-${name} {`);
  });

  it('keeps every graphite finish on the production gradient family, with different textures and depth', () => {
    expect(css).toContain('--nd-bg: linear-gradient(165deg, #292d37 0%, #20242e 36%, #191d25 100%);');
    const backgrounds = [...css.matchAll(/--nd-bg: (.+);\n/g)].map((m) => m[1]);
    expect(new Set(backgrounds).size).toBe(8);
    for (const bg of backgrounds) expect(bg).toContain('linear-gradient(');
    expect(css).toContain('feTurbulence');
    expect(css).toContain('repeating-linear-gradient');
  });

  it('restyles the hero and panels with the finish instead of their own colours, without moving them', () => {
    expect(css).toContain('.nd-hero-wrap > div { background: var(--nd-hero-bg) !important;');
    expect(css).toContain('.nd-track-panel { padding: 16px 18px;');
    for (const piece of ['nd-page-header', 'nd-hero-wrap', 'nd-content-tabs', 'nd-library-body', 'nd-player']) expect(tsx).toContain(piece);
    expect(tsx.indexOf('nd-page-header')).toBeLessThan(tsx.indexOf('nd-hero-wrap'));
    expect(tsx.indexOf('nd-hero-wrap')).toBeLessThan(tsx.indexOf('nd-content-tabs'));
    expect(tsx.indexOf('nd-content-tabs')).toBeLessThan(tsx.indexOf('nd-player'));
  });

  it('puts every hover name on a different shade of the nav graphite, never on near-black', () => {
    const block = css.slice(css.indexOf('/* ── How the page name appears on hover'), css.indexOf('@keyframes nd-caret'));
    for (const nearBlack of ['#0e1117', '#0b0e13']) expect(block).not.toContain(nearBlack);
    const backgrounds: Record<string, RegExp> = {
      pill: /\.nd-hov-pill \.nd-btn:not\(\[data-state="active"\]\):hover[^}]*background: linear-gradient\(165deg, #434b5b/,
      bubble: /\.nd-hov-bubble \.nd-lbl \{[^}]*background: linear-gradient\(165deg, #3b4252/,
      reveal: /\.nd-hov-reveal \.nd-lbl \{[^}]*background: linear-gradient\(90deg, #363c49f5/,
      tag: /\.nd-hov-tag \.nd-lbl \{[^}]*background: linear-gradient\(165deg, #474f60/,
      line: /\.nd-hov-line \.nd-lbl b \{[^}]*background: linear-gradient\(165deg, #252a33/,
      glass: /\.nd-hov-glass \.nd-lbl \{[^}]*background: linear-gradient\(165deg, #4a5262a6/,
      spring: /\.nd-hov-spring \.nd-btn:not\(\[data-state="active"\]\):hover[^}]*color-mix\(in srgb, var\(--nd-accent\) 16%, #414959\)/,
      type: /\.nd-hov-type \.nd-lbl \{[^}]*background: linear-gradient\(180deg, #1f232b/,
    };
    for (const [name, pattern] of Object.entries(backgrounds)) expect(css, name).toMatch(pattern);
    expect(css).toContain('.nd-hov-pill .nd-btn[data-state="active"] .nd-lbl');
  });
});
