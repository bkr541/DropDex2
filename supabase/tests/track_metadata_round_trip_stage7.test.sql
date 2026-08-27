begin;

create extension if not exists pgtap with schema extensions;
select plan(23);

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values ('71111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'metadata-7-owner@example.com', '', now(), now());

insert into public.rekordbox_imports (
  id, user_id, source_filename, track_count, playlist_count, playlist_track_count, status
)
values
  ('7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '71111111-1111-1111-1111-111111111111', 'stage7-main.db', 2, 0, 0, 'completed'),
  ('7bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '71111111-1111-1111-1111-111111111111', 'stage7-delete-race.db', 1, 0, 0, 'completed');

insert into public.rekordbox_tracks (
  id, import_id, rekordbox_content_id, title, genre, master_db_id, master_content_id
)
values
  ('70000000-0000-0000-0000-000000000001', '7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'content-71', 'Round Trip', 'House', 'master-db-71', 'master-content-71'),
  ('70000000-0000-0000-0000-000000000002', '7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'content-72', 'Second Attempt', 'House', 'master-db-72', 'master-content-72'),
  ('70000000-0000-0000-0000-000000000003', '7bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'content-73', 'Delete Race', 'House', 'master-db-73', 'master-content-73');

set local role authenticated;
select set_config('request.jwt.claim.sub', '71111111-1111-1111-1111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"71111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

select lives_ok(
  $$ select public.save_track_metadata_draft_v1(
    '7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '70000000-0000-0000-0000-000000000001',
    'genre', 1, 'Techno', 0
  ) $$,
  'pending Genre fixture is created through the production draft RPC'
);

reset role;

select is(
  public.rekordbox_import_metadata_delete_block_v1(
    '7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '71111111-1111-1111-1111-111111111111'
  ),
  'pending',
  'hard-delete predicate sees unresolved pending Genre intent'
);

select throws_ok(
  $$ select public.begin_rekordbox_import_hard_delete(
    '7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '71111111-1111-1111-1111-111111111111'
  ) $$,
  '55000', 'metadata_delete_blocked:pending',
  'transaction-boundary delete start cannot erase pending intent'
);

select throws_ok(
  $$ select public.hard_delete_rekordbox_import(
    '7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '71111111-1111-1111-1111-111111111111',
    'activate_next'
  ) $$,
  '55000', 'metadata_delete_blocked:pending',
  'final hard-delete transaction independently rechecks pending metadata'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.rekordbox_import_metadata_delete_block_v1(uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated renderer cannot call the service-owned delete predicate directly'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.rekordbox_import_metadata_delete_block_v1(uuid,uuid)',
    'EXECUTE'
  ),
  'service role may execute the narrow delete predicate'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '71111111-1111-1111-1111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"71111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

select lives_ok(
  $$ select public.discard_track_metadata_draft_v1(
    '7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '70000000-0000-0000-0000-000000000001',
    'genre', 1
  ) $$,
  'explicit Discard remains allowed for ordinary pending intent'
);

reset role;

select is(
  public.rekordbox_import_metadata_delete_block_v1(
    '7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '71111111-1111-1111-1111-111111111111'
  ),
  null,
  'resolved pending intent no longer blocks library deletion'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '71111111-1111-1111-1111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"71111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

select lives_ok(
  $$ select public.save_track_metadata_draft_v1(
    '7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '70000000-0000-0000-0000-000000000001',
    'genre', 1, 'Techno', 0
  ) $$,
  'recovery fixture recreates the pending Genre'
);

select lives_ok(
  $$ select public.mark_track_metadata_apply_outcome_v1(
    '7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '70000000-0000-0000-0000-000000000001',
    'genre', 1,
    (select draft_fingerprint from public.track_metadata_drafts where track_id = '70000000-0000-0000-0000-000000000001'),
    'operation-71', repeat('a', 64), 'cloud-finalization-failed', 'Techno', repeat('b', 64), repeat('c', 64),
    '{"code":"supabase-unavailable"}'::jsonb
  ) $$,
  'verified local-success evidence enters cloud recovery state'
);

reset role;

select is(
  public.rekordbox_import_metadata_delete_block_v1(
    '7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '71111111-1111-1111-1111-111111111111'
  ),
  'recovery',
  'recovery evidence takes precedence over the generic pending delete blocker'
);

select throws_ok(
  $$ delete from public.rekordbox_tracks where id = '70000000-0000-0000-0000-000000000001' $$,
  '55000', 'metadata_draft_recovery_locked',
  'cascade deletion cannot bypass the recovery lock'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '71111111-1111-1111-1111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"71111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

select lives_ok(
  $$ select public.save_track_metadata_draft_v1(
    '7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '70000000-0000-0000-0000-000000000002',
    'genre', 1, 'Techno', 0
  ) $$,
  'second track creates first apply attempt'
);

select lives_ok(
  $$ select public.mark_track_metadata_apply_outcome_v1(
    '7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '70000000-0000-0000-0000-000000000002',
    'genre', 1,
    (select draft_fingerprint from public.track_metadata_drafts where track_id = '70000000-0000-0000-0000-000000000002'),
    'operation-72-success', repeat('d', 64), 'cloud-finalization-pending', 'Techno', repeat('e', 64), repeat('f', 64), null
  ) $$,
  'first attempt persists verified local-success proof'
);

select lives_ok(
  $$ select public.finalize_track_metadata_apply_v1(
    '7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '70000000-0000-0000-0000-000000000002',
    'genre', 1,
    (select draft_fingerprint from public.track_metadata_drafts where track_id = '70000000-0000-0000-0000-000000000002'),
    'operation-72-success', repeat('d', 64), 'Techno', 'House', 'master-db-72', 'master-content-72', repeat('f', 64)
  ) $$,
  'first attempt finalizes canonical Genre and moving baseline'
);

reset role;
update public.track_metadata_drafts
   set applied_at = '2000-01-01T00:00:00Z'::timestamptz
 where track_id = '70000000-0000-0000-0000-000000000002';

set local role authenticated;
select set_config('request.jwt.claim.sub', '71111111-1111-1111-1111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"71111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

select lives_ok(
  $$ select public.save_track_metadata_draft_v1(
    '7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '70000000-0000-0000-0000-000000000002',
    'genre', 1, 'Garage', 1
  ) $$,
  'a later edit creates revision 2 without erasing prior successful provenance prematurely'
);

select lives_ok(
  $$ select public.mark_track_metadata_apply_outcome_v1(
    '7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '70000000-0000-0000-0000-000000000002',
    'genre', 2,
    (select draft_fingerprint from public.track_metadata_drafts where track_id = '70000000-0000-0000-0000-000000000002'),
    'operation-72-second-success', repeat('1', 64), 'cloud-finalization-pending', 'Garage', repeat('2', 64), repeat('3', 64), null
  ) $$,
  'a second verified local write records a distinct operation'
);

select ok(
  (select applied_at > '2026-01-01T00:00:00Z'::timestamptz
     from public.track_metadata_drafts
    where track_id = '70000000-0000-0000-0000-000000000002'),
  'a new local-success operation refreshes applied_at instead of inheriting the older operation timestamp'
);

select lives_ok(
  $$ select public.finalize_track_metadata_apply_v1(
    '7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '70000000-0000-0000-0000-000000000002',
    'genre', 2,
    (select draft_fingerprint from public.track_metadata_drafts where track_id = '70000000-0000-0000-0000-000000000002'),
    'operation-72-second-success', repeat('1', 64), 'Garage', 'Techno', 'master-db-72', 'master-content-72', repeat('3', 64)
  ) $$,
  'second successful operation finalizes before a later failure attempt'
);

select lives_ok(
  $$ select public.save_track_metadata_draft_v1(
    '7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '70000000-0000-0000-0000-000000000002',
    'genre', 1, 'Trance', 2
  ) $$,
  'third edit creates revision 3 from the rebased Garage baseline'
);

select lives_ok(
  $$ select public.mark_track_metadata_apply_outcome_v1(
    '7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '70000000-0000-0000-0000-000000000002',
    'genre', 3,
    (select draft_fingerprint from public.track_metadata_drafts where track_id = '70000000-0000-0000-0000-000000000002'),
    'operation-72-failed', repeat('4', 64), 'rolled-back', null, repeat('5', 64), repeat('5', 64),
    '{"code":"metadata-final-verification-failed","rollbackVerified":true}'::jsonb
  ) $$,
  'later rolled-back attempt is persisted without claiming a local apply'
);

select results_eq(
  $$ select pending_value, current_baseline_value, last_apply_state, applied_revision, applied_value, applied_at, cloud_finalized_at
       from public.track_metadata_drafts where track_id = '70000000-0000-0000-0000-000000000002' $$,
  $$ values ('Trance'::text, 'Garage'::text, 'rolled-back'::text, null::bigint, null::text, null::timestamptz, null::timestamptz) $$,
  'non-success attempt keeps user intent/baseline but clears stale applied proof from the earlier success'
);

reset role;
update public.rekordbox_imports
   set status = 'deleting'
 where id = '7bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

set local role authenticated;
select set_config('request.jwt.claim.sub', '71111111-1111-1111-1111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"71111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

select throws_ok(
  $$ select public.save_track_metadata_draft_v1(
    '7bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '70000000-0000-0000-0000-000000000003',
    'genre', 1, 'Techno', 0
  ) $$,
  '55000', 'metadata_draft_import_deleting',
  'a snapshot already deleting cannot acquire fresh unresolved Genre intent'
);

select * from finish();
rollback;
