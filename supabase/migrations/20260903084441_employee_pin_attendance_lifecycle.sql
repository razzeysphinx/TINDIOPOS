-- Employee PIN attendance and controlled employee lifecycle.
-- Attendance remains independent from register shifts. Existing employee,
-- profile, RBAC, PIN, shift, and audit models remain canonical.

begin;

insert into public.permissions (code, category, name, description)
values (
  'attendance.use',
  'Attendance',
  'Use attendance clock',
  'Clock authorized employees in and out from an assigned store terminal.'
)
on conflict (code) do update
set category = excluded.category,
    name = excluded.name,
    description = excluded.description;

insert into public.role_permissions (organization_id, role_id, permission_code)
select role.organization_id, role.id, 'attendance.use'
from public.roles role
where role.is_system
on conflict do nothing;

create or replace function private.grant_system_role_attendance_capability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_system then
    insert into public.role_permissions (organization_id, role_id, permission_code)
    values (new.organization_id, new.id, 'attendance.use')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

revoke execute on function private.grant_system_role_attendance_capability()
from public, anon, authenticated, service_role;

drop trigger if exists grant_system_role_attendance_capability on public.roles;
create trigger grant_system_role_attendance_capability
after insert on public.roles
for each row execute function private.grant_system_role_attendance_capability();

alter table public.employees
  drop constraint employees_status_values,
  add column archived_at timestamptz,
  add constraint employees_status_values
    check (status in ('active', 'inactive', 'suspended', 'archived')),
  add constraint employees_archive_state_check
    check ((status = 'archived') = (archived_at is not null));

alter table public.time_clock_entries
  add column clock_in_verification_method text not null default 'authenticated_session',
  add column clock_out_verification_method text,
  add column clock_in_request_id uuid,
  add column clock_out_request_id uuid,
  add column clocked_in_by_employee_id uuid,
  add column clocked_out_by_employee_id uuid,
  add constraint time_clock_entries_clock_in_verification_check
    check (clock_in_verification_method in ('authenticated_session', 'employee_pin')),
  add constraint time_clock_entries_clock_out_verification_check
    check (clock_out_verification_method is null or clock_out_verification_method = 'employee_pin'),
  add constraint time_clock_entries_clocked_in_by_organization_fkey
    foreign key (clocked_in_by_employee_id, organization_id)
    references public.employees (id, organization_id) on delete restrict,
  add constraint time_clock_entries_clocked_out_by_organization_fkey
    foreign key (clocked_out_by_employee_id, organization_id)
    references public.employees (id, organization_id) on delete restrict;

update public.time_clock_entries
set clocked_in_by_employee_id = employee_id
where clocked_in_by_employee_id is null;

alter table public.time_clock_entries
  alter column clocked_in_by_employee_id set not null;

create unique index time_clock_entries_clock_in_request_idx
  on public.time_clock_entries (organization_id, clock_in_request_id)
  where clock_in_request_id is not null;
create unique index time_clock_entries_clock_out_request_idx
  on public.time_clock_entries (organization_id, clock_out_request_id)
  where clock_out_request_id is not null;

create or replace function private.require_attendance_terminal(
  target_organization_id uuid,
  target_store_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'attendance.use')) then
    raise exception 'Attendance access is required.' using errcode = '42501';
  end if;

  if target_store_id is null
    or not (select private.has_store_read_scope(target_organization_id, target_store_id))
    or not exists (
      select 1 from public.stores store
      where store.id = target_store_id
        and store.organization_id = target_organization_id
        and store.is_active
    ) then
    raise exception 'Choose an assigned active store for attendance.' using errcode = '42501';
  end if;

  actor_employee_id := private.current_employee_id(target_organization_id);
  if actor_employee_id is null then
    raise exception 'An active terminal employee is required.' using errcode = '42501';
  end if;
  return actor_employee_id;
end;
$$;

