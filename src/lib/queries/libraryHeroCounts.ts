import { supabase } from '../supabase';

/** How many cue points the import has, counted in the database without loading them. */
export async function fetchLibraryCueCount(importId: string): Promise<number> {
  const { count, error } = await supabase.from('rekordbox_cues').select('id', { count: 'exact', head: true }).eq('import_id', importId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}
