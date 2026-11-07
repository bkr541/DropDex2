import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CloudSyncIcon } from './CloudSyncIcon';

const view = readFileSync(new URL('../cues/CuePointsView.tsx', import.meta.url), 'utf8');

describe('cloud icon on the Library page track list', () => {
  it('is lit for a synced track and the same icon greyed out for one that is not', () => {
    const synced = renderToStaticMarkup(createElement(CloudSyncIcon, { synced: true }));
    const notSynced = renderToStaticMarkup(createElement(CloudSyncIcon, { synced: false }));
    expect(synced).toContain('aria-label="Synced to DropDex Cloud"');
    expect(synced).toContain('text-emerald-400');
    expect(synced).not.toContain('opacity-30');
    expect(notSynced).toContain('aria-label="Not synced to DropDex Cloud"');
    expect(notSynced).toContain('text-muted-foreground opacity-30');
    expect(notSynced).not.toContain('text-emerald-400');
    // Same icon in both states: same drawing.
    expect(synced.match(/<path[^>]*d="[^"]*"/)?.[0]).toBe(notSynced.match(/<path[^>]*d="[^"]*"/)?.[0]);
  });

  it('says when the cloud status could not be read, instead of claiming "not synced"', () => {
    expect(renderToStaticMarkup(createElement(CloudSyncIcon, { synced: false, unknown: true }))).toContain('DropDex Cloud status unavailable');
  });

  it('is a Cloud column in the Library page track table only, after Duration', () => {
    expect(view).toContain("...(artistLibrary ? [{\n      id: 'cloud', label: 'Cloud'");
    expect(view.indexOf("id: 'duration'")).toBeLessThan(view.indexOf("id: 'cloud'"));
    expect(view).toContain("cellProps: () => ({ 'data-testid': 'cloud-cell' })");
    expect(view).toContain('synced={cloudSynced.keys.has(trackIdentityKey(track))}');
    expect(view).toContain('useSyncedPreviewKeys(artistLibrary)');
  });
});
