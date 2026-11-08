import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchTrackBeatGrid, fetchTrackBeatGrids, fetchTrackCues, fetchTrackPhrases, type BeatGridRow } from '../../lib/queries/analysisData';
import { fetchLibraryTracksPage } from '../../lib/queries/rekordbox';
import type { RekordboxTrack } from '../../types';
import type { SetLabRecommendation } from './candidateProvider';
import { prepareSetLabSwap } from './prepareSetLabSwap';
import { decodeSetLabSource } from './prepareSetLabAudio';
import { commitSetLabEdit } from './setLabEditCommit';
import { grid, phrase } from './sectionResolver.testFixtures';
import type { SetLabDraft, SetLabPosition } from './session';
import { fiveSlots, populatedDraft, scope } from './session.testFixtures';
import { reduceSetLabSession, type SetLabAction, type SetLabState } from './sessionReducer';
import { loadSimilarSetLabSwapIds, rankSetLabSwapCandidate, swapContextKey, swapUnavailableReason, type SetLabSwapContext } from './swapCandidates';
import type { SetLabPreviewSnapshot } from './setLabPreviewController';
import type { SetLabDispatch } from './useSetLabSession';

vi.mock('../../lib/queries/analysisData');
vi.mock('../../lib/queries/rekordbox');
vi.mock('./prepareSetLabAudio', async (importOriginal) => ({
  ...await importOriginal<typeof import('./prepareSetLabAudio')>(),
  decodeSetLabSource: vi.fn(),
}));

function row(id: number, changes: Partial<RekordboxTrack> = {}): RekordboxTrack {
  return {
    id: `track-${id}`, import_id: scope.sourceImportId, rekordbox_content_id: String(id),
    title: `Record ${id}`, artist: null, album: null, remixer: null, genre: 'House', label: null,
    camelot_key: '8A', musical_key: null, normalized_key_name: null, key_tonic: null, key_mode: null,
    bpm: 120, duration_seconds: 55, rating: null, comments: null, file_path: `/Contents/${id}.wav`,
    file_format: 'wav', date_added: null, created_at: '2024-01-01T00:00:00Z', master_db_id: null, master_content_id: null,
    analysis_data_file_path: null, analysed_bits: null, cue_update_count: null, analysis_data_update_count: null,
    information_update_count: null, analysis_reused_from_track_id: null, analysis_parse_status: null, analysis_parse_warnings: [],
    ...changes,
  };
}

function withSlot(position: SetLabPosition, draft = populatedDraft()) {
  return reduceSetLabSession({ draft, previous: null }, { type: 'select', position }).draft;
}

function scoring(draft: SetLabDraft): SetLabSwapContext {
  const records = [row(1), row(2), row(3), row(4, { camelot_key: '2B', bpm: 170 }), row(5, { camelot_key: '2B', bpm: 170 })];
  return {
    key: swapContextKey(draft)!,
    tracks: new Map(records.map((track) => [track.id, track])),
    recommendations: new Map<string, ReadonlyMap<string, SetLabRecommendation>>([
      ['track-3', new Map([['track-8', { direction: 'outgoing', rating: 3, createdAt: null }]])],
      ['track-4', new Map([['track-9', { direction: 'incoming', rating: 3, createdAt: null }]])],
    ]),
    partial: false,
  };
}

function targetGrid(id: string): BeatGridRow {
  const beats = grid();
  return {
    id: `grid-${id}`, import_id: scope.sourceImportId, track_id: id, source_tag: 'PQTZ', beats,
    beat_count: beats.length, downbeat_count: 33, bar_count: 33, first_beat_ms: 0, first_downbeat_ms: 0,
    minimum_bpm: 120, maximum_bpm: 150, is_variable_tempo: true, parser_version: null,
  };
}

const usb = {
  status: 'connected' as const, volumeName: 'DECK',
  resolveTrackSource: vi.fn(async () => ({ ok: true, source: { kind: 'file', file: new File(['audio'], 'clip.wav') } }) as const),
};
const fetchCloudPreview = vi.fn(async () => null);
const phases = (id: string, labels = ['drop', 'drop']) => [
  { ...phrase(0, labels[0], 1, 33), track_id: id },
  { ...phrase(1, labels[1], 33, 129), track_id: id },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchTrackBeatGrid).mockImplementation(async (id) => targetGrid(id));
  vi.mocked(fetchTrackBeatGrids).mockImplementation(async (ids) => new Map(ids.map((id) => [id, targetGrid(id)])));
  vi.mocked(fetchTrackPhrases).mockImplementation(async (id) => phases(id));
  vi.mocked(fetchTrackCues).mockResolvedValue([]);
  vi.mocked(decodeSetLabSource).mockResolvedValue({ length: 55_000, sampleRate: 1000 } as AudioBuffer);
  vi.stubGlobal('OfflineAudioContext', class OfflineAudioContext {});
});

afterEach(() => vi.unstubAllGlobals());

