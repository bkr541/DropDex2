-- =============================================================================
-- Supabase Storage bucket setup — avatars + playlist-artwork
--
-- Read access: authenticated users only (own folder).
-- The app does not yet expose public user imagery, so keeping both buckets
-- private avoids leaking avatar/artwork to unauthenticated requests.
-- Revisit if a future public profile page is added.
--
-- File path conventions (enforced by RLS; not by DB constraints):
--   avatars/         {user_id}/profile-image.<ext>
--   playlist-artwork/{user_id}/{playlist_identity_key}.<ext>
--
-- (storage.foldername(name))[1] extracts the first path segment, which must
-- equal the authenticated user's UUID. This prevents users from writing or
-- reading each other's files.
--
-- PostgreSQL has no CREATE POLICY IF NOT EXISTS syntax, so each policy is
-- dropped first to make this migration safely re-runnable.
-- =============================================================================

-- ── Bucket definitions ────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'avatars',
    'avatars',
    false,
    5242880,   -- 5 MB cap per avatar file
    ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
  ),
  (
    'playlist-artwork',
    'playlist-artwork',
    false,
    10485760,  -- 10 MB cap per artwork file
    ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
  )
ON CONFLICT (id) DO NOTHING;

-- ── avatars policies ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "avatars: authenticated users upload own files"  ON storage.objects;
DROP POLICY IF EXISTS "avatars: authenticated users update own files"  ON storage.objects;
DROP POLICY IF EXISTS "avatars: authenticated users delete own files"  ON storage.objects;
DROP POLICY IF EXISTS "avatars: authenticated users read own files"    ON storage.objects;

CREATE POLICY "avatars: authenticated users upload own files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars: authenticated users update own files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars: authenticated users delete own files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars: authenticated users read own files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── playlist-artwork policies ─────────────────────────────────────────────────

DROP POLICY IF EXISTS "playlist-artwork: authenticated users upload own files"  ON storage.objects;
DROP POLICY IF EXISTS "playlist-artwork: authenticated users update own files"  ON storage.objects;
DROP POLICY IF EXISTS "playlist-artwork: authenticated users delete own files"  ON storage.objects;
DROP POLICY IF EXISTS "playlist-artwork: authenticated users read own files"    ON storage.objects;

CREATE POLICY "playlist-artwork: authenticated users upload own files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'playlist-artwork'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "playlist-artwork: authenticated users update own files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'playlist-artwork'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "playlist-artwork: authenticated users delete own files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'playlist-artwork'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "playlist-artwork: authenticated users read own files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'playlist-artwork'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
