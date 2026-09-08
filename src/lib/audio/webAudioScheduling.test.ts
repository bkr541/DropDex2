import { describe, expect, it } from 'vitest';
import { scheduleAudioBufferClips, stopAndDisconnectAudioNodes } from './webAudioScheduling';

interface FakeNode {
  buffer: AudioBuffer | null;
  starts: Array<[number, number, number]>;
  stops: number[];
  connected: unknown[];
  disconnected: number;
  start: (when: number, offset: number, duration: number) => void;
  stop: (when?: number) => void;
  connect: (destination: unknown) => void;
  disconnect: () => void;
}

function fakeContext(currentTime = 10) {
  const nodes: FakeNode[] = [];
  const destination = {};
  const context = {
    currentTime,
    destination,
    createBufferSource() {
      const node: FakeNode = {
        buffer: null,
        starts: [],
        stops: [],
        connected: [],
        disconnected: 0,
        start(when, offset, duration) { this.starts.push([when, offset, duration]); },
        stop(when = 0) { this.stops.push(when); },
        connect(target) { this.connected.push(target); },
        disconnect() { this.disconnected += 1; },
      };
      nodes.push(node);
      return node;
    },
  };
  return { context: context as unknown as AudioContext, nodes, destination };
}

describe('shared Web Audio scheduling', () => {
  it('uses one canonical clock for sequential or simultaneous clip starts', () => {
    const { context, nodes } = fakeContext();
    const buffer = {} as AudioBuffer;

    const scheduled = scheduleAudioBufferClips(context, [
      { buffer, offsetSeconds: 2, durationSeconds: 4 },
      { buffer, offsetSeconds: 8, durationSeconds: 3, startOffsetSeconds: 4 },
      { buffer, offsetSeconds: 12, durationSeconds: 2, startOffsetSeconds: 0 },
    ], { leadInSeconds: 0.05 });

    expect(scheduled.startAt).toBeCloseTo(10.05);
    expect(nodes[0].starts[0]).toEqual([10.05, 2, 4]);
    expect(nodes[1].starts[0]).toEqual([14.05, 8, 3]);
    expect(nodes[2].starts[0]).toEqual([10.05, 12, 2]);
    expect(scheduled.endAt).toBeCloseTo(17.05);
  });

  it('stops and disconnects every stage-owned source node safely', () => {
    const { context, nodes } = fakeContext();
    const scheduled = scheduleAudioBufferClips(context, [
      { buffer: {} as AudioBuffer, offsetSeconds: 0, durationSeconds: 1 },
      { buffer: {} as AudioBuffer, offsetSeconds: 0, durationSeconds: 1 },
    ]);

    stopAndDisconnectAudioNodes(scheduled.nodes);
    expect(nodes.every((node) => node.stops.length >= 2)).toBe(true);
    expect(nodes.every((node) => node.disconnected === 1)).toBe(true);
  });
});
