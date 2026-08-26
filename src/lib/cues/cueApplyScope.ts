export type CueApplyScope =
  | { kind: 'track'; importId: string; trackId: string }
  | { kind: 'all'; importId: string };

export interface CueApplyDraftIdentity {
  importId: string;
  trackId: string;
}

export interface CueApplySelection<T extends CueApplyDraftIdentity> {
  scope: CueApplyScope;
  rows: T[];
  error: string | null;
}

/** Resolve the exact persisted draft set represented by an Apply action. */
export function resolveCueApplySelection<T extends CueApplyDraftIdentity>(
  rows: T[],
  scope: CueApplyScope,
): CueApplySelection<T> {
  const scopedImportRows = rows.filter((row) => row.importId === scope.importId);
  if (scope.kind === 'all') {
    return {
      scope,
      rows: scopedImportRows,
      error: scopedImportRows.length > 0 ? null : 'No saved cue drafts currently need to be applied.',
    };
  }

  const trackRows = scopedImportRows.filter((row) => row.trackId === scope.trackId);
  if (trackRows.length === 0) {
    return { scope, rows: [], error: 'The selected track has no saved cue changes waiting to be applied.' };
  }
  if (trackRows.length !== 1) {
    return { scope, rows: [], error: 'The selected track has ambiguous saved cue draft state. Reload before applying.' };
  }
  return { scope, rows: trackRows, error: null };
}
