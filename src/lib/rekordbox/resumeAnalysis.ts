/**
 * Resume Analysis — match files from a re-selected USB folder against the
 * still-missing ANLZ paths returned by GET /analysis-status.
 *
 * The backend now returns structured `unresolved_targets` with per-track IDs,
 * asset types, status codes, and reasons. When available, these replace the
 * legacy flat path arrays and enable selective reprocessing (only repair
 * tracks that received a new file, not the entire library).
 */

import { getCanonicalAnlzPath } from './analysisPaths';
import type { MatchedAnalysisFile } from './analysisPaths';
import type { AnalysisStatusResponse, ResumeTargetResponse } from '../api/rekordboxImport';

export type ResumeAssetType = 'DAT' | 'EXT' | '2EX';
export type ResumeTargetStatus = 'missing' | 'upload_failed' | 'parse_failed' | 'optional_missing';

export interface ResumeTarget {
  /** PIONEER-anchored canonical path. */
  path: string;
  assetType: ResumeAssetType;
  /** True only for required DAT files. */
  required: boolean;
  /** Track ID from the database (populated when backend returns structured targets). */
  trackId: string | null;
  rekordboxContentId: string | null;
  status: ResumeTargetStatus;
  reason: string | null;
  attemptCount: number | null;
}

export interface ResumeMatchResult {
  /** Files from the folder that match a missing target. */
  matched: MatchedAnalysisFile[];
  /** Targets still not found on the connected drive. */
  stillMissing: ResumeTarget[];
  /** Required targets still not found (subset of stillMissing). */
  stillMissingRequired: ResumeTarget[];
  /** Optional targets still not found (subset of stillMissing). */
  stillMissingOptional: ResumeTarget[];
}

/** Grouped counts for the modal display. */
export interface ResumeStatusSummary {
  missingRequired: number;
  missingOptional: number;
  uploadFailed: number;
  parseFailed: number;
  affectedTracks: number;
}

/**
 * Build a flat list of resume targets from an /analysis-status response.
 *
 * Prefers `unresolved_targets` (structured, with track IDs) when available.
 * Falls back to the legacy path arrays for backward compatibility.
 */
export function buildResumeTargets(status: AnalysisStatusResponse): ResumeTarget[] {
  // Use structured targets when the backend provides them.
  if (status.unresolved_targets.length > 0) {
    return status.unresolved_targets.map(fromStructuredTarget);
  }

  // Legacy fallback — path arrays only, no track-level metadata.
  const targets: ResumeTarget[] = [];
  for (const p of status.missing_required_paths) {
    targets.push(legacyTarget(p, 'DAT', true));
  }
  for (const p of status.missing_optional_ext) {
    targets.push(legacyTarget(p, 'EXT', false));
  }
  for (const p of status.missing_optional_2ex) {
    targets.push(legacyTarget(p, '2EX', false));
  }
  return targets;
}

function fromStructuredTarget(t: ResumeTargetResponse): ResumeTarget {
  return {
    path: t.relative_path,
    assetType: t.asset_type,
    required: t.required,
    trackId: t.track_id,
    rekordboxContentId: t.rekordbox_content_id,
    status: t.status,
    reason: t.reason,
    attemptCount: t.attempt_count,
  };
}

function legacyTarget(path: string, assetType: ResumeAssetType, required: boolean): ResumeTarget {
  return {
    path,
    assetType,
    required,
    trackId: null,
    rekordboxContentId: null,
    status: required ? 'missing' : 'optional_missing',
    reason: null,
    attemptCount: null,
  };
}

/**
 * Derive top-level summary counts from a status response.
 * Uses structured counts when available, falls back to path array lengths.
 */
export function buildStatusSummary(status: AnalysisStatusResponse): ResumeStatusSummary {
  if (status.unresolved_targets.length > 0 || status.missing_required_count > 0) {
    return {
      missingRequired: status.missing_required_count,
      missingOptional: status.missing_optional_count,
      uploadFailed: status.failed_upload_count,
      parseFailed: status.failed_parse_count,
      affectedTracks: status.affected_track_count,
    };
  }
  // Legacy: derive from path arrays
  return {
    missingRequired: status.missing_required_paths.length,
    missingOptional: status.missing_optional_ext.length + status.missing_optional_2ex.length,
    uploadFailed: 0,
    parseFailed: 0,
    affectedTracks: 0,
  };
}

/**
 * Extract the set of unique affected track IDs from structured targets.
 * Returns null when no track IDs are available (legacy mode).
 */
export function extractAffectedTrackIds(targets: ResumeTarget[]): string[] | null {
  const ids = targets.map((t) => t.trackId).filter((id): id is string => id !== null);
  if (ids.length === 0) return null;
  return [...new Set(ids)];
}

/**
 * Match files from a freshly-scanned USB folder against the resume targets.
 *
 * Files are matched by their canonical PIONEER-anchored path (case-insensitive).
 * Files already uploaded (not in targets) are silently excluded.
 *
 * Returns a structured summary of matched files and still-missing targets.
 */
export function buildResumeMatchResult(
  files: File[],
  targets: ResumeTarget[],
): ResumeMatchResult {
  if (targets.length === 0) {
    return {
      matched: [],
      stillMissing: [],
      stillMissingRequired: [],
      stillMissingOptional: [],
    };
  }

  // Build lookup: lowercase canonical path → ResumeTarget
  const targetMap = new Map<string, ResumeTarget>(
    targets.map((t) => [t.path.toLowerCase(), t]),
  );

  const matched: MatchedAnalysisFile[] = [];
  const matchedPaths = new Set<string>();

  for (const f of files) {
    const canonical = getCanonicalAnlzPath(f);
    if (!canonical) continue;
    const lower = canonical.toLowerCase();
    const target = targetMap.get(lower);
    if (!target || matchedPaths.has(lower)) continue;

    matchedPaths.add(lower);
    matched.push({
      file: f,
      canonicalPath: canonical,
      originalBrowserPath:
        (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? f.name,
      assetType: target.assetType,
      trackId: target.trackId ?? '',
    });
  }

  const stillMissing = targets.filter((t) => !matchedPaths.has(t.path.toLowerCase()));
  const stillMissingRequired = stillMissing.filter((t) => t.required);
  const stillMissingOptional = stillMissing.filter((t) => !t.required);

  return { matched, stillMissing, stillMissingRequired, stillMissingOptional };
}
