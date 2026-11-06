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
  it('is one slim capsule of round buttons holding every entry, with no separate group for the current page', () => {
    expect(src).toContain('data-testid="floating-sidebar"'.replace('floating-sidebar', 'sidebar-card'));
    expect(src).toContain('rounded-[32px]');
    expect(src).toContain('entries.map(');
    expect(src).not.toContain('splitAtActive');
    expect(src).not.toContain('logo-gradient-border');
  });
  it('is a fixed slim rail with no expanded mode', () => {
    expect(src).toMatch(/<aside className="pointer-events-none relative z-40 hidden w-\[88px\] shrink-0 md:block">/);
    expect(src).toContain('absolute inset-y-0 left-0');
    expect(src).not.toContain('Expand sidebar');
    expect(src).not.toContain('w-[264px]');
    expect(src).not.toContain('onToggleCollapsed');
    expect(read('../../App.tsx')).not.toContain('sidebarCollapsed');
  });
  it('is inset equally from the window edge and from the page content (24px each side)', () => {
    expect(src).toContain('py-3 pl-6');
    expect(read('../../App.tsx')).toContain('p-6');
  });
  it('slides the page name open beside the icon on hover and on keyboard focus', () => {
    expect(src).toContain('group relative h-12 w-12');
    expect(src).toContain('max-w-0 overflow-hidden');
    expect(src).toContain('group-hover:max-w-[200px]');
    expect(src).toContain('group-focus-within:max-w-[200px]');
    expect(src).toContain('transition-[max-width,padding,opacity]');
    expect(src).toContain('aria-label={label}');
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
  it('shows the current page as a tinted round button with a gradient icon and a tab on the edge', () => {
    expect(src).toContain("'logo-gradient-icon scale-[1.15]'");
    expect(src).toContain("'scale-100'");
    expect(src).toContain('bg-[rgb(255_78_79/0.14)]');
    expect(src).toContain("background: 'var(--gradient-logo)'");
  });
  it('uses the same shadow as the page-name tab', () => {
    const shadow = /PAGE_NAME_TAB_SHADOW = '([^']+)'/.exec(src)?.[1];
    expect(shadow).toBeTruthy();
    expect(read('./PageNameTab.tsx')).toContain(shadow!);
  });
  it('is used by App', () => {
    expect(read('../../App.tsx')).toContain('<FloatingSidebar');
  });
});

describe('Left nav icons', () => {
  const app = read('../../App.tsx');
  const data = read('./navIconData.ts');
  const wanted: [string, string, string][] = [
    ['home', 'Shelf divider', 'Library'],
    ['review', 'Clip listening', 'Review'],
    ['cues', 'Marker on wave', 'Cue Points'],
    ['audition', 'Listening booth', 'Audition'],
    ['discovery', 'Globe pin', 'Discover'],
    ['drop-lab', 'Transient gate', 'Drop Lab'],
    ['flip-lab', 'Deck swap', 'Flip Lab'],
    ['usb', 'Drive bay', 'USB Management'],
  ];

  it('uses the chosen Layout Lab icon for every page', () => {
    for (const [view, name] of wanted) expect(data).toContain(`"${view}": { name: "${name}"`);
    for (const [view] of wanted) expect(app).toContain(view.includes('-') ? `NAV_ICONS['${view}']` : `NAV_ICONS.${view}`);
  });

  it('no longer uses the old carbon icons or the old Cue Points drawing in the nav', () => {
    const items = app.slice(app.indexOf('const sidebarNavItems'), app.indexOf('const titledPage'));
    for (const old of ['Music', 'Growth', 'Headphones', 'Radio', 'Chemistry', 'Shuffle', 'Usb', 'CuePointsNavIcon']) expect(items).not.toMatch(new RegExp(`icon: ${old}\\b`));
    expect(app).not.toContain('function CuePointsNavIcon');
  });

  it('draws each as strokes that take the button colour, and shows the current page in the logo red', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { createElement } = await import('react');
    const { NAV_ICONS } = await import('./NavIcons');
    const markup = renderToStaticMarkup(createElement(NAV_ICONS.usb, { size: 24, className: 'logo-gradient-icon' }));
    expect(markup).toContain('stroke="currentColor"');
    expect(markup).toContain('class="nav-icon logo-gradient-icon"');
    expect(markup).toContain('<path');
    const css = read('./navIcons.css');
    expect(css).toMatch(/\.nav-icon\.logo-gradient-icon \{ fill: none; color: var\(--color-logo-red\); \}/);
  });
});
