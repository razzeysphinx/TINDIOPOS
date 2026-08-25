begin;

create extension if not exists pgtap with schema extensions;

select plan(37);

select ok(to_regclass('public.organization_rate_limit_windows') is not null, 'organization rate-limit table exists');
select ok(to_regclass('public.organization_export_sessions') is not null, 'organization export-session table exists');
select ok(to_regclass('public.organization_usage_daily') is not null, 'organization usage table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.organization_rate_limit_windows'::regclass), 'rate-limit rows have RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.organization_export_sessions'::regclass), 'export sessions have RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.organization_usage_daily'::regclass), 'usage rows have RLS enabled');
select ok(not has_table_privilege('authenticated', 'public.organization_rate_limit_windows', 'select'), 'authenticated users cannot read rate-limit rows directly');
select ok(not has_table_privilege('authenticated', 'public.organization_export_sessions', 'select'), 'authenticated users cannot read export sessions directly');
select ok(not has_table_privilege('authenticated', 'public.organization_usage_daily', 'select'), 'authenticated users cannot read usage rows directly');
select ok(to_regprocedure('public.manage_organization_lifecycle(uuid,text,text)') is not null, 'organization lifecycle routine exists');
select ok(to_regprocedure('public.prepare_organization_export(uuid)') is not null, 'organization export preparation routine exists');
select ok(to_regprocedure('public.get_organization_export_page(uuid,text,uuid)') is not null, 'paged organization export routine exists');
select ok(to_regprocedure('public.get_organization_usage_snapshot(uuid)') is not null, 'organization usage routine exists');
select ok(to_regprocedure('public.get_organization_readiness_access(uuid)') is not null, 'paused organization readiness access routine exists');

insert into auth.users (id, email, raw_user_meta_data)
values
  ('16111111-1111-4111-8111-111111111111', 'phase-sixteen-owner-a@tindio.test', '{"full_name":"Phase Sixteen Owner A"}'::jsonb),
  ('16222222-2222-4222-8222-222222222222', 'phase-sixteen-owner-b@tindio.test', '{"full_name":"Phase Sixteen Owner B"}'::jsonb);

create temporary table improvement_sixteen_context (
  organization_a_id uuid,
  organization_a_second_id uuid,
  organization_b_id uuid,
  organization_a_export_session_id uuid,
  organization_a_archive_export_session_id uuid
);

grant select, insert, update on improvement_sixteen_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '16111111-1111-4111-8111-111111111111';

insert into improvement_sixteen_context (organization_a_id)
select organization_id
from public.bootstrap_organization('Phase Sixteen Alpha', 'Alpha Main', 'Alpha Counter');

select lives_ok(
  $$select public.bootstrap_organization('Phase Sixteen Alpha Second', 'Alpha Second Main', 'Alpha Second Counter')$$,
  'one signed-in owner can safely create a second independent organization'
);

update improvement_sixteen_context context
set organization_a_second_id = employee.organization_id
from public.employees employee
where employee.profile_id = '16111111-1111-4111-8111-111111111111'
  and employee.organization_id <> context.organization_a_id;

select ok(
  (select organization_a_second_id is not null from improvement_sixteen_context),
  'the second organization membership is stored separately'
);

set local request.jwt.claim.sub = '16222222-2222-4222-8222-222222222222';

update improvement_sixteen_context
set organization_b_id = created.organization_id
from public.bootstrap_organization('Phase Sixteen Bravo', 'Bravo Main', 'Bravo Counter') created;

select is(
  (select count(*) from public.stores where organization_id = (select organization_a_id from improvement_sixteen_context)),
  0::bigint,
  'cross-organization direct store lookup returns no Alpha records to Bravo'
);

select is(
  private.has_permission((select organization_a_id from improvement_sixteen_context), 'settings.manage'),
  false,
  'a missing approval context coalesces to a denied cross-organization permission check'
);

select throws_ok(
  format($$select public.prepare_organization_export(%L::uuid)$$, (select organization_a_id from improvement_sixteen_context)),
  '42501',
  'You do not have permission to export this organization.',
  'cross-organization export preparation is rejected'
);

select throws_ok(
  format($$select public.get_organization_usage_snapshot(%L::uuid)$$, (select organization_a_id from improvement_sixteen_context)),
  '42501',
  'You do not have permission to view organization usage.',
  'cross-organization usage lookup is rejected'
);

select throws_ok(
  format($$select public.get_organization_readiness_access(%L::uuid)$$, (select organization_a_id from improvement_sixteen_context)),
  '42501',
  'You do not have access to this organization.',
  'cross-organization paused-screen access flags are rejected'
);

