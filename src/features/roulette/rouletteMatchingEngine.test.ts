import { describe, expect, it, vi } from 'vitest';
import type { RekordboxTrack } from '../../types';
import type { BeatGridRow } from '../../lib/queries/analysisData';
import { createRouletteMatchingEngine } from './rouletteMatchingEngine';
import type { RouletteCandidateAnalysis } from './rouletteMatching';
import { STEM_ASSET_CONTRACT_VERSION, type StemAssetRecord } from './stemAssets';

function track(id: string, title = id, bpm = 142): RekordboxTrack {
  return {
    id,
    import_id: 'import-1',
    rekordbox_content_id: id,
    title,
    artist: 'Artist',
    album: null,
    remixer: null,
    genre: 'Trap',
    label: 'Label',
    musical_key: 'Em',
    camelot_key: '9A',
    normalized_key_name: 'E minor',
    key_tonic: 'E',
    key_mode: 'minor',
    bpm,
    duration_seconds: 180,
    rating: null,
    comments: null,
    file_path: `/music/${id}.wav`,
    file_format: 'WAV',
    date_added: null,
  } as RekordboxTrack;
}

function grid(trackId: string): BeatGridRow {
  return {
    id: `grid-${trackId}`,
    import_id: 'import-1',
    track_id: trackId,
    source_tag: 'PQTZ',
    beats: [
      { seq: 1, srcIdx: 1, beatInBar: 1, bar: 1, ms: 0, bpm: 142, isDownbeat: true },
      { seq: 2, srcIdx: 2, beatInBar: 2, bar: 1, ms: 422, bpm: 142, isDownbeat: false },
    ],
    beat_count: 2,
    downbeat_count: 1,
    bar_count: 1,
    first_beat_ms: 0,
    first_downbeat_ms: 0,
    minimum_bpm: 142,
    maximum_bpm: 142,
    is_variable_tempo: false,
    parser_version: 'test',
  };
}

function asset(id: string, type: 'vocals' | 'instrumental', status: StemAssetRecord['status'] = 'ready'): StemAssetRecord {
  return {
    id: `${id}-${type}`,
    track_id: id,
    stem_type: type,
    status,
    storage_locator: status === 'ready' ? `${id}/${type}.wav` : null,
    source_fingerprint: `fp-${id}`,
    separator_version: status === 'ready' ? 'separator-v1' : null,
    contract_version: STEM_ASSET_CONTRACT_VERSION,
    duration_ms: 180000,
    sample_rate_hz: 48000,
    channel_count: 2,
    file_size_bytes: 1000,
    file_mtime_ms: 100,
    failure_code: null,
    failure_message: null,
    created_at: '2026-09-08T00:00:00Z',
    updated_at: '2026-09-08T00:00:00Z',
  };
}

function candidate(
  id: string,
  role: 'vocal' | 'instrumental',
  title = id,
  bpm = 142,
): RouletteCandidateAnalysis {
  return {
    track: track(id, title, bpm),
    stemAsset: asset(id, role === 'vocal' ? 'vocals' : 'instrumental'),
    beatGrid: grid(id),
    phraseCount: 1,
    vocalAnalysisAvailable: role === 'vocal',
  };
}

describe('Roulette matching engine', () => {
  it('revalidates ranked stem readiness and skips stale ready metadata', async () => {
    const fixed = track('instrumental-fixed');
    const stale = candidate('vocal-a', 'vocal', 'Alpha');
    const valid = candidate('vocal-b', 'vocal', 'Beta');
    const getReadiness = vi.fn(async (trackId: string, stemType: 'vocals' | 'instrumental') => ({
      parentTrackId: trackId,
      stemType,
      status: trackId === 'vocal-a' ? 'preparing' as const : 'ready' as const,
      asset: trackId === 'vocal-a' ? null : asset(trackId, stemType),
      reason: null,
    }));
    const engine = createRouletteMatchingEngine({
      loadTrack: vi.fn(async () => fixed),
      loadBeatGrid: vi.fn(async () => grid(fixed.id)),
      loadCandidates: vi.fn(async () => [stale, valid]),
      stemAssets: { getReadiness },
    });

    const resolved = await engine.resolveReplacement({
      role: 'vocal',
      fixedTrackId: fixed.id,
    });

    expect(resolved?.parentTrackId).toBe('vocal-b');
    expect(getReadiness).toHaveBeenCalledWith('vocal-a', 'vocals');
    expect(getReadiness).toHaveBeenCalledWith('vocal-b', 'vocals');
  });

  it('Roulette Both changes both identities when a current pair exists', async () => {
    const vocals = [candidate('vocal-current', 'vocal', 'Alpha'), candidate('vocal-next', 'vocal', 'Beta')];
    const instrumentals = [
      candidate('inst-current', 'instrumental', 'Alpha'),
      candidate('inst-next', 'instrumental', 'Beta'),
    ];
    const getReadiness = vi.fn(async (trackId: string, stemType: 'vocals' | 'instrumental') => ({
      parentTrackId: trackId,
      stemType,
      status: 'ready' as const,
      asset: asset(trackId, stemType),
      reason: null,
    }));
    const engine = createRouletteMatchingEngine({
      loadTrack: vi.fn(async () => null),
      loadBeatGrid: vi.fn(async () => null),
      loadCandidates: vi.fn(async (role) => role === 'vocal' ? vocals : instrumentals),
      stemAssets: { getReadiness },
    });

    const resolved = await engine.resolvePair({
      currentVocalTrackId: 'vocal-current',
      currentInstrumentalTrackId: 'inst-current',
    });

    expect(resolved?.vocal.parentTrackId).toBe('vocal-next');
    expect(resolved?.instrumental.parentTrackId).toBe('inst-next');
  });

  it('allows a 140 BPM replacement against a 142 BPM fixed deck through the production matching service', async () => {
    const fixed = track('instrumental-fixed', 'Fixed', 142);
    const stretchedVocal = candidate('vocal-140', 'vocal', 'Pitch Locked', 140);
    const getReadiness = vi.fn(async (trackId: string, stemType: 'vocals' | 'instrumental') => ({
      parentTrackId: trackId,
      stemType,
      status: 'ready' as const,
      asset: asset(trackId, stemType),
      reason: null,
    }));
    const engine = createRouletteMatchingEngine({
      loadTrack: vi.fn(async () => fixed),
      loadBeatGrid: vi.fn(async () => grid(fixed.id)),
      loadCandidates: vi.fn(async () => [stretchedVocal]),
      stemAssets: { getReadiness },
    });

    const resolved = await engine.resolveReplacement({
      role: 'vocal',
      fixedTrackId: fixed.id,
    });

    expect(resolved?.parentTrackId).toBe('vocal-140');
  });

  it('honors cancellation before candidate work commits', async () => {
    const controller = new AbortController();
    controller.abort();
    const engine = createRouletteMatchingEngine({
      loadTrack: vi.fn(async () => null),
      loadBeatGrid: vi.fn(async () => null),
      loadCandidates: vi.fn(async () => []),
      stemAssets: { getReadiness: vi.fn(async () => { throw new Error('unexpected readiness call'); }) },
    });

    await expect(engine.resolvePair({ signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
