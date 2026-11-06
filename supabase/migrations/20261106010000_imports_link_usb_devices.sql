-- A USB is identified by its own id (user_usb_devices.id), not by its display name.
--
-- Two different USBs can share a name, so each library snapshot is now linked to the USB it came from, and playlist
-- customisations are keyed by that USB's id. The drive name stays on the snapshot for display and for checking Rekordbox paths.

ALTER TABLE public.rekordbox_imports
  ADD COLUMN IF NOT EXISTS usb_device_id uuid REFERENCES public.user_usb_devices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS rekordbox_imports_usb_device_idx
  ON public.rekordbox_imports (usb_device_id) WHERE usb_device_id IS NOT NULL;

-- ── Existing snapshots ───────────────────────────────────────────────────────
-- Before this change the only thing known about a drive was its name, so snapshots that share a name (per user) are treated
-- as one USB. The key matches the app's "name only" key, so a drive the desktop app later recognises by its volume UUID
-- takes over the same row instead of creating a second one.

INSERT INTO public.user_usb_devices (user_id, device_key, label, first_seen_at, last_seen_at)
SELECT user_id,
       'name:' || lower(btrim(device_name)) || '|unknown',
       min(btrim(device_name)),
       min(imported_at),
       max(imported_at)
FROM public.rekordbox_imports
WHERE device_name IS NOT NULL AND btrim(device_name) <> ''
GROUP BY user_id, lower(btrim(device_name))
ON CONFLICT (user_id, device_key) DO NOTHING;

UPDATE public.rekordbox_imports i
SET usb_device_id = d.id
FROM public.user_usb_devices d
WHERE i.usb_device_id IS NULL
  AND i.device_name IS NOT NULL AND btrim(i.device_name) <> ''
  AND d.user_id = i.user_id
  AND d.device_key = 'name:' || lower(btrim(i.device_name)) || '|unknown';

-- ── Playlist customisations ──────────────────────────────────────────────────
-- Keys were "<drive name>::<rekordbox playlist id>"; they are now "<usb id>::<rekordbox playlist id>".

WITH owners AS (
  SELECT DISTINCT user_id, device_name AS name, usb_device_id
  FROM public.rekordbox_imports
  WHERE usb_device_id IS NOT NULL AND device_name IS NOT NULL
)
UPDATE public.user_playlist_profiles p
SET playlist_identity_key = o.usb_device_id::text || '::' || substr(p.playlist_identity_key, char_length(o.name) + 3)
FROM owners o
WHERE p.user_id = o.user_id
  AND left(p.playlist_identity_key, char_length(o.name) + 2) = o.name || '::';
