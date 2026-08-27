begin;

create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('61111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'metadata-6a-owner@example.com', '', now(), now()),
  ('62222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'metadata-6a-other@example.com', '', now(), now());

insert into public.rekordbox_imports (
  id, user_id, source_filename, track_count, playlist_count, playlist_track_count, status
)
values
  ('6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '61111111-1111-1111-1111-111111111111', 'owner-6a.db', 2, 0, 0, 'completed'),
  ('6bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '62222222-2222-2222-2222-222222222222', 'other-6a.db', 1, 0, 0, 'completed');

insert into public.rekordbox_tracks (
  id, import_id, rekordbox_content_id, title, genre, master_db_id, master_content_id
)
values
  ('60000000-0000-0000-0000-000000000001', '6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'content-61', 'Owner Apply', 'House', 'master-db-61', 'master-content-61'),
  ('60000000-0000-0000-0000-000000000002', '6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'content-62', 'Owner Failure', 'House', 'master-db-62', 'master-content-62'),
  ('60000000-0000-0000-0000-000000000003', '6bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'content-63', 'Other Apply', 'House', 'master-db-63', 'master-content-63');

set local role authenticated;
select set_config('request.jwt.claim.sub', '61111111-1111-1111-1111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"61111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

select lives_ok(
  $$ select public.save_track_metadata_draft_v1(
    '6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '60000000-0000-0000-0000-000000000001',
    'genre', 1, 'Techno', 0
  ) $$,
  'Stage 6A fixture creates a revision-bound pending Genre draft'
);

select lives_ok(
  $$ select public.mark_track_metadata_apply_outcome_v1(
    '6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '60000000-0000-0000-0000-000000000001',
    'genre', 1,
    (select draft_fingerprint from public.track_metadata_drafts where track_id = '60000000-0000-0000-0000-000000000001'),
    'operation-61', repeat('b', 64), 'cloud-finalization-pending', 'Techno', repeat('c', 64), repeat('d', 64),
    '{"code":"local-verified","message":"must-not-persist","blockerCodes":[],"warningCodes":[]}'::jsonb
  ) $$,
  'verified local success can enter durable cloud-finalization-pending state'
);

select results_eq(
  $$ select last_apply_state, applied_revision, applied_value from public.track_metadata_drafts where track_id = '60000000-0000-0000-0000-000000000001' $$,
  $$ values ('cloud-finalization-pending'::text, 1::bigint, 'Techno'::text) $$,
  'pending recovery retains exact local applied revision/value evidence'
);

select ok(
  not ((select last_apply_summary from public.track_metadata_drafts where track_id = '60000000-0000-0000-0000-000000000001') ? 'message'),
  'cloud outcome summary strips raw desktop message text'
);

select throws_ok(
  $$ select public.save_track_metadata_draft_v1(
    '6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '60000000-0000-0000-0000-000000000001',
    'genre', 1, 'Garage', 1
  ) $$,
  '55000', 'metadata_draft_recovery_locked',
  'ordinary Save cannot overwrite unresolved recovery evidence'
);

select throws_ok(
  $$ select public.discard_track_metadata_draft_v1(
    '6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '60000000-0000-0000-0000-000000000001',
    'genre', 1
  ) $$,
  '55000', 'metadata_draft_recovery_locked',
  'ordinary Discard cannot erase unresolved recovery evidence'
);

select lives_ok(
  $$ select public.mark_track_metadata_apply_outcome_v1(
    '6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '60000000-0000-0000-0000-000000000001',
    'genre', 1,
    (select draft_fingerprint from public.track_metadata_drafts where track_id = '60000000-0000-0000-0000-000000000001'),
    'operation-61', repeat('b', 64), 'cloud-finalization-failed', 'Techno', repeat('c', 64), repeat('d', 64),
    '{"code":"supabase-unavailable"}'::jsonb
  ) $$,
  'same verified local operation may transition pending to cloud-finalization-failed'
);

select throws_ok(
  $$ select public.finalize_track_metadata_apply_v1(
    '6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '60000000-0000-0000-0000-000000000001', 'genre', 1,
    (select draft_fingerprint from public.track_metadata_drafts where track_id = '60000000-0000-0000-0000-000000000001'),
    'wrong-operation', repeat('b', 64), 'Techno', 'House', 'master-db-61', 'master-content-61', repeat('d', 64)
  ) $$,
  '40001', 'metadata_apply_operation_evidence_mismatch',
  'wrong operation ID cannot finalize local success'
);

select throws_ok(
  $$ select public.finalize_track_metadata_apply_v1(
    '6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '60000000-0000-0000-0000-000000000001', 'genre', 1,
    repeat('e', 64), 'operation-61', repeat('b', 64), 'Techno', 'House', 'master-db-61', 'master-content-61', repeat('d', 64)
  ) $$,
  '40001', 'metadata_apply_revision_conflict',
  'stale/wrong draft fingerprint cannot finalize'
);

select throws_ok(
  $$ select public.finalize_track_metadata_apply_v1(
    '6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '60000000-0000-0000-0000-000000000001', 'genre', 1,
    (select draft_fingerprint from public.track_metadata_drafts where track_id = '60000000-0000-0000-0000-000000000001'),
    'operation-61', repeat('b', 64), 'Techno', 'House', 'wrong-db', 'master-content-61', repeat('d', 64)
  ) $$,
  '40001', 'metadata_apply_master_identity_conflict',
  'wrong strong master identity cannot finalize'
);

select throws_ok(
  $$ select public.finalize_track_metadata_apply_v1(
    '6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '60000000-0000-0000-0000-000000000001', 'genre', 1,
    (select draft_fingerprint from public.track_metadata_drafts where track_id = '60000000-0000-0000-0000-000000000001'),
    'operation-61', repeat('b', 64), 'Techno', 'Trance', 'master-db-61', 'master-content-61', repeat('d', 64)
  ) $$,
  '40001', 'metadata_apply_revision_conflict',
  'canonical/moving baseline mismatch cannot finalize'
);

select lives_ok(
  $$ select public.finalize_track_metadata_apply_v1(
    '6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '60000000-0000-0000-0000-000000000001', 'genre', 1,
    (select draft_fingerprint from public.track_metadata_drafts where track_id = '60000000-0000-0000-0000-000000000001'),
    'operation-61', repeat('b', 64), 'Techno', 'House', 'master-db-61', 'master-content-61', repeat('d', 64)
  ) $$,
  'exact verified operation finalizes atomically'
);

select results_eq(
  $$ select t.genre, d.current_baseline_value, d.last_apply_state from public.rekordbox_tracks t join public.track_metadata_drafts d on d.track_id = t.id where t.id = '60000000-0000-0000-0000-000000000001' $$,
  $$ values ('Techno'::text, 'Techno'::text, 'applied'::text) $$,
  'canonical Genre and moving baseline converge to the same applied value'
);

select is(
  (select imported_baseline_value from public.track_metadata_drafts where track_id = '60000000-0000-0000-0000-000000000001'),
  'House',
  'immutable import-era Genre provenance remains unchanged after rebase'
);

select lives_ok(
  $$ select public.finalize_track_metadata_apply_v1(
    '6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '60000000-0000-0000-0000-000000000001', 'genre', 1,
    (select last_apply_draft_fingerprint from public.track_metadata_drafts where track_id = '60000000-0000-0000-0000-000000000001'),
    'operation-61', repeat('b', 64), 'Techno', 'House', 'master-db-61', 'master-content-61', repeat('d', 64)
  ) $$,
  'lost-response duplicate finalization is idempotent after draft fingerprint rebase'
);

select lives_ok(
  $$ select public.save_track_metadata_draft_v1(
    '6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '60000000-0000-0000-0000-000000000002',
    'genre', 1, 'Garage', 0
  ) $$,
  'second draft fixture is available for failure outcome tests'
);

select lives_ok(
  $$ select public.mark_track_metadata_apply_outcome_v1(
    '6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '60000000-0000-0000-0000-000000000002',
    'genre', 1,
    (select draft_fingerprint from public.track_metadata_drafts where track_id = '60000000-0000-0000-0000-000000000002'),
    'operation-62', repeat('f', 64), 'rolled-back', null, repeat('1', 64), repeat('1', 64),
    '{"code":"metadata-final-verification-failed","rollbackVerified":true}'::jsonb
  ) $$,
  'rolled-back outcome persists without claiming applied Genre'
);

select results_eq(
  $$ select pending_value, current_baseline_value, applied_revision, last_apply_state from public.track_metadata_drafts where track_id = '60000000-0000-0000-0000-000000000002' $$,
  $$ values ('Garage'::text, 'House'::text, null::bigint, 'rolled-back'::text) $$,
  'rolled-back outcome leaves pending intent and moving baseline unchanged'
);

select throws_ok(
  $$ select public.mark_track_metadata_apply_outcome_v1(
    '6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '60000000-0000-0000-0000-000000000002',
    'genre', 2, repeat('a', 64), 'operation-stale', repeat('f', 64), 'failed', null, null, null, null
  ) $$,
  '40001', 'metadata_apply_revision_conflict',
  'stale revision/outcome cannot rewrite operation evidence'
);

select set_config('request.jwt.claim.sub', '62222222-2222-2222-2222-222222222222', true);
select set_config('request.jwt.claims', '{"sub":"62222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

select throws_ok(
  $$ select public.finalize_track_metadata_apply_v1(
    '6aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '60000000-0000-0000-0000-000000000001', 'genre', 1,
    repeat('a', 64), 'operation-61', repeat('b', 64), 'Techno', 'House', 'master-db-61', 'master-content-61', repeat('d', 64)
  ) $$,
  '42501', 'metadata_apply_owner_mismatch',
  'cross-user finalization is rejected without exposing draft state'
);

reset role;

select ok(
  not has_table_privilege('authenticated', 'public.rekordbox_tracks', 'UPDATE'),
  'Stage 6A does not broaden authenticated users to direct canonical track UPDATE'
);

select * from finish();
rollback;
