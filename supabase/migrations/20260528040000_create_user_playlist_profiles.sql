-- =============================================================================
-- User playlist customisation profiles
--
-- Playlist artwork and display overrides must NOT be stored on
-- rekordbox_playlists rows. Those rows are tied to a specific import snapshot
-- (import_id = one rescan) and are replaced whenever the user re-imports.
-- Storing artwork there means it is lost on every rescan.
--
-- This table decouples user customisation from import snapshots using a stable
-- identity key.
--
-- ── Playlist identity key design ─────────────────────────────────────────────
--
-- rekordbox_playlists.rekordbox_playlist_id holds Rekordbox's own internal
-- numeric identifier for the playlist. Within a single Rekordbox library this
-- ID is stable across rescans — the same playlist always exports with the same
-- ID. It is therefore safe as a long-lived lookup key.
--
-- However, Rekordbox numbers playlists starting at 1 for every installation,
-- so two different devices/libraries will produce colliding IDs. To
-- discriminate across devices we prefix with rekordbox_imports.device_name,
-- which identifies the computer or device that generated the export.
--
-- Identity key format: "<device_name>::<rekordbox_playlist_id>"
--   e.g. "KODY-MBP::42"
--
-- Stable as long as:
--   • The user does not rename their Rekordbox device (edge case; acceptable
--     for v1 — orphaned rows can be cleaned up by the user).
--   • Rekordbox keeps the same playlist ID between exports (guaranteed by
--     Rekordbox's export format for playlists that have not been deleted and
--     recreated).
--
-- See buildPlaylistIdentityKey() in src/lib/queries/userPlaylists.ts for the
-- frontend helper that constructs this key consistently.
--
-- All DROP ... IF EXISTS guards make this migration safely re-runnable.
-- =============================================================================

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
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ── Row-level security ────────────────────────────────────────────────────────

ALTER TABLE public.user_playlist_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_playlist_profiles: select own" ON public.user_playlist_profiles;
DROP POLICY IF EXISTS "user_playlist_profiles: insert own" ON public.user_playlist_profiles;
DROP POLICY IF EXISTS "user_playlist_profiles: update own" ON public.user_playlist_profiles;
DROP POLICY IF EXISTS "user_playlist_profiles: delete own" ON public.user_playlist_profiles;

CREATE POLICY "user_playlist_profiles: select own"
  ON public.user_playlist_profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "user_playlist_profiles: insert own"
  ON public.user_playlist_profiles FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_playlist_profiles: update own"
  ON public.user_playlist_profiles FOR UPDATE TO authenticated
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_playlist_profiles: delete own"
  ON public.user_playlist_profiles FOR DELETE TO authenticated
  USING (user_id = auth.uid());
