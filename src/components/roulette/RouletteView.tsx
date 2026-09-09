import { useEffect } from 'react';
import { Play, Stop, VolumeMute, VolumeUp } from '@carbon/icons-react';
import { ControlButton, RangeControl } from '../ui/controls';
import { SurfaceCard } from '../ui/display';
import { StatusBadge } from '../ui/feedback';
import { TransportButton } from '../ui/media';
import { WaveformDisplay } from '../library/WaveformDisplay';
import { useRouletteSession } from '../../features/roulette/RouletteSessionContext';
import type { RouletteSourceRole, RouletteStemStatus } from '../../features/roulette/rouletteSession';
import { useRouletteStemReadiness } from '../../features/roulette/useRouletteStemReadiness';
import { useRouletteSourceTrack } from '../../features/roulette/useRouletteSourceTrack';
import { useRouletteMatchingAvailability } from '../../features/roulette/useRouletteMatchingAvailability';

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

function RouletteStemWaveform({
  role,
  seed,
  fallback,
}: {
  role: RouletteSourceRole;
  seed: string;
  fallback: string;
}) {
  const { playback } = useRouletteSession();
  const peaks = playback.waveforms[role];

  if (peaks.length === 0) {
    return (
      <div
        className="mt-5 flex min-h-24 items-center justify-center rounded-xl border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 text-center"
        aria-label={`${SOURCE_COPY[role].label} waveform area`}
      >
        <p className="text-xs text-muted-foreground">{fallback}</p>
      </div>
    );
  }

  return (
    <div
      className="relative mt-5 h-24 overflow-hidden rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-2"
      aria-label={`${SOURCE_COPY[role].label} stem waveform`}
      data-testid={`roulette-${role}-waveform`}
    >
      <WaveformDisplay
        peaks={peaks}
        seed={seed}
        barCount={peaks.length}
        color={role === 'vocal' ? 'primary' : 'secondary'}
        showFallbackLabel={false}
      />
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        {playback.barFractions.map((fraction, index) => (
          <span
            key={`${fraction}-${index}`}
            className="absolute bottom-0 top-0 w-px bg-foreground/10"
            style={{ left: `${fraction * 100}%` }}
          />
        ))}
        <span
          className="absolute bottom-0 top-0 w-px bg-foreground shadow-[0_0_6px_currentColor]"
          style={{ left: `${playback.progress * 100}%` }}
          data-testid="roulette-shared-playhead"
        />
      </div>
    </div>
  );
}

