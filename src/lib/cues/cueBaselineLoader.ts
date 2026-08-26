import { normalizeImportedCues, type WorkingCue } from '../music/cueEditorState';
import { fetchTrackCueState, type CueLoadState } from '../queries/analysisData';
import { fetchCueDraft } from '../queries/cueDrafts';
import type { RekordboxTrack } from '../../types';
import {
  hydrateCueDraftDocument,
  validateCueDraftWorkingSet,
  type CueDraftValidationResult,
} from './cueDraftDocument';

type TerminalCueLoadState = Exclude<CueLoadState, { status: 'loading' }>;

export interface LoadedCueEditorBaseline {
  status: 'loaded-empty' | 'loaded-with-cues';
  trackId: string;
  importedCues: WorkingCue[];
  savedCues: WorkingCue[] | null;
  workingCues: WorkingCue[];
  draftRevision: number | null;
  draftAppliedRevision: number | null;
  draftAppliedFingerprint: string | null;
  draftDesiredFingerprint: string | null;
  draftImportedBaselineFingerprint: string | null;
  draftImportedBaselineLocalCueFingerprint: string | null;
  integrity: CueDraftValidationResult;
}

export interface FailedCueEditorBaseline {
  status: 'failed';
  trackId: string;
  phase: 'imported-cues' | 'saved-draft';
  error: string;
  retryable: boolean;
  /**
   * Imported cues may be present after a saved-draft failure, but they are not
   * an editable baseline because DropDex cannot prove they are the user's latest
   * desired state.
   */
  importedCues: WorkingCue[];
}

export type CueEditorBaselineResult = LoadedCueEditorBaseline | FailedCueEditorBaseline;


function cueSourceCompletenessError(track: RekordboxTrack): string | null {
  const cueFeatureStatus = track.analysis_feature_statuses?.cues;
  if (cueFeatureStatus && cueFeatureStatus !== 'completed') {
    return `Cue reconciliation is ${cueFeatureStatus}; refresh or re-run track analysis before editing cues.`;
  }

  if (
    !cueFeatureStatus
    && (track.analysis_parse_status === 'failed'
      || track.analysis_parse_status === 'partial'
      || track.analysis_parse_status === 'missing_required'
      || track.analysis_parse_status === 'queued'
      || track.analysis_parse_status === 'parsing')
  ) {
    return `Cue completeness cannot be proven while track analysis is ${track.analysis_parse_status}.`;
  }
  return null;
}

function loadedStatus(cues: WorkingCue[]): LoadedCueEditorBaseline['status'] {
  return cues.length === 0 ? 'loaded-empty' : 'loaded-with-cues';
}

function validateBaseline(track: RekordboxTrack, cues: WorkingCue[]): CueDraftValidationResult {
  return validateCueDraftWorkingSet({
    importId: track.import_id,
    trackId: track.id,
    rekordboxContentId: track.rekordbox_content_id,
    cues,
  });
}

function queryFailure(trackId: string, state: Extract<TerminalCueLoadState, { status: 'failed' }>): FailedCueEditorBaseline {
  return {
    status: 'failed',
    trackId,
    phase: 'imported-cues',
    error: state.error ? `Cue points could not be loaded: ${state.error}` : 'Cue points could not be loaded for this track.',
    retryable: state.retryable,
    importedCues: [],
  };
}

/**
 * Load the complete baseline required by the production Cue Points editor.
 *
 * Success means both the canonical imported cue request and, when authenticated,
 * the user-scoped saved-draft lookup/hydration completed successfully. A saved
 * draft failure never degrades into an editable imported baseline.
 */
export async function loadCueEditorBaseline(
  track: RekordboxTrack,
  userId: string | null,
): Promise<CueEditorBaselineResult> {
  const sourceCompletenessError = cueSourceCompletenessError(track);
  if (sourceCompletenessError) {
    return {
      status: 'failed',
      trackId: track.id,
      phase: 'imported-cues',
      error: sourceCompletenessError,
      retryable: true,
      importedCues: [],
    };
  }

  const cueState = await fetchTrackCueState(track.id);
  if (cueState.status === 'failed') return queryFailure(track.id, cueState);

  const importedCues = normalizeImportedCues(track.id, cueState.cues);
  const importedIntegrity = validateBaseline(track, importedCues);
  if (!userId || importedIntegrity.status !== 'valid') {
    return {
      status: loadedStatus(importedCues),
      trackId: track.id,
      importedCues,
      savedCues: null,
      workingCues: importedCues,
      draftRevision: null,
      draftAppliedRevision: null,
      draftAppliedFingerprint: null,
      draftDesiredFingerprint: null,
      draftImportedBaselineFingerprint: null,
      draftImportedBaselineLocalCueFingerprint: null,
      integrity: importedIntegrity,
    };
  }

  try {
    const draft = await fetchCueDraft(userId, track.id);
    if (!draft) {
      return {
        status: loadedStatus(importedCues),
        trackId: track.id,
        importedCues,
        savedCues: null,
        workingCues: importedCues,
        draftRevision: null,
        draftAppliedRevision: null,
        draftAppliedFingerprint: null,
        draftDesiredFingerprint: null,
        draftImportedBaselineFingerprint: null,
        draftImportedBaselineLocalCueFingerprint: null,
        integrity: importedIntegrity,
      };
    }

    if (
      draft.importId !== track.import_id
      || draft.rekordboxContentId !== track.rekordbox_content_id
      || draft.desiredDocument.importId !== track.import_id
      || draft.desiredDocument.trackId !== track.id
      || draft.desiredDocument.rekordboxContentId !== track.rekordbox_content_id
    ) {
      throw new Error('Saved cue draft identity does not match the selected Rekordbox track.');
    }

    const savedCues = hydrateCueDraftDocument(draft.desiredDocument);
    const savedIntegrity = validateBaseline(track, savedCues);
    return {
      status: loadedStatus(savedCues),
      trackId: track.id,
      importedCues,
      savedCues,
      workingCues: savedCues,
      draftRevision: draft.revision,
      draftAppliedRevision: draft.appliedRevision,
      draftAppliedFingerprint: draft.appliedFingerprint,
      draftDesiredFingerprint: draft.desiredFingerprint,
      draftImportedBaselineFingerprint: draft.importedBaselineFingerprint,
      draftImportedBaselineLocalCueFingerprint: draft.importedBaselineLocalCueFingerprint,
      integrity: savedIntegrity,
    };
  } catch (error) {
    return {
      status: 'failed',
      trackId: track.id,
      phase: 'saved-draft',
      error: error instanceof Error
        ? `Saved cue changes could not be loaded: ${error.message}`
        : 'Saved cue changes could not be loaded for this track.',
      retryable: true,
      importedCues,
    };
  }
}
