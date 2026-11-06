import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ICON_GROUPS, ICON_STATES } from './layoutLabIconData';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');

const iconGroups = ICON_GROUPS.map(({ icons, customIcons }) => [...icons, ...customIcons]);

describe('Layout Lab icon concepts', () => {
  it('has ten original concepts and five custom concepts for each page', () => {
    expect(ICON_GROUPS.map((g) => g.page)).toEqual(['Library', 'Review', 'Cue Points', 'Audition', 'Discover', 'Drop Lab', 'Flip Lab', 'USB Management']);
    for (const { icons, customIcons } of ICON_GROUPS) {
      expect(icons).toHaveLength(10);
      expect(customIcons).toHaveLength(5);
    }
  });
  it('gives every icon a unique drawing and name', () => {
    const drawings = iconGroups.flat().map(({ svg }) => svg);
    expect(new Set(drawings).size).toBe(drawings.length);
    for (const icons of iconGroups) expect(new Set(icons.map(({ name }) => name)).size).toBe(15);
  });
  it('draws every icon with theme-aware colour only, so each state can restyle it', () => {
    for (const icons of iconGroups) {
      for (const { svg } of icons) {
        expect(svg).not.toMatch(/#[0-9a-f]{3,6}/i);
        expect(svg).not.toMatch(/stroke="(?!none)/);
        expect(svg.trim().startsWith('<')).toBe(true);
      }
    }
  });
  it('uses explicit structure and accent roles on the first 25 icons in gallery order', () => {
    const icons = iconGroups.flat();
    for (const { name, svg } of icons.slice(0, 25)) {
      expect(svg, name).toContain('data-tone="structure"');
      expect(svg, name).toContain('data-tone="accent"');
      expect(svg, name).not.toMatch(/stroke-width|stroke-opacity|class="ic-wash"/);
    }
    for (const { name, svg } of icons.slice(25)) {
      expect(svg, name).not.toContain('data-tone=');
      expect(svg, name).toMatch(/fill-opacity="\.3"|stroke-opacity="\.4"/);
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
