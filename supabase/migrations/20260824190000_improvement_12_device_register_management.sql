-- TINDIO Improvement Phase 12: secure POS device and register management.
-- A device is enrolled by an owner/admin, bound to one active store/register,
-- and proved with an opaque browser-local credential on each POS operation.

begin;

alter table public.organizations
  add column if not exists device_management_enabled boolean not null default false;

create table public.pos_devices (
  id uuid primary key,
  organization_id uuid not null references public.organizations (id) on delete restrict,
  store_id uuid not null,
  register_id uuid not null,
  name text not null,
  status text not null default 'active',
  app_version text not null default 'web-unknown',
  registered_by_employee_id uuid not null,
  revoked_by_employee_id uuid,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_devices_id_organization_unique unique (id, organization_id),
  constraint pos_devices_store_organization_fkey foreign key (store_id, organization_id)
    references public.stores (id, organization_id) on delete restrict,
  constraint pos_devices_register_organization_fkey foreign key (register_id, organization_id)
    references public.registers (id, organization_id) on delete restrict,
  constraint pos_devices_registered_by_organization_fkey foreign key (registered_by_employee_id, organization_id)
    references public.employees (id, organization_id) on delete restrict,
  constraint pos_devices_revoked_by_organization_fkey foreign key (revoked_by_employee_id, organization_id)
    references public.employees (id, organization_id) on delete restrict,
  constraint pos_devices_name_length_check check (char_length(name) between 2 and 80),
  constraint pos_devices_app_version_length_check check (char_length(app_version) between 1 and 80),
  constraint pos_devices_status_check check (status in ('active', 'revoked')),
  constraint pos_devices_revocation_state_check check (
    (status = 'active' and revoked_at is null and revoked_by_employee_id is null)
    or (status = 'revoked' and revoked_at is not null and revoked_by_employee_id is not null)
  )
);

create index pos_devices_organization_status_seen_idx
  on public.pos_devices (organization_id, status, last_seen_at desc);
create index pos_devices_organization_register_status_idx
  on public.pos_devices (organization_id, register_id, status);

create table private.pos_device_credentials (
  device_id uuid primary key references public.pos_devices (id) on delete cascade,
  secret_hash bytea not null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz not null default now(),
  constraint pos_device_credentials_secret_hash_length_check check (octet_length(secret_hash) = 32)
);

alter table public.pos_devices enable row level security;
alter table private.pos_device_credentials enable row level security;

create policy pos_devices_select_managers
on public.pos_devices for select
to authenticated
using ((select private.has_permission(organization_id, 'devices.manage')));

revoke all on table public.pos_devices from public, anon, authenticated, service_role;
grant select on table public.pos_devices to authenticated;
revoke all on table private.pos_device_credentials from public, anon, authenticated, service_role;

create trigger pos_devices_set_updated_at
before update on public.pos_devices
for each row execute function private.set_updated_at();

-- Only an approved security-definer workflow can enable the irreversible
-- enforcement switch. Revoking every device deliberately leaves POS locked.
create or replace function private.guard_device_management_enabled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.device_management_enabled is distinct from old.device_management_enabled
    and coalesce(current_setting('tindio.device_management_change', true), '') <> 'authorized' then
    raise exception 'Device-management enforcement can only be changed through the device management workflow.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function private.guard_device_management_enabled()
from public, anon, authenticated, service_role;

create trigger organizations_guard_device_management_enabled
before update of device_management_enabled on public.organizations
for each row execute function private.guard_device_management_enabled();

