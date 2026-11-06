-- Which dashboard groups a user has chosen to hide. Kept in its own table, apart from the theme in user_preferences, so changing
-- one never touches the other. The browser keeps a local copy for instant startup; this table is the source of truth across devices.
--
-- Groups are stored by name as a list of the hidden ones, so a group added later is shown by default.

CREATE TABLE IF NOT EXISTS public.user_dashboard_preferences (
  user_id                uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Groups hidden on the Library overview page, e.g. {topGenres, keyProfile}.
  library_overview_hidden text[]     NOT NULL DEFAULT '{}',
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_user_dashboard_preferences_updated_at ON public.user_dashboard_preferences;
CREATE TRIGGER trg_user_dashboard_preferences_updated_at
  BEFORE UPDATE ON public.user_dashboard_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.user_dashboard_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_dashboard_preferences: select own row" ON public.user_dashboard_preferences;
CREATE POLICY "user_dashboard_preferences: select own row" ON public.user_dashboard_preferences FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "user_dashboard_preferences: insert own row" ON public.user_dashboard_preferences;
CREATE POLICY "user_dashboard_preferences: insert own row" ON public.user_dashboard_preferences FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "user_dashboard_preferences: update own row" ON public.user_dashboard_preferences;
CREATE POLICY "user_dashboard_preferences: update own row" ON public.user_dashboard_preferences FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON public.user_dashboard_preferences TO authenticated;
