import type { RekordboxImport } from '../../types';

export type DeleteActiveStrategy = 'activate_next' | 'start_over';

const PENDING_HARD_DELETE_STATUSES = new Set<RekordboxImport['status']>([
  'cancel_requested',
  'stopping',
  'deleting',
]);

export const USABLE_LIBRARY_STATUSES = ['completed', 'paused', 'interrupted'] as const;

export function isUsableLibrarySnapshot(item: RekordboxImport): boolean {
  return Boolean(item.library_ready_at)
    && USABLE_LIBRARY_STATUSES.some((status) => status === item.status);
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
