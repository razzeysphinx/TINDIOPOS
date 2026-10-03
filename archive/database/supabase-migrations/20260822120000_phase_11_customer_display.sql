-- TINDIO Phase 11: secure, capability-linked customer display sessions.
-- This table stores presentation state only. Sales, payments, and stock remain
-- authoritative in their existing immutable ledgers and checkout routines.

begin;

create table public.customer_display_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  store_id uuid not null references public.stores (id) on delete restrict,
  register_id uuid not null references public.registers (id) on delete restrict,
  access_token_hash text not null check (access_token_hash ~ '^[0-9a-f]{64}$'),
  realtime_topic text not null check (realtime_topic ~ '^[A-Za-z0-9_-]{32,128}$'),
  current_state jsonb not null default '{"status":"idle","items":[]}'::jsonb
    check (jsonb_typeof(current_state) = 'object'),
  is_active boolean not null default true,
  created_by_employee_id uuid not null references public.employees (id) on delete restrict,
  last_published_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_display_sessions_active_revocation_check check (
    (is_active and revoked_at is null) or (not is_active and revoked_at is not null)
  )
);

create unique index customer_display_sessions_active_register_unique_idx
  on public.customer_display_sessions (organization_id, register_id)
  where is_active;

create unique index customer_display_sessions_realtime_topic_unique_idx
  on public.customer_display_sessions (realtime_topic);

create index customer_display_sessions_token_lookup_idx
  on public.customer_display_sessions (access_token_hash)
  where is_active;

create trigger customer_display_sessions_set_updated_at
before update on public.customer_display_sessions
for each row execute function private.set_updated_at();

alter table public.customer_display_sessions enable row level security;

create or replace function private.provision_customer_display_session(
  target_organization_id uuid,
  target_register_id uuid,
  target_access_token_hash text,
  target_realtime_topic text
)
returns table (session_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_store_id uuid;
  actor_employee_id uuid;
  new_session_id uuid;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'registers.manage')) then
    raise exception 'Register management permission is required.' using errcode = '42501';
  end if;

  if target_access_token_hash !~ '^[0-9a-f]{64}$'
    or target_realtime_topic !~ '^[A-Za-z0-9_-]{32,128}$' then
    raise exception 'The customer display pairing values are invalid.' using errcode = '22023';
  end if;

  select register.store_id
  into resolved_store_id
  from public.registers register
  where register.id = target_register_id
    and register.organization_id = target_organization_id
    and register.is_active;

  if resolved_store_id is null then
    raise exception 'Choose an active register in this organization.' using errcode = '23514';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active';

  if actor_employee_id is null then
    raise exception 'An active employee assignment is required.' using errcode = '42501';
  end if;

  update public.customer_display_sessions display
  set
    is_active = false,
    revoked_at = now()
  where display.organization_id = target_organization_id
    and display.register_id = target_register_id
    and display.is_active;

  insert into public.customer_display_sessions (
    organization_id,
    store_id,
    register_id,
    access_token_hash,
    realtime_topic,
    created_by_employee_id
  )
  values (
    target_organization_id,
    resolved_store_id,
    target_register_id,
    target_access_token_hash,
    target_realtime_topic,
    actor_employee_id
  )
  returning id into new_session_id;

  return query select new_session_id;
end;
$$;

create or replace function public.provision_customer_display_session(
  target_organization_id uuid,
  target_register_id uuid,
  target_access_token_hash text,
  target_realtime_topic text
)
returns table (session_id uuid)
language sql
security invoker
set search_path = ''
as $$
  select * from private.provision_customer_display_session($1, $2, $3, $4);
$$;

create or replace function private.get_customer_display_management_sessions(
  target_organization_id uuid
)
returns table (
  register_id uuid,
  created_at timestamptz,
  last_published_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'registers.manage')) then
    raise exception 'Register management permission is required.' using errcode = '42501';
  end if;

  return query
  select display.register_id, display.created_at, display.last_published_at
  from public.customer_display_sessions display
  where display.organization_id = target_organization_id
    and display.is_active;
end;
$$;

create or replace function public.get_customer_display_management_sessions(
  target_organization_id uuid
)
returns table (
  register_id uuid,
  created_at timestamptz,
  last_published_at timestamptz
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.get_customer_display_management_sessions($1);
$$;

create or replace function private.get_pos_customer_display_sessions(
  target_organization_id uuid
)
returns table (
  register_id uuid,
  realtime_topic text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'sales.create')) then
    raise exception 'Sales permission is required.' using errcode = '42501';
  end if;

  return query
  select display.register_id, display.realtime_topic
  from public.customer_display_sessions display
  where display.organization_id = target_organization_id
    and display.is_active
    and exists (
      select 1
      from public.employees employee
      join public.employee_stores employee_store
        on employee_store.employee_id = employee.id
       and employee_store.organization_id = employee.organization_id
      where employee.organization_id = target_organization_id
        and employee.profile_id = (select auth.uid())
        and employee.status = 'active'
        and employee_store.store_id = display.store_id
    );
