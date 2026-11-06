import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = resolve(__dirname, '../../../supabase/migrations');
const read = (suffix: string) => {
  const name = readdirSync(dir).find((file) => file.endsWith(suffix));
  if (!name) throw new Error(`missing migration ${suffix}`);
  return readFileSync(resolve(dir, name), 'utf8');
};

describe('snapshots are linked to saved USBs in the database', () => {
  const link = read('_imports_link_usb_devices.sql');
  const trigger = read('_import_usb_link_trigger.sql');

  it('gives every snapshot a USB id column that points at the user\'s saved USBs', () => {
    expect(link).toContain('ADD COLUMN IF NOT EXISTS usb_device_id uuid REFERENCES public.user_usb_devices(id) ON DELETE SET NULL');
  });

  it('links any snapshot that names a drive but has no USB, whichever way it was created', () => {
    expect(trigger).toContain('BEFORE INSERT OR UPDATE OF device_name, usb_device_id ON public.rekordbox_imports');
    expect(trigger).toContain('IF NEW.usb_device_id IS NOT NULL THEN');
    expect(trigger).toContain('WHERE user_id = NEW.user_id AND lower(btrim(label)) = lower(wanted)');
    expect(trigger).toContain('SECURITY DEFINER');
    expect(trigger).toContain('SET search_path = public');
  });
});
