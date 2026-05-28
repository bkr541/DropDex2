-- =============================================================================
-- User artist and genre preference tables
--
-- user_artists: up to 10 artists the user considers similar to them or
--   representative of their taste. References the shared public.artists catalog.
--
-- user_genres:  up to 5 genres the user selects. References public.genres.
--
-- All DROP ... IF EXISTS guards make this migration safely re-runnable.
-- =============================================================================

-- ── user_artists ──────────────────────────────────────────────────────────────

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
  ON public.user_artists FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "user_artists: insert own"
  ON public.user_artists FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_artists: update own"
  ON public.user_artists FOR UPDATE TO authenticated
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_artists: delete own"
  ON public.user_artists FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ── user_genres ───────────────────────────────────────────────────────────────

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
  ON public.user_genres FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "user_genres: insert own"
  ON public.user_genres FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_genres: update own"
  ON public.user_genres FOR UPDATE TO authenticated
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_genres: delete own"
  ON public.user_genres FOR DELETE TO authenticated
  USING (user_id = auth.uid());
