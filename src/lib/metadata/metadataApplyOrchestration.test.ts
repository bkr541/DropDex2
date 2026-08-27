import { describe, expect, it } from 'vitest';
import type { TrackMetadataDraftRow } from '../queries/trackMetadataDrafts';
import type {
  DesktopMetadataApplyResult,
  DesktopMetadataPreflightResult,
  DesktopMetadataRecoveryVerificationResult,
} from '../../types/dropdex-desktop';
import {
  buildMetadataRecoveryRequest,
  MetadataApplyProofError,
  validateMetadataApplyOutcomeEnvelope,
  validateMetadataRecoveryVerification,
  validateVerifiedMetadataApplyResult,
} from './metadataApplyOrchestration';

const DRAFT_FP = 'a'.repeat(64);
const PLAN_FP = 'b'.repeat(64);
const SOURCE_BEFORE = 'c'.repeat(64);
const SOURCE_AFTER = 'd'.repeat(64);
const SOURCE_CURRENT = 'e'.repeat(64);

function draft(overrides: Partial<TrackMetadataDraftRow> = {}): TrackMetadataDraftRow {
  return {
    id: 'draft-1',
    userId: 'user-1',
    importId: 'import-1',
    trackId: 'track-1',
    field: 'genre',
    schemaVersion: 1,
    pendingValue: 'Melodic Bass',
    importedBaselineValue: 'Dubstep',
    currentBaselineValue: 'Dubstep',
    masterDbId: 'master-db-1',
    masterContentId: 'content-1',
    revision: 2,
    draftFingerprint: DRAFT_FP,
    createdAt: '2026-08-27T00:00:00Z',
    updatedAt: '2026-08-27T00:00:01Z',
    appliedRevision: null,
    appliedValue: null,
    appliedAt: null,
    lastApplyOperationId: null,
    lastApplyState: null,
    lastApplySummary: null,
    lastApplyDraftFingerprint: null,
    lastApplyPlanFingerprint: null,
    lastApplySourceIdentityBefore: null,
    lastApplySourceIdentityAfter: null,
    cloudFinalizedAt: null,
    ...overrides,
  };
}

function preflight(overrides: Partial<DesktopMetadataPreflightResult> = {}): DesktopMetadataPreflightResult {
  return {
    ok: true,
    preflight_id: 'preflight-1',
    plan_fingerprint: PLAN_FP,
    source_identity: SOURCE_BEFORE,
    tracks: [{
      draft_id: 'draft-1',
      track_id: 'track-1',
      field: 'genre',
      content_id: 'content-1',
      exists: true,
      identity_comparison: 'match',
      draft_revision: 2,
      draft_fingerprint: DRAFT_FP,
      expected_baseline_value: 'Dubstep',
      current_value: 'Dubstep',
      pending_value: 'Melodic Bass',
      baseline_comparison: 'match',
      desired_resolution: 'create',
      existing_genre_id: null,
    }],
    blockers: [],
    warnings: [],
    token: 'opaque-stage-4-token',
    expires_at: '2026-08-27T00:02:00Z',
    ...overrides,
  };
}

function applyResult(overrides: Partial<DesktopMetadataApplyResult> = {}): DesktopMetadataApplyResult {
  return {
    ok: true,
    operation_id: 'operation-1',
    state: 'applied',
    plan_fingerprint: PLAN_FP,
    source_identity_before: SOURCE_BEFORE,
    source_identity_after: SOURCE_AFTER,
    backup_identity: 'backup-identity',
    tracks: [{
      draft_id: 'draft-1',
      track_id: 'track-1',
      content_id: 'content-1',
      state: 'verified',
      applied_revision: 2,
      applied_fingerprint: DRAFT_FP,
      normalized_applied_genre: 'Melodic Bass',
      desired_resolution: 'create',
      resolved_genre_id: 'genre-9',
      verification_state: 'verified',
      details: null,
    }],
    blockers: [],
    warnings: [],
    rollback_verified: null,
    recovery: null,
    ...overrides,
  };
}

function recoveryDraft(overrides: Partial<TrackMetadataDraftRow> = {}): TrackMetadataDraftRow {
  return draft({
    appliedRevision: 2,
    appliedValue: 'Melodic Bass',
    appliedAt: '2026-08-27T00:00:02Z',
    lastApplyOperationId: 'operation-1',
    lastApplyState: 'cloud-finalization-pending',
    lastApplyDraftFingerprint: DRAFT_FP,
    lastApplyPlanFingerprint: PLAN_FP,
    lastApplySourceIdentityBefore: SOURCE_BEFORE,
    lastApplySourceIdentityAfter: SOURCE_AFTER,
    ...overrides,
  });
}

function recoveryVerification(overrides: Partial<DesktopMetadataRecoveryVerificationResult> = {}): DesktopMetadataRecoveryVerificationResult {
  return {
    ok: true,
    state: 'verified',
    operation_id: 'operation-1',
    track_id: 'track-1',
    applied_revision: 2,
    draft_fingerprint: DRAFT_FP,
    plan_fingerprint: PLAN_FP,
    expected_applied_value: 'Melodic Bass',
    current_value: 'Melodic Bass',
    source_identity_after_apply: SOURCE_AFTER,
    current_source_identity: SOURCE_CURRENT,
    source_generation_comparison: 'changed',
    master_identity_comparison: 'match',
    blockers: [],
    ...overrides,
  };
}

function expectProofFailure(run: () => unknown) {
  expect(run).toThrow(MetadataApplyProofError);
}

