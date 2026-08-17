import type { RekordboxImport } from '../../types';

export type DeleteActiveStrategy = 'activate_next' | 'start_over';

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
