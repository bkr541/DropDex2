-- ============================================================
-- DropDex canonical cue reconciliation Stage 2
--
-- cue_family remains 'hot'/'memory' for backward compatibility with existing
-- UI/draft contracts, while this column records whether that family is only a
-- DB compatibility heuristic or has been authoritatively resolved from ANLZ.
-- ============================================================

alter table public.rekordbox_cues
  add column if not exists cue_family_authority text;

update public.rekordbox_cues
   set cue_family_authority = case
     when source_anlz_present then 'anlz'
     else 'provisional'
   end
 where cue_family_authority is null;

alter table public.rekordbox_cues
  alter column cue_family_authority set default 'provisional',
  alter column cue_family_authority set not null;

alter table public.rekordbox_cues
  drop constraint if exists rekordbox_cues_family_authority_check,
  add constraint rekordbox_cues_family_authority_check
    check (cue_family_authority in ('provisional', 'anlz'));

comment on column public.rekordbox_cues.cue_family_authority is
  'provisional = DB compatibility heuristic only; anlz = family resolved from authoritative ANLZ cue semantics';
