export interface ImportResponseFreshness {
  requestedImportId: string;
  currentImportId: string;
  responseImportId: string;
  requestGeneration: number;
  currentGeneration: number;
  aborted: boolean;
}

/** Prevent a response for Import A from updating a screen now showing Import B. */
export function isFreshImportResponse(input: ImportResponseFreshness): boolean {
  return !input.aborted
    && input.requestGeneration === input.currentGeneration
    && input.requestedImportId === input.currentImportId
    && input.responseImportId === input.requestedImportId;
}
