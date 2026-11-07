import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  LIBRARY_OVERVIEW_WIDGETS, NO_HIDDEN_WIDGETS, parseHiddenWidgets, serializeHiddenWidgets, withWidgetVisibility,
} from '../../lib/dashboard/libraryOverviewWidgets';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const library = read('./LibraryView.tsx');

describe('Library overview groups you can show or hide', () => {
  it('are the five groups outlined in green: USB Import, Track Analysis, Top Genres, BPM Distribution and Key Profile', () => {
    expect(LIBRARY_OVERVIEW_WIDGETS.map((widget) => widget.label)).toEqual(['USB Import', 'Track Analysis', 'Top Genres', 'BPM Distribution', 'Key Profile']);
  });

  it('start out all shown, and a group added later is shown by default', () => {
    expect(NO_HIDDEN_WIDGETS.size).toBe(0);
    expect(parseHiddenWidgets(undefined).size).toBe(0);
    expect(parseHiddenWidgets(['topGenres', 'someFutureGroup', 42])).toEqual(new Set(['topGenres']));
  });

  it('save as a list in page order, and hiding then showing a group puts it back', () => {
    const hidden = withWidgetVisibility(withWidgetVisibility(NO_HIDDEN_WIDGETS, 'keyProfile', false), 'usbImport', false);
    expect(serializeHiddenWidgets(hidden)).toEqual(['usbImport', 'keyProfile']);
    expect(withWidgetVisibility(hidden, 'keyProfile', true)).toEqual(new Set(['usbImport']));
  });
});

describe('Library page', () => {
  it('no longer has the tab bar (Overview, Playlists, Recently Added, Tracks, Genres, Artists, Spotify, Analysis Incomplete)', () => {
    const imported = library.slice(library.indexOf('Scrollable tab content') - 400, library.indexOf('Scrollable tab content'));
    expect(imported).not.toContain('<LibraryTabBar');
    expect(library).not.toContain('<LibraryTabBar');
    expect(library).not.toContain("activeTab === 'playlists'");
    expect(library).not.toContain("activeTab === 'tracks'");
    expect(library).not.toContain("activeTab === 'genres'");
  });

  it('always shows the overview, and still reaches the incomplete analysis list from the Track Analysis card, with a way back', () => {
    expect(library).toContain("const isIncompleteView = activeTab === 'incomplete-analysis';");
    expect(library).toContain('{!isIncompleteView && (');
    expect(library).toContain('onShowIncompleteAnalysis={() => onActiveTabChange(\'incomplete-analysis\')}');
    expect(library).toContain("onClick={() => onActiveTabChange('overview')} data-testid=\"incomplete-back\"");
  });

  it('shows each group only when it is switched on, and the three insight cards share the row evenly', () => {
    for (const widget of ['topGenres', 'bpmDistribution', 'keyProfile']) expect(library).toContain(`!hiddenWidgets.has('${widget}')`);
    const ghost = read('./LibraryGhostHero.tsx');
    expect(ghost).toContain("!hiddenWidgets.has('usbImport')");
    expect(ghost).toContain("!hiddenWidgets.has('trackAnalysis')");
    expect(library).toContain("INSIGHT_COLUMNS[insightCount]");
    expect(library).toContain('{insightCount > 0 && (');
    const mobile = read('./LibraryHero.tsx');
    expect(mobile).toContain("hiddenWidgets?.has('usbImport')");
    expect(mobile).toContain("hiddenWidgets?.has('trackAnalysis')");
  });
});

describe('Personalization', () => {
  const widgets = (hidden: string[]) => ({ hidden: new Set(hidden), setVisible: vi.fn(), showAll: vi.fn(), saveFailed: false });

  it('has a Library overview group with a switch per group, on when the group is shown', async () => {
    const { DashboardWidgetsGroup } = await import('../profile/DashboardWidgetsGroup');
    const markup = renderToStaticMarkup(createElement(DashboardWidgetsGroup, { widgets: widgets(['topGenres']) as never }));
    expect(markup).toContain('Library overview');
    expect(markup.match(/data-testid="dashboard-widget-row"/g)).toHaveLength(5);
    expect(markup).toMatch(/aria-checked="false"[^>]*data-testid="dashboard-widget-toggle-topGenres"/);
    expect(markup).toMatch(/aria-checked="true"[^>]*data-testid="dashboard-widget-toggle-keyProfile"/);
    expect(markup).toContain('Show everything');
  });

  it('lays the switches out in two columns on wider screens, one on narrow ones', async () => {
    const { DashboardWidgetsGroup } = await import('../profile/DashboardWidgetsGroup');
    const markup = renderToStaticMarkup(createElement(DashboardWidgetsGroup, { widgets: widgets([]) as never }));
    expect(markup).toMatch(/data-testid="dashboard-widget-list"/);
    expect(markup).toContain('grid grid-cols-1');
    expect(markup).toContain('md:grid-cols-2');
    expect(markup).not.toContain('divide-y');
  });

  it('only offers "Show everything" when something is hidden, and says plainly when a choice could not be saved', async () => {
    const { DashboardWidgetsGroup } = await import('../profile/DashboardWidgetsGroup');
    expect(renderToStaticMarkup(createElement(DashboardWidgetsGroup, { widgets: widgets([]) as never }))).not.toContain('Show everything');
    const failed = renderToStaticMarkup(createElement(DashboardWidgetsGroup, { widgets: { ...widgets([]), saveFailed: true } as never }));
    expect(failed).toContain("couldn&#x27;t be saved to your account");
  });

  it('is in the Personalization tab of the profile, and saves to the account with a local copy', () => {
    const app = read('../../App.tsx');
    const personalization = app.slice(app.indexOf('Personalization tab ──'));
    expect(personalization.indexOf('<DashboardWidgetsGroup')).toBeGreaterThan(-1);
    expect(personalization.indexOf('<DashboardWidgetsGroup')).toBeLessThan(personalization.indexOf('Library tab ──'));
    expect(app).toContain('hiddenWidgets={libraryOverviewWidgets.hidden}');
    const hook = read('../../hooks/useLibraryOverviewWidgets.ts');
    expect(hook).toContain('localStorage.setItem');
    expect(hook).toContain('saveHiddenLibraryWidgets(userId, next)');
    expect(hook).toContain("'library.widgets.save_failed'");
    expect(hook).toContain("'library.widgets.load_failed'");
  });
});
