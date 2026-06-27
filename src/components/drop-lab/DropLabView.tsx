import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, FlaskConical } from 'lucide-react';
import { CandidateRotation } from './CandidateRotation';
import { DropAnalysisStatus } from './DropAnalysisStatus';
import { DropLabControls } from './DropLabControls';
import { DropLabTrackHeader } from './DropLabTrackHeader';
import { DropLabWaveform } from './DropLabWaveform';
import { useDropLabAnalysis, chooseBestDrop, hasUsableDropLabAnalysis } from '../../hooks/useDropLabAnalysis';
import { useDropLabCandidates } from '../../hooks/useDropLabCandidates';
import { useDropLabDetailWaveform } from '../../hooks/useDropLabDetailWaveform';
import { useDropLabPreview } from '../../hooks/useDropLabPreview';
import { buildDropLabSegments, resolveTrackDurationMs, type DropLabBarCount, type DropLabBeatOffset } from '../../lib/music/dropLabSegments';
import { sliceWaveformSegment } from '../../lib/music/waveformSegments';
import type { RekordboxTrack } from '../../types';

interface DropLabViewProps {
  sourceTrack: RekordboxTrack | null;
  importId: string | null;
  onBack: () => void;
  onTrackDetails: (track: RekordboxTrack) => void;
  preservedActiveCandidateId?: string | null;
  onActiveCandidateChange?: (trackId: string | null) => void;
}

