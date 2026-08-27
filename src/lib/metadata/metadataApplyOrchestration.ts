import type {
  DesktopMetadataApplyResult,
  DesktopMetadataApplyTrackResult,
  DesktopMetadataPreflightResult,
  DesktopMetadataPreflightTrack,
  DesktopMetadataRecoveryRequest,
  DesktopMetadataRecoveryVerificationResult,
} from '../../types/dropdex-desktop';
import {
  isTrackMetadataDraftRecoveryLocked,
  normalizeGenreMetadataDraftValue,
  type TrackMetadataDraftRow,
} from '../queries/trackMetadataDrafts';

const SHA256_RE = /^[0-9a-f]{64}$/;

export class MetadataApplyProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetadataApplyProofError';
  }
}

function requireSha256(value: string | null | undefined, label: string): string {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) {
    throw new MetadataApplyProofError(`${label} is missing or invalid.`);
  }
  return value;
}

function requireOperationId(value: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
    throw new MetadataApplyProofError('Metadata apply operation ID is missing or invalid.');
  }
  return value;
}

function draftById(drafts: TrackMetadataDraftRow[]): Map<string, TrackMetadataDraftRow> {
  const byId = new Map<string, TrackMetadataDraftRow>();
  for (const draft of drafts) {
    if (byId.has(draft.id)) throw new MetadataApplyProofError('Metadata apply input contains duplicate draft IDs.');
    byId.set(draft.id, draft);
  }
  return byId;
}

function preflightByDraftId(preflight: DesktopMetadataPreflightResult): Map<string, DesktopMetadataPreflightTrack> {
  const byId = new Map<string, DesktopMetadataPreflightTrack>();
  for (const track of preflight.tracks) {
    if (byId.has(track.draft_id)) throw new MetadataApplyProofError('Metadata preflight contains duplicate draft IDs.');
    byId.set(track.draft_id, track);
  }
  return byId;
}

function validateSubmittedDraftAgainstPreflight(
  draft: TrackMetadataDraftRow,
  track: DesktopMetadataPreflightTrack,
): void {
  if (track.draft_id !== draft.id
    || track.track_id !== draft.trackId
    || track.field !== 'genre'
    || track.content_id !== draft.masterContentId
    || track.draft_revision !== draft.revision
    || track.draft_fingerprint !== draft.draftFingerprint
    || normalizeGenreMetadataDraftValue(track.expected_baseline_value) !== normalizeGenreMetadataDraftValue(draft.currentBaselineValue)
    || normalizeGenreMetadataDraftValue(track.pending_value) !== normalizeGenreMetadataDraftValue(draft.pendingValue)) {
    throw new MetadataApplyProofError(`Metadata preflight proof no longer matches draft ${draft.id}.`);
  }
}

export interface ValidatedMetadataApplyTrackProof {
  draft: TrackMetadataDraftRow;
  preflight: DesktopMetadataPreflightTrack;
  result: DesktopMetadataApplyTrackResult;
}

export interface ValidatedMetadataApplyProof {
  operationId: string;
  planFingerprint: string;
  sourceIdentityBefore: string;
  sourceIdentityAfter: string;
  tracks: ValidatedMetadataApplyTrackProof[];
}

/**
 * Validate the Stage 5 local-success proof before any Stage 6A cloud finalizer
 * is allowed to run. This deliberately binds every returned field back to the
 * exact complete draft set and Stage 4 plan submitted by the renderer.
 */
