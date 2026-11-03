import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');

// Every page gets the same space above its first element from <main> in App.tsx (pt-6, or p-6 for
// Flip Lab). Page components must not add their own top padding on top of it.
describe('page top padding is standard', () => {
  it('App.tsx gives every page the same top padding', () => {
    const app = read('./App.tsx');
    expect(app).toContain("'flex min-h-0 flex-col overflow-hidden p-6'");
    expect(app).toContain("'overflow-y-auto px-6 pt-6 pb-32 md:pb-6'");
  });
  it('Audition adds no extra top padding', () => {
    expect(read('./components/audition/AuditionView.tsx')).not.toMatch(/className="[^"]*\bpt-\d[^"]*" data-testid="audition-view"/);
  });
  it('the Drop Lab selected-track header adds no top padding', () => {
    expect(read('./components/drop-lab/DropLabTrackHeader.tsx')).toContain("side === 'left' ? 'pb-2 pt-0' : 'py-2'");
  });
});
