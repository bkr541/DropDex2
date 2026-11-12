import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const view = readFileSync(new URL('./ArtistLibraryView.tsx', import.meta.url), 'utf8');
const cues = readFileSync(new URL('../cues/CuePointsView.tsx', import.meta.url), 'utf8');

describe('Artist Library holds the track panel space while loading', () => {
  it('shows the track panel skeleton until a track is selected, so the tabs and list do not jump', () => {
    expect(view).toContain('!selectedTrack && trackPanelPending && <TrackPanelSkeleton');
    expect(view).toContain('onTrackPanelPendingChange={setTrackPanelPending}');
    // The skeleton sits above the tab bar, where the real panel is.
    expect(view.indexOf('<TrackPanelSkeleton')).toBeLessThan(view.indexOf('<LibraryTabBar'));
  });

  it('stays pending while the list loads and in the gap before the first track is selected', () => {
    expect(cues).toContain('activeSourceLoading || (orderedVisibleTracks.length > 0 && !selectedTrack)');
  });
});
