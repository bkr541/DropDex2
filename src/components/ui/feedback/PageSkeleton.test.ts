import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ListingSkeleton, PageSkeleton, TrackPanelSkeleton } from './PageSkeleton';

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

  it('holds the place of the selected track\'s panel while the track list loads, so the list below does not move', () => {
    const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
    expect(renderToStaticMarkup(createElement(TrackPanelSkeleton))).toContain('track-panel-skeleton');
    expect(read('../../cues/CuePointsView.tsx')).toContain('if (!track && listLoading) return <TrackPanelSkeleton');
    expect(read('../../audition/AuditionView.tsx')).toContain('loading && !selectedTrack ? <TrackPanelSkeleton');
  });

  it('swaps pages in place: a fade with no sliding, and the old page leaves at once', () => {
    const app = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8');
    expect(app).toContain("exit: { opacity: 0, transition: { duration: 0 } }");
    const pages = app.slice(app.indexOf('<AnimatePresence mode="wait">'), app.indexOf('</AnimatePresence>'));
    expect(pages).toContain('{...PAGE_MOTION}');
    expect(pages).not.toMatch(/initial=\{\{ opacity: 0, [xy]:/);
  });

  it('shows Discovery\'s card placeholders instead of spinners', () => {
    const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
    expect(read('../../discovery/DiscoveryHomeFeed.tsx')).toContain('<PageSkeleton variant="feed"');
    expect(read('../../discovery/GenreBrowser.tsx')).toContain('<SkeletonChip');
  });
});
