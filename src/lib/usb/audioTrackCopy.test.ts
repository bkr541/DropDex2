import { describe, expect, it } from 'vitest';
import type { RekordboxTrack } from '../../types';
import type { DesktopAudioCopyBinding, DesktopAudioCopyOutcome, DesktopAudioCopyPlan } from '../../types/dropdex-desktop';
import type { UsbTransferRecord } from '../queries/usbDevices';
import { audioCopySegments, audioCopyTransferResult, copiedAudioForDevice } from './audioTrackCopy';

const source = { token: 'source-token', deviceId: 'source', details: { volumeName: 'SOURCE' } } as DesktopAudioCopyBinding;
const destination = { token: 'destination-token', deviceId: 'destination', details: { volumeName: 'DESTINATION' } } as DesktopAudioCopyBinding;
const plan = { id: 'plan', source, destination, sourcePath: 'Contents/Track.mp3', destinationPath: 'DropDex Audio/SOURCE/Contents/Track.mp3', sizeBytes: 1024, requiredBytes: 2048, exists: false } as DesktopAudioCopyPlan;
const outcome = (status: DesktopAudioCopyOutcome['status']): DesktopAudioCopyOutcome => ({ status, bytes: status === 'copied' ? 1024 : 0, sha256: status === 'copied' ? 'hash' : null, destinationPath: plan.destinationPath, error: null, cleanupIncomplete: false });

describe('single-track copy requests and history', () => {
  it('normalizes USB-relative paths but refuses another volume, traversal or missing paths', () => {
    const track = (file_path: string | null) => ({ file_path } as RekordboxTrack);
    expect(audioCopySegments(track('file://localhost/Volumes/SOURCE/Contents/Track%20Name.mp3'), source)).toEqual(['Contents', 'Track Name.mp3']);
    for (const file of ['/Volumes/OTHER/Contents/Track.mp3', '/Contents/../Track.mp3', '/Contents/Track%2fName.mp3', null]) expect(() => audioCopySegments(track(file), source)).toThrow();
  });
  it('logs a verified audio copy without Rekordbox categories or activation changes', () => {
    const result = audioCopyTransferResult(plan, outcome('copied'), 'start', 'finish');
    expect(result).toMatchObject({ status: 'completed', copied: 1, skipped: 0, failed: 0, bytes: 1024, categories: ['tracks'] });
    expect(result.files).toEqual([{ path: plan.destinationPath, size: 1024, status: 'copied', sha256: 'hash' }]);
  });
  it('distinguishes skipped, failed and cancelled results from successful copies', () => {
    expect(audioCopyTransferResult(plan, outcome('skipped'), '', '')).toMatchObject({ copied: 0, skipped: 1, bytes: 0 });
    expect(audioCopyTransferResult(plan, outcome('failed'), '', '')).toMatchObject({ copied: 0, failed: 1, status: 'failed' });
    expect(audioCopyTransferResult(plan, outcome('cancelled'), '', '')).toMatchObject({ copied: 0, failed: 0, status: 'cancelled', files: [] });
  });
  it('shows only audio-copy history for the destination, without duplicate or failed entries', () => {
    const transfer = { destinationDeviceId: 'destination', finishedAt: '2026-11-08', files: [
      { path: plan.destinationPath, size: 1024, status: 'copied', sha256: 'hash' },
      { path: 'PIONEER/rekordbox/export.pdb', size: 30, status: 'copied' },
      { path: 'DropDex Audio/missing.mp3', size: 50, status: 'failed' },
    ] } as UsbTransferRecord;
    const session = [{ deviceId: 'destination', path: plan.destinationPath, size: 1024, sha256: 'hash', finishedAt: '2026-11-09' }];
    expect(copiedAudioForDevice('destination', [transfer], session)).toEqual(session);
    expect(copiedAudioForDevice('source', [transfer], session)).toEqual([]);
  });
});
