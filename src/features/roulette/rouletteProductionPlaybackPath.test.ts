import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Roulette production playback reachability', () => {
  it('wires the real Play control through the session provider into the dedicated shared-clock runtime', () => {
    const view = readFileSync('src/components/roulette/RouletteView.tsx', 'utf8');
    const provider = readFileSync('src/features/roulette/RouletteSessionContext.tsx', 'utf8');
    const hook = readFileSync('src/features/roulette/useRouletteAudioRuntime.ts', 'utf8');
    const runtime = readFileSync('src/features/roulette/rouletteAudioRuntime.ts', 'utf8');

    expect(view).toContain('void actions.play()');
    expect(provider).toContain('useRouletteAudioRuntime');
    expect(provider).toContain('play: audio.play');
    expect(hook).toContain('runtimeRef.current!.play');
    expect(runtime).toContain('resolveRouletteMusicalAnchor');
    expect(runtime).toContain('loadPhrases');
    expect(runtime).toContain('loadVocalAnalysis');
    expect(runtime).toContain('scheduleAudioBufferClips');
    expect(runtime).toContain('startOffsetSeconds: 0');
    expect(runtime.match(/startOffsetSeconds: 0/g)).toHaveLength(2);
    expect(runtime).not.toContain('.playbackRate');
  });

  it('renders only decoded stem-derived waveform peaks with one shared playhead', () => {
    const view = readFileSync('src/components/roulette/RouletteView.tsx', 'utf8');
    const runtime = readFileSync('src/features/roulette/rouletteAudioRuntime.ts', 'utf8');

    expect(runtime).toContain('extractRouletteStemPeaks');
    expect(view).toContain('peaks={peaks}');
    expect(view).toContain('roulette-shared-playhead');
    expect(view).not.toContain('fetchTrackPreviewWaveform');
  });
});
