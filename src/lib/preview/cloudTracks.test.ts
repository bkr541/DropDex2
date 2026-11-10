import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteCloudTrack, fetchCloudTracks, type CloudTrack } from '../queries/trackPreviews';
import { previewStoragePath } from './trackIdentity';

const db = vi.hoisted(() => ({ from: vi.fn(), bucket: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { from: db.from, storage: { from: db.bucket } } }));

const copy: CloudTrack['cloudPreview'] = { id: 'preview-1', userId: 'owner', identityKey: 'c:1', status: 'ready' };

function query() {
  return {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(), abortSignal: vi.fn(),
    update: vi.fn().mockReturnThis(), match: vi.fn().mockReturnThis(), delete: vi.fn().mockReturnThis(), maybeSingle: vi.fn(),
  };
}

beforeEach(() => vi.resetAllMocks());

describe('Cloud track records', () => {
  it('lists the account’s previews, including a copy without an original track row', async () => {
    const listing = query();
    db.from.mockReturnValue(listing);
    listing.abortSignal.mockResolvedValue({ error: null, data: [
      { id: copy.id, identity_key: copy.identityKey, status: 'ready', duration_ms: 150_000, track: { id: 'track-1', title: 'Track 1' } },
      { id: 'preview-2', identity_key: 'c:2', status: 'ready', duration_ms: 180_000, track: null },
    ] });

    const tracks = await fetchCloudTracks(copy.userId, new AbortController().signal);
    expect(listing.eq).toHaveBeenCalledWith('user_id', 'owner');
    expect(tracks[0]).toMatchObject({ id: 'track-1', title: 'Track 1', cloudPreview: copy, duration_ms: 150_000 });
    expect(tracks[1]).toMatchObject({ id: 'preview-2', duration_ms: 180_000, cloudPreview: { identityKey: 'c:2' } });
  });

  it('marks the Cloud copy unavailable and retries storage removal before deleting the matching row', async () => {
    const path = await previewStoragePath(copy.userId, copy.identityKey);
    const mark = query();
    const finish = query();
    db.from.mockReturnValueOnce(mark).mockReturnValueOnce(mark).mockReturnValueOnce(finish);
    mark.maybeSingle.mockResolvedValue({ data: { storage_path: path, updated_at: 'revision' }, error: null });
    finish.maybeSingle.mockResolvedValue({ data: { id: copy.id }, error: null });
    const remove = vi.fn().mockResolvedValueOnce({ error: { message: 'offline' } }).mockResolvedValueOnce({ error: null });
    db.bucket.mockReturnValue({ remove });

    await expect(deleteCloudTrack(copy)).rejects.toThrow('offline');
    expect(mark.update).toHaveBeenCalledWith({ status: 'failed', error: 'pending_removal' });
    expect(mark.match).toHaveBeenCalledWith({ id: copy.id, user_id: copy.userId, identity_key: copy.identityKey });
    expect(finish.delete).not.toHaveBeenCalled();
    await deleteCloudTrack(copy);
    expect(db.bucket).toHaveBeenCalledWith('track-previews');
    expect(remove).toHaveBeenLastCalledWith([path]);
    expect(finish.match).toHaveBeenCalledWith({ id: copy.id, user_id: copy.userId, identity_key: copy.identityKey, updated_at: 'revision' });
    expect(db.from.mock.calls.every(([table]) => table === 'track_previews')).toBe(true);
  });

  it('leaves a storage object alone if its path does not belong to the selected copy', async () => {
    const mark = query();
    db.from.mockReturnValue(mark);
    mark.maybeSingle.mockResolvedValue({ data: { storage_path: 'other/another-file.m4a' }, error: null });
    await expect(deleteCloudTrack(copy)).rejects.toThrow('does not match');
    expect(db.bucket).not.toHaveBeenCalled();
  });
});
