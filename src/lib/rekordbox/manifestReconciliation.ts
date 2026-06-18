import type { ManifestEntry } from '../api/rekordboxImport';
import type { MatchedAnalysisFile } from './analysisPaths';

export type AssetType = 'DAT' | 'EXT' | '2EX';

export interface MissingFileInfo {
  /** Canonical PIONEER-anchored relative path. */
  relativePath: string;
  trackId: string;
  rekordboxContentId: string | null;
  assetType: AssetType;
  /** True when this is a required DAT file; false for optional EXT / 2EX. */
  required: boolean;
  /** Why the file is not in the uploaded set. */
  reason: 'not_found_on_disk' | 'upload_failed';
}

export interface FileTypeStats {
  expected: number;
  uploaded: number;
  /** On disk but upload failed or batch failed. */
  failed: number;
  /** Not found on disk at all. */
  missing: number;
}

export interface ManifestReconciliation {
  /** Total number of paths listed in the manifest (DAT + EXT + 2EX, non-null). */
  expectedFiles: number;
  /** Files found on disk that match a manifest entry (uploaded + failed). */
  matchedFiles: number;
  /** Files the server accepted (received + already_received). */
  successfullyUploadedFiles: number;
  /** Files on disk whose upload failed after all retries. */
  failedFiles: number;
  /** Files in the manifest but absent from the selected folder. */
  missingFiles: number;
  /** Required DAT files not in the uploaded set, with per-file metadata. */
  requiredMissingFiles: MissingFileInfo[];
  /** Optional EXT / 2EX files not in the uploaded set. */
  optionalMissingFiles: MissingFileInfo[];
  filesByType: Record<AssetType, FileTypeStats>;
  /** Track IDs that have at least one required file missing or failed. */
  affectedTrackIds: string[];
}

/**
 * Compare the import manifest against the final upload results and produce a
 * structured reconciliation that the UI can display and that informs the user
 * which tracks may have incomplete analysis.
 *
 * @param manifest        The ManifestEntry[] returned by /start.
 * @param matchedFiles    Files found on the USB that matched a manifest entry.
 * @param uploadedPaths   Lowercase canonical paths accepted by the server
 *                        (from UploadAccumulator.successfullyUploadedPaths).
 */
export function buildManifestReconciliation(
  manifest: ManifestEntry[],
  matchedFiles: MatchedAnalysisFile[],
  uploadedPaths: Set<string>,
): ManifestReconciliation {
  // Build a set of paths that were found on disk (whether or not upload succeeded).
  const matchedPathSet = new Set(matchedFiles.map((f) => f.canonicalPath.toLowerCase()));

  const filesByType: Record<AssetType, FileTypeStats> = {
    DAT: { expected: 0, uploaded: 0, failed: 0, missing: 0 },
    EXT: { expected: 0, uploaded: 0, failed: 0, missing: 0 },
    '2EX': { expected: 0, uploaded: 0, failed: 0, missing: 0 },
  };

  const requiredMissingFiles: MissingFileInfo[] = [];
  const optionalMissingFiles: MissingFileInfo[] = [];
  const affectedTrackIdSet = new Set<string>();
  let successfullyUploadedFiles = 0;
  let failedFiles = 0;
  let missingFiles = 0;

  for (const entry of manifest) {
    const specs: Array<{ path: string | null; type: AssetType; required: boolean }> = [
      { path: entry.dat_path, type: 'DAT', required: entry.dat_required },
      { path: entry.ext_path, type: 'EXT', required: false },
      { path: entry.two_ex_path, type: '2EX', required: false },
    ];

    for (const spec of specs) {
      if (!spec.path) continue; // not expected for this track

      const lower = spec.path.toLowerCase();
      const counts = filesByType[spec.type];
      counts.expected++;

      if (uploadedPaths.has(lower)) {
        counts.uploaded++;
        successfullyUploadedFiles++;
      } else if (matchedPathSet.has(lower)) {
        // Found on disk but upload failed (file-level failure or batch failure).
        counts.failed++;
        failedFiles++;
        const info: MissingFileInfo = {
          relativePath: spec.path,
          trackId: entry.track_id,
          rekordboxContentId: entry.rekordbox_content_id ?? null,
          assetType: spec.type,
          required: spec.required,
          reason: 'upload_failed',
        };
        if (spec.required) {
          requiredMissingFiles.push(info);
          affectedTrackIdSet.add(entry.track_id);
        } else {
          optionalMissingFiles.push(info);
        }
      } else {
        // Not found on the selected USB drive at all.
        counts.missing++;
        missingFiles++;
        const info: MissingFileInfo = {
          relativePath: spec.path,
          trackId: entry.track_id,
          rekordboxContentId: entry.rekordbox_content_id ?? null,
          assetType: spec.type,
          required: spec.required,
          reason: 'not_found_on_disk',
        };
        if (spec.required) {
          requiredMissingFiles.push(info);
          affectedTrackIdSet.add(entry.track_id);
        } else {
          optionalMissingFiles.push(info);
        }
      }
    }
  }

  const expectedFiles =
    filesByType.DAT.expected + filesByType.EXT.expected + filesByType['2EX'].expected;

  return {
    expectedFiles,
    matchedFiles: successfullyUploadedFiles + failedFiles,
    successfullyUploadedFiles,
    failedFiles,
    missingFiles,
    requiredMissingFiles,
    optionalMissingFiles,
    filesByType,
    affectedTrackIds: Array.from(affectedTrackIdSet),
  };
}
