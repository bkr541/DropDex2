import '../ui/studio-surface.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CandidateRotation } from './CandidateRotation';
import { DropAnalysisStatus } from './DropAnalysisStatus';
import { DropLabControls, DropLabDock } from './DropLabControls';
import { DropLabSourcePicker } from './DropLabSourcePicker';
import { DropLabTrackHeader } from './DropLabTrackHeader';
import { DropLabWaveform } from './DropLabWaveform';
import { useDropLabAnalysis, chooseBestDrop, hasUsableDropLabAnalysis } from '../../hooks/useDropLabAnalysis';
import { useDropLabFlipPicks } from '../../hooks/useDropLabFlipPicks';
import { useDropLabDetailWaveform } from '../../hooks/useDropLabDetailWaveform';
import { useDropLabPreview } from '../../hooks/useDropLabPreview';
import { buildDropLabSegments, resolveTrackDurationMs, type DropLabBarCount, type DropLabBeatOffset } from '../../lib/music/dropLabSegments';
import { sliceWaveformSegment } from '../../lib/music/waveformSegments';
import type { RekordboxTrack } from '../../types';
import type { WaveformLoadState } from '../../lib/queries/waveformValidation';
import { logger } from '../../lib/logger';
import { Flask, NavArrowLeft, Page, Refresh, Search } from 'iconoir-react/regular';
import { useUsbConnection } from '../../contexts/UsbConnectionContext';
import { ControlButton, ToolbarIconButton, ToolbarIconGroup } from '../ui/controls';
import { resolveDropLabLoad, type DropLabLoadMethod, type DropLabSide } from './dropLabDrag';

interface DropLabViewProps {
  sourceTrack: RekordboxTrack | null;
  importId: string | null;
  onBack: () => void;
  onTrackDetails: (track: RekordboxTrack) => void;
  /** Called when Drop Lab picks (or the user chooses) a source and, optionally, a candidate. */
  onPickSource: (sourceTrackId: string, candidateTrackId: string | null, options: { auto: boolean }) => void;
  preservedActiveCandidateId?: string | null;
  preservedActiveCandidate?: RekordboxTrack | null;
  preservedSourceDropId?: string | null;
  preservedCandidateDropId?: string | null;
  onActiveCandidateChange?: (trackId: string | null) => void;
  onDropSelectionChange?: (sourceDropId: string | null, candidateDropId: string | null) => void;
}

function waveformMessageForPanel(
  sourceState: WaveformLoadState | undefined,
  candidateState: WaveformLoadState | undefined,
): string | undefined {
  const states: Array<[string, WaveformLoadState | undefined]> = [
    ['Selected track', sourceState],
    ['Active candidate', candidateState],
  ];
  for (const [label, state] of states) {
    if (state?.status === 'error') return `${label} waveform failed to load.`;
    if (state?.status === 'invalid') return `${label} waveform data is invalid or unsupported.`;
    if (state?.status === 'unavailable') return `${label} has no waveform analysis.`;
  }
  return undefined;
}

function RetryButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="ml-2 shrink-0 rounded px-1.5 text-[10px] font-semibold text-foreground/80 hover:bg-white/10">
      Retry
    </button>
  );
}

function TrackWaveformStatus({ label, state, onRetry }: { label: string; state: WaveformLoadState | undefined; onRetry: () => void }) {
  if (!state || state.status === 'idle' || state.status === 'loading' || state.status === 'loaded') return null;
  if (state.status === 'unavailable') return <DropAnalysisStatus kind="info">{label} has no waveform analysis.</DropAnalysisStatus>;
  if (state.status === 'invalid') return <DropAnalysisStatus kind="warning">{label} waveform is invalid or unsupported: {state.error}</DropAnalysisStatus>;
  return (
    <DropAnalysisStatus kind="warning">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate">{label} waveform failed to load: {state.error}</span>
        <RetryButton onClick={onRetry} label={`Retry ${label.toLowerCase()} waveform`} />
      </div>
    </DropAnalysisStatus>
  );
}

