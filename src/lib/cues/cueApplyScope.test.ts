import { describe, expect, it } from 'vitest';
import { resolveCueApplySelection, type CueApplyScope } from './cueApplyScope';

const rows = [
  { importId: 'import-1', trackId: 'track-a', revision: 1 },
  { importId: 'import-1', trackId: 'track-b', revision: 2 },
  { importId: 'import-2', trackId: 'track-c', revision: 3 },
];

describe('cue apply production scope selection', () => {
  it('Apply Track returns exactly the selected saved track', () => {
    const scope: CueApplyScope = { kind: 'track', importId: 'import-1', trackId: 'track-b' };
    const result = resolveCueApplySelection(rows, scope);
    expect(result.error).toBeNull();
    expect(result.rows.map((row) => row.trackId)).toEqual(['track-b']);
  });

  it('Apply All returns only the pending saved set for the current import', () => {
    const result = resolveCueApplySelection(rows, { kind: 'all', importId: 'import-1' });
    expect(result.error).toBeNull();
    expect(result.rows.map((row) => row.trackId)).toEqual(['track-a', 'track-b']);
  });

  it('does not silently widen a track action when that track has no pending draft', () => {
    const result = resolveCueApplySelection(rows, { kind: 'track', importId: 'import-1', trackId: 'missing' });
    expect(result.rows).toEqual([]);
    expect(result.error).toMatch(/selected track/i);
  });
});
