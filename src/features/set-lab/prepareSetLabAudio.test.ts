import { describe, expect, it, vi } from 'vitest';
import { DecodedAudioCache } from '../../lib/audio/decodedAudioCache';
import type { RekordboxTrack } from '../../types';
import { extractSetLabClip, prepareSetLabAudio, setLabPcmBytes, type PreparedSetLabClip } from './prepareSetLabAudio';
import { SET_LAB_AUDIO_LIMITS } from './setLabSources';
import { fiveSlots, scope } from './session.testFixtures';

function buffer(rate: number, length: number, channels = 1, value = 0) {
  const data = Array.from({ length: channels }, () => new Float32Array(length).fill(value));
  return { sampleRate: rate, length, numberOfChannels: channels, getChannelData: (channel: number) => data[channel] } as AudioBuffer;
}

const fakeTrack = (position: number) => ({
  id: `track-${position}`, import_id: scope.sourceImportId, title: `Record ${position}`,
  rekordbox_content_id: String(position), file_path: `/Volumes/DECK/Contents/${position}.wav`,
} as unknown as RekordboxTrack);

function setup() {
  const cache = new DecodedAudioCache<PreparedSetLabClip>(5, { maxBytes: SET_LAB_AUDIO_LIMITS.setPcmBytes, sizeOf: (clip) => setLabPcmBytes(clip.buffer) });
  const decodeAudioData = vi.fn(async (_: ArrayBuffer) => buffer(1000, 20_000));
  const createBuffer = vi.fn((channels: number, length: number, rate: number) => buffer(rate, length, channels));
  const context = { sampleRate: 44_100, decodeAudioData, createBuffer } as unknown as AudioContext;
  const getTracks = vi.fn(async () => [1, 2, 3, 4, 5].map(fakeTrack));
  const resolveTrackSource = vi.fn(async (_path: string[]) => ({
    ok: true, source: { kind: 'file', file: new File(['pcm'], 'audio.wav') },
  }) as const);
  const probe = vi.fn(async () => 20_000);
  const readBytes = vi.fn(async () => new ArrayBuffer(10));
  const fetchCloudPreview = vi.fn(async () => ({ url: 'https://dropdex.example/signed', durationMs: 20_000 }));
  const controller = new AbortController();
  const input = { ...scope, slots: fiveSlots, cache, context, signal: controller.signal, importDeviceName: 'DECK' };
  const deps = { usb: { status: 'connected' as const, volumeName: 'DECK', resolveTrackSource }, getTracks, probe, readBytes, fetchCloudPreview };
  return { input, deps, cache, decodeAudioData, createBuffer, controller };
}

