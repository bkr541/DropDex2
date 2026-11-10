import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ListingSkeleton, PageSkeleton } from './PageSkeleton';

describe('page skeletons', () => {
  it('draws a placeholder for each kind of page, announced as loading', () => {
    for (const variant of ['home', 'listing', 'cards', 'workspace'] as const) {
      const html = renderToStaticMarkup(createElement(PageSkeleton, { variant, label: 'Loading test' }));
      expect(html).toContain(`dd-page-skeleton--${variant}`);
      expect(html).toContain('aria-busy="true"');
      expect(html).toContain('aria-label="Loading test"');
    }
  });

  it('shows rows while a listing loads', () => {
    expect((renderToStaticMarkup(createElement(ListingSkeleton, { count: 5 })).match(/dd-skeleton-row"/g) ?? []).length).toBe(5);
  });

  it('is what every lazy screen and loading listing shows instead of a spinner', () => {
    const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
    expect(read('../../RouteStates.tsx')).toContain('<PageSkeleton');
    expect(read('../../../App.tsx')).toContain('variant={skeleton}');
    expect(read('../../audition/AuditionLibrary.tsx')).toContain('<ListingSkeleton');
    expect(read('../../cues/CuePointsView.tsx')).toContain('<ListingSkeleton');
    expect(read('../../library/LibraryView.tsx')).toContain('<PageSkeleton variant="home"');
  });
});
