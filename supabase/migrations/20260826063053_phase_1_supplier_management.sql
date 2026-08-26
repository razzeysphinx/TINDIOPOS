-- TINDIO Planning Cycle Phase 1: supplier edits and safe deactivation.
-- Suppliers are tenant-scoped configuration records. Purchase orders retain
-- their immutable supplier relationship, while inactive suppliers disappear
-- from new-order selection.

begin;

create or replace function public.update_supplier(
  target_organization_id uuid,
  target_supplier_id uuid,
  target_name text,
  target_contact_name text,
  target_email text,
  target_phone text,
  target_address text,
  target_notes text,
  target_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := nullif(btrim(target_name), '');
  normalized_email text := nullif(btrim(target_email), '');
  actor_employee_id uuid;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'inventory.manage')) then
    raise exception 'Inventory permission is required.' using errcode = '42501';
  end if;

  if normalized_name is null or char_length(normalized_name) > 160 then
    raise exception 'Enter a supplier name with at most 160 characters.' using errcode = '22023';
  end if;

  if normalized_email is not null
    and (char_length(normalized_email) > 320 or normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'Enter a valid supplier email address.' using errcode = '22023';
  end if;

  if char_length(btrim(target_contact_name)) > 160
    or char_length(btrim(target_phone)) > 40
    or char_length(btrim(target_address)) > 1000
    or char_length(btrim(target_notes)) > 2000 then
    raise exception 'One or more supplier fields are too long.' using errcode = '22023';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active';

  update public.suppliers supplier
  set
    name = normalized_name,
    contact_name = nullif(btrim(target_contact_name), ''),
    email = normalized_email,
    phone = nullif(btrim(target_phone), ''),
    address = nullif(btrim(target_address), ''),
    notes = nullif(btrim(target_notes), ''),
    is_active = target_is_active
  where supplier.id = target_supplier_id
    and supplier.organization_id = target_organization_id;

  if not found then
    raise exception 'Select a supplier in this organization.' using errcode = '23503';
  end if;

  perform private.write_audit_log(
    target_organization_id,
    'SUPPLIER_UPDATED',
    'inventory.manage',
    actor_employee_id,
    null,
    null,
    null,
    null,
    null,
    null,
    jsonb_build_object(
      'supplier_id', target_supplier_id,
      'is_active', target_is_active
    )
  );

  return target_supplier_id;
end;
$$;

revoke execute on function public.update_supplier(uuid, uuid, text, text, text, text, text, text, boolean)
from public, anon, service_role;
grant execute on function public.update_supplier(uuid, uuid, text, text, text, text, text, text, boolean)
to authenticated;

comment on function public.update_supplier(uuid, uuid, text, text, text, text, text, text, boolean)
is 'Updates a tenant-scoped supplier and supports safe deactivation without deleting purchasing history.';

commit;
