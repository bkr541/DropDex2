import { describe, expect, it } from 'vitest';
import { getImportHistoryPresentation } from './importHistoryPresentation';

describe('import history presentation', () => {
  it('presents failed imports with a retry action only when retryable', () => {
    expect(getImportHistoryPresentation('failed', true)).toMatchObject({
      label: 'Failed', tone: 'error', canRetry: true, canActivate: false, terminal: true,
    });
    expect(getImportHistoryPresentation('failed', false).canRetry).toBe(false);
  });

  it('presents cancellation as terminal and never successful', () => {
    expect(getImportHistoryPresentation('cancelled')).toMatchObject({
      label: 'Cancelled', tone: 'warning', canActivate: false, terminal: true,
    });
  });

  it('allows only completed imports to become active', () => {
    expect(getImportHistoryPresentation('completed').canActivate).toBe(true);
    expect(getImportHistoryPresentation('processing').canActivate).toBe(false);
  });
});
