import type { AnalysisManifestWorkEntry, MatchedAnalysisFile } from './analysisPaths';
import { normalizeAnlzPath, requiredAssetTypesForManifestEntry } from './analysisPaths';
import { resolveUsbFile } from '../usb/resolveUsbFile';

export interface TargetedUsbSelection {
  rootHandle: FileSystemDirectoryHandle;
  dbFile: File | null;
  folderName: string;
}

export interface AnalysisFileRequest {
  canonicalPath: string;
  assetType: 'DAT' | 'EXT' | '2EX';
  trackId: string;
}

export interface TargetedAnalysisResolution {
  matched: MatchedAnalysisFile[];
  missing: AnalysisFileRequest[];
}

const DEFAULT_RESOLVE_CONCURRENCY = 8;

export function supportsTargetedUsbDiscovery(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

function pathSegmentsForSelectedRoot(
  root: FileSystemDirectoryHandle,
  canonicalPath: string,
): string[] {
  const segments = canonicalPath.split('/').filter(Boolean);
  if (
    segments.length > 1
    && root.name.trim().toLowerCase() === segments[0].trim().toLowerCase()
  ) {
    return segments.slice(1);
  }
  return segments;
}

export async function pickTargetedRekordboxUsb(): Promise<TargetedUsbSelection> {
  const picker = window.showDirectoryPicker;
  if (!picker) throw new Error('Targeted USB folder access is not supported in this browser.');

  const rootHandle = await picker({ id: 'dropdex-rekordbox-import', mode: 'read' });
  const dbPath = 'PIONEER/rekordbox/exportLibrary.db';
  const result = await resolveUsbFile(
    rootHandle,
    pathSegmentsForSelectedRoot(rootHandle, dbPath),
  );

  return {
    rootHandle,
    dbFile: result.ok ? result.file : null,
    folderName: rootHandle.name || 'Selected USB',
  };
}

export function buildManifestAnalysisRequests(
  manifest: AnalysisManifestWorkEntry[],
): AnalysisFileRequest[] {
  const requests: AnalysisFileRequest[] = [];
  for (const entry of manifest) {
    const required = requiredAssetTypesForManifestEntry(entry);
    if (required.includes('DAT') && entry.dat_path) {
      requests.push({
        canonicalPath: entry.dat_path,
        assetType: 'DAT',
        trackId: entry.track_id,
      });
    }
    if (required.includes('EXT') && entry.ext_path) {
      requests.push({
        canonicalPath: entry.ext_path,
        assetType: 'EXT',
        trackId: entry.track_id,
      });
    }
  }
  return requests;
}

/**
 * Resolve only explicitly requested ANLZ files from a selected Rekordbox USB.
 * No media folders are enumerated, so music files and unrelated USB content are
 * never converted into browser File objects during import discovery.
 */
export async function resolveRequestedAnalysisFiles(
  root: FileSystemDirectoryHandle,
  requests: AnalysisFileRequest[],
  options: { signal?: AbortSignal; concurrency?: number } = {},
): Promise<TargetedAnalysisResolution> {
  if (requests.length === 0) return { matched: [], missing: [] };

  const signal = options.signal;
  const concurrency = Math.max(
    1,
    Math.min(options.concurrency ?? DEFAULT_RESOLVE_CONCURRENCY, requests.length),
  );
  const results: Array<MatchedAnalysisFile | null> = new Array(requests.length).fill(null);
  const missing = new Set<number>();
  let nextIndex = 0;

  const isCancelled = () => Boolean(signal?.aborted);
  const worker = async () => {
    while (true) {
      if (signal?.aborted) throw new DOMException('USB file discovery aborted', 'AbortError');
      const index = nextIndex;
      nextIndex += 1;
      if (index >= requests.length) return;

      const request = requests[index];
      const canonicalPath = normalizeAnlzPath(request.canonicalPath);
      if (!canonicalPath) {
        missing.add(index);
        continue;
      }

      const result = await resolveUsbFile(
        root,
        pathSegmentsForSelectedRoot(root, canonicalPath),
        { isCancelled },
      );
      if (result.ok) {
        results[index] = {
          file: result.file,
          canonicalPath,
          originalBrowserPath: `${root.name}/${canonicalPath}`,
          assetType: request.assetType,
          trackId: request.trackId,
        };
        continue;
      }

      if (result.error.kind === 'abort') {
        throw new DOMException('USB file discovery aborted', 'AbortError');
      }
      if (result.error.kind === 'not_found' || result.error.kind === 'type_mismatch') {
        missing.add(index);
        continue;
      }
      throw new Error(result.error.message);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return {
    matched: results.filter((item): item is MatchedAnalysisFile => item !== null),
    missing: requests.filter((_, index) => missing.has(index)),
  };
}
