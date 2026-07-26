-- =============================================================================
-- DropDex user appearance preferences
--
-- Keeps private application preferences separate from public-facing profile
-- identity and from Rekordbox import runtime settings. The browser retains a
-- local cache for instant startup, while this table is the authenticated
-- account-level source of truth across devices.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id          uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  appearance_theme text        NOT NULL DEFAULT 'dark'
    CHECK (appearance_theme IN ('dark', 'light', 'cdj')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_user_preferences_updated_at ON public.user_preferences;
CREATE TRIGGER trg_user_preferences_updated_at
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ── Row-level security ────────────────────────────────────────────────────────

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_preferences: select own row" ON public.user_preferences;
DROP POLICY IF EXISTS "user_preferences: insert own row" ON public.user_preferences;
DROP POLICY IF EXISTS "user_preferences: update own row" ON public.user_preferences;

CREATE POLICY "user_preferences: select own row"
  ON public.user_preferences
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "user_preferences: insert own row"
  ON public.user_preferences
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_preferences: update own row"
  ON public.user_preferences
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
