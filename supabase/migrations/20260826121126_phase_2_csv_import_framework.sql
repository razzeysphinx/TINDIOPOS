-- TINDIO Planning Cycle Phase 2: tenant-scoped, all-or-nothing CSV imports.
-- CSV parsing happens in the browser for a fast preview; these functions remain
-- the authoritative validation and commit boundary.

begin;

create or replace function private.import_customers_csv(
  target_organization_id uuid,
  target_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  import_row record;
  row_json jsonb;
  row_number integer;
  row_name text;
  row_email text;
  row_phone text;
  row_address text;
  row_birthday date;
  row_notes text;
  row_card_code text;
  actor_employee_id uuid;
  seen_emails text[] := '{}';
  seen_phones text[] := '{}';
  seen_cards text[] := '{}';
  imported_count integer := 0;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'customers.manage')) then
    raise exception 'Customer management permission is required.' using errcode = '42501';
  end if;

  if jsonb_typeof(target_rows) <> 'array'
    or jsonb_array_length(target_rows) not between 1 and 500 then
    raise exception 'Import between 1 and 500 customer rows at a time.' using errcode = '22023';
  end if;

  select employee.id into actor_employee_id
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active'
  limit 1;

  for import_row in
    select value, ordinality from jsonb_array_elements(target_rows) with ordinality
  loop
    row_json := import_row.value;
    row_number := case when coalesce(row_json ->> 'row_number', '') ~ '^[1-9][0-9]*$'
      then (row_json ->> 'row_number')::integer else import_row.ordinality::integer end;
    if jsonb_typeof(row_json) <> 'object' then
      raise exception 'CSV row % must be an object.', row_number using errcode = '22023';
    end if;

    row_name := btrim(coalesce(row_json ->> 'full_name', ''));
    row_email := nullif(lower(btrim(coalesce(row_json ->> 'email', ''))), '');
    row_phone := nullif(btrim(coalesce(row_json ->> 'phone', '')), '');
    row_address := nullif(btrim(coalesce(row_json ->> 'address', '')), '');
    row_notes := nullif(btrim(coalesce(row_json ->> 'notes', '')), '');
    row_card_code := nullif(btrim(coalesce(row_json ->> 'loyalty_card_code', '')), '');

    if char_length(row_name) not between 1 and 160 then
      raise exception 'CSV row % needs a customer name of at most 160 characters.', row_number using errcode = '22023';
    end if;
    if row_email is not null and (char_length(row_email) > 320 or row_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
      raise exception 'CSV row % has an invalid email address.', row_number using errcode = '22023';
    end if;
    if row_phone is not null and char_length(row_phone) not between 3 and 40 then
      raise exception 'CSV row % has an invalid phone number.', row_number using errcode = '22023';
    end if;
    if row_address is not null and char_length(row_address) not between 2 and 500 then
      raise exception 'CSV row % has an invalid address.', row_number using errcode = '22023';
    end if;
    if row_notes is not null and char_length(row_notes) not between 2 and 1000 then
      raise exception 'CSV row % has invalid notes.', row_number using errcode = '22023';
    end if;
    if row_card_code is not null and char_length(row_card_code) not between 3 and 80 then
      raise exception 'CSV row % has an invalid loyalty card code.', row_number using errcode = '22023';
    end if;

    begin
      row_birthday := nullif(btrim(coalesce(row_json ->> 'birthday', '')), '')::date;
    exception when others then
      raise exception 'CSV row % has an invalid birthday. Use YYYY-MM-DD.', row_number using errcode = '22023';
    end;

    if row_email is not null and row_email = any(seen_emails) then
      raise exception 'CSV row % repeats an email address in this file.', row_number using errcode = '23505';
    end if;
    if row_phone is not null and row_phone = any(seen_phones) then
      raise exception 'CSV row % repeats a phone number in this file.', row_number using errcode = '23505';
    end if;
    if row_card_code is not null and lower(row_card_code) = any(seen_cards) then
      raise exception 'CSV row % repeats a loyalty card code in this file.', row_number using errcode = '23505';
    end if;
    if row_email is not null and exists (select 1 from public.customers customer where customer.organization_id = target_organization_id and lower(customer.email) = row_email) then
      raise exception 'CSV row % matches an existing customer email. Update that customer instead.', row_number using errcode = '23505';
    end if;
    if row_phone is not null and exists (select 1 from public.customers customer where customer.organization_id = target_organization_id and btrim(customer.phone) = row_phone) then
      raise exception 'CSV row % matches an existing customer phone. Update that customer instead.', row_number using errcode = '23505';
    end if;
    if row_card_code is not null and exists (select 1 from public.customers customer where customer.organization_id = target_organization_id and lower(customer.loyalty_card_code) = lower(row_card_code)) then
      raise exception 'CSV row % matches an existing loyalty card code.', row_number using errcode = '23505';
    end if;

    if row_email is not null then seen_emails := array_append(seen_emails, row_email); end if;
    if row_phone is not null then seen_phones := array_append(seen_phones, row_phone); end if;
    if row_card_code is not null then seen_cards := array_append(seen_cards, lower(row_card_code)); end if;
  end loop;

  for import_row in select value from jsonb_array_elements(target_rows) loop
    insert into public.customers (organization_id, full_name, email, phone, address, birthday, notes, loyalty_card_code)
    values (
      target_organization_id,
      btrim(import_row.value ->> 'full_name'),
      nullif(lower(btrim(coalesce(import_row.value ->> 'email', ''))), ''),
      nullif(btrim(coalesce(import_row.value ->> 'phone', '')), ''),
      nullif(btrim(coalesce(import_row.value ->> 'address', '')), ''),
      nullif(btrim(coalesce(import_row.value ->> 'birthday', '')), '')::date,
      nullif(btrim(coalesce(import_row.value ->> 'notes', '')), ''),
      coalesce(nullif(btrim(coalesce(import_row.value ->> 'loyalty_card_code', '')), ''), '')
    );
    imported_count := imported_count + 1;
  end loop;

  perform private.write_audit_log(target_organization_id, 'CUSTOMERS_IMPORTED', 'customers.manage', actor_employee_id, null, null, null, null, null, 'CSV import', jsonb_build_object('row_count', imported_count));
  return imported_count;
end;
$$;

create or replace function public.import_customers_csv(target_organization_id uuid, target_rows jsonb)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.import_customers_csv(target_organization_id, target_rows);
$$;

create or replace function private.import_suppliers_csv(
  target_organization_id uuid,
  target_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  import_row record;
  row_json jsonb;
  row_number integer;
  row_name text;
  actor_employee_id uuid;
  seen_names text[] := '{}';
  imported_count integer := 0;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'inventory.manage')) then
    raise exception 'Inventory management permission is required.' using errcode = '42501';
  end if;
  if jsonb_typeof(target_rows) <> 'array' or jsonb_array_length(target_rows) not between 1 and 500 then
    raise exception 'Import between 1 and 500 supplier rows at a time.' using errcode = '22023';
  end if;
  select employee.id into actor_employee_id from public.employees employee where employee.organization_id = target_organization_id and employee.profile_id = (select auth.uid()) and employee.status = 'active' limit 1;

  for import_row in select value, ordinality from jsonb_array_elements(target_rows) with ordinality loop
    row_json := import_row.value;
    row_number := case when coalesce(row_json ->> 'row_number', '') ~ '^[1-9][0-9]*$' then (row_json ->> 'row_number')::integer else import_row.ordinality::integer end;
    if jsonb_typeof(row_json) <> 'object' then raise exception 'CSV row % must be an object.', row_number using errcode = '22023'; end if;
    row_name := lower(btrim(coalesce(row_json ->> 'name', '')));
    if char_length(row_name) not between 1 and 160 then raise exception 'CSV row % needs a supplier name of at most 160 characters.', row_number using errcode = '22023'; end if;
    if char_length(btrim(coalesce(row_json ->> 'contact_name', ''))) > 160 or char_length(btrim(coalesce(row_json ->> 'email', ''))) > 320 or char_length(btrim(coalesce(row_json ->> 'phone', ''))) > 40 or char_length(btrim(coalesce(row_json ->> 'address', ''))) > 1000 or char_length(btrim(coalesce(row_json ->> 'notes', ''))) > 2000 then raise exception 'CSV row % has a field that is too long.', row_number using errcode = '22023'; end if;
    if nullif(btrim(coalesce(row_json ->> 'email', '')), '') is not null and btrim(row_json ->> 'email') !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'CSV row % has an invalid email address.', row_number using errcode = '22023'; end if;
    if row_name = any(seen_names) then raise exception 'CSV row % repeats a supplier name in this file.', row_number using errcode = '23505'; end if;
    if exists (select 1 from public.suppliers supplier where supplier.organization_id = target_organization_id and lower(btrim(supplier.name)) = row_name) then raise exception 'CSV row % matches an existing supplier. Update that supplier instead.', row_number using errcode = '23505'; end if;
    seen_names := array_append(seen_names, row_name);
  end loop;

  for import_row in select value from jsonb_array_elements(target_rows) loop
    insert into public.suppliers (organization_id, name, contact_name, email, phone, address, notes)
    values (target_organization_id, btrim(import_row.value ->> 'name'), nullif(btrim(coalesce(import_row.value ->> 'contact_name', '')), ''), nullif(lower(btrim(coalesce(import_row.value ->> 'email', ''))), ''), nullif(btrim(coalesce(import_row.value ->> 'phone', '')), ''), nullif(btrim(coalesce(import_row.value ->> 'address', '')), ''), nullif(btrim(coalesce(import_row.value ->> 'notes', '')), ''));
    imported_count := imported_count + 1;
  end loop;
  perform private.write_audit_log(target_organization_id, 'SUPPLIERS_IMPORTED', 'inventory.manage', actor_employee_id, null, null, null, null, null, 'CSV import', jsonb_build_object('row_count', imported_count));
  return imported_count;
