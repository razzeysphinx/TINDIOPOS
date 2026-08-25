-- Improvement Phase 17: backups, recovery, and data-governance controls.
--
-- TINDIO keeps the authoritative database backup operation outside the product:
-- a restore can overwrite a whole Supabase project and must be performed by a
-- platform administrator in a planned recovery window. This migration makes
-- the application-side controls honest and auditable instead: it records a
-- fully delivered tenant export, enforces that delivery before tenant archive,
-- records recovery drills, and establishes non-destructive retention defaults.

begin;

insert into public.permissions (code, category, name, description)
values
  ('recovery.view', 'Management', 'View backup and recovery readiness', 'View tenant export, recovery-drill, and retention readiness.'),
  ('recovery.manage', 'Management', 'Record recovery verification', 'Record an owner-authorized backup or recovery drill after it has been tested.')
on conflict (code) do update
set
  category = excluded.category,
  name = excluded.name,
  description = excluded.description;

-- Recovery readiness is visible to the same least-privilege owner/admin group
-- that may access an organization export. Recording a recovery drill remains
-- owner-only by default.
insert into public.role_permissions (organization_id, role_id, permission_code)
select role.organization_id, role.id, permission.code
from public.roles role
join public.permissions permission
  on permission.code in ('recovery.view', 'recovery.manage')
where role.code = 'owner'
on conflict do nothing;

insert into public.role_permissions (organization_id, role_id, permission_code)
select role.organization_id, role.id, 'recovery.view'
from public.roles role
where role.code = 'admin'
on conflict do nothing;

-- The Phase 16 bootstrap trigger supplies later permissions to its starter
-- roles. Keep the recovery-management permission out of the Admin default so
-- only the Owner receives it unless the organization deliberately changes RBAC.
create or replace function private.seed_system_role_permission_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.role_permissions (organization_id, role_id, permission_code)
  select role.organization_id, role.id, permission.code
  from public.roles role
  join public.permissions permission on true
  where role.organization_id = new.organization_id
    and role.is_system
    and ((role.code = 'owner')
     or (role.code = 'admin' and permission.code not in (
       'organization.manage', 'organization.archive', 'organization.lifecycle',
       'recovery.manage'
     ))
     or (role.code = 'manager' and permission.code in (
       'sales.create', 'sales.refund', 'discounts.apply', 'prices.override',
       'receipts.view', 'receipts.reprint', 'shifts.open', 'shifts.close',
       'cash.pay_in', 'cash.pay_out', 'products.manage', 'products.view_cost',
       'inventory.manage', 'customers.manage', 'employees.manage', 'reports.view',
       'registers.manage', 'dashboard.view', 'kitchen.view', 'kitchen.manage',
       'pos.access', 'pos.edit_quantity', 'pos.remove_item', 'payments.accept',
       'tickets.manage', 'cash_drawer.open', 'shifts.view_expected_cash',
       'shifts.view_history', 'shifts.force_close', 'inventory.view',
       'inventory.adjust', 'inventory.count', 'inventory.receive',
       'inventory.purchase_orders', 'inventory.transfers', 'inventory.suppliers',
       'approvals.request', 'approvals.authorize', 'audit.view'
     ))
     or (role.code = 'cashier' and permission.code in (
       'sales.create', 'discounts.apply', 'receipts.view', 'receipts.reprint',
       'shifts.open', 'shifts.close', 'cash.pay_in', 'cash.pay_out', 'pos.access',
       'pos.edit_quantity', 'pos.remove_item', 'payments.accept', 'approvals.request'
     ))
     or (role.code = 'inventory_staff' and permission.code in (
       'products.manage', 'products.view_cost', 'inventory.manage', 'inventory.view',
       'inventory.adjust', 'inventory.count', 'inventory.receive',
       'inventory.purchase_orders', 'inventory.transfers', 'inventory.suppliers',
       'approvals.request'
     )))
  on conflict do nothing;

  return new;
end;
$$;

create table private.organization_data_governance (
  organization_id uuid primary key references public.organizations (id) on delete restrict,
  audit_retention_days integer not null default 2555,
  archived_data_retention_days integer not null default 2555,
  automatic_purge_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_data_governance_audit_retention_check check (audit_retention_days >= 365),
  constraint organization_data_governance_archive_retention_check check (archived_data_retention_days >= 365),
  constraint organization_data_governance_no_automatic_purge_check check (automatic_purge_enabled is false)
);

