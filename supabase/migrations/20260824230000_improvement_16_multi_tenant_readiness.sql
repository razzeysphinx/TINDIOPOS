-- Improvement Phase 16: multi-tenant and public-readiness controls.
--
-- This migration keeps organizations as hard tenant boundaries. It adds a
-- non-destructive lifecycle, owner-controlled data export, server-enforced
-- limits for high-impact tenant operations, and durable daily usage signals.
-- Operational writes are additionally guarded at the table boundary so a
-- suspended or archived organization cannot be changed through a forgotten
-- RPC or direct Data API request.

begin;

alter table public.organizations
  add column if not exists status text not null default 'active',
  add column if not exists suspended_at timestamptz,
  add column if not exists suspension_reason text,
  add column if not exists archive_requested_at timestamptz,
  add column if not exists archive_requested_by_employee_id uuid,
  add column if not exists archived_at timestamptz;

alter table public.organizations
  drop constraint if exists organizations_status_values,
  add constraint organizations_status_values check (status in ('active', 'suspended', 'archived')),
  add constraint organizations_suspension_reason_length check (
    suspension_reason is null or char_length(suspension_reason) between 3 and 500
  ),
  add constraint organizations_archive_request_actor_fkey foreign key (archive_requested_by_employee_id, id)
    references public.employees (id, organization_id) on delete restrict,
  add constraint organizations_archived_at_requires_archived_status check (
    (status = 'archived' and archived_at is not null)
    or (status <> 'archived' and archived_at is null)
  );

create index if not exists organizations_status_created_idx
  on public.organizations (status, created_at desc);

insert into public.permissions (code, category, name, description)
values
  ('organization.export', 'Management', 'Export organization data', 'Create a rate-limited, tenant-scoped business data export.'),
  ('organization.archive', 'Management', 'Archive organization', 'Suspend, resume, or safely archive an organization after an export.'),
  ('organization.lifecycle', 'Management', 'Manage organization lifecycle', 'Request or cancel an organization archival workflow.')
on conflict (code) do update
set
  category = excluded.category,
  name = excluded.name,
  description = excluded.description;

-- Existing businesses receive the same owner/admin controls as newly created
-- organizations. The archival controls deliberately remain owner-only.
insert into public.role_permissions (organization_id, role_id, permission_code)
select role.organization_id, role.id, permission.code
from public.roles role
join public.permissions permission
  on permission.code in ('organization.export', 'organization.archive', 'organization.lifecycle')
where role.code = 'owner'
on conflict do nothing;

insert into public.role_permissions (organization_id, role_id, permission_code)
select role.organization_id, role.id, 'organization.export'
from public.roles role
where role.code = 'admin'
on conflict do nothing;

-- A membership lookup intentionally does not require the organization to be
-- operational. It is used only to show the member the organization name and
-- lifecycle status so they can switch to another business or an owner can
-- resume it. All normal data access continues through the active-only helper.
create or replace function private.has_organization_membership(target_organization_id uuid)
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
      where employee.organization_id = target_organization_id
        and employee.profile_id = (select auth.uid())
        and employee.status = 'active'
    ), false);
$$;

create or replace function private.is_organization_creator(target_organization_id uuid)
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
      from public.organizations organization
      where organization.id = target_organization_id
        and organization.created_by = (select auth.uid())
        and organization.status = 'active'
    ), false);
$$;

create or replace function private.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.employees employee
      join public.organizations organization
        on organization.id = employee.organization_id
       and organization.status = 'active'
      where employee.organization_id = target_organization_id
        and employee.profile_id = (select auth.uid())
        and employee.status = 'active'
    );
$$;

