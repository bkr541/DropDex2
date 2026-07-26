import { resolveUsbPath } from '../rekordbox/usbPathResolver';
import type { RekordboxTrack } from '../../types';
import type { DropLabTimeSegment } from './dropLabSegments';

export type DropLabPreviewUsbStatus =
  | 'unsupported'
  | 'disconnected'
  | 'permission-required'
  | 'connecting'
  | 'connected'
  | 'released'
  | 'wrong_root'
  | 'unavailable'
  | 'error';

function fileStatus(track: RekordboxTrack): string | null {
  if (!track.file_path) return 'Missing audio file path';
  const resolved = resolveUsbPath(track.file_path);
  if (resolved.status !== 'ok') return 'Audio path unavailable';
  return null;
}

/**
 * Returns only stable preparation prerequisites.
 *
 * Runtime states such as "loading" and "error" deliberately do not belong
 * here. Keeping them separate prevents a loading status update from becoming
 * an effect dependency that aborts and restarts the same decode request.
 */
export function getDropLabPreviewPrerequisiteReason(input: {
  sourceTrack: RekordboxTrack | null;
  candidateTrack: RekordboxTrack | null;
  sourceSegment: DropLabTimeSegment | null;
  candidateSegment: DropLabTimeSegment | null;
  usbStatus: DropLabPreviewUsbStatus;
}): string | null {
  if (!input.sourceTrack || !input.candidateTrack) return 'Choose a candidate';
  if (!input.sourceSegment || !input.candidateSegment) return 'Drop point unavailable';
  const sourceFileError = fileStatus(input.sourceTrack);
  if (sourceFileError) return sourceFileError;
  const candidateFileError = fileStatus(input.candidateTrack);
  if (candidateFileError) return candidateFileError;
  if (
    input.usbStatus === 'disconnected' ||
    input.usbStatus === 'released' ||
    input.usbStatus === 'permission-required' ||
    input.usbStatus === 'unavailable' ||
    input.usbStatus === 'wrong_root'
  ) {
    return 'Connect USB to preview';
  }
  if (input.usbStatus === 'unsupported') return 'USB preview unsupported';
  if (input.usbStatus === 'connecting') return 'Connecting USB';
  if (input.usbStatus === 'error') return 'USB access failed';
  return null;
}
