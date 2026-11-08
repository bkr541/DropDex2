import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchTrackPhrases, type BeatGridRow } from '../../lib/queries/analysisData';
import type { RekordboxTrack } from '../../types';
import { probeSetLabAudio } from './audioProbe';
import { decodeSetLabSource } from './prepareSetLabAudio';
import { loadSetLabReposition, prepareSetLabReposition, setLabRepositionViewport, type SetLabRepositionTarget } from './repositionSetLab';
import { grid, phrase } from './sectionResolver.testFixtures';
import { listSetLabSections, nearestSetLabWindow } from './sectionResolver';
import { fiveSlots, populatedDraft, scope } from './session.testFixtures';
import { reduceSetLabSession, type SetLabState } from './sessionReducer';
import { commitSetLabEdit } from './setLabEditCommit';
import type { SetLabPreviewSnapshot } from './setLabPreviewController';
import type { SetLabDispatch } from './useSetLabSession';

vi.mock('../../lib/queries/analysisData');
vi.mock('./audioProbe');
vi.mock('./prepareSetLabAudio', async (importOriginal) => ({
  ...await importOriginal<typeof import('./prepareSetLabAudio')>(),
  decodeSetLabSource: vi.fn(),
}));

const beats = grid();
const phrases = [phrase(1, 'intro', 1, 33), phrase(2, 'drop', 33, 129)];
const sectionInput = { durationMs: 55_000, beats, phrases };
const target = (): SetLabRepositionTarget => ({
  base: populatedDraft(), slot: fiveSlots[0], cues: [], importDeviceName: 'DECK',
  track: {
    id: 'track-1', import_id: scope.sourceImportId, rekordbox_content_id: '1',
    title: 'Fixture Track', duration_seconds: 55, file_path: '/Contents/track.wav',
  } as RekordboxTrack,
  grid: { track_id: 'track-1', import_id: scope.sourceImportId, source_tag: 'PQTZ', beats } as BeatGridRow,
});

const localFile = new File(['fixture'], 'track.wav');
const local = { kind: 'file', file: localFile } as const;
const cloud = { kind: 'url', url: 'https://preview.example.invalid/track.wav' } as const;
const sources = {
  usb: {
    status: 'connected' as const, volumeName: 'DECK',
    resolveTrackSource: vi.fn(async () => ({ ok: true, source: local }) as const),
  },
  fetchCloudPreview: vi.fn(async (): Promise<{ url: string; durationMs: number } | null> => null),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchTrackPhrases).mockResolvedValue(phrases);
  vi.mocked(probeSetLabAudio).mockResolvedValue(55_000);
  vi.mocked(decodeSetLabSource).mockResolvedValue({ length: 55_000, sampleRate: 1000 } as AudioBuffer);
  sources.fetchCloudPreview.mockResolvedValue(null);
  vi.stubGlobal('OfflineAudioContext', class OfflineAudioContext {});
});
afterEach(() => vi.unstubAllGlobals());

