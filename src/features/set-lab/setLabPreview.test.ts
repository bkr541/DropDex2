import { describe, expect, it, vi } from 'vitest';
import { registerUsbPlaybackStopHandler, stopUsbBackedPlayback } from '../../lib/usb/usbPlaybackCoordinator';
import type { PreparedSetLabClip } from './prepareSetLabAudio';
import { scheduleSetLabAudio } from './scheduleSetLabAudio';
import { createSetLabPreviewController, type SetLabPrepare } from './setLabPreviewController';
import { fiveSlots, scope } from './session.testFixtures';
import { setLabAudioPlanKey } from './useSetLabPreview';

function fakeClock() {
  const nodes: Array<ReturnType<typeof sourceNode>> = [];
  const gains: Array<ReturnType<typeof gainNode>> = [];
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  function sourceNode() {
    return { buffer: null as AudioBuffer | null, onended: null as (() => void) | null, start: vi.fn(), stop: vi.fn(),
      connect: vi.fn(), disconnect: vi.fn(), playbackRate: { value: 1 }, detune: { value: 0 } };
  }
  function gainNode() {
    return { gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
  }
  const fake = {
    currentTime: 10, state: 'running', destination: {}, resume: vi.fn(async () => undefined), close: vi.fn(async () => undefined),
    createBufferSource: () => { const node = sourceNode(); nodes.push(node); return node; },
    createGain: () => { const node = gainNode(); gains.push(node); return node; },
  };
  const context = fake as unknown as AudioContext;
  const stopGlobal = vi.fn();
  const controller = createSetLabPreviewController({
    createContext: () => context, stopGlobal,
    frame: (callback) => { callbacks.set(++nextFrame, callback); return nextFrame; },
    cancelFrame: (id) => { callbacks.delete(id); },
  });
  function at(time: number) {
    fake.currentTime = time;
    for (const [id, callback] of [...callbacks]) {
      callbacks.delete(id);
      callback(500_000); // The visual clock must use AudioContext.currentTime.
    }
  }
  return { fake, context, nodes, gains, controller, stopGlobal, at, callbacks };
}

const durations = [16_000, 12_800, 14_400, 8_000, 28_800];
const prepared: PreparedSetLabClip[] = durations.map((durationMs, index) => ({
  durationMs, offsetSeconds: index === 1 ? 0.00001 : 0, source: index % 2 === 0 ? 'local' : 'cloud',
  buffer: { sampleRate: index % 2 === 0 ? 44_100 : 48_000 } as AudioBuffer,
}));

describe('Set Lab Web Audio scheduling', () => {
  it('uses real section lengths in order with no overlap or playback rate/pitch changes', () => {
    const { context, nodes, gains } = fakeClock();
    const run = scheduleSetLabAudio(context, prepared, 0);
    let offset = 0;
    for (const [index, node] of nodes.entries()) {
      const [start, sourceOffset, duration] = node.start.mock.calls[0];
      expect(start).toBeCloseTo(10.05 + offset, 9);
      expect(sourceOffset).toBe(prepared[index].offsetSeconds);
      expect(duration).toBeCloseTo(durations[index] / 1000, 9);
      expect(node.buffer).toBe(prepared[index].buffer);
      expect(node.playbackRate.value).toBe(1);
      expect(node.detune.value).toBe(0);
      expect(node.connect).toHaveBeenCalledWith(gains[index]);
      offset += duration;
      expect(node.stop.mock.calls[0][0]).toBeCloseTo(10.05 + offset, 9);
    }
    expect(nodes).toHaveLength(5);
    expect(run.endAt - run.startAt).toBeCloseTo(80);
  });

  it('uses five-millisecond edge ramps, including when resuming within a clip', () => {
    const { context, nodes, gains } = fakeClock();
    const run = scheduleSetLabAudio(context, prepared, 20);
    expect(nodes).toHaveLength(4);
    expect(nodes[0].start.mock.calls[0][1]).toBeCloseTo(4.00001);
    expect(nodes[0].start.mock.calls[0][2]).toBeCloseTo(8.8);
    const gain = gains[0].gain;
    expect(gain.value).toBe(0);
    expect(gain.setValueAtTime.mock.calls[0]).toEqual([0, run.startAt]);
    expect(gain.linearRampToValueAtTime.mock.calls[0]).toEqual([1, run.startAt + 0.005]);
    expect(gain.linearRampToValueAtTime.mock.calls[1][0]).toBe(0);
    expect(gain.linearRampToValueAtTime.mock.calls[1][1]).toBeCloseTo(run.startAt + 8.8);
    run.stop();
    run.stop();
    expect(gains.every((item) => item.disconnect.mock.calls.length === 1)).toBe(true);
    expect(nodes.every((item) => item.disconnect.mock.calls.length === 1)).toBe(true);
  });
});

describe('Set Lab transport controller', () => {
  it('stops global audio after preparation, pauses on the audio clock, resumes and resets to zero', async () => {
    const { fake, at, controller, nodes, stopGlobal, callbacks } = fakeClock();
    const prepare = vi.fn<SetLabPrepare>(async () => prepared);
    const play = controller.play(prepare);
    expect(fake.resume).toHaveBeenCalledOnce();
    expect(controller.getStatus()).toBe('preparing');
    expect(stopGlobal).not.toHaveBeenCalled();
    await play;
    expect(stopGlobal).toHaveBeenCalledOnce();
    at(26.05);
    expect(controller.getSnapshot().positionSeconds).toBeCloseTo(16, 9);
    controller.pause();
    expect(controller.getSnapshot()).toMatchObject({ status: 'paused', positionSeconds: 16 });
    expect(callbacks.size).toBe(0);
    const previous = nodes.slice();
    await controller.play(prepare);
    expect(prepare).toHaveBeenCalledOnce();
    expect(previous.every((item) => item.disconnect.mock.calls.length === 1)).toBe(true);
    expect(nodes.slice(5)).toHaveLength(4);
    controller.stopAndReset();
    expect(controller.getSnapshot()).toEqual({ status: 'idle', positionSeconds: 0, error: null });
    controller.dispose();
    expect(fake.close).toHaveBeenCalledOnce();
  });

  it('ends automatically and ignores an ended event from a superseded schedule', async () => {
    const { controller, nodes, fake, callbacks } = fakeClock();
    const prepare = vi.fn<SetLabPrepare>(async () => prepared);
    await controller.play(prepare);
    const stale = nodes.at(-1)?.onended;
    controller.stopAndReset();
    await controller.play(prepare);
    stale?.();
    expect(controller.getStatus()).toBe('playing');
    nodes.at(-1)?.onended?.();
    expect(controller.getSnapshot()).toMatchObject({ status: 'ended', positionSeconds: 80 });
    expect(callbacks.size).toBe(0);
    controller.dispose();
    expect(fake.close).toHaveBeenCalledOnce();
  });

  it('discards a cancelled or stale preparation while a newer one can play', async () => {
    const { controller, nodes, stopGlobal } = fakeClock();
    let resolve!: (value: PreparedSetLabClip[]) => void;
    let signal!: AbortSignal;
    const slow: SetLabPrepare = (_context, request) => {
      signal = request;
      return new Promise((done) => { resolve = done; });
    };
    const old = controller.play(slow);
    controller.stopAndReset();
    expect(signal.aborted).toBe(true);
    await controller.play(async () => prepared);
    resolve(prepared);
    await old;
    expect(nodes).toHaveLength(5);
    expect(stopGlobal).toHaveBeenCalledOnce();
    expect(controller.getStatus()).toBe('playing');
    controller.dispose();
  });

  it('clears playback and cached clips when USB access is released', async () => {
    const { controller, fake, nodes } = fakeClock();
    const unregister = registerUsbPlaybackStopHandler(controller.sourceChanged);
    const prepare = vi.fn<SetLabPrepare>(async () => prepared);
    try {
      await controller.play(prepare);
      await expect(stopUsbBackedPlayback()).resolves.toEqual([]);
      expect(controller.getSnapshot()).toMatchObject({ status: 'error', positionSeconds: 0, error: expect.stringContaining('source changed') });
      expect(nodes.every((node) => node.disconnect.mock.calls.length === 1)).toBe(true);
      expect(fake.close).toHaveBeenCalledOnce();
      await controller.play(prepare);
      expect(prepare).toHaveBeenCalledTimes(2);
    } finally {
      unregister();
      controller.dispose();
    }
  });

  it('reports a preparation failure without scheduling any audio', async () => {
    const { controller, nodes, stopGlobal } = fakeClock();
    await controller.play(async () => { throw new Error('Slot 3 could not be decoded.'); });
    expect(controller.getSnapshot()).toEqual({ status: 'error', positionSeconds: 0, error: 'Slot 3 could not be decoded.' });
    expect(nodes).toHaveLength(0);
    expect(stopGlobal).not.toHaveBeenCalled();
  });

  it('keys playback to source and section changes, independently of slot selection or locks', () => {
    const key = setLabAudioPlanKey(scope, fiveSlots);
    const [first, second, third, fourth, fifth] = fiveSlots;
    expect(setLabAudioPlanKey(scope, [{ ...first, locked: true }, second, third, fourth, fifth])).toBe(key);
    expect(setLabAudioPlanKey(scope, [{ ...first, section: { ...first.section, endMs: 8000 }, barCount: 4 },
      second, third, fourth, fifth])).not.toBe(key);
    expect(setLabAudioPlanKey({ ...scope, userId: 'other' }, fiveSlots)).not.toBe(key);
  });
});
