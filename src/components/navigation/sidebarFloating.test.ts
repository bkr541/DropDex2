import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { activeSidebarKey } from './sidebarGroups';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
describe('activeSidebarKey', () => {
  it('maps pages to entries', () => {
    expect(activeSidebarKey('home', ['home', 'review'])).toBe('home');
    expect(activeSidebarKey('settings', ['home'])).toBe('profile');
    expect(activeSidebarKey('other', ['home'])).toBeNull();
  });
});

describe('FloatingSidebar wiring', () => {
  const src = read('./FloatingSidebar.tsx');
  it('is one rounded card holding every entry, with no separate group for the current page', () => {
    expect(src).toContain('data-testid="floating-sidebar"');
    expect(src).toContain('pointer-events-auto glass logo-gradient-border flex flex-col gap-1 rounded-3xl p-2');
    expect(src).toContain('entries.map(');
    expect(src).not.toContain('splitAtActive');
    expect(src).not.toContain('sidebar-active');
  });
  it('reserves the collapsed rail width and expands the card over the page', () => {
    expect(src).toMatch(/<aside className="pointer-events-none relative z-40 hidden w-\[88px\] shrink-0 md:block">/);
    expect(src).toContain('absolute inset-y-0 left-0');
    expect(src).toContain("collapsed ? 'w-full' : 'w-[264px]'");
  });
  it('is inset equally from the window edge and from the page content (24px each side)', () => {
    expect(src).toContain('py-3 pl-6 pr-0');
    expect(read('../../App.tsx')).toContain('p-6');
  });
  it('has no Layout Lab entry in the nav; Layout Lab is a floating button at the bottom right', () => {
    expect(src).not.toContain('Layout Lab');
    expect(src).not.toContain('PaintBrush');
    const button = read('./FloatingLayoutLabButton.tsx');
    expect(button).toContain('fixed bottom-6 right-6');
    expect(read('../../App.tsx')).toContain('<FloatingLayoutLabButton onOpen={openLayoutLab} />');
  });
  it('spaces every entry evenly, with no divider lines between groups', () => {
    expect(src).not.toContain('divider');
  });
  it('shows the current page with a larger gradient icon', () => {
    expect(src).toContain("'logo-gradient-icon scale-[1.4]'");
    expect(src).toContain("'scale-100'");
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
