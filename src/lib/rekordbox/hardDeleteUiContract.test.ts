import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Rekordbox hard-delete production UI contract', () => {
  it('routes Settings, background import, and import-modal deletes through the shared confirmation gate', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    const background = readFileSync('src/components/BackgroundImportPanel.tsx', 'utf8');
    const importModal = readFileSync('src/components/ImportLibraryModal.tsx', 'utf8');

    expect(app).toContain('<DeleteLibraryModal');
    expect(app).toContain('onRequestDelete={() => {');
    expect(app).toContain('onRequestDelete={(importId, executor) => {');
    expect(background).not.toContain('deleteRekordboxImport(');
    expect(background).toContain('onClick={onRequestDelete}');
    expect(importModal).toContain("if (intent !== 'pause' && importIdRef.current && onRequestDelete)");
    expect(importModal).toContain('(strategy) => executeConfirmedHardDelete(strategy, intent)');
    expect(app).toContain('if (!imp || deleteLibrarySubmittingRef.current) return;');
  });

  it('keeps known pending hard deletes observable until disappearance and stops panel polling on terminal 404', () => {
    const importList = readFileSync('src/hooks/useImportList.ts', 'utf8');
    const background = readFileSync('src/components/BackgroundImportPanel.tsx', 'utf8');

    expect(importList).toContain('isImportInFlight(item) || isPendingHardDelete(item)');
    expect(importList).toContain('if (current && isPendingHardDelete(current)) deletedIds.add(id)');
    expect(background).toContain('isExpectedHardDeleteNotFound(err, deletionPending)');
    expect(background).toContain('hardDeleteCompleteRef.current = true');
  });

  it('keeps exact case-sensitive DELETE validation centralized in DeleteLibraryModal', () => {
    const modal = readFileSync('src/components/DeleteLibraryModal.tsx', 'utf8');
    const decisions = readFileSync('src/lib/rekordbox/libraryDeletion.ts', 'utf8');

    expect(modal).toContain('isDeleteConfirmationValid(confirmation)');
    expect(modal).toContain('disabled={deleting || !confirmationValid}');
    expect(decisions).toContain("return value === 'DELETE';");
  });
  it('exposes a true Delete All reset that uses a dedicated backend delete-all endpoint', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    const modal = readFileSync('src/components/DeleteAllLibrariesModal.tsx', 'utf8');
    const api = readFileSync('src/lib/api/rekordboxImport.ts', 'utf8');

    expect(app).toContain('Delete All Rekordbox Data');
    expect(app).toContain('<DeleteAllLibrariesModal');
    expect(app).toContain('deleteAllRekordboxImports(token)');
    expect(modal).toContain("confirmation === 'DELETE ALL'");
    expect(modal).toContain('every Rekordbox snapshot owned by this account');
    expect(api).toContain('export async function deleteAllRekordboxImports');
    expect(api).toContain('`${API_BASE}/api/rekordbox/imports`');
  });

  it('bounds automatic destructive retries and preserves structured cleanup diagnostics', () => {
    const app = readFileSync('src/App.tsx', 'utf8');

    expect(app).toContain('const MAX_AUTOMATIC_DELETE_RETRIES = 3;');
    expect(app).toContain("err.structured.error_code === 'DELETE_CLEANUP_FAILED'");
    expect(app).toContain("err.structured.error_code === 'DELETE_FINALIZE_FAILED'");
    expect(app).toContain('err.structured?.retryable === true');
    expect(app).toContain('err.structured?.diagnostic');
    expect(app).not.toContain('const MAX_RETRIES = 200;');
  });

});