create or replace function private.verify_attendance_employee_pin(
  target_organization_id uuid,
  target_store_id uuid,
  target_employee_id uuid,
  target_pin text,
  actor_employee_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  employee_status text;
  credential private.employee_pin_credentials%rowtype;
  next_failed_attempts integer;
begin
  select employee.status
  into employee_status
  from public.employees employee
  where employee.id = target_employee_id
    and employee.organization_id = target_organization_id
  for key share;

  if employee_status is null then return 'EMPLOYEE_NOT_FOUND'; end if;
  if employee_status <> 'active' then return 'EMPLOYEE_INACTIVE'; end if;
  if not private.employee_has_permission(target_organization_id, target_employee_id, 'attendance.use') then
    return 'ATTENDANCE_NOT_ALLOWED';
  end if;
  if not exists (
    select 1 from public.employee_stores assignment
    where assignment.organization_id = target_organization_id
      and assignment.employee_id = target_employee_id
      and assignment.store_id = target_store_id
  ) then
    return 'STORE_NOT_ALLOWED';
  end if;

  select * into credential
  from private.employee_pin_credentials pin_credential
  where pin_credential.employee_id = target_employee_id
  for update;

  if credential.employee_id is null then return 'PIN_NOT_SET'; end if;
  if credential.locked_until is not null and credential.locked_until > now() then
    return 'PIN_LOCKED';
  end if;

  if coalesce(target_pin, '') !~ '^[0-9]{6,12}$'
    or credential.pin_hash <> extensions.crypt(target_pin, credential.pin_hash) then
    next_failed_attempts := case
      when credential.failed_window_started_at is null
        or credential.failed_window_started_at < now() - interval '15 minutes' then 1
      else credential.failed_attempts + 1
    end;

    update private.employee_pin_credentials
    set failed_attempts = least(next_failed_attempts, 5),
        failed_window_started_at = case
          when credential.failed_window_started_at is null
            or credential.failed_window_started_at < now() - interval '15 minutes' then now()
          else credential.failed_window_started_at
        end,
        locked_until = case when next_failed_attempts >= 5 then now() + interval '15 minutes' else null end,
        updated_at = now()
    where employee_id = target_employee_id;

    perform private.write_audit_log(
      target_organization_id,
      case when next_failed_attempts >= 5 then 'EMPLOYEE_PIN_LOCKED' else 'EMPLOYEE_PIN_FAILED' end,
      'attendance.use', actor_employee_id, target_employee_id, target_store_id,
      null, null, null, null,
      jsonb_build_object('attempts_in_window', least(next_failed_attempts, 5))
    );
    return case when next_failed_attempts >= 5 then 'PIN_LOCKED' else 'INVALID_PIN' end;
  end if;

  update private.employee_pin_credentials
  set failed_attempts = 0,
      failed_window_started_at = null,
      locked_until = null,
      updated_at = now()
  where employee_id = target_employee_id;

  return 'VERIFIED';
end;
$$;

create or replace function private.get_attendance_employees(
  target_organization_id uuid,
  target_store_id uuid
)
returns table (
  employee_id uuid,
  employee_number text,
  employee_name text,
  pin_is_set boolean,
  entry_id uuid,
  entry_store_id uuid,
  entry_store_name text,
  clocked_in_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_attendance_terminal(target_organization_id, target_store_id);

  return query
  select employee.id,
         employee.employee_number,
         coalesce(nullif(profile.full_name, ''), profile.email, employee.employee_number),
         credential.employee_id is not null,
         entry.id,
         entry.store_id,
         entry_store.name,
         entry.clocked_in_at
  from public.employees employee
  join public.profiles profile on profile.id = employee.profile_id
  join public.employee_stores assignment
    on assignment.organization_id = employee.organization_id
   and assignment.employee_id = employee.id
   and assignment.store_id = target_store_id
  left join private.employee_pin_credentials credential on credential.employee_id = employee.id
  left join public.time_clock_entries entry
    on entry.organization_id = employee.organization_id
   and entry.employee_id = employee.id
   and entry.clocked_out_at is null
  left join public.stores entry_store
    on entry_store.id = entry.store_id
   and entry_store.organization_id = entry.organization_id
  where employee.organization_id = target_organization_id
    and employee.status = 'active'
    and private.employee_has_permission(target_organization_id, employee.id, 'attendance.use')
  order by lower(coalesce(nullif(profile.full_name, ''), profile.email, employee.employee_number));
end;
$$;

create or replace function private.clock_in_employee_with_pin(
  target_organization_id uuid,
  target_store_id uuid,
  target_employee_id uuid,
  target_pin text,
  target_request_id uuid
)
returns table (
  result_code text,
  message text,
  entry_id uuid,
  employee_id uuid,
  employee_name text,
  store_id uuid,
  store_name text,
  clocked_in_at timestamptz,
  clocked_out_at timestamptz,
  was_replayed boolean,
  shift_id uuid,
  register_id uuid,
  register_name text,
  shift_opened_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  verification_result text;
  selected_employee public.employees%rowtype;
  selected_name text;
  selected_store_name text;
  selected_entry public.time_clock_entries%rowtype;
begin
  if target_employee_id is null or target_request_id is null then
    raise exception 'Choose an employee and submit a valid attendance request.' using errcode = '23514';
  end if;
  actor_id := private.require_attendance_terminal(target_organization_id, target_store_id);

  select employee,
         coalesce(nullif(profile.full_name, ''), profile.email, employee.employee_number)
  into selected_employee, selected_name
  from public.employees employee
  join public.profiles profile on profile.id = employee.profile_id
  where employee.id = target_employee_id
    and employee.organization_id = target_organization_id
  for update of employee;

  select store.name into selected_store_name
  from public.stores store
  where store.id = target_store_id and store.organization_id = target_organization_id;

  select entry.* into selected_entry
  from public.time_clock_entries entry
  where entry.organization_id = target_organization_id
    and entry.clock_in_request_id = target_request_id;

  if selected_entry.id is not null then
    if selected_entry.employee_id is distinct from target_employee_id
      or selected_entry.store_id is distinct from target_store_id then
      raise exception 'This attendance request was already used for a different employee.' using errcode = '23505';
    end if;
    return query select 'CLOCKED_IN', 'This employee is already clocked in.', selected_entry.id,
      target_employee_id, selected_name, selected_entry.store_id, selected_store_name,
      selected_entry.clocked_in_at, selected_entry.clocked_out_at, true,
      null::uuid, null::uuid, null::text, null::timestamptz;
    return;
  end if;

  verification_result := private.verify_attendance_employee_pin(
    target_organization_id, target_store_id, target_employee_id, target_pin, actor_id
  );
  if verification_result <> 'VERIFIED' then
    return query select verification_result,
      case verification_result
        when 'INVALID_PIN' then 'Incorrect employee PIN.'
        when 'PIN_LOCKED' then 'This employee PIN is temporarily locked. Try again later.'
        when 'PIN_NOT_SET' then 'This employee needs a PIN before using attendance.'
        when 'EMPLOYEE_INACTIVE' then 'This employee is no longer active.'
        when 'STORE_NOT_ALLOWED' then 'This employee is not assigned to this store.'
        when 'ATTENDANCE_NOT_ALLOWED' then 'This employee does not have attendance access.'
        else 'This employee is unavailable for attendance.'
      end,
      null::uuid, target_employee_id, selected_name, target_store_id, selected_store_name,
      null::timestamptz, null::timestamptz, false,
      null::uuid, null::uuid, null::text, null::timestamptz;
    return;
  end if;

  select entry.* into selected_entry
  from public.time_clock_entries entry
  where entry.organization_id = target_organization_id
    and entry.employee_id = target_employee_id
    and entry.clocked_out_at is null
  for update;

  if selected_entry.id is not null then
    if selected_entry.store_id is distinct from target_store_id then
      return query select 'ALREADY_CLOCKED_IN', 'Clock out from the current store before clocking in elsewhere.',
        selected_entry.id, target_employee_id, selected_name, selected_entry.store_id,
        (select store.name from public.stores store where store.id = selected_entry.store_id),
        selected_entry.clocked_in_at, null::timestamptz, true,
        null::uuid, null::uuid, null::text, null::timestamptz;
      return;
    end if;
    return query select 'CLOCKED_IN', 'This employee is already clocked in.', selected_entry.id,
      target_employee_id, selected_name, selected_entry.store_id, selected_store_name,
      selected_entry.clocked_in_at, null::timestamptz, true,
      null::uuid, null::uuid, null::text, null::timestamptz;
    return;
  end if;

  insert into public.time_clock_entries (
    organization_id, employee_id, store_id, clock_in_verification_method,
    clock_in_request_id, clocked_in_by_employee_id
  ) values (
    target_organization_id, target_employee_id, target_store_id, 'employee_pin',
    target_request_id, actor_id
  ) returning * into selected_entry;

  perform private.write_audit_log(
    target_organization_id, 'EMPLOYEE_CLOCKED_IN', 'attendance.use', actor_id,
    target_employee_id, target_store_id, null, null, null, null,
    jsonb_build_object('attendance_id', selected_entry.id, 'verification_method', 'employee_pin')
  );

  return query select 'CLOCKED_IN', 'Employee clocked in.', selected_entry.id,
    target_employee_id, selected_name, target_store_id, selected_store_name,
    selected_entry.clocked_in_at, null::timestamptz, false,
    null::uuid, null::uuid, null::text, null::timestamptz;
end;
$$;

create or replace function private.clock_out_employee_with_pin(
  target_organization_id uuid,
  target_employee_id uuid,
  target_pin text,
  target_request_id uuid
)
returns table (
  result_code text,
  message text,
  entry_id uuid,
  employee_id uuid,
  employee_name text,
  store_id uuid,
  store_name text,
  clocked_in_at timestamptz,
  clocked_out_at timestamptz,
  was_replayed boolean,
  shift_id uuid,
  register_id uuid,
  register_name text,
  shift_opened_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  verification_result text;
  selected_name text;
  selected_entry public.time_clock_entries%rowtype;
  open_shift public.shifts%rowtype;
  selected_store_name text;
  selected_register_name text;
begin
  if target_employee_id is null or target_request_id is null then
    raise exception 'Choose an employee and submit a valid attendance request.' using errcode = '23514';
  end if;

  select entry.* into selected_entry
  from public.time_clock_entries entry
  where entry.organization_id = target_organization_id
    and entry.clock_out_request_id = target_request_id;

  if selected_entry.id is not null then
    if selected_entry.employee_id is distinct from target_employee_id then
      raise exception 'This attendance request was already used for a different employee.' using errcode = '23505';
    end if;
    perform private.require_attendance_terminal(target_organization_id, selected_entry.store_id);
    select coalesce(nullif(profile.full_name, ''), profile.email, employee.employee_number), store.name
      into selected_name, selected_store_name
    from public.employees employee
    join public.profiles profile on profile.id = employee.profile_id
    join public.stores store on store.id = selected_entry.store_id
    where employee.id = target_employee_id and employee.organization_id = target_organization_id;
    return query select 'CLOCKED_OUT', 'This employee is already clocked out.', selected_entry.id,
      target_employee_id, selected_name, selected_entry.store_id, selected_store_name,
      selected_entry.clocked_in_at, selected_entry.clocked_out_at, true,
      null::uuid, null::uuid, null::text, null::timestamptz;
    return;
  end if;

  select entry.* into selected_entry
  from public.time_clock_entries entry
  where entry.organization_id = target_organization_id
    and entry.employee_id = target_employee_id
    and entry.clocked_out_at is null
  for update;

  if selected_entry.id is null then
    raise exception 'There is no open attendance entry to close.' using errcode = 'P0002';
  end if;
  actor_id := private.require_attendance_terminal(target_organization_id, selected_entry.store_id);

  select coalesce(nullif(profile.full_name, ''), profile.email, employee.employee_number), store.name
  into selected_name, selected_store_name
  from public.employees employee
  join public.profiles profile on profile.id = employee.profile_id
  join public.stores store
    on store.id = selected_entry.store_id and store.organization_id = employee.organization_id
  where employee.id = target_employee_id and employee.organization_id = target_organization_id;

  verification_result := private.verify_attendance_employee_pin(
    target_organization_id, selected_entry.store_id, target_employee_id, target_pin, actor_id
  );
  if verification_result <> 'VERIFIED' then
    return query select verification_result,
      case verification_result
        when 'INVALID_PIN' then 'Incorrect employee PIN.'
        when 'PIN_LOCKED' then 'This employee PIN is temporarily locked. Try again later.'
        when 'PIN_NOT_SET' then 'This employee needs a PIN before using attendance.'
        when 'EMPLOYEE_INACTIVE' then 'This employee is no longer active.'
        when 'ATTENDANCE_NOT_ALLOWED' then 'This employee does not have attendance access.'
        else 'This employee is unavailable for attendance.'
      end,
      selected_entry.id, target_employee_id, selected_name, selected_entry.store_id,
      selected_store_name, selected_entry.clocked_in_at, null::timestamptz, false,
      null::uuid, null::uuid, null::text, null::timestamptz;
    return;
  end if;

  select shift.* into open_shift
  from public.shifts shift
  where shift.organization_id = target_organization_id
    and shift.opened_by_employee_id = target_employee_id
    and shift.status = 'open'
  order by shift.opened_at
  limit 1
  for update;

  if open_shift.id is not null then
    select register.name into selected_register_name
    from public.registers register
    where register.id = open_shift.register_id
      and register.organization_id = target_organization_id;
    return query select 'OPEN_REGISTER_SHIFT', 'Close the register shift before clocking out.',
      selected_entry.id, target_employee_id, selected_name, selected_entry.store_id,
      selected_store_name, selected_entry.clocked_in_at, null::timestamptz, false,
      open_shift.id, open_shift.register_id, selected_register_name, open_shift.opened_at;
    return;
  end if;

  update public.time_clock_entries entry
  set clocked_out_at = now(),
      clock_out_verification_method = 'employee_pin',
      clock_out_request_id = target_request_id,
      clocked_out_by_employee_id = actor_id
  where entry.id = selected_entry.id
  returning * into selected_entry;

  perform private.write_audit_log(
    target_organization_id, 'EMPLOYEE_CLOCKED_OUT', 'attendance.use', actor_id,
    target_employee_id, selected_entry.store_id, null, null, null, null,
    jsonb_build_object('attendance_id', selected_entry.id, 'verification_method', 'employee_pin')
  );

  return query select 'CLOCKED_OUT', 'Employee clocked out.', selected_entry.id,
    target_employee_id, selected_name, selected_entry.store_id, selected_store_name,
    selected_entry.clocked_in_at, selected_entry.clocked_out_at, false,
    null::uuid, null::uuid, null::text, null::timestamptz;
end;
$$;

create or replace function private.employee_dependency_tables(target_employee_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  dependency record;
  dependency_exists boolean;
  dependencies text[] := '{}'::text[];
begin
  for dependency in
    select distinct child_namespace.nspname as schema_name,
           child_table.relname as table_name,
           child_column.attname as column_name
    from pg_catalog.pg_constraint constraint_record
    join pg_catalog.pg_class child_table on child_table.oid = constraint_record.conrelid
    join pg_catalog.pg_namespace child_namespace on child_namespace.oid = child_table.relnamespace
    join lateral unnest(constraint_record.conkey) with ordinality child_key(attnum, position) on true
    join lateral unnest(constraint_record.confkey) with ordinality parent_key(attnum, position)
      on parent_key.position = child_key.position
    join pg_catalog.pg_attribute child_column
      on child_column.attrelid = child_table.oid and child_column.attnum = child_key.attnum
    join pg_catalog.pg_attribute parent_column
      on parent_column.attrelid = constraint_record.confrelid and parent_column.attnum = parent_key.attnum
    where constraint_record.contype = 'f'
      and constraint_record.confrelid = 'public.employees'::regclass
      and parent_column.attname = 'id'
      and not (
        child_namespace.nspname = 'public'
        and child_table.relname in ('employee_roles', 'employee_stores', 'audit_logs')
      )
      and not (
        child_namespace.nspname = 'private'
        and child_table.relname = 'employee_pin_credentials'
      )
    order by child_namespace.nspname, child_table.relname, child_column.attname
  loop
    execute format(
      'select exists (select 1 from %I.%I where %I = $1)',
      dependency.schema_name, dependency.table_name, dependency.column_name
    ) using target_employee_id into dependency_exists;
    if dependency_exists and not dependencies @> array[dependency.table_name] then
      dependencies := array_append(dependencies, dependency.table_name);
    end if;
  end loop;
  -- Employee-administration events are retained as immutable snapshots and do
  -- not turn a never-used invitation into an undeletable employee. Operational
  -- audit history still blocks erasure.
  if exists (
    select 1 from public.audit_logs audit
    where (audit.actor_employee_id = target_employee_id or audit.subject_employee_id = target_employee_id)
      and audit.event_type not like 'EMPLOYEE\_%' escape '\'
  ) then
    dependencies := array_append(dependencies, 'audit_logs');
  end if;
  return dependencies;
end;
$$;

create or replace function private.require_employee_manager_target(
  target_organization_id uuid,
  target_employee_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'employees.manage')) then
    raise exception 'Employee-management permission is required.' using errcode = '42501';
  end if;
  actor_id := private.current_employee_id(target_organization_id);
  if actor_id is null then
    raise exception 'An active employee manager is required.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.employees employee
    where employee.id = target_employee_id
      and employee.organization_id = target_organization_id
  ) or not private.can_access_employee_store_scope(target_organization_id, target_employee_id) then
    raise exception 'Select an employee within your store access.' using errcode = '42501';
  end if;
  return actor_id;
end;
$$;

-- Keep the mature assignment transaction, but place a store-scope boundary in
-- front of it. The legacy implementation already validates role-grant scope,
-- active stores, self edits, and writes the audit event.
alter function public.update_employee_assignments(uuid, uuid, text, text, uuid[], uuid[])
  set schema private;
alter function private.update_employee_assignments(uuid, uuid, text, text, uuid[], uuid[])
  rename to update_employee_assignments_unscoped;
revoke execute on function private.update_employee_assignments_unscoped(uuid, uuid, text, text, uuid[], uuid[])
from public, anon, authenticated, service_role;

create or replace function public.update_employee_assignments(
  target_organization_id uuid,
  target_employee_id uuid,
  target_job_title text,
  target_status text,
  target_role_ids uuid[],
  target_store_ids uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.require_employee_manager_target(target_organization_id, target_employee_id);
  if not private.has_permission(target_organization_id, 'organization.manage')
    and exists (
      select 1 from unnest(coalesce(target_store_ids, '{}'::uuid[])) store_id
      where not private.has_store_read_scope(target_organization_id, store_id)
    ) then
    raise exception 'You can assign only stores within your store access.' using errcode = '42501';
  end if;
  return private.update_employee_assignments_unscoped(
    target_organization_id, target_employee_id, target_job_title, target_status,
    target_role_ids, target_store_ids
  );
end;
$$;

revoke execute on function public.update_employee_assignments(uuid, uuid, text, text, uuid[], uuid[])
from public, anon, service_role;
grant execute on function private.update_employee_assignments_unscoped(uuid, uuid, text, text, uuid[], uuid[])
to authenticated;
grant execute on function public.update_employee_assignments(uuid, uuid, text, text, uuid[], uuid[])
to authenticated;

create or replace function private.change_employee_lifecycle(
  target_organization_id uuid,
  target_employee_id uuid,
  target_action text,
  target_reason text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  employee_record public.employees%rowtype;
  normalized_action text := upper(btrim(coalesce(target_action, '')));
  normalized_reason text := nullif(btrim(coalesce(target_reason, '')), '');
  next_status text;
begin
  actor_id := private.require_employee_manager_target(target_organization_id, target_employee_id);
  if actor_id = target_employee_id then
    raise exception 'You cannot change your own employee lifecycle.' using errcode = '42501';
  end if;
  if normalized_reason is null or char_length(normalized_reason) not between 2 and 500 then
    raise exception 'Enter a reason between 2 and 500 characters.' using errcode = '23514';
  end if;

  select * into employee_record
  from public.employees employee
  where employee.id = target_employee_id and employee.organization_id = target_organization_id
  for update;

  if normalized_action in ('DEACTIVATE', 'ARCHIVE') and exists (
    select 1 from public.shifts shift
    where shift.organization_id = target_organization_id
      and shift.opened_by_employee_id = target_employee_id
      and shift.status = 'open'
  ) then
    raise exception 'Resolve this employee''s active register shift before removing access.' using errcode = '23514';
  end if;
  if normalized_action in ('DEACTIVATE', 'ARCHIVE') and exists (
    select 1 from public.time_clock_entries entry
    where entry.organization_id = target_organization_id
      and entry.employee_id = target_employee_id
      and entry.clocked_out_at is null
  ) then
    raise exception 'Clock this employee out before removing access.' using errcode = '23514';
  end if;
  if normalized_action in ('DEACTIVATE', 'ARCHIVE')
    and employee_record.status = 'active'
    and private.employee_has_permission(target_organization_id, target_employee_id, 'organization.manage')
    and 1 >= (
      select count(distinct manager.id)
      from public.employees manager
      join public.employee_roles manager_role
        on manager_role.organization_id = manager.organization_id
       and manager_role.employee_id = manager.id
      join public.role_permissions role_permission
        on role_permission.organization_id = manager_role.organization_id
       and role_permission.role_id = manager_role.role_id
      where manager.organization_id = target_organization_id
        and manager.status = 'active'
        and role_permission.permission_code = 'organization.manage'
    ) then
    raise exception 'Assign another active organization manager before removing the last manager.' using errcode = '23514';
  end if;

  next_status := case normalized_action
    when 'DEACTIVATE' then 'inactive'
    when 'REACTIVATE' then 'active'
    when 'ARCHIVE' then 'archived'
    else null
  end;
  if next_status is null then
    raise exception 'Choose deactivate, reactivate, or archive.' using errcode = '23514';
  end if;
  if normalized_action = 'DEACTIVATE' and employee_record.status <> 'active' then
    raise exception 'Only an active employee can be deactivated.' using errcode = '23514';
  end if;
  if normalized_action = 'REACTIVATE' and employee_record.status not in ('inactive', 'suspended') then
    raise exception 'Only an inactive or suspended employee can be reactivated.' using errcode = '23514';
  end if;
  if normalized_action = 'ARCHIVE' and employee_record.status not in ('inactive', 'suspended') then
    raise exception 'Deactivate the employee before archiving.' using errcode = '23514';
  end if;

  perform set_config('tindio.employee_lifecycle_change', 'authorized', true);
  update public.employees
  set status = next_status,
      archived_at = case when next_status = 'archived' then now() else null end
  where id = target_employee_id and organization_id = target_organization_id;
  perform set_config('tindio.employee_lifecycle_change', '', true);

  if normalized_action in ('DEACTIVATE', 'ARCHIVE') then
    delete from private.employee_pin_credentials where employee_id = target_employee_id;
  end if;

  perform private.write_audit_log(
    target_organization_id, 'EMPLOYEE_' || normalized_action || 'D', 'employees.manage',
    actor_id, target_employee_id, null, null, null, null, normalized_reason,
    jsonb_build_object('previous_status', employee_record.status, 'new_status', next_status)
  );
  return next_status;
end;
$$;

create or replace function private.guard_employee_lifecycle_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.status is distinct from old.status or new.archived_at is distinct from old.archived_at)
    and (select auth.uid()) is not null
    and coalesce(current_setting('tindio.employee_lifecycle_change', true), '') <> 'authorized' then
    raise exception 'Use the controlled employee lifecycle workflow to change status.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function private.guard_employee_lifecycle_transition()
from public, anon, authenticated, service_role;
drop trigger if exists employees_guard_lifecycle_transition on public.employees;
create trigger employees_guard_lifecycle_transition
before update of status, archived_at on public.employees
for each row execute function private.guard_employee_lifecycle_transition();

create or replace function private.get_employee_management_detail(
  target_organization_id uuid,
  target_employee_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  result jsonb;
begin
  actor_id := private.require_employee_manager_target(target_organization_id, target_employee_id);
  select jsonb_build_object(
    'id', employee.id,
    'employeeNumber', employee.employee_number,
    'fullName', coalesce(nullif(profile.full_name, ''), profile.email, employee.employee_number),
    'email', profile.email,
    'phone', profile.phone,
    'jobTitle', employee.job_title,
    'status', employee.status,
    'archivedAt', employee.archived_at,
    'pinIsSet', exists(select 1 from private.employee_pin_credentials credential where credential.employee_id = employee.id),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object('id', role.id, 'name', role.name) order by role.name)
      from public.employee_roles link join public.roles role on role.id = link.role_id
      where link.organization_id = target_organization_id and link.employee_id = employee.id
    ), '[]'::jsonb),
    'stores', coalesce((
      select jsonb_agg(jsonb_build_object('id', store.id, 'name', store.name) order by store.name)
      from public.employee_stores link join public.stores store on store.id = link.store_id
      where link.organization_id = target_organization_id and link.employee_id = employee.id
    ), '[]'::jsonb),
    'posAccess', private.employee_has_permission(target_organization_id, employee.id, 'pos.access'),
    'backOfficeAccess', exists (
      select 1 from public.employee_roles employee_role
      join public.role_permissions role_permission
        on role_permission.role_id = employee_role.role_id
       and role_permission.organization_id = employee_role.organization_id
      where employee_role.organization_id = target_organization_id
        and employee_role.employee_id = employee.id
        and role_permission.permission_code = any(array[
          'dashboard.view','reports.view','products.manage','inventory.view','inventory.manage',
          'customers.manage','employees.manage','roles.manage','stores.manage','registers.manage',
          'organization.manage','settings.manage','approvals.manage','audit.view','devices.manage'
        ])
    ),
    'attendance', jsonb_build_object(
      'current', (select jsonb_build_object('id', entry.id, 'storeId', entry.store_id, 'storeName', store.name, 'clockedInAt', entry.clocked_in_at)
                  from public.time_clock_entries entry join public.stores store on store.id = entry.store_id
                  where entry.organization_id = target_organization_id and entry.employee_id = employee.id and entry.clocked_out_at is null),
      'lastClockIn', (select entry.clocked_in_at from public.time_clock_entries entry
                      where entry.organization_id = target_organization_id and entry.employee_id = employee.id
                      order by entry.clocked_in_at desc limit 1),
      'historyCount', (select count(*) from public.time_clock_entries entry
                       where entry.organization_id = target_organization_id and entry.employee_id = employee.id),
      'history', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', history.id, 'storeName', history.store_name,
          'clockedInAt', history.clocked_in_at, 'clockedOutAt', history.clocked_out_at
        ) order by history.clocked_in_at desc)
        from (
          select entry.id, store.name as store_name, entry.clocked_in_at, entry.clocked_out_at
          from public.time_clock_entries entry join public.stores store on store.id = entry.store_id
          where entry.organization_id = target_organization_id and entry.employee_id = employee.id
          order by entry.clocked_in_at desc limit 20
        ) history
      ), '[]'::jsonb)
    ),
    'activity', jsonb_build_object(
      'receipts', (select count(*) from public.sales sale where sale.organization_id = target_organization_id and sale.cashier_employee_id = employee.id),
      'registerShifts', (select count(*) from public.shifts shift where shift.organization_id = target_organization_id and (shift.opened_by_employee_id = employee.id or shift.closed_by_employee_id = employee.id)),
      'refunds', (select count(*) from public.refunds refund where refund.organization_id = target_organization_id and refund.refunded_by_employee_id = employee.id),
      'inventoryMovements', (select count(*) from public.inventory_movements movement where movement.organization_id = target_organization_id and movement.actor_employee_id = employee.id)
    ),
    'openShift', (select jsonb_build_object(
      'id', shift.id, 'storeId', shift.store_id, 'storeName', store.name,
      'registerId', shift.register_id, 'registerName', register.name, 'openedAt', shift.opened_at
    ) from public.shifts shift
      join public.stores store on store.id = shift.store_id
      join public.registers register on register.id = shift.register_id
      where shift.organization_id = target_organization_id
        and shift.opened_by_employee_id = employee.id and shift.status = 'open'
      limit 1),
    'deleteBlockers', to_jsonb(private.employee_dependency_tables(employee.id))
  ) into result
  from public.employees employee
  join public.profiles profile on profile.id = employee.profile_id
  where employee.id = target_employee_id and employee.organization_id = target_organization_id;
  return result;
