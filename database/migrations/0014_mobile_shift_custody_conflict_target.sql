-- Qualify custody upserts through the named primary-key constraint.
-- The function's TABLE return columns are PL/pgSQL variables, so an unqualified
-- `shift_id` in an ON CONFLICT column list is ambiguous at runtime.

begin;

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
  on conflict on constraint pos_shift_custody_leases_pkey do update
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

commit;
