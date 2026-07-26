import { supabase } from '../supabase';
import { isThemeId, type ThemeId } from '../../theme/theme';

export async function fetchUserAppearanceTheme(userId: string): Promise<ThemeId | null> {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('appearance_theme')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return isThemeId(data?.appearance_theme) ? data.appearance_theme : null;
}

export async function saveUserAppearanceTheme(
  userId: string,
  appearanceTheme: ThemeId,
): Promise<void> {
  const { error } = await supabase
    .from('user_preferences')
    .upsert(
      {
        user_id: userId,
        appearance_theme: appearanceTheme,
      },
      { onConflict: 'user_id' },
    );

  if (error) throw error;
}
