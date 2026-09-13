import type { RekordboxImport } from '../../types';

export type DeleteActiveStrategy = 'activate_next' | 'start_over';

const PENDING_HARD_DELETE_STATUSES = new Set<RekordboxImport['status']>([
  'cancel_requested',
  'stopping',
  'deleting',
]);

export const USABLE_LIBRARY_STATUSES = ['completed', 'paused', 'interrupted'] as const;

/** True when the import is a stable snapshot eligible for hard-delete fallback/recovery. */
export function isUsableLibrarySnapshot(item: RekordboxImport): boolean {
  return Boolean(item.library_ready_at)
    && USABLE_LIBRARY_STATUSES.some((status) => status === item.status);
}

/**
 * True when the import has completed metadata ingestion and can be browsed by
 * the user. A `processing` import with `library_ready_at` set qualifies —
 * deep track analysis may still be running in the background.
 *
 * This is intentionally broader than {@link isUsableLibrarySnapshot}, which is
 * reserved for hard-delete fallback and other destructive-operation safety
 * checks that require a fully-settled stable snapshot.
 */
export function isBrowseableLibrarySnapshot(item: RekordboxImport): boolean {
  if (!item.library_ready_at) return false;
  // Statuses that mean the import is gone or being destroyed are not browseable
  // even if library_ready_at was previously set.
  const nonBrowseable = new Set<RekordboxImport['status']>([
    'cancel_requested', 'stopping', 'deleting', 'cancelled', 'failed',
  ]);
  return !nonBrowseable.has(item.status);
}

export function getNextUsableLibrarySnapshot(
  imports: RekordboxImport[],
  deletingImportId: string,
): RekordboxImport | null {
  return imports.find((item) => item.id !== deletingImportId && isUsableLibrarySnapshot(item)) ?? null;
}

export function isDeleteConfirmationValid(value: string): boolean {
  return value === 'DELETE';
}

export function isPendingHardDelete(item: RekordboxImport): boolean {
  return PENDING_HARD_DELETE_STATUSES.has(item.status)
    && (item.delete_active_strategy === 'activate_next' || item.delete_active_strategy === 'start_over');
}

export function getPersistedDeleteStrategy(item: RekordboxImport): DeleteActiveStrategy | null {
  return isPendingHardDelete(item) ? item.delete_active_strategy ?? null : null;
}
