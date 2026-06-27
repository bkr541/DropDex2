import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchTrackBeatGrids,
  fetchTracksCues,
  fetchTracksPhrases,
  fetchTrackPreviewWaveforms,
  type BeatGridRow,
  type CueRow,
  type PhraseRow,
  type WaveformLoadState,
} from '../lib/queries/analysisData';
import { resolveDropPoints, type DropPoint } from '../lib/music/dropPointResolver';
import { resolveTrackDurationMs } from '../lib/music/dropLabSegments';
import type { RekordboxTrack } from '../types';

export interface DropLabTrackAnalysis {
  trackId: string;
  beatGrid: BeatGridRow | null;
  cues: CueRow[];
  phrases: PhraseRow[];
  waveformState: WaveformLoadState;
  durationMs: number | null;
  durationSource: 'track' | 'beat-grid' | 'none';
  dropPoints: DropPoint[];
}

export interface DropLabAnalysisState {
  byTrackId: Map<string, DropLabTrackAnalysis>;
  loading: boolean;
  error: string | null;
}

export function chooseBestDrop(dropPoints: DropPoint[]): DropPoint | null {
  return dropPoints[0] ?? null;
}

export function hasUsableDropLabAnalysis(analysis: DropLabTrackAnalysis | undefined): boolean {
  return Boolean(analysis?.waveformState.status === 'loaded' && chooseBestDrop(analysis.dropPoints));
}

export function useDropLabAnalysis(sourceTrack: RekordboxTrack | null, candidateTracks: RekordboxTrack[]) {
  const [state, setState] = useState<DropLabAnalysisState>({
    byTrackId: new Map(),
    loading: false,
    error: null,
  });
  const requestIdRef = useRef(0);
  const [waveformRetryTrigger, setWaveformRetryTrigger] = useState(0);

  const tracksById = useMemo(() => {
    const map = new Map<string, RekordboxTrack>();
    if (sourceTrack) map.set(sourceTrack.id, sourceTrack);
    for (const track of candidateTracks) map.set(track.id, track);
    return map;
  }, [sourceTrack, candidateTracks]);

  const idsKey = useMemo(() => [...tracksById.keys()].sort().join(','), [tracksById]);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const trackIds = [...tracksById.keys()];
    if (!sourceTrack || trackIds.length === 0) {
      setState({ byTrackId: new Map(), loading: false, error: null });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    (async () => {
      const [waveformResult, beatGrids, cues, phrases] = await Promise.all([
        fetchTrackPreviewWaveforms(trackIds),
        fetchTrackBeatGrids(trackIds),
        fetchTracksCues(trackIds),
        fetchTracksPhrases(trackIds),
      ]);

      const byTrackId = new Map<string, DropLabTrackAnalysis>();
      for (const trackId of trackIds) {
        const track = tracksById.get(trackId);
        if (!track) continue;
        const beatGrid = beatGrids.get(trackId) ?? null;
        const trackCues = cues.get(trackId) ?? [];
        const trackPhrases = phrases.get(trackId) ?? [];
        const waveformState = waveformResult.states.get(trackId) ?? {
          status: 'error' as const,
          trackId,
          error: 'Waveform request completed without a track-scoped result.',
          retryable: true as const,
        };
        const timing = resolveTrackDurationMs(track, beatGrid?.beats ?? []);
        const dropPoints = resolveDropPoints({
          cues: trackCues,
          phrases: trackPhrases,
          beats: beatGrid?.beats ?? [],
          durationMs: timing.durationMs,
        });

        byTrackId.set(trackId, {
          trackId,
          beatGrid,
          cues: trackCues,
          phrases: trackPhrases,
          waveformState,
          durationMs: timing.durationMs,
          durationSource: timing.usedDurationSource,
          dropPoints,
        });
      }
      return byTrackId;
    })()
      .then((byTrackId) => {
        if (requestId !== requestIdRef.current) return;
        setState({ byTrackId, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (requestId !== requestIdRef.current) return;
        setState({ byTrackId: new Map(), loading: false, error: err instanceof Error ? err.message : 'Could not load Drop Lab analysis.' });
      });
  }, [sourceTrack, idsKey, tracksById, waveformRetryTrigger]);

  const retryWaveform = useCallback((_trackId?: string) => {
    setWaveformRetryTrigger((value) => value + 1);
  }, []);

  return { ...state, retryWaveform };
}

