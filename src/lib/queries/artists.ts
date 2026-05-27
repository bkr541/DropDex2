import { supabase } from '../supabase';
import type { SearchArtist } from '../../types';

export async function fetchArtistsByGenres(genreNames: string[]): Promise<SearchArtist[]> {
  const normalized = genreNames.map((g) =>
    g.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(),
  );

  const { data: genreRows, error: gErr } = await supabase
    .from('genres')
    .select('id, name')
    .in('normalized_name', normalized);

  if (gErr) throw new Error(gErr.message);
  if (!genreRows?.length) return [];

  const genreIds = genreRows.map((g) => g.id);
  const genreNameById: Record<string, string> = Object.fromEntries(
    genreRows.map((g) => [g.id, g.name]),
  );

  const { data: junctions, error: jErr } = await supabase
    .from('artist_genres')
    .select('artist_id, genre_id')
    .in('genre_id', genreIds);

  if (jErr) throw new Error(jErr.message);
  if (!junctions?.length) return [];

  const artistGenreMap: Record<string, Set<string>> = {};
  for (const j of junctions) {
    (artistGenreMap[j.artist_id] ??= new Set()).add(genreNameById[j.genre_id]);
  }

  const artistIds = Object.keys(artistGenreMap);

  const { data: artists, error: aErr } = await supabase
    .from('artists')
    .select('id, name, normalized_name, source_artist_url')
    .in('id', artistIds)
    .order('name');

  if (aErr) throw new Error(aErr.message);

  return (artists ?? []).map((a) => ({
    id: String(a.id),
    name: a.name as string,
    normalized_name: (a.normalized_name as string | null) ?? null,
    source_artist_url: (a.source_artist_url as string | null) ?? null,
    genres: [...(artistGenreMap[String(a.id)] ?? [])].sort(),
  }));
}
