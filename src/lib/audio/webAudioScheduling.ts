export interface AudioBufferClip {
  buffer: AudioBuffer;
  offsetSeconds: number;
  durationSeconds: number;
  /** Offset from the shared scheduling origin. Use 0 for simultaneous clips. */
  startOffsetSeconds?: number;
  destination?: AudioNode;
}

export interface ScheduledAudioClips {
  nodes: AudioBufferSourceNode[];
  startAt: number;
  endAt: number;
}

export function createBrowserAudioContext(): AudioContext {
  const AudioContextCtor = window.AudioContext
    || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) throw new Error('Web Audio is not supported in this browser.');
  return new AudioContextCtor();
}

export function stopAndDisconnectAudioNodes(nodes: AudioBufferSourceNode[]): void {
  for (const node of nodes) {
    try { node.stop(); } catch { /* already stopped */ }
    try { node.disconnect(); } catch { /* already disconnected */ }
  }
}

export async function closeAudioContext(context: AudioContext | null): Promise<void> {
  if (!context || context.state === 'closed') return;
  try { await context.close(); } catch { /* runtime is already tearing down */ }
}

/**
 * Schedule clips from one canonical AudioContext clock. startOffsetSeconds=0
 * on multiple clips schedules them together; increasing offsets creates a
 * deterministic sequence without introducing independent transport clocks.
 */
export function scheduleAudioBufferClips(
  context: AudioContext,
  clips: AudioBufferClip[],
  options: { leadInSeconds?: number } = {},
): ScheduledAudioClips {
  if (clips.length === 0) throw new Error('At least one audio clip is required.');
  const leadInSeconds = options.leadInSeconds ?? 0;
  if (!Number.isFinite(leadInSeconds) || leadInSeconds < 0) {
    throw new Error('Audio scheduling lead-in must be a non-negative finite number.');
  }

  const startAt = context.currentTime + leadInSeconds;
  const nodes: AudioBufferSourceNode[] = [];
  let endAt = startAt;

  try {
    for (const clip of clips) {
      const startOffsetSeconds = clip.startOffsetSeconds ?? 0;
      if (
        !Number.isFinite(clip.offsetSeconds) || clip.offsetSeconds < 0
        || !Number.isFinite(clip.durationSeconds) || clip.durationSeconds <= 0
        || !Number.isFinite(startOffsetSeconds) || startOffsetSeconds < 0
      ) {
        throw new Error('Audio clip timing must be finite and non-negative.');
      }

      const node = context.createBufferSource();
      node.buffer = clip.buffer;
      node.connect(clip.destination ?? context.destination);
      nodes.push(node);

      const clipStartAt = startAt + startOffsetSeconds;
      const clipEndAt = clipStartAt + clip.durationSeconds;
      node.start(clipStartAt, clip.offsetSeconds, clip.durationSeconds);
      node.stop(clipEndAt);
      endAt = Math.max(endAt, clipEndAt);
    }
  } catch (error) {
    stopAndDisconnectAudioNodes(nodes);
    throw error;
  }

  return { nodes, startAt, endAt };
}