end;
$$;

create or replace function public.get_pos_customer_display_sessions(
  target_organization_id uuid
)
returns table (
  register_id uuid,
  realtime_topic text
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.get_pos_customer_display_sessions($1);
$$;

create or replace function private.set_customer_display_state(
  target_organization_id uuid,
  target_session_id uuid,
  target_state jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_store_id uuid;
  resolved_register_id uuid;
  actor_employee_id uuid;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'sales.create')) then
    raise exception 'Sales permission is required.' using errcode = '42501';
  end if;

  if target_state is null or jsonb_typeof(target_state) <> 'object' then
    raise exception 'Customer display state must be an object.' using errcode = '22023';
  end if;

  select display.store_id, display.register_id
  into resolved_store_id, resolved_register_id
  from public.customer_display_sessions display
  where display.id = target_session_id
    and display.organization_id = target_organization_id
    and display.is_active
  for update;

  if resolved_register_id is null then
    raise exception 'The customer display is unavailable.' using errcode = 'P0002';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active';

  if actor_employee_id is null or not exists (
    select 1
    from public.shifts shift
    where shift.organization_id = target_organization_id
      and shift.store_id = resolved_store_id
      and shift.register_id = resolved_register_id
      and shift.opened_by_employee_id = actor_employee_id
      and shift.status = 'open'
  ) then
    raise exception 'An open shift on this display register is required.' using errcode = '42501';
  end if;

  update public.customer_display_sessions display
  set
    current_state = target_state,
    last_published_at = now()
  where display.id = target_session_id
    and display.organization_id = target_organization_id;
end;
$$;

create or replace function public.set_customer_display_state(
  target_organization_id uuid,
  target_session_id uuid,
  target_state jsonb
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.set_customer_display_state($1, $2, $3);
$$;

create or replace function public.get_customer_display_bootstrap(
  target_access_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  display_bootstrap jsonb;
begin
  if target_access_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'This customer display link is unavailable.' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'business_name', organization.name,
    'store_name', store.name,
    'register_name', register.name,
    'realtime_topic', display.realtime_topic,
    'current_state', display.current_state,
    'updated_at', display.updated_at
  )
  into display_bootstrap
  from public.customer_display_sessions display
  join public.organizations organization
    on organization.id = display.organization_id
  join public.stores store
    on store.id = display.store_id
  join public.registers register
    on register.id = display.register_id
  where display.access_token_hash = target_access_token_hash
    and display.is_active;

  if display_bootstrap is null then
    raise exception 'This customer display link is unavailable.' using errcode = 'P0002';
  end if;

  return display_bootstrap;
end;
$$;

revoke all on table public.customer_display_sessions from public, anon, authenticated;

revoke execute on function
  private.provision_customer_display_session(uuid, uuid, text, text),
  private.get_customer_display_management_sessions(uuid),
  private.get_pos_customer_display_sessions(uuid),
  private.set_customer_display_state(uuid, uuid, jsonb)
from public, anon, authenticated, service_role;

revoke execute on function
  public.provision_customer_display_session(uuid, uuid, text, text),
  public.get_customer_display_management_sessions(uuid),
  public.get_pos_customer_display_sessions(uuid),
  public.set_customer_display_state(uuid, uuid, jsonb),
  public.get_customer_display_bootstrap(text)
from public, anon, authenticated, service_role;

grant usage on schema private to authenticated;
grant execute on function
  private.provision_customer_display_session(uuid, uuid, text, text),
  private.get_customer_display_management_sessions(uuid),
  private.get_pos_customer_display_sessions(uuid),
  private.set_customer_display_state(uuid, uuid, jsonb)
to authenticated;

grant execute on function
  public.provision_customer_display_session(uuid, uuid, text, text),
  public.get_customer_display_management_sessions(uuid),
  public.get_pos_customer_display_sessions(uuid),
  public.set_customer_display_state(uuid, uuid, jsonb)
to authenticated;

grant execute on function public.get_customer_display_bootstrap(text)
to anon, authenticated;

comment on table public.customer_display_sessions
is 'Phase 11 ephemeral customer-facing display state. Direct Data API access is disabled; access is mediated by scoped functions and an opaque pairing capability.';

comment on function public.get_customer_display_bootstrap(text)
is 'Returns only the sanitized state and Realtime topic for one opaque 256-bit customer-display pairing capability.';

commit;
