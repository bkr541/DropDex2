-- =============================================================================
-- User recent searches table + deduplicating RPC
--
-- user_searches stores recent Artist Discovery queries per user.
-- A unique index on (user_id, normalized_query) drives the ON CONFLICT upsert
-- so the same logical search increments search_count rather than creating
-- duplicate rows.
--
-- record_user_search() is a SECURITY DEFINER RPC that:
--   1. Resolves the caller via auth.uid() — no user_id parameter, preventing
--      caller-supplied spoofing.
--   2. Normalises whitespace and casing for deduplication.
--   3. Inserts a new row or increments search_count + updates last_searched_at.
--
-- All DROP ... IF EXISTS guards make this migration safely re-runnable.
-- =============================================================================

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

-- ── Row-level security ────────────────────────────────────────────────────────

ALTER TABLE public.user_searches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_searches: select own" ON public.user_searches;
DROP POLICY IF EXISTS "user_searches: insert own" ON public.user_searches;
DROP POLICY IF EXISTS "user_searches: update own" ON public.user_searches;
DROP POLICY IF EXISTS "user_searches: delete own" ON public.user_searches;

CREATE POLICY "user_searches: select own"
  ON public.user_searches FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "user_searches: insert own"
  ON public.user_searches FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_searches: update own"
  ON public.user_searches FOR UPDATE TO authenticated
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_searches: delete own"
  ON public.user_searches FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ── RPC: record_user_search ───────────────────────────────────────────────────

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

  -- Normalise: lowercase, collapse internal whitespace, trim edges.
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
    -- Prefer the incoming result_type/result_id if provided; keep old values if not.
    result_type      = COALESCE(EXCLUDED.result_type, user_searches.result_type),
    result_id        = COALESCE(EXCLUDED.result_id,   user_searches.result_id),
    search_count     = user_searches.search_count + 1,
    last_searched_at = now()
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_user_search(text, text, uuid) TO authenticated;
