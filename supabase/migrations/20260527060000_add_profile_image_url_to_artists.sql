-- ============================================================================
-- DropDex Migration: Add profile_image_url to public.artists
-- ============================================================================

begin;

alter table public.artists
  add column if not exists profile_image_url text;

commit;
