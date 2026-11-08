import { trackIdentityKey } from '../../lib/preview/trackIdentity';
import type { BeatGridRow, CueRow, PhraseRow } from '../../lib/queries/analysisData';
import { probeSetLabAudio } from './audioProbe';
import { listSetLabSections, sameSetLabWindow, type ResolvedSetLabSection } from './sectionResolver';
import type { SetLabBarCount, SetLabScope, SetLabSection } from './session';
import {
  assertSetLabDecodeDuration, resolveSetLabAudio, type SetLabAudioSource, type SetLabMediaTrack, type SetLabSourceDependencies, type SetLabSourceFailure,
} from './setLabSources';

interface SetLabTrackAnalysis {
  beatGrid: Pick<BeatGridRow, 'track_id' | 'import_id' | 'source_tag' | 'beats'> | null;
  phrases?: readonly PhraseRow[];
  cues?: readonly CueRow[];
}

type SourceSuccess = {
  ok: true;
  source: SetLabAudioSource & { durationMs: number };
  windows: ResolvedSetLabSection[];
};

type CandidateFailure = {
  ok: false;
  reason: 'scope-mismatch' | 'analysis-scope-mismatch' | 'invalid-bar-count' | 'invalid-duration' | 'missing-grid'
    | 'invalid-grid' | 'estimated-grid' | 'no-window' | 'media-unavailable';
  explanation: string;
  attempts?: SetLabSourceFailure[];
};

type MediaDependencies = SetLabSourceDependencies & { probe?: typeof probeSetLabAudio };

/** Pure shortlist preparation. A usable path or preview record alone cannot establish eligibility. */
export function prefilterSetLabTrack(track: SetLabMediaTrack, scope: SetLabScope) {
  if (!scope.userId || !scope.sourceImportId || !track.id || track.import_id !== scope.sourceImportId) {
    return { ok: false, reason: 'scope-mismatch', explanation: 'This track is outside the active Set Lab account or import.' } as const;
  }
  const milliseconds = track.duration_ms ?? 0;
  const seconds = (track.duration_seconds ?? 0) * 1000;
  const durationMs = Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds
    : Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  return { ok: true, trackIdentityKey: trackIdentityKey(track), durationMs } as const;
}

/**
 * Final verification for one shortlisted track. Uses the selected USB/local root
 * and the signed-in account's synced preview. Callers cancel superseded work
 * with their generation request's signal and control shortlist concurrency.
 */
export async function verifySetLabCandidate(
  { scope, track, analysis, barCount, importDeviceName, signal, requiredSection }: {
    scope: SetLabScope;
    track: SetLabMediaTrack;
    analysis: SetLabTrackAnalysis;
    barCount?: SetLabBarCount;
    importDeviceName?: string | null;
    signal?: AbortSignal;
    requiredSection?: SetLabSection;
  },
  { probe = probeSetLabAudio, ...sources }: MediaDependencies,
): Promise<(SourceSuccess & { trackId: string; trackIdentityKey: string }) | CandidateFailure> {
  signal?.throwIfAborted();
  const candidate = prefilterSetLabTrack(track, scope);
  if (candidate.ok === false) return candidate;

  const { beatGrid, phrases, cues } = analysis;
  const matchesTrack = (row: { track_id: string; import_id: string }) =>
    row.track_id === track.id && row.import_id === scope.sourceImportId;
  if ((beatGrid && !matchesTrack(beatGrid)) || phrases?.some((row) => !matchesTrack(row)) || cues?.some((row) => !matchesTrack(row))) {
    return { ok: false, reason: 'analysis-scope-mismatch', explanation: 'Rekordbox analysis did not match this track and import.' };
  }
  const beats = beatGrid?.beats ?? null;
  const timing = { beats, sourceTag: beatGrid?.source_tag, phrases, cues };
  // A complete grid can shortlist a track with missing length metadata. The
  // actual media probe must still establish the playable duration.
  const provisionalDuration = candidate.durationMs ?? (Array.isArray(beats) ? beats.at(-1)?.ms : undefined) ?? 1;
  const provisional = listSetLabSections({ ...timing, durationMs: provisionalDuration }, barCount);
  if (provisional.ok === false) return provisional;
  if (requiredSection && !provisional.windows.some(({ section }) => sameSetLabWindow(section, requiredSection))) {
    return { ok: false, reason: 'no-window', explanation: 'The selected section no longer matches the current Rekordbox beat grid or track duration.' };
  }

  const source = await resolveSetLabAudio({ scope, track, importDeviceName, signal }, sources, async ({ media }) => {
    const durationMs = await probe(media, signal);
    assertSetLabDecodeDuration(durationMs);
    const resolved = candidate.durationMs != null && durationMs >= candidate.durationMs ? provisional
      : listSetLabSections({ ...timing, durationMs: candidate.durationMs ?? durationMs, mediaDurationMs: durationMs }, barCount);
    if (resolved.ok === false) return { ok: false, reason: 'too-short', explanation: resolved.explanation };
    if (requiredSection && !resolved.windows.some(({ section }) => sameSetLabWindow(section, requiredSection))) {
      return { ok: false, reason: 'too-short', explanation: 'The exact selected section is outside this source’s playable range.' };
    }
    return { ok: true, value: { durationMs, windows: resolved.windows } };
  });
  if (source.ok === false) {
    return { ok: false, reason: 'media-unavailable', explanation: 'No authorized source can audition this section.', attempts: source.attempts };
  }
  return {
    ok: true, source: { ...source.source, durationMs: source.value.durationMs }, windows: source.value.windows,
    trackId: track.id, trackIdentityKey: candidate.trackIdentityKey,
  };
}
