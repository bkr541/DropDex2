-- USB Management: the USBs a DJ plays from, and a history of the transfers made between them.
-- Both tables belong to one user; row level security limits every read and write to the signed-in user.

CREATE TABLE IF NOT EXISTS public.user_usb_devices (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Stable identity for the drive: its volume UUID when the system gives one, otherwise name + size.
  device_key    text        NOT NULL,
  label         text        NOT NULL,
  nickname      text,
  brand         text,
  model         text,
  filesystem    text,
  total_bytes   bigint,
  free_bytes    bigint,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  -- Set when the DJ stops using this drive; it stays in the history but leaves the current list.
  retired_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_key)
);

CREATE INDEX IF NOT EXISTS user_usb_devices_user_idx ON public.user_usb_devices (user_id, last_seen_at DESC);

DROP TRIGGER IF EXISTS trg_user_usb_devices_updated_at ON public.user_usb_devices;
CREATE TRIGGER trg_user_usb_devices_updated_at
  BEFORE UPDATE ON public.user_usb_devices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.usb_transfers (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_device_id      uuid        REFERENCES public.user_usb_devices(id) ON DELETE SET NULL,
  destination_device_id uuid        REFERENCES public.user_usb_devices(id) ON DELETE SET NULL,
  -- Names are copied here so the history still reads correctly after a drive is removed or renamed.
  source_label          text        NOT NULL,
  destination_label     text        NOT NULL,
  categories            text[]      NOT NULL DEFAULT '{}',
  status                text        NOT NULL CHECK (status IN ('completed', 'partial', 'failed', 'cancelled')),
  copied_count          integer     NOT NULL DEFAULT 0,
  skipped_count         integer     NOT NULL DEFAULT 0,
  failed_count          integer     NOT NULL DEFAULT 0,
  total_bytes           bigint      NOT NULL DEFAULT 0,
  -- The files moved, as [{ "path": "Contents/...", "size": 123, "status": "copied" }]. Capped at 2,000 entries.
  files                 jsonb       NOT NULL DEFAULT '[]'::jsonb,
  files_truncated       boolean     NOT NULL DEFAULT false,
  error                 text,
  started_at            timestamptz NOT NULL,
  finished_at           timestamptz NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usb_transfers_user_idx ON public.usb_transfers (user_id, finished_at DESC);

ALTER TABLE public.user_usb_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usb_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "usb_devices: select own" ON public.user_usb_devices;
CREATE POLICY "usb_devices: select own" ON public.user_usb_devices FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "usb_devices: insert own" ON public.user_usb_devices;
CREATE POLICY "usb_devices: insert own" ON public.user_usb_devices FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "usb_devices: update own" ON public.user_usb_devices;
CREATE POLICY "usb_devices: update own" ON public.user_usb_devices FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "usb_devices: delete own" ON public.user_usb_devices;
CREATE POLICY "usb_devices: delete own" ON public.user_usb_devices FOR DELETE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "usb_transfers: select own" ON public.usb_transfers;
CREATE POLICY "usb_transfers: select own" ON public.usb_transfers FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "usb_transfers: insert own" ON public.usb_transfers;
CREATE POLICY "usb_transfers: insert own" ON public.usb_transfers FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "usb_transfers: delete own" ON public.usb_transfers;
CREATE POLICY "usb_transfers: delete own" ON public.usb_transfers FOR DELETE TO authenticated USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_usb_devices TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.usb_transfers TO authenticated;
