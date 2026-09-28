import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const view = fs.readFileSync(path.join(root, 'src/components/flip-lab/FlipLabView.tsx'), 'utf8');

describe('Flip Lab final hardening UI semantics', () => {
  it('keeps readiness as status and presents Drop Lab as a separate parent-track action', () => {
    expect(view).toContain('data-testid="flip-lab-pair-ready"');
    expect(view).toContain('Ready for Flip Lab audition playback.');
    expect(view).toContain('Test Transition in Drop Lab →');
    expect(view).toContain('Selected parent tracks only');
    expect(view).not.toContain('Open in Drop Lab →');
  });

  it('provides real clear actions and no fake overflow-menu affordance', () => {
    expect(view).toContain('Clear ${role.toLowerCase()} selection');
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
