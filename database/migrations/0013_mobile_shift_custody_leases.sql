-- Server-visible custody for mobile devices that may accept cash while disconnected.
-- Active leases never expire implicitly: only an authenticated, fully reconciled
-- device finalization can clear one. Terminal-loss override is deliberately not
-- part of this migration.

begin;

create table if not exists private.pos_shift_custody_leases (
  organization_id uuid not null,
  shift_id uuid not null,
  device_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  state text not null default 'ACTIVE',
  acquired_at timestamptz not null default now(),
  last_renewed_at timestamptz not null default now(),
  cleared_at timestamptz,
  cleared_server_sequence bigint,
  finalization_token uuid,
  primary key (organization_id, shift_id, device_id),
  constraint pos_shift_custody_leases_state_check
    check (state in ('ACTIVE', 'CLEARED')),
  constraint pos_shift_custody_leases_clear_state_check
    check (
      (state = 'ACTIVE' and cleared_at is null and cleared_server_sequence is null and finalization_token is null)
      or
      (state = 'CLEARED' and cleared_at is not null and cleared_server_sequence is not null and finalization_token is not null)
    ),
  constraint pos_shift_custody_leases_sequence_check
    check (cleared_server_sequence is null or cleared_server_sequence >= 0),
  constraint pos_shift_custody_leases_organization_fkey
    foreign key (organization_id) references public.organizations(id) on delete restrict,
  constraint pos_shift_custody_leases_shift_fkey
    foreign key (shift_id) references public.shifts(id) on delete restrict,
  constraint pos_shift_custody_leases_device_fkey
    foreign key (device_id) references public.pos_devices(id) on delete restrict
);

create unique index if not exists pos_shift_custody_finalization_token_idx
  on private.pos_shift_custody_leases (organization_id, finalization_token)
  where finalization_token is not null;

create index if not exists pos_shift_custody_active_shift_idx
  on private.pos_shift_custody_leases (organization_id, shift_id, device_id)
  where state = 'ACTIVE';

comment on table private.pos_shift_custody_leases is
  'Server-visible custody barrier for devices authorized to accept disconnected cash. ACTIVE rows never expire automatically.';

alter table private.pos_shift_custody_leases enable row level security;
revoke all on table private.pos_shift_custody_leases from public;
revoke all on table private.pos_shift_custody_leases from tindio_anon;
revoke all on table private.pos_shift_custody_leases from tindio_authenticated;
revoke all on table private.pos_shift_custody_leases from tindio_service;

