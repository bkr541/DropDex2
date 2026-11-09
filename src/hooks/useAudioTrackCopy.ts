import { useEffect, useRef, useState } from 'react';
import type { RekordboxTrack } from '../types';
import type { UsbDeviceRecord } from '../lib/queries/usbDevices';
import type { DesktopAudioCopyBinding, DesktopAudioCopyOutcome, DesktopAudioCopyPlan, DesktopAudioCopyProgress, DesktopTransferResult } from '../types/dropdex-desktop';
import { audioCopySegments, audioCopyTransferResult, type CopiedAudioRecord } from '../lib/usb/audioTrackCopy';
import { getDesktopBridge } from './useDesktopUsb';

export type AudioCopyFinished = (result: DesktopTransferResult, source: DesktopAudioCopyBinding, destination: DesktopAudioCopyBinding) => Promise<boolean>;
type Phase = 'idle' | 'locating' | 'preparing' | 'review' | 'running' | 'done' | 'error';
interface State {
  phase: Phase; plan: DesktopAudioCopyPlan | null; progress: DesktopAudioCopyProgress | null;
  outcome: DesktopAudioCopyOutcome | null; message: string | null; historyIssue: boolean;
}
const INITIAL: State = { phase: 'idle', plan: null, progress: null, outcome: null, message: null, historyIssue: false };

export function useAudioTrackCopy(onFinished?: AudioCopyFinished) {
  const bridge = getDesktopBridge();
  const available = Boolean(bridge?.chooseAudioCopyUsb && bridge.prepareAudioCopy && bridge.startAudioCopy && bridge.cancelAudioCopy && bridge.onAudioCopyProgress);
  const [state, setState] = useState<State>(INITIAL);
  const [bindings, setBindings] = useState<Record<string, DesktopAudioCopyBinding>>({});
  const [session, setSession] = useState<CopiedAudioRecord[]>([]);
  const mounted = useRef(true), busy = useRef(false), generation = useRef(0), planId = useRef<string | null>(null);
  const finished = useRef(onFinished); finished.current = onFinished;
  const update = (next: Partial<State>) => { if (mounted.current) setState((current) => ({ ...current, ...next })); };

  useEffect(() => {
    mounted.current = true;
    if (!available || !bridge) return () => { mounted.current = false; };
    const unsubscribe = bridge.onAudioCopyProgress((progress) => {
      if (mounted.current && progress.planId === planId.current) update({ progress });
    });
    return () => {
      mounted.current = false; generation.current += 1; unsubscribe();
      if (planId.current) void bridge.cancelAudioCopy(planId.current).catch(() => {});
    };
  }, [available, bridge]);

  const locate = async (device: UsbDeviceRecord) => {
    if (!available || !bridge || busy.current || planId.current) return;
    const operation = ++generation.current; busy.current = true;
    update({ ...INITIAL, phase: 'locating' });
    try {
      const reply = await bridge.chooseAudioCopyUsb({ deviceId: device.id, deviceKey: device.deviceKey, label: device.label });
      if (!mounted.current || operation !== generation.current) return;
      if ('error' in reply) throw new Error(reply.error);
      if (reply.binding) setBindings((current) => ({ ...current, [device.id]: reply.binding! }));
      update({ phase: 'idle' });
    } catch (error) { update({ phase: 'error', message: error instanceof Error ? error.message : 'The USB could not be located.' }); }
    finally { if (operation === generation.current) busy.current = false; }
  };

  const prepare = async (track: RekordboxTrack, sourceId: string, destinationId: string) => {
    if (!available || !bridge || busy.current || planId.current) return;
    const operation = ++generation.current; busy.current = true;
    update({ ...INITIAL, phase: 'preparing' });
    try {
      const source = bindings[sourceId], destination = bindings[destinationId];
      if (!source || !destination || sourceId === destinationId) throw new Error('Locate both mounted USBs first.');
      const reply = await bridge.prepareAudioCopy({ sourceToken: source.token, destinationToken: destination.token, segments: audioCopySegments(track, source) });
      if ('error' in reply) throw new Error(reply.error);
      if (!mounted.current || operation !== generation.current) { void bridge.cancelAudioCopy(reply.plan.id).catch(() => {}); return; }
      planId.current = reply.plan.id;
      update({ phase: 'review', plan: reply.plan });
    } catch (error) {
      if (operation === generation.current) update({ phase: 'error', message: error instanceof Error ? error.message : 'The file could not be prepared for copying.' });
    } finally { if (operation === generation.current) busy.current = false; }
  };

  const start = async () => {
    if (!bridge || !state.plan || !planId.current || busy.current) return;
    const plan = state.plan, operation = ++generation.current; busy.current = true;
    update({ phase: 'running', progress: null, message: null });
    try {
      const reply = await bridge.startAudioCopy(plan.id);
      if ('error' in reply) throw new Error(reply.error);
      const { result } = reply;
      if (mounted.current && operation === generation.current) {
        if (result.status === 'copied') setSession((current) => [{ deviceId: plan.destination.deviceId, path: plan.destinationPath,
          size: plan.sizeBytes, sha256: result.sha256 ?? undefined, finishedAt: reply.finishedAt }, ...current]);
        update({ phase: 'done', outcome: result, plan, progress: null });
      }
      // Preserve the operation log even if the user leaves while cancellation is finishing.
      const saveHistory = finished.current;
      if (saveHistory) void Promise.resolve().then(() => saveHistory(audioCopyTransferResult(plan, result, reply.startedAt, reply.finishedAt), plan.source, plan.destination))
        .then((saved) => { if (operation === generation.current) update({ historyIssue: !saved }); })
        .catch(() => { if (operation === generation.current) update({ historyIssue: true }); });
    } catch (error) {
      void bridge.cancelAudioCopy(plan.id).catch(() => {});
      if (operation === generation.current) update({ phase: 'error', message: error instanceof Error ? error.message : 'The audio copy failed.' });
    } finally {
      if (operation === generation.current) { busy.current = false; planId.current = null; }
    }
  };

  const cancel = async () => {
    const id = planId.current;
    if (state.phase === 'running' || (busy.current && id)) {
      update({ message: 'Stopping the audio copy…' });
      if (bridge && id) await bridge.cancelAudioCopy(id).catch(() => {});
      return;
    }
    generation.current += 1;
    if (bridge && id) await bridge.cancelAudioCopy(id).catch(() => {});
    planId.current = null; busy.current = false;
    update(INITIAL);
  };

  return { ...state, available, desktop: Boolean(bridge), bindings, session, locate, prepare, start, cancel,
    locked: ['locating', 'preparing', 'review', 'running'].includes(state.phase) };
}
