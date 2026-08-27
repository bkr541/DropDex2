import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TrackMetadataDraftRow } from '../../lib/queries/trackMetadataDrafts';
import { PendingMetadataChangesReview } from './PendingMetadataChangesReview';

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
    masterDbId: 'master-db',
    masterContentId: 'content-1',
    revision: 2,
    draftFingerprint: 'a'.repeat(64),
    createdAt: '2026-08-27T00:00:00Z',
    updatedAt: '2026-08-27T00:00:01Z',
    appliedRevision: null,
    appliedValue: null,
    appliedAt: null,
    lastApplyOperationId: null,
    lastApplyState: null,
    lastApplySummary: null,
    ...overrides,
  };
}

function renderReview(
  rowDraft = draft(),
  overrides: Partial<React.ComponentProps<typeof PendingMetadataChangesReview>> = {},
) {
  return renderToStaticMarkup(React.createElement(PendingMetadataChangesReview, {
    open: true,
    pendingCount: 1,
    draftLoadStatus: 'loaded',
    draftLoadError: null,
    identityLoadStatus: 'loaded',
    identityLoadError: null,
    rows: [{
      draft: rowDraft,
      track: { id: 'track-1', title: 'A Very Long Track Title', artist: 'DVYDRM' },
    }],
    discardingTrackIds: new Set<string>(),
    actionError: null,
    applyAvailable: true,
    applyAvailabilityReason: null,
    preflightBusy: false,
    preflightResult: null,
    preflightMessage: null,
    onClose: vi.fn(),
    onRetryDrafts: vi.fn(),
    onRetryIdentities: vi.fn(),
    onDiscard: vi.fn(),
    onPreflightAll: vi.fn(),
    ...overrides,
  }));
}

describe('Pending metadata changes production review surface', () => {
  it('renders the complete current-to-pending Genre contract and exposes read-only preflight', () => {
    const markup = renderReview();
    expect(markup).toContain('Pending Changes (1)');
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('dd-dialog--right-sheet');
    expect(markup).toContain('A Very Long Track Title');
    expect(markup).toContain('DVYDRM');
    expect(markup).toContain('Current');
    expect(markup).toContain('Dubstep');
    expect(markup).toContain('Pending');
    expect(markup).toContain('Melodic Bass');
    expect(markup).toContain('Discard');
    expect(markup).toContain('Preflight Apply All Metadata Changes (1)');
    expect(markup).toContain('Stage 4 only checks identity, current Genre, conflicts, and the planned Genre resolution.');
    expect(markup).not.toContain('Apply is disabled in this stage.');
    expect(markup).toContain('Cue drafts remain a separate Apply operation.');
  });

  it('represents a null pending Genre explicitly as a clear operation', () => {
    expect(renderReview(draft({ pendingValue: null }))).toContain('Clear Genre (No Genre)');
  });

  it('renders a true empty state only after the complete draft load succeeds', () => {
    const markup = renderReview(draft(), {
      pendingCount: 0,
      rows: [],
      identityLoadStatus: 'loaded',
    });
    expect(markup).toContain('Pending Changes (0)');
    expect(markup).toContain('No pending metadata changes');
    expect(markup).toContain('Preflight Apply All Metadata Changes (0)');
  });

  it('distinguishes a failed draft load from an empty pending list and exposes retry', () => {
    const markup = renderReview(draft(), {
      pendingCount: 0,
      draftLoadStatus: 'failed',
      draftLoadError: 'Pending Genre changes could not be loaded: offline',
      identityLoadStatus: 'idle',
      rows: [],
    });
    expect(markup).toContain('Pending Genre changes could not be loaded: offline');
    expect(markup).toContain('Retry pending changes');
    expect(markup).not.toContain('No pending metadata changes');
  });

  it('shows desktop availability failures without pretending preflight can run', () => {
    const markup = renderReview(draft(), {
      applyAvailable: false,
      applyAvailabilityReason: 'Metadata bridge unavailable',
    });
    expect(markup).toContain('Metadata bridge unavailable');
    expect(markup).toContain('disabled');
  });

  it('renders structured stale-baseline blockers and keeps the draft pending', () => {
    const markup = renderReview(draft(), {
      preflightResult: {
        ok: false,
        preflight_id: 'preflight-1',
        plan_fingerprint: 'b'.repeat(64),
        source_identity: 'source-1',
        tracks: [{
          draft_id: 'draft-1',
          track_id: 'track-1',
          field: 'genre',
          content_id: 'content-1',
          exists: true,
          identity_comparison: 'match',
          draft_revision: 2,
          draft_fingerprint: 'a'.repeat(64),
          expected_baseline_value: 'Dubstep',
          current_value: 'House',
          pending_value: 'Melodic Bass',
          baseline_comparison: 'diverged',
          desired_resolution: 'reuse',
          existing_genre_id: 'genre-1',
        }],
        blockers: [{
          code: 'genre-baseline-stale',
          message: 'Local Genre changed after the moving baseline was saved.',
          context: { trackId: 'track-1', expected: 'Dubstep', current: 'House', pending: 'Melodic Bass' },
        }],
        warnings: [],
        token: null,
        expires_at: null,
      },
      preflightMessage: 'Read-only preflight found blockers. Pending Genre drafts were left unchanged.',
    });
    expect(markup).toContain('Metadata preflight is blocked.');
    expect(markup).toContain('genre-baseline-stale');
    expect(markup).toContain('Pending Genre drafts were left unchanged.');
    expect(markup).toContain('Discard');
  });

});
