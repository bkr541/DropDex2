-- ============================================================
-- DropDex: deterministic Similar Vibes candidate retrieval
--
-- Build the harmonic/BPM candidate UNION before applying the row limit, then
-- order by the same database-available signals used by the client scorer.
-- This prevents PostgREST's row order or an AND-combined prefilter from hiding
-- the strongest candidates before TypeScript ranking begins.
-- ============================================================

create or replace function public.get_rekordbox_similar_vibe_candidates(
  p_import_id uuid,
  p_selected_track_id uuid,
  p_compatible_camelot_keys text[] default array[]::text[],
  p_selected_bpm numeric default null,
  p_bpm_tolerance numeric default 2,
  p_selected_genre text default null,
  p_selected_label text default null,
  p_limit integer default 20
)
returns setof public.rekordbox_tracks
language sql
stable
security invoker
set search_path = public
as $$
  select t.*
  from public.rekordbox_tracks as t
  where t.import_id = p_import_id
    and t.id <> p_selected_track_id
    and (
      (
        cardinality(coalesce(p_compatible_camelot_keys, array[]::text[])) > 0
        and t.camelot_key = any(coalesce(p_compatible_camelot_keys, array[]::text[]))
      )
      or (
        p_selected_bpm is not null
        and p_selected_bpm > 0
        and t.bpm is not null
        and t.bpm > 0
        and abs(t.bpm - p_selected_bpm) <= greatest(coalesce(p_bpm_tolerance, 0), 0)
      )
    )
  order by
    (
      case array_position(coalesce(p_compatible_camelot_keys, array[]::text[]), t.camelot_key)
        when 1 then 30::numeric
        when 2 then 25::numeric
        when 3 then 20::numeric
        when 4 then 20::numeric
        when 5 then 12::numeric
        else 0::numeric
      end
      + case
          when p_selected_bpm is not null
            and p_selected_bpm > 0
            and t.bpm is not null
            and t.bpm > 0
            and coalesce(p_bpm_tolerance, 0) > 0
            and abs(t.bpm - p_selected_bpm) <= p_bpm_tolerance
          then 10::numeric * (
            1::numeric - abs(t.bpm - p_selected_bpm) / p_bpm_tolerance
          )
          when p_selected_bpm is not null
            and p_selected_bpm > 0
            and t.bpm = p_selected_bpm
          then 10::numeric
          else 0::numeric
        end
      + case
          when nullif(btrim(p_selected_genre), '') is not null
            and lower(btrim(t.genre)) = lower(btrim(p_selected_genre))
          then 5::numeric
          else 0::numeric
        end
      + case
          when nullif(btrim(p_selected_label), '') is not null
            and lower(btrim(t.label)) = lower(btrim(p_selected_label))
          then 3::numeric
          else 0::numeric
        end
    ) desc,
    case
      when p_selected_bpm is not null and p_selected_bpm > 0 and t.bpm is not null
      then abs(t.bpm - p_selected_bpm)
      else null
    end asc nulls last,
    lower(t.title) asc,
    t.id asc
  limit least(greatest(coalesce(p_limit, 20), 1), 200);
$$;

comment on function public.get_rekordbox_similar_vibe_candidates(
  uuid, uuid, text[], numeric, numeric, text, text, integer
) is
  'Returns a deterministic, pre-ranked union of harmonic and BPM Similar Vibes candidates.';

revoke all on function public.get_rekordbox_similar_vibe_candidates(
  uuid, uuid, text[], numeric, numeric, text, text, integer
) from public;

grant execute on function public.get_rekordbox_similar_vibe_candidates(
  uuid, uuid, text[], numeric, numeric, text, text, integer
) to authenticated;
