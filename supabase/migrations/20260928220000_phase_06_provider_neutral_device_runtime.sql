-- TINDIO Phase 06 compatibility closure: provider-neutral device identity.
begin;

create or replace function private.require_device_manager(target_organization_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_employee_id uuid;
begin
  actor_employee_id := private.current_employee_id(target_organization_id);
  if actor_employee_id is null or not (select private.has_permission(target_organization_id, 'devices.manage')) then
    raise exception 'Device-management permission is required.' using errcode = '42501';
  end if;
  return actor_employee_id;
end;
$$;

create or replace function public.validate_pos_device(target_organization_id uuid, target_device_id uuid, target_secret text, target_app_version text)
returns table (device_id uuid, store_id uuid, register_id uuid, device_name text, app_version text, last_seen_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare actor_employee_id uuid;
begin
  actor_employee_id := private.current_employee_id(target_organization_id);
  if actor_employee_id is null or not (select private.has_permission(target_organization_id, 'sales.create')) then raise exception 'Sales permission is required.' using errcode = '42501'; end if;
  return query select verified.* from private.verify_pos_device_credential(target_organization_id, target_device_id, target_secret, target_app_version) verified where exists (select 1 from public.employee_stores employee_store where employee_store.organization_id = target_organization_id and employee_store.employee_id = actor_employee_id and employee_store.store_id = verified.store_id);
  if not found then raise exception 'You are not assigned to this device store.' using errcode = '42501'; end if;
end;
$$;

create or replace function private.require_active_pos_shift(target_organization_id uuid, target_store_id uuid, target_register_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_employee_id uuid; active_shift_id uuid;
begin
  if target_organization_id is null or target_store_id is null or target_register_id is null then raise exception 'A store and register are required for POS activity.' using errcode = '23514'; end if;
  perform private.require_active_pos_device(target_organization_id, target_store_id, target_register_id);
  actor_employee_id := private.current_employee_id(target_organization_id);
  if actor_employee_id is null or not (select private.has_permission(target_organization_id, 'sales.create')) then raise exception 'Sales permission is required.' using errcode = '42501'; end if;
  if not exists (select 1 from public.employee_stores employee_store join public.stores store on store.id=employee_store.store_id and store.organization_id=employee_store.organization_id and store.is_active join public.registers register on register.id=target_register_id and register.organization_id=employee_store.organization_id and register.store_id=employee_store.store_id and register.is_active where employee_store.organization_id=target_organization_id and employee_store.employee_id=actor_employee_id and employee_store.store_id=target_store_id) then raise exception 'An active employee assignment, store, and register are required.' using errcode = '42501'; end if;
  select shift.id into active_shift_id from public.shifts shift where shift.organization_id=target_organization_id and shift.store_id=target_store_id and shift.register_id=target_register_id and shift.opened_by_employee_id=actor_employee_id and shift.status='open' for update;
  if active_shift_id is null then raise exception 'Open your register shift before using transactional POS features.' using errcode = '42501'; end if;
  return actor_employee_id;
end;
$$;
revoke execute on function private.require_device_manager(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.require_active_pos_shift(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.validate_pos_device(uuid, uuid, text, text) from public, anon, service_role;
grant execute on function public.validate_pos_device(uuid, uuid, text, text) to authenticated;
commit;
