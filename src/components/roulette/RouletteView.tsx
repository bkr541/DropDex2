import { Play, Stop } from '@carbon/icons-react';
import { ControlButton } from '../ui/controls';
import { SurfaceCard } from '../ui/display';
import { StatusBadge } from '../ui/feedback';
import { TransportButton } from '../ui/media';
import { useRouletteSession } from '../../features/roulette/RouletteSessionContext';
import type { RouletteSourceRole, RouletteStemStatus } from '../../features/roulette/rouletteSession';
import { useRouletteStemReadiness } from '../../features/roulette/useRouletteStemReadiness';

const SOURCE_COPY: Record<RouletteSourceRole, { label: string; position: string }> = {
  vocal: { label: 'Vocal', position: 'Top deck' },
  instrumental: { label: 'Instrumental', position: 'Bottom deck' },
};

const STEM_STATUS_COPY: Record<RouletteStemStatus, { label: string; tone: 'neutral' | 'amber' | 'success' | 'error' }> = {
  unavailable: { label: 'Stem unavailable', tone: 'neutral' },
  preparing: { label: 'Preparing stem', tone: 'amber' },
  ready: { label: 'Stem ready', tone: 'success' },
  failed: { label: 'Stem failed', tone: 'error' },
};

function RouletteSourceLane({ role }: { role: RouletteSourceRole }) {
  const { state } = useRouletteSession();
  const source = state.sources[role];
  const copy = SOURCE_COPY[role];
  const stemReadiness = useRouletteStemReadiness(source.parentTrackId, role);
  const effectiveStatus: RouletteStemStatus = stemReadiness.loading
    ? 'preparing'
    : stemReadiness.error
      ? 'failed'
      : stemReadiness.readiness?.status ?? source.stemStatus;
  const status = STEM_STATUS_COPY[effectiveStatus];

  return (
    <div data-testid={`roulette-${role}-lane`}>
      <SurfaceCard className="min-h-44 rounded-2xl border border-[var(--color-border-subtle)] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{copy.position}</p>
            <h3 className="mt-1 text-lg font-black">{copy.label}</h3>
          </div>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        </div>

        <div
          className="mt-5 flex min-h-20 items-center justify-center rounded-xl border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 text-center"
          aria-label={`${copy.label} waveform area`}
        >
          <p className="text-xs text-muted-foreground">
            {stemReadiness.error
              ? stemReadiness.error
              : stemReadiness.readiness?.reason
                ?? (source.parentTrackId && effectiveStatus === 'ready'
                  ? 'Ready for playback'
                  : source.parentTrackId
                    ? 'Stem preparation pending'
                    : 'No source selected')}
          </p>
        </div>
      </SurfaceCard>
    </div>
  );
}

export function RouletteView() {
  const { state, runtimeAvailable, actions } = useRouletteSession();
  const controlsDisabled = !runtimeAvailable;

  return (
    <section className="mx-auto w-full max-w-6xl space-y-5 pb-10 pt-2" data-testid="roulette-screen">
      <div className="grid gap-4" aria-label="Roulette source decks">
        <RouletteSourceLane role="vocal" />
        <RouletteSourceLane role="instrumental" />
      </div>

      <SurfaceCard className="rounded-2xl border border-[var(--color-border-subtle)] p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <TransportButton
              label="Play Roulette"
              tone="play"
              disabled={controlsDisabled}
              onClick={() => actions.play()}
            >
              <Play size={18} fill="currentColor" />
            </TransportButton>
            <TransportButton
              label="Stop Roulette"
              tone="stop"
              disabled={controlsDisabled || state.transport.status === 'stopped'}
              onClick={() => actions.stop()}
            >
              <Stop size={17} fill="currentColor" />
            </TransportButton>
            <div className="ml-1">
              <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Master BPM</p>
              <p className="font-mono text-sm font-bold">{state.transport.masterBpm?.toFixed(1) ?? '—'}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2" aria-label="Roulette replacement actions">
            <ControlButton
              variant="surface"
              disabled={controlsDisabled}
              title="Available after Roulette candidate matching is connected"
              onClick={() => actions.replaceSource('vocal')}
            >
              Change Vocal
            </ControlButton>
            <ControlButton
              variant="surface"
              disabled={controlsDisabled}
              title="Available after Roulette candidate matching is connected"
              onClick={() => actions.replaceSource('instrumental')}
            >
              Change Instrumental
            </ControlButton>
            <ControlButton
              variant="primary"
              disabled={controlsDisabled}
              title="Available after Roulette candidate matching is connected"
              onClick={() => actions.replaceBoth()}
            >
              Roulette Both
            </ControlButton>
          </div>
        </div>

        <p className="mt-4 text-[10px] text-muted-foreground" role="status">
          Source matching and stem playback are not connected in this stage.
        </p>
      </SurfaceCard>
    </section>
  );
}
