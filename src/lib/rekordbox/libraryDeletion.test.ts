import { describe, expect, it } from 'vitest';
import type { RekordboxImport } from '../../types';
import {
  getNextUsableLibrarySnapshot,
  isDeleteConfirmationValid,
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
    expect(isDeleteConfirmationValid('DELETE ')).toBe(false);
  });

  it('only treats activatable library snapshots as usable fallbacks', () => {
    expect(isUsableLibrarySnapshot(snapshot('completed', 'completed'))).toBe(true);
    expect(isUsableLibrarySnapshot(snapshot('paused', 'paused'))).toBe(true);
    expect(isUsableLibrarySnapshot(snapshot('interrupted', 'interrupted'))).toBe(true);
    expect(isUsableLibrarySnapshot(snapshot('failed', 'failed'))).toBe(false);
    expect(isUsableLibrarySnapshot(snapshot('cancelled', 'cancelled'))).toBe(false);
    expect(isUsableLibrarySnapshot(snapshot('stopping', 'stopping'))).toBe(false);
    expect(isUsableLibrarySnapshot(snapshot('deleting', 'deleting'))).toBe(false);
    expect(isUsableLibrarySnapshot(snapshot('processing', 'processing'))).toBe(false);
    expect(isUsableLibrarySnapshot(snapshot('pre-ready-paused', 'paused', false))).toBe(false);
    expect(isUsableLibrarySnapshot(snapshot('pre-ready-interrupted', 'interrupted', false))).toBe(false);
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