function RouletteSourceLane({ role }: { role: RouletteSourceRole }) {
  const { state, playback, actions } = useRouletteSession();
  const source = state.sources[role];
  const copy = SOURCE_COPY[role];
  const stemReadiness = useRouletteStemReadiness(source.parentTrackId, role);
  const sourceTrack = useRouletteSourceTrack(source.parentTrackId);
  const effectiveStatus: RouletteStemStatus = stemReadiness.loading
    ? 'preparing'
    : stemReadiness.error
      ? 'failed'
      : stemReadiness.readiness?.status ?? source.stemStatus;
  const status = STEM_STATUS_COPY[effectiveStatus];
  const deckMix = playback.mix[role];
  const waveformFallback = sourceTrack.error
    ? sourceTrack.error
    : stemReadiness.error
      ? stemReadiness.error
      : stemReadiness.readiness?.reason
        ?? (source.parentTrackId && effectiveStatus === 'ready'
          ? playback.status === 'loading'
            ? 'Decoding the real stem waveform…'
            : 'Press Play to load the aligned stem waveform.'
          : source.parentTrackId
            ? 'Stem preparation pending'
            : 'No source selected');

  return (
    <div data-testid={`roulette-${role}-lane`}>
      <SurfaceCard className="min-h-44 rounded-2xl border border-[var(--color-border-subtle)] p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{copy.position}</p>
            <h3 className="mt-1 text-lg font-black">{copy.label}</h3>
            {sourceTrack.track && (
              <div className="mt-2" data-testid={`roulette-${role}-metadata`}>
                <p className="truncate text-sm font-bold">{sourceTrack.track.title}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {sourceTrack.track.artist ?? 'Unknown artist'}
                  {' · '}
                  {sourceTrack.track.camelot_key ?? sourceTrack.track.musical_key ?? 'Unknown key'}
                  {' · '}
                  {sourceTrack.track.bpm?.toFixed(1) ?? '—'} BPM
                </p>
                {playback.anchors[role] && (
                  <p className="mt-1 truncate text-[10px] font-medium text-muted-foreground" data-testid={`roulette-${role}-anchor`}>
                    {playback.anchors[role]!.sourceBar != null
                      ? `Source bar ${playback.anchors[role]!.sourceBar}`
                      : `Source ${Math.round(playback.anchors[role]!.sourceTimeMs / 100) / 10}s`}
                    {' · '}
                    {playback.anchors[role]!.provenance === 'pvdi-phrase'
                      ? 'PVDI + phrase'
                      : playback.anchors[role]!.provenance === 'pvdi-downbeat'
                        ? 'PVDI + downbeat'
                        : playback.anchors[role]!.provenance === 'phrase'
                          ? 'Phrase'
                          : playback.anchors[role]!.provenance === 'downbeat'
                            ? 'Downbeat'
                            : 'BPM fallback'}
                  </p>
                )}
              </div>
            )}
          </div>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        </div>

        <RouletteStemWaveform
          role={role}
          seed={source.stemRef ?? `${role}-empty`}
          fallback={waveformFallback}
        />

        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
          <RangeControl
            value={Math.round(deckMix.gain * 100)}
            min={0}
            max={100}
            label={`${copy.label} gain`}
            onChange={(value) => actions.setDeckGain(role, value / 100)}
          />
          <div className="flex items-center gap-2">
            <TransportButton
              label={deckMix.muted ? `Unmute ${copy.label}` : `Mute ${copy.label}`}
              tone="mute"
              size="compact"
              active={deckMix.muted}
              onClick={() => actions.toggleDeckMute(role)}
            >
              {deckMix.muted ? <VolumeMute size={16} /> : <VolumeUp size={16} />}
            </TransportButton>
            <ControlButton
              variant={deckMix.solo ? 'secondary' : 'surface'}
              aria-pressed={deckMix.solo}
              onClick={() => actions.toggleDeckSolo(role)}
            >
              Solo
            </ControlButton>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}

export function RouletteView() {
  const { state, playback, matchingAvailable, matchingUnavailableReason, playbackAvailable, actions, cancelPending } = useRouletteSession();
  const candidateAvailability = useRouletteMatchingAvailability(matchingAvailable);
  useEffect(() => () => {
    cancelPending();
    actions.stop({ resetVisuals: true });
  }, [actions.stop, cancelPending]);

  const matchingBusy = state.command.status === 'loading';
  const transportBusy = playback.status === 'loading' || playback.status === 'playing';
  const canChangeVocal = matchingAvailable
    && Boolean(state.sources.instrumental.parentTrackId)
    && !matchingBusy
    && !transportBusy;
  const canChangeInstrumental = matchingAvailable
    && Boolean(state.sources.vocal.parentTrackId)
    && !matchingBusy
    && !transportBusy;
  const canPlay = playbackAvailable && !matchingBusy && !transportBusy;
  const canStop = playback.status === 'loading' || playback.status === 'playing';

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
              disabled={!canPlay}
              onClick={() => { void actions.play(); }}
            >
              <Play size={18} fill="currentColor" />
            </TransportButton>
            <TransportButton
              label="Stop Roulette"
              tone="stop"
              disabled={!canStop}
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
              disabled={!canChangeVocal}
              title={state.sources.instrumental.parentTrackId ? 'Replace only the vocal source' : 'Roulette a pair first'}
              onClick={() => { void actions.replaceSource('vocal'); }}
            >
              Change Vocal
            </ControlButton>
            <ControlButton
              variant="surface"
              disabled={!canChangeInstrumental}
              title={state.sources.vocal.parentTrackId ? 'Replace only the instrumental source' : 'Roulette a pair first'}
              onClick={() => { void actions.replaceSource('instrumental'); }}
            >
              Change Instrumental
            </ControlButton>
            <ControlButton
              variant="primary"
              disabled={!matchingAvailable || candidateAvailability.loading || !candidateAvailability.available || matchingBusy || transportBusy}
              title="Resolve and replace both compatible sources"
              onClick={() => { void actions.replaceBoth(); }}
            >
              Roulette Both
            </ControlButton>
          </div>
        </div>

        <p className="mt-4 text-[10px] text-muted-foreground" role="status" data-testid="roulette-command-status">
          {playback.status === 'loading'
            ? 'Preparing and aligning both ready stems…'
            : playback.status === 'playing'
              ? 'Playing aligned vocal + instrumental stems from one shared clock.'
              : playback.error
                ? playback.error
                : state.command.status === 'loading'
                  ? 'Finding compatible stem-ready sources…'
                  : state.command.error
                    ? state.command.error
                    : !matchingAvailable && matchingUnavailableReason
                      ? matchingUnavailableReason
                      : !playbackAvailable && candidateAvailability.loading
                        ? 'Checking prepared Roulette stems…'
                        : !playbackAvailable && !candidateAvailability.available && candidateAvailability.reason
                          ? candidateAvailability.reason
                          : playbackAvailable
                        ? 'Ready for synchronized dual-deck playback.'
                        : 'Roulette a compatible stem-ready pair to enable playback.'}
        </p>
      </SurfaceCard>
    </section>
  );
}
