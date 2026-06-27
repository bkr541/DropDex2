begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'owner@example.com', '', now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'other@example.com', '', now(), now());

insert into public.rekordbox_imports (
  id, user_id, source_filename, track_count, playlist_count, playlist_track_count, status
)
values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111',
  'exportLibrary.db',
  1501,
  1,
  1501,
  'completed'
);

insert into public.rekordbox_playlists (
  id, import_id, rekordbox_playlist_id, name, sort_order, is_folder
)
values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'playlist-1',
  'Large Playlist',
  1,
  false
);

insert into public.rekordbox_tracks (
  id,
  import_id,
  rekordbox_content_id,
  title,
  artist,
  genre,
  musical_key,
  bpm,
  duration_seconds,
  date_added
)
select
  ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  g::text,
  case when g = 1501 then 'Needle Beyond One Thousand' else 'Track ' || lpad(g::text, 4, '0') end,
  'Artist ' || (g % 10),
  case when g = 1501 then 'Beyond First Thousand' else 'Genre ' || (g % 5) end,
  case when g = 1501 then '12A' else '8A' end,
  case when g = 1501 then 150 else 128 end,
  case when g = 1501 then 999 else 180 end,
  '2026-06-27'::date
from generate_series(1, 1501) g;

insert into public.rekordbox_playlist_tracks (playlist_id, track_id, position)
select
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
  ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
  g
from generate_series(1, 1501) g;

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
  true
);

select is(
  (public.get_rekordbox_library_track_page(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 0, 200, null, null, null
  )->>'total')::integer,
  1501,
  'library page reports all 1,501 tracks'
);

select is(
  jsonb_array_length(public.get_rekordbox_library_track_page(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1000, 200, null, null, null
  )->'items'),
  200,
  'library page after row 1,000 contains 200 tracks'
);

select is(
  public.get_rekordbox_library_track_page(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1500, 200, null, null, null
  )->'items'->0->>'title',
  'Needle Beyond One Thousand',
  'the final library track is reachable'
);

select is(
  public.get_rekordbox_library_track_page(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 0, 200, 'Needle Beyond', null, null
  )->'items'->0->>'title',
  'Needle Beyond One Thousand',
  'search finds a track originally beyond row 1,000'
);

select is(
  public.get_rekordbox_library_track_page(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 0, 200, null, 'Beyond First Thousand', null
  )->'items'->0->>'title',
  'Needle Beyond One Thousand',
  'filters are applied before pagination'
);

select is(
  public.get_rekordbox_library_track_page(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 199, 2, null, null, null
  )->'items'->0->>'id',
  '00000000-0000-0000-0000-000000000200',
  'stable date-added/id ordering keeps the page boundary deterministic'
);

select is(
  (public.get_rekordbox_playlist_track_page(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1000, 200
  )->'items'->0->>'position')::integer,
  1001,
  'playlist placement 1,001 is reachable in order'
);

select is(
  (public.get_rekordbox_playlist_track_page(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1500, 200
  )->'items'->0->>'position')::integer,
  1501,
  'playlist placement 1,501 is reachable'
);

select is(
  (public.get_rekordbox_library_stats(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  )->>'total_track_count')::integer,
  1501,
  'library statistics include all tracks'
);

select is(
  (public.get_rekordbox_library_stats(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  )->>'total_duration_seconds')::bigint,
  270999::bigint,
  'library duration includes the row after 1,000'
);

select is(
  (public.get_rekordbox_playlist_stats(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  )->>'track_count')::integer,
  1501,
  'playlist statistics include all placements'
);

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
  true
);

select throws_ok(
  $$ select public.get_rekordbox_library_stats('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $$,
  '42501',
  'Not authorized to read this Rekordbox import',
  'another user cannot retrieve library statistics'
);

select * from finish();
rollback;
