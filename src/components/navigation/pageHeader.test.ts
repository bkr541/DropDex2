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
    expect(markup).toContain('fixed top-1.5');
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
    expect(renderToStaticMarkup(createElement(FloatingPageHeader, { title: 'Drop Lab', anchor: 'container' }))).toContain('absolute top-1.5');
  });

  it('leaves its positioning to the component, so a style rule cannot override fixed or absolute', () => {
    expect(css).not.toMatch(/\.page-header-float \{[^}]*position:/);
  });

  it('is finished like the left nav: layered shadows, a lit rim, a lighter top-lit surface and a fine grain', () => {
    expect(css).toMatch(/box-shadow:[^;]*inset 0 1px 0 #ffffff24[^;]*0 1px 2px #00000080[^;]*0 8px 18px -6px #0000008c[^;]*0 20px 44px -12px #000000a6;/);
    expect(css).toContain('.page-header-float::after');
    expect(css).toContain('linear-gradient(155deg, #ffffff47 0%');
    expect(css).toContain('.page-header-float::before');
    expect(css).toContain('feTurbulence');
    expect(css).toContain('linear-gradient(165deg, #363c49');
  });

  it('is rendered once, by App, outside the page layout, and the old full-width row is gone', () => {
    expect(app.match(/<FloatingPageHeader/g)).toHaveLength(1);
    expect(app).not.toContain('PageNameTab');
    const root = app.indexOf('className="flex h-screen flex-col overflow-hidden font-sans relative"');
    const header = app.indexOf('<FloatingPageHeader', root);
    const row = app.indexOf('<div className="flex min-h-0 flex-1">', root);
    expect(header).toBeGreaterThan(root);
    expect(header).toBeLessThan(row);
  });

  it('no longer reserves any height for a header: pages fill the whole window', () => {
    for (const file of ['../../index.css', '../ui/studio.css', '../audition/AuditionView.css', '../cues/CuePointsView.tsx']) expect(read(file)).not.toContain('page-header-height');
    expect(read('../ui/studio.css')).toContain('height: calc(100vh - 3rem);');
    expect(read('../audition/AuditionView.css')).toContain('height: calc(100vh - 3rem);');
  });
});
