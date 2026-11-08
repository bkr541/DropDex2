import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { useAudioPlayer } from '../../contexts/AudioPlayerContext';
import { useUsbConnection } from '../../contexts/UsbConnectionContext';
import { registerUsbPlaybackStopHandler } from '../../lib/usb/usbPlaybackCoordinator';
import { prepareSetLabAudio } from './prepareSetLabAudio';
import { createSetLabPreviewController } from './setLabPreviewController';
import type { SetLabFiveSlots, SetLabScope } from './session';

export function setLabAudioPlanKey(scope: SetLabScope, slots: SetLabFiveSlots | null): string {
  return JSON.stringify([scope.userId, scope.sourceImportId, slots?.map((slot) => [
    slot.position, slot.trackId, slot.trackIdentityKey, slot.section.startMs, slot.section.endMs, slot.barCount,
  ])]);
}

export function useSetLabPreview({ scope, slots, importDeviceName }: {
  scope: SetLabScope;
  slots: SetLabFiveSlots | null;
  importDeviceName: string | null;
}) {
  const usb = useUsbConnection();
  const global = useAudioPlayer();
  const stopGlobal = global.stop;
  const controllerRef = useRef<ReturnType<typeof createSetLabPreviewController> | null>(null);
  const controller = controllerRef.current ??= createSetLabPreviewController({ stopGlobal });
  const plan = setLabAudioPlanKey(scope, slots);
  const status = useSyncExternalStore(controller.subscribe, controller.getStatus, controller.getStatus);

  useLayoutEffect(() => {
    controller.invalidate();
  }, [controller, plan]);

  useLayoutEffect(() => {
    controller.sourceChanged();
  }, [controller, importDeviceName, usb.status, usb.volumeName, usb.handle, usb.connectedAt, usb.resolveTrackSource]);

  useLayoutEffect(() => registerUsbPlaybackStopHandler(controller.sourceChanged), [controller]);
  useLayoutEffect(() => () => controller.dispose(), [controller]);

  // A new request from the global player wins over a currently audible set.
  // Set Lab itself stops that player immediately before scheduling its clips.
  useLayoutEffect(() => {
    if ((global.playIntent || global.status === 'resolving') && controller.getStatus() === 'playing') {
      controller.pause();
    }
  }, [controller, global.playIntent, global.status, global.activeTrack?.id]);

  return {
    status,
    subscribe: controller.subscribe,
    getSnapshot: controller.getSnapshot,
    play() {
      if (!slots) return;
      void controller.play((context, signal, cache) =>
        prepareSetLabAudio({ ...scope, slots, context, signal, cache, importDeviceName }, { usb }));
    },
    pause: controller.pause,
    stopAndReset: controller.stopAndReset,
  };
}

export type SetLabPreview = ReturnType<typeof useSetLabPreview>;