-- Replaces the Phase 1 helper while retaining its transaction-local approval
-- context. Both normal permissions and approval overrides require an active
-- organization, preventing a suspension from becoming an RLS bypass.
create or replace function private.has_permission(
  target_organization_id uuid,
  requested_permission text
)
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
      from public.organizations organization
      where organization.id = target_organization_id
        and organization.status = 'active'
    )
    and (
      exists (
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
          and role_permission.permission_code = requested_permission
      )
      or (
        current_setting('tindio.approval_profile_id', true) = (select auth.uid())::text
        and current_setting('tindio.approval_organization_id', true) = target_organization_id::text
        and current_setting('tindio.approval_permission', true) = requested_permission
      )
    ), false);
$$;

create or replace function private.current_employee_id(target_organization_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select employee.id
  from public.employees employee
  join public.organizations organization
    on organization.id = employee.organization_id
   and organization.status = 'active'
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active'
  order by employee.created_at
  limit 1;
$$;

create or replace function private.employee_has_permission(
  target_organization_id uuid,
  target_employee_id uuid,
  requested_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employees employee
    join public.organizations organization
      on organization.id = employee.organization_id
     and organization.status = 'active'
    join public.employee_roles employee_role
      on employee_role.employee_id = employee.id
     and employee_role.organization_id = employee.organization_id
    join public.role_permissions role_permission
      on role_permission.role_id = employee_role.role_id
     and role_permission.organization_id = employee_role.organization_id
    where employee.id = target_employee_id
      and employee.organization_id = target_organization_id
      and employee.status = 'active'
      and role_permission.permission_code = requested_permission
  );
$$;

create or replace function private.has_organization_export_access(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
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
        and role_permission.permission_code = 'organization.export'
    );
$$;

create or replace function private.has_organization_lifecycle_access(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
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
        and role_permission.permission_code in ('organization.archive', 'organization.lifecycle')
      group by employee.id
      having count(distinct role_permission.permission_code) = 2
    );
$$;

create table public.organization_rate_limit_windows (
  organization_id uuid not null references public.organizations (id) on delete restrict,
  profile_id uuid not null references public.profiles (id) on delete restrict,
  action_code text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, profile_id, action_code, window_started_at),
  constraint organization_rate_limit_windows_action_values check (
    action_code in ('organization.export', 'organization.lifecycle')
  ),
  constraint organization_rate_limit_windows_count_positive check (request_count > 0)
);

create index organization_rate_limit_windows_expiry_idx
  on public.organization_rate_limit_windows (window_started_at);

create table public.organization_export_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  profile_id uuid not null references public.profiles (id) on delete restrict,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint organization_export_sessions_expiry_check check (expires_at > created_at)
);

create index organization_export_sessions_profile_expiry_idx
  on public.organization_export_sessions (profile_id, expires_at desc);
create index organization_export_sessions_organization_created_idx
  on public.organization_export_sessions (organization_id, created_at desc);

create table public.organization_usage_daily (
  organization_id uuid not null references public.organizations (id) on delete restrict,
  usage_date date not null,
  active_store_count integer not null default 0,
  active_employee_count integer not null default 0,
  active_product_count integer not null default 0,
  customer_count integer not null default 0,
  completed_sale_count integer not null default 0,
  completed_sales_total_minor bigint not null default 0,
  pending_offline_sync_count integer not null default 0,
  captured_at timestamptz not null default now(),
  primary key (organization_id, usage_date),
  constraint organization_usage_daily_counts_nonnegative check (
    active_store_count >= 0
    and active_employee_count >= 0
    and active_product_count >= 0
    and customer_count >= 0
    and completed_sale_count >= 0
    and completed_sales_total_minor >= 0
    and pending_offline_sync_count >= 0
  )
);

create index organization_usage_daily_recent_idx
  on public.organization_usage_daily (organization_id, usage_date desc);

alter table public.organization_rate_limit_windows enable row level security;
alter table public.organization_export_sessions enable row level security;
alter table public.organization_usage_daily enable row level security;

