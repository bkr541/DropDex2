import { describe, expect, it } from 'vitest';
import type { RekordboxImport } from '../../types';
import {
  getNextUsableLibrarySnapshot,
  getPersistedDeleteStrategy,
  isBrowseableLibrarySnapshot,
  isDeleteConfirmationValid,
  isPendingHardDelete,
  isUsableLibrarySnapshot,
} from './libraryDeletion';

function snapshot(
  id: string,
  status: RekordboxImport['status'],
  libraryReady = true,
): RekordboxImport {
  return {
    id,
    user_id: 'user-1',
    source_filename: `${id}.db`,
    source_type: 'onelibrary',
    device_name: null,
    imported_at: '2026-08-16T12:00:00Z',
    track_count: 0,
    playlist_count: 0,
    status,
    error_message: null,
    retryable: false,
    library_ready_at: libraryReady ? '2026-08-16T12:01:00Z' : null,
  } as RekordboxImport;
}

describe('library deletion decisions', () => {
  it('requires the exact case-sensitive DELETE confirmation', () => {
    expect(isDeleteConfirmationValid('DELETE')).toBe(true);
    expect(isDeleteConfirmationValid('delete')).toBe(false);
    expect(isDeleteConfirmationValid('Delete')).toBe(false);
    expect(isDeleteConfirmationValid('DEL')).toBe(false);
    expect(isDeleteConfirmationValid('DELETE ')).toBe(false);
    expect(isDeleteConfirmationValid(' DELETE')).toBe(false);
    expect(isDeleteConfirmationValid('DELETE\n')).toBe(false);
    expect(isDeleteConfirmationValid('')).toBe(false);
  });

  it('isUsableLibrarySnapshot — stable fallback/hard-delete gate only (completed/paused/interrupted)', () => {
    expect(isUsableLibrarySnapshot(snapshot('completed', 'completed'))).toBe(true);
    expect(isUsableLibrarySnapshot(snapshot('paused', 'paused'))).toBe(true);
    expect(isUsableLibrarySnapshot(snapshot('interrupted', 'interrupted'))).toBe(true);
    expect(isUsableLibrarySnapshot(snapshot('failed', 'failed'))).toBe(false);
    expect(isUsableLibrarySnapshot(snapshot('cancelled', 'cancelled'))).toBe(false);
    expect(isUsableLibrarySnapshot(snapshot('stopping', 'stopping'))).toBe(false);
    expect(isUsableLibrarySnapshot(snapshot('deleting', 'deleting'))).toBe(false);
    // processing is NOT a stable snapshot even with library_ready_at set
    expect(isUsableLibrarySnapshot(snapshot('processing', 'processing'))).toBe(false);
    expect(isUsableLibrarySnapshot(snapshot('pre-ready-paused', 'paused', false))).toBe(false);
    expect(isUsableLibrarySnapshot(snapshot('pre-ready-interrupted', 'interrupted', false))).toBe(false);
  });

  it('isBrowseableLibrarySnapshot — processing+library_ready_at is browseable, pre-ready and destroyed are not', () => {
    // Stable statuses remain browseable
    expect(isBrowseableLibrarySnapshot(snapshot('completed', 'completed'))).toBe(true);
    expect(isBrowseableLibrarySnapshot(snapshot('paused', 'paused'))).toBe(true);
    expect(isBrowseableLibrarySnapshot(snapshot('interrupted', 'interrupted'))).toBe(true);
    // Processing with library_ready_at IS browseable (the key fix)
    expect(isBrowseableLibrarySnapshot(snapshot('processing', 'processing'))).toBe(true);
    // Pre-library-ready processing is NOT browseable
    expect(isBrowseableLibrarySnapshot(snapshot('pre-ready-processing', 'processing', false))).toBe(false);
    // Destroyed/cancellation statuses are NOT browseable even if library_ready_at was set
    expect(isBrowseableLibrarySnapshot(snapshot('failed', 'failed'))).toBe(false);
    expect(isBrowseableLibrarySnapshot(snapshot('cancelled', 'cancelled'))).toBe(false);
    expect(isBrowseableLibrarySnapshot(snapshot('stopping', 'stopping'))).toBe(false);
    expect(isBrowseableLibrarySnapshot(snapshot('deleting', 'deleting'))).toBe(false);
    expect(isBrowseableLibrarySnapshot(snapshot('cancel_requested', 'cancel_requested'))).toBe(false);
    // Pre-library-ready paused/interrupted are also not browseable
    expect(isBrowseableLibrarySnapshot(snapshot('pre-ready-paused', 'paused', false))).toBe(false);
    expect(isBrowseableLibrarySnapshot(snapshot('pre-ready-interrupted', 'interrupted', false))).toBe(false);
  });

  it('recognizes only persisted stopping/deleting rows as pending hard deletes', () => {
    const pending = { ...snapshot('pending', 'stopping'), delete_active_strategy: 'start_over' as const };
    const ordinaryStopping = snapshot('ordinary-stop', 'stopping');

    expect(isPendingHardDelete(pending)).toBe(true);
    expect(getPersistedDeleteStrategy(pending)).toBe('start_over');
    expect(isPendingHardDelete(ordinaryStopping)).toBe(false);
    expect(getPersistedDeleteStrategy(ordinaryStopping)).toBeNull();
  });

  it('selects the newest remaining usable snapshot from the already date-sorted import list', () => {
    const imports = [
      snapshot('active', 'completed'),
      snapshot('pre-ready-interrupted', 'interrupted', false),
      snapshot('failed-newer', 'failed'),
      snapshot('fallback', 'paused'),
      snapshot('older', 'completed'),
    ];

    expect(getNextUsableLibrarySnapshot(imports, 'active')?.id).toBe('fallback');
  });
});
