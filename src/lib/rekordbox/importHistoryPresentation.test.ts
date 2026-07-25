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

  it('allows completed, paused, and interrupted snapshots to remain available', () => {
    expect(getImportHistoryPresentation('completed', false, 'partial')).toMatchObject({
      label: 'Completed with warnings', canActivate: true, tone: 'warning',
    });
    expect(getImportHistoryPresentation('processing', false, 'parsing')).toMatchObject({
      label: 'Parsing analysis data', canActivate: false, terminal: false,
    });
    expect(getImportHistoryPresentation('completed', false, 'parsing')).toMatchObject({
      label: 'Parsing analysis data', canActivate: true, terminal: false, tone: 'info',
    });
    expect(getImportHistoryPresentation('paused', true, 'paused')).toMatchObject({
      label: 'Analysis paused', canActivate: true, canRetry: true, terminal: true,
    });
    expect(getImportHistoryPresentation('interrupted', true, 'interrupted')).toMatchObject({
      label: 'Analysis interrupted', canActivate: true, canRetry: true, terminal: true,
    });
  });

  it('distinguishes pause, worker stop, and destructive deletion states', () => {
    expect(getImportHistoryPresentation('pause_requested', false, 'pause_requested')).toMatchObject({
      label: 'Stopping cloud analysis', canActivate: false, terminal: false,
    });
    expect(getImportHistoryPresentation('stopping', false, 'stopping')).toMatchObject({
      label: 'Stopping worker', canActivate: false, terminal: false,
    });
    expect(getImportHistoryPresentation('deleting', false, 'stopping')).toMatchObject({
      label: 'Deleting import', canActivate: false, terminal: false,
    });
  });

  it('does not let a stale parsing sub-state override a failed job', () => {
    expect(getImportHistoryPresentation('failed', false, 'parsing')).toMatchObject({
      label: 'Failed', terminal: true,
    });
  });
});
