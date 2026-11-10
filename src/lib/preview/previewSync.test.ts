import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildPreviewJobs, previewSyncStore, runPreviewSync, type PreviewJob, type PreviewSyncDeps } from './previewSync';
import { previewStoragePath, trackIdentityKey } from './trackIdentity';
import { fetchLibraryTracksPage } from '../queries/rekordbox';
import type { RekordboxTrack } from '../../types';

vi.mock('../supabase', () => ({ supabase: {} }));
vi.mock('../queries/rekordbox', () => ({ fetchLibraryTracksPage: vi.fn() }));

const encoded = { ok: true as const, skipped: false as const, bytes: new Uint8Array([1, 2, 3]), sizeBytes: 3, durationMs: 1000, bitrateKbps: 160, sampleRate: 44100, channels: 2, sourceSize: 10, sourceMtimeMs: 5000 };
const job = (n: number, over: Partial<PreviewJob> = {}): PreviewJob => ({ trackId: `t${n}`, title: `Track ${n}`, identityKey: `m:1:${n}`, segments: ['Contents', `${n}.mp3`], ...over });

function deps(over: Partial<PreviewSyncDeps> = {}): PreviewSyncDeps & { saved: unknown[] } {
  const saved: unknown[] = [];
  return {
    saved,
    encode: vi.fn(async () => encoded),
    upload: vi.fn(async () => undefined),
    save: vi.fn(async (row) => { saved.push(row); }),
    storagePath: async (key) => `user/${key}.m4a`,
    ...over,
  };
}

describe('preview sync runner', () => {
  it('encodes, uploads and records every track', async () => {
    const d = deps();
    const summary = await runPreviewSync({ jobs: [job(1), job(2)], existing: new Map(), deps: d });
    expect(summary).toMatchObject({ synced: 2, skipped: 0, failed: 0, processed: 2, cancelled: false });
    expect(d.upload).toHaveBeenCalledTimes(2);
    expect(d.saved[0]).toMatchObject({ identityKey: 'm:1:1', trackId: 't1', storagePath: 'user/m:1:1.m4a', sizeBytes: 3, bitrateKbps: 160 });
  });

  it('skips a track whose original has not changed since its last preview', async () => {
    const d = deps({ encode: vi.fn(async () => ({ ok: true as const, skipped: true as const, sourceSize: 10, sourceMtimeMs: 5000 })) });
    const existing = new Map([['m:1:1', { status: 'ready' as const, sourceSize: 10, sourceMtimeMs: 5000 }]]);
    const summary = await runPreviewSync({ jobs: [job(1)], existing, deps: d });
    expect(summary).toMatchObject({ synced: 0, skipped: 1, failed: 0 });
    expect(d.encode).toHaveBeenCalledWith({ segments: ['Contents', '1.mp3'], previous: { sourceSize: 10, sourceMtimeMs: 5000 } });
    expect(d.upload).not.toHaveBeenCalled();
  });

  it('leaves a copy pending removal out of a subsequent sync', async () => {
    const d = deps();
    const existing = new Map([['m:1:1', { status: 'failed' as const, sourceSize: null, sourceMtimeMs: null, pendingRemoval: true }]]);
    const result = await runPreviewSync({ jobs: [job(1)], existing, deps: d });
    expect(result).toMatchObject({ failed: 1, processed: 1 });
    expect(d.encode).not.toHaveBeenCalled();
  });

  it('records a failed track in plain words and carries on with the rest', async () => {
    const d = deps({ encode: vi.fn(async ({ segments }) => (segments[1] === '2.mp3' ? { ok: false as const, error: { kind: 'not_found', message: 'raw' } } : encoded)) });
    const failures: string[] = [];
    const summary = await runPreviewSync({ jobs: [job(1), job(2), job(3)], existing: new Map(), deps: d, onFailure: (f) => failures.push(f.message) });
    expect(summary).toMatchObject({ synced: 2, failed: 1, processed: 3 });
    expect(summary.failures[0]).toMatchObject({ trackId: 't2', message: 'The file was not found on the USB.' });
    expect(failures).toEqual(['The file was not found on the USB.']);
  });

  it('fails a track with no usable path without touching the USB', async () => {
    const d = deps();
    const summary = await runPreviewSync({ jobs: [job(1, { segments: null, unusableReason: 'This track has no file path.' })], existing: new Map(), deps: d });
    expect(summary.failures[0].message).toBe('This track has no file path.');
    expect(d.encode).not.toHaveBeenCalled();
  });

  it('retries a flaky upload, then gives up on that track only', async () => {
    let calls = 0;
    const d = deps({ upload: vi.fn(async () => { calls += 1; if (calls <= 2) throw new Error('network down'); }) });
    expect(await runPreviewSync({ jobs: [job(1)], existing: new Map(), deps: d })).toMatchObject({ synced: 1, failed: 0 });
    const broken = deps({ upload: vi.fn(async () => { throw new Error('quota exceeded'); }) });
    const summary = await runPreviewSync({ jobs: [job(1), job(2)], existing: new Map(), deps: broken, concurrency: 1 });
    expect(summary.failed).toBe(2);
    expect(summary.failures[0].message).toBe('Upload failed: quota exceeded');
  }, 15000);

  it('stops starting new tracks when cancelled', async () => {
    let cancel = false;
    const d = deps({ encode: vi.fn(async () => { cancel = true; return encoded; }) });
    const summary = await runPreviewSync({ jobs: [job(1), job(2), job(3)], existing: new Map(), deps: d, isCancelled: () => cancel, concurrency: 1 });
    expect(summary.cancelled).toBe(true);
    expect(summary.processed).toBe(1);
  });
});

