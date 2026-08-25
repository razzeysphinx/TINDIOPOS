begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

select ok(to_regclass('private.organization_data_governance') is not null, 'organization data-governance table exists');
select ok(to_regclass('private.organization_recovery_drills') is not null, 'organization recovery-drills table exists');
select ok((select relrowsecurity from pg_class where oid = 'private.organization_data_governance'::regclass), 'data-governance rows have RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'private.organization_recovery_drills'::regclass), 'recovery-drill rows have RLS enabled');
select ok(not has_table_privilege('authenticated', 'private.organization_data_governance', 'select'), 'authenticated users cannot read data-governance rows directly');
select ok(not has_table_privilege('authenticated', 'private.organization_recovery_drills', 'select'), 'authenticated users cannot read recovery-drill rows directly');
select ok(to_regprocedure('public.complete_organization_export(uuid,integer,jsonb)') is not null, 'export-delivery completion routine exists');
select ok(to_regprocedure('public.get_organization_recovery_snapshot(uuid)') is not null, 'recovery-readiness routine exists');
select ok(to_regprocedure('public.record_organization_recovery_drill(uuid,text,text,timestamp with time zone,integer,text)') is not null, 'recovery-drill routine exists');

insert into auth.users (id, email, raw_user_meta_data)
values
  ('17111111-1111-4111-8111-111111111111', 'phase-seventeen-owner-a@tindio.test', '{"full_name":"Phase Seventeen Owner A"}'::jsonb),
  ('17222222-2222-4222-8222-222222222222', 'phase-seventeen-owner-b@tindio.test', '{"full_name":"Phase Seventeen Owner B"}'::jsonb);

create temporary table improvement_seventeen_context (
  organization_a_id uuid,
  organization_b_id uuid,
  export_session_id uuid,
  archive_export_session_id uuid
);

grant select, insert, update on improvement_seventeen_context to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '17111111-1111-4111-8111-111111111111';

insert into improvement_seventeen_context (organization_a_id)
select organization_id
from public.bootstrap_organization('Phase Seventeen Alpha', 'Alpha Main', 'Alpha Counter');

select is(
  public.get_organization_recovery_snapshot((select organization_a_id from improvement_seventeen_context))
    -> 'governance' ->> 'audit_retention_days',
  '2555',
  'owner sees the audit retention minimum through the authorized snapshot'
);

select is(
  public.get_organization_recovery_snapshot((select organization_a_id from improvement_seventeen_context))
    ->> 'latest_delivered_export',
  null,
  'a new organization does not falsely report a delivered export'
);

update improvement_seventeen_context context
set export_session_id = (
  select (public.prepare_organization_export(context.organization_a_id) ->> 'export_session_id')::uuid
);

select ok(
  (select export_session_id is not null from improvement_seventeen_context),
  'owner can prepare a tenant-scoped export session'
);

select lives_ok(
  $$select public.get_organization_export_page(
    (select export_session_id from improvement_seventeen_context),
    'organization',
    null
  )$$,
  'owner can retrieve the export content before delivery is recorded'
);

select lives_ok(
  $$select public.complete_organization_export(
    (select export_session_id from improvement_seventeen_context),
    1,
    jsonb_build_object(
      'format', 'tindio-organization-ndjson-v2',
      'sections', jsonb_build_object('organization', 1)
    )
  )$$,
  'owner can record a fully delivered export stream'
);

select is(
  public.get_organization_recovery_snapshot((select organization_a_id from improvement_seventeen_context))
    -> 'latest_delivered_export' ->> 'record_count',
  '1',
  'recovery snapshot reports the delivered export record count'
);

select ok(
  exists (
    select 1
    from public.audit_logs audit_log
    where audit_log.organization_id = (select organization_a_id from improvement_seventeen_context)
      and audit_log.event_type = 'ORGANIZATION_EXPORT_DELIVERED'
  ),
  'export delivery is written to the audit log'
);

select lives_ok(
  $$select public.record_organization_recovery_drill(
    (select organization_a_id from improvement_seventeen_context),
    'LOCAL_RESTORE',
    'PASSED',
    now() - interval '5 minutes',
    12,
    'Restored the tenant export into an isolated local verification database.'
  )$$,
  'owner can record a manually completed local recovery drill'
);

select is(
  public.get_organization_recovery_snapshot((select organization_a_id from improvement_seventeen_context))
    -> 'latest_recovery_drill' ->> 'outcome',
  'PASSED',
  'recovery snapshot returns the latest drill outcome'
);

select throws_ok(
  $$select public.record_organization_recovery_drill(
    (select organization_a_id from improvement_seventeen_context),
    'LOCAL_RESTORE',
    'PASSED',
    now(),
    12,
    'short'
  )$$,
  '22023',
  'Recovery-drill details are invalid.',
  'invalid recovery-drill notes are rejected'
);

select lives_ok(
  $$select public.manage_organization_lifecycle(
    (select organization_a_id from improvement_seventeen_context),
    'REQUEST_ARCHIVE',
    'Phase Seventeen archive delivery enforcement check'
  )$$,
  'owner can request a tenant archive'
);

update improvement_seventeen_context context
set archive_export_session_id = (
  select (public.prepare_organization_export(context.organization_a_id) ->> 'export_session_id')::uuid
);

select throws_ok(
  $$select public.manage_organization_lifecycle(
    (select organization_a_id from improvement_seventeen_context),
    'ARCHIVE',
    null
  )$$,
  '22023',
  'Download and complete a fresh organization export before archiving this organization.',
  'an archive is rejected when an export was merely prepared but not delivered'
);

select lives_ok(
  $$select public.complete_organization_export(
    (select archive_export_session_id from improvement_seventeen_context),
    1,
    jsonb_build_object(
      'format', 'tindio-organization-ndjson-v2',
      'sections', jsonb_build_object('organization', 1)
    )
  )$$,
  'the fresh archive export can be marked delivered'
);

select lives_ok(
  $$select public.manage_organization_lifecycle(
    (select organization_a_id from improvement_seventeen_context),
    'ARCHIVE',
    null
  )$$,
  'archive succeeds after the fresh export delivery is recorded'
);

select is(
  (select status from public.organizations where id = (select organization_a_id from improvement_seventeen_context)),
  'archived',
  'archive remains non-destructive after delivery enforcement'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '17222222-2222-4222-8222-222222222222';

update improvement_seventeen_context context
set organization_b_id = created.organization_id
from public.bootstrap_organization('Phase Seventeen Bravo', 'Bravo Main', 'Bravo Counter') created;

select throws_ok(
  format(
    $$select public.get_organization_recovery_snapshot(%L::uuid)$$,
    (select organization_a_id from improvement_seventeen_context)
  ),
  '42501',
  'You do not have permission to view backup and recovery readiness.',
  'another tenant owner cannot view recovery readiness'
);

select throws_ok(
  format(
    $$select public.complete_organization_export(
      %L::uuid,
      1,
      jsonb_build_object('format', 'tindio-organization-ndjson-v2', 'sections', jsonb_build_object('organization', 1))
    )$$,
    (select export_session_id from improvement_seventeen_context)
  ),
  '42501',
  'The organization export session is missing or has expired.',
  'another tenant owner cannot mark a different organization export delivered'
);

reset role;

select ok(
  exists (
    select 1
    from private.organization_data_governance governance
    where governance.organization_id = (select organization_a_id from improvement_seventeen_context)
      and governance.audit_retention_days = 2555
      and governance.archived_data_retention_days = 2555
      and governance.automatic_purge_enabled is false
  ),
  'new organization receives non-destructive seven-year governance defaults'
);

select ok(
  exists (
    select 1
    from private.organization_recovery_drills drill
    where drill.organization_id = (select organization_a_id from improvement_seventeen_context)
      and drill.outcome = 'PASSED'
  ),
  'recovery-drill evidence remains retained after the organization is archived'
);

select * from finish();

rollback;
