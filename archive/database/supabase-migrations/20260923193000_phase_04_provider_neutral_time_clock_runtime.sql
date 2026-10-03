begin;

-- Phase 04 Neon provider-neutral runtime repair.
--
-- Identity resolution only.
--
-- Preserve the established time-clock business behavior while replacing the
-- remaining direct auth.uid() dependency with the permanent TINDIO profile
-- identity resolved through the public provider-neutral identity boundary.
--
-- Supabase-only behavior remains compatible because current_profile_id()
-- resolves through the provider-neutral identity bridge there as well.

create or replace function private.clock_in_employee(
  target_organization_id uuid,
  target_store_id uuid,
  target_clock_in_note text default null
)
returns table (
  entry_id uuid,
  store_id uuid,
  clocked_in_at timestamptz,
  clocked_out_at timestamptz,
  was_replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  existing_entry public.time_clock_entries%rowtype;
  normalized_note text :=
    nullif(
      trim(
        coalesce(
          target_clock_in_note,
          ''
        )
      ),
      ''
    );
begin
  if target_organization_id is null
    or target_store_id is null
  then
    raise exception
      'Choose an assigned store before clocking in.'
      using errcode = '23514';
  end if;

  if normalized_note is not null
    and char_length(normalized_note)
      not between 2 and 500
  then
    raise exception
      'A clock-in note must contain between 2 and 500 characters.'
      using errcode = '23514';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  join public.employee_stores employee_store
    on employee_store.employee_id =
      employee.id
   and employee_store.organization_id =
      employee.organization_id
   and employee_store.store_id =
      target_store_id
  join public.stores store
    on store.id =
      employee_store.store_id
   and store.organization_id =
      employee_store.organization_id
   and store.is_active
  where employee.organization_id =
      target_organization_id
    and employee.profile_id =
      (
        select public.current_profile_id()
      )
    and employee.status =
      'active'
  for key share
  of employee, store;

  if actor_employee_id is null
  then
    raise exception
      'An active employee assignment for this store is required.'
      using errcode = '42501';
  end if;

  select entry.*
  into existing_entry
  from public.time_clock_entries entry
  where entry.organization_id =
      target_organization_id
    and entry.employee_id =
      actor_employee_id
    and entry.clocked_out_at is null
  for update;

  if existing_entry.id is not null
  then
    if existing_entry.store_id =
      target_store_id
    then
      return query
      select
        existing_entry.id,
        existing_entry.store_id,
        existing_entry.clocked_in_at,
        existing_entry.clocked_out_at,
        true as was_replayed;

      return;
    end if;

    raise exception
      'Clock out from your current store before clocking in elsewhere.'
      using errcode = '23505';
  end if;

  return query
  insert into public.time_clock_entries as entry (
    organization_id,
    employee_id,
    store_id,
    clock_in_note,
    clocked_in_by_employee_id
  )
  values (
    target_organization_id,
    actor_employee_id,
    target_store_id,
    normalized_note,
    actor_employee_id
  )
  returning
    entry.id,
    entry.store_id,
    entry.clocked_in_at,
    entry.clocked_out_at,
    false as was_replayed;
end;
$$;


create or replace function private.clock_out_employee(
  target_organization_id uuid,
  target_clock_out_note text default null
)
returns table (
  entry_id uuid,
  store_id uuid,
  clocked_in_at timestamptz,
  clocked_out_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  normalized_note text :=
    nullif(
      trim(
        coalesce(
          target_clock_out_note,
          ''
        )
      ),
      ''
    );
begin
  if target_organization_id is null
  then
    raise exception
      'An organization is required to clock out.'
      using errcode = '23514';
  end if;

  if normalized_note is not null
    and char_length(normalized_note)
      not between 2 and 500
  then
    raise exception
      'A clock-out note must contain between 2 and 500 characters.'
      using errcode = '23514';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  where employee.organization_id =
      target_organization_id
    and employee.profile_id =
      (
        select public.current_profile_id()
      )
    and employee.status =
      'active'
  for key share;

  if actor_employee_id is null
  then
    raise exception
      'An active employee is required to clock out.'
      using errcode = '42501';
  end if;

  return query
  update public.time_clock_entries entry
  set
    clocked_out_at = now(),
    clock_out_note = normalized_note,
    clocked_out_by_employee_id = actor_employee_id
  where entry.organization_id =
      target_organization_id
    and entry.employee_id =
      actor_employee_id
    and entry.clocked_out_at is null
  returning
    entry.id,
    entry.store_id,
    entry.clocked_in_at,
    entry.clocked_out_at;

  if not found
  then
    raise exception
      'There is no open time-clock entry to close.'
      using errcode = 'P0002';
  end if;
end;
$$;


create or replace function private.get_current_time_clock_entry(
  target_organization_id uuid
)
returns table (
  entry_id uuid,
  store_id uuid,
  clocked_in_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
begin
  if target_organization_id is null
  then
    raise exception
      'An organization is required for the time clock.'
      using errcode = '23514';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  where employee.organization_id =
      target_organization_id
    and employee.profile_id =
      (
        select public.current_profile_id()
      )
    and employee.status =
      'active';

  if actor_employee_id is null
  then
    raise exception
      'An active employee is required for the time clock.'
      using errcode = '42501';
  end if;

  return query
  select
    entry.id,
    entry.store_id,
    entry.clocked_in_at
  from public.time_clock_entries entry
  where entry.organization_id =
      target_organization_id
    and entry.employee_id =
      actor_employee_id
    and entry.clocked_out_at is null;
end;
$$;


revoke execute
on function private.clock_in_employee(
  uuid,
  uuid,
  text
)
from
  public,
  anon,
  authenticated,
  service_role;

revoke execute
on function private.clock_out_employee(
  uuid,
  text
)
from
  public,
  anon,
  authenticated,
  service_role;

revoke execute
on function private.get_current_time_clock_entry(
  uuid
)
from
  public,
  anon,
  authenticated,
  service_role;

grant execute
on function private.clock_in_employee(
  uuid,
  uuid,
  text
)
to authenticated;

grant execute
on function private.clock_out_employee(
  uuid,
  text
)
to authenticated;

grant execute
on function private.get_current_time_clock_entry(
  uuid
)
to authenticated;


comment on function
  private.clock_in_employee(
    uuid,
    uuid,
    text
  )
is
'Provider-neutral self-service clock-in runtime. Resolves the permanent TINDIO profile through public.current_profile_id while preserving assigned-store, replay, and concurrency behavior.';

comment on function
  private.clock_out_employee(
    uuid,
    text
  )
is
'Provider-neutral self-service clock-out runtime. Resolves the permanent TINDIO profile through public.current_profile_id while preserving existing close semantics.';

comment on function
  private.get_current_time_clock_entry(
    uuid
  )
is
'Provider-neutral current time-clock lookup for the authenticated permanent TINDIO profile.';

commit;
