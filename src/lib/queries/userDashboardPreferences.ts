import { supabase } from '../supabase';
import { parseHiddenWidgets, serializeHiddenWidgets, type LibraryOverviewWidgetId } from '../dashboard/libraryOverviewWidgets';

/** The groups the user has hidden on the Library overview, or null if they have never changed anything. */
export async function fetchHiddenLibraryWidgets(userId: string): Promise<ReadonlySet<LibraryOverviewWidgetId> | null> {
  const { data, error } = await supabase
    .from('user_dashboard_preferences')
    .select('library_overview_hidden')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? parseHiddenWidgets((data as { library_overview_hidden: unknown }).library_overview_hidden) : null;
}

export async function saveHiddenLibraryWidgets(userId: string, hidden: ReadonlySet<LibraryOverviewWidgetId>): Promise<void> {
  const { error } = await supabase
    .from('user_dashboard_preferences')
    .upsert({ user_id: userId, library_overview_hidden: serializeHiddenWidgets(hidden) }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
}