describe('Sync All preparation', () => {
  it('becomes active before loading tracks and stops a pending page without encoding anything', async () => {
    const fetchPage = vi.mocked(fetchLibraryTracksPage);
    fetchPage.mockImplementationOnce((_importId, _offset, _limit, _filters, signal) => new Promise((_, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const d = deps();
    const options = { userId: 'user', deps: d, existing: new Map() };
    const pending = previewSyncStore.start('library', options);
    expect(previewSyncStore.getState().phase).toBe('preparing');
    await previewSyncStore.start('other-library', options);
    expect(fetchPage).toHaveBeenCalledTimes(1);

    previewSyncStore.cancel();
    expect(previewSyncStore.getState().stopping).toBe(true);
    await pending;
    expect(previewSyncStore.getState()).toMatchObject({ phase: 'done', stopping: false, cancelled: true, processed: 0 });
    expect(d.encode).not.toHaveBeenCalled();

    previewSyncStore.reset();
    fetchPage.mockResolvedValueOnce({ items: [], total: 0, offset: 0, limit: 500, hasMore: false });
    await previewSyncStore.start('library', options);
    expect(previewSyncStore.getState()).toMatchObject({ phase: 'done', cancelled: false });
    previewSyncStore.reset();
  });
});

describe('track identity and storage', () => {
  const base = { rekordbox_content_id: '77', title: ' Song ', artist: 'Artist', file_path: '/Contents/A/b.mp3', duration_seconds: 200 };
  it('prefers the master ids, then the content id, then the path and tags', () => {
    expect(trackIdentityKey({ ...base, master_db_id: 'db', master_content_id: '9' })).toBe('m:db:9');
    expect(trackIdentityKey(base)).toBe('c:77');
    expect(trackIdentityKey({ ...base, rekordbox_content_id: '' })).toBe('p:/contents/a/b.mp3|song|artist|200');
  });
  it('puts every preview under the user\'s own folder', async () => {
    const path = await previewStoragePath('user-123', 'm:db:9');
    expect(path).toMatch(/^user-123\/[0-9a-f]{32}\.m4a$/);
    expect(await previewStoragePath('user-123', 'm:db:9')).toBe(path);
    expect(await previewStoragePath('user-123', 'm:db:10')).not.toBe(path);
  });
  it('works out where each file is on the USB, and explains tracks it cannot place', () => {
    const track = (over: Partial<RekordboxTrack>) => ({ ...base, id: 't', import_id: 'i', ...over } as RekordboxTrack);
    const [ok, none] = buildPreviewJobs([track({ file_path: '/Contents/Artist/song.mp3' }), track({ id: 't2', file_path: null })]);
    expect(ok.segments).toEqual(['Contents', 'Artist', 'song.mp3']);
    expect(none.segments).toBeNull();
    expect(none.unusableReason).toBe('This track has no file path.');
  });
});

describe('storage rules', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/20261105010000_track_previews.sql', import.meta.url), 'utf8');
  it('lets each user reach only their own previews and files', () => {
    expect(sql).toContain('UNIQUE (user_id, identity_key)');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain("bucket_id = 'track-previews' AND (storage.foldername(name))[1] = auth.uid()::text");
    for (const verb of ['FOR SELECT', 'FOR INSERT', 'FOR UPDATE', 'FOR DELETE']) expect(sql.match(new RegExp(verb, 'g'))!.length).toBeGreaterThanOrEqual(2);
    expect(sql).toContain('public');
    expect(sql).toMatch(/'track-previews',\s*\n\s*false/);
  });
});
