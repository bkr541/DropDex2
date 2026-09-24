import { useEffect, useRef, useState } from 'react';
import { Chemistry, Play, Renew, Stop, VolumeMute, VolumeUp } from '@carbon/icons-react';
import { ControlButton, RangeControl } from '../ui/controls';
import { SurfaceCard } from '../ui/display';
import { AlertBanner, Dialog, ProgressBar, StatusBadge, StatusLoader } from '../ui/feedback';
import { TransportButton } from '../ui/media';
import { WaveformDisplay } from '../library/WaveformDisplay';
import { useRouletteSession } from '../../features/roulette/RouletteSessionContext';
import type { RouletteSourceRole } from '../../features/roulette/rouletteSession';
import type { RoulettePreviewPreparationState } from '../../features/roulette/roulettePreview';
import { useRouletteSourceTrack } from '../../features/roulette/useRouletteSourceTrack';
import { useRouletteMatchingAvailability } from '../../features/roulette/useRouletteMatchingAvailability';

const SOURCE_COPY: Record<RouletteSourceRole, { label: string; position: string }> = {
  vocal: { label: 'Vocal', position: 'Top deck' },
  instrumental: { label: 'Instrumental', position: 'Bottom deck' },
};

function previewPresentation(
  preview: RoulettePreviewPreparationState | null,
  fallbackStatus: 'unavailable' | 'preparing' | 'ready' | 'failed',
) {
  if (preview?.status === 'ready') {
    return preview.asset?.kind === 'hq'
      ? { label: 'HQ ready', tone: 'success' as const }
      : { label: 'Preview ready', tone: 'success' as const };
  }
  if (preview?.status === 'source-required') return { label: 'Source required', tone: 'amber' as const };
  if (preview?.status === 'queued' || preview?.status === 'running') return { label: 'Preparing preview', tone: 'amber' as const };
  if (preview?.status === 'failed') return { label: 'Preview failed', tone: 'error' as const };
  if (preview?.status === 'cancelled') return { label: 'Cancelled', tone: 'neutral' as const };
  if (fallbackStatus === 'ready') return { label: 'Ready', tone: 'success' as const };
  if (fallbackStatus === 'preparing') return { label: 'Preparing preview', tone: 'amber' as const };
  if (fallbackStatus === 'failed') return { label: 'Preview failed', tone: 'error' as const };
  return { label: 'No source', tone: 'neutral' as const };
}

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
  const { state, playback, previewStates, actions } = useRouletteSession();
  const source = state.sources[role];
  const preview = previewStates[role]?.trackId === source.parentTrackId ? previewStates[role] : null;
  const copy = SOURCE_COPY[role];
  const sourceTrack = useRouletteSourceTrack(source.parentTrackId);
  const status = previewPresentation(preview, source.stemStatus);
  const deckMix = playback.mix[role];
  const preparing = preview?.status === 'queued' || preview?.status === 'running' || source.stemStatus === 'preparing';
  const sourceRequired = preview?.status === 'source-required';
  const retryable = preview?.status === 'failed' || preview?.status === 'cancelled';
  const waveformFallback = sourceTrack.error
    ?? preview?.message
    ?? (source.parentTrackId
      ? preparing
        ? 'Preparing the 16-bar audition source…'
        : source.stemStatus === 'ready'
          ? playback.status === 'loading'
            ? 'Decoding the aligned waveform…'
            : 'Press Play to load the aligned waveform.'
          : 'Preview preparation pending'
      : 'No source selected');

  return (
    <div data-testid={`roulette-${role}-lane`} aria-busy={preparing || undefined}>
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

        {preparing && (
          <div className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
            <StatusLoader variant="dots" tone="active" label={`Preparing ${copy.label.toLowerCase()} preview`} />
            <span>{preview?.status === 'queued' ? 'Queued for preview preparation' : 'Preparing preview source'}</span>
          </div>
        )}

        {sourceRequired && (
          <div className="mt-4">
            <AlertBanner
              title="Source media required"
              message={preview?.connectedVolumeName
                ? `${preview.requiredVolumeName ?? 'The original Rekordbox USB'} is required; ${preview.connectedVolumeName} is connected.`
                : `Reconnect ${preview?.requiredVolumeName ?? 'the original Rekordbox USB'} to continue.`}
              actionLabel="Reconnect"
              onAction={() => { void actions.reconnectSource(role); }}
            />
          </div>
        )}

        {retryable && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2">
            <p className="min-w-0 truncate text-[10px] text-muted-foreground">{preview?.message ?? 'Preview preparation did not complete.'}</p>
            <ControlButton variant="surface" onClick={() => { void actions.retrySource(role); }}>
              <Renew size={13} /> Retry
            </ControlButton>
          </div>
        )}

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
  const {
    state,
    playback,
    previewStates,
    hq,
    matchingAvailable,
    matchingUnavailableReason,
    playbackAvailable,
    actions,
    cancelPending,
  } = useRouletteSession();
  const candidateAvailability = useRouletteMatchingAvailability(matchingAvailable);
  const initialLoadRequested = useRef(false);
  const cancelledRecoveryRequested = useRef(new Set<string>());
  const [pendingSourceChange, setPendingSourceChange] = useState<'vocal' | 'instrumental' | 'both' | null>(null);

  const performSourceChange = (change: 'vocal' | 'instrumental' | 'both') => {
    if (change === 'both') void actions.replaceBoth();
    else void actions.replaceSource(change);
  };

  const requestSourceChange = (change: 'vocal' | 'instrumental' | 'both') => {
    if (playback.status === 'playing' || state.transport.status === 'playing') {
      setPendingSourceChange(change);
      return;
    }
    performSourceChange(change);
  };

  const continueSourceChange = () => {
    const change = pendingSourceChange;
    if (!change) return;
    setPendingSourceChange(null);
    actions.stop();
    performSourceChange(change);
  };

  useEffect(() => {
    if (
      !initialLoadRequested.current
      && matchingAvailable
      && !candidateAvailability.loading
      && candidateAvailability.available
      && !state.sources.vocal.parentTrackId
      && !state.sources.instrumental.parentTrackId
      && state.command.status !== 'loading'
    ) {
      initialLoadRequested.current = true;
      void actions.initialize();
    }
  }, [
    actions,
    candidateAvailability.available,
    candidateAvailability.loading,
    matchingAvailable,
    state.command.status,
    state.sources.instrumental.parentTrackId,
    state.sources.vocal.parentTrackId,
  ]);

  useEffect(() => {
    if (state.command.status === 'loading' || state.transport.status !== 'stopped') return;
    for (const role of ['vocal', 'instrumental'] as const) {
      const source = state.sources[role];
      const preview = previewStates[role];
      if (
        source.parentTrackId
        && source.stemStatus === 'preparing'
        && preview?.trackId === source.parentTrackId
        && preview.status === 'cancelled'
      ) {
        const key = `${role}:${source.parentTrackId}`;
        if (!cancelledRecoveryRequested.current.has(key)) {
          cancelledRecoveryRequested.current.add(key);
          void actions.retrySource(role);
        }
        break;
      }
    }
  }, [actions, previewStates, state.command.status, state.sources, state.transport.status]);

  useEffect(() => () => {
    cancelPending();
    actions.stop({ resetVisuals: true });
  }, [actions.stop, cancelPending]);

  const matchingBusy = state.command.status === 'loading';
  const transportBusy = playback.status === 'loading' || playback.status === 'playing';
  const sourceChangeTransportBusy = playback.status === 'loading';
  const selectedVocalPreview = previewStates.vocal?.trackId === state.sources.vocal.parentTrackId
    ? previewStates.vocal
    : null;
  const selectedInstrumentalPreview = previewStates.instrumental?.trackId === state.sources.instrumental.parentTrackId
    ? previewStates.instrumental
    : null;
  const sourceRecoveryBusy = selectedVocalPreview?.status === 'running'
    || selectedVocalPreview?.status === 'queued'
    || selectedInstrumentalPreview?.status === 'running'
    || selectedInstrumentalPreview?.status === 'queued';
  const hqBusy = hq.status === 'preparing';
  const canChangeVocal = matchingAvailable
    && candidateAvailability.available
    && state.sources.instrumental.stemStatus === 'ready'
    && Boolean(state.sources.instrumental.parentTrackId && state.sources.instrumental.stemRef)
    && !matchingBusy
    && !sourceChangeTransportBusy
    && !sourceRecoveryBusy
    && !hqBusy;
  const canChangeInstrumental = matchingAvailable
    && candidateAvailability.available
    && state.sources.vocal.stemStatus === 'ready'
    && Boolean(state.sources.vocal.parentTrackId && state.sources.vocal.stemRef)
    && !matchingBusy
    && !sourceChangeTransportBusy
    && !sourceRecoveryBusy
    && !hqBusy;
  const canPlay = playbackAvailable && !matchingBusy && !transportBusy && !hqBusy;
  const canStop = playback.status === 'loading' || playback.status === 'playing';
  const canPrepareHq = playbackAvailable && !matchingBusy && !transportBusy && !sourceRecoveryBusy;
  const hasSourceRequired = selectedVocalPreview?.status === 'source-required'
    || selectedInstrumentalPreview?.status === 'source-required';

  const mainStatus = playback.status === 'loading'
    ? 'Preparing aligned playback…'
    : playback.status === 'playing'
      ? 'Playing aligned vocal + instrumental stems from one shared clock.'
      : playback.error
        ? playback.error
        : hq.status === 'preparing'
          ? `Preparing ${hq.activeRole === 'vocal' ? 'vocal' : 'instrumental'} HQ stem…`
          : hq.status === 'partial'
            ? hq.message ?? 'One HQ stem is ready; retry the remaining stem when convenient.'
            : hq.status === 'failed'
              ? hq.message ?? 'HQ preparation failed.'
              : state.command.status === 'loading'
                ? 'Selecting and preparing compatible preview sources…'
                : hasSourceRequired
                  ? 'Reconnect the required Rekordbox source media to continue preview preparation.'
                  : state.command.error
                    ? state.command.error
                    : !matchingAvailable && matchingUnavailableReason
                      ? matchingUnavailableReason
                      : candidateAvailability.loading
                      ? 'Checking compatible Roulette candidates…'
                      : !candidateAvailability.available && candidateAvailability.reason
                        ? candidateAvailability.reason
                        : playbackAvailable
                          ? 'Ready for synchronized dual-deck playback.'
                          : state.sources.vocal.parentTrackId || state.sources.instrumental.parentTrackId
                            ? 'Finish preview preparation to enable playback.'
                            : 'Selecting an intelligent compatible pair…';

  return (
    <section className="mx-auto w-full max-w-6xl space-y-5 pb-10 pt-2" data-testid="roulette-screen">
      <div className="flex flex-wrap items-center gap-2 px-1" aria-label="Roulette readiness summary">
        <StatusBadge tone={candidateAvailability.available ? 'success' : 'neutral'}>
          {candidateAvailability.loading
            ? 'Checking candidates'
            : `${candidateAvailability.compatiblePairCount} compatible pair${candidateAvailability.compatiblePairCount === 1 ? '' : 's'}`}
        </StatusBadge>
        {hq.status === 'ready' && <StatusBadge tone="success">HQ ready</StatusBadge>}
        {hq.status === 'partial' && <StatusBadge tone="amber">HQ partial</StatusBadge>}
      </div>

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
              onClick={() => requestSourceChange('vocal')}
            >
              Change Vocal
            </ControlButton>
            <ControlButton
              variant="surface"
              disabled={!canChangeInstrumental}
              title={state.sources.vocal.parentTrackId ? 'Replace only the instrumental source' : 'Roulette a pair first'}
              onClick={() => requestSourceChange('instrumental')}
            >
              Change Instrumental
            </ControlButton>
            <ControlButton
              variant="primary"
              disabled={!matchingAvailable || candidateAvailability.loading || !candidateAvailability.available || matchingBusy || sourceChangeTransportBusy || sourceRecoveryBusy || hqBusy}
              title="Resolve and replace both compatible sources"
              onClick={() => requestSourceChange('both')}
            >
              Roulette Both
            </ControlButton>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 border-t border-[var(--color-border-subtle)] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground">High-quality stems</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {hq.status === 'ready'
                ? 'Both decks will use HQ stems at the next safe playback boundary.'
                : hq.status === 'partial'
                  ? hq.message ?? 'One HQ stem is complete.'
                  : hq.status === 'failed' || hq.status === 'cancelled'
                    ? hq.message
                    : 'Optional for the current pairing.'}
            </p>
          </div>
          <ControlButton
            variant={hqBusy ? 'surface' : 'secondary'}
            disabled={!hqBusy && (!canPrepareHq || hq.status === 'ready')}
            onClick={() => {
              if (hqBusy) void actions.cancelHighQuality();
              else void actions.prepareHighQuality();
            }}
            aria-label={hqBusy ? 'Cancel high-quality Roulette stem preparation' : 'Prepare high-quality Roulette stems'}
          >
            {hqBusy
              ? <><Stop size={14} /> Cancel HQ</>
              : hq.status === 'partial' || hq.status === 'failed' || hq.status === 'cancelled'
                ? <><Renew size={14} /> Retry HQ Stems</>
                : <><Chemistry size={14} /> Prepare HQ Stems</>}
          </ControlButton>
        </div>

        {(hqBusy || hq.status === 'partial' || hq.status === 'ready') && (
          <ProgressBar
            className="mt-3"
            value={hq.progress * 100}
            tone={hq.status === 'ready' ? 'success' : hq.status === 'partial' ? 'warning' : 'active'}
            showValue
            label="High-quality Roulette stem preparation"
          />
        )}

        <p className="mt-4 text-[10px] text-muted-foreground" role="status" data-testid="roulette-command-status">
          {mainStatus}
        </p>
      </SurfaceCard>
      <Dialog
        open={pendingSourceChange !== null}
        title="Stop Roulette playback?"
        onClose={() => setPendingSourceChange(null)}
        closeOnBackdrop
        actions={[
          { label: 'Cancel', onClick: () => setPendingSourceChange(null), variant: 'neutral' },
          { label: 'Continue', onClick: continueSourceChange, variant: 'primary' },
        ]}
      >
        <p>This action will stop current playback.</p>
      </Dialog>
    </section>
  );
}