describe('Stage 6B metadata apply proof validation', () => {
  it('accepts exact Stage 4 + Stage 5 evidence and returns the finalization proof', () => {
    const proof = validateVerifiedMetadataApplyResult({
      drafts: [draft()],
      preflight: preflight(),
      result: applyResult(),
    });
    expect(proof.operationId).toBe('operation-1');
    expect(proof.planFingerprint).toBe(PLAN_FP);
    expect(proof.sourceIdentityBefore).toBe(SOURCE_BEFORE);
    expect(proof.sourceIdentityAfter).toBe(SOURCE_AFTER);
    expect(proof.tracks).toHaveLength(1);
    expect(proof.tracks[0].draft.trackId).toBe('track-1');
  });

  it('rejects a missing/invalid Stage 5 operation ID before cloud finalization', () => {
    expectProofFailure(() => validateVerifiedMetadataApplyResult({
      drafts: [draft()],
      preflight: preflight(),
      result: applyResult({ operation_id: '' }),
    }));
  });

  it('rejects a plan fingerprint mismatch', () => {
    expectProofFailure(() => validateVerifiedMetadataApplyResult({
      drafts: [draft()],
      preflight: preflight(),
      result: applyResult({ plan_fingerprint: 'f'.repeat(64) }),
    }));
  });

  it('rejects a draft revision or fingerprint mismatch', () => {
    const wrongRevision = applyResult();
    wrongRevision.tracks[0] = { ...wrongRevision.tracks[0], applied_revision: 3 };
    expectProofFailure(() => validateVerifiedMetadataApplyResult({ drafts: [draft()], preflight: preflight(), result: wrongRevision }));

    const wrongFingerprint = applyResult();
    wrongFingerprint.tracks[0] = { ...wrongFingerprint.tracks[0], applied_fingerprint: 'f'.repeat(64) };
    expectProofFailure(() => validateVerifiedMetadataApplyResult({ drafts: [draft()], preflight: preflight(), result: wrongFingerprint }));
  });

  it('rejects a normalized applied Genre mismatch and accepts an exact clear-to-null Genre', () => {
    const wrongGenre = applyResult();
    wrongGenre.tracks[0] = { ...wrongGenre.tracks[0], normalized_applied_genre: 'House' };
    expectProofFailure(() => validateVerifiedMetadataApplyResult({ drafts: [draft()], preflight: preflight(), result: wrongGenre }));

    const clearDraft = draft({ pendingValue: null });
    const clearPreflight = preflight({ tracks: [{ ...preflight().tracks[0], pending_value: null, desired_resolution: 'clear' }] });
    const clearResult = applyResult({ tracks: [{
      ...applyResult().tracks[0],
      normalized_applied_genre: null,
      desired_resolution: 'clear',
      resolved_genre_id: null,
    }] });
    expect(validateVerifiedMetadataApplyResult({ drafts: [clearDraft], preflight: clearPreflight, result: clearResult }).tracks).toHaveLength(1);
  });

  it('rejects result evidence outside the exact submitted complete set', () => {
    const extra = applyResult();
    extra.tracks.push({ ...extra.tracks[0], draft_id: 'draft-extra', track_id: 'track-extra' });
    expectProofFailure(() => validateVerifiedMetadataApplyResult({ drafts: [draft()], preflight: preflight(), result: extra }));
  });

  it('binds rolled-back/rejected outcome persistence to the same submitted draft evidence', () => {
    const rolledBack = applyResult({ ok: false, state: 'rolled-back', tracks: [] });
    expect(() => validateMetadataApplyOutcomeEnvelope({ drafts: [draft()], preflight: preflight(), result: rolledBack })).not.toThrow();
    const wrongPlan = { ...rolledBack, plan_fingerprint: 'f'.repeat(64) };
    expectProofFailure(() => validateMetadataApplyOutcomeEnvelope({ drafts: [draft()], preflight: preflight(), result: wrongPlan }));
  });
});

describe('Stage 6B metadata recovery proof validation', () => {
  it('builds recovery only from durable Stage 6A local-success evidence', () => {
    const request = buildMetadataRecoveryRequest(recoveryDraft());
    expect(request).toEqual({
      operationId: 'operation-1',
      trackId: 'track-1',
      field: 'genre',
      masterDbId: 'master-db-1',
      masterContentId: 'content-1',
      appliedRevision: 2,
      draftFingerprint: DRAFT_FP,
      planFingerprint: PLAN_FP,
      appliedValue: 'Melodic Bass',
      sourceIdentityAfter: SOURCE_AFTER,
    });
  });

  it('rejects ordinary and recovery-unverified drafts from automatic cloud retry', () => {
    expectProofFailure(() => buildMetadataRecoveryRequest(draft()));
    expectProofFailure(() => buildMetadataRecoveryRequest(recoveryDraft({ lastApplyState: 'recovery-unverified' })));
  });

  it('accepts read-only recovery when Genre/identity match even if the source generation changed', () => {
    const request = buildMetadataRecoveryRequest(recoveryDraft());
    expect(() => validateMetadataRecoveryVerification(request, recoveryVerification())).not.toThrow();
  });

  it('fails closed when local Genre or trusted identity changed', () => {
    const request = buildMetadataRecoveryRequest(recoveryDraft());
    expectProofFailure(() => validateMetadataRecoveryVerification(request, recoveryVerification({ current_value: 'House' })));
    expectProofFailure(() => validateMetadataRecoveryVerification(request, recoveryVerification({ master_identity_comparison: 'mismatch' })));
  });

  it('supports recovery of a verified clear-to-null Genre', () => {
    const request = buildMetadataRecoveryRequest(recoveryDraft({ pendingValue: null, appliedValue: null }));
    expect(request.appliedValue).toBeNull();
    expect(() => validateMetadataRecoveryVerification(request, recoveryVerification({
      expected_applied_value: null,
      current_value: null,
    }))).not.toThrow();
  });
});
