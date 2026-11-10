import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FloatingPageHeader } from './FloatingPageHeader';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('page header', () => {
  const markup = renderToStaticMarkup(createElement(FloatingPageHeader, { title: 'Audition' }));
  const css = read('./FloatingPageHeader.css');
  const app = read('../../App.tsx');

  it('is a small group floating at the top middle of the window, taking no space and never catching clicks', () => {
    expect(markup).toContain('<header');
    expect(markup).toContain('fixed top-0');
    expect(markup).toContain('left-1/2');
    expect(markup).toContain('-translate-x-1/2');
    expect(markup).toContain('pointer-events-none');
    expect(markup).toContain('Audition');
    expect(markup).not.toContain('w-full');
    expect(markup).not.toContain('shrink-0 items-center gap-2.5 px-6');
  });

  it('shows the page icon beside the name when there is one', () => {
    const withIcon = renderToStaticMarkup(createElement(FloatingPageHeader, { title: 'Discover', icon: (props: { size?: number; className?: string }) => createElement('svg', props) }));
    expect(withIcon).toContain('logo-gradient-icon');
    expect(withIcon.indexOf('<svg')).toBeLessThan(withIcon.indexOf('Discover'));
  });

  it('can sit inside a mockup instead of the window', () => {
    expect(renderToStaticMarkup(createElement(FloatingPageHeader, { title: 'Drop Lab', anchor: 'container' }))).toContain('absolute top-0');
  });

  it('leaves its positioning to the component, so a style rule cannot override fixed or absolute', () => {
    expect(css).not.toMatch(/\.page-header-float \{[^}]*position:/);
  });

  it('is a raised tab hanging from the top edge: 18px curves at the bottom corners and 18px concave flares at the top, the mirror of the tab the dock had', () => {
    expect(css).toContain('border-radius: 0 0 18px 18px;');
    expect(css).toMatch(/\.page-header-float::before \{ right: 100%; background: radial-gradient\(circle at 0 100%, transparent 17\.5px, var\(--tab\) 18px\); \}/);
    expect(css).toMatch(/\.page-header-float::after \{ left: 100%; background: radial-gradient\(circle at 100% 100%, transparent 17\.5px, var\(--tab\) 18px\); \}/);
    expect(css).toContain('--tab: #272b35;');
    expect(css).toMatch(/box-shadow:[^;]*inset 0 -1px 0 #ffffff24[^;]*0 8px 18px -8px #0000008c;/);
  });

  it('is rendered by App at the top, not by the audio dock', () => {
    expect(app.match(/<FloatingPageHeader/g)).toHaveLength(1);
    expect(read('../player/NowPlayingBar.tsx')).not.toContain('app-dock-tab');
  });

  it('no longer reserves any height for a header: pages fill the whole window', () => {
    for (const file of ['../../index.css', '../ui/studio.css', '../audition/AuditionView.css', '../cues/CuePointsView.tsx']) expect(read(file)).not.toContain('page-header-height');
    expect(read('../ui/studio.css')).toContain('height: calc(100vh - 3rem);');
    expect(read('../audition/AuditionView.css')).toContain('height: calc(100vh - 3rem);');
  });
});
