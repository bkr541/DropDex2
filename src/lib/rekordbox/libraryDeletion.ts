import type { RekordboxImport } from '../../types';

export type DeleteActiveStrategy = 'activate_next' | 'start_over';

export function isUsableLibrarySnapshot(item: RekordboxImport): boolean {
  return item.status === 'completed' || item.status === 'paused' || item.status === 'interrupted';
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
