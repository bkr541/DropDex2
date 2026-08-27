begin;

create extension if not exists pgtap with schema extensions;
select plan(27);

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('31111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'metadata-owner@example.com', '', now(), now()),
  ('32222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'metadata-other@example.com', '', now(), now());

insert into public.rekordbox_imports (
  id, user_id, source_filename, track_count, playlist_count, playlist_track_count, status
)
values
  ('3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '31111111-1111-1111-1111-111111111111', 'owner.db', 2, 0, 0, 'completed'),
  ('3bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '32222222-2222-2222-2222-222222222222', 'other.db', 1, 0, 0, 'completed');

insert into public.rekordbox_tracks (
  id, import_id, rekordbox_content_id, title, genre, master_db_id, master_content_id
)
values
  ('30000000-0000-0000-0000-000000000001', '3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'content-1', 'Owner Track', 'House', 'master-db-owner', 'master-content-owner'),
  ('30000000-0000-0000-0000-000000000002', '3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'content-2', 'Missing Identity', 'Techno', null, null),
  ('30000000-0000-0000-0000-000000000003', '3bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'content-3', 'Other Track', 'Trance', 'master-db-other', 'master-content-other');

set local role authenticated;
select set_config('request.jwt.claim.sub', '31111111-1111-1111-1111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"31111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

select lives_ok(
  $$ select public.save_track_metadata_draft_v1(
    '3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '30000000-0000-0000-0000-000000000001',
    'genre', 1, '  Bass   House  ', 0
  ) $$,
  'owner can create a Genre draft through the production RPC'
);

select is(
  (select pending_value from public.track_metadata_drafts where track_id = '30000000-0000-0000-0000-000000000001'),
  'Bass   House',
  'outer whitespace is trimmed while meaningful inner spacing is preserved'
);

select is(
  (select imported_baseline_value from public.track_metadata_drafts where track_id = '30000000-0000-0000-0000-000000000001'),
  'House',
  'immutable import-era baseline starts from canonical Genre'
);

select is(
  (select current_baseline_value from public.track_metadata_drafts where track_id = '30000000-0000-0000-0000-000000000001'),
  'House',
  'moving baseline starts from canonical Genre'
);

select results_eq(
  $$ select master_db_id, master_content_id from public.track_metadata_drafts where track_id = '30000000-0000-0000-0000-000000000001' $$,
  $$ values ('master-db-owner'::text, 'master-content-owner'::text) $$,
  'trusted master identity is copied from the canonical track'
);

select matches(
  (select draft_fingerprint from public.track_metadata_drafts where track_id = '30000000-0000-0000-0000-000000000001'),
  '^[0-9a-f]{64}$',
  'draft fingerprint is deterministic SHA-256 shaped data'
);

select is(
  (select revision from public.save_track_metadata_draft_v1(
    '3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '30000000-0000-0000-0000-000000000001',
    'genre', 1, 'Drum & Bass', 1
  )),
  2::bigint,
  'second save updates the same logical draft with a higher revision'
);

select is(
  (select count(*) from public.track_metadata_drafts where track_id = '30000000-0000-0000-0000-000000000001'),
  1::bigint,
  'sequential saves keep one logical user/track/field draft'
);

select throws_ok(
  $$ select public.save_track_metadata_draft_v1(
    '3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '30000000-0000-0000-0000-000000000001',
    'genre', 1, 'Techno', 1
  ) $$,
  '40001', 'metadata_draft_revision_conflict',
  'stale expected revision is rejected'
);

select lives_ok(
  $$ select public.save_track_metadata_draft_v1(
    '3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '30000000-0000-0000-0000-000000000001',
    'genre', 1, '   ', 2
  ) $$,
  'whitespace-only Genre is accepted as explicit clear intent'
);

select is(
  (select pending_value from public.track_metadata_drafts where track_id = '30000000-0000-0000-0000-000000000001'),
  null::text,
  'clear Genre is represented as null'
);

select is(
  (select revision from public.save_track_metadata_draft_v1(
    '3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '30000000-0000-0000-0000-000000000001',
    'genre', 1, null, 3
  )),
  4::bigint,
  'explicit null Genre is accepted and remains revision protected'
);

select throws_ok(
  $$ select public.save_track_metadata_draft_v1(
    '3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '30000000-0000-0000-0000-000000000001',
    'genre', 1, repeat('g', 256), 4
  ) $$,
  '22001', 'metadata_draft_genre_too_long',
  'Genre over the verified Rekordbox limit is rejected'
);

select throws_ok(
  $$ select public.save_track_metadata_draft_v1(
    '3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '30000000-0000-0000-0000-000000000001',
    'label', 1, 'Label', 4
  ) $$,
  '22023', 'metadata_draft_unsupported_field',
  'unsupported metadata fields are rejected'
);

select throws_ok(
  $$ select public.save_track_metadata_draft_v1(
    '3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '30000000-0000-0000-0000-000000000002',
    'genre', 1, 'Garage', 0
  ) $$,
  '22023', 'metadata_draft_missing_master_identity',
  'draft creation is blocked when trusted master identity is missing'
);

select throws_ok(
  $$ select public.save_track_metadata_draft_v1(
    '3bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '30000000-0000-0000-0000-000000000003',
    'genre', 1, 'House', 0
  ) $$,
  '42501', 'metadata_draft_owner_mismatch',
  'foreign track draft creation is blocked'
);

select is(
  (select count(*) from public.save_track_metadata_draft_v1(
    '3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '30000000-0000-0000-0000-000000000001',
    'genre', 1, 'House', 4
  )),
  0::bigint,
  'editing back to the moving baseline returns no pending row'
);

select is(
  (select count(*) from public.track_metadata_drafts where track_id = '30000000-0000-0000-0000-000000000001'),
  0::bigint,
  'editing back to baseline removes false pending state'
);

select ok(
  not has_table_privilege('authenticated', 'public.track_metadata_drafts', 'INSERT')
  and not has_table_privilege('authenticated', 'public.track_metadata_drafts', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.track_metadata_drafts', 'DELETE'),
  'authenticated renderer has no direct metadata-draft mutation privileges'
);

select lives_ok(
  $$ select public.save_track_metadata_draft_v1(
    '3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '30000000-0000-0000-0000-000000000001',
    'genre', 1, 'UK Garage', 0
  ) $$,
  'owner can recreate a draft before cross-user RLS verification'
);

select set_config('request.jwt.claim.sub', '32222222-2222-2222-2222-222222222222', true);
select set_config('request.jwt.claims', '{"sub":"32222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

select is(
  (select count(*) from public.track_metadata_drafts where track_id = '30000000-0000-0000-0000-000000000001'),
  0::bigint,
  'cross-user draft reads are blocked by RLS'
);

select throws_ok(
  $$ select public.discard_track_metadata_draft_v1(
    '3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '30000000-0000-0000-0000-000000000001',
    'genre', 1
  ) $$,
  '42501', 'metadata_draft_owner_mismatch',
  'cross-user discard is blocked'
);


select set_config('request.jwt.claim.sub', '31111111-1111-1111-1111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"31111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

select is(
  (select count(*) from public.discard_track_metadata_draft_v1(
    '3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '30000000-0000-0000-0000-000000000001',
    'genre', 1
  )),
  1::bigint,
  'owner can discard the exact persisted Genre draft revision'
);

select is(
  (select count(*) from public.track_metadata_drafts where track_id = '30000000-0000-0000-0000-000000000001'),
  0::bigint,
  'discard removes only pending metadata intent'
);

select lives_ok(
  $$ select public.save_track_metadata_draft_v1(
    '3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '30000000-0000-0000-0000-000000000001',
    'genre', 1, 'Garage', 0
  ) $$,
  'owner can create another draft before cascade verification'
);

select lives_ok(
  $$ delete from public.rekordbox_imports where id = '3aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  'deleting an owned import succeeds'
);

reset role;

select is(
  (select count(*) from public.track_metadata_drafts where user_id = '31111111-1111-1111-1111-111111111111'),
  0::bigint,
  'metadata drafts cascade away with their Rekordbox import/track snapshot'
);

select * from finish();
rollback;
