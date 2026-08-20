import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./CuePointsView.tsx', import.meta.url), 'utf8');

describe('Cue Points production editor wiring', () => {
  it('renders the canonical working cue set and wires manual add/move/delete/Discard into the production waveform panel', () => {
    expect(source).toContain('cues={workingCues}');
    expect(source).toContain('onContextMenu={handleWaveformContextMenu}');
    expect(source).toContain("onAddCue('hot', contextMenu.requestedMs)");
    expect(source).toContain("onAddCue('memory', contextMenu.requestedMs)");
    expect(source).toContain('onMoveCue(drag.cueId, requestedMs)');
    expect(source).toContain('onDeleteCue(contextMenu.cueId)');
    expect(source).toContain('onClick={onDiscard}');
    expect(source).toContain('workingCueSetsEqual(importedCueBaseline, workingCues)');
  });

  it('keeps selected-track loading scoped to explicit row selection instead of table filters', () => {
    expect(source).toContain('onClick={() => setSelectedTrack(track)}');
    expect(source).toContain('}, [selectedTrackId]);');
    expect(source).not.toContain('setSelectedTrack(filteredTracks[0])');
    expect(source).not.toMatch(/useEffect\([\s\S]{0,600}\[filteredTracks\]/);
  });

  it('guards cue/grid/phrase responses against a stale selected track', () => {
    expect(source.match(/isCurrentTrackResponse\(selectedTrackIdRef\.current, selectedTrackId\)/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
  });
});
