-- ============================================================
-- DropDex: User settings — active import management
-- ============================================================

create table if not exists public.rekordbox_user_settings (
  user_id          uuid        primary key references auth.users(id) on delete cascade,
  active_import_id uuid        references public.rekordbox_imports(id) on delete set null,
  updated_at       timestamptz not null default now()
);

create index if not exists rekordbox_user_settings_active_import_idx
  on public.rekordbox_user_settings (active_import_id);

alter table public.rekordbox_user_settings enable row level security;

create policy "Users can select their own settings"
  on public.rekordbox_user_settings for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can insert their own settings"
  on public.rekordbox_user_settings for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Users can update their own settings"
  on public.rekordbox_user_settings for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- set_active_import: atomically upserts the user's active import.
-- Validates import ownership before writing.
create or replace function public.set_active_import(p_import_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.rekordbox_imports
     where id = p_import_id and user_id = v_user_id
  ) then
    raise exception 'Import not found or access denied';
  end if;

  insert into public.rekordbox_user_settings (user_id, active_import_id, updated_at)
  values (v_user_id, p_import_id, now())
  on conflict (user_id) do update
    set active_import_id = excluded.active_import_id,
        updated_at        = excluded.updated_at;
end;
$$;
