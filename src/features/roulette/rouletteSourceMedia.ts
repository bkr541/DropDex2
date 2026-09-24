import type { RekordboxTrack } from '../../types';
import {
  resolveUsbPath,
  type UsbPathResolution,
  type UsbPathStatus,
} from '../../lib/rekordbox/usbPathResolver';

export type RouletteSourcePathField = 'file_path_normalized' | 'file_path';

export interface ResolvedRouletteSourceMedia {
  status: 'ok';
  sourceField: RouletteSourcePathField;
  sourcePath: string;
  sourceSegments: string[];
  normalizedRelative: string;
  expectedVolumeName: string | null;
}

export interface UnresolvedRouletteSourceMedia {
  status: 'invalid';
  reason: Exclude<UsbPathStatus, 'ok' | 'volume_mismatch'>;
  message: string;
}

export type RouletteSourceMediaResolution = ResolvedRouletteSourceMedia | UnresolvedRouletteSourceMedia;

const RECOVERABLE_SOURCE_MEDIA_ERROR_KINDS = new Set([
  'source_media_required',
  'source_media_mismatch',
  'not_found',
  'permission_denied',
]);

function trimmed(value: string | null | undefined): string | null {
  const result = value?.trim() ?? '';
  return result || null;
}

function sourcePathMessage(status: Exclude<UsbPathStatus, 'ok' | 'volume_mismatch'>): string {
  switch (status) {
    case 'empty_path':
      return 'This track has no local media path.';
    case 'unsafe_path':
    case 'unsupported_scheme':
    case 'invalid_encoding':
      return 'This track has an unsupported local media path.';
    case 'no_filename':
      return 'This track path does not identify an audio file.';
  }
}

function candidatePaths(track: RekordboxTrack): Array<{ field: RouletteSourcePathField; value: string }> {
  const candidates: Array<{ field: RouletteSourcePathField; value: string }> = [];
  const seen = new Set<string>();
  const add = (field: RouletteSourcePathField, value: string | null | undefined) => {
    const normalized = trimmed(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push({ field, value: normalized });
  };

  // file_path_normalized is the current import contract. Keep raw file_path as
  // the legacy fallback for older or unusual Rekordbox rows.
  add('file_path_normalized', track.file_path_normalized);
  add('file_path', track.file_path);
  return candidates;
}

function expectedVolumeName(
  track: RekordboxTrack,
  sourceDeviceName: string | null | undefined,
  resolutions: readonly UsbPathResolution[],
): string | null {
  const importDevice = trimmed(sourceDeviceName);
  if (importDevice) return importDevice;
  const storedVolume = trimmed(track.file_path_volume);
  if (storedVolume) return storedVolume;
  for (const resolution of resolutions) {
    const stripped = trimmed(resolution.strippedVolume);
    if (stripped) return stripped;
  }
  return null;
}

/**
 * Canonical Roulette source-media resolver shared by rough preview and HQ work.
 * It prefers the normalized import path, safely falls back to the legacy raw
 * Rekordbox path, and derives one consistent expected source-volume identity.
 */
export function resolveRouletteSourceMedia(
  track: RekordboxTrack,
  sourceDeviceName: string | null | undefined = null,
): RouletteSourceMediaResolution {
  const candidates = candidatePaths(track);
  if (candidates.length === 0) {
    return { status: 'invalid', reason: 'empty_path', message: sourcePathMessage('empty_path') };
  }

  const attempted = candidates.map((candidate) => ({
    candidate,
    resolution: resolveUsbPath(candidate.value),
  }));
  const resolved = attempted.find(({ resolution }) => resolution.status === 'ok');
  if (!resolved || resolved.resolution.normalizedRelative == null) {
    const firstFailure = attempted[0]?.resolution.status ?? 'empty_path';
    const reason = firstFailure === 'volume_mismatch' ? 'empty_path' : firstFailure;
    return {
      status: 'invalid',
      reason,
      message: sourcePathMessage(reason),
    };
  }

  return {
    status: 'ok',
    sourceField: resolved.candidate.field,
    sourcePath: resolved.candidate.value,
    sourceSegments: resolved.resolution.segments,
    normalizedRelative: resolved.resolution.normalizedRelative,
    expectedVolumeName: expectedVolumeName(
      track,
      sourceDeviceName,
      attempted.map(({ resolution }) => resolution),
    ),
  };
}

export function isRecoverableRouletteSourceMediaError(kind: string): boolean {
  return RECOVERABLE_SOURCE_MEDIA_ERROR_KINDS.has(kind);
}
