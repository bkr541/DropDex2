import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const contextSource = fs.readFileSync(path.join(root, 'src/features/roulette/RouletteSessionContext.tsx'), 'utf8');
const viewSource = fs.readFileSync(path.join(root, 'src/components/roulette/RouletteView.tsx'), 'utf8');

describe('Roulette source-change lifecycle wiring', () => {
  it('does not stop the audio runtime as a side effect of committed source identity changes', () => {
    expect(contextSource).not.toContain('sourceSignature');
    expect(contextSource).not.toMatch(/useEffect\(\(\) => \{\s*audio\.stop\(\{ resetVisuals: true \}\);\s*\}, \[audio\.stop,/);
  });

  it('uses explicit playback confirmation before a playing source change proceeds', () => {
    expect(viewSource).toContain("setPendingSourceChange(change)");
    expect(viewSource).toContain('rouletteSourceChangeRequiresConfirmation(playback.status, state.transport.status)');
    expect(viewSource).toContain('This action will stop current playback.');
    expect(viewSource).toContain("{ label: 'Cancel'");
    expect(viewSource).toContain("{ label: 'Continue'");
    expect(viewSource).toContain("executeRouletteSourceChange(actions, change, { stopPlaybackFirst: true })");
  });
});
