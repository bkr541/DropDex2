import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY
) as string | undefined;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    '[DropDex] Supabase is not configured.\n' +
    'Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to your .env file.\n' +
    'See .env.example for reference.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey);
