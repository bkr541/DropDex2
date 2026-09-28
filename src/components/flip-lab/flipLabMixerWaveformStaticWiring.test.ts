import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const view = fs.readFileSync(path.join(root, 'src/components/flip-lab/FlipLabView.tsx'), 'utf8');
const hook = fs.readFileSync(path.join(root, 'src/components/flip-lab/useFlipLabAudioRuntime.ts'), 'utf8');

describe('Flip Lab mixer, prepared waveform, and candidate preview wiring', () => {
  it('renders large role waveforms from prepared runtime peaks rather than selected parent-track waveform state', () => {
    expect(view).toContain('visualResult?.waveforms.vocal ?? []');
    expect(view).toContain('visualResult?.waveforms.instrumental ?? []');
    expect(view).toContain('flip-lab-vocal-stem-waveform');
    expect(view).toContain('flip-lab-instrumental-stem-waveform');
    expect(view).not.toContain('vocalWaveformState={');
    expect(view).not.toContain('instrWaveformState={');
    expect(hook).toContain('runtimeRef.current!.prepare(');
  });

  it('uses real accessible EQ, mix, and loop controls backed by runtime state', () => {
    expect(view).toContain('aria-label={`${roleLabel} ${band} EQ`}');
    expect(view).toContain('formatFlipLabEqDb(value)');
    expect(view).toContain('aria-label="Vocal and instrumental mix"');
    expect(view).toContain('aria-label="Flip Lab loop length"');
    expect(hook).toContain('runtimeRef.current?.setEq(eq)');
    expect(hook).toContain('runtimeRef.current?.setMix(mix)');
    expect(hook).toContain('runtimeRef.current?.setLoopEndSeconds');
  });

  it('keeps candidate preview separate from row selection without invalid nested button markup', () => {
    expect(view).toContain('role="button"');
    expect(view).toContain('event.stopPropagation();');
    expect(view).toContain("onPreview={() => onPreview(c.track)}");
    expect(view).toContain('toggleCandidatePreview');
    expect(view).not.toContain('<button\n      type="button"\n      onClick={onSelect}');
  });

  it('makes candidate preview and main pair playback mutually exclusive and cleans preview media up', () => {
    expect(hook).toContain('stopCandidatePreview();');
    expect(hook).toContain('stop({ clearResult: false });');
    expect(hook).toContain('candidateAudioRef.current = null');
    expect(hook).toContain('releaseCandidateAudio(audio);');
  });
});
