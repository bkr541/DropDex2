import { useSyncExternalStore } from 'react';
import { Pause, Play, Square } from 'iconoir-react/regular';
import { TransportButton } from '../../components/ui/media';
import type { SetLabPreview } from './useSetLabPreview';

export function SetLabTransport({ preview, durationMs, disabled }: {
  preview: SetLabPreview;
  durationMs: number;
  disabled: boolean;
}) {
  const state = useSyncExternalStore(preview.subscribe, preview.getSnapshot, preview.getSnapshot);
  const playing = state.status === 'playing';
  const preparing = state.status === 'preparing';
  const label = playing ? 'Pause Set' : state.status === 'paused' ? 'Resume Set' : 'Play Set';
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label="Set Lab transport">
      <TransportButton label={label} tone="play" active={playing} disabled={disabled || preparing}
        onClick={playing ? preview.pause : preview.play}>
        {playing ? <Pause width={17} height={17} aria-hidden="true" /> : <Play width={17} height={17} aria-hidden="true" />}
      </TransportButton>
      <TransportButton label={preparing ? 'Cancel audio preparation' : 'Stop Set'} tone="stop"
        disabled={state.status === 'idle' || state.status === 'error'} onClick={preview.stopAndReset}>
        <Square width={17} height={17} aria-hidden="true" />
      </TransportButton>
      <span className="font-mono text-xs tabular-nums">
        {state.positionSeconds.toFixed(1)} / {(durationMs / 1000).toFixed(1)} s
      </span>
      {preparing && <span className="text-xs text-muted-foreground" role="status">Preparing five audio sections…</span>}
      {state.status === 'ended' && <span className="text-xs text-muted-foreground" role="status">Set finished</span>}
      {state.error && <p className="basis-full text-xs text-muted-foreground" role="alert">{state.error}</p>}
    </div>
  );
}

export function SetLabPlayhead({ preview, durationMs, offsetMs = 0 }: { preview: SetLabPreview; durationMs: number; offsetMs?: number }) {
  const { positionSeconds } = useSyncExternalStore(preview.subscribe, preview.getSnapshot, preview.getSnapshot);
  const localMs = positionSeconds * 1000 - offsetMs;
  if (localMs < 0 || localMs > durationMs) return null;
  const percent = Math.min(100, Math.max(0, localMs / durationMs * 100));
  return (
    <span data-testid="set-lab-playhead" aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 z-10 w-px -translate-x-1/2 bg-primary"
      style={{ left: `clamp(1px, ${percent}%, calc(100% - 1px))` }} />
  );
}
