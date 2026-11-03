import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { activeSidebarKey, splitAtActive } from './sidebarGroups';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const entries = ['logo', 'home', 'review', 'usb', 'profile'].map((key) => ({ key }));
describe('splitAtActive', () => {
  it('splits into above, active and below', () => {
    const r = splitAtActive(entries, 'review');
    expect(r.before.map((e) => e.key)).toEqual(['logo', 'home']);
    expect(r.active?.key).toBe('review');
    expect(r.after.map((e) => e.key)).toEqual(['usb', 'profile']);
  });
  it('keeps one group when nothing is active', () => {
    const r = splitAtActive(entries, null);
    expect(r.before).toHaveLength(5);
    expect(r.active).toBeNull();
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
  it('wraps the entries above and below in rounded gradient cards, and the current page in none', () => {
    expect(src).toContain('data-testid="floating-sidebar"');
    expect(src).toContain('glass logo-gradient-border flex flex-col gap-0 rounded-3xl p-2');
    expect(src).toContain("card(before, 'above')");
    expect(src).toContain("card(after, 'below')");
    const activeBlock = src.slice(src.indexOf('data-testid="sidebar-active"'), src.indexOf('render(active, true)'));
    expect(activeBlock).not.toContain('glass');
    expect(activeBlock).not.toContain('logo-gradient-border');
    expect(src).toContain('w-[88px]');
    expect(src).toContain('w-[264px]');
  });
  it('is inset equally from the window edge and from the page content (24px each side)', () => {
    expect(src).toContain('py-3 pl-6 pr-0');
    expect(read('../../App.tsx')).toContain('p-6');
  });
  it('shows the current page with a larger gradient icon', () => {
    expect(src).toContain("'logo-gradient-icon scale-[1.4]'");
    expect(src).toContain("'scale-100'");
    expect(src).toContain('el.animate');
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
