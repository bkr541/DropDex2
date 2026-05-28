import { supabase } from '../supabase';
import type { UserProfile } from '../../types';

export async function fetchUserProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data as UserProfile | null;
}

export async function upsertUserProfile(
  userId: string,
  updates: Partial<Omit<UserProfile, 'user_id' | 'created_at' | 'updated_at'>>,
): Promise<UserProfile> {
  const { data, error } = await supabase
    .from('profiles')
    .upsert({ user_id: userId, ...updates }, { onConflict: 'user_id' })
    .select()
    .single();

  if (error) throw error;
  return data as UserProfile;
}