create or replace function private.require_enrolled_offline_pos_device(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_headers jsonb;
  requested_device_id_text text;
  requested_secret text;
  requested_app_version text;
  verified_device_id uuid;
begin
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
    raise exception 'An enrolled POS device is required for offline transaction custody.' using errcode = '42501';
  end if;
  select verified.device_id into verified_device_id
  from private.verify_pos_device_credential(
    target_organization_id, requested_device_id_text::uuid, requested_secret,
    requested_app_version, target_store_id, target_register_id
  ) verified;
  if verified_device_id is null then
    raise exception 'This POS device credential is invalid.' using errcode = '42501';
  end if;
  return verified_device_id;
end;
$$;

revoke all on function private.require_enrolled_offline_pos_device(uuid,uuid,uuid) from public;
revoke all on function private.require_enrolled_offline_pos_device(uuid,uuid,uuid) from tindio_anon;
revoke all on function private.require_enrolled_offline_pos_device(uuid,uuid,uuid) from tindio_authenticated;
revoke all on function private.require_enrolled_offline_pos_device(uuid,uuid,uuid) from tindio_service;

create or replace function private.acquire_pos_shift_custody(
  target_organization_id uuid,
  target_shift_id uuid
) returns table(device_id uuid, shift_id uuid, state text, acquired_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_shift public.shifts%rowtype;
  verified_device_id uuid;
  actor_employee_id uuid;
begin
  select candidate.* into target_shift
  from public.shifts candidate
  where candidate.organization_id = target_organization_id
    and candidate.id = target_shift_id
    and candidate.status = 'open'
  for update;

  if target_shift.id is null then
    raise exception 'An open shift is required before offline custody can be granted.' using errcode = 'P0002';
  end if;

  actor_employee_id := private.current_employee_id(target_organization_id);
  if actor_employee_id is null or target_shift.opened_by_employee_id is distinct from actor_employee_id then
    raise exception 'Only the employee who opened this shift can prepare it for offline use.' using errcode = '42501';
  end if;

  verified_device_id := private.require_enrolled_offline_pos_device(
    target_organization_id,
    target_shift.store_id,
    target_shift.register_id
  );

  insert into private.pos_shift_custody_leases (
    organization_id, shift_id, device_id, store_id, register_id, state,
    acquired_at, last_renewed_at, cleared_at, cleared_server_sequence, finalization_token
  ) values (
    target_organization_id, target_shift.id, verified_device_id,
    target_shift.store_id, target_shift.register_id, 'ACTIVE',
    now(), now(), null, null, null
  )
  on conflict (organization_id, shift_id, device_id) do update
  set state = 'ACTIVE', last_renewed_at = now(), cleared_at = null,
      cleared_server_sequence = null, finalization_token = null;

  return query
  select lease.device_id, lease.shift_id, lease.state, lease.acquired_at
  from private.pos_shift_custody_leases lease
  where lease.organization_id = target_organization_id
    and lease.shift_id = target_shift.id
    and lease.device_id = verified_device_id;
end;
$$;

create or replace function public.acquire_pos_shift_custody(
  target_organization_id uuid,
  target_shift_id uuid
) returns table(device_id uuid, shift_id uuid, state text, acquired_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select * from private.acquire_pos_shift_custody(target_organization_id, target_shift_id);
$$;

create or replace function private.block_device_change_with_active_custody()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.store_id, old.register_id, old.status)
      is distinct from (new.store_id, new.register_id, new.status)
    and exists (
      select 1 from private.pos_shift_custody_leases lease
      where lease.organization_id = old.organization_id
        and lease.device_id = old.id
        and lease.state = 'ACTIVE'
    ) then
    raise exception 'This device has active offline shift custody. Reconcile and close the shift before reassigning or revoking it.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists block_pos_device_change_with_active_custody on public.pos_devices;
create trigger block_pos_device_change_with_active_custody
before update of store_id, register_id, status on public.pos_devices
for each row execute function private.block_device_change_with_active_custody();

create or replace function private.close_register_shift(
  target_organization_id uuid,
  target_shift_id uuid,
  target_counted_cash_minor bigint,
  target_closing_note text
) returns table(shift_id uuid, expected_cash_minor bigint, counted_cash_minor bigint, difference_minor bigint, closed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  target_shift public.shifts%rowtype;
  calculated_cash record;
  normalized_closing_note text;
begin
  if target_organization_id is null or target_shift_id is null
    or target_counted_cash_minor is null or target_counted_cash_minor < 0 then
    raise exception 'A shift and non-negative counted cash amount are required.' using errcode = '23514';
  end if;
  if private.current_profile_id() is null
    or not private.has_permission(target_organization_id, 'shifts.close') then
    raise exception 'Shift closing permission is required.' using errcode = '42501';
  end if;
  normalized_closing_note := nullif(trim(coalesce(target_closing_note, '')), '');
  if normalized_closing_note is not null and char_length(normalized_closing_note) not between 2 and 500 then
    raise exception 'A closing note must contain between 2 and 500 characters.' using errcode = '23514';
  end if;
  select candidate.* into target_shift
  from public.shifts candidate
  where candidate.id = target_shift_id and candidate.organization_id = target_organization_id and candidate.status = 'open'
  for update;
  if target_shift.id is null then
    raise exception 'The open shift was not found.' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from private.pos_shift_custody_leases lease
    where lease.organization_id = target_organization_id
      and lease.shift_id = target_shift.id and lease.state = 'ACTIVE'
  ) then
    raise exception 'Shift close blocked while a device has active offline transaction custody.' using errcode = '23514';
  end if;
  select employee.id into actor_employee_id
  from public.employees employee
  join public.employee_stores assignment
    on assignment.employee_id = employee.id and assignment.organization_id = employee.organization_id
   and assignment.store_id = target_shift.store_id
  where employee.organization_id = target_organization_id
    and employee.profile_id = private.current_profile_id() and employee.status = 'active';
  if actor_employee_id is null then
    raise exception 'An active employee assignment for this shift store is required.' using errcode = '42501';
  end if;
  if target_shift.opened_by_employee_id is distinct from actor_employee_id then
    raise exception 'Only the employee who opened this shift can close it.' using errcode = '42501';
  end if;
  select * into calculated_cash from private.calculate_shift_cash(target_shift.id);
  return query update public.shifts candidate
  set status='closed', closed_by_employee_id=actor_employee_id,
      expected_cash_minor=calculated_cash.expected_cash_minor,
      counted_cash_minor=target_counted_cash_minor,
      difference_minor=target_counted_cash_minor-calculated_cash.expected_cash_minor,
      closing_note=normalized_closing_note, closed_at=now()
  where candidate.id=target_shift.id and candidate.organization_id=target_organization_id
  returning candidate.id,candidate.expected_cash_minor,candidate.counted_cash_minor,candidate.difference_minor,candidate.closed_at;
end;
$$;

create or replace function public.close_register_shift_mobile(
  target_organization_id uuid,
  target_shift_id uuid,
  target_counted_cash_minor bigint,
  target_closing_note text,
  target_local_high_water bigint,
  target_finalization_token uuid
) returns table(shift_id uuid, expected_cash_minor bigint, counted_cash_minor bigint, difference_minor bigint, closed_at timestamptz, closed boolean, was_replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_shift public.shifts%rowtype;
  verified_device_id uuid;
  actor_employee_id uuid;
  current_checkpoint bigint;
  linked_token uuid;
  linked_state text;
  closed_result record;
begin
  if target_local_high_water is null or target_local_high_water < 0 or target_finalization_token is null then
    raise exception 'A valid device checkpoint and finalization identity are required.' using errcode = '23514';
  end if;
  select candidate.* into target_shift
  from public.shifts candidate
  where candidate.organization_id=target_organization_id and candidate.id=target_shift_id
  for update;
  if target_shift.id is null then
    raise exception 'The shift was not found.' using errcode = 'P0002';
  end if;
  if private.current_profile_id() is null
    or not private.has_permission(target_organization_id, 'shifts.close') then
    raise exception 'Shift closing permission is required.' using errcode = '42501';
  end if;
  actor_employee_id := private.current_employee_id(target_organization_id);
  if actor_employee_id is null or target_shift.opened_by_employee_id is distinct from actor_employee_id then
    raise exception 'Only the employee who opened this shift can close it.' using errcode = '42501';
  end if;
  verified_device_id := private.require_enrolled_offline_pos_device(
    target_organization_id, target_shift.store_id, target_shift.register_id
  );
  if target_shift.status = 'closed' then
    select lease.finalization_token into linked_token
    from private.pos_shift_custody_leases lease
    where lease.organization_id=target_organization_id and lease.shift_id=target_shift.id
      and lease.device_id=verified_device_id and lease.state='CLEARED';
    if linked_token is distinct from target_finalization_token then
      raise exception 'This shift was closed by a different finalization operation.' using errcode = '23514';
    end if;
    return query select target_shift.id,target_shift.expected_cash_minor,target_shift.counted_cash_minor,
      target_shift.difference_minor,target_shift.closed_at,true,true;
    return;
  end if;
  select lease.state,lease.finalization_token into linked_state,linked_token
  from private.pos_shift_custody_leases lease
  where lease.organization_id=target_organization_id and lease.shift_id=target_shift.id
    and lease.device_id=verified_device_id
  for update;
  if linked_state = 'CLEARED' then
    if linked_token is distinct from target_finalization_token then
      raise exception 'This device custody was cleared by a different finalization operation.' using errcode = '23514';
    end if;
  elsif linked_state = 'ACTIVE' then
    select coalesce((select checkpoint.server_checkpoint
      from public.pos_device_sync_checkpoints checkpoint
      where checkpoint.organization_id=target_organization_id and checkpoint.device_id=verified_device_id for update),0)
    into current_checkpoint;
    if current_checkpoint is distinct from target_local_high_water then
      raise exception 'The device sequence is not fully reconciled for shift close.' using errcode = '23514';
    end if;
    update private.pos_shift_custody_leases lease
    set state='CLEARED',cleared_at=now(),cleared_server_sequence=current_checkpoint,
        finalization_token=target_finalization_token,last_renewed_at=now()
    where lease.organization_id=target_organization_id and lease.shift_id=target_shift.id
      and lease.device_id=verified_device_id and lease.state='ACTIVE';
  else
    raise exception 'This device does not hold offline custody for the shift.' using errcode = '23514';
  end if;
  if exists (select 1 from private.pos_shift_custody_leases lease
    where lease.organization_id=target_organization_id and lease.shift_id=target_shift.id and lease.state='ACTIVE') then
    return query select target_shift.id,null::bigint,null::bigint,null::bigint,null::timestamptz,false,false;
    return;
  end if;
  select * into closed_result from private.close_register_shift(
    target_organization_id,target_shift.id,target_counted_cash_minor,target_closing_note
  );
  return query select closed_result.shift_id,closed_result.expected_cash_minor,closed_result.counted_cash_minor,
    closed_result.difference_minor,closed_result.closed_at,true,false;
end;
$$;

revoke all on function private.acquire_pos_shift_custody(uuid,uuid) from public;
revoke all on function private.acquire_pos_shift_custody(uuid,uuid) from tindio_anon;
revoke all on function private.acquire_pos_shift_custody(uuid,uuid) from tindio_authenticated;
revoke all on function private.acquire_pos_shift_custody(uuid,uuid) from tindio_service;
revoke all on function private.block_device_change_with_active_custody() from public;
revoke all on function private.block_device_change_with_active_custody() from tindio_anon;
revoke all on function private.block_device_change_with_active_custody() from tindio_authenticated;
revoke all on function private.block_device_change_with_active_custody() from tindio_service;
revoke all on function public.acquire_pos_shift_custody(uuid,uuid) from public;
revoke all on function public.acquire_pos_shift_custody(uuid,uuid) from tindio_anon;
revoke all on function public.acquire_pos_shift_custody(uuid,uuid) from tindio_service;
grant execute on function public.acquire_pos_shift_custody(uuid,uuid) to tindio_authenticated;
revoke all on function public.close_register_shift_mobile(uuid,uuid,bigint,text,bigint,uuid) from public;
revoke all on function public.close_register_shift_mobile(uuid,uuid,bigint,text,bigint,uuid) from tindio_anon;
revoke all on function public.close_register_shift_mobile(uuid,uuid,bigint,text,bigint,uuid) from tindio_service;
grant execute on function public.close_register_shift_mobile(uuid,uuid,bigint,text,bigint,uuid) to tindio_authenticated;

commit;
