import type { AnalysisManifestWorkEntry, MatchedAnalysisFile } from './analysisPaths';
import { normalizeAnlzPath, requiredAssetTypesForManifestEntry } from './analysisPaths';
import {
  resolveUsbFile,
  type ResolveUsbFileOptions,
  type UsbFileResult,
} from '../usb/resolveUsbFile';

export type UsbFileResolver = (
  segments: string[],
  options?: ResolveUsbFileOptions,
) => Promise<UsbFileResult>;

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
const REKORDBOX_DB_SEGMENTS = ['PIONEER', 'rekordbox', 'exportLibrary.db'] as const;

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

// Retained for the existing resume-analysis workflow. The normal import path
// now selects through UsbConnectionContext so it shares the canonical USB root.
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

/** Resolve only the canonical Rekordbox database path from the connected USB root. */
export async function resolveRekordboxDatabase(
  resolveFile: UsbFileResolver,
): Promise<File | null> {
  const result = await resolveFile([...REKORDBOX_DB_SEGMENTS]);
  if (result.ok) return result.file;
  if (result.error.kind === 'not_found' || result.error.kind === 'type_mismatch') return null;
  if (result.error.kind === 'abort') {
    throw new DOMException(result.error.message, 'AbortError');
  }
  throw new Error(result.error.message);
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
  const resolveFromRoot: UsbFileResolver = (segments, resolveOptions) => resolveUsbFile(
    root,
    pathSegmentsForSelectedRoot(root, segments.join('/')),
    resolveOptions,
  );
  return resolveRequestedAnalysisFilesWithResolver(resolveFromRoot, requests, {
    ...options,
    sourceRootName: root.name,
  });
}

/**
 * Resolve exact manifest-requested analysis files through the canonical USB
 * resolver. This lets browser and Electron imports share the same root owner
 * without recursively enumerating media folders.
 */
export async function resolveRequestedAnalysisFilesWithResolver(
  resolveFile: UsbFileResolver,
  requests: AnalysisFileRequest[],
  options: { signal?: AbortSignal; concurrency?: number; sourceRootName?: string } = {},
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

      const result = await resolveFile(canonicalPath.split('/').filter(Boolean), { isCancelled });
      if (result.ok) {
        results[index] = {
          file: result.file,
          canonicalPath,
          originalBrowserPath: options.sourceRootName
            ? `${options.sourceRootName}/${canonicalPath}`
            : canonicalPath,
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
