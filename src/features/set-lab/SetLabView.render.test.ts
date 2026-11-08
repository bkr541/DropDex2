import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BeatGridRow, CueLoadState } from '../../lib/queries/analysisData';
import type { TrackPreviewWaveform, WaveformLoadState } from '../../lib/queries/waveformValidation';
import type { RekordboxTrack } from '../../types';
import { SetLabEditDialog } from './SetLabEditDialog';
import { SetLabSaveSet } from './SetLabSaveSet';
import { SetLabTimeline } from './SetLabTimeline';
import { SetLabTrackTable } from './SetLabTrackBrowser';
import { SetLabView } from './SetLabView';
import type { SetLabPreview } from './useSetLabPreview';
import { cue, grid } from './sectionResolver.testFixtures';
import { createSetLabDraft, type SetLabBarCount, type SetLabFiveSlots, type SetLabPosition } from './session';
import { fiveSlots, populatedDraft, scope, slot } from './session.testFixtures';
import { layoutSetLabTimeline, setLabBeatMarkers, setLabCueMarkers, sliceSetLabClipWaveform } from './timelineGeometry';

const mocks = vi.hoisted(() => ({ timeline: vi.fn(), preview: vi.fn(), detail: vi.fn(), session: vi.fn(), transport: vi.fn() }));
vi.mock('./useSetLabTimelineData', () => ({ useSetLabTimelineData: mocks.timeline }));
vi.mock('./useSetLabSession', () => ({ useSetLabSession: mocks.session }));
vi.mock('./useSetLabPreview', () => ({ useSetLabPreview: mocks.transport }));
vi.mock('../../hooks/useTrackPreviewWaveforms', () => ({ useTrackPreviewWaveforms: mocks.preview }));
vi.mock('../../hooks/useDropLabDetailWaveform', () => ({ useDropLabDetailWaveform: mocks.detail }));
vi.mock('../../contexts/AudioPlayerContext', () => ({ useAudioPlayer: () => ({ status: 'idle', playIntent: false, toggleTrack: vi.fn() }) }));
vi.mock('../../contexts/UsbConnectionContext', () => ({ useUsbConnection: () => ({ status: 'disconnected' }) }));
vi.mock('../../hooks/useRekordboxTracks', () => ({ useLibraryStats: () => ({ stats: null }) }));
vi.mock('../../theme/ThemeProvider', () => ({ useTheme: () => ({ theme: 'dropdex' }) }));

function track(position: SetLabPosition): RekordboxTrack {
  return {
    id: `track-${position}`, import_id: scope.sourceImportId, rekordbox_content_id: String(position),
    title: `Record ${position}`, artist: 'Fixture Artist', album: null, remixer: null, genre: 'House', label: null,
    camelot_key: '8A', musical_key: null, normalized_key_name: null, key_tonic: null, key_mode: null,
    bpm: 120, duration_seconds: 55, rating: null, comments: null, file_path: null, file_format: null, date_added: null,
    created_at: '2024-01-01T00:00:00Z', master_db_id: null, master_content_id: null, analysis_data_file_path: null,
    analysed_bits: null, cue_update_count: null, analysis_data_update_count: null, information_update_count: null,
    analysis_reused_from_track_id: null, analysis_parse_status: null, analysis_parse_warnings: [],
  };
}

function clip<P extends SetLabPosition>(position: P, bars: SetLabBarCount, first: number, last: number, start: number, end: number) {
  const base = slot(position);
  return {
    ...base, locked: position === 2, barCount: bars,
    section: { ...base.section, startMs: start, endMs: end, startBeat: first, endBeatExclusive: last },
  };
}
const slots: SetLabFiveSlots = [
  slot(1), clip(2, 8, 33, 65, 16000, 28800), slot(3), clip(4, 4, 1, 17, 0, 8000), clip(5, 16, 1, 65, 0, 28800),
];
const tracks = new Map(slots.map(({ position }) => { const item = track(position); return [item.id, item]; }));
const beats = grid();
const gridRow: BeatGridRow = {
  id: 'grid', import_id: scope.sourceImportId, track_id: 'track-1', source_tag: 'PQTZ', beats,
  beat_count: beats.length, downbeat_count: 33, bar_count: 33, first_beat_ms: 0, first_downbeat_ms: 0,
  minimum_bpm: 120, maximum_bpm: 150, is_variable_tempo: true, parser_version: null,
};
const grids = new Map(slots.map(({ trackId }) => [trackId, { ...gridRow, track_id: trackId }]));
const cueRows = [cue('hot', 'hot', 2000), cue('memory', 'memory', 4000), cue('excluded', 'memory', 16000)];
const cues = new Map<string, CueLoadState>(slots.map(({ trackId }) => [trackId, { status: 'loaded-empty', trackId, cues: [] }]));
cues.set('track-1', { status: 'loaded-with-cues', trackId: 'track-1', cues: cueRows });