describe('Set Lab excerpt preparation', () => {
  it('copies only the exact section at its decoded sample rate, including fractional sample offsets', () => {
    const { input } = setup();
    const whole = buffer(48_000, 9600, 2, 0.2);
    const clip = extractSetLabClip(input.context, whole, {
      ...fiveSlots[0], section: { ...fiveSlots[0].section, startMs: 100.01, endMs: 150.01 },
    }, 'local', SET_LAB_AUDIO_LIMITS.setPcmBytes);
    expect(clip.durationMs).toBeCloseTo(50);
    expect(clip.offsetSeconds).toBeCloseTo(0.00001, 9);
    expect(clip.buffer.sampleRate).toBe(48_000);
    expect(clip.buffer.length).toBe(2401);
    expect(clip.buffer.getChannelData(1)[0]).toBeCloseTo(0.2);
    expect(clip.buffer.getChannelData(1).buffer).not.toBe(whole.getChannelData(1).buffer);
    expect(() => extractSetLabClip(input.context, whole, fiveSlots[0], 'local', 1)).toThrow('ends before');
    expect(() => extractSetLabClip(input.context, whole, {
      ...fiveSlots[0], section: { ...fiveSlots[0].section, endMs: 100 },
    }, 'local', 1)).toThrow('80 MiB');
  });

  it('decodes the five selected sources serially in slot order and caches excerpts only', async () => {
    const { input, deps, cache, decodeAudioData } = setup();
    const clips = await prepareSetLabAudio(input, deps);
    expect(deps.getTracks).toHaveBeenCalledWith(fiveSlots.map((slot) => slot.trackId), input.signal);
    expect(deps.usb.resolveTrackSource.mock.calls.map(([path]) => path)).toEqual([1, 2, 3, 4, 5].map((i) => ['Contents', `${i}.wav`]));
    expect(decodeAudioData).toHaveBeenCalledTimes(5);
    expect(deps.fetchCloudPreview).not.toHaveBeenCalled();
    expect(clips.map(({ buffer: clip }) => clip.length)).toEqual([16_000, 16_000, 16_000, 16_000, 16_000]);
    expect(cache.byteSize).toBe(5 * 16_000 * 4);
  });

  it('falls back to a freshly signed, owned Cloud preview if local decoding fails', async () => {
    const { input, deps, decodeAudioData } = setup();
    decodeAudioData.mockRejectedValueOnce(new Error('corrupt local file'));
    const clips = await prepareSetLabAudio(input, deps);
    expect(deps.fetchCloudPreview).toHaveBeenCalledWith('c:1', { userId: scope.userId, signal: input.signal });
    expect(clips.map(({ source }) => source)).toEqual(['cloud', 'local', 'local', 'local', 'local']);
    expect(decodeAudioData).toHaveBeenCalledTimes(6);
  });

  it('rejects a stale signed URL and a decoded preview shorter than its advertised duration', async () => {
    const { input, deps, decodeAudioData } = setup();
    decodeAudioData.mockRejectedValueOnce(new Error('local failure'));
    deps.readBytes.mockResolvedValueOnce(new ArrayBuffer(10)).mockRejectedValueOnce(new Error('HTTP 403'));
    await expect(prepareSetLabAudio(input, deps)).rejects.toThrow(/Slot 1.*Web Audio could not decode.*Cloud audio: HTTP 403/);

    const next = setup();
    next.decodeAudioData.mockRejectedValueOnce(new Error('local failure')).mockResolvedValueOnce(buffer(1000, 15000));
    await expect(prepareSetLabAudio(next.input, next.deps)).rejects.toThrow(/Slot 1.*Decoded audio ends before/);
    expect(next.cache.size).toBe(0);
  });

  it('skips full reads on known oversized files or tracks and fails a mismatched identity', async () => {
    const { input, deps } = setup();
    deps.probe.mockResolvedValue(SET_LAB_AUDIO_LIMITS.trackDurationMs + 1);
    await expect(prepareSetLabAudio(input, deps)).rejects.toThrow('eight-minute');
    expect(deps.readBytes).not.toHaveBeenCalled();
    deps.getTracks.mockResolvedValueOnce([{ ...fakeTrack(1), rekordbox_content_id: 'other' }]);
    await expect(prepareSetLabAudio(input, deps)).rejects.toThrow('no longer resolves');
  });

  it('never overlaps a cancelled non-abortable decode with a newer preparation', async () => {
    const old = setup();
    const next = setup();
    let finish!: (value: AudioBuffer) => void;
    let began!: () => void;
    const started = new Promise<void>((resolve) => { began = resolve; });
    old.decodeAudioData.mockImplementationOnce(() => {
      began();
      return new Promise((resolve) => { finish = resolve; });
    });
    const abandoned = prepareSetLabAudio(old.input, old.deps);
    await started;
    old.controller.abort();
    const pending = prepareSetLabAudio(next.input, next.deps);
    await Promise.resolve();
    expect(next.deps.readBytes).not.toHaveBeenCalled();
    finish(buffer(1000, 20_000));
    await expect(abandoned).rejects.toMatchObject({ name: 'AbortError' });
    expect(old.cache.size).toBe(0);
    await expect(pending).resolves.toHaveLength(5);
  });
});