describe('Set Lab swap ranking', () => {
  it.each([[1, [2]], [2, [1, 3]], [3, [2, 4]], [4, [3, 5]], [5, [4]]] as const)(
    'scores the adjacent slots for position %i', (position, neighbors) => {
      const draft = withSlot(position);
      const rank = rankSetLabSwapCandidate(draft, scoring(draft), row(6));
      expect(rank?.reasons.map((reason) => Number(reason.match(/^Slot (\d)/)?.[1]))).toEqual(neighbors);
    },
  );

  it('ranks a candidate with evidence on both sides above a one-sided match', () => {
    const draft = populatedDraft();
    const context = scoring(draft);
    const oneSide = rankSetLabSwapCandidate(draft, context, row(6));
    const both = rankSetLabSwapCandidate(draft, context, row(9));
    expect(oneSide?.caution).toBe(true);
    // Slot 4 has a Rekordbox edge to 9. Give 9 a closer tempo there as well.
    const adjusted = { ...context, tracks: new Map(context.tracks).set('track-4', row(4, { camelot_key: '2B', bpm: 122 })) };
    expect(rankSetLabSwapCandidate(draft, adjusted, row(9))?.score)
      .toBeGreaterThan(rankSetLabSwapCandidate(draft, adjusted, row(6))?.score ?? 0);
    expect(both?.reasons[1]).toContain('Rekordbox match');
  });

  it('filters by the current track’s Similar Vibes, keeps search and genre across pages, and excludes occupied identities', async () => {
    const draft = populatedDraft();
    const signal = new AbortController().signal;
    const page = (offset: number, items: RekordboxTrack[]) => ({ offset, items, total: 5, limit: 500, hasMore: offset + items.length < 5 });
    vi.mocked(fetchLibraryTracksPage)
      .mockResolvedValueOnce(page(0, [row(6), row(7, { bpm: 170, camelot_key: '2B' }), row(8, { bpm: null, camelot_key: null })]))
      .mockResolvedValueOnce(page(3, [row(3), row(10, { rekordbox_content_id: '2' })]));
    const filters = { search: 'record', genre: 'House' };
    const ranked = await loadSimilarSetLabSwapIds(draft, scoring(draft), filters, signal);
    expect([...ranked].sort()).toEqual(['track-6', 'track-8']);
    expect(fetchLibraryTracksPage).toHaveBeenNthCalledWith(2, scope.sourceImportId, 3, 500, filters, signal);
    expect(swapUnavailableReason(draft, row(10, { rekordbox_content_id: '2' }))).toContain('slot 2');
  });
});

describe('Set Lab swap preparation', () => {
  it.each([4, 8, 16] as const)('preserves Drop 2, %i bars, the lock, and all other sections', async (barCount) => {
    const original = populatedDraft();
    const changed = [
      fiveSlots[0], fiveSlots[1],
      { ...fiveSlots[2], barCount, locked: true, section: { ...fiveSlots[2].section, startMs: 2200 } },
      fiveSlots[3], fiveSlots[4],
    ] as const;
    const draft = { ...original, slots: changed, selectedSlot: 3, generationSeed: 'fixture' } as const;
    const context = scoring(draft);
    const result = await prepareSetLabSwap({ draft, track: row(6), context, importDeviceName: null, signal: new AbortController().signal }, {
      usb, fetchCloudPreview,
    });
    expect(decodeSetLabSource).toHaveBeenCalledOnce();
    const next = reduceSetLabSession({ draft, previous: null }, result.action);
    expect(next.draft.slots[2]).toMatchObject({
      position: 3, trackId: 'track-6', locked: true, barCount,
      section: { startMs: 16_000, phraseType: 'Drop', phraseOccurrence: 2 },
    });
    for (const index of [0, 1, 3, 4]) expect(next.draft.slots[index]).toEqual(draft.slots[index]);
    expect(next.draft.transitions?.map(({ from }) => from)).toEqual([1, 2, 3, 4]);
    expect(next.canUndoSwap).toBe(true);
  });

  it('allows an unrestricted weaker manual choice and explains semantic fallback and compatibility', async () => {
    const draft = populatedDraft();
    const candidate = row(7, { bpm: 170, camelot_key: '2B' });
    const context = scoring(draft);
    expect(rankSetLabSwapCandidate(draft, context, candidate)?.similar).toBe(false);
    vi.mocked(fetchTrackPhrases).mockResolvedValueOnce(phases(candidate.id, ['verse', 'verse']));
    const result = await prepareSetLabSwap({ draft, track: candidate, context, importDeviceName: null, signal: new AbortController().signal }, {
      usb, fetchCloudPreview,
    });
    expect(result.action.track.trackId).toBe(candidate.id);
    expect(result.notice).toContain('No Drop window fits');
    expect(result.notice).toContain('Use caution');
    expect(result.action.track.section.phraseType).toBe('Verse');
  });

  it('rejects duplicates before loading and leaves the old slot intact when audio is unavailable', async () => {
    const draft = populatedDraft();
    const state = { draft, previous: null };
    const base = { draft, context: scoring(draft), importDeviceName: null, signal: new AbortController().signal };
    await expect(prepareSetLabSwap({ ...base, track: row(2) }, { usb, fetchCloudPreview })).rejects.toThrow('occupies slot 2');
    expect(fetchTrackBeatGrid).not.toHaveBeenCalled();
    vi.mocked(decodeSetLabSource).mockRejectedValueOnce(new Error('Unreadable file'));
    await expect(prepareSetLabSwap({ ...base, track: row(6) }, { usb, fetchCloudPreview }))
      .rejects.toThrow(/cannot replace slot 3.*Unreadable file.*no ready DropDex Cloud preview/);
    expect(state.draft).toEqual(populatedDraft());
  });

  it('rejects decoded audio that is too short for the original bars', async () => {
    const draft = populatedDraft();
    vi.mocked(decodeSetLabSource).mockResolvedValueOnce({ length: 7000, sampleRate: 1000 } as AudioBuffer);
    await expect(prepareSetLabSwap({
      draft, track: row(6), context: scoring(draft), importDeviceName: null, signal: new AbortController().signal,
    }, { usb, fetchCloudPreview })).rejects.toThrow('No complete 8-bar window');
  });
});