end;
$$;

create or replace function public.import_suppliers_csv(target_organization_id uuid, target_rows jsonb)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.import_suppliers_csv(target_organization_id, target_rows);
$$;

create or replace function private.import_inventory_adjustments_csv(
  target_organization_id uuid,
  target_store_id uuid,
  target_reason_code text,
  target_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  import_row record;
  row_json jsonb;
  row_number integer;
  actor_employee_id uuid;
  row_product_id uuid;
  row_variant_id uuid;
  row_quantity numeric(14,3);
  row_note text;
  seen_items text[] := '{}';
  imported_count integer := 0;
begin
  if (select auth.uid()) is null or not (select private.has_permission(target_organization_id, 'inventory.manage')) then raise exception 'Inventory management permission is required.' using errcode = '42501'; end if;
  if jsonb_typeof(target_rows) <> 'array' or jsonb_array_length(target_rows) not between 1 and 500 then raise exception 'Import between 1 and 500 adjustment rows at a time.' using errcode = '22023'; end if;
  actor_employee_id := private.inventory_actor(target_organization_id, target_store_id);
  if actor_employee_id is null then raise exception 'An assigned employee is required for this store.' using errcode = '42501'; end if;
  if not exists (select 1 from public.inventory_adjustment_reasons reason where reason.organization_id = target_organization_id and reason.code = upper(btrim(target_reason_code)) and reason.is_active) then raise exception 'Choose an active adjustment reason.' using errcode = '23514'; end if;

  for import_row in select value, ordinality from jsonb_array_elements(target_rows) with ordinality loop
    row_json := import_row.value;
    row_number := case when coalesce(row_json ->> 'row_number', '') ~ '^[1-9][0-9]*$' then (row_json ->> 'row_number')::integer else import_row.ordinality::integer end;
    if jsonb_typeof(row_json) <> 'object' or coalesce(row_json ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'CSV row % needs a valid item.', row_number using errcode = '22023'; end if;
    if coalesce(row_json ->> 'variant_id', '') <> '' and row_json ->> 'variant_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'CSV row % has an invalid variant.', row_number using errcode = '22023'; end if;
    if coalesce(row_json ->> 'quantity_delta', '') !~ '^-?\d{1,8}(\.\d{1,3})?$' or (row_json ->> 'quantity_delta')::numeric = 0 then raise exception 'CSV row % needs a non-zero quantity change.', row_number using errcode = '22023'; end if;
    if char_length(btrim(coalesce(row_json ->> 'note', ''))) > 500 then raise exception 'CSV row % has a note that is too long.', row_number using errcode = '22023'; end if;
    row_product_id := (row_json ->> 'product_id')::uuid;
    row_variant_id := nullif(row_json ->> 'variant_id', '')::uuid;
    if concat(row_product_id::text, '|', coalesce(row_variant_id::text, '')) = any(seen_items) then raise exception 'CSV row % repeats an item in this file.', row_number using errcode = '23505'; end if;
    if not exists (select 1 from public.inventory_levels level where level.organization_id = target_organization_id and level.store_id = target_store_id and level.product_id = row_product_id and level.variant_id is not distinct from row_variant_id) then raise exception 'CSV row % is not initialized in this store.', row_number using errcode = '23514'; end if;
    seen_items := array_append(seen_items, concat(row_product_id::text, '|', coalesce(row_variant_id::text, '')));
  end loop;
  for import_row in select value from jsonb_array_elements(target_rows) loop
    row_quantity := (import_row.value ->> 'quantity_delta')::numeric;
    row_note := nullif(btrim(coalesce(import_row.value ->> 'note', '')), '');
    perform private.record_inventory_adjustment_v2(target_organization_id, target_store_id, (import_row.value ->> 'product_id')::uuid, nullif(import_row.value ->> 'variant_id', '')::uuid, row_quantity, upper(btrim(target_reason_code)), row_note);
    imported_count := imported_count + 1;
  end loop;
  perform private.write_audit_log(target_organization_id, 'INVENTORY_ADJUSTMENTS_IMPORTED', 'inventory.adjust', actor_employee_id, null, target_store_id, null, null, null, 'CSV import', jsonb_build_object('row_count', imported_count, 'reason_code', upper(btrim(target_reason_code))));
  return imported_count;
end;
$$;

create or replace function public.import_inventory_adjustments_csv(target_organization_id uuid, target_store_id uuid, target_reason_code text, target_rows jsonb)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.import_inventory_adjustments_csv(target_organization_id, target_store_id, target_reason_code, target_rows);
$$;

revoke execute on function private.import_customers_csv(uuid, jsonb), private.import_suppliers_csv(uuid, jsonb), private.import_inventory_adjustments_csv(uuid, uuid, text, jsonb) from public, anon, service_role;
revoke execute on function public.import_customers_csv(uuid, jsonb), public.import_suppliers_csv(uuid, jsonb), public.import_inventory_adjustments_csv(uuid, uuid, text, jsonb) from public, anon, service_role;
grant execute on function private.import_customers_csv(uuid, jsonb), private.import_suppliers_csv(uuid, jsonb), private.import_inventory_adjustments_csv(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.import_customers_csv(uuid, jsonb), public.import_suppliers_csv(uuid, jsonb), public.import_inventory_adjustments_csv(uuid, uuid, text, jsonb) to authenticated;

comment on function public.import_customers_csv(uuid, jsonb) is 'Atomically imports validated customer records without silently overwriting matching identities.';
comment on function public.import_suppliers_csv(uuid, jsonb) is 'Atomically imports validated supplier records without silently overwriting matching names.';
comment on function public.import_inventory_adjustments_csv(uuid, uuid, text, jsonb) is 'Atomically records validated inventory adjustment movements from CSV rows.';

commit;
