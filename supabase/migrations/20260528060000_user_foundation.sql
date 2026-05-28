-- =============================================================================
-- User foundation — profiles, artist/genre preferences, searches,
-- playlist customisation, and storage buckets.
--
-- All statements are idempotent (DROP … IF EXISTS before every CREATE POLICY /
-- CREATE TRIGGER; CREATE TABLE / INDEX use IF NOT EXISTS; CREATE OR REPLACE
-- for functions; bucket INSERT uses ON CONFLICT DO NOTHING).
-- Safe to run multiple times or after a partial failure.
--
-- Depends on: public.set_updated_at() from 20260527010000,
--             public.artists, public.genres from 20260527000000 / 010000.
-- =============================================================================

-- ── 1. profiles ───────────────────────────────────────────────────────────────
-- Authenticated DropDex user identity record.
-- NOT the same as public.artists (which catalogs scraped DJ artists).

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
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles: select own row" ON public.profiles;
DROP POLICY IF EXISTS "profiles: insert own row" ON public.profiles;
DROP POLICY IF EXISTS "profiles: update own row" ON public.profiles;

CREATE POLICY "profiles: select own row"
  ON public.profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "profiles: insert own row"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "profiles: update own row"
  ON public.profiles FOR UPDATE TO authenticated
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── 2. user_artists ───────────────────────────────────────────────────────────
-- Up to 10 artists per user (positions 1–10), linked to public.artists catalog.

CREATE TABLE IF NOT EXISTS public.user_artists (
  user_id    uuid    NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  artist_id  uuid    NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
  position   integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, artist_id),
  UNIQUE (user_id, position),
  CHECK (position BETWEEN 1 AND 10)
);

ALTER TABLE public.user_artists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_artists: select own" ON public.user_artists;
DROP POLICY IF EXISTS "user_artists: insert own" ON public.user_artists;
DROP POLICY IF EXISTS "user_artists: update own" ON public.user_artists;
DROP POLICY IF EXISTS "user_artists: delete own" ON public.user_artists;

CREATE POLICY "user_artists: select own"
  ON public.user_artists FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "user_artists: insert own"
  ON public.user_artists FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_artists: update own"
  ON public.user_artists FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_artists: delete own"
  ON public.user_artists FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ── 3. user_genres ────────────────────────────────────────────────────────────
-- Up to 5 genres per user (positions 1–5), linked to public.genres catalog.

CREATE TABLE IF NOT EXISTS public.user_genres (
  user_id    uuid    NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  genre_id   uuid    NOT NULL REFERENCES public.genres(id) ON DELETE CASCADE,
  position   integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, genre_id),
  UNIQUE (user_id, position),
  CHECK (position BETWEEN 1 AND 5)
);

ALTER TABLE public.user_genres ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_genres: select own" ON public.user_genres;
DROP POLICY IF EXISTS "user_genres: insert own" ON public.user_genres;
DROP POLICY IF EXISTS "user_genres: update own" ON public.user_genres;
DROP POLICY IF EXISTS "user_genres: delete own" ON public.user_genres;

CREATE POLICY "user_genres: select own"
  ON public.user_genres FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "user_genres: insert own"
  ON public.user_genres FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_genres: update own"
  ON public.user_genres FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_genres: delete own"
  ON public.user_genres FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ── 4. user_searches + record_user_search RPC ─────────────────────────────────
-- Stores recent Discovery searches; deduplicates on normalised query text.

CREATE TABLE IF NOT EXISTS public.user_searches (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  query_text       text        NOT NULL,
  normalized_query text        NOT NULL,
  result_type      text,
  result_id        uuid,
  search_count     integer     NOT NULL DEFAULT 1,
  last_searched_at timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (result_type IS NULL OR result_type IN ('artist', 'genre', 'setlist'))
);

CREATE UNIQUE INDEX IF NOT EXISTS user_searches_user_normalized_uniq
  ON public.user_searches (user_id, normalized_query);

CREATE INDEX IF NOT EXISTS user_searches_user_recent
  ON public.user_searches (user_id, last_searched_at DESC);

ALTER TABLE public.user_searches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_searches: select own" ON public.user_searches;
DROP POLICY IF EXISTS "user_searches: insert own" ON public.user_searches;
DROP POLICY IF EXISTS "user_searches: update own" ON public.user_searches;
DROP POLICY IF EXISTS "user_searches: delete own" ON public.user_searches;

CREATE POLICY "user_searches: select own"
  ON public.user_searches FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "user_searches: insert own"
  ON public.user_searches FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_searches: update own"
  ON public.user_searches FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_searches: delete own"
  ON public.user_searches FOR DELETE TO authenticated USING (user_id = auth.uid());

