import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const source = fs.readFileSync(path.join(root, 'src/components/flip-lab/FlipLabView.tsx'), 'utf8');
const audioHook = fs.readFileSync(path.join(root, 'src/components/flip-lab/useFlipLabAudioRuntime.ts'), 'utf8');

describe('Flip Lab analysis UI truth wiring', () => {
  it('does not fabricate a waveform when Rekordbox waveform analysis is unavailable or failed', () => {
    expect(source).not.toContain('MultiColorWaveform');
    expect(source).toContain('<RekordboxPreviewWaveform');
  });

  it('does not render a fixed playhead before runtime playback position exists', () => {
    expect(source).not.toContain("left: '55%'");
    expect(source).not.toContain('var(--color-waveform-playhead)');
  });

  it('does not retain placeholder phrase/bar truth or inert overflow glyphs', () => {
    expect(source).not.toContain('Great Match');
    expect(source).not.toContain('Phrase analysis coming soon');
    expect(source).not.toContain('BAR_NUMBERS');
    expect(source).not.toContain('VOCAL_SECTIONS');
    expect(source).not.toContain('INSTR_SECTIONS');
    expect(source).not.toContain('···');
  });
  it('shows an empty top section until the user explicitly loads a selected pair', () => {
    expect(source).toContain('useFlipLabAudioRuntime');
    expect(source).toContain('data-testid="flip-lab-empty-pair"');
    expect(source).toContain('data-testid="flip-lab-load-pair"');
    expect(source).toContain('pairLoaded && selectedVocal !== null && selectedInstr !== null');
    expect(source).not.toContain('>125.0<');
  });

  it('disposes the shared runtime when Flip Lab unmounts', () => {
    expect(audioHook).toContain('void runtime?.dispose()');
  });

});
