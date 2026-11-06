-- Rekordbox XML files a user chooses to keep in DropDex. A user can store as many as they like; each is kept as its own
-- copy and never overwritten. Both the rows and the files belong to one user: rows by user_id, files by the first folder in
-- the object path, which is the user's id.

CREATE TABLE IF NOT EXISTS public.rekordbox_xml_files (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The name the file had on the user's computer, for display. The stored object has its own generated name.
  file_name          text        NOT NULL,
  storage_path       text        NOT NULL,
  size_bytes         bigint      NOT NULL,
  -- Read from the top of the file when it is saved. Null if the file did not say.
  track_count        integer,
  rekordbox_version  text,
  -- When the file was last changed on the user's computer.
  source_modified_at timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rekordbox_xml_files_user_idx ON public.rekordbox_xml_files (user_id, created_at DESC);

ALTER TABLE public.rekordbox_xml_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rekordbox_xml_files: select own" ON public.rekordbox_xml_files;
CREATE POLICY "rekordbox_xml_files: select own" ON public.rekordbox_xml_files FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "rekordbox_xml_files: insert own" ON public.rekordbox_xml_files;
CREATE POLICY "rekordbox_xml_files: insert own" ON public.rekordbox_xml_files FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "rekordbox_xml_files: delete own" ON public.rekordbox_xml_files;
CREATE POLICY "rekordbox_xml_files: delete own" ON public.rekordbox_xml_files FOR DELETE TO authenticated USING (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.rekordbox_xml_files TO authenticated;

-- ── Storage bucket for the files ─────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'rekordbox-xml',
  'rekordbox-xml',
  false,
  1073741824, -- 1 GB. A library of tens of thousands of tracks is tens of MB; the project's own upload limit still applies.
  ARRAY['application/xml', 'text/xml']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "rekordbox-xml: read own files" ON storage.objects;
CREATE POLICY "rekordbox-xml: read own files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'rekordbox-xml' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "rekordbox-xml: upload own files" ON storage.objects;
CREATE POLICY "rekordbox-xml: upload own files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'rekordbox-xml' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "rekordbox-xml: delete own files" ON storage.objects;
CREATE POLICY "rekordbox-xml: delete own files" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'rekordbox-xml' AND (storage.foldername(name))[1] = auth.uid()::text);
