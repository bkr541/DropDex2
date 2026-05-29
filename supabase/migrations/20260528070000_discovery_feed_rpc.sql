-- ============================================================================
-- DropDex Migration: Discovery home feed RPC
--
-- Adds a single Postgres function that returns the top N artists by stored
-- setlist count.  Used by the Discovery home feed to populate the horizontal
-- artist rows without a GROUP BY round-trip through the PostgREST row-by-row
-- API (which does not support aggregate functions directly).
--
-- IDEMPOTENCY: CREATE OR REPLACE — safe to re-apply.
-- ============================================================================

begin;

-- Returns the top p_limit artists ranked by number of distinct stored setlists.
-- Includes profile_image_url and normalized_name so the frontend can build the
-- hero avatar + navigation without an additional round-trip.
create or replace function public.get_top_artists_for_feed(p_limit int default 10)
returns table (
  id              uuid,
  name            text,
  normalized_name text,
  profile_image_url text,
  setlist_count   bigint
)
language sql
stable
set search_path = public
as $$
  select
    a.id,
    a.name,
    a.normalized_name,
    a.profile_image_url,
    count(distinct asra.set_result_id) as setlist_count
  from public.artists a
  join public.artist_set_result_artists asra on asra.artist_id = a.id
  group by a.id, a.name, a.normalized_name, a.profile_image_url
  order by setlist_count desc
  limit p_limit;
$$;

-- Allow both anonymous and authenticated callers (discovery tables have no RLS).
grant execute on function public.get_top_artists_for_feed(int) to anon;
grant execute on function public.get_top_artists_for_feed(int) to authenticated;

commit;
