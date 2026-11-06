-- Every library snapshot that names a drive is linked to one of the user's saved USBs, whichever way it was created.
--
-- The app sends the USB's id when it can. This trigger covers every other path (older app versions, imports that fill in the
-- drive name later, backend jobs): a snapshot with a drive name but no USB gets the user's USB with that name, or a new one.

CREATE OR REPLACE FUNCTION public.ensure_import_usb_device()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  wanted text;
  found_id uuid;
BEGIN
  IF NEW.usb_device_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  wanted := btrim(coalesce(NEW.device_name, ''));
  IF wanted = '' THEN
    RETURN NEW;
  END IF;

  -- The user's own USB with this name: one still in use first, then the one seen most recently.
  SELECT id INTO found_id
  FROM public.user_usb_devices
  WHERE user_id = NEW.user_id AND lower(btrim(label)) = lower(wanted)
  ORDER BY (retired_at IS NULL) DESC, last_seen_at DESC
  LIMIT 1;

  IF found_id IS NULL THEN
    INSERT INTO public.user_usb_devices (user_id, device_key, label)
    VALUES (NEW.user_id, 'name:' || lower(wanted) || '|unknown', wanted)
    ON CONFLICT (user_id, device_key) DO UPDATE SET last_seen_at = now()
    RETURNING id INTO found_id;
  END IF;

  NEW.usb_device_id := found_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rekordbox_imports_usb_device ON public.rekordbox_imports;
CREATE TRIGGER trg_rekordbox_imports_usb_device
  BEFORE INSERT OR UPDATE OF device_name, usb_device_id ON public.rekordbox_imports
  FOR EACH ROW EXECUTE FUNCTION public.ensure_import_usb_device();

-- Snapshots that still have no USB (for example, ones whose drive name was filled in after the first migration ran).
UPDATE public.rekordbox_imports SET device_name = device_name
WHERE usb_device_id IS NULL AND device_name IS NOT NULL AND btrim(device_name) <> '';