export function DropLabView({
  sourceTrack,
  importId,
  onBack,
  onTrackDetails,
  preservedActiveCandidateId,
  onActiveCandidateChange,
}: DropLabViewProps) {
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(preservedActiveCandidateId ?? null);
  const [barCount, setBarCount] = useState<DropLabBarCount>(8);
  const [beatOffset, setBeatOffset] = useState<DropLabBeatOffset>(0);
  const [selectedDropId] = useState<string | null>(null);
  const [candidateDropId] = useState<string | null>(null);

  const { candidates, loading: candidatesLoading } = useDropLabCandidates(sourceTrack, importId);
  const candidateTracks = useMemo(() => candidates.map((candidate) => candidate.track), [candidates]);
  const analysis = useDropLabAnalysis(sourceTrack, candidateTracks);

  useEffect(() => {
    setBeatOffset(0);
    setActiveCandidateId(preservedActiveCandidateId ?? null);
  }, [sourceTrack?.id, preservedActiveCandidateId]);

  useEffect(() => {
    if (activeCandidateId && candidates.some((candidate) => candidate.track.id === activeCandidateId)) return;
    const usable = candidates.find((candidate) => hasUsableDropLabAnalysis(analysis.byTrackId.get(candidate.track.id)));
    const fallback = candidates[0];
    const next = (usable ?? fallback)?.track.id ?? null;
    setActiveCandidateId(next);
    onActiveCandidateChange?.(next);
  }, [activeCandidateId, analysis.byTrackId, candidates, onActiveCandidateChange]);

  const activeCandidate = useMemo(
    () => candidates.find((candidate) => candidate.track.id === activeCandidateId)?.track ?? null,
    [activeCandidateId, candidates],
  );
  const sourceAnalysis = sourceTrack ? analysis.byTrackId.get(sourceTrack.id) : undefined;
  const candidateAnalysis = activeCandidate ? analysis.byTrackId.get(activeCandidate.id) : undefined;
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

  const sourceDetail = useDropLabDetailWaveform(importId, sourceTrack?.id ?? null, sourceAnalysis?.waveform);
  const candidateDetail = useDropLabDetailWaveform(importId, activeCandidate?.id ?? null, candidateAnalysis?.waveform);
  const sourceDuration = sourceTrack ? resolveTrackDurationMs(sourceTrack, sourceAnalysis?.beatGrid?.beats ?? []).durationMs : null;
  const candidateDuration = activeCandidate ? resolveTrackDurationMs(activeCandidate, candidateAnalysis?.beatGrid?.beats ?? []).durationMs : null;

  const sourceWaveformSegment = useMemo(
    () => segments.source ? sliceWaveformSegment(sourceDetail.waveform, segments.source.startMs, segments.source.endMs, sourceDuration) : null,
    [segments.source, sourceDetail.waveform, sourceDuration],
  );
  const candidateWaveformSegment = useMemo(
    () => segments.candidate ? sliceWaveformSegment(candidateDetail.waveform, segments.candidate.startMs, segments.candidate.endMs, candidateDuration) : null,
    [candidateDetail.waveform, candidateDuration, segments.candidate],
  );

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
    onActiveCandidateChange?.(trackId);
  }

  if (!sourceTrack) {
    return (
      <div className="md:max-w-3xl md:mx-auto py-12 text-center space-y-4">
        <FlaskConical size={42} className="mx-auto text-muted-foreground" />
        <h2 className="text-2xl font-black italic">Drop Lab</h2>
        <p className="text-sm text-muted-foreground">Open Drop Lab from Track Intelligence so a source track can be fixed for comparison.</p>
        <button onClick={onBack} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-bold">Back to Library</button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto pb-24 space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <button onClick={onBack} className="p-1 -ml-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-[var(--color-surface-hover)] transition-all shrink-0" aria-label="Back to Track Intelligence">
              <ChevronLeft size={20} />
            </button>
            <h2 className="text-2xl md:text-3xl font-black italic">Drop Lab</h2>
          </div>
          <p className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-[0.2em] pl-7">
            Test how different drops land against the selected track&apos;s buildup.
          </p>
        </div>
      </header>

      <div className="glass rounded-3xl border border-[var(--color-border-subtle)] p-4 md:p-6 space-y-5">
        <div className="grid gap-5 lg:grid-cols-2">
          <DropLabTrackHeader label="Selected Track" track={sourceTrack} dropPoint={sourceDrop} />
          <DropLabTrackHeader label="Active Candidate" track={activeCandidate} dropPoint={candidateDrop} muted={!activeCandidate} />
        </div>

        <DropLabWaveform
          sourceSegment={sourceWaveformSegment}
          candidateSegment={candidateWaveformSegment}
          loading={analysis.loading || sourceDetail.loading || candidateDetail.loading}
        />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.72fr)]">
          <div className="space-y-2">
            {!sourceDrop && (
              <DropAnalysisStatus kind="warning">A drop point could not be identified from this track&apos;s cues or phrase analysis.</DropAnalysisStatus>
            )}
            {(sourceDetail.usedFallback || candidateDetail.usedFallback) && (
              <DropAnalysisStatus kind="info">Detailed waveform unavailable. Using preview waveform.</DropAnalysisStatus>
            )}
            {segments.source?.timingSource === 'bpm' || segments.candidate?.timingSource === 'bpm' ? (
              <DropAnalysisStatus kind="info">Beat-grid timing is incomplete, so BPM timing is being used for this window.</DropAnalysisStatus>
            ) : null}
            {preview.disabledReason && (
              <DropAnalysisStatus kind="warning">{preview.disabledReason}</DropAnalysisStatus>
            )}
            {!preview.disabledReason && activeCandidate && sourceDrop && candidateDrop && (
              <DropAnalysisStatus kind="ready">Transition preview is prepared from decoded source and candidate audio.</DropAnalysisStatus>
            )}
            {analysis.error && <DropAnalysisStatus kind="warning">{analysis.error}</DropAnalysisStatus>}
          </div>

          <CandidateRotation
            candidates={candidates}
            analyses={analysis.byTrackId}
            activeCandidateId={activeCandidateId}
            loading={candidatesLoading || analysis.loading}
            onSelect={handleCandidateSelect}
          />
        </div>
      </div>

      <DropLabControls
        beatOffset={beatOffset}
        barCount={barCount}
        previewLabel={preview.buttonLabel}
        previewDisabled={Boolean(preview.disabledReason) || (!preview.ready && !preview.playing)}
        previewPlaying={preview.playing}
        disabledReason={preview.disabledReason}
        onBeatOffsetChange={setBeatOffset}
        onBarCountChange={setBarCount}
        onPreview={preview.playOrStop}
        onTrackDetails={() => activeCandidate && onTrackDetails(activeCandidate)}
        trackDetailsDisabled={!activeCandidate}
      />
    </div>
  );
}

