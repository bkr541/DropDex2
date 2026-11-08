import { durationMsForTrack } from '../../lib/music/trackTiming';
import { trackIdentityKey } from '../../lib/preview/trackIdentity';
import { fetchTrackBeatGrids } from '../../lib/queries/analysisData';
import { fetchLibraryTracksPage, fetchTracksByIds } from '../../lib/queries/rekordbox';
import type { RekordboxTrack } from '../../types';
import { verifySetLabCandidate } from './mediaEligibility';
import { parseSetLabSession, type SetLabDraft, type SetLabRecordingEvidence, type SetLabSavedSet, type SetLabScope } from './session';
import type { StoredSetLabSession } from './sessionRepository';
import type { SetLabSourceDependencies } from './setLabSources';

const normalized = (value: string | null) => (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function recordingEvidence(track: RekordboxTrack): SetLabRecordingEvidence | undefined {
  const title = normalized(track.title);
  const durationMs = durationMsForTrack(track, null);
  return title && durationMs ? { title, artist: normalized(track.artist), durationMs } : undefined;
}

function recordingMatches(expected: SetLabRecordingEvidence | undefined, actual: RekordboxTrack): boolean {
  const evidence = recordingEvidence(actual);
  return !!(expected && evidence && expected.title === evidence.title && expected.artist === evidence.artist
    && Math.abs(expected.durationMs - evidence.durationMs) <= 1000);
}

/** Attach recording evidence to a named snapshot without mutating the working draft. */
export async function prepareSetLabSnapshot(draft: SetLabDraft, signal: AbortSignal): Promise<SetLabDraft> {
  const tracks = await fetchTracksByIds(draft.slots.map(({ trackId }) => trackId), signal);
  signal.throwIfAborted();
  const byId = new Map(tracks.filter((track) => track.import_id === draft.sourceImportId).map((track) => [track.id, track]));
  const slots = draft.slots.map((slot) => {
    const track = byId.get(slot.trackId);
    const recording = track && trackIdentityKey(track) === slot.trackIdentityKey ? recordingEvidence(track) : undefined;
    return recording ? { ...slot, recording } : slot;
  });
  const snapshot = parseSetLabSession({ ...draft, slots }, draft);
  if (snapshot.status !== 'draft') throw new Error('Could not prepare the named Set Lab snapshot.');
  return snapshot;
}

/** Read one page at a time and retain at most two rows per requested identity. */
async function findActiveMatches(scope: SetLabScope, identities: ReadonlySet<string>, signal: AbortSignal) {
  const matches = new Map<string, RekordboxTrack[]>();
  let offset = 0;
  while (identities.size > 0) {
    const page = await fetchLibraryTracksPage(scope.sourceImportId, offset, 200, {}, signal);
    signal.throwIfAborted();
    if (page.offset !== offset || page.items.some((track) => track.import_id !== scope.sourceImportId)) {
      throw new Error('The active library changed while checking saved tracks. Try Load again.');
    }
    for (const track of page.items) {
      const identity = trackIdentityKey(track);
      if (!identities.has(identity)) continue;
      const candidates = matches.get(identity) ?? [];
      if (candidates.length < 2 && !candidates.some(({ id }) => id === track.id)) candidates.push(track);
      matches.set(identity, candidates);
    }
    if (!page.hasMore) break;
    if (!page.items.length) throw new Error('The active library returned an incomplete track page. Try Load again.');
    offset += page.items.length;
  }
  return matches;
}

/** Resolve every slot and verify its saved range before replacing the working draft. */
export async function restoreSetLabSavedSet(
  { saved, scope, importDeviceName, signal }: {
    saved: StoredSetLabSession<SetLabSavedSet>;
    scope: SetLabScope;
    importDeviceName: string | null;
    signal: AbortSignal;
  },
  sources: SetLabSourceDependencies,
): Promise<SetLabDraft> {
  const snapshot = saved.session;
  signal.throwIfAborted();
  if (snapshot.userId !== scope.userId) throw new Error('This saved set belongs to a different account.');
  const sameImport = snapshot.sourceImportId === scope.sourceImportId;
  const originals = await fetchTracksByIds(snapshot.slots
    .filter((slot) => sameImport || (!slot.recording && slot.trackIdentityKey.startsWith('c:')))
    .map(({ trackId }) => trackId), signal);
  signal.throwIfAborted();
  const byId = new Map(originals.filter((track) => track.import_id === snapshot.sourceImportId).map((track) => [track.id, track]));
  const exact = (slot: SetLabSavedSet['slots'][number]) => {
    const track = byId.get(slot.trackId);
    return track && trackIdentityKey(track) === slot.trackIdentityKey ? track : undefined;
  };
  const lookup = new Set(snapshot.slots.filter((slot) => !sameImport || !exact(slot)).map(({ trackIdentityKey }) => trackIdentityKey));
  const matches = await findActiveMatches(scope, lookup, signal);
  const issues: string[] = [];
  const resolved = snapshot.slots.flatMap((slot) => {
    const old = exact(slot);
    const candidates = sameImport && old ? [old] : matches.get(slot.trackIdentityKey) ?? [];
    const title = slot.selection?.title ?? slot.recording?.title ?? old?.title;
    const label = `Slot ${slot.position}${title ? ` (${title})` : ''}`;
    if (candidates.length !== 1) {
      issues.push(`${label} — ${candidates.length ? 'multiple tracks share its Rekordbox identity' : 'track missing from the active import'}.`);
      return [];
    }
    const [track] = candidates;
    if ((!sameImport || !old) && slot.trackIdentityKey.startsWith('c:')
      && !recordingMatches(slot.recording ?? (old && recordingEvidence(old)), track)) {
      issues.push(`${label} — this content ID could not be verified against the original recording.`);
      return [];
    }
    return [{ slot, track, label }];
  });
  if (issues.length) throw new Error(`${issues.join(' ')} Select the matching Rekordbox import and try again.`);

  const grids = await fetchTrackBeatGrids(resolved.map(({ track }) => track.id), signal);
  signal.throwIfAborted();
  // Probe the five selected sources sequentially. Loading a working copy never
  // decodes five whole tracks. Play performs its own bounded decode preflight.
  for (const { slot, track, label } of resolved) {
    const result = await verifySetLabCandidate({
      scope, track, importDeviceName, signal, barCount: slot.barCount,
      analysis: { beatGrid: grids.get(track.id) ?? null }, requiredSection: slot.section,
    }, sources);
    signal.throwIfAborted();
    if (result.ok === false) {
      issues.push([label + ' — ' + result.explanation, ...(result.attempts ?? []).map(({ source, explanation }) =>
        `${source === 'local' ? 'Local' : 'Cloud'}: ${explanation}`)].join(' '));
    }
  }
  if (issues.length) throw new Error(`${issues.join(' ')} Reconnect the source or select the matching import, then try again.`);

  const draft = parseSetLabSession({
    ...snapshot, ...scope, status: 'draft', loadedFrom: { id: saved.id, name: snapshot.name },
    slots: resolved.map(({ slot, track }) => ({ ...slot, trackId: track.id })),
  }, scope);
  if (draft.status !== 'draft') throw new Error('Could not create a Set Lab working copy.');
  return draft;
}
