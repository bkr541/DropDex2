import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const view = fs.readFileSync(path.join(root, 'src/components/flip-lab/FlipLabView.tsx'), 'utf8');

describe('Flip Lab final hardening UI semantics', () => {
  it('uses Load Pair as the only center action with no compatibility, stem status, or Drop Lab UI', () => {
    expect(view).toContain('Load Pair');
    expect(view).not.toContain('CompatibilityPanel');
    expect(view).not.toContain('Stem Availability');
    expect(view).not.toContain('Drop Lab');
  });

  it('switches the opposite list to Suggested when a track is selected', () => {
    expect(view).toContain("if (role === 'vocal') setInstrTab('suggested');");
    expect(view).toContain("else setVocalTab('suggested');");
  });

  it('provides a real clear-pair action and no fake overflow-menu affordance', () => {
    expect(view).toContain('data-testid="flip-lab-clear-pair"');
    expect(view).toContain("clearSelection('vocal')");
    expect(view).toContain("clearSelection('instrumental')");
    expect(view).toContain('no fake overflow-menu affordance until a real menu exists');
  });

  it('hydrates and saves session state only through the import-scoped session layer', () => {
    expect(view).toContain('loadFlipLabSession(requestImportId)');
    expect(view).toContain('resolveFlipLabRestoredSelection(storedSession');
    expect(view).toContain('saveFlipLabSession({');
    expect(view).toContain('sessionHydratedImportId !== activeImportId');
  });
});
