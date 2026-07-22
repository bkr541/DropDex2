import { describe, expect, it } from 'vitest';
import { getImportHistoryPresentation } from './importHistoryPresentation';

describe('import history presentation', () => {
  it('presents failed imports with a retry action only when retryable', () => {
    expect(getImportHistoryPresentation('failed', true, 'parsing')).toMatchObject({
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
    expect(getImportHistoryPresentation('completed', false, 'partial')).toMatchObject({
      label: 'Completed with warnings', canActivate: true, tone: 'warning',
    });
    expect(getImportHistoryPresentation('processing', false, 'parsing')).toMatchObject({
      label: 'Parsing analysis data', canActivate: false, terminal: false,
    });
    expect(getImportHistoryPresentation('completed', false, 'parsing')).toMatchObject({
      label: 'Parsing analysis data', canActivate: true, terminal: false, tone: 'info',
    });
  });

  it('does not let a stale parsing sub-state override a failed job', () => {
    expect(getImportHistoryPresentation('failed', false, 'parsing')).toMatchObject({
      label: 'Failed', terminal: true,
    });
  });
});
