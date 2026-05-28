-- =============================================================================
-- Create user profiles table
-- Stores each authenticated DropDex user's own profile data.
--
-- IMPORTANT: public.artists catalogs DJ artists discovered/scraped
-- (e.g. ILLENIUM, Subtronics). The authenticated app user is NOT stored there.
-- This table is the canonical identity record for DropDex app users.
--
-- set_updated_at() already exists — created in migration
-- 20260527010000_create_genres_and_artist_genres.sql. No duplicate here.
--
-- All DROP ... IF EXISTS guards make this migration safely re-runnable.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  user_id        uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name   text        NOT NULL DEFAULT '',
  username       text,
  bio            text,
  avatar_url     text,
  spotify_url    text,
  soundcloud_url text,
  instagram_url  text,
  youtube_url    text,
  website_url    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ── Row-level security ────────────────────────────────────────────────────────

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles: select own row" ON public.profiles;
DROP POLICY IF EXISTS "profiles: insert own row" ON public.profiles;
DROP POLICY IF EXISTS "profiles: update own row" ON public.profiles;

CREATE POLICY "profiles: select own row"
  ON public.profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "profiles: insert own row"
  ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "profiles: update own row"
  ON public.profiles
  FOR UPDATE TO authenticated
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