describe('Set Lab reposition windows', () => {
  it.each([4, 8, 16] as const)('snaps a %i-bar frame to actual downbeats and clamps to complete windows', (bars) => {
    const resolved = listSetLabSections({ ...sectionInput, mediaDurationMs: 51_000 }, bars);
    if (resolved.ok === false) throw new Error(resolved.explanation);
    const start = nearestSetLabWindow(resolved.windows, -9000)!;
    const end = nearestSetLabWindow(resolved.windows, 60_000)!;
    expect(start.section.startBeat).toBe(1);
    expect(start.section.startMs).toBe(0);
    expect(end.section.endMs).toBe(49_600);
    expect(end.endDownbeat.bar - end.startDownbeat.bar).toBe(bars);
    expect(end.section.endBeatExclusive - end.section.startBeat).toBe(bars * 4);
    expect(end.section.endMs - end.section.startMs).toBe(bars * 1600);
    expect(nearestSetLabWindow(resolved.windows, 3000)?.section.startMs).toBe(2000);
    expect(nearestSetLabWindow(resolved.windows, 3001)?.section.startMs).toBe(4000);
  });

  it('scales the time ruler around a fixed visual frame through a tempo and phrase change', () => {
    const result = listSetLabSections(sectionInput, 8);
    if (result.ok === false) throw new Error(result.explanation);
    const mixed = nearestSetLabWindow(result.windows, 8000)!;
    expect(mixed).toMatchObject({ quality: 'mixed', section: { startMs: 8000, endMs: 22_400, phraseType: null } });
    const viewport = setLabRepositionViewport(mixed.section, 55_000);
    expect(viewport.spanMs).toBe(36_000);
    expect(viewport.visible.startMs).toBe(0);
    expect(viewport.percent(8000)).toBeCloseTo(30);
    expect(viewport.percent(16_000)).toBeCloseTo(52.222);
    expect(viewport.percent(22_400)).toBeCloseTo(70);
    const ending = setLabRepositionViewport(result.windows.at(-1)!.section, 55_000);
    expect(ending.visible.endMs).toBe(55_000);
    expect(ending.percent(result.windows.at(-1)!.section.startMs)).toBeCloseTo(30);
  });

  it('loads one track without decoding and validates the exact proposed range on Save', async () => {
    const input = target();
    const { signal } = new AbortController();
    const loaded = await loadSetLabReposition(input, sources, signal);
    expect(probeSetLabAudio).toHaveBeenCalledWith(local, signal);
    expect(decodeSetLabSource).not.toHaveBeenCalled();
    const proposed = nearestSetLabWindow(loaded.windows, 8000)!;
    const action = await prepareSetLabReposition(input, loaded, proposed, sources, signal);
    expect(decodeSetLabSource).toHaveBeenCalledWith(expect.anything(), local, signal, { requiredEndMs: 22_400 });
    expect(action).toMatchObject({ type: 'reposition', position: 1, section: { startMs: 8000, endMs: 22_400, phraseType: null } });
    expect(action.selection?.reason).toContain('crosses a phrase boundary');
    expect(input.base.slots).toEqual(fiveSlots);
  });

  it('includes later windows when verified cloud audio extends past the local file', async () => {
    const input = target();
    const { signal } = new AbortController();
    sources.fetchCloudPreview.mockResolvedValue({ url: cloud.url, durationMs: 55_000 });
    vi.mocked(probeSetLabAudio).mockResolvedValueOnce(20_000);
    const loaded = await loadSetLabReposition(input, sources, signal);
    expect(loaded.windows.at(-1)?.section.endMs).toBe(54_400);
    expect(probeSetLabAudio).toHaveBeenLastCalledWith(cloud, signal);
  });

  it('uses counted downbeats when the imported bars have three beats', async () => {
    const input = target();
    const { signal } = new AbortController();
    const threeBeatGrid = Array.from({ length: 61 }, (_, i) => ({
      seq: i + 1, srcIdx: i, beatInBar: i % 3 + 1, bar: Math.floor(i / 3) + 1,
      ms: i * 500, bpm: 120, isDownbeat: i % 3 === 0,
    }));
    input.grid = { ...input.grid, beats: threeBeatGrid };
    vi.mocked(fetchTrackPhrases).mockResolvedValueOnce([]);
    const loaded = await loadSetLabReposition(input, sources, signal);
    const proposed = loaded.windows[1];
    const action = await prepareSetLabReposition(input, loaded, proposed, sources, signal);
    expect(proposed.endDownbeat.bar - proposed.startDownbeat.bar).toBe(8);
    expect(action.section.endBeatExclusive - action.section.startBeat).toBe(24);
    expect(reduceSetLabSession({ draft: input.base, previous: null }, action).draft.slots[0]?.barCount).toBe(8);
    await expect(prepareSetLabReposition(input, loaded, { ...proposed, barCount: 4 }, sources, signal))
      .rejects.toThrow('Choose a complete section');
  });

  it('tries authorized cloud if the local file no longer covers the exact window', async () => {
    const input = target();
    const { signal } = new AbortController();
    const loaded = await loadSetLabReposition(input, sources, signal);
    sources.fetchCloudPreview.mockResolvedValue({ url: cloud.url, durationMs: 55_000 });
    vi.mocked(decodeSetLabSource).mockResolvedValueOnce({ length: 20_000, sampleRate: 1000 } as AudioBuffer);
    const last = loaded.windows.at(-1)!;
    await expect(prepareSetLabReposition(input, loaded, last, sources, signal)).resolves.toMatchObject({ section: last.section });
    expect(sources.fetchCloudPreview).toHaveBeenCalledWith('c:1', { userId: scope.userId, signal });
    expect(decodeSetLabSource).toHaveBeenLastCalledWith(expect.anything(), cloud, signal, { requiredEndMs: last.section.endMs });
  });

  it('keeps the draft untouched if audio disappears or the request is superseded', async () => {
    const input = target();
    const controller = new AbortController();
    const loaded = await loadSetLabReposition(input, sources, controller.signal);
    const proposed = loaded.windows.at(-1)!;
    vi.mocked(decodeSetLabSource).mockRejectedValueOnce(new Error('The device was unplugged.'));
    await expect(prepareSetLabReposition(input, loaded, proposed, sources, controller.signal))
      .rejects.toThrow('The device was unplugged.');
    vi.mocked(decodeSetLabSource).mockImplementationOnce(async () => {
      controller.abort();
      return { length: 55_000, sampleRate: 1000 } as AudioBuffer;
    });
    await expect(prepareSetLabReposition(input, loaded, proposed, sources, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(input.base.slots).toEqual(fiveSlots);
  });

  it('discards an aborted analysis response before resolving any audio', async () => {
    const controller = new AbortController();
    vi.mocked(fetchTrackPhrases).mockImplementationOnce(async () => {
      controller.abort();
      return phrases;
    });
    await expect(loadSetLabReposition(target(), sources, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(sources.usb.resolveTrackSource).not.toHaveBeenCalled();
  });
});

describe('Set Lab reposition transaction', () => {
  it.each(['playing', 'paused'] as const)('saves from %s with the right confirmation and reset behavior, then supports Undo', (status) => {
    const original = reduceSetLabSession({ draft: populatedDraft(), previous: null }, { type: 'set-locked', position: 1, locked: true });
    let state: SetLabState = original;
    let snapshot: SetLabPreviewSnapshot = { status, positionSeconds: 7, error: null };
    const stopAndReset = vi.fn(() => { snapshot = { status: 'idle', positionSeconds: 0, error: null }; });
    const preview = { getSnapshot: () => snapshot, stopAndReset };
    const dispatch: SetLabDispatch = vi.fn((action, beforeCommit) => {
      const next = reduceSetLabSession(state, action);
      beforeCommit?.();
      state = next;
      return true;
    });
    const action = {
      type: 'reposition', base: original.draft, position: 1,
      section: { startMs: 8000, endMs: 22_400, startBeat: 17, endBeatExclusive: 49, phraseType: null, phraseOccurrence: null },
    } as const;
    if (status === 'playing') {
      expect(commitSetLabEdit(action, preview, dispatch)).toBe('confirm');
      // Declining the pending action never dispatches or touches the clock.
      expect(state).toBe(original);
      expect(dispatch).not.toHaveBeenCalled();
      expect(snapshot).toMatchObject({ status: 'playing', positionSeconds: 7 });
      expect(commitSetLabEdit(action, preview, dispatch, true)).toBe('committed');
    } else {
      expect(commitSetLabEdit(action, preview, dispatch)).toBe('committed');
    }
    expect(stopAndReset).toHaveBeenCalledTimes(1);
    expect(snapshot).toMatchObject({ status: 'idle', positionSeconds: 0 });
    expect(state.draft.slots[0]).toEqual({ ...original.draft.slots[0], manuallyPositioned: true, section: action.section });
    expect(state.draft.slots.slice(1)).toEqual(original.draft.slots.slice(1));
    const selected = reduceSetLabSession(state, { type: 'select', position: 5 });
    const undone = reduceSetLabSession(selected, { type: 'undo', repositionOnly: true });
    expect(undone.draft.slots).toEqual(original.draft.slots);
    expect(undone.draft.selectedSlot).toBe(5);
    expect(() => reduceSetLabSession(state, action)).toThrow('set changed');
  });
});
