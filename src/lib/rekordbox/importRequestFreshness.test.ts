import { describe, expect, it } from 'vitest';
import { isFreshImportResponse } from './importRequestFreshness';

describe('import request freshness', () => {
  it('ignores Import A when the screen has switched to Import B', () => {
    expect(isFreshImportResponse({
      requestedImportId: 'A', currentImportId: 'B', responseImportId: 'A',
      requestGeneration: 1, currentGeneration: 2, aborted: false,
    })).toBe(false);
  });

  it('accepts the response for the currently selected import', () => {
    expect(isFreshImportResponse({
      requestedImportId: 'B', currentImportId: 'B', responseImportId: 'B',
      requestGeneration: 2, currentGeneration: 2, aborted: false,
    })).toBe(true);
  });

  it('ignores an aborted request even when IDs match', () => {
    expect(isFreshImportResponse({
      requestedImportId: 'A', currentImportId: 'A', responseImportId: 'A',
      requestGeneration: 1, currentGeneration: 1, aborted: true,
    })).toBe(false);
  });
});
