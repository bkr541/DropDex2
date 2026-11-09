import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { UsbAudioCopyStatus } from './UsbAudioCopyStatus';
import type { useAudioTrackCopy } from '../../hooks/useAudioTrackCopy';
import type { DesktopAudioCopyPlan } from '../../types/dropdex-desktop';

type Copy = ReturnType<typeof useAudioTrackCopy>;
const plan = { id: 'plan', source: { deviceId: 'a', details: { volumeName: 'REVERIE' } }, destination: { deviceId: 'b', details: { volumeName: 'LUMA' } },
  sourcePath: 'Contents/Track.mp3', destinationPath: 'DropDex Audio/REVERIE/Contents/Track.mp3', sizeBytes: 1024, requiredBytes: 2048, exists: false } as DesktopAudioCopyPlan;
const render = (values: Partial<Copy>) => renderToStaticMarkup(createElement(UsbAudioCopyStatus, { copy: {
  phase: 'review', plan, progress: null, outcome: null, message: null, historyIssue: false, start: vi.fn(), cancel: vi.fn(), ...values,
} as Copy }));

describe('single-file copy review and result', () => {
  it('shows concrete source, destination and size before any copy starts', () => {
    const markup = render({});
    expect(markup).toContain('Review audio file copy');
    expect(markup).toContain('From REVERIE'); expect(markup).toContain('To LUMA');
    expect(markup).toContain(plan.destinationPath); expect(markup).toContain('Copy audio file'); expect(markup).toContain('Cancel');
  });
  it('disables copying when an existing file would conflict', () => {
    const markup = render({ plan: { ...plan, exists: true } });
    expect(markup).toContain('A file already exists');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Copy audio file<\/button>/);
  });
  it('offers cancellation while copying and identifies verification progress', () => {
    const markup = render({ phase: 'running', progress: { planId: 'plan', phase: 'verifying', bytes: 1024, totalBytes: 1024, percent: 96 } });
    expect(markup).toContain('Stop copy'); expect(markup).toContain('Verifying copied bytes');
  });
  it('keeps a successful physical copy distinct from a history-saving failure', () => {
    const markup = render({ phase: 'done', outcome: { status: 'copied', bytes: 1024, sha256: 'hash', destinationPath: plan.destinationPath, error: null, cleanupIncomplete: false }, historyIssue: true });
    expect(markup).toContain('Audio file copied and verified');
    expect(markup).toContain('could not be saved to transfer history');
  });
});