create table private.organization_recovery_drills (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  actor_employee_id uuid not null,
  drill_type text not null,
  outcome text not null,
  recovery_point_at timestamptz not null,
  duration_minutes integer not null,
  notes text not null,
  created_at timestamptz not null default now(),
  constraint organization_recovery_drills_actor_fkey foreign key (actor_employee_id, organization_id)
    references public.employees (id, organization_id) on delete restrict,
  constraint organization_recovery_drills_type_check check (
    drill_type in ('EXPORT_REVIEW', 'LOCAL_RESTORE', 'SUPABASE_RESTORE_OR_CLONE')
  ),
  constraint organization_recovery_drills_outcome_check check (outcome in ('PASSED', 'FAILED')),
  constraint organization_recovery_drills_recovery_point_check check (recovery_point_at <= created_at),
  constraint organization_recovery_drills_duration_check check (duration_minutes between 0 and 10080),
  constraint organization_recovery_drills_notes_check check (char_length(notes) between 10 and 1000)
);

create index organization_recovery_drills_organization_created_idx
  on private.organization_recovery_drills (organization_id, created_at desc);

alter table private.organization_data_governance enable row level security;
alter table private.organization_recovery_drills enable row level security;

revoke all on table private.organization_data_governance from public, anon, authenticated, service_role;
revoke all on table private.organization_recovery_drills from public, anon, authenticated, service_role;

insert into private.organization_data_governance (organization_id)
select organization.id
from public.organizations organization
on conflict (organization_id) do nothing;

create or replace function private.seed_organization_data_governance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.organization_data_governance (organization_id)
  values (new.id)
  on conflict (organization_id) do nothing;

  return new;
end;
$$;

drop trigger if exists organizations_seed_data_governance on public.organizations;
create trigger organizations_seed_data_governance
after insert on public.organizations
for each row execute function private.seed_organization_data_governance();

create or replace function private.prevent_organization_recovery_drill_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Recovery-drill records are immutable. Record a new drill instead.' using errcode = '55000';
end;
$$;

drop trigger if exists organization_recovery_drills_immutable on private.organization_recovery_drills;
create trigger organization_recovery_drills_immutable
before update or delete on private.organization_recovery_drills
for each row execute function private.prevent_organization_recovery_drill_mutation();

alter table public.organization_export_sessions
  add column if not exists delivered_at timestamptz,
  add column if not exists delivered_record_count integer,
  add column if not exists delivery_manifest jsonb not null default '{}'::jsonb;

alter table public.organization_export_sessions
  drop constraint if exists organization_export_sessions_delivery_check,
  add constraint organization_export_sessions_delivery_check check (
    (delivered_at is null and delivered_record_count is null and delivery_manifest = '{}'::jsonb)
    or (
      delivered_at is not null
      and delivered_record_count between 1 and 50000000
      and jsonb_typeof(delivery_manifest) = 'object'
      and delivery_manifest ? 'format'
      and delivery_manifest ? 'sections'
    )
  );

create index if not exists organization_export_sessions_delivered_idx
  on public.organization_export_sessions (organization_id, delivered_at desc)
  where delivered_at is not null;

alter table public.organization_rate_limit_windows
  drop constraint if exists organization_rate_limit_windows_action_values,
  add constraint organization_rate_limit_windows_action_values check (
    action_code in ('organization.export', 'organization.lifecycle', 'organization.recovery_drill')
  );

create or replace function private.has_organization_recovery_view_access(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.employees employee
      join public.employee_roles employee_role
        on employee_role.employee_id = employee.id
       and employee_role.organization_id = employee.organization_id
      join public.role_permissions role_permission
        on role_permission.role_id = employee_role.role_id
       and role_permission.organization_id = employee_role.organization_id
      where employee.organization_id = target_organization_id
        and employee.profile_id = (select auth.uid())
        and employee.status = 'active'
        and role_permission.permission_code in (
          'recovery.view', 'recovery.manage'
        )
    ),
    false
  );
$$;

create or replace function private.has_organization_recovery_manage_access(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.employees employee
      join public.employee_roles employee_role
        on employee_role.employee_id = employee.id
       and employee_role.organization_id = employee.organization_id
      join public.role_permissions role_permission
        on role_permission.role_id = employee_role.role_id
       and role_permission.organization_id = employee_role.organization_id
      where employee.organization_id = target_organization_id
        and employee.profile_id = (select auth.uid())
        and employee.status = 'active'
        and role_permission.permission_code = 'recovery.manage'
    ),
    false
  );
