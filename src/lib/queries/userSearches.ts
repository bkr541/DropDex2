import { supabase } from '../supabase';
import type { UserSearch, UserSearchResultType } from '../../types';

export async function fetchRecentSearches(
  userId: string,
  limit = 20,
): Promise<UserSearch[]> {
  const { data, error } = await supabase
    .from('user_searches')
    .select('*')
    .eq('user_id', userId)
    .order('last_searched_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as UserSearch[];
}

/**
 * Record a search via the record_user_search RPC.
 * The RPC resolves the caller from auth.uid() server-side — no userId param
 * needed and no risk of caller spoofing.
 * Deduplicates by normalised query and increments search_count on repeat.
 */
export async function recordSearch(
  query: string,
  resultType?: UserSearchResultType,
  resultId?: string,
): Promise<UserSearch> {
  const { data, error } = await supabase.rpc('record_user_search', {
    p_query: query,
    p_result_type: resultType ?? null,
    p_result_id: resultId ?? null,
  });

  if (error) throw error;
  return data as UserSearch;
}

export async function deleteSearch(id: string): Promise<void> {
  const { error } = await supabase.from('user_searches').delete().eq('id', id);
  if (error) throw error;
}