export function validateVerifiedMetadataApplyResult(input: {
  drafts: TrackMetadataDraftRow[];
  preflight: DesktopMetadataPreflightResult;
  result: DesktopMetadataApplyResult;
}): ValidatedMetadataApplyProof {
  const { drafts, preflight, result } = input;
  if (!preflight.ok || !preflight.token || preflight.blockers.length > 0) {
    throw new MetadataApplyProofError('Metadata apply cannot finalize without a successful bound preflight.');
  }
  if (!result.ok || result.state !== 'applied' || result.blockers.length > 0) {
    throw new MetadataApplyProofError('Metadata apply did not return a verified local-success outcome.');
  }
  const operationId = requireOperationId(result.operation_id);
  const planFingerprint = requireSha256(preflight.plan_fingerprint, 'Metadata preflight plan fingerprint');
  if (result.plan_fingerprint !== planFingerprint) {
    throw new MetadataApplyProofError('Metadata apply plan fingerprint does not match the bound preflight.');
  }
  const sourceIdentityBefore = requireSha256(preflight.source_identity, 'Metadata preflight source identity');
  if (result.source_identity_before !== sourceIdentityBefore) {
    throw new MetadataApplyProofError('Metadata apply source identity does not match the bound preflight.');
  }
  const sourceIdentityAfter = requireSha256(result.source_identity_after, 'Verified metadata apply source identity');

  if (drafts.length === 0 || preflight.tracks.length !== drafts.length || result.tracks.length !== drafts.length) {
    throw new MetadataApplyProofError('Metadata apply proof does not cover the exact submitted draft set.');
  }

  const draftsById = draftById(drafts);
  const preflightById = preflightByDraftId(preflight);
  const resultById = new Map<string, DesktopMetadataApplyTrackResult>();
  for (const track of result.tracks) {
    if (resultById.has(track.draft_id)) throw new MetadataApplyProofError('Metadata apply result contains duplicate draft IDs.');
    resultById.set(track.draft_id, track);
  }

  const tracks = drafts.map((draft) => {
    const planTrack = preflightById.get(draft.id);
    const resultTrack = resultById.get(draft.id);
    if (!planTrack || !resultTrack) {
      throw new MetadataApplyProofError(`Metadata apply proof is missing draft ${draft.id}.`);
    }
    validateSubmittedDraftAgainstPreflight(draft, planTrack);
    if (planTrack.desired_resolution === 'blocked') {
      throw new MetadataApplyProofError(`Metadata preflight unexpectedly left draft ${draft.id} blocked.`);
    }
    if (resultTrack.draft_id !== draft.id
      || resultTrack.track_id !== draft.trackId
      || resultTrack.content_id !== draft.masterContentId
      || resultTrack.applied_revision !== draft.revision
      || resultTrack.applied_fingerprint !== draft.draftFingerprint
      || resultTrack.desired_resolution !== planTrack.desired_resolution
      || resultTrack.state !== 'verified'
      || resultTrack.verification_state !== 'verified'
      || normalizeGenreMetadataDraftValue(resultTrack.normalized_applied_genre) !== normalizeGenreMetadataDraftValue(draft.pendingValue)) {
      throw new MetadataApplyProofError(`Verified local Genre proof does not match draft ${draft.id}.`);
    }
    return { draft, preflight: planTrack, result: resultTrack };
  });

  if (resultById.size !== tracks.length || draftsById.size !== tracks.length || preflightById.size !== tracks.length) {
    throw new MetadataApplyProofError('Metadata apply proof contains tracks outside the submitted draft set.');
  }

  return { operationId, planFingerprint, sourceIdentityBefore, sourceIdentityAfter, tracks };
}

