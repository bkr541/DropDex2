import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchTrackBeatGrids, type BeatGridRow } from '../../lib/queries/analysisData';
import { fetchLibraryTracksPage, fetchTracksByIds } from '../../lib/queries/rekordbox';
import type { RekordboxTrack } from '../../types';
import { probeSetLabAudio } from './audioProbe';
import { prepareSetLabSnapshot, restoreSetLabSavedSet } from './savedSetRestore';
import { grid } from './sectionResolver.testFixtures';
import { createSetLabDraft, parseSetLabSession, type SetLabSavedSet } from './session';
import { populatedDraft, scope } from './session.testFixtures';
import { reduceSetLabSession } from './sessionReducer';

vi.mock('../../lib/queries/analysisData');
vi.mock('../../lib/queries/rekordbox');
vi.mock('./audioProbe');

const nextScope = { ...scope, sourceImportId: 'new-import' };
const tracks = (importId: string, prefix: string) => Array.from({ length: 5 }, (_, index) => ({
  id: `${prefix}-${index + 1}`, import_id: importId, rekordbox_content_id: String(index + 1),
  title: `Record ${index + 1}`, artist: 'Artist', duration_seconds: 55, file_path: `/Contents/${index + 1}.wav`,
} as RekordboxTrack));
const oldTracks = tracks(scope.sourceImportId, 'track');
const newTracks = tracks(nextScope.sourceImportId, 'new');
const draft = populatedDraft();
function savedSet(value: unknown): SetLabSavedSet {
  const session = parseSetLabSession(value, scope);
  if (session.status !== 'saved') throw new Error('Invalid saved fixture.');
  return session;
}
const snapshot = savedSet({
  ...draft, status: 'saved', name: 'Friday',
  slots: draft.slots.map((slot) => ({
    ...slot, recording: { title: `record ${slot.position}`, artist: 'artist', durationMs: 55_000 },
  })),
});
const saved = { id: 'friday-id', revision: 1, session: snapshot };
const sources = {
  usb: {
    status: 'connected' as const, volumeName: 'DECK',
    resolveTrackSource: vi.fn(async () => ({ ok: true, source: { kind: 'file', file: new File(['fixture'], 'file.wav') } }) as const),
  },
  fetchCloudPreview: vi.fn(async () => null),
};
function page(items: RekordboxTrack[], offset = 0, total = items.length) {
  return { items, offset, total, limit: 200, hasMore: offset + items.length < total };
}
function reopen(request = saved, active = nextScope, signal = new AbortController().signal) {
  return restoreSetLabSavedSet({ saved: request, scope: active, signal, importDeviceName: 'DECK' }, sources);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchTracksByIds).mockImplementation(async (ids) => oldTracks.filter(({ id }) => ids.includes(id)));
  vi.mocked(fetchLibraryTracksPage).mockResolvedValue(page(newTracks));
  vi.mocked(fetchTrackBeatGrids).mockImplementation(async (ids) => new Map(ids.map((id) => [id, {
    track_id: id, import_id: id.startsWith('new-') ? nextScope.sourceImportId : scope.sourceImportId,
    source_tag: 'PQTZ', beats: grid(),
  } as BeatGridRow])));
  vi.mocked(probeSetLabAudio).mockResolvedValue(55_000);
});

describe('saved Set Lab working copies', () => {
  it('captures recording evidence in a separate snapshot', async () => {
    const enriched = await prepareSetLabSnapshot(draft, new AbortController().signal);
    expect(enriched.slots[0]?.recording).toEqual(snapshot.slots[0].recording);
    expect(draft.slots[0]?.recording).toBeUndefined();
  });

  it('loads matching identities across pages when the original import is gone, preserving exact sections', async () => {
    vi.mocked(fetchTracksByIds).mockResolvedValueOnce([]);
    vi.mocked(fetchLibraryTracksPage).mockResolvedValueOnce(page(newTracks.slice(0, 2), 0, 5))
      .mockResolvedValueOnce(page(newTracks.slice(2), 2, 5));
    const draft = await reopen();
    expect(fetchLibraryTracksPage).toHaveBeenLastCalledWith(nextScope.sourceImportId, 2, 200, {}, expect.any(AbortSignal));
    expect(draft).toMatchObject({ ...nextScope, status: 'draft', loadedFrom: { id: 'friday-id', name: 'Friday' } });
    expect(draft.slots).toEqual(snapshot.slots.map((slot, index) => ({ ...slot, trackId: newTracks[index].id })));
    expect(probeSetLabAudio).toHaveBeenCalledTimes(5);
    const base = createSetLabDraft(nextScope);
    const load = { type: 'load-saved', base, draft } as const;
    const state = reduceSetLabSession({ draft: base, previous: null }, load);
    const edited = reduceSetLabSession(state, { type: 'set-locked', position: 1, locked: true });
    expect(parseSetLabSession(edited.draft, nextScope)).toEqual(edited.draft);
    expect(snapshot.slots[0].locked).toBe(false);
    expect(edited.draft.slots[0]?.locked).toBe(true);
    expect(() => reduceSetLabSession(edited, load)).toThrow('changed during load');
  });

  it('loads exact original IDs without scanning the library', async () => {
    const copy = await reopen(saved, scope);
    expect(copy.slots).toEqual(snapshot.slots);
    expect(fetchLibraryTracksPage).not.toHaveBeenCalled();
  });

  it('uses the original source record as evidence for legacy named sets', async () => {
    const legacy = { ...saved, session: savedSet({ ...draft, status: 'saved', name: 'Legacy' }) };
    await expect(reopen(legacy)).resolves.toMatchObject({ loadedFrom: { name: 'Legacy' } });
    vi.mocked(fetchTracksByIds).mockResolvedValueOnce([]);
    await expect(reopen(legacy)).rejects.toThrow('could not be verified against the original recording');
  });

  it('reports missing, ambiguous and recycled content IDs before probing any audio', async () => {
    vi.mocked(fetchLibraryTracksPage).mockResolvedValueOnce(page([
      newTracks[0], { ...newTracks[0], id: 'duplicate' }, { ...newTracks[2], title: 'Different Recording' },
      ...newTracks.slice(3),
    ]));
    await expect(reopen()).rejects.toThrow(/Slot 1.*multiple tracks.*Slot 2.*track missing.*Slot 3.*could not be verified/);
    expect(probeSetLabAudio).not.toHaveBeenCalled();
  });

  it('reports source and saved-grid failures without creating a partial draft', async () => {
    vi.mocked(probeSetLabAudio).mockRejectedValueOnce(new Error('USB disconnected'));
    await expect(reopen()).rejects.toThrow(/Slot 1.*USB disconnected.*Cloud:/);
    const mismatched = savedSet({ ...snapshot, slots: [
      { ...snapshot.slots[0], section: { ...snapshot.slots[0].section, startMs: 1 } }, ...snapshot.slots.slice(1),
    ] });
    await expect(reopen({ ...saved, session: mismatched })).rejects.toThrow('no longer matches the current Rekordbox beat grid');
  });

  it('rejects foreign and canceled loads before returning an editable copy', async () => {
    await expect(reopen(saved, { ...nextScope, userId: 'other' })).rejects.toThrow('different account');
    const controller = new AbortController();
    vi.mocked(fetchLibraryTracksPage).mockImplementationOnce(async () => {
      controller.abort();
      return page(newTracks);
    });
    await expect(reopen(saved, nextScope, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(probeSetLabAudio).not.toHaveBeenCalled();
  });
});
