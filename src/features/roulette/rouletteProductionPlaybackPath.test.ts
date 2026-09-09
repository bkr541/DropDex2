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
    expect(runtime).toContain('createRouletteTimeStretchProcessor');
    expect(runtime).toContain('tempoProcessor.prepare');
    expect(runtime).toContain('alignment.tempo.vocal');
    expect(runtime).toContain('startOffsetSeconds: 0');
    expect(runtime.match(/startOffsetSeconds: 0/g)).toHaveLength(2);
    expect(runtime).not.toContain('.playbackRate');
    const processor = readFileSync('src/features/roulette/wsolaTimeStretch.ts', 'utf8');
    expect(processor).toContain('Waveform Similarity Overlap-Add');
    expect(processor).not.toContain('playbackRate');
  });

  it('renders only decoded stem-derived waveform peaks with one shared playhead', () => {
    const view = readFileSync('src/components/roulette/RouletteView.tsx', 'utf8');
    const runtime = readFileSync('src/features/roulette/rouletteAudioRuntime.ts', 'utf8');

    expect(runtime).toContain('extractRouletteStemPeaks');
    expect(view).toContain('peaks={peaks}');
    expect(view).toContain('roulette-shared-playhead');
    expect(view).not.toContain('fetchTrackPreviewWaveform');
  });

  it('wires all three production replacement controls through matcher resolution and audio preflight before commit', () => {
    const view = readFileSync('src/components/roulette/RouletteView.tsx', 'utf8');
    const provider = readFileSync('src/features/roulette/RouletteSessionContext.tsx', 'utf8');
    const actions = readFileSync('src/features/roulette/rouletteActions.ts', 'utf8');
    const hook = readFileSync('src/features/roulette/useRouletteAudioRuntime.ts', 'utf8');

    expect(view).toContain("actions.replaceSource('vocal')");
    expect(view).toContain("actions.replaceSource('instrumental')");
    expect(view).toContain('actions.replaceBoth()');
    expect(provider).toContain('prepareSources: audio.prepareSources');
    expect(actions).toContain('matcher.resolveReplacement');
    expect(actions).toContain('matcher.resolvePair');
    expect(actions).toContain('await prepareSources(nextSources, controller.signal)');
    expect(hook).toContain('runtimeRef.current!.prepare(sources, signal)');
  });

});
