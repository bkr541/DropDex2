-- Cloud streaming previews: a 160 kbps AAC copy of each track a user chooses to sync, so the track can be played
-- (and auditioned) without the USB. Originals are never uploaded or changed.
--
-- Each user may only read and write their own previews and files: rows by user_id, files by the first folder
-- in the object path, which is the user's id.

CREATE TABLE IF NOT EXISTS public.track_previews (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The track's identity across imports (master ids first, then content id, then path + title + artist + length).
  identity_key      text        NOT NULL,
  -- The row for this track in the most recent import, so the player can find the preview. Cleared if that import is deleted.
  track_id          uuid        REFERENCES public.rekordbox_tracks(id) ON DELETE SET NULL,
  storage_path      text        NOT NULL,
  container         text        NOT NULL DEFAULT 'm4a',
  codec             text        NOT NULL DEFAULT 'aac',
  bitrate_kbps      integer     NOT NULL DEFAULT 160,
  sample_rate       integer,
  channels          integer,
  duration_ms       integer,
  size_bytes        bigint,
  -- What the original file looked like when the preview was made, so a re-sync can skip tracks that have not changed.
  source_size_bytes bigint,
  source_mtime      timestamptz,
  status            text        NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'failed')),
  error             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, identity_key)
);

CREATE INDEX IF NOT EXISTS track_previews_track_idx ON public.track_previews (track_id) WHERE track_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_track_previews_updated_at ON public.track_previews;
CREATE TRIGGER trg_track_previews_updated_at
  BEFORE UPDATE ON public.track_previews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.track_previews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "track_previews: select own" ON public.track_previews;
CREATE POLICY "track_previews: select own" ON public.track_previews FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "track_previews: insert own" ON public.track_previews;
CREATE POLICY "track_previews: insert own" ON public.track_previews FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "track_previews: update own" ON public.track_previews;
CREATE POLICY "track_previews: update own" ON public.track_previews FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "track_previews: delete own" ON public.track_previews;
CREATE POLICY "track_previews: delete own" ON public.track_previews FOR DELETE TO authenticated USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.track_previews TO authenticated;

-- ── Storage bucket for the preview files ─────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'track-previews',
  'track-previews',
  false,
  52428800, -- 50 MB per preview; a 160 kbps preview is about 1.2 MB a minute
  ARRAY['audio/mp4', 'audio/x-m4a', 'audio/aac']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "track-previews: read own files" ON storage.objects;
CREATE POLICY "track-previews: read own files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'track-previews' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "track-previews: upload own files" ON storage.objects;
CREATE POLICY "track-previews: upload own files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'track-previews' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "track-previews: replace own files" ON storage.objects;
CREATE POLICY "track-previews: replace own files" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'track-previews' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'track-previews' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "track-previews: delete own files" ON storage.objects;
CREATE POLICY "track-previews: delete own files" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'track-previews' AND (storage.foldername(name))[1] = auth.uid()::text);