function DetailWaveformStatus({ label, state, usedFallback, onRetry }: { label: string; state: WaveformLoadState; usedFallback: boolean; onRetry: () => void }) {
  if (!usedFallback || state.status === 'idle' || state.status === 'loading' || state.status === 'loaded') return null;
  if (state.status === 'unavailable') return <DropAnalysisStatus kind="info">{label} detailed waveform is unavailable. Using its preview waveform.</DropAnalysisStatus>;
  if (state.status === 'invalid') return <DropAnalysisStatus kind="warning">{label} detailed waveform is invalid or unsupported. Using its preview waveform. {state.error}</DropAnalysisStatus>;
  return (
    <DropAnalysisStatus kind="warning">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate">{label} detailed waveform failed to load. Using its preview waveform. {state.error}</span>
        <RetryButton onClick={onRetry} label={`Retry ${label.toLowerCase()} detailed waveform`} />
      </div>
    </DropAnalysisStatus>
  );
}

export function DropLabView({
  sourceTrack,
  importId,
  onBack,
  onTrackDetails,
  onPickSource,
  preservedActiveCandidateId,
  preservedActiveCandidate,
  preservedSourceDropId,
  preservedCandidateDropId,
  onActiveCandidateChange,
  onDropSelectionChange,
}: DropLabViewProps) {
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(preservedActiveCandidateId ?? null);
  const [barCount, setBarCount] = useState<DropLabBarCount>(8);
  const [beatOffset, setBeatOffset] = useState<DropLabBeatOffset>(0);
  const [selectedDropId, setSelectedDropId] = useState<string | null>(preservedSourceDropId ?? null);
  const [candidateDropId, setCandidateDropId] = useState<string | null>(preservedCandidateDropId ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const usb = useUsbConnection();
  const usbReady = usb.status === 'connected';

  // Same engine as Flip Lab: library pool, best pair when nothing is chosen, ranked candidates after.
  const picks = useDropLabFlipPicks(importId, sourceTrack, preservedActiveCandidate ?? null);
  const candidates = picks.candidates;
  const candidateTracks = useMemo(() => candidates.map((candidate) => candidate.track), [candidates]);
  const analysis = useDropLabAnalysis(sourceTrack, candidateTracks);

  // Opened from the nav with nothing chosen: start with the best pair.
  const autoPickedRef = useRef<string | null>(null);
  useEffect(() => {
    if (sourceTrack || !picks.autoPair) return;
    const key = `${picks.autoPair.sourceTrackId}:${picks.autoPair.candidateTrackId}`;
    if (autoPickedRef.current === key) return;
    autoPickedRef.current = key;
    onPickSource(picks.autoPair.sourceTrackId, picks.autoPair.candidateTrackId, { auto: true });
  }, [onPickSource, picks.autoPair, sourceTrack]);

  useEffect(() => {
    setBeatOffset(0);
    setActiveCandidateId(preservedActiveCandidateId ?? null);
    setSelectedDropId(preservedSourceDropId ?? null);
    setCandidateDropId(preservedCandidateDropId ?? null);
  }, [sourceTrack?.id, preservedActiveCandidateId, preservedSourceDropId, preservedCandidateDropId]);

  useEffect(() => {
    if (activeCandidateId && candidates.some((candidate) => candidate.track.id === activeCandidateId)) return;
    const usable = candidates.find((candidate) => hasUsableDropLabAnalysis(analysis.byTrackId.get(candidate.track.id)));
    const next = (usable ?? candidates[0])?.track.id ?? null;
    setActiveCandidateId(next);
    onActiveCandidateChange?.(next);
  }, [activeCandidateId, analysis.byTrackId, candidates, onActiveCandidateChange]);

  const activeCandidate = useMemo(
    () => (preservedActiveCandidate && preservedActiveCandidate.id === activeCandidateId
      ? preservedActiveCandidate
      : candidates.find((candidate) => candidate.track.id === activeCandidateId)?.track ?? null),
    [activeCandidateId, candidates, preservedActiveCandidate],
  );
  const sourceAnalysis = sourceTrack ? analysis.byTrackId.get(sourceTrack.id) : undefined;
  const candidateAnalysis = activeCandidate ? analysis.byTrackId.get(activeCandidate.id) : undefined;

  useEffect(() => {
    if (!selectedDropId || !sourceAnalysis) return;
    if (sourceAnalysis.dropPoints.some((point) => point.id === selectedDropId)) return;
    setSelectedDropId(null);
    onDropSelectionChange?.(null, candidateDropId);
  }, [candidateDropId, onDropSelectionChange, selectedDropId, sourceAnalysis]);

  useEffect(() => {
    if (!candidateDropId || !candidateAnalysis) return;
    if (candidateAnalysis.dropPoints.some((point) => point.id === candidateDropId)) return;
    setCandidateDropId(null);
    onDropSelectionChange?.(selectedDropId, null);
  }, [candidateAnalysis, candidateDropId, onDropSelectionChange, selectedDropId]);

  const sourceDrop = useMemo(
    () => sourceAnalysis ? sourceAnalysis.dropPoints.find((point) => point.id === selectedDropId) ?? chooseBestDrop(sourceAnalysis.dropPoints) : null,
    [selectedDropId, sourceAnalysis],
  );
  const candidateDrop = useMemo(
    () => candidateAnalysis ? candidateAnalysis.dropPoints.find((point) => point.id === candidateDropId) ?? chooseBestDrop(candidateAnalysis.dropPoints) : null,
    [candidateDropId, candidateAnalysis],
  );

  const segments = useMemo(() => {
    if (!sourceTrack || !activeCandidate) return { source: null, candidate: null, candidateDropMs: null };
    return buildDropLabSegments({
      sourceTrack,
      candidateTrack: activeCandidate,
      sourceDrop,
      candidateDrop,
      sourceBeats: sourceAnalysis?.beatGrid?.beats ?? [],
      candidateBeats: candidateAnalysis?.beatGrid?.beats ?? [],
      barCount,
      beatOffset,
    });
  }, [activeCandidate, barCount, beatOffset, candidateAnalysis, candidateDrop, sourceAnalysis, sourceDrop, sourceTrack]);

  const sourceDetail = useDropLabDetailWaveform(importId, sourceTrack?.id ?? null, sourceAnalysis?.waveformState);
  const candidateDetail = useDropLabDetailWaveform(importId, activeCandidate?.id ?? null, candidateAnalysis?.waveformState);
  const sourceDuration = sourceTrack ? resolveTrackDurationMs(sourceTrack).durationMs : null;
  const candidateDuration = activeCandidate ? resolveTrackDurationMs(activeCandidate).durationMs : null;
  const sourceDisplayWaveform = sourceDetail.displayState.status === 'loaded' ? sourceDetail.displayState.waveform : null;
  const candidateDisplayWaveform = candidateDetail.displayState.status === 'loaded' ? candidateDetail.displayState.waveform : null;

  const sourceWaveformSegment = useMemo(
    () => segments.source ? sliceWaveformSegment(sourceDisplayWaveform, segments.source.startMs, segments.source.endMs, sourceDuration) : null,
    [segments.source, sourceDisplayWaveform, sourceDuration],
  );
  const candidateWaveformSegment = useMemo(
    () => segments.candidate ? sliceWaveformSegment(candidateDisplayWaveform, segments.candidate.startMs, segments.candidate.endMs, candidateDuration) : null,
    [candidateDisplayWaveform, candidateDuration, segments.candidate],
  );
  const waveformPanelMessage = waveformMessageForPanel(sourceAnalysis?.waveformState, candidateAnalysis?.waveformState);

  const preview = useDropLabPreview({
    sourceTrack,
    candidateTrack: activeCandidate,
    sourceSegment: segments.source,
    candidateSegment: segments.candidate,
  });
  useEffect(() => preview.stop, [preview.stop]);

  function handleCandidateSelect(trackId: string) {
    setActiveCandidateId(trackId);
    setBeatOffset(0);
    setCandidateDropId(null);
    onActiveCandidateChange?.(trackId);
    onDropSelectionChange?.(selectedDropId, null);
  }

  // A track from the candidate list goes into the left side (the build, which becomes the
  // selected track) or the right side (the drop, which becomes the active candidate).
  function handleLoadTrack(trackId: string, side: DropLabSide, method: DropLabLoadMethod) {
    const entry = candidates.find((candidate) => candidate.track.id === trackId);
    const action = resolveDropLabLoad(side, trackId, sourceTrack?.id ?? null, activeCandidateId);
    logger.info(`droplab.load.${side}`, { trackId, title: entry?.track.title ?? null, method, result: action.kind });
    if (action.kind === 'set-candidate') {
      handleCandidateSelect(action.trackId);
    } else if (action.kind === 'set-source') {
      preview.stop();
      onPickSource(action.sourceTrackId, action.candidateTrackId, { auto: false });
    }
  }

  function handleSourceDropChange(dropId: string) {
    setSelectedDropId(dropId);
    onDropSelectionChange?.(dropId, candidateDropId);
  }

  function handleCandidateDropChange(dropId: string) {
    setCandidateDropId(dropId);
    onDropSelectionChange?.(selectedDropId, dropId);
  }

  function handlePickSource(track: RekordboxTrack) {
    setPickerOpen(false);
    logger.info('droplab.source.picked', { track: track.title });
    preview.stop();
    onPickSource(track.id, null, { auto: false });
  }

  const previewSeconds = segments.source && segments.candidate ? (segments.source.durationMs + segments.candidate.durationMs) / 1000 : 0;

  const alignmentLabel = beatOffset === -1
    ? 'Candidate starts one beat before its detected drop'
    : beatOffset === 1
      ? 'Candidate starts one beat after its detected drop'
      : 'Candidate starts exactly on its detected drop';

  // Nothing chosen yet: Drop Lab is picking a pair, or could not find one.
  if (!sourceTrack) {
    const stuck = picks.noPairFound || Boolean(picks.error);
    return (
      <div className="studio-surface relative mx-auto flex w-full max-w-xl flex-col items-center gap-3 py-16 text-center">
        <Flask width={40} height={40} aria-hidden="true" className="text-muted-foreground" />
        <h2 className="text-lg font-bold">{stuck ? 'No pair to start with yet' : 'Finding a pair to start with…'}</h2>
        <p className="text-sm text-muted-foreground">
          {picks.error
            ?? (picks.noPairFound
              ? 'Your library has no two tracks close enough in tempo and key to suggest. Choose a source track to begin.'
              : 'Drop Lab is picking two tracks that fit together, using the same matching as Flip Lab.')}
        </p>
        {!stuck && <Refresh width={20} height={20} className="animate-spin text-muted-foreground" aria-label="Loading" />}
        {stuck && (
          <div className="flex items-center gap-2">
            <ControlButton variant="primary" onClick={() => setPickerOpen(true)} className="!min-h-8 text-xs">Choose a source track</ControlButton>
            <button type="button" onClick={onBack} className="rounded-md px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">Back to library</button>
          </div>
        )}
        {pickerOpen && <DropLabSourcePicker tracks={picks.pools?.vocals.map((entry) => entry.track) ?? []} loading={picks.loading} currentId={null} onPick={handlePickSource} onClose={() => setPickerOpen(false)} />}
      </div>
    );
  }

  const issueLines = (
    <>
      {!sourceDrop && <DropAnalysisStatus kind="warning">A drop point could not be identified from this track&apos;s cues or phrase analysis.</DropAnalysisStatus>}
      <TrackWaveformStatus label="Selected track" state={sourceAnalysis?.waveformState} onRetry={() => sourceTrack && analysis.retryWaveform(sourceTrack.id)} />
      <TrackWaveformStatus label="Active candidate" state={candidateAnalysis?.waveformState} onRetry={() => activeCandidate && analysis.retryWaveform(activeCandidate.id)} />
      <DetailWaveformStatus label="Selected track" state={sourceDetail.detailState} usedFallback={sourceDetail.usedFallback} onRetry={sourceDetail.retry} />
      <DetailWaveformStatus label="Active candidate" state={candidateDetail.detailState} usedFallback={candidateDetail.usedFallback} onRetry={candidateDetail.retry} />
      {segments.source?.timingSource === 'bpm' || segments.candidate?.timingSource === 'bpm' ? (
        <DropAnalysisStatus kind="info">Beat-grid timing is incomplete, so BPM timing is being used for this window.</DropAnalysisStatus>
      ) : null}
      {preview.status === 'loading' && <DropAnalysisStatus kind="info">Preparing source and candidate audio for the transition preview.</DropAnalysisStatus>}
      {preview.status !== 'loading' && preview.disabledReason && <DropAnalysisStatus kind="warning">{preview.disabledReason}</DropAnalysisStatus>}
      {preview.ready && activeCandidate && sourceDrop && candidateDrop && <DropAnalysisStatus kind="ready">Transition preview is prepared from decoded source and candidate audio.</DropAnalysisStatus>}
      {picks.error && <DropAnalysisStatus kind="warning">{picks.error}</DropAnalysisStatus>}
      {analysis.error && <DropAnalysisStatus kind="warning">{analysis.error}</DropAnalysisStatus>}
    </>
  );

  return (
    <div className="studio-surface drop-lab-studio relative flex flex-col pb-6">
      {/* Selected track: above the timeline, on the left */}
      <DropLabTrackHeader
        label="Selected track"
        track={sourceTrack}
        dropPoint={sourceDrop}
        actions={(
          <ToolbarIconGroup className="-mt-[7px]">
            <ToolbarIconButton label="Back" onClick={onBack}><NavArrowLeft width={20} height={20} aria-hidden="true" /></ToolbarIconButton>
            <ToolbarIconButton label="Change source track" onClick={() => setPickerOpen((open) => !open)}><Search width={20} height={20} aria-hidden="true" /></ToolbarIconButton>
            <ToolbarIconButton label="Candidate details" onClick={() => activeCandidate && onTrackDetails(activeCandidate)} disabled={!activeCandidate}><Page width={20} height={20} aria-hidden="true" /></ToolbarIconButton>
          </ToolbarIconGroup>
        )}
      />
      {pickerOpen && (
        <DropLabSourcePicker
          tracks={picks.pools?.vocals.map((entry) => entry.track) ?? []}
          loading={picks.loading}
          currentId={sourceTrack.id}
          onPick={handlePickSource}
          onClose={() => setPickerOpen(false)}
        />
      )}

      <DropLabWaveform
        sourceSegment={sourceWaveformSegment}
        candidateSegment={candidateWaveformSegment}
        loading={analysis.loading || sourceDetail.detailState.status === 'loading' || candidateDetail.detailState.status === 'loading'}
        unavailableMessage={waveformPanelMessage}
        previewProgress={preview.progress}
        alignmentLabel={alignmentLabel}
        barCount={barCount}
        onLoadTrack={(trackId, side) => handleLoadTrack(trackId, side, 'drag')}
      />

      {/* Active candidate: below the timeline, on the right, like Flip Lab's instrumental */}
      <DropLabTrackHeader label="Active candidate" track={activeCandidate} dropPoint={candidateDrop} muted={!activeCandidate} side="right" />

      <div className="pb-1">{issueLines}</div>

      <DropLabDock
        previewLabel={preview.buttonLabel}
        previewDisabled={preview.actionDisabled}
        previewPlaying={preview.playing}
        previewLoading={preview.status === 'loading'}
        previewError={preview.status === 'error'}
        previewProgress={preview.progress}
        previewSeconds={previewSeconds}
        disabledReason={preview.disabledReason}
        onPreview={preview.playOrStop}
      />
      <DropLabControls
        beatOffset={beatOffset}
        barCount={barCount}
        sourceDropPoints={sourceAnalysis?.dropPoints ?? []}
        candidateDropPoints={candidateAnalysis?.dropPoints ?? []}
        sourceDropId={sourceDrop?.id ?? null}
        candidateDropId={candidateDrop?.id ?? null}
        previewBlocked={Boolean(preview.disabledReason)}
        onSourceDropChange={handleSourceDropChange}
        onCandidateDropChange={handleCandidateDropChange}
        onBeatOffsetChange={setBeatOffset}
        onBarCountChange={setBarCount}
      />
      <CandidateRotation
        candidates={candidates}
        analyses={analysis.byTrackId}
        activeCandidateId={activeCandidateId}
        loading={picks.loading || analysis.loading}
        usbReady={usbReady}
        onLoadTrack={handleLoadTrack}
      />
    </div>
  );
}