function waveform(trackId: string): TrackPreviewWaveform {
  const previewColumns = Array.from({ length: 55 }, (_, index) => ({ h: index % 31 + 1, i: 2 }));
  return {
    trackId, previewFormat: 'mono', previewColumnCount: previewColumns.length, previewColumns, previewColumnsValid: true,
    inferredFormat: 'mono', validationError: null, invalidReason: null, detailFormat: null, detailColumnCount: null,
    detailStorageBucket: null, detailStoragePath: null,
  };
}
function transport(status: SetLabPreview['status'] = 'idle', positionSeconds = 0): SetLabPreview {
  const snapshot = { status, positionSeconds, error: null };
  return {
    status, getSnapshot: () => snapshot, subscribe: () => () => undefined,
    play: vi.fn(), pause: vi.fn(), stopAndReset: vi.fn(),
  };
}
const renderTimeline = (selectedSlot: SetLabPosition = 2, playback = transport()) => renderToStaticMarkup(createElement(SetLabTimeline, {
  scope, slots, selectedSlot, busy: false, editDisabled: playback.status === 'playing', playback,
  onSelect: vi.fn(), onLock: vi.fn(), onBars: vi.fn(), onReroll: vi.fn(), onReposition: vi.fn(),
}));

beforeEach(() => {
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  mocks.transport.mockReturnValue(transport());
  mocks.timeline.mockReturnValue({ data: { status: 'ready', tracks, grids, cues, gridError: false }, retry: vi.fn() });
  mocks.preview.mockReturnValue({
    getState: (trackId: string): WaveformLoadState => ({ status: 'loaded', trackId, waveform: waveform(trackId) }),
    retry: vi.fn(),
  });
  mocks.detail.mockImplementation((importId: string | null, trackId: string | null) => ({
    detailState: importId && trackId ? { status: 'unavailable', trackId } : { status: 'idle', trackId: null },
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('Set Lab timeline geometry', () => {
  it('assigns relative widths and cumulative offsets from durations at different BPMs', () => {
    const layout = layoutSetLabTimeline(slots);
    expect(layout.clips.map(({ durationMs }) => durationMs)).toEqual([16000, 12800, 16000, 8000, 28800]);
    expect(layout.clips.map(({ offsetMs }) => offsetMs)).toEqual([0, 16000, 28800, 44800, 52800]);
    expect(layout.totalMs).toBe(81600);
    expect(layout.minWidthPx).toBeGreaterThanOrEqual(81600 / 8000 * 224);
    expect(layout.columns).toBe('minmax(0, 16000fr) minmax(0, 12800fr) minmax(0, 16000fr) minmax(0, 8000fr) minmax(0, 28800fr)');
  });

  it('places stored beat markers at their timestamps and excludes the end boundary', () => {
    const marks = setLabBeatMarkers(slots[4], gridRow);
    expect(marks?.ticks).toHaveLength(64);
    expect(marks?.ticks.find(({ key }) => key === 'beat-33')?.leftPercent).toBeCloseTo(16000 / 28800 * 100);
    expect(marks?.ticks[0]).toMatchObject({ leftPercent: 0, downbeat: true });
    expect(marks?.labels[0].text).toBe(1);
    expect(marks?.bpm).toBe('120.0–150.0');
    expect(setLabBeatMarkers({ ...slots[0], section: { ...slots[0].section, endMs: 15999 } }, gridRow)).toBeNull();
    expect(setLabBeatMarkers(slots[0], { ...gridRow, source_tag: 'PQT2' })).toBeNull();
  });

  it('clips imported cue markers and real waveform columns to the same window', () => {
    expect(setLabCueMarkers(cueRows, slots[0].section)).toMatchObject([
      { id: 'hot', hot: true, label: 'A', leftPercent: 12.5 },
      { id: 'memory', hot: false, label: '1', leftPercent: 25 },
    ]);
    const state = { status: 'loaded', trackId: 'track-2', waveform: waveform('track-2') } as const;
    const sliced = sliceSetLabClipWaveform(state, slots[1].section, 55000);
    expect(sliced).toMatchObject({ status: 'loaded', waveform: { previewColumns: state.waveform.previewColumns.slice(16, 29) } });
    expect(sliceSetLabClipWaveform(state, slots[1].section, 27000)).toMatchObject({ status: 'unavailable' });
  });
});

describe('Set Lab component rendering', () => {
  it('renders five ordered clips, shared waveforms, cue and bar lanes, and the selected slot', () => {
    const markup = renderTimeline();
    expect([...markup.matchAll(/data-set-slot="(\d+)"/g)].map((match) => match[1])).toEqual(['1', '2', '3', '4', '5']);
    expect(markup).toContain('data-set-slot="2" data-selected="true" data-clip-duration-ms="12800" data-clip-offset-ms="16000"');
    expect(renderTimeline(4)).toContain('data-set-slot="4" data-selected="true"');
    expect(markup.match(/data-waveform-status="loaded"/g)).toHaveLength(5);
    expect(markup).toContain('grid-template-columns:minmax(0, 16000fr) minmax(0, 12800fr)');
    expect(markup).toContain('data-cue-family="hot"');
    expect(markup).toContain('data-cue-family="memory"');
    expect(markup).toContain('timeline-beat-tick--bar');
    expect(markup).toContain('150.0 BPM');
    expect(markup).toContain('Preview waveform · Detail unavailable');
    expect(markup).toContain('Scrollable five-slot timeline');
  });

  it('offers 4, 8 and 16 bars per clip, lock and reroll controls, and play and stop', () => {
    const markup = renderTimeline();
    for (const bars of [4, 8, 16]) expect(markup.match(new RegExp(`>${bars} bars</option>`, 'g'))).toHaveLength(5);
    expect(markup).toMatch(/aria-label="Lock slot 2"[^>]*aria-pressed="true"/);
    expect(markup).toContain('aria-label="Reroll slot 2"');
    expect(markup).toContain('aria-label="Play Set"');
    expect(markup).not.toMatch(/aria-label="Play Set"[^>]*disabled/);
    expect(markup).toMatch(/aria-label="Stop Set"[^>]*disabled/);
  });

  it('uses one playhead while keeping selection and bar edits available during playback', () => {
    const markup = renderTimeline(3, transport('playing', 40.8));
    expect(markup).toContain('aria-label="Pause Set"');
    expect(markup.match(/data-testid="set-lab-playhead"/g)).toHaveLength(1);
    expect(markup).toContain('left:clamp(1px, 50%, calc(100% - 1px))');
    expect(markup).toContain('40.8 / 81.6 s');
    expect(markup).not.toMatch(/aria-label="Bars for slot 3"[^>]*disabled/);
    expect(markup).not.toMatch(/aria-label="Select waveform for slot 3"[^>]*disabled/);
    expect(markup.match(/>Reposition Track<\/button>/g)).toHaveLength(1);
    expect(markup).not.toMatch(/<button[^>]*disabled[^>]*>Reposition Track<\/button>/);
  });

  it('keeps the timeline intact and explains loading and unavailable analysis', () => {
    mocks.timeline.mockReturnValueOnce({ data: { status: 'loading' }, retry: vi.fn() });
    expect(renderTimeline()).toContain('Loading beat grid…');
    mocks.timeline.mockReturnValueOnce({ data: { status: 'error', message: 'Analysis request failed' }, retry: vi.fn() });
    const markup = renderTimeline();
    expect(markup).toContain('Analysis request failed');
    expect(markup).toContain('Retry analysis');
    expect(markup.match(/data-waveform-status="unavailable"/g)).toHaveLength(5);
    expect(markup).toMatch(/aria-label="Bars for slot 2"[^>]*disabled/);
  });

  it('renders row selection independently of the swap target and explains disabled actions', () => {
    const records = [...tracks.values()].slice(0, 2);
    const selected = renderToStaticMarkup(createElement(SetLabTrackTable, {
      tracks: records, draft: populatedDraft(), selectedId: 'track-2', onSelect: vi.fn(), context: null, busy: false, onSwap: vi.fn(),
    }));
    expect(selected).toContain('Swap target is slot 3');
    expect(selected).toContain('Audio and section length are checked');
    expect(selected).toContain('aria-selected="true"');
    expect(selected).toContain('tabindex="0"');
    expect(selected).toContain('Fixture Artist');
    expect(selected).toMatch(/aria-label="Swap Record 2 into slot 3"[^>]*disabled/);
    const empty = renderToStaticMarkup(createElement(SetLabTrackTable, {
      tracks: records, draft: createSetLabDraft(scope), selectedId: null, onSelect: vi.fn(), context: null, busy: false, onSwap: vi.fn(),
    }));
    expect(empty).toContain('Select a slot in a generated set');
  });

  it('offers a direct row action for unused tracks and a playing-only confirmation with Cancel and Swap', () => {
    const candidate = { ...track(2), id: 'other', rekordbox_content_id: 'other' };
    const table = renderToStaticMarkup(createElement(SetLabTrackTable, {
      tracks: [candidate], draft: populatedDraft(), selectedId: null, context: null, busy: false,
      onSelect: vi.fn(), onSwap: vi.fn(),
    }));
    expect(table).toContain('Swap Record 2 into slot 3');
    expect(table).not.toMatch(/aria-label="Swap Record 2 into slot 3"[^>]*disabled/);
    const dialog = renderToStaticMarkup(createElement(SetLabEditDialog, {
      title: 'Swap into slot 3?', confirmLabel: 'Swap', details: 'Kept Drop 2.',
      onCancel: vi.fn(), onConfirm: vi.fn(),
    }));
    expect(dialog).toContain('aria-modal="true"');
    expect(dialog).toContain('will stop playback and reset the preview');
    expect(dialog).toContain('>Cancel</button>');
    expect(dialog).toContain('>Swap</button>');
  });

  it('distinguishes restoring, empty and failed drafts and enables Save Set for a complete draft', () => {
    const view = () => renderToStaticMarkup(createElement(SetLabView, { scope, importDeviceName: null, onReturnToLibrary: vi.fn() }));
    const session = { dispatch: vi.fn(), retryRestore: vi.fn(), retrySave: vi.fn(), saveStatus: { kind: 'idle' } };
    mocks.session.mockReturnValueOnce({ ...session, hydration: { kind: 'loading' } });
    expect(view()).toContain('Restoring Set Lab draft…');
    mocks.session.mockReturnValueOnce({ ...session, hydration: { kind: 'error', message: 'Could not restore the draft' } });
    expect(view()).toContain('Could not restore the draft');
    mocks.session.mockReturnValueOnce({ ...session, hydration: { kind: 'ready', state: { draft: createSetLabDraft(scope), previous: null } } });
    const markup = view();
    expect(markup).toContain('Generate Set');
    expect(markup).toContain('Saved Sets');
    expect(markup).toContain('Apply filters');
    expect(markup).toContain('Set Lab needs five unique tracks');
    expect(markup).toContain('Search library tracks');
    expect(markup).toContain('aria-label="Similar Only"');
    expect(markup).not.toContain('data-set-slot');
    expect(markup).toMatch(/<button[^>]*disabled[^>]*title="Generate a complete set before saving"/);
    const working = { ...populatedDraft(), loadedFrom: { id: 'saved-1', name: 'Friday' } };
    mocks.session.mockReturnValueOnce({ ...session, hydration: { kind: 'ready', state: { draft: working, previous: null } },
      saveStatus: { kind: 'conflict' } });
    const conflicted = view();
    expect(conflicted).toContain('Working copy of “Friday”');
    expect(conflicted).toContain('Recover local draft');
    expect(conflicted).toContain('Keep server draft');
    const ready = renderToStaticMarkup(createElement(SetLabSaveSet, { draft: populatedDraft(), disabled: false }));
    expect(ready).toContain('Save Set');
    expect(ready).not.toContain('disabled');
  });
});
