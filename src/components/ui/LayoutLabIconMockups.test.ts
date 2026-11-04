import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ICON_GROUPS, ICON_STATES } from './layoutLabIconData';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');

describe('Layout Lab icon concepts', () => {
  it('has ten concepts for each page in the left nav', () => {
    expect(ICON_GROUPS.map((g) => g.page)).toEqual(['Library', 'Review', 'Cue Points', 'Audition', 'Discover', 'Drop Lab', 'Flip Lab', 'USB Management']);
    for (const group of ICON_GROUPS) expect(group.icons).toHaveLength(10);
  });
  it('gives every icon a unique drawing and name', () => {
    const drawings = ICON_GROUPS.flatMap((g) => g.icons.map((i) => i.svg));
    expect(new Set(drawings).size).toBe(drawings.length);
    for (const group of ICON_GROUPS) expect(new Set(group.icons.map((i) => i.name)).size).toBe(10);
  });
  it('draws every icon with theme-aware colour only, so each state can restyle it', () => {
    for (const { icons } of ICON_GROUPS) {
      for (const { svg } of icons) {
        expect(svg).not.toMatch(/#[0-9a-f]{3,6}/i);
        expect(svg).not.toMatch(/stroke="(?!none)/);
        expect(svg.trim().startsWith('<')).toBe(true);
      }
    }
  });
  it('draws every icon in two tones: a light tint and a solid tone', () => {
    for (const { icons } of ICON_GROUPS) {
      for (const { name, svg } of icons) {
        const hasLight = /fill-opacity="\.3"|stroke-opacity="\.4"/.test(svg);
        expect({ name, hasLight }).toEqual({ name, hasLight: true });
      }
    }
  });
  it('shows the icons at 64px, double the previous size', () => {
    expect(read('./LayoutLabIconMockups.tsx')).toContain('size={compact ? 40 : 64}');
  });
  it('offers the states in the toggle', () => {
    expect(ICON_STATES.map((s) => s.id)).toEqual(['idle', 'hover', 'active', 'pressed', 'disabled']);
    const ui = read('./LayoutLabIconMockups.tsx');
    expect(ui).toContain("label: 'All states'");
  });
  it('is a tab in Layout Lab', () => {
    const win = read('./LayoutLabWindow.tsx');
    expect(win).toContain("{ id: 'icons', label: 'Icons' }");
    expect(win).toContain('<IconMockupsContent />');
  });
});