create or replace function private.require_device_manager(
  target_organization_id uuid
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
    or not (select private.has_permission(target_organization_id, 'devices.manage')) then
    raise exception 'Device-management permission is required.' using errcode = '42501';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active';

  if actor_employee_id is null then
    raise exception 'An active employee membership is required.' using errcode = '42501';
  end if;

  return actor_employee_id;
end;
$$;

create or replace function private.require_active_device_binding(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.stores store
    join public.registers register
      on register.id = target_register_id
     and register.organization_id = store.organization_id
     and register.store_id = store.id
     and register.is_active
    where store.id = target_store_id
      and store.organization_id = target_organization_id
      and store.is_active
  ) then
    raise exception 'Choose an active store and register in this organization.' using errcode = '23514';
  end if;
end;
$$;

create or replace function private.verify_pos_device_credential(
  target_organization_id uuid,
  target_device_id uuid,
  target_secret text,
  target_app_version text,
  expected_store_id uuid default null,
  expected_register_id uuid default null
)
returns table (
  device_id uuid,
  store_id uuid,
  register_id uuid,
  device_name text,
  app_version text,
  last_seen_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  device_record public.pos_devices%rowtype;
  normalized_app_version text;
begin
  if target_organization_id is null
    or target_device_id is null
    or target_secret is null
    or target_secret !~ '^[0-9A-Fa-f]{64}$' then
    raise exception 'This POS device credential is invalid.' using errcode = '42501';
  end if;

  normalized_app_version := nullif(left(trim(coalesce(target_app_version, '')), 80), '');

  select device.*
  into device_record
  from public.pos_devices device
  join private.pos_device_credentials credential
    on credential.device_id = device.id
  where device.id = target_device_id
    and device.organization_id = target_organization_id
    and device.status = 'active'
    and credential.secret_hash = extensions.digest(target_secret, 'sha256')
    and (expected_store_id is null or device.store_id = expected_store_id)
    and (expected_register_id is null or device.register_id = expected_register_id)
  for update of device;

  if device_record.id is null then
    raise exception 'This POS device is not active for the selected register.' using errcode = '42501';
  end if;

  update public.pos_devices device
  set
    last_seen_at = now(),
    app_version = coalesce(normalized_app_version, device.app_version)
  where device.id = device_record.id
  returning device.last_seen_at, device.app_version
  into last_seen_at, app_version;

  device_id := device_record.id;
  store_id := device_record.store_id;
  register_id := device_record.register_id;
  device_name := device_record.name;
  return next;
end;
$$;

create or replace function private.require_active_pos_device(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  device_management_required boolean;
  request_headers jsonb;
  requested_device_id_text text;
  requested_secret text;
  requested_app_version text;
  verified_device_id uuid;
begin
  select organization.device_management_enabled
  into device_management_required
  from public.organizations organization
  where organization.id = target_organization_id;

  if not coalesce(device_management_required, false) then
    return null;
  end if;

  begin
    request_headers := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  exception when others then
    raise exception 'This POS device credential is invalid.' using errcode = '42501';
  end;

  requested_device_id_text := nullif(request_headers ->> 'x-tindio-device-id', '');
  requested_secret := nullif(request_headers ->> 'x-tindio-device-secret', '');
  requested_app_version := nullif(request_headers ->> 'x-tindio-app-version', '');

  if requested_device_id_text is null
    or requested_device_id_text !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' then
    raise exception 'This POS device needs to be enrolled before it can use the register.'
      using errcode = '42501';
  end if;

  select verified.device_id
  into verified_device_id
  from private.verify_pos_device_credential(
    target_organization_id,
    requested_device_id_text::uuid,
    requested_secret,
    requested_app_version,
    target_store_id,
    target_register_id
  ) verified;

  return verified_device_id;
end;
$$;

create or replace function public.register_pos_device(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid,
  target_device_id uuid,
  target_name text,
  target_app_version text,
  target_secret text
)
returns table (
  device_id uuid,
  store_id uuid,
  register_id uuid,
  status text,
  last_seen_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  normalized_name text;
  normalized_app_version text;
begin
  actor_employee_id := private.require_device_manager(target_organization_id);
  perform private.require_active_device_binding(
    target_organization_id,
    target_store_id,
    target_register_id
  );

  normalized_name := left(trim(coalesce(target_name, '')), 80);
  normalized_app_version := left(trim(coalesce(target_app_version, '')), 80);

  if target_device_id is null
    or normalized_name !~ '^.{2,80}$'
    or normalized_app_version !~ '^.{1,80}$'
    or target_secret is null
    or target_secret !~ '^[0-9A-Fa-f]{64}$' then
    raise exception 'The device name, application version, or secure credential is invalid.'
      using errcode = '23514';
  end if;

  insert into public.pos_devices (
    id,
    organization_id,
    store_id,
    register_id,
    name,
    status,
    app_version,
    registered_by_employee_id,
    last_seen_at
  )
  values (
    target_device_id,
    target_organization_id,
    target_store_id,
    target_register_id,
    normalized_name,
    'active',
    normalized_app_version,
    actor_employee_id,
    now()
  );

  insert into private.pos_device_credentials (device_id, secret_hash)
  values (target_device_id, extensions.digest(target_secret, 'sha256'));

  perform set_config('tindio.device_management_change', 'authorized', true);
  update public.organizations organization
  set device_management_enabled = true
  where organization.id = target_organization_id;

  perform private.write_audit_log(
    target_organization_id,
    'DEVICE_REGISTERED',
    'devices.register',
    actor_employee_id,
    null,
    target_store_id,
    target_register_id,
    null,
    null,
    null,
    jsonb_build_object('device_id', target_device_id, 'device_name', normalized_name, 'app_version', normalized_app_version)
  );

  return query
  select device.id, device.store_id, device.register_id, device.status, device.last_seen_at
  from public.pos_devices device
  where device.id = target_device_id;
end;
$$;

create or replace function public.change_pos_device_register(
  target_organization_id uuid,
  target_device_id uuid,
  target_store_id uuid,
  target_register_id uuid
)
returns table (
  device_id uuid,
  store_id uuid,
  register_id uuid,
  status text,
  last_seen_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  device_record public.pos_devices%rowtype;
begin
  actor_employee_id := private.require_device_manager(target_organization_id);
  perform private.require_active_device_binding(
    target_organization_id,
    target_store_id,
    target_register_id
  );

  select device.*
  into device_record
  from public.pos_devices device
  where device.id = target_device_id
    and device.organization_id = target_organization_id
    and device.status = 'active'
  for update;

  if device_record.id is null then
    raise exception 'The active POS device was not found.' using errcode = 'P0002';
  end if;

  update public.pos_devices device
  set store_id = target_store_id, register_id = target_register_id
  where device.id = device_record.id;

  perform private.write_audit_log(
    target_organization_id,
    'DEVICE_REGISTER_CHANGED',
    'devices.change_register',
    actor_employee_id,
    null,
    target_store_id,
    target_register_id,
    null,
    null,
    null,
    jsonb_build_object(
      'device_id', target_device_id,
      'previous_store_id', device_record.store_id,
      'previous_register_id', device_record.register_id,
      'store_id', target_store_id,
      'register_id', target_register_id
    )
  );

  return query
  select device.id, device.store_id, device.register_id, device.status, device.last_seen_at
  from public.pos_devices device
  where device.id = device_record.id;
end;
$$;

create or replace function public.revoke_pos_device(
  target_organization_id uuid,
  target_device_id uuid,
  target_reason text default null
)
returns table (
  device_id uuid,
  status text,
  revoked_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  device_record public.pos_devices%rowtype;
  normalized_reason text;
begin
  actor_employee_id := private.require_device_manager(target_organization_id);
  normalized_reason := nullif(left(trim(coalesce(target_reason, '')), 500), '');

  select device.*
  into device_record
  from public.pos_devices device
  where device.id = target_device_id
    and device.organization_id = target_organization_id
    and device.status = 'active'
  for update;

  if device_record.id is null then
    raise exception 'The active POS device was not found.' using errcode = 'P0002';
  end if;

  update public.pos_devices device
  set
    status = 'revoked',
    revoked_at = now(),
    revoked_by_employee_id = actor_employee_id
  where device.id = device_record.id
  returning device.revoked_at into revoked_at;

  perform private.write_audit_log(
    target_organization_id,
    'DEVICE_REVOKED',
    'devices.revoke',
    actor_employee_id,
    null,
    device_record.store_id,
    device_record.register_id,
    null,
    null,
    normalized_reason,
    jsonb_build_object('device_id', target_device_id, 'device_name', device_record.name)
  );

  device_id := device_record.id;
  status := 'revoked';
  return next;
end;
$$;

create or replace function public.validate_pos_device(
  target_organization_id uuid,
  target_device_id uuid,
  target_secret text,
  target_app_version text
)
returns table (
  device_id uuid,
  store_id uuid,
  register_id uuid,
  device_name text,
  app_version text,
  last_seen_at timestamptz
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
  select verified.*
  from private.verify_pos_device_credential(
    target_organization_id,
    target_device_id,
    target_secret,
    target_app_version
  ) verified
  where exists (
    select 1
    from public.employees employee
    join public.employee_stores employee_store
      on employee_store.employee_id = employee.id
     and employee_store.organization_id = employee.organization_id
     and employee_store.store_id = verified.store_id
    where employee.organization_id = target_organization_id
      and employee.profile_id = (select auth.uid())
      and employee.status = 'active'
  );

  if not found then
    raise exception 'You are not assigned to this device store.' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.require_active_pos_shift(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  active_shift_id uuid;
begin
  if target_organization_id is null
    or target_store_id is null
    or target_register_id is null then
    raise exception 'A store and register are required for POS activity.' using errcode = '23514';
  end if;

  perform private.require_active_pos_device(
    target_organization_id,
    target_store_id,
    target_register_id
  );

  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'sales.create')) then
    raise exception 'Sales permission is required.' using errcode = '42501';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  join public.employee_stores employee_store
    on employee_store.employee_id = employee.id
   and employee_store.organization_id = employee.organization_id
   and employee_store.store_id = target_store_id
  join public.stores store
    on store.id = employee_store.store_id
   and store.organization_id = employee_store.organization_id
   and store.is_active
  join public.registers register
    on register.id = target_register_id
   and register.organization_id = employee.organization_id
   and register.store_id = target_store_id
   and register.is_active
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active'
  for key share of employee, store, register;

  if actor_employee_id is null then
    raise exception 'An active employee assignment, store, and register are required.'
      using errcode = '42501';
  end if;

  select shift.id
  into active_shift_id
  from public.shifts shift
  where shift.organization_id = target_organization_id
    and shift.store_id = target_store_id
    and shift.register_id = target_register_id
    and shift.opened_by_employee_id = actor_employee_id
    and shift.status = 'open'
  for update;

  if active_shift_id is null then
    raise exception 'Open your register shift before using transactional POS features.'
      using errcode = '42501';
  end if;

  return actor_employee_id;
end;
$$;

create or replace function public.open_register_shift(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid,
  target_opening_cash_minor bigint,
  target_opening_note text
)
returns table (
  shift_id uuid,
  opened_at timestamptz,
  was_replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_active_pos_device(
    target_organization_id,
    target_store_id,
    target_register_id
  );

  return query
  select *
  from private.open_register_shift(
    target_organization_id,
    target_store_id,
    target_register_id,
    target_opening_cash_minor,
    target_opening_note
  );
end;
$$;

revoke execute on function private.require_device_manager(uuid)
from public, anon, authenticated, service_role;
revoke execute on function private.require_active_device_binding(uuid, uuid, uuid)
from public, anon, authenticated, service_role;
revoke execute on function private.verify_pos_device_credential(uuid, uuid, text, text, uuid, uuid)
from public, anon, authenticated, service_role;
revoke execute on function private.require_active_pos_device(uuid, uuid, uuid)
from public, anon, authenticated, service_role;
revoke execute on function private.require_active_pos_shift(uuid, uuid, uuid)
from public, anon, authenticated, service_role;
revoke execute on function public.register_pos_device(uuid, uuid, uuid, uuid, text, text, text)
from public, anon, service_role;
revoke execute on function public.change_pos_device_register(uuid, uuid, uuid, uuid)
from public, anon, service_role;
revoke execute on function public.revoke_pos_device(uuid, uuid, text)
from public, anon, service_role;
revoke execute on function public.validate_pos_device(uuid, uuid, text, text)
from public, anon, service_role;
revoke execute on function public.open_register_shift(uuid, uuid, uuid, bigint, text)
from public, anon, service_role;
grant execute on function public.register_pos_device(uuid, uuid, uuid, uuid, text, text, text)
to authenticated;
grant execute on function public.change_pos_device_register(uuid, uuid, uuid, uuid)
to authenticated;
grant execute on function public.revoke_pos_device(uuid, uuid, text)
to authenticated;
grant execute on function public.validate_pos_device(uuid, uuid, text, text)
to authenticated;
grant execute on function public.open_register_shift(uuid, uuid, uuid, bigint, text)
to authenticated;

comment on table public.pos_devices is
  'Safe, organization-scoped POS device registry. The opaque device secret is stored only as a hash in private.pos_device_credentials.';
comment on column public.pos_devices.id is
  'The stable device_id supplied by the enrolled browser or POS application.';
comment on column public.organizations.device_management_enabled is
  'Once enabled by secure device registration, POS actions require a non-revoked device bound to the target register.';

commit;
