import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HeaderStatusMockupsContent } from './LayoutLabHeaderStatusMockups';
import { LoadedTrackMockupsContent } from './LayoutLabLoadedTrackMockups';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const css = read('./layout-lab-track-headers.css');
const loaded = renderToStaticMarkup(createElement(LoadedTrackMockupsContent));
const status = renderToStaticMarkup(createElement(HeaderStatusMockupsContent));
const loadedSource = read('./LayoutLabLoadedTrackMockups.tsx');
const statusSource = read('./LayoutLabHeaderStatusMockups.tsx');

const surfacesIn = (markup: string) => [...markup.matchAll(/lt-s-(panel|raised|well|tier|brushed|tinted)/g)].map((m) => m[1]);

describe('Loaded Track and Header Status tabs, in the graphite look', () => {
  it('puts every mockup on the Discovery graphite stage, with the Audition palette', () => {
    expect(loaded.match(/class="lt-stage"/g)).toHaveLength(6);
    expect(status.match(/class="lt-stage"/g)).toHaveLength(6);
    expect(css).toMatch(/\.lt-stage \{[^}]*--color-primary: #f56b70;/);
    expect(css).toContain('background: linear-gradient(165deg, #292d37 0%, #20242e 36%, #191d25 100%);');
    expect(css).toContain("font-family: 'Helvetica Neue', 'Segoe UI', Arial, sans-serif;");
    for (const legacy of ['bg-[var(--color-card)]', 'bg-[var(--color-background)]" style={rowStyle}']) {
      expect(loadedSource + statusSource).not.toContain(`className={cn('relative ${legacy}`);
    }
    expect(loadedSource).not.toContain("'surface' && 'border border-[var(--color-border-subtle)] bg-[var(--color-panel)]");
  });

  it('gives each mockup in each tab a different graphite surface', () => {
    const l = surfacesIn(loaded);
    const h = surfacesIn(status);
    expect(new Set(l).size).toBe(6);
    expect(new Set(h).size).toBe(6);
    for (const surface of ['panel', 'raised', 'well', 'tier', 'brushed', 'tinted']) { expect(l).toContain(surface); expect(h).toContain(surface); }
  });

  it('has the raised recipe, the recessed well, the brushed grain, the tier wash and the key tint', () => {
    expect(css).toMatch(/\.lt-s-raised \{[^}]*box-shadow: inset 0 1px 0 #ffffff24, inset 0 -1px 0 #00000059, 0 1px 2px #00000080, 0 10px 24px -6px #0000008c, 0 24px 48px -14px #000000a6;/);
    expect(css).toContain('.lt-s-raised::after');
    expect(css).toContain('feTurbulence');
    expect(css).toMatch(/\.lt-s-well \{[^}]*inset 0 3px 8px #000000b3/);
    expect(css).toMatch(/\.lt-s-brushed \{[^}]*repeating-linear-gradient\(0deg, #ffffff06 0 1px/);
    expect(css).toMatch(/\.lt-tier-wash \{ background: #00000026;/);
    expect(css).toContain('color-mix(in srgb, var(--lt-key, #f56b70) 16%, transparent)');
  });

  it('uses the shared buttons, the graphite artwork tile and the 9px spaced-capital labels', () => {
    expect(loadedSource).toContain("import { ControlButton } from './controls/ControlButton';");
    expect(loadedSource).toContain("variant={variant === 'surface' ? 'secondary' : variant}");
    expect(loaded).toContain('lt-art');
    expect(loaded).toContain('lt-label');
    expect(status).toContain('lt-label');
    expect(css).toMatch(/\.lt-label \{[^}]*font-size: 9px[^}]*letter-spacing: \.16em[^}]*text-transform: uppercase/);
  });

  it('shows the cue states in soft colours from the same palette, with no pure web colours', () => {
    for (const color of ['#9aa5b8', '#f0b35a', '#5fb8e8', '#a99bff', '#6fd9a4', '#f27d96']) expect(statusSource).toContain(color);
    for (const old of ['#fbbf24', '#3b91ff', '#38c3dc', '#34d399', '#f87171', '#8e9aa8']) expect(statusSource).not.toContain(old);
  });

  it('keeps the content and order of each mockup, and the state picker', () => {
    for (const text of ['Disappearance w EVOKE45', 'Auto Cue', 'Apply All', 'Pending', 'Editing']) expect(loaded).toContain(text);
    for (const text of ['Toolbar icon', 'Color rail + label', 'Workflow strip', 'Album art badge', 'Caption under the icons']) expect(status).toContain(text);
    expect(status.match(/class="lt-state-btn"/g)).toHaveLength(6);
  });

  it('floats the right-hand buttons in the vertical middle of the header row, not against its top', () => {
    // Header Status: the row centres its columns and the toolbar no longer rides up with a negative margin.
    expect(statusSource).toContain("'flex flex-row items-center justify-between gap-3 px-5 py-2'");
    expect(statusSource).not.toContain('items-start');
    expect(statusSource).not.toContain('-mt-[7px]');
    // Loaded Track: every strip that holds the actions centres them, including the top line of the two-tier strip.
    for (const strip of ['lt-s-panel flex items-center justify-between', 'lt-s-raised flex items-center justify-between', 'lt-s-well flex items-center', 'lt-s-brushed flex items-stretch', 'lt-s-tinted flex items-center']) expect(loadedSource).toContain(strip);
    expect(loadedSource).toContain('flex items-center gap-3 px-4 h-[40px]');
    expect(loadedSource).toContain('<div className="flex items-center px-4"><Actions /></div>');
    expect(loadedSource).not.toContain('items-start');
  });
});