revoke all on table public.organization_rate_limit_windows from public, anon, authenticated, service_role;
revoke all on table public.organization_export_sessions from public, anon, authenticated, service_role;
revoke all on table public.organization_usage_daily from public, anon, authenticated, service_role;

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
    else
      raise exception 'Unsupported organization rate-limit action.' using errcode = '22023';
  end case;

  current_window_ends_at := current_window_start + interval '1 hour';

  -- This small rolling table is self-cleaning, including organizations that
  -- are later archived. The unique key makes the increment atomic under load.
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

create or replace function private.prepare_organization_export(target_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rate_limit_result jsonb;
  export_session_id uuid;
  actor_employee_id uuid;
begin
  rate_limit_result := private.consume_organization_rate_limit(
    target_organization_id,
    'organization.export'
  );

  if not coalesce((rate_limit_result ->> 'allowed')::boolean, false) then
    return rate_limit_result;
  end if;

  delete from public.organization_export_sessions session
  where session.expires_at <= now();

  insert into public.organization_export_sessions (organization_id, profile_id, expires_at)
  values (target_organization_id, (select auth.uid()), now() + interval '1 hour')
  returning id into export_session_id;

  select employee.id
  into actor_employee_id
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active'
  order by employee.created_at
  limit 1;

  perform private.write_audit_log(
    target_organization_id,
    'ORGANIZATION_EXPORT_PREPARED',
    'organization.export',
    actor_employee_id,
    null,
    null,
    null,
    null,
    null,
    null,
    jsonb_build_object('expires_at', now() + interval '1 hour')
  );

  return rate_limit_result || jsonb_build_object(
    'export_session_id', export_session_id,
    'expires_at', now() + interval '1 hour'
  );
end;
$$;

create or replace function public.prepare_organization_export(target_organization_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.prepare_organization_export(target_organization_id);
$$;

create or replace function public.get_organization_export_page(
  target_export_session_id uuid,
  target_section text,
  target_after_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  export_session public.organization_export_sessions%rowtype;
  normalized_section text := lower(btrim(coalesce(target_section, '')));
  source_table text;
  source_predicate text;
  export_rows jsonb;
  next_after_id uuid;
begin
  select session.*
  into export_session
  from public.organization_export_sessions session
  where session.id = target_export_session_id
    and session.profile_id = (select auth.uid())
    and session.expires_at > now();

  if not found then
    raise exception 'The organization export session is missing or has expired.' using errcode = '42501';
  end if;

  if not private.has_organization_export_access(export_session.organization_id) then
    raise exception 'You do not have permission to export this organization.' using errcode = '42501';
  end if;

  case normalized_section
    when 'organization' then source_table := 'public.organizations'; source_predicate := 'id = $1';
    when 'stores' then source_table := 'public.stores'; source_predicate := 'organization_id = $1';
    when 'registers' then source_table := 'public.registers'; source_predicate := 'organization_id = $1';
    when 'employees' then source_table := 'public.employees'; source_predicate := 'organization_id = $1';
    when 'roles' then source_table := 'public.roles'; source_predicate := 'organization_id = $1';
    when 'categories' then source_table := 'public.categories'; source_predicate := 'organization_id = $1';
    when 'products' then source_table := 'public.products'; source_predicate := 'organization_id = $1';
    when 'product_variants' then source_table := 'public.product_variants'; source_predicate := 'organization_id = $1';
    when 'customers' then source_table := 'public.customers'; source_predicate := 'organization_id = $1';
    when 'payment_methods' then source_table := 'public.payment_methods'; source_predicate := 'organization_id = $1';
    when 'sales' then source_table := 'public.sales'; source_predicate := 'organization_id = $1';
    when 'sale_items' then source_table := 'public.sale_items'; source_predicate := 'organization_id = $1';
    when 'payments' then source_table := 'public.payments'; source_predicate := 'organization_id = $1';
    when 'receipts' then source_table := 'public.receipts'; source_predicate := 'organization_id = $1';
    when 'refunds' then source_table := 'public.refunds'; source_predicate := 'organization_id = $1';
    when 'inventory_movements' then source_table := 'public.inventory_movements'; source_predicate := 'organization_id = $1';
    when 'purchase_orders' then source_table := 'public.purchase_orders'; source_predicate := 'organization_id = $1';
    when 'stock_transfers' then source_table := 'public.stock_transfers'; source_predicate := 'organization_id = $1';
    when 'offline_sync_events' then source_table := 'public.offline_sync_events'; source_predicate := 'organization_id = $1';
    else
      raise exception 'Unsupported organization export section.' using errcode = '22023';
  end case;

  execute format(
    'select coalesce(jsonb_agg(to_jsonb(export_row)), ''[]''::jsonb)
       from (
         select *
         from %s
         where %s
           and ($2::uuid is null or id > $2::uuid)
         order by id
         limit 250
       ) export_row',
    source_table,
    source_predicate
  )
  into export_rows
  using export_session.organization_id, target_after_id;

  if jsonb_array_length(export_rows) = 250 then
    next_after_id := (export_rows -> 249 ->> 'id')::uuid;
  end if;

  return jsonb_build_object(
    'records', export_rows,
    'next_after_id', next_after_id
  );
end;
$$;

create or replace function public.get_organization_usage_snapshot(target_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization_timezone text;
  target_usage_date date;
  target_day_start timestamptz;
  target_day_end timestamptz;
  usage_record public.organization_usage_daily%rowtype;
begin
  if not private.has_organization_export_access(target_organization_id) then
    raise exception 'You do not have permission to view organization usage.' using errcode = '42501';
  end if;

  select organization.timezone
  into organization_timezone
  from public.organizations organization
  where organization.id = target_organization_id;

  if organization_timezone is null then
    raise exception 'Organization was not found.' using errcode = 'P0002';
  end if;

  target_usage_date := (now() at time zone organization_timezone)::date;
  target_day_start := target_usage_date::timestamp at time zone organization_timezone;
  target_day_end := target_day_start + interval '1 day';

  insert into public.organization_usage_daily (
    organization_id,
    usage_date,
    active_store_count,
    active_employee_count,
    active_product_count,
    customer_count,
    completed_sale_count,
    completed_sales_total_minor,
    pending_offline_sync_count,
    captured_at
  )
  values (
    target_organization_id,
    target_usage_date,
    (select count(*)::integer from public.stores where organization_id = target_organization_id and is_active),
    (select count(*)::integer from public.employees where organization_id = target_organization_id and status = 'active'),
    (select count(*)::integer from public.products where organization_id = target_organization_id and status = 'active'),
    (select count(*)::integer from public.customers where organization_id = target_organization_id and status = 'active'),
    (select count(*)::integer from public.sales where organization_id = target_organization_id and completed_at >= target_day_start and completed_at < target_day_end),
    (select coalesce(sum(total_minor), 0) from public.sales where organization_id = target_organization_id and completed_at >= target_day_start and completed_at < target_day_end),
    (select count(*)::integer from public.offline_sync_events where organization_id = target_organization_id and state in ('LOCAL_PENDING', 'SYNCING', 'CONFLICT', 'FAILED')),
    now()
  )
  on conflict (organization_id, usage_date)
  do update set
    active_store_count = excluded.active_store_count,
    active_employee_count = excluded.active_employee_count,
    active_product_count = excluded.active_product_count,
    customer_count = excluded.customer_count,
    completed_sale_count = excluded.completed_sale_count,
    completed_sales_total_minor = excluded.completed_sales_total_minor,
    pending_offline_sync_count = excluded.pending_offline_sync_count,
    captured_at = excluded.captured_at
  returning * into usage_record;

  return jsonb_build_object(
    'usage_date', usage_record.usage_date,
    'active_store_count', usage_record.active_store_count,
    'active_employee_count', usage_record.active_employee_count,
    'active_product_count', usage_record.active_product_count,
    'customer_count', usage_record.customer_count,
    'completed_sale_count', usage_record.completed_sale_count,
    'completed_sales_total_minor', usage_record.completed_sales_total_minor,
    'pending_offline_sync_count', usage_record.pending_offline_sync_count,
    'captured_at', usage_record.captured_at
  );
end;
$$;

create or replace function private.manage_organization_lifecycle(
  target_organization_id uuid,
  target_action text,
  target_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_action text := upper(btrim(coalesce(target_action, '')));
  normalized_reason text := nullif(btrim(coalesce(target_reason, '')), '');
  organization_record public.organizations%rowtype;
  actor_employee_id uuid;
  rate_limit_result jsonb;
begin
  if not private.has_organization_lifecycle_access(target_organization_id) then
    raise exception 'Only an organization owner can change this lifecycle.' using errcode = '42501';
  end if;

  rate_limit_result := private.consume_organization_rate_limit(
    target_organization_id,
    'organization.lifecycle'
  );

  if not coalesce((rate_limit_result ->> 'allowed')::boolean, false) then
    return rate_limit_result;
  end if;

  select organization.*
  into organization_record
  from public.organizations organization
  where organization.id = target_organization_id
  for update;

  if not found then
    raise exception 'Organization was not found.' using errcode = 'P0002';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active'
  order by employee.created_at
  limit 1;

  if normalized_action in ('SUSPEND', 'REQUEST_ARCHIVE')
    and (normalized_reason is null or char_length(normalized_reason) not between 3 and 500) then
    raise exception 'Provide a reason between 3 and 500 characters.' using errcode = '22023';
  end if;

  if organization_record.status = 'archived' and normalized_action <> 'ARCHIVE' then
    raise exception 'Archived organizations are retained and cannot be reactivated.' using errcode = '22023';
  end if;

  case normalized_action
    when 'SUSPEND' then
      if organization_record.status = 'suspended' then
        raise exception 'This organization is already suspended.' using errcode = '22023';
      end if;

      perform private.write_audit_log(
        target_organization_id, 'ORGANIZATION_SUSPENDED', 'organization.archive', actor_employee_id,
        null, null, null, null, null, normalized_reason,
        jsonb_build_object('previous_status', organization_record.status)
      );

      update public.organizations organization
      set status = 'suspended',
          suspended_at = now(),
          suspension_reason = normalized_reason
      where organization.id = target_organization_id;

    when 'RESUME' then
      if organization_record.status <> 'suspended' then
        raise exception 'Only a suspended organization can be resumed.' using errcode = '22023';
      end if;

      update public.organizations organization
      set status = 'active',
          suspended_at = null,
          suspension_reason = null
      where organization.id = target_organization_id;

      perform private.write_audit_log(
        target_organization_id, 'ORGANIZATION_RESUMED', 'organization.archive', actor_employee_id,
        null, null, null, null, null, null,
        jsonb_build_object('previous_status', organization_record.status)
      );

    when 'REQUEST_ARCHIVE' then
      if organization_record.archive_requested_at is not null then
        raise exception 'An archive request is already open for this organization.' using errcode = '22023';
      end if;

      update public.organizations organization
      set archive_requested_at = now(),
          archive_requested_by_employee_id = actor_employee_id
      where organization.id = target_organization_id;

      perform private.write_audit_log(
        target_organization_id, 'ORGANIZATION_ARCHIVE_REQUESTED', 'organization.lifecycle', actor_employee_id,
        null, null, null, null, null, normalized_reason,
        jsonb_build_object('status', organization_record.status)
      );

    when 'CANCEL_ARCHIVE' then
      if organization_record.archive_requested_at is null then
        raise exception 'There is no archive request to cancel.' using errcode = '22023';
      end if;

      update public.organizations organization
      set archive_requested_at = null,
          archive_requested_by_employee_id = null
      where organization.id = target_organization_id;

      perform private.write_audit_log(
        target_organization_id, 'ORGANIZATION_ARCHIVE_CANCELLED', 'organization.lifecycle', actor_employee_id,
        null, null, null, null, null, null,
        '{}'::jsonb
      );

    when 'ARCHIVE' then
      if organization_record.archive_requested_at is null then
        raise exception 'Request an archive and download an export before archiving this organization.' using errcode = '22023';
      end if;

      if not exists (
        select 1
        from public.audit_logs audit_log
        where audit_log.organization_id = target_organization_id
          and audit_log.event_type = 'ORGANIZATION_EXPORT_PREPARED'
          and audit_log.created_at >= organization_record.archive_requested_at
      ) then
        raise exception 'Download an organization export after requesting archive before continuing.' using errcode = '22023';
      end if;

      perform private.write_audit_log(
        target_organization_id, 'ORGANIZATION_ARCHIVED', 'organization.archive', actor_employee_id,
        null, null, null, null, null, null,
        jsonb_build_object('archive_requested_at', organization_record.archive_requested_at)
      );

      update public.organizations organization
      set status = 'archived',
          archived_at = now(),
          suspended_at = null,
          suspension_reason = null
      where organization.id = target_organization_id;

    else
      raise exception 'Unsupported organization lifecycle action.' using errcode = '22023';
  end case;

  select organization.*
  into organization_record
  from public.organizations organization
  where organization.id = target_organization_id;

  return rate_limit_result || jsonb_build_object(
    'status', organization_record.status,
    'suspended_at', organization_record.suspended_at,
    'archive_requested_at', organization_record.archive_requested_at,
    'archived_at', organization_record.archived_at
  );
end;
$$;

create or replace function public.manage_organization_lifecycle(
  target_organization_id uuid,
  target_action text,
  target_reason text default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.manage_organization_lifecycle(
    target_organization_id,
    target_action,
    target_reason
  );
$$;

-- No application-facing routine is permitted to physically delete a tenant.
-- These lifecycle guards cover every existing public tenant table with an
-- organization_id column. audit_logs, usage snapshots, rate windows, and export
-- sessions intentionally remain writable so the owner can retain evidence and
-- safely complete a suspended/archive workflow.
create or replace function private.assert_organization_operational()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
begin
  target_organization_id := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;

  if not exists (
    select 1
    from public.organizations organization
    where organization.id = target_organization_id
      and organization.status = 'active'
  ) then
    raise exception 'This organization is suspended or archived. No operational data can be changed.' using errcode = '42501';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

do $$
declare
  tenant_table record;
begin
  for tenant_table in
    select relation.relname
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    join pg_catalog.pg_attribute attribute on attribute.attrelid = relation.oid
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
      and attribute.attname = 'organization_id'
      and attribute.attnum > 0
      and not attribute.attisdropped
      and relation.relname not in (
        'audit_logs',
        'organization_rate_limit_windows',
        'organization_export_sessions',
        'organization_usage_daily'
      )
  loop
    execute format('drop trigger if exists phase16_organization_operational_guard on public.%I', tenant_table.relname);
    execute format(
      'create trigger phase16_organization_operational_guard before insert or update or delete on public.%I for each row execute function private.assert_organization_operational()',
      tenant_table.relname
    );
  end loop;
end;
$$;

drop policy if exists organizations_select_member on public.organizations;
create policy organizations_select_member
on public.organizations for select
to authenticated
using (
  (select private.has_organization_membership(id))
  or created_by = (select auth.uid())
);

-- A person may own or work for more than one independent business. This
-- replaces the original one-organization-only bootstrap check while preserving
-- the atomic setup and tenant-local role/store creation behavior.
create or replace function public.bootstrap_organization(
  organization_name text,
  store_name text,
  register_name text,
  currency_code text default 'PHP',
  timezone_name text default 'Asia/Manila'
)
returns table (
  organization_id uuid,
  store_id uuid,
  register_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized_organization_name text := btrim(organization_name);
  normalized_store_name text := btrim(store_name);
  normalized_register_name text := btrim(register_name);
  normalized_currency_code text := upper(btrim(currency_code));
  normalized_timezone text := btrim(timezone_name);
  new_organization_id uuid;
  new_store_id uuid;
  new_register_id uuid;
  new_employee_id uuid;
  owner_role_id uuid;
  admin_role_id uuid;
  manager_role_id uuid;
  cashier_role_id uuid;
  inventory_role_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if char_length(normalized_organization_name) not between 2 and 160 then
    raise exception 'Organization name must contain between 2 and 160 characters.' using errcode = '22023';
  end if;

  if char_length(normalized_store_name) not between 2 and 160 then
    raise exception 'Store name must contain between 2 and 160 characters.' using errcode = '22023';
  end if;

  if char_length(normalized_register_name) not between 2 and 160 then
    raise exception 'Register name must contain between 2 and 160 characters.' using errcode = '22023';
  end if;

  if normalized_currency_code !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be a three-letter ISO code.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_timezone_names where name = normalized_timezone
  ) then
    raise exception 'Timezone is not recognized by PostgreSQL.' using errcode = '22023';
  end if;

  insert into public.organizations (name, currency_code, timezone, created_by)
  values (normalized_organization_name, normalized_currency_code, normalized_timezone, current_user_id)
  returning id into new_organization_id;

  insert into public.roles (organization_id, name, code, description, is_system)
  values (new_organization_id, 'Owner', 'owner', 'Full organization ownership.', true)
  returning id into owner_role_id;
  insert into public.roles (organization_id, name, code, description, is_system)
  values (new_organization_id, 'Admin', 'admin', 'Administrative access without ownership controls.', true)
  returning id into admin_role_id;
  insert into public.roles (organization_id, name, code, description, is_system)
  values (new_organization_id, 'Manager', 'manager', 'Store management and operational oversight.', true)
  returning id into manager_role_id;
  insert into public.roles (organization_id, name, code, description, is_system)
  values (new_organization_id, 'Cashier', 'cashier', 'Point-of-sale and register operations.', true)
  returning id into cashier_role_id;
  insert into public.roles (organization_id, name, code, description, is_system)
  values (new_organization_id, 'Inventory Staff', 'inventory_staff', 'Product and inventory operations.', true)
  returning id into inventory_role_id;

  insert into public.role_permissions (organization_id, role_id, permission_code)
  select new_organization_id, owner_role_id, permission.code from public.permissions permission;

  insert into public.role_permissions (organization_id, role_id, permission_code)
  select new_organization_id, admin_role_id, permission.code
  from public.permissions permission
  where permission.code not in ('organization.manage', 'organization.archive', 'organization.lifecycle');

  insert into public.role_permissions (organization_id, role_id, permission_code)
  select new_organization_id, manager_role_id, permission.code
  from public.permissions permission
  where permission.code in (
    'sales.create', 'sales.refund', 'discounts.apply', 'prices.override',
    'receipts.view', 'receipts.reprint', 'shifts.open', 'shifts.close',
    'cash.pay_in', 'cash.pay_out', 'products.manage', 'products.view_cost',
    'inventory.manage', 'customers.manage', 'employees.manage',
    'reports.view', 'registers.manage', 'dashboard.view',
    'kitchen.view', 'kitchen.manage', 'pos.access', 'pos.edit_quantity',
    'pos.remove_item', 'payments.accept', 'tickets.manage', 'cash_drawer.open',
    'shifts.view_expected_cash', 'shifts.view_history', 'shifts.force_close',
    'inventory.view', 'inventory.adjust', 'inventory.count', 'inventory.receive',
    'inventory.purchase_orders', 'inventory.transfers', 'inventory.suppliers',
    'approvals.request', 'approvals.authorize', 'audit.view'
  );

  insert into public.role_permissions (organization_id, role_id, permission_code)
  select new_organization_id, cashier_role_id, permission.code
  from public.permissions permission
  where permission.code in (
    'sales.create', 'discounts.apply', 'receipts.view', 'receipts.reprint',
    'shifts.open', 'shifts.close', 'cash.pay_in', 'cash.pay_out',
    'pos.access', 'pos.edit_quantity', 'pos.remove_item', 'payments.accept',
    'approvals.request'
  );

  insert into public.role_permissions (organization_id, role_id, permission_code)
  select new_organization_id, inventory_role_id, permission.code
  from public.permissions permission
  where permission.code in (
    'products.manage', 'products.view_cost', 'inventory.manage',
    'inventory.view', 'inventory.adjust', 'inventory.count', 'inventory.receive',
    'inventory.purchase_orders', 'inventory.transfers', 'inventory.suppliers',
    'approvals.request'
  );

  insert into public.stores (organization_id, name, code)
  values (new_organization_id, normalized_store_name, 'MAIN')
  returning id into new_store_id;
  insert into public.registers (organization_id, store_id, name, code)
  values (new_organization_id, new_store_id, normalized_register_name, 'REG-01')
  returning id into new_register_id;
  insert into public.employees (organization_id, profile_id, employee_number, job_title)
  values (
    new_organization_id,
    current_user_id,
    'OWNER-' || upper(substr(replace(current_user_id::text, '-', ''), 1, 8)),
    'Owner'
  )
  returning id into new_employee_id;
  insert into public.employee_roles (organization_id, employee_id, role_id)
  values (new_organization_id, new_employee_id, owner_role_id);
  insert into public.employee_stores (organization_id, employee_id, store_id)
  values (new_organization_id, new_employee_id, new_store_id);

  return query select new_organization_id, new_store_id, new_register_id;
end;
$$;

revoke execute on function private.has_organization_membership(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.has_organization_export_access(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.has_organization_lifecycle_access(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.consume_organization_rate_limit(uuid, text) from public, anon, authenticated, service_role;
revoke execute on function private.prepare_organization_export(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.manage_organization_lifecycle(uuid, text, text) from public, anon, authenticated, service_role;
revoke execute on function private.assert_organization_operational() from public, anon, authenticated, service_role;
revoke execute on function public.prepare_organization_export(uuid) from public, anon, service_role;
revoke execute on function public.get_organization_export_page(uuid, text, uuid) from public, anon, service_role;
revoke execute on function public.get_organization_usage_snapshot(uuid) from public, anon, service_role;
revoke execute on function public.manage_organization_lifecycle(uuid, text, text) from public, anon, service_role;

grant execute on function private.has_organization_membership(uuid) to authenticated;
grant execute on function private.has_organization_export_access(uuid) to authenticated;
grant execute on function private.has_organization_lifecycle_access(uuid) to authenticated;
grant execute on function public.prepare_organization_export(uuid) to authenticated;
grant execute on function public.get_organization_export_page(uuid, text, uuid) to authenticated;
grant execute on function public.get_organization_usage_snapshot(uuid) to authenticated;
grant execute on function public.manage_organization_lifecycle(uuid, text, text) to authenticated;

comment on table public.organization_usage_daily is 'Owner/admin tenant usage and resource signals. Rows are private and returned only through the organization-scoped usage RPC.';
comment on table public.organization_export_sessions is 'Short-lived, owner/admin export capability sessions. Data is never directly exposed through the Data API.';
comment on function public.get_organization_export_page(uuid, text, uuid) is 'Streams a rate-limited, owner/admin-authorized organization export in fixed keyset pages without cross-tenant table access.';
comment on function public.manage_organization_lifecycle(uuid, text, text) is 'Non-destructive organization suspension, archive request, and archive workflow. Physical tenant deletion is intentionally unsupported.';

notify pgrst, 'reload schema';

commit;