/** Validate enough of a non-success envelope to safely attach its outcome to the submitted drafts. */
export function validateMetadataApplyOutcomeEnvelope(input: {
  drafts: TrackMetadataDraftRow[];
  preflight: DesktopMetadataPreflightResult;
  result: DesktopMetadataApplyResult;
}): void {
  const { drafts, preflight, result } = input;
  requireOperationId(result.operation_id);
  const planFingerprint = requireSha256(preflight.plan_fingerprint, 'Metadata preflight plan fingerprint');
  if (result.plan_fingerprint !== planFingerprint) {
    throw new MetadataApplyProofError('Metadata apply outcome plan fingerprint does not match the bound preflight.');
  }
  if (result.source_identity_before != null) requireSha256(result.source_identity_before, 'Metadata apply source identity before');
  if (result.source_identity_after != null) requireSha256(result.source_identity_after, 'Metadata apply source identity after');

  const draftsById = draftById(drafts);
  const preflightById = preflightByDraftId(preflight);
  if (draftsById.size !== preflightById.size) {
    throw new MetadataApplyProofError('Metadata apply outcome does not match the submitted preflight set.');
  }
  for (const draft of drafts) {
    const planTrack = preflightById.get(draft.id);
    if (!planTrack) throw new MetadataApplyProofError(`Metadata preflight is missing draft ${draft.id}.`);
    validateSubmittedDraftAgainstPreflight(draft, planTrack);
  }
  for (const track of result.tracks) {
    const draft = draftsById.get(track.draft_id);
    if (!draft
      || track.track_id !== draft.trackId
      || track.content_id !== draft.masterContentId
      || track.applied_revision !== draft.revision
      || track.applied_fingerprint !== draft.draftFingerprint) {
      throw new MetadataApplyProofError('Metadata apply outcome returned track evidence outside the submitted draft set.');
    }
  }
}

export function buildMetadataRecoveryRequest(draft: TrackMetadataDraftRow): DesktopMetadataRecoveryRequest {
  if (!isTrackMetadataDraftRecoveryLocked(draft)
    || (draft.lastApplyState !== 'cloud-finalization-pending' && draft.lastApplyState !== 'cloud-finalization-failed')) {
    throw new MetadataApplyProofError('This metadata draft is not eligible for automatic cloud finalization recovery.');
  }
  if (!Number.isInteger(draft.appliedRevision) || (draft.appliedRevision ?? 0) <= 0) {
    throw new MetadataApplyProofError('Metadata recovery is missing the verified applied revision.');
  }
  const operationId = requireOperationId(draft.lastApplyOperationId ?? '');
  const draftFingerprint = requireSha256(draft.lastApplyDraftFingerprint, 'Metadata recovery draft fingerprint');
  const planFingerprint = requireSha256(draft.lastApplyPlanFingerprint, 'Metadata recovery plan fingerprint');
  const sourceIdentityAfter = requireSha256(draft.lastApplySourceIdentityAfter, 'Metadata recovery source identity');
  if (!draft.masterDbId || !draft.masterContentId) {
    throw new MetadataApplyProofError('Metadata recovery is missing trusted track identity.');
  }

  return {
    operationId,
    trackId: draft.trackId,
    field: 'genre',
    masterDbId: draft.masterDbId,
    masterContentId: draft.masterContentId,
    appliedRevision: draft.appliedRevision as number,
    draftFingerprint,
    planFingerprint,
    appliedValue: normalizeGenreMetadataDraftValue(draft.appliedValue),
    sourceIdentityAfter,
  };
}

export function validateMetadataRecoveryVerification(
  request: DesktopMetadataRecoveryRequest,
  result: DesktopMetadataRecoveryVerificationResult,
): void {
  if (!result.ok
    || result.state !== 'verified'
    || result.blockers.length > 0
    || result.operation_id !== request.operationId
    || result.track_id !== request.trackId
    || result.applied_revision !== request.appliedRevision
    || result.draft_fingerprint !== request.draftFingerprint
    || result.plan_fingerprint !== request.planFingerprint
    || normalizeGenreMetadataDraftValue(result.expected_applied_value) !== normalizeGenreMetadataDraftValue(request.appliedValue)
    || normalizeGenreMetadataDraftValue(result.current_value) !== normalizeGenreMetadataDraftValue(request.appliedValue)
    || result.source_identity_after_apply !== request.sourceIdentityAfter
    || result.master_identity_comparison !== 'match'
    || (result.source_generation_comparison !== 'match' && result.source_generation_comparison !== 'changed')) {
    throw new MetadataApplyProofError('Read-only metadata recovery verification did not match the persisted verified local apply evidence.');
  }
  if (result.current_source_identity != null) requireSha256(result.current_source_identity, 'Current metadata recovery source identity');
}
