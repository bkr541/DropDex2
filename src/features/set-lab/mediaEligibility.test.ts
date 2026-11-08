import { describe, expect, it, vi } from 'vitest';
import { prefilterSetLabTrack, verifySetLabCandidate } from './mediaEligibility';
import { grid, trackScope } from './sectionResolver.testFixtures';

const scope = { userId: 'owner-1', sourceImportId: trackScope.import_id };
const track = {
  id: trackScope.track_id, import_id: trackScope.import_id, title: 'Example', artist: null,
  duration_seconds: 55, file_path: '/Volumes/DECK/Contents/Example.mp3', rekordbox_content_id: '11',
  master_db_id: 'db', master_content_id: 'song',
};
const analysis = { beatGrid: { ...trackScope, source_tag: 'PQTZ', beats: grid() } };
const localMedia = { kind: 'url', url: 'dropdex-media://track/token', size: 200 } as const;
const cloud = { url: 'https://dropdex.example/signed', durationMs: 55_000 };
const candidate = { scope, track, analysis };

function dependencies() {
  return {
    usb: {
      status: 'connected' as const, volumeName: 'DECK',
      resolveTrackSource: vi.fn(async () => ({ ok: true, source: localMedia }) as const),
    },
    fetchCloudPreview: vi.fn(async () => cloud),
    probe: vi.fn(async () => 55_000),
  };
}

describe('Set Lab media eligibility', () => {
  it('can prefilter cheaply and keeps durable Rekordbox identity', () => {
    expect(prefilterSetLabTrack(track, scope)).toEqual({ ok: true, durationMs: 55_000, trackIdentityKey: 'm:db:song' });
    expect(prefilterSetLabTrack({ ...track, duration_ms: 54_321 }, scope)).toMatchObject({ durationMs: 54_321 });
    expect(prefilterSetLabTrack(track, { ...scope, sourceImportId: 'other' })).toMatchObject({
      ok: false, reason: 'scope-mismatch',
    });
  });

  it('rejects missing or mismatched analysis before touching media', async () => {
    const deps = dependencies();
    await expect(verifySetLabCandidate({ ...candidate, analysis: { beatGrid: null } }, deps))
      .resolves.toMatchObject({ ok: false, reason: 'missing-grid' });
    const wrongGrid = { beatGrid: { ...analysis.beatGrid, track_id: 'different-track' } };
    await expect(verifySetLabCandidate({ ...candidate, analysis: wrongGrid }, deps))
      .resolves.toMatchObject({ ok: false, reason: 'analysis-scope-mismatch' });
    expect(deps.usb.resolveTrackSource).not.toHaveBeenCalled();
    expect(deps.fetchCloudPreview).not.toHaveBeenCalled();
    expect(deps.probe).not.toHaveBeenCalled();
  });

  it('uses the authorized local root and a playable probe before returning windows', async () => {
    const deps = dependencies();
    const signal = new AbortController().signal;
    const result = await verifySetLabCandidate({ ...candidate, signal }, deps);
    expect(deps.usb.resolveTrackSource).toHaveBeenCalledWith(['Contents', 'Example.mp3'], { isCancelled: expect.any(Function) });
    expect(deps.probe).toHaveBeenCalledWith(localMedia, signal);
    expect(deps.fetchCloudPreview).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, trackIdentityKey: 'm:db:song', source: { kind: 'local', durationMs: 55_000 } });
  });

  it('falls back to an owned cloud preview if the local path is on another volume', async () => {
    const deps = dependencies();
    deps.usb.volumeName = 'OTHER';
    deps.probe.mockResolvedValue(16_000);
    const result = await verifySetLabCandidate(candidate, deps);
    expect(deps.usb.resolveTrackSource).not.toHaveBeenCalled();
    expect(deps.fetchCloudPreview).toHaveBeenCalledWith('m:db:song', { userId: scope.userId, signal: undefined });
    expect(result).toMatchObject({ ok: true, source: { kind: 'cloud', durationMs: 16_000 },
      windows: [{ barCount: 8, section: { endMs: 16_000 } }],
    });
  });

  it('uses measured source duration when track length is missing', async () => {
    const deps = dependencies();
    const result = await verifySetLabCandidate({ ...candidate, track: { ...track, duration_seconds: null } }, deps);
    expect(result).toMatchObject({ ok: true, source: { durationMs: 55_000 }, windows: expect.any(Array) });
  });

  it('rejects remote catalog paths and signed preview metadata without playable audio', async () => {
    const deps = dependencies();
    deps.probe.mockRejectedValue(new Error('Unreadable audio'));
    const result = await verifySetLabCandidate({
      ...candidate, track: { ...track, file_path: 'https://example.test/song.mp3', file_path_normalized: '/song.mp3' },
    }, deps);
    expect(deps.usb.resolveTrackSource).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, reason: 'media-unavailable', attempts: [
      { source: 'local', reason: 'path' }, { source: 'cloud', reason: 'unreadable' },
    ] });
  });

  it('reports an absent preview, too-short media, and empty files explicitly', async () => {
    const deps = dependencies();
    deps.probe.mockResolvedValue(7000);
    const fetchCloudPreview = vi.fn(async () => null);
    await expect(verifySetLabCandidate(candidate, { ...deps, fetchCloudPreview })).resolves.toMatchObject({
      ok: false, reason: 'media-unavailable',
      attempts: [{ source: 'local', reason: 'too-short' }, { source: 'cloud', reason: 'unavailable' }],
    });

    const file = new File([], 'empty.wav');
    const resolveTrackSource = vi.fn(async () => ({ ok: true, source: { kind: 'file', file } }) as const);
    deps.probe.mockClear();
    await expect(verifySetLabCandidate(candidate, {
      ...deps, usb: { ...deps.usb, resolveTrackSource }, fetchCloudPreview,
    })).resolves.toMatchObject({ ok: false, attempts: [{ source: 'local', reason: 'unreadable' }, { source: 'cloud' }] });
    expect(deps.probe).not.toHaveBeenCalled();
  });

  it('does not publish a result or fall back to Cloud after a superseded request', async () => {
    const deps = dependencies();
    const controller = new AbortController();
    deps.probe.mockImplementation(async () => {
      controller.abort();
      return 55_000;
    });
    await expect(verifySetLabCandidate({ ...candidate, signal: controller.signal }, deps)).rejects.toMatchObject({ name: 'AbortError' });
    expect(deps.fetchCloudPreview).not.toHaveBeenCalled();
  });
});
