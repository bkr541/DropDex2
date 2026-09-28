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
  it('wires transport, runtime BPM, SYNC, and both playheads to the shared Roulette runtime adapter', () => {
    expect(source).toContain('useFlipLabAudioRuntime');
    expect(source).toContain('flip-lab-master-bpm');
    expect(source).toContain('flip-lab-vocal-playhead');
    expect(source).toContain('flip-lab-instrumental-playhead');
    expect(source).toContain('onSeekBackwardBar');
    expect(source).toContain('onSeekForwardBar');
    expect(source).not.toContain('>125.0<');
  });

  it('disposes the shared runtime when Flip Lab unmounts', () => {
    expect(audioHook).toContain('void runtime?.dispose()');
  });

});