end;
$$;

create or replace function private.update_employee_profile(
  target_organization_id uuid,
  target_employee_id uuid,
  target_full_name text,
  target_phone text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  target_profile_id uuid;
  normalized_name text := btrim(coalesce(target_full_name, ''));
  normalized_phone text := nullif(btrim(coalesce(target_phone, '')), '');
begin
  actor_id := private.require_employee_manager_target(target_organization_id, target_employee_id);
  if char_length(normalized_name) not between 2 and 160
    or (normalized_phone is not null and char_length(normalized_phone) > 40) then
    raise exception 'Check the employee name and phone number.' using errcode = '23514';
  end if;
  select employee.profile_id into target_profile_id
  from public.employees employee
  where employee.id = target_employee_id and employee.organization_id = target_organization_id;
  update public.profiles set full_name = normalized_name, phone = normalized_phone
  where id = target_profile_id;
  perform private.write_audit_log(
    target_organization_id, 'EMPLOYEE_PROFILE_UPDATED', 'employees.manage', actor_id,
    target_employee_id, null, null, null, null, null, '{}'::jsonb
  );
end;
$$;

create or replace function private.delete_employee_if_eligible(
  target_organization_id uuid,
  target_employee_id uuid,
  target_confirmation_number text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  employee_record public.employees%rowtype;
  employee_name text;
  blockers text[];
begin
  actor_id := private.require_employee_manager_target(target_organization_id, target_employee_id);
  if actor_id = target_employee_id then
    raise exception 'You cannot permanently delete your own employee record.' using errcode = '42501';
  end if;
  select employee, coalesce(nullif(profile.full_name, ''), profile.email, employee.employee_number)
  into employee_record, employee_name
  from public.employees employee join public.profiles profile on profile.id = employee.profile_id
  where employee.id = target_employee_id and employee.organization_id = target_organization_id
  for update of employee;
  if upper(btrim(coalesce(target_confirmation_number, ''))) <> employee_record.employee_number then
    raise exception 'Enter the exact employee number to confirm permanent deletion.' using errcode = '23514';
  end if;
  if employee_record.status <> 'archived' then
    raise exception 'Archive this employee before permanently deleting the record.' using errcode = '23514';
  end if;
  if private.employee_has_permission(target_organization_id, target_employee_id, 'organization.manage')
    and not exists (
      select 1
      from public.employees manager
      join public.employee_roles manager_role
        on manager_role.organization_id = manager.organization_id
       and manager_role.employee_id = manager.id
      join public.role_permissions role_permission
        on role_permission.organization_id = manager_role.organization_id
       and role_permission.role_id = manager_role.role_id
      where manager.organization_id = target_organization_id
        and manager.id <> target_employee_id
        and manager.status = 'active'
        and role_permission.permission_code = 'organization.manage'
    ) then
    raise exception 'Assign another active organization manager before deleting the last manager.' using errcode = '23514';
  end if;
  blockers := private.employee_dependency_tables(target_employee_id);
  if cardinality(blockers) > 0 then
    raise exception 'This employee has recorded business activity and cannot be permanently deleted. Archive them instead.' using errcode = '23514';
  end if;

  update private.employee_pin_credentials
  set updated_by_employee_id = actor_id
  where updated_by_employee_id = target_employee_id and employee_id <> target_employee_id;
  update public.audit_logs
  set actor_employee_id = case when actor_employee_id = target_employee_id then null else actor_employee_id end,
      subject_employee_id = case when subject_employee_id = target_employee_id then null else subject_employee_id end,
      metadata = metadata || jsonb_build_object(
        'employee_snapshot', jsonb_build_object(
          'id', target_employee_id,
          'employee_number', employee_record.employee_number,
          'employee_name', employee_name
        )
      )
  where event_type like 'EMPLOYEE\_%' escape '\'
    and (actor_employee_id = target_employee_id or subject_employee_id = target_employee_id);
  delete from public.employees
  where id = target_employee_id and organization_id = target_organization_id;

  perform private.write_audit_log(
    target_organization_id, 'EMPLOYEE_PERMANENTLY_DELETED', 'employees.manage', actor_id,
    null, null, null, null, null, null,
    jsonb_build_object('deleted_employee_id', target_employee_id, 'employee_number', employee_record.employee_number, 'employee_name', employee_name)
  );
  return target_employee_id;
end;
$$;

-- Harden PIN management to the manager's employee/store scope. Lifecycle
-- transitions remove credentials so reactivation requires a deliberate reset.
create or replace function private.set_employee_pin(
  target_organization_id uuid,
  target_employee_id uuid,
  target_pin text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
begin
  actor_employee_id := private.current_employee_id(target_organization_id);
  if actor_employee_id is null then
    raise exception 'An active employee is required.' using errcode = '42501';
  end if;
  if actor_employee_id is distinct from target_employee_id and (
    not private.has_permission(target_organization_id, 'employees.manage')
    or not private.can_access_employee_store_scope(target_organization_id, target_employee_id)
  ) then
    raise exception 'Employee-management permission for this employee is required.' using errcode = '42501';
  end if;
  if coalesce(target_pin, '') !~ '^[0-9]{6,12}$' then
    raise exception 'Use a 6 to 12 digit PIN.' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.employees employee
    where employee.id = target_employee_id
      and employee.organization_id = target_organization_id
      and employee.status = 'active'
  ) then
    raise exception 'The employee is not active in this organization.' using errcode = '23514';
  end if;
  insert into private.employee_pin_credentials (
    employee_id, pin_hash, failed_attempts, failed_window_started_at,
    locked_until, updated_by_employee_id, updated_at
  ) values (
    target_employee_id, extensions.crypt(target_pin, extensions.gen_salt('bf', 12)),
    0, null, null, actor_employee_id, now()
  ) on conflict (employee_id) do update
  set pin_hash = excluded.pin_hash, failed_attempts = 0,
      failed_window_started_at = null, locked_until = null,
      updated_by_employee_id = excluded.updated_by_employee_id, updated_at = now();
  perform private.write_audit_log(
    target_organization_id, 'EMPLOYEE_PIN_SET', null, actor_employee_id,
    target_employee_id, null, null, null, null, null, '{}'::jsonb
  );
end;
$$;

create or replace function public.get_attendance_employees(target_organization_id uuid, target_store_id uuid)
returns table (
  employee_id uuid, employee_number text, employee_name text, pin_is_set boolean,
  entry_id uuid, entry_store_id uuid, entry_store_name text, clocked_in_at timestamptz
)
language sql security invoker set search_path = ''
as $$ select * from private.get_attendance_employees(target_organization_id, target_store_id); $$;

create or replace function public.clock_in_employee_with_pin(
  target_organization_id uuid, target_store_id uuid, target_employee_id uuid,
  target_pin text, target_request_id uuid
)
returns table (
  result_code text, message text, entry_id uuid, employee_id uuid, employee_name text,
  store_id uuid, store_name text, clocked_in_at timestamptz, clocked_out_at timestamptz,
  was_replayed boolean, shift_id uuid, register_id uuid, register_name text, shift_opened_at timestamptz
)
language sql security invoker set search_path = ''
as $$ select * from private.clock_in_employee_with_pin(target_organization_id, target_store_id, target_employee_id, target_pin, target_request_id); $$;

create or replace function public.clock_out_employee_with_pin(
  target_organization_id uuid, target_employee_id uuid, target_pin text, target_request_id uuid
)
returns table (
  result_code text, message text, entry_id uuid, employee_id uuid, employee_name text,
  store_id uuid, store_name text, clocked_in_at timestamptz, clocked_out_at timestamptz,
  was_replayed boolean, shift_id uuid, register_id uuid, register_name text, shift_opened_at timestamptz
)
language sql security invoker set search_path = ''
as $$ select * from private.clock_out_employee_with_pin(target_organization_id, target_employee_id, target_pin, target_request_id); $$;

create or replace function public.change_employee_lifecycle(
  target_organization_id uuid, target_employee_id uuid, target_action text, target_reason text
)
returns text language sql security invoker set search_path = ''
as $$ select private.change_employee_lifecycle(target_organization_id, target_employee_id, target_action, target_reason); $$;

create or replace function public.get_employee_management_detail(target_organization_id uuid, target_employee_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.get_employee_management_detail(target_organization_id, target_employee_id); $$;

create or replace function public.update_employee_profile(
  target_organization_id uuid, target_employee_id uuid, target_full_name text, target_phone text
)
returns void language sql security invoker set search_path = ''
as $$ select private.update_employee_profile(target_organization_id, target_employee_id, target_full_name, target_phone); $$;

create or replace function public.delete_employee_if_eligible(
  target_organization_id uuid, target_employee_id uuid, target_confirmation_number text
)
returns uuid language sql security invoker set search_path = ''
as $$ select private.delete_employee_if_eligible(target_organization_id, target_employee_id, target_confirmation_number); $$;

revoke execute on function public.clock_in_employee(uuid, uuid, text), public.clock_out_employee(uuid, text)
from authenticated;

revoke execute on function private.require_attendance_terminal(uuid, uuid),
  private.verify_attendance_employee_pin(uuid, uuid, uuid, text, uuid),
  private.get_attendance_employees(uuid, uuid),
  private.clock_in_employee_with_pin(uuid, uuid, uuid, text, uuid),
  private.clock_out_employee_with_pin(uuid, uuid, text, uuid),
  private.employee_dependency_tables(uuid),
  private.require_employee_manager_target(uuid, uuid),
  private.change_employee_lifecycle(uuid, uuid, text, text),
  private.get_employee_management_detail(uuid, uuid),
  private.update_employee_profile(uuid, uuid, text, text),
  private.delete_employee_if_eligible(uuid, uuid, text)
from public, anon, authenticated, service_role;

grant execute on function private.get_attendance_employees(uuid, uuid),
  private.clock_in_employee_with_pin(uuid, uuid, uuid, text, uuid),
  private.clock_out_employee_with_pin(uuid, uuid, text, uuid),
  private.change_employee_lifecycle(uuid, uuid, text, text),
  private.get_employee_management_detail(uuid, uuid),
  private.update_employee_profile(uuid, uuid, text, text),
  private.delete_employee_if_eligible(uuid, uuid, text)
to authenticated;

revoke execute on function public.get_attendance_employees(uuid, uuid),
  public.clock_in_employee_with_pin(uuid, uuid, uuid, text, uuid),
  public.clock_out_employee_with_pin(uuid, uuid, text, uuid),
  public.change_employee_lifecycle(uuid, uuid, text, text),
  public.get_employee_management_detail(uuid, uuid),
  public.update_employee_profile(uuid, uuid, text, text),
  public.delete_employee_if_eligible(uuid, uuid, text)
from public, anon, service_role;

grant execute on function public.get_attendance_employees(uuid, uuid),
  public.clock_in_employee_with_pin(uuid, uuid, uuid, text, uuid),
  public.clock_out_employee_with_pin(uuid, uuid, text, uuid),
  public.change_employee_lifecycle(uuid, uuid, text, text),
  public.get_employee_management_detail(uuid, uuid),
  public.update_employee_profile(uuid, uuid, text, text),
  public.delete_employee_if_eligible(uuid, uuid, text)
to authenticated;

comment on function public.clock_in_employee_with_pin(uuid, uuid, uuid, text, uuid)
is 'PIN-verifies an active assigned employee and creates one attendance entry without opening a register shift.';
comment on function public.clock_out_employee_with_pin(uuid, uuid, text, uuid)
is 'PIN-verifies the attendance owner and blocks clock-out while that employee owns an open register shift.';
comment on function public.delete_employee_if_eligible(uuid, uuid, text)
is 'Permanently deletes only employees with no historical foreign-key dependencies; role/store/PIN rows are credentials, not history.';

notify pgrst, 'reload schema';

commit;
