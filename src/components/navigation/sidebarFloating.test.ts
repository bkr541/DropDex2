import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { activeSidebarKey } from './sidebarGroups';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
describe('activeSidebarKey', () => {
  it('maps pages to entries', () => {
    expect(activeSidebarKey('home', ['home', 'artist-library'])).toBe('home');
    expect(activeSidebarKey('settings', ['home'])).toBe('profile');
    expect(activeSidebarKey('other', ['home'])).toBeNull();
  });
});

describe('FloatingSidebar wiring', () => {
  const src = read('./FloatingSidebar.tsx');
  it('is one slim capsule of round buttons holding every entry, with no separate group for the current page', () => {
    expect(src).toContain('data-testid="floating-sidebar"'.replace('floating-sidebar', 'sidebar-card'));
    expect(src).toContain('sidebar-capsule');
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
    expect(src).toContain('group-has-[:focus-visible]:max-w-[200px]');
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
  it('shows the current page as a larger, bolder icon with depth and a tab on the edge, and no circle', () => {
    expect(src).toContain("'logo-gradient-icon scale-[1.4]'");
    expect(src).toContain("'scale-100'");
    expect(src).not.toContain('bg-[rgb(255_78_79/0.14)]');
    expect(src).toContain("background: 'var(--gradient-logo)'");
  });
  it('is used by App', () => {
    expect(read('../../App.tsx')).toContain('<FloatingSidebar');
  });
});

describe('Left nav icons', () => {
  const app = read('../../App.tsx');
  const wanted = {
    home: 'BookStack',
    'artist-library': 'AlbumList',
    cues: 'TriangleFlag',
    audition: 'Headset',
    discovery: 'Globe',
    'drop-lab': 'Flask',
    'set-lab': 'PlaylistPlay',
    'flip-lab': 'HorizontalMerge',
    usb: 'HardDrive',
  } as const;

  it('uses the corresponding Iconoir Regular icon for every page', async () => {
    const regular = await import('iconoir-react/regular');
    const { NAV_ICONS } = await import('./NavIcons');
    for (const view of Object.keys(wanted) as Array<keyof typeof wanted>) {
      expect(NAV_ICONS[view]).toBe(regular[wanted[view]]);
      expect(app).toContain(view.includes('-') ? `NAV_ICONS['${view}']` : `NAV_ICONS.${view}`);
    }
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
    const markup = renderToStaticMarkup(createElement(NAV_ICONS.usb, { width: 24, height: 24, className: 'nav-icon logo-gradient-icon' }));
    expect(markup).toContain('stroke="currentColor"');
    expect(markup).toContain('stroke-width="1.5"');
    expect(markup).toContain('class="nav-icon logo-gradient-icon"');
    expect(markup).toContain('<path');
    const css = read('./navIcons.css');
    expect(css).toMatch(/\.nav-icon\.logo-gradient-icon \{ fill: none; color: var\(--color-logo-red\); \}/);
  });
});

describe('Left nav capsule styling', () => {
  const css = read('./FloatingSidebar.css');
  const studio = read('../ui/studio.css');
  it('is raised off the backdrop with layered shadows, a lit rim and an inner highlight and edge', () => {
    expect(css).toMatch(/box-shadow:[^;]*inset 0 1px 0 #ffffff24[^;]*inset 0 -1px 0 #00000059[^;]*0 1px 2px #00000080[^;]*0 10px 24px -6px #0000008c[^;]*0 30px 64px -12px #000000a6;/);
    expect(css).toContain('.sidebar-capsule::after');
    expect(css).toContain('linear-gradient(155deg, #ffffff47 0%');
  });
  it('is a step lighter than the backdrop, brightest at the top, with a sheen and a fine grain', () => {
    expect(css).toContain('linear-gradient(180deg, #ffffff12 0%, #ffffff00 26%)');
    expect(css).toContain('linear-gradient(165deg, #363c49 0%, #2a2f3a 42%, #20242d 100%)');
    expect(css).toContain('.sidebar-capsule::before');
    expect(css).toContain('feTurbulence');
    expect(css).toContain('mix-blend-mode: overlay');
  });
  it('lifts the current page icon with a shadow and a glow, and a hovered button into a raised pill', () => {
    expect(css).toContain('.sidebar-capsule [data-active="true"]');
    expect(css).not.toContain('0 6px 18px -4px #ff4e4f59');
    expect(css).toMatch(/\[data-testid="sidebar-slot"\]:hover > button:not\(\[data-active="true"\]\)/);
    expect(read('./FloatingSidebar.tsx')).toContain("data-active={active ? 'true' : undefined}");
  });
  it('keeps the Discovery and Audition panels\' greys and whites for text', () => {
    expect(css).toContain('--color-muted-foreground: #a4adbd;');
    expect(css).toContain('--color-foreground: #f6f7fa;');
    expect(studio).toContain('--color-muted-foreground: #a4adbd;');
  });
  it('is no longer the old dark panel colour, and no longer just the panel gradient', () => {
    expect(read('./FloatingSidebar.tsx')).not.toContain('bg-[var(--color-panel)]');
    expect(css).not.toContain('linear-gradient(165deg, #292d37 0%, #20242e 36%, #191d25 100%)');
  });
});

describe('Left nav spacing', () => {
  const src = read('./FloatingSidebar.tsx');
  it('keeps the icons close together: 2px between buttons, down from 8px, so the capsule is shorter', () => {
    expect(src).toContain('sidebar-capsule pointer-events-auto flex flex-col gap-0.5 rounded-[32px] p-2');
    expect(src).not.toContain('flex flex-col gap-2 rounded-[32px]');
    // Ten entries (the logo, eight pages, the USB button and the profile): nine gaps, six pixels less each, 54px less in all.
    const entries = (src.match(/kind: '(logo|nav|usb|profile)'/g) ?? []).length;
    expect(entries).toBeGreaterThan(0);
    expect(read('../ui/layout-lab-nav-design.css')).toMatch(/\.nd-preview \.nd-capsule \{[^}]*flex-direction: column; gap: 2px;/);
  });
});

describe('Left nav current page icon', () => {
  const css = read('./FloatingSidebar.css');
  const src = read('./FloatingSidebar.tsx');
  it('has no circle: no tinted disc, no ring around it, no fill', () => {
    expect(css).toMatch(/\.sidebar-capsule \[data-active="true"\] \{ background: transparent; box-shadow: none; \}/);
    expect(css).not.toMatch(/\[data-active="true"\] \{[^}]*(0 0 0 1px|ff4e4f4d|ff4e4f1f)/);
    expect(src).not.toContain('bg-[rgb(255_78_79/0.14)]');
  });
  it('is larger and has a slightly thicker line', () => {
    expect(src).toContain("'logo-gradient-icon scale-[1.4]'");
    expect(css).toMatch(/\.sidebar-capsule \.nav-icon\.logo-gradient-icon \{[^}]*stroke-width: 1\.9;/);
  });
  it('has depth: a dark shadow underneath and a red glow around the icon, and the same lift on the profile picture', () => {
    expect(css).toMatch(/filter: drop-shadow\(0 3px 3px #000000b3\) drop-shadow\(0 0 7px #ff4e4f80\);/);
    expect(css).toContain('[data-active="true"] .sidebar-avatar { transform: scale(1.25);');
    expect(src).toContain('sidebar-avatar');
  });
});
