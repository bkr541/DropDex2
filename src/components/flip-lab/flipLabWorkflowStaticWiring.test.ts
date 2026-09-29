import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const view = read('src/components/flip-lab/FlipLabView.tsx');
const hook = read('src/components/flip-lab/useFlipLab.ts');
const separation = read('src/components/flip-lab/flipLabSeparation.ts');
const candidates = read('src/components/flip-lab/flipLabCandidates.ts');
const app = read('src/App.tsx');
const developer = read('src/components/profile/DeveloperTab.tsx');

describe('Flip Lab workflow', () => {
  it('does no stem work on selection; separation starts only from the Flip button', () => {
    expect(view).not.toContain('flipLabStemLifecycle');
    expect(view).toContain('data-testid="flip-lab-flip"');
    expect(view).toContain('void flipLab.flip({');
    expect(hook).toContain('separateFlipLabPair(');
  });

  it('switches the opposite list to Suggested when a track is selected', () => {
    expect(view).toContain("if (role === 'vocal') setInstrTab('suggested');");
    expect(view).toContain("else setVocalTab('suggested');");
  });

  it('shows progress, locks both lists and explains why while separating', () => {
    expect(view).toContain('<FlipProgressCircle progress={progress} />');
    expect(view).toContain('Track Selection is disabled until stem separation is finished');
    expect(view.match(/disabled=\{busy\}/g)?.length).toBe(2);
    expect(view).toContain('data-testid="flip-lab-messages"');
  });

  it('keeps play disabled and waveforms dimmed with a spinner until stems are ready', () => {
    expect(view).toContain("canPlay={state.phase === 'ready'}");
    expect(view).toContain('{busy && <LoadingOverlay />}');
  });

  it('uses the instrumental BPM as the master and enforces the 5 BPM limit', () => {
    expect(hook).toContain('difference > FLIP_LAB_MAX_BPM_DIFFERENCE');
    expect(hook).toContain('const stretchRatio = timeline.tempoRatio / pitch;');
  });

  it('offers Key Shift on the vocal header row', () => {
    expect(view).toContain('data-testid="flip-lab-key-shift"');
    expect(view).toContain('onToggle: (next) => { void flipLab.setKeyShift(next); }');
  });

  it('never writes Flip Lab work to the database', () => {
    expect(separation).not.toContain('supabase');
    expect(separation).not.toContain('commitReadyPair');
    expect(hook).not.toContain('supabase');
    expect(candidates).not.toContain('roulette_stem_assets');
  });

  it('removes the Roulette screen and exposes Empty Stem Cache in the Developer tab', () => {
    expect(app).not.toContain('RouletteView');
    expect(app).not.toContain('RouletteSessionProvider');
    expect(developer).toContain('Empty Stem Cache');
    expect(developer).toContain('clearFlipLabStemCache');
  });
});
