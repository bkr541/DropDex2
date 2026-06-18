/**
 * Resume Analysis — match files from a re-selected USB folder against the
 * still-missing ANLZ paths returned by GET /analysis-status.
 */

import { getCanonicalAnlzPath } from './analysisPaths';
import type { MatchedAnalysisFile } from './analysisPaths';
import type { AnalysisStatusResponse } from '../api/rekordboxImport';

export type ResumeAssetType = 'DAT' | 'EXT' | '2EX';

export interface ResumeTarget {
  /** Canonical PIONEER-anchored path (from backend, case-preserved). */
  path: string;
  assetType: ResumeAssetType;
  /** True only for required DAT files. */
  required: boolean;
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

/**
 * Build a flat list of resume targets from an /analysis-status response.
 * Only paths returned in missing_required_paths / missing_optional_ext /
 * missing_optional_2ex are included — already-uploaded files are excluded.
 */
export function buildResumeTargets(status: AnalysisStatusResponse): ResumeTarget[] {
  const targets: ResumeTarget[] = [];
  for (const p of status.missing_required_paths) {
    targets.push({ path: p, assetType: 'DAT', required: true });
  }
  for (const p of status.missing_optional_ext) {
    targets.push({ path: p, assetType: 'EXT', required: false });
  }
  for (const p of status.missing_optional_2ex) {
    targets.push({ path: p, assetType: '2EX', required: false });
  }
  return targets;
}

/**
 * Match files from a freshly-scanned USB folder against the resume targets.
 *
 * Files are matched by their canonical PIONEER-anchored path (case-insensitive).
 * Files already uploaded (not in targets) are silently excluded — the server
 * returns "already_received" for them anyway, so they are not re-uploaded.
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
      trackId: '', // not needed; backend resolves via canonical path
    });
  }

  const stillMissing = targets.filter((t) => !matchedPaths.has(t.path.toLowerCase()));
  const stillMissingRequired = stillMissing.filter((t) => t.required);
  const stillMissingOptional = stillMissing.filter((t) => !t.required);

  return { matched, stillMissing, stillMissingRequired, stillMissingOptional };
}
