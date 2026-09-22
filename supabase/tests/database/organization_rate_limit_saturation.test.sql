begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

insert into auth.users (
  id,
  email,
  raw_user_meta_data
)
values (
  '94949494-9494-4494-8494-949494949494',
  'phase14-export-limit-owner@tindio.test',
  '{"full_name":"Phase 14 Export Limit Owner"}'::jsonb
);

create temporary table phase14_export_limit_context (
  organization_id uuid not null,
  first_result jsonb,
  second_result jsonb,
  third_result jsonb,
  fourth_result jsonb,
  fifth_result jsonb
);

grant select, insert, update
on phase14_export_limit_context
to authenticated;

set local role authenticated;

set local request.jwt.claim.sub =
  '94949494-9494-4494-8494-949494949494';

insert into phase14_export_limit_context (
  organization_id
)
select organization_id
from public.bootstrap_organization(
  'Phase 14 Export Limit',
  'Main',
  'Counter'
);

update phase14_export_limit_context
set first_result =
  public.prepare_organization_export(
    organization_id
  );

update phase14_export_limit_context
set second_result =
  public.prepare_organization_export(
    organization_id
  );

update phase14_export_limit_context
set third_result =
  public.prepare_organization_export(
    organization_id
  );

update phase14_export_limit_context
set fourth_result =
  public.prepare_organization_export(
    organization_id
  );

update phase14_export_limit_context
set fifth_result =
  public.prepare_organization_export(
    organization_id
  );

select is(
  (select first_result ->> 'allowed' from phase14_export_limit_context),
  'true',
  'first organization export request is allowed'
);

select is(
  (select first_result ->> 'remaining' from phase14_export_limit_context),
  '2',
  'first organization export leaves two slots'
);

select is(
  (select second_result ->> 'allowed' from phase14_export_limit_context),
  'true',
  'second organization export request is allowed'
);

select is(
  (select second_result ->> 'remaining' from phase14_export_limit_context),
  '1',
  'second organization export leaves one slot'
);

select is(
  (select third_result ->> 'allowed' from phase14_export_limit_context),
  'true',
  'third organization export request is allowed'
);

select is(
  (select third_result ->> 'remaining' from phase14_export_limit_context),
  '0',
  'third organization export consumes the final slot'
);

select is(
  (select fourth_result ->> 'allowed' from phase14_export_limit_context),
  'false',
  'fourth organization export request is rate limited'
);

select is(
  (select fourth_result ->> 'remaining' from phase14_export_limit_context),
  '0',
  'fourth organization export does not create another slot'
);

select ok(
  not (
    select fourth_result ? 'export_session_id'
    from phase14_export_limit_context
  ),
  'rate-limited fourth request does not create an export session'
);

select is(
  (select fifth_result ->> 'allowed' from phase14_export_limit_context),
  'false',
  'later requests remain rate limited after saturation'
);

select ok(
  (
    select
      (fourth_result ->> 'retry_after_seconds')::integer
        between 0 and 3600
    from phase14_export_limit_context
  ),
  'rate-limited response preserves retry-after guidance'
);

reset role;

select is(
  (
    select request_count
    from public.organization_rate_limit_windows rate_window
    where rate_window.organization_id =
      (select organization_id from phase14_export_limit_context)
      and rate_window.profile_id =
        '94949494-9494-4494-8494-949494949494'
      and rate_window.action_code =
        'organization.export'
    order by rate_window.window_started_at desc
    limit 1
  ),
  3,
  'stored organization-export request count remains capped at three'
);

select is(
  (
    select count(*)
    from public.organization_export_sessions export_session
    where export_session.organization_id =
      (select organization_id from phase14_export_limit_context)
      and export_session.profile_id =
        '94949494-9494-4494-8494-949494949494'
  ),
  3::bigint,
  'only the three allowed requests create export sessions'
);

select * from finish();

rollback;
