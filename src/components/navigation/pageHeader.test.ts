import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PageNameTab } from './PageNameTab';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('page header', () => {
  const markup = renderToStaticMarkup(createElement(PageNameTab, { title: 'Audition' }));

  it('is a full-width row in the page flow, not a floating tab', () => {
    expect(markup).toContain('<header');
    expect(markup).toContain('w-full');
    expect(markup).toContain('shrink-0');
    for (const floating of ['absolute top-0', 'translateX', 'pointer-events-none absolute top-0', 'rounded-b-3xl', 'max-w-[60%]']) {
      expect(markup).not.toContain(floating);
    }
    expect(markup).toContain('height:var(--page-header-height)');
  });

  it('shows the page name, left aligned with the page content, with a gradient hairline along its bottom edge', () => {
    expect(markup).toContain('Audition');
    expect(markup).toContain('px-6');
    expect(markup).toContain('var(--gradient-logo)');
  });

  it('spans the whole window: it is above the nav and the page, not inside the content column beside the nav', () => {
    const app = read('../../App.tsx');
    const root = app.indexOf('className="flex h-screen flex-col overflow-hidden font-sans relative"');
    const header = app.indexOf('<PageNameTab', root);
    const below = app.indexOf('<div className="flex min-h-0 flex-1">', root);
    expect(root).toBeGreaterThan(-1);
    expect(header).toBeGreaterThan(root);
    // The header comes first, then one row holding the nav and the content column.
    expect(header).toBeLessThan(below);
    expect(below).toBeLessThan(app.indexOf('<FloatingSidebar', root));
    expect(app.indexOf('<FloatingSidebar', root)).toBeLessThan(app.indexOf('{/* Scrollable content */}', root));
    // And it is not repeated inside the content column.
    expect(app.match(/<PageNameTab/g)).toHaveLength(1);
  });

  it('defines its height once, and the pages that fill the window subtract it', () => {
    expect(read('../../index.css')).toContain('--page-header-height: 2.75rem;');
    expect(read('../audition/AuditionView.css')).toContain('var(--page-header-height, 0px)');
    expect(read('../cues/CuePointsView.tsx')).toContain('var(--page-header-height, 0px)');
  });
});
