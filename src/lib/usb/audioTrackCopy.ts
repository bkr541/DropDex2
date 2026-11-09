import type { RekordboxTrack } from '../../types';
import type { DesktopAudioCopyBinding, DesktopAudioCopyOutcome, DesktopAudioCopyPlan, DesktopTransferResult } from '../../types/dropdex-desktop';
import type { UsbTransferRecord } from '../queries/usbDevices';
import { resolveUsbPath } from '../rekordbox/usbPathResolver';

export function audioCopySegments(track: RekordboxTrack, source: DesktopAudioCopyBinding): string[] {
  const resolved = resolveUsbPath(track.file_path || track.file_path_normalized, { expectedVolume: source.details.volumeName });
  if (resolved.status !== 'ok' || !resolved.segments.length) throw new Error('This track does not have a safe file path on the selected USB.');
  return resolved.segments;
}

export function audioCopyTransferResult(plan: DesktopAudioCopyPlan, outcome: DesktopAudioCopyOutcome, startedAt: string, finishedAt: string): DesktopTransferResult {
  const status = outcome.status === 'copied' || outcome.status === 'skipped' ? 'completed' : outcome.status;
  return {
    status, copied: Number(outcome.status === 'copied'), skipped: Number(outcome.status === 'skipped'), failed: Number(outcome.status === 'failed'),
    bytes: outcome.bytes, files: outcome.status === 'cancelled' ? [] : [{ path: plan.destinationPath, size: plan.sizeBytes,
      status: outcome.status === 'copied' ? 'copied' : outcome.status === 'skipped' ? 'skipped' : 'failed',
      ...(outcome.sha256 ? { sha256: outcome.sha256 } : {}),
    }], filesTruncated: false, error: outcome.error, categories: ['tracks'], neededBytes: plan.requiredBytes,
    startedAt, finishedAt, sourceVolumeName: plan.source.details.volumeName, destinationVolumeName: plan.destination.details.volumeName,
  };
}

export interface CopiedAudioRecord { deviceId: string; path: string; size: number; sha256?: string; finishedAt: string }
export function copiedAudioForDevice(deviceId: string, transfers: readonly UsbTransferRecord[], session: readonly CopiedAudioRecord[]): CopiedAudioRecord[] {
  const rows = transfers.filter((transfer) => transfer.destinationDeviceId === deviceId).flatMap((transfer) => transfer.files
    .filter((file) => file.status === 'copied' && file.path.startsWith('DropDex Audio/'))
    .map((file) => ({ deviceId, path: file.path, size: file.size, sha256: file.sha256, finishedAt: transfer.finishedAt })));
  const unique = new Map<string, CopiedAudioRecord>();
  for (const row of [...rows, ...session.filter((row) => row.deviceId === deviceId)].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))) {
    if (!unique.has(row.path)) unique.set(row.path, row);
  }
  return [...unique.values()];
}
