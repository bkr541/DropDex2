import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { activeSidebarKey, splitAtActive } from './sidebarGroups';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const entries = ['logo', 'home', 'review', 'cues', 'usb', 'profile'].map((key) => ({ key }));

describe('splitAtActive', () => {
  it('separates entries above, the active one, and entries below', () => {
    const { before, active, after } = splitAtActive(entries, 'review');
    expect(before.map((e) => e.key)).toEqual(['logo', 'home']);
    expect(active?.key).toBe('review');
    expect(after.map((e) => e.key)).toEqual(['cues', 'usb', 'profile']);
  });
  it('leaves one group when nothing is active', () => {
    const { before, active, after } = splitAtActive(entries, null);
    expect(before).toHaveLength(entries.length);
    expect(active).toBeNull();
    expect(after).toEqual([]);
  });
  it('handles the active entry being first or last', () => {
    expect(splitAtActive(entries, 'logo').before).toEqual([]);
    expect(splitAtActive(entries, 'profile').after).toEqual([]);
  });
});

describe('activeSidebarKey', () => {
  it('maps pages to entries', () => {
    expect(activeSidebarKey('home', ['home', 'review'])).toBe('home');
    expect(activeSidebarKey('settings', ['home'])).toBe('profile');
    expect(activeSidebarKey('other', ['home'])).toBeNull();
  });
});

describe('FloatingSidebar wiring', () => {
  const src = read('./FloatingSidebar.tsx');
  it('renders separate fully rounded pieces with the gradient border and tab shadow', () => {
    expect(src).toContain('data-testid="floating-sidebar"');
    expect(src).toContain('glass logo-gradient-border flex flex-col rounded-3xl p-2');
    expect(src).toContain('gap-2');
    expect(src).toContain("piece(before, 'above')");
    expect(src).toContain("piece([active], 'active', true)");
    expect(src).toContain("piece(after, 'below')");
    expect(src).toContain('w-[88px]');
    expect(src).toContain('w-[264px]');
  });
  it('keeps a fixed height and slides the current page between options', () => {
    expect(src).toContain('SIDEBAR_HEIGHT');
    expect(src).toContain('flexGrow: list.length');
    expect(src).toContain('el.animate');
    expect(src).toContain('prefers-reduced-motion');
  });
  it('uses the same shadow as the page-name tab', () => {
    const shadow = /PAGE_NAME_TAB_SHADOW = '([^']+)'/.exec(src)?.[1];
    expect(shadow).toBeTruthy();
    expect(read('./PageNameTab.tsx')).toContain(shadow!);
  });
  it('is used by App', () => {
    expect(read('../../App.tsx')).toContain('<FloatingSidebar');
  });
  it('keeps the gradient border above the CDJ glass rule', () => {
    expect(read('../../index.css')).toContain('html .glass.logo-gradient-border');
  });
});
