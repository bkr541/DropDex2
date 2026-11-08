import { scheduleAudioBufferClips, stopAndDisconnectAudioNodes, type AudioBufferClip } from '../../lib/audio/webAudioScheduling';
import type { PreparedSetLabClip } from './prepareSetLabAudio';

const LEAD_IN_SECONDS = 0.05;
const EDGE_RAMP_SECONDS = 0.005;

export function scheduleSetLabAudio(context: AudioContext, prepared: readonly PreparedSetLabClip[], fromSeconds: number) {
  if (prepared.length !== 5 || !Number.isFinite(fromSeconds) || fromSeconds < 0) {
    throw new Error('A Set Lab preview requires five ordered sections and a valid start position.');
  }
  const gains: GainNode[] = [];
  const clips: AudioBufferClip[] = [];
  let nodes: AudioBufferSourceNode[] = [];
  let elapsedMs = 0;
  function stop() {
    for (const node of nodes) node.onended = null;
    stopAndDisconnectAudioNodes(nodes);
    nodes = [];
    for (const gain of gains.splice(0)) {
      try { gain.disconnect(); } catch { /* context may already be closing */ }
    }
  }

  try {
    for (const clip of prepared) {
      if (!Number.isFinite(clip.durationMs) || clip.durationMs <= 0) throw new Error('A Set Lab clip has an invalid duration.');
      const clipStart = elapsedMs / 1000;
      elapsedMs += clip.durationMs;
      const clipEnd = elapsedMs / 1000;
      if (clipEnd <= fromSeconds) continue;
      const skip = Math.max(0, fromSeconds - clipStart);
      const gain = context.createGain();
      gains.push(gain);
      gain.gain.value = 0;
      gain.connect(context.destination);
      clips.push({
        buffer: clip.buffer,
        offsetSeconds: clip.offsetSeconds + skip,
        durationSeconds: clipEnd - Math.max(fromSeconds, clipStart),
        startOffsetSeconds: Math.max(0, clipStart - fromSeconds),
        destination: gain,
      });
    }
    const scheduled = scheduleAudioBufferClips(context, clips, { leadInSeconds: LEAD_IN_SECONDS });
    nodes = scheduled.nodes;
    clips.forEach((clip, index) => {
      const start = scheduled.startAt + (clip.startOffsetSeconds ?? 0);
      const end = start + clip.durationSeconds;
      const ramp = Math.min(EDGE_RAMP_SECONDS, clip.durationSeconds / 4);
      const { gain } = gains[index];
      gain.setValueAtTime(0, start);
      gain.linearRampToValueAtTime(1, start + ramp);
      gain.setValueAtTime(1, end - ramp);
      gain.linearRampToValueAtTime(0, end);
    });
    return {
      startAt: scheduled.startAt,
      endAt: scheduled.endAt,
      lastNode: scheduled.nodes[scheduled.nodes.length - 1],
      stop,
    };
  } catch (error) {
    stop();
    throw error;
  }
}