$$;

create or replace function private.current_organization_member_employee_id(target_organization_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select employee.id
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active'
  order by employee.created_at
  limit 1;
$$;

create or replace function private.consume_organization_rate_limit(
  target_organization_id uuid,
  target_action_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_action_code text := lower(btrim(coalesce(target_action_code, '')));
  configured_limit integer;
  current_window_start timestamptz := date_trunc('hour', clock_timestamp());
  current_window_ends_at timestamptz;
  observed_request_count integer;
begin
  case normalized_action_code
    when 'organization.export' then
      configured_limit := 3;
      if not private.has_organization_export_access(target_organization_id) then
        raise exception 'You do not have permission to export this organization.' using errcode = '42501';
      end if;
    when 'organization.lifecycle' then
      configured_limit := 10;
      if not private.has_organization_lifecycle_access(target_organization_id) then
        raise exception 'Only an organization owner can change this lifecycle.' using errcode = '42501';
      end if;
    when 'organization.recovery_drill' then
      configured_limit := 10;
      if not private.has_organization_recovery_manage_access(target_organization_id) then
        raise exception 'Only an owner can record a recovery drill.' using errcode = '42501';
      end if;
    else
      raise exception 'Unsupported organization rate-limit action.' using errcode = '22023';
  end case;

  current_window_ends_at := current_window_start + interval '1 hour';

  delete from public.organization_rate_limit_windows rate_window
  where rate_window.window_started_at < current_window_start - interval '2 days';

  insert into public.organization_rate_limit_windows (
    organization_id,
    profile_id,
    action_code,
    window_started_at,
    request_count
  )
  values (
    target_organization_id,
    (select auth.uid()),
    normalized_action_code,
    current_window_start,
    1
  )
  on conflict (organization_id, profile_id, action_code, window_started_at)
  do update
    set request_count = public.organization_rate_limit_windows.request_count + 1,
        updated_at = now()
  where public.organization_rate_limit_windows.request_count < configured_limit
  returning request_count into observed_request_count;

  if observed_request_count is null then
    select rate_window.request_count
    into observed_request_count
    from public.organization_rate_limit_windows rate_window
    where rate_window.organization_id = target_organization_id
      and rate_window.profile_id = (select auth.uid())
      and rate_window.action_code = normalized_action_code
      and rate_window.window_started_at = current_window_start;
  end if;

  return jsonb_build_object(
    'allowed', coalesce(observed_request_count, configured_limit) <= configured_limit,
    'limit', configured_limit,
    'remaining', greatest(configured_limit - coalesce(observed_request_count, configured_limit), 0),
    'retry_after_seconds', greatest(
      floor(extract(epoch from current_window_ends_at - clock_timestamp()))::integer,
      0
    )
  );
end;
$$;

create or replace function private.complete_organization_export(
  target_export_session_id uuid,
  target_record_count integer,
  target_manifest jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  export_session public.organization_export_sessions%rowtype;
  actor_employee_id uuid;
begin
  if target_record_count not between 1 and 50000000
    or jsonb_typeof(target_manifest) <> 'object'
    or not (target_manifest ? 'format')
    or not (target_manifest ? 'sections') then
    raise exception 'Export delivery details are invalid.' using errcode = '22023';
  end if;

  select session.*
  into export_session
  from public.organization_export_sessions session
  where session.id = target_export_session_id
    and session.profile_id = (select auth.uid())
    and session.expires_at > now()
  for update;

  if not found then
    raise exception 'The organization export session is missing or has expired.' using errcode = '42501';
  end if;

  if not private.has_organization_export_access(export_session.organization_id) then
    raise exception 'You do not have permission to export this organization.' using errcode = '42501';
  end if;

  if export_session.delivered_at is not null then
    return jsonb_build_object(
      'export_session_id', export_session.id,
      'delivered_at', export_session.delivered_at,
      'record_count', export_session.delivered_record_count,
      'was_replayed', true
    );
  end if;

  update public.organization_export_sessions session
  set
    delivered_at = now(),
    delivered_record_count = target_record_count,
    delivery_manifest = target_manifest
  where session.id = export_session.id;

  actor_employee_id := private.current_organization_member_employee_id(export_session.organization_id);

  perform private.write_audit_log(
    export_session.organization_id,
    'ORGANIZATION_EXPORT_DELIVERED',
    'organization.export',
    actor_employee_id,
    null,
    null,
    null,
    null,
    null,
    null,
    jsonb_build_object(
      'export_session_id', export_session.id,
      'record_count', target_record_count,
      'format', target_manifest ->> 'format'
    )
  );

  return jsonb_build_object(
    'export_session_id', export_session.id,
    'delivered_at', now(),
    'record_count', target_record_count,
    'was_replayed', false
  );
end;
$$;

create or replace function public.complete_organization_export(
  target_export_session_id uuid,
  target_record_count integer,
  target_manifest jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.complete_organization_export(
    target_export_session_id,
    target_record_count,
    target_manifest
  );
$$;

create or replace function private.assert_archive_export_delivered()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'archived' and old.status is distinct from 'archived' then
    if old.archive_requested_at is null then
      raise exception 'Request an archive before archiving this organization.' using errcode = '22023';
    end if;

    if not exists (
      select 1
      from public.organization_export_sessions export_session
      where export_session.organization_id = new.id
        and export_session.delivered_at is not null
        and export_session.delivered_at >= old.archive_requested_at
    ) then
      raise exception 'Download and complete a fresh organization export before archiving this organization.' using errcode = '22023';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists organizations_archive_export_delivered on public.organizations;
create trigger organizations_archive_export_delivered
before update of status on public.organizations
for each row execute function private.assert_archive_export_delivered();

create or replace function public.get_organization_recovery_snapshot(target_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  governance private.organization_data_governance%rowtype;
  latest_export public.organization_export_sessions%rowtype;
  latest_drill private.organization_recovery_drills%rowtype;
  archive_export_is_current boolean;
  organization_record public.organizations%rowtype;
begin
  if not private.has_organization_recovery_view_access(target_organization_id) then
    raise exception 'You do not have permission to view backup and recovery readiness.' using errcode = '42501';
  end if;

  select organization.*
  into organization_record
  from public.organizations organization
  where organization.id = target_organization_id;

  if not found then
    raise exception 'Organization was not found.' using errcode = 'P0002';
  end if;

  select *
  into governance
  from private.organization_data_governance
  where organization_id = target_organization_id;

  select *
  into latest_export
  from public.organization_export_sessions export_session
  where export_session.organization_id = target_organization_id
    and export_session.delivered_at is not null
  order by export_session.delivered_at desc
  limit 1;

  select *
  into latest_drill
  from private.organization_recovery_drills drill
  where drill.organization_id = target_organization_id
  order by drill.created_at desc
  limit 1;

  archive_export_is_current := organization_record.archive_requested_at is null
    or exists (
      select 1
      from public.organization_export_sessions export_session
      where export_session.organization_id = target_organization_id
        and export_session.delivered_at is not null
        and export_session.delivered_at >= organization_record.archive_requested_at
    );

  return jsonb_build_object(
    'governance', jsonb_build_object(
      'audit_retention_days', governance.audit_retention_days,
      'archived_data_retention_days', governance.archived_data_retention_days,
      'automatic_purge_enabled', governance.automatic_purge_enabled
    ),
    'latest_delivered_export', case
      when latest_export.id is null then null
      else jsonb_build_object(
        'delivered_at', latest_export.delivered_at,
        'record_count', latest_export.delivered_record_count,
        'format', latest_export.delivery_manifest ->> 'format'
      )
    end,
    'latest_recovery_drill', case
      when latest_drill.id is null then null
      else jsonb_build_object(
        'drill_type', latest_drill.drill_type,
        'outcome', latest_drill.outcome,
        'recovery_point_at', latest_drill.recovery_point_at,
        'duration_minutes', latest_drill.duration_minutes,
        'notes', latest_drill.notes,
        'recorded_at', latest_drill.created_at
      )
    end,
    'archive_export_is_current', archive_export_is_current
  );
end;
$$;

create or replace function public.record_organization_recovery_drill(
  target_organization_id uuid,
  target_drill_type text,
  target_outcome text,
  target_recovery_point_at timestamptz,
  target_duration_minutes integer,
  target_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_drill_type text := upper(btrim(coalesce(target_drill_type, '')));
  normalized_outcome text := upper(btrim(coalesce(target_outcome, '')));
  normalized_notes text := btrim(coalesce(target_notes, ''));
  actor_employee_id uuid;
  rate_limit_result jsonb;
  drill_record private.organization_recovery_drills%rowtype;
begin
  if not private.has_organization_recovery_manage_access(target_organization_id) then
    raise exception 'Only an owner can record a recovery drill.' using errcode = '42501';
  end if;

  if normalized_drill_type not in ('EXPORT_REVIEW', 'LOCAL_RESTORE', 'SUPABASE_RESTORE_OR_CLONE')
    or normalized_outcome not in ('PASSED', 'FAILED')
    or target_recovery_point_at is null
    or target_recovery_point_at > now()
    or target_duration_minutes is null
    or target_duration_minutes not between 0 and 10080
    or char_length(normalized_notes) not between 10 and 1000 then
    raise exception 'Recovery-drill details are invalid.' using errcode = '22023';
  end if;

  rate_limit_result := private.consume_organization_rate_limit(
    target_organization_id,
    'organization.recovery_drill'
  );

  if not coalesce((rate_limit_result ->> 'allowed')::boolean, false) then
    return rate_limit_result;
  end if;

  actor_employee_id := private.current_organization_member_employee_id(target_organization_id);

  if actor_employee_id is null then
    raise exception 'An active organization employee is required.' using errcode = '42501';
  end if;

  insert into private.organization_recovery_drills (
    organization_id,
    actor_employee_id,
    drill_type,
    outcome,
    recovery_point_at,
    duration_minutes,
    notes
  )
  values (
    target_organization_id,
    actor_employee_id,
    normalized_drill_type,
    normalized_outcome,
    target_recovery_point_at,
    target_duration_minutes,
    normalized_notes
  )
  returning * into drill_record;

  perform private.write_audit_log(
    target_organization_id,
    'ORGANIZATION_RECOVERY_DRILL_RECORDED',
    'recovery.manage',
    actor_employee_id,
    null,
    null,
    null,
    null,
    null,
    normalized_notes,
    jsonb_build_object(
      'drill_id', drill_record.id,
      'drill_type', drill_record.drill_type,
      'outcome', drill_record.outcome,
      'recovery_point_at', drill_record.recovery_point_at,
      'duration_minutes', drill_record.duration_minutes
    )
  );

  return rate_limit_result || jsonb_build_object(
    'drill_id', drill_record.id,
    'recorded_at', drill_record.created_at,
    'outcome', drill_record.outcome
  );
end;
$$;

-- The paused-business page uses this minimal capability response. It lets an
-- owner complete governance work while normal operational data remains blocked.
create or replace function public.get_organization_readiness_access(target_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_organization_membership(target_organization_id) then
    raise exception 'You do not have access to this organization.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'can_export', private.has_organization_export_access(target_organization_id),
    'can_manage_lifecycle', private.has_organization_lifecycle_access(target_organization_id),
    'can_view_recovery', private.has_organization_recovery_view_access(target_organization_id),
    'can_manage_recovery', private.has_organization_recovery_manage_access(target_organization_id)
  );
end;
$$;

revoke execute on function private.seed_organization_data_governance() from public, anon, authenticated, service_role;
revoke execute on function private.prevent_organization_recovery_drill_mutation() from public, anon, authenticated, service_role;
revoke execute on function private.has_organization_recovery_view_access(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.has_organization_recovery_manage_access(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.current_organization_member_employee_id(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.complete_organization_export(uuid, integer, jsonb) from public, anon, authenticated, service_role;
revoke execute on function private.assert_archive_export_delivered() from public, anon, authenticated, service_role;
revoke execute on function public.complete_organization_export(uuid, integer, jsonb) from public, anon, service_role;
revoke execute on function public.get_organization_recovery_snapshot(uuid) from public, anon, service_role;
revoke execute on function public.record_organization_recovery_drill(uuid, text, text, timestamptz, integer, text) from public, anon, service_role;

grant execute on function public.complete_organization_export(uuid, integer, jsonb) to authenticated;
grant execute on function public.get_organization_recovery_snapshot(uuid) to authenticated;
grant execute on function public.record_organization_recovery_drill(uuid, text, text, timestamptz, integer, text) to authenticated;

comment on table private.organization_data_governance is 'Tenant governance defaults: seven-year minimum audit and archive retention with automatic destructive purge disabled.';
comment on table private.organization_recovery_drills is 'Immutable, owner-authorized evidence of a manually performed export review or recovery drill.';
comment on function public.complete_organization_export(uuid, integer, jsonb) is 'Marks a tenant export as fully delivered by the server stream. The record proves delivery, not that the user retained an off-site copy.';
comment on function public.get_organization_recovery_snapshot(uuid) is 'Returns only authorized tenant backup, recovery-drill, and retention readiness summary.';

notify pgrst, 'reload schema';

commit;
