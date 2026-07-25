import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  registerUsbPlaybackStopHandler,
  stopUsbBackedPlayback,
} from './usbPlaybackCoordinator';

const unregister: Array<() => void> = [];
afterEach(() => {
  unregister.splice(0).forEach((remove) => remove());
});

describe('USB playback release coordinator', () => {
  it('stops every registered USB playback source without touching unrelated playback', async () => {
    const usbAudio = vi.fn();
    const usbPreview = vi.fn();
    const nonUsbPlayback = vi.fn();
    unregister.push(registerUsbPlaybackStopHandler(usbAudio));
    unregister.push(registerUsbPlaybackStopHandler(usbPreview));

    const errors = await stopUsbBackedPlayback();

    expect(errors).toEqual([]);
    expect(usbAudio).toHaveBeenCalledOnce();
    expect(usbPreview).toHaveBeenCalledOnce();
    expect(nonUsbPlayback).not.toHaveBeenCalled();
  });

  it('runs all cleanup handlers even when one fails', async () => {
    const laterHandler = vi.fn();
    unregister.push(registerUsbPlaybackStopHandler(() => {
      throw new Error('preview cleanup failed');
    }));
    unregister.push(registerUsbPlaybackStopHandler(laterHandler));

    const errors = await stopUsbBackedPlayback();

    expect(laterHandler).toHaveBeenCalledOnce();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe('preview cleanup failed');
  });
});
