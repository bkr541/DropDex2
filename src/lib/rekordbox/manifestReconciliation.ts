import type { ManifestEntry } from '../api/rekordboxImport';
import {
  requiredAssetTypesForManifestEntry,
  type MatchedAnalysisFile,
} from './analysisPaths';

export type AssetType = 'DAT' | 'EXT' | '2EX';

export interface MissingFileInfo {
  relativePath: string;
  trackId: string;
  rekordboxContentId: string | null;
  assetType: AssetType;
  required: boolean;
  reason: 'not_found_on_disk' | 'upload_failed';
}

export interface FileTypeStats {
  expected: number;
  uploaded: number;
  failed: number;
  missing: number;
}

export interface ManifestReconciliation {
  /** Required/requested blocking files only. Optional archival is separate. */
  expectedFiles: number;
  optionalArchivalFiles: number;
  matchedFiles: number;
  successfullyUploadedFiles: number;
  failedFiles: number;
  missingFiles: number;
  requiredMissingFiles: MissingFileInfo[];
  optionalMissingFiles: MissingFileInfo[];
  filesByType: Record<AssetType, FileTypeStats>;
  affectedTrackIds: string[];
  tracksRequiringAnalysis: number;
  tracksAlreadyReusable: number;
  unavailableTracks: number;
}

/** Reconcile only manifest-requested DAT/EXT work. .2EX never blocks readiness. */
export function buildManifestReconciliation(
  manifest: ManifestEntry[],
  matchedFiles: MatchedAnalysisFile[],
  uploadedPaths: Set<string>,
): ManifestReconciliation {
  const matchedPathSet = new Set(matchedFiles.map((file) => file.canonicalPath.toLowerCase()));
  const filesByType: Record<AssetType, FileTypeStats> = {
    DAT: { expected: 0, uploaded: 0, failed: 0, missing: 0 },
    EXT: { expected: 0, uploaded: 0, failed: 0, missing: 0 },
    '2EX': { expected: 0, uploaded: 0, failed: 0, missing: 0 },
  };
  const requiredMissingFiles: MissingFileInfo[] = [];
  const optionalMissingFiles: MissingFileInfo[] = [];
  const affectedTrackIds = new Set<string>();
  let successfullyUploadedFiles = 0;
  let failedFiles = 0;
  let missingFiles = 0;
  let tracksRequiringAnalysis = 0;
  let tracksAlreadyReusable = 0;
  let unavailableTracks = 0;
  let optionalArchivalFiles = 0;

  for (const entry of manifest) {
    const status = entry.manifest_status ?? 'needs_analysis';
    if (status === 'reused' || status === 'metadata_only') tracksAlreadyReusable += 1;
    if (status === 'unavailable') unavailableTracks += 1;
    const requested = requiredAssetTypesForManifestEntry(entry);
    if (requested.length > 0 || status === 'reparse_from_retained') tracksRequiringAnalysis += 1;
    if (entry.two_ex_path) {
      optionalArchivalFiles += 1;
      filesByType['2EX'].expected += 1;
    }

    const specs: Array<{ path: string | null; type: 'DAT' | 'EXT'; required: boolean }> = [];
    if (requested.includes('DAT')) specs.push({ path: entry.dat_path, type: 'DAT', required: true });
    if (requested.includes('EXT')) specs.push({ path: entry.ext_path, type: 'EXT', required: false });

    for (const spec of specs) {
      if (!spec.path) continue;
      const lower = spec.path.toLowerCase();
      filesByType[spec.type].expected += 1;
      if (uploadedPaths.has(lower)) {
        filesByType[spec.type].uploaded += 1;
        successfullyUploadedFiles += 1;
        continue;
      }

      const reason = matchedPathSet.has(lower) ? 'upload_failed' : 'not_found_on_disk';
      if (reason === 'upload_failed') {
        filesByType[spec.type].failed += 1;
        failedFiles += 1;
      } else {
        filesByType[spec.type].missing += 1;
        missingFiles += 1;
      }
      const missing: MissingFileInfo = {
        relativePath: spec.path,
        trackId: entry.track_id,
        rekordboxContentId: entry.rekordbox_content_id ?? null,
        assetType: spec.type,
        required: spec.required,
        reason,
      };
      if (spec.required) {
        requiredMissingFiles.push(missing);
        affectedTrackIds.add(entry.track_id);
      } else {
        optionalMissingFiles.push(missing);
      }
    }
  }

  const expectedFiles = filesByType.DAT.expected + filesByType.EXT.expected;
  return {
    expectedFiles,
    optionalArchivalFiles,
    matchedFiles: successfullyUploadedFiles + failedFiles,
    successfullyUploadedFiles,
    failedFiles,
    missingFiles,
    requiredMissingFiles,
    optionalMissingFiles,
    filesByType,
    affectedTrackIds: Array.from(affectedTrackIds),
    tracksRequiringAnalysis,
    tracksAlreadyReusable,
    unavailableTracks,
  };
}