set local request.jwt.claim.sub = '16111111-1111-4111-8111-111111111111';

select lives_ok(
  format($$select public.get_organization_usage_snapshot(%L::uuid)$$, (select organization_a_id from improvement_sixteen_context)),
  'owner can collect a tenant-scoped usage snapshot'
);

select is(
  public.get_organization_readiness_access((select organization_a_id from improvement_sixteen_context)) ->> 'can_manage_lifecycle',
  'true',
  'owner receives only the readiness capability needed to manage a paused organization'
);

update improvement_sixteen_context
set organization_a_export_session_id = (
  select (public.prepare_organization_export(organization_a_id) ->> 'export_session_id')::uuid
  from improvement_sixteen_context
);

select ok(
  (select organization_a_export_session_id is not null from improvement_sixteen_context),
  'owner receives a short-lived export session after the rate-limited preparation step'
);

select is(
  public.get_organization_export_page(
    (select organization_a_export_session_id from improvement_sixteen_context),
    'organization',
    null
  ) -> 'records' -> 0 ->> 'id',
  (select organization_a_id::text from improvement_sixteen_context),
  'an export page contains only the prepared owner organization'
);

set local request.jwt.claim.sub = '16222222-2222-4222-8222-222222222222';

select throws_ok(
  format(
    $$select public.get_organization_export_page(%L::uuid, 'organization', null)$$,
    (select organization_a_export_session_id from improvement_sixteen_context)
  ),
  '42501',
  'The organization export session is missing or has expired.',
  'another organization owner cannot reuse an export session'
);

set local request.jwt.claim.sub = '16111111-1111-4111-8111-111111111111';

select lives_ok(
  format(
    $$select public.manage_organization_lifecycle(%L::uuid, 'SUSPEND', 'Temporary tenant security check')$$,
    (select organization_a_id from improvement_sixteen_context)
  ),
  'owner can suspend an organization non-destructively'
);

select is(
  (select status from public.organizations where id = (select organization_a_id from improvement_sixteen_context)),
  'suspended',
  'suspension status is visible to the organization owner'
);

select is(
  (select count(*) from public.stores where organization_id = (select organization_a_id from improvement_sixteen_context)),
  0::bigint,
  'suspension removes normal tenant table access even for the owner'
);

select is(
  public.get_organization_export_page(
    (select organization_a_export_session_id from improvement_sixteen_context),
    'organization',
    null
  ) -> 'records' -> 0 ->> 'id',
  (select organization_a_id::text from improvement_sixteen_context),
  'the owner can still retrieve the already-prepared archive/export capability while suspended'
);

select lives_ok(
  format(
    $$select public.manage_organization_lifecycle(%L::uuid, 'RESUME', null)$$,
    (select organization_a_id from improvement_sixteen_context)
  ),
  'owner can resume a suspended organization'
);

select lives_ok(
  format(
    $$select public.manage_organization_lifecycle(%L::uuid, 'REQUEST_ARCHIVE', 'Business closed; retain records safely')$$,
    (select organization_a_id from improvement_sixteen_context)
  ),
  'owner can start the non-destructive archive workflow'
);

update improvement_sixteen_context context
set organization_a_archive_export_session_id = (
  select (public.prepare_organization_export(context.organization_a_id) ->> 'export_session_id')::uuid
);

select ok(
  (select organization_a_archive_export_session_id is not null from improvement_sixteen_context),
  'owner can prepare a fresh export after requesting archive'
);

select lives_ok(
  $$select public.complete_organization_export(
    (select organization_a_archive_export_session_id from improvement_sixteen_context),
    1,
    jsonb_build_object('format', 'tindio-organization-ndjson-v2', 'sections', jsonb_build_object('organization', 1))
  )$$,
  'the fresh archive export is recorded only after its server delivery completes'
);

select lives_ok(
  format(
    $$select public.manage_organization_lifecycle(%L::uuid, 'ARCHIVE', null)$$,
    (select organization_a_id from improvement_sixteen_context)
  ),
  'organization archives only after an archive request and a fresh export'
);

select is(
  (select status from public.organizations where id = (select organization_a_id from improvement_sixteen_context)),
  'archived',
  'archive workflow marks the tenant archived rather than deleting it'
);

reset role;

select is(
  (select count(*) from public.stores where organization_id = (select organization_a_id from improvement_sixteen_context)),
  1::bigint,
  'archiving retains the original operational records for recovery and audit'
);

select * from finish();

rollback;
