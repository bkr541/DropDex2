import type { RekordboxTrack } from '../../types';
import type { RouletteCandidateAnalysis } from '../../features/roulette/rouletteMatching';
import { fetchTrackBeatGridsLightweight, fetchTrackPhraseCounts } from '../../lib/queries/analysisData';
import { supabase } from '../../lib/supabase';

const TRACK_PAGE_SIZE = 500;

// Candidate browsing intentionally excludes heavy JSON/analysis columns. These
// are the fields used by matching, source resolution and the candidate UI.
const FLIP_LAB_CANDIDATE_TRACK_COLUMNS = [
  'id',
  'import_id',
  'rekordbox_content_id',
  'title',
  'artist',
  'genre',
  'label',
  'camelot_key',
  'key_tonic',
  'key_mode',
  'bpm',
  'duration_seconds',
  'duration_ms',
  'file_path',
  'file_path_normalized',
  'file_path_volume',
  'file_name',
  'file_format',
  'file_extension',
  'file_size_bytes',
  'sample_rate_hz',
].join(', ');

export interface FlipLabCandidatePools {
  vocals: RouletteCandidateAnalysis[];
  instrumentals: RouletteCandidateAnalysis[];
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
}

async function fetchImportTracks(importId: string, signal?: AbortSignal): Promise<RekordboxTrack[]> {
  const tracks: RekordboxTrack[] = [];
  for (let offset = 0; ; offset += TRACK_PAGE_SIZE) {
    throwIfAborted(signal);
    let query = supabase
      .from('rekordbox_tracks')
      .select(FLIP_LAB_CANDIDATE_TRACK_COLUMNS)
      .eq('import_id', importId)
      .order('id', { ascending: true });
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query.range(offset, offset + TRACK_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as RekordboxTrack[];
    tracks.push(...rows);
    if (rows.length < TRACK_PAGE_SIZE) break;
  }
  throwIfAborted(signal);
  return tracks;
}

/** Every track in the library is available on both sides. */
export async function fetchFlipLabCandidatePools(
  importId: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<FlipLabCandidatePools> {
  const tracks = await fetchImportTracks(importId, signal);
  if (tracks.length === 0) return { vocals: [], instrumentals: [] };

  const trackIds = tracks.map((track) => track.id);
  const [beatGrids, phraseCounts] = await Promise.all([
    fetchTrackBeatGridsLightweight(trackIds, signal),
    fetchTrackPhraseCounts(trackIds, signal),
  ]);
  throwIfAborted(signal);

  const candidates = tracks.map((track) => ({
    track,
    beatGrid: beatGrids.get(track.id) ?? null,
    phraseCount: phraseCounts.get(track.id) ?? 0,
  }));
  return { vocals: candidates, instrumentals: candidates };
}