-- RPC resolves caller via auth.uid() — no user_id param, prevents spoofing.
CREATE OR REPLACE FUNCTION public.record_user_search(
  p_query       text,
  p_result_type text DEFAULT NULL,
  p_result_id   uuid DEFAULT NULL
)
RETURNS public.user_searches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    uuid;
  v_normalized text;
  v_result     public.user_searches;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'record_user_search: caller is not authenticated';
  END IF;

  v_normalized := trim(regexp_replace(lower(p_query), '\s+', ' ', 'g'));

  IF length(v_normalized) = 0 THEN
    RAISE EXCEPTION 'record_user_search: query must not be blank after normalisation';
  END IF;

  INSERT INTO public.user_searches (
    user_id, query_text, normalized_query, result_type, result_id
  )
  VALUES (v_user_id, p_query, v_normalized, p_result_type, p_result_id)
  ON CONFLICT (user_id, normalized_query)
  DO UPDATE SET
    query_text       = EXCLUDED.query_text,
    result_type      = COALESCE(EXCLUDED.result_type, user_searches.result_type),
    result_id        = COALESCE(EXCLUDED.result_id,   user_searches.result_id),
    search_count     = user_searches.search_count + 1,
    last_searched_at = now()
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_user_search(text, text, uuid) TO authenticated;

-- ── 5. user_playlist_profiles ─────────────────────────────────────────────────
-- Stores user artwork/display overrides for playlists, decoupled from
-- rekordbox_playlists rows which are replaced on every rescan.
--
-- Identity key: "<device_name>::<rekordbox_playlist_id>"
-- rekordbox_playlist_id is stable within a Rekordbox library across rescans.
-- device_name discriminates across different installations.
-- See buildPlaylistIdentityKey() in src/lib/queries/userPlaylists.ts.

CREATE TABLE IF NOT EXISTS public.user_playlist_profiles (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  playlist_identity_key text NOT NULL,
  display_name          text,
  description           text,
  artwork_url           text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, playlist_identity_key)
);

DROP TRIGGER IF EXISTS trg_user_playlist_profiles_updated_at ON public.user_playlist_profiles;
CREATE TRIGGER trg_user_playlist_profiles_updated_at
  BEFORE UPDATE ON public.user_playlist_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.user_playlist_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_playlist_profiles: select own" ON public.user_playlist_profiles;
DROP POLICY IF EXISTS "user_playlist_profiles: insert own" ON public.user_playlist_profiles;
DROP POLICY IF EXISTS "user_playlist_profiles: update own" ON public.user_playlist_profiles;
DROP POLICY IF EXISTS "user_playlist_profiles: delete own" ON public.user_playlist_profiles;

CREATE POLICY "user_playlist_profiles: select own"
  ON public.user_playlist_profiles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "user_playlist_profiles: insert own"
  ON public.user_playlist_profiles FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_playlist_profiles: update own"
  ON public.user_playlist_profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_playlist_profiles: delete own"
  ON public.user_playlist_profiles FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ── 6. Storage buckets ────────────────────────────────────────────────────────
-- Both buckets are private (authenticated read, own-folder write only).
-- Path conventions:
--   avatars/         {user_id}/profile-image.<ext>   (5 MB limit)
--   playlist-artwork/{user_id}/{identity_key}.<ext>  (10 MB limit)

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'avatars',
    'avatars',
    false,
    5242880,
    ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
  ),
  (
    'playlist-artwork',
    'playlist-artwork',
    false,
    10485760,
    ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
  )
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "avatars: authenticated users upload own files"  ON storage.objects;
DROP POLICY IF EXISTS "avatars: authenticated users update own files"  ON storage.objects;
DROP POLICY IF EXISTS "avatars: authenticated users delete own files"  ON storage.objects;
DROP POLICY IF EXISTS "avatars: authenticated users read own files"    ON storage.objects;

CREATE POLICY "avatars: authenticated users upload own files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "avatars: authenticated users update own files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "avatars: authenticated users delete own files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "avatars: authenticated users read own files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "playlist-artwork: authenticated users upload own files"  ON storage.objects;
DROP POLICY IF EXISTS "playlist-artwork: authenticated users update own files"  ON storage.objects;
DROP POLICY IF EXISTS "playlist-artwork: authenticated users delete own files"  ON storage.objects;
DROP POLICY IF EXISTS "playlist-artwork: authenticated users read own files"    ON storage.objects;

CREATE POLICY "playlist-artwork: authenticated users upload own files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'playlist-artwork' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "playlist-artwork: authenticated users update own files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'playlist-artwork' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "playlist-artwork: authenticated users delete own files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'playlist-artwork' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "playlist-artwork: authenticated users read own files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'playlist-artwork' AND (storage.foldername(name))[1] = auth.uid()::text);
