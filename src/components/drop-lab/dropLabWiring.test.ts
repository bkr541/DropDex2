import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
const view = read('./DropLabView.tsx');
const rotation = read('./CandidateRotation.tsx');
const waveform = read('./DropLabWaveform.tsx');
const controls = read('./DropLabControls.tsx');
const header = read('./DropLabTrackHeader.tsx');

describe('Drop Lab loads tracks by drag and by right-click', () => {
  it('rows can be dragged and carry the track', () => {
    expect(rotation).toContain('draggable: true');
    expect(rotation).toContain('DROP_LAB_TRACK_MIME');
    expect(rotation).toContain('onContextMenu');
  });

  it('the right-click menu offers Load As Build and Load As Drop', () => {
    expect(rotation).toContain('<ContextMenu');
    expect(rotation).toContain("label: 'Load As Build'");
    expect(rotation).toContain("label: 'Load As Drop'");
    expect(rotation).toContain("onLoadTrack(menu.trackId, 'build', 'menu')");
    expect(rotation).toContain("onLoadTrack(menu.trackId, 'drop', 'menu')");
  });

  it('dropping on the timeline picks the side from where the pointer lands', () => {
    expect(waveform).toContain('onDrop={handleDrop}');
    expect(waveform).toContain('dropSideForPointer');
    expect(view).toContain("onLoadTrack={(trackId, side) => handleLoadTrack(trackId, side, 'drag')}");
  });

  it('every way of loading goes through one handler that logs under the droplab prefix', () => {
    expect(view).toContain('resolveDropLabLoad(');
    expect(view).toContain('logger.info(`droplab.load.${side}`');
    expect(view).toContain('onLoadTrack={handleLoadTrack}');
  });

  it('has no radio circle on the candidate rows', () => {
    expect(rotation).not.toContain('CheckmarkFilled size={16}');
    expect(rotation).not.toContain('border-white/25');
  });
});

describe('Drop Lab waveform zoom', () => {
  it('uses the same zoom and pan hook as Cue Points, with the shared hover buttons', () => {
    expect(waveform).toContain('useTimelineZoom(');
    expect(waveform).toContain('<WaveformZoomControls');
    expect(waveform).toContain('waveformRef={zoom.containerRef}');
    expect(read('../cues/CuePointsView.tsx')).toContain('useTimelineZoom(durationMs)');
    expect(read('../../hooks/useTimelineZoom.ts')).toContain("addEventListener('wheel'");
  });

  it('resets to fully zoomed out when the pair of tracks or the length changes', () => {
    expect(waveform).toContain('resetZoom(); }, [resetZoom, barCount, sourceTrackId, candidateTrackId]');
  });

  it('no longer draws the cue marker or the First and Then captions', () => {
    expect(waveform).not.toContain('CrossTab');
    expect(waveform).not.toContain('play the selected track');
    expect(waveform).not.toContain('swap into the candidate drop');
    expect(controls).not.toContain('Transition transport');
  });
});

describe('Drop Lab uses the shared Cue Points components', () => {
  it('header, timeline, dock, table and menus come from the shared modules', () => {
    expect(header).toContain('<TrackIdentity');
    expect(waveform).toContain('<TrackTimeline');
    expect(waveform).not.toContain('<RekordboxPreviewWaveform');
    expect(controls).toContain('<AudioDock');
    expect(controls).toContain('<PlaybackSeekBar');
    expect(controls).toContain('<MediaTransportControlGroup');
    expect(rotation).toContain('<RecordTrackListing');
    expect(rotation).toContain('getActions={(track)');
    expect(view).toContain('<ToolbarIconGroup');
  });

  it('no longer draws its own waveform, grid, icon buttons or tab style', () => {
    expect(waveform).not.toContain('getContext');
    expect(waveform).not.toContain('<canvas');
    expect(waveform).not.toContain('<path d={grid');
    expect(view).not.toContain('HeaderIconButton');
    expect(controls).not.toContain('variant="filter"');
  });

  it('takes the build and drop colors from the shared section colors, not hardcoded values', () => {
    expect(waveform).toContain("waveformSectionInk('Build')");
    expect(waveform).toContain("waveformSectionInk('Drop')");
    expect(waveform).not.toContain('#ff8a1f');
    expect(waveform).not.toContain('#ff5a4f');
  });
});
