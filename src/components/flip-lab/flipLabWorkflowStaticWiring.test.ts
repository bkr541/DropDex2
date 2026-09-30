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
    expect(view).toContain('{busy && <FlipLoadingOverlay phase={flipState.phase} progress={flipState.progress} />}');
    expect(view).toContain('Track Selection is disabled until stem separation is finished');
    expect(view.match(/disabled=\{busy\}/g)?.length).toBe(2);
    expect(view).not.toContain('data-testid="flip-lab-messages"');
    expect(view).toContain('<NotificationCenter notifications={notifications} onDismiss={dismissNotification}');
  });

  it('keeps play disabled and fills each waveform left to right as its stem separates', () => {
    expect(view).toContain("canPlay={state.phase === 'ready'}");
    expect(view).toContain('const vocalFill = separating ? Math.max(0, Math.min(1, state.progress * 2)) : 1;');
    expect(view).toContain('const instrFill = separating ? Math.max(0, Math.min(1, (state.progress - 0.5) * 2)) : 1;');
    expect(view).toContain('clipPath: `inset(0 ${hidden} 0 0)`');
  });

  it('uses an icon-only glow Flip button', () => {
    expect(view).toContain('<GlowFlipButton enabled={canFlip} onClick={onFlip} />');
    expect(view).toContain("left: 'calc(100% + 6px)'");
    expect(view).toContain('<FlipIcon size={26} />');
  });

  it('uses the instrumental BPM as the master and enforces the 5 BPM limit', () => {
    expect(hook).toContain('difference > FLIP_LAB_MAX_BPM_DIFFERENCE');
    expect(hook).toContain('const stretchRatio = timeline.tempoRatio / pitch;');
  });

  it('offers Key Shift on the vocal header row', () => {
    expect(view).toContain('testId="flip-lab-key-shift"');
    expect(view).toContain('onToggle: (next) => { void flipLab.setKeyShift(next); }');
  });

  it('lets one stem be soloed at a time and grays out the muted waveform', () => {
    expect(hook).toContain('const next = soloRef.current === stem ? null : stem;');
    expect(view).toContain("solo={{ enabled: state.solo === 'vocal'");
    expect(view).toContain("solo={{ enabled: state.solo === 'instrumental'");
    expect(view).toContain("muted={state.solo === 'instrumental'}");
    expect(view).toContain("muted={state.solo === 'vocal'}");
  });

  it('puts vocal EQ knobs left and instrumental EQ knobs right of a centered half-width dock', () => {
    expect(view).toContain('<StemEqKnobs stem="vocal"');
    expect(view).toContain('<StemEqKnobs stem="instrumental"');
    expect(view).toContain("width: '50%', flexShrink: 0");
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
