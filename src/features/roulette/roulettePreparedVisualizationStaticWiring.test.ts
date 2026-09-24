import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const view = read('src/components/roulette/RouletteView.tsx');
const hook = read('src/features/roulette/useRouletteAudioRuntime.ts');
const runtime = read('src/features/roulette/rouletteAudioRuntime.ts');
const actions = read('src/features/roulette/rouletteActions.ts');

describe('Roulette prepared-preview visualization wiring', () => {
  it('renders both prepared source waveforms without requiring the transport to be playing', () => {
    expect(view).toContain('data-testid={`roulette-${role}-waveform`}');
    expect(hook).toContain('commitPreparedResult');
    expect(hook).toContain('waveforms: result.waveforms');
    expect(hook).not.toMatch(/prepareSources[\s\S]{0,240}status:\s*'playing'/);
  });

  it('shows the exact selected 16-bar parent-track window boundaries', () => {
    expect(view).toContain('preparedWindow?.sourceTimeMs');
    expect(view).toContain('preparedWindow?.windowEndMs');
    expect(view).toContain('preparedWindow?.requestedBars ?? 16');
    expect(view).toContain('roulette-${role}-window-summary');
  });

  it('uses the actual prepared anchor provenance for alignment labels', () => {
    expect(view).toContain('anchorLabel(preparedWindow?.provenance)');
    expect(view).toContain('roulette-${role}-anchor');
    expect(runtime).toContain('anchors: { vocal: vocalAnchor, instrumental: instrumentalAnchor }');
  });

  it('uses one shared normalized progress value with source-specific playhead selectors', () => {
    expect(view).toContain('style={{ left: `${playback.progress * 100}%` }}');
    expect(view).toContain('data-testid={`roulette-${role}-playhead`}');
    expect(view).not.toContain('roulette-shared-playhead');
  });

  it('preserves prepared waveforms, bars, anchors, and compatibility when Stop is pressed', () => {
    expect(hook).toContain('waveforms: options.resetVisuals ? { vocal: [], instrumental: [] } : previous.waveforms');
    expect(hook).toContain('barFractions: options.resetVisuals ? [] : previous.barFractions');
    expect(hook).toContain("anchors: options.resetVisuals ? { vocal: null, instrumental: null } : previous.anchors");
    expect(hook).toContain('compatibility: options.resetVisuals ? null : previous.compatibility');
    expect(view).toContain('onClick={() => actions.stop()}');
  });

  it('publishes a replacement visualization only after the source or pair commit succeeds', () => {
    expect(actions).toMatch(/dispatch\(\{[\s\S]*?type: 'commit-source'[\s\S]*?\}\);\s*commitPreparedSources\(prepared\);/);
    expect(actions).toMatch(/dispatch\(\{ type: 'commit-pair'[\s\S]*?\}\);\s*commitPreparedSources\(prepared\);/);
  });

  it('renders compatibility facts supplied by runtime preparation rather than a UI-side score', () => {
    expect(runtime).toContain('compatibility: {');
    expect(runtime).toContain('originalBpm: {');
    expect(runtime).toContain('bpmDifference: Math.abs');
    expect(runtime).toContain('classifyCamelotRelationship');
    expect(view).toContain('data-testid="roulette-compatibility-summary"');
    expect(view).not.toContain('Compatibility score');
  });

  it('shows bar structure over each prepared waveform', () => {
    expect(runtime).toContain('buildRouletteBarFractions(playbackDuration, alignment.barDurationSeconds)');
    expect(view).toContain('playback.barFractions.map');
    expect(view).toContain('data-testid={`roulette-${role}-bar-marker`}');
  });

  it('keeps the existing playback and replacement controls intact', () => {
    expect(view).toContain('label="Play Roulette"');
    expect(view).toContain('label="Stop Roulette"');
    expect(view).toContain('Change Vocal');
    expect(view).toContain('Change Instrumental');
    expect(view).toContain('Roulette Both');
  });
});
