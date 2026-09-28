import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const view = fs.readFileSync(path.join(root, 'src/components/flip-lab/FlipLabView.tsx'), 'utf8');
const hook = fs.readFileSync(path.join(root, 'src/components/flip-lab/useFlipLabAudioRuntime.ts'), 'utf8');

describe('Flip Lab mixer, prepared waveform, and candidate preview wiring', () => {
  it('renders loaded-pair waveforms from track preview waveforms, not prepared stems', () => {
    expect(view).toContain('vocalWaveformState={getWaveformState(selectedVocal.track.id)}');
    expect(view).toContain('instrWaveformState={getWaveformState(selectedInstr.track.id)}');
    expect(view).not.toContain('PreparedStemWaveform');
    expect(view).not.toContain('visualResult');
    expect(hook).toContain('runtimeRef.current!.prepare(');
  });

  it('keeps EQ, mix, and loop runtime controls in the audio hook', () => {
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