describe('Set Lab swap commits', () => {
  function harness(status: SetLabPreviewSnapshot['status']) {
    let state: SetLabState = { draft: populatedDraft(), previous: null };
    const snapshot = { status, positionSeconds: 13, error: null };
    const order: string[] = [];
    const preview = {
      getSnapshot: () => snapshot,
      stopAndReset: vi.fn(() => { order.push('stop'); snapshot.status = 'idle'; snapshot.positionSeconds = 0; }),
    };
    const dispatch = vi.fn<SetLabDispatch>((action, before) => {
      const next = reduceSetLabSession(state, action);
      before?.();
      order.push('commit');
      state = next;
      return true;
    });
    const swap: SetLabAction = {
      type: 'replace', base: state.draft, position: 3,
      track: { trackId: 'track-6', trackIdentityKey: 'c:6', section: fiveSlots[2].section, manuallyPositioned: false },
    };
    return { preview, dispatch, swap, state: () => state, order };
  }

  it('requests confirmation while playing and allows Cancel to leave playback and the draft untouched', () => {
    const { preview, dispatch, swap, state } = harness('playing');
    const original = state().draft;
    expect(commitSetLabEdit(swap, preview, dispatch)).toBe('confirm');
    // Cancel dismisses the pending dialog without invoking the confirmed path.
    expect(preview.getSnapshot()).toMatchObject({ status: 'playing', positionSeconds: 13 });
    expect(dispatch).not.toHaveBeenCalled();
    expect(state().draft).toBe(original);
  });

  it('stops before the confirmed commit and resets a paused playhead without confirmation', () => {
    const playing = harness('playing');
    expect(commitSetLabEdit(playing.swap, playing.preview, playing.dispatch, true)).toBe('committed');
    expect(playing.order).toEqual(['stop', 'commit']);
    const paused = harness('paused');
    expect(commitSetLabEdit(paused.swap, paused.preview, paused.dispatch)).toBe('committed');
    expect(paused.preview.getSnapshot()).toMatchObject({ status: 'idle', positionSeconds: 0 });
    expect(paused.state().draft.slots[2]?.trackId).toBe('track-6');
  });

  it('keeps playback running if journaling fails and rejects a stale target without stopping', () => {
    const { preview, dispatch, swap, state } = harness('playing');
    dispatch.mockReturnValueOnce(false);
    expect(commitSetLabEdit(swap, preview, dispatch, true)).toBe('rejected');
    expect(preview.stopAndReset).not.toHaveBeenCalled();
    dispatch({ type: 'select', position: 2 });
    expect(() => commitSetLabEdit(swap, preview, dispatch, true)).toThrow('target slot changed');
    expect(preview.stopAndReset).not.toHaveBeenCalled();
    expect(state().draft.slots[2]?.trackId).toBe('track-3');
  });

  it('undoes the swap and preserves subsequent slot selection and Similar Only preference', () => {
    const { preview, dispatch, swap, state } = harness('idle');
    expect(commitSetLabEdit(swap, preview, dispatch)).toBe('committed');
    dispatch({ type: 'select', position: 5 });
    dispatch({ type: 'set-options', filters: state().draft.filters, settings: { similarOnly: true } });
    expect(state().canUndoSwap).toBe(true);
    expect(commitSetLabEdit({ type: 'undo', swapOnly: true }, preview, dispatch)).toBe('committed');
    expect(state().draft.slots).toEqual(populatedDraft().slots);
    expect(state().draft).toMatchObject({ selectedSlot: 5, settings: { similarOnly: true } });
    expect(state().canUndoSwap).toBeUndefined();
  });
});
