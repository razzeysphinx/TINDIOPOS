-- Phase 6: add capability-level inventory transfer authorization without
-- removing the established inventory permissions.  The existing document,
-- ledger, idempotency, discrepancy, and audit procedures remain canonical.
begin;

insert into public.permissions (code, category, name, description)
values
  ('inventory.transfer.create', 'Inventory', 'Create transfer requests', 'Create an authorized request for stock to move between stores.'),
  ('inventory.transfer.send', 'Inventory', 'Send stock transfers', 'Approve, pick, and dispatch stock from an authorized source store.'),
  ('inventory.transfer.receive', 'Inventory', 'Receive stock transfers', 'Record authorized stock-transfer receipts at an assigned destination store.'),
  ('inventory.count.create', 'Inventory', 'Create inventory counts', 'Create and prepare an inventory count.'),
  ('inventory.count.finalize', 'Inventory', 'Finalize inventory counts', 'Submit, post, or cancel an authorized inventory count.'),
  ('inventory.adjust.create', 'Inventory', 'Create inventory adjustments', 'Prepare an authorized inventory adjustment.'),
  ('inventory.adjust.post', 'Inventory', 'Post inventory adjustments', 'Post an authorized inventory adjustment to the immutable stock ledger.'),
  ('inventory.valuation.view', 'Inventory', 'View inventory valuation', 'View inventory valuation and cost-sensitive stock values.'),
  ('purchasing.view', 'Purchasing', 'View purchasing', 'View authorized suppliers, purchase orders, and receiving records.'),
  ('purchasing.po.create', 'Purchasing', 'Create purchase orders', 'Create and maintain authorized purchase orders.'),
  ('purchasing.receive', 'Purchasing', 'Receive purchase orders', 'Receive authorized supplier deliveries.'),
  ('purchasing.suppliers.manage', 'Purchasing', 'Manage suppliers', 'Create and maintain supplier records.'),
  ('purchasing.return', 'Purchasing', 'Return stock to suppliers', 'Record authorized supplier returns.')
on conflict (code) do update
set category = excluded.category,
    name = excluded.name,
    description = excluded.description;

-- Existing capability bundles keep their effective access.  This is based on
-- assigned capabilities, not on role codes, so organization-defined roles
-- migrate safely alongside preset roles.
with compatibility (legacy_permission, capability) as (
  values
    ('inventory.manage', 'inventory.transfer.create'),
    ('inventory.manage', 'inventory.transfer.send'),
    ('inventory.manage', 'inventory.transfer.receive'),
    ('inventory.manage', 'inventory.count.create'),
    ('inventory.manage', 'inventory.count.finalize'),
    ('inventory.manage', 'inventory.adjust.create'),
    ('inventory.manage', 'inventory.adjust.post'),
    ('inventory.manage', 'inventory.valuation.view'),
    ('inventory.manage', 'purchasing.view'),
    ('inventory.manage', 'purchasing.po.create'),
    ('inventory.manage', 'purchasing.receive'),
    ('inventory.manage', 'purchasing.suppliers.manage'),
    ('inventory.manage', 'purchasing.return'),
    ('inventory.transfers', 'inventory.transfer.create'),
    ('inventory.transfers', 'inventory.transfer.send'),
    ('inventory.transfers', 'inventory.transfer.receive'),
    ('inventory.count', 'inventory.count.create'),
    ('inventory.count', 'inventory.count.finalize'),
    ('inventory.adjust', 'inventory.adjust.create'),
    ('inventory.adjust', 'inventory.adjust.post'),
    ('inventory.purchase_orders', 'purchasing.view'),
    ('inventory.purchase_orders', 'purchasing.po.create'),
    ('inventory.receive', 'purchasing.receive'),
    ('inventory.suppliers', 'purchasing.suppliers.manage'),
    ('products.view_cost', 'inventory.valuation.view')
)
insert into public.role_permissions (organization_id, role_id, permission_code)
select distinct role_permission.organization_id, role_permission.role_id, compatibility.capability
from public.role_permissions role_permission
join compatibility on compatibility.legacy_permission = role_permission.permission_code
on conflict do nothing;

-- This resolver centralizes compatibility at the capability boundary.  A
-- customer-created role can use only the new code; an older role remains
-- operational through its already-assigned legacy capability.
create or replace function private.has_inventory_capability(
  target_organization_id uuid,
  requested_capability text
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
        and (
          role_permission.permission_code = requested_capability
          or role_permission.permission_code = 'inventory.manage'
          or (
            requested_capability in ('inventory.transfer.create', 'inventory.transfer.send', 'inventory.transfer.receive')
            and role_permission.permission_code = 'inventory.transfers'
          )
          or (
            requested_capability in ('inventory.count.create', 'inventory.count.finalize')
            and role_permission.permission_code = 'inventory.count'
          )
          or (
            requested_capability in ('inventory.adjust.create', 'inventory.adjust.post')
            and role_permission.permission_code = 'inventory.adjust'
          )
          or (
            requested_capability in ('purchasing.view', 'purchasing.po.create')
            and role_permission.permission_code = 'inventory.purchase_orders'
          )
          or (
            requested_capability = 'purchasing.receive'
            and role_permission.permission_code = 'inventory.receive'
          )
          or (
            requested_capability = 'purchasing.suppliers.manage'
            and role_permission.permission_code = 'inventory.suppliers'
          )
          or (
            requested_capability = 'inventory.valuation.view'
            and role_permission.permission_code = 'products.view_cost'
          )
        )
    ),
    false
  );
$$;

create or replace function private.has_all_inventory_capabilities(
  target_organization_id uuid,
  requested_capabilities text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    cardinality(requested_capabilities) > 0
    and not exists (
      select 1
      from unnest(requested_capabilities) capability(code)
      where not (select private.has_inventory_capability(target_organization_id, capability.code))
    ),
    false
  );
$$;

create or replace function private.has_any_inventory_capability(
  target_organization_id uuid,
  requested_capabilities text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    cardinality(requested_capabilities) > 0
    and exists (
      select 1
      from unnest(requested_capabilities) capability(code)
      where (select private.has_inventory_capability(target_organization_id, capability.code))
    ),
    false
  );
$$;

-- Existing inventory procedures retain their exact business implementation.
-- A function-level setting cannot be supplied by a browser RPC caller; the
-- central permission predicate consumes it only while the tagged procedure is
-- executing.  This allows one canonical operation to move to a granular
-- capability without cloning or weakening the existing procedure.
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
    ),
    false
  );
$$;

-- Checked-in canonical transfer procedures appear below.  Their authorization
-- guards explicitly combine the established inventory.manage/approval path
-- with their granular capabilities.

create or replace function private.transfer_stock(target_organization_id uuid, target_source_store_id uuid, target_destination_store_id uuid, target_lines jsonb, target_note text) returns uuid language plpgsql security definer set search_path='' as $$ declare actor_id uuid; transfer_id uuid; line jsonb; source_quantity numeric(14,3); begin
 if (select auth.uid()) is null or (not (select private.has_permission(target_organization_id, 'inventory.manage')) and not (select private.has_all_inventory_capabilities(target_organization_id, array['inventory.transfer.create', 'inventory.transfer.send']::text[]))) then raise exception 'Inventory permission is required.' using errcode='42501'; end if;
 if target_source_store_id = target_destination_store_id or target_lines is null or jsonb_typeof(target_lines) <> 'array' or jsonb_array_length(target_lines) not between 1 and 100 then raise exception 'Choose two stores and one to 100 transfer items.' using errcode='23514'; end if;
 actor_id := private.inventory_actor(target_organization_id,target_source_store_id); if actor_id is null then raise exception 'An assigned employee is required for the source store.' using errcode='42501'; end if;
 insert into public.stock_transfers (organization_id,source_store_id,destination_store_id,transferred_by_employee_id,note) values (target_organization_id,target_source_store_id,target_destination_store_id,actor_id,nullif(btrim(target_note),'')) returning id into transfer_id;
 for line in select value from jsonb_array_elements(target_lines) loop
  if coalesce(line->>'quantity','') !~ '^\d+(\.\d{1,3})?$' or (line->>'quantity')::numeric <= 0 then raise exception 'Transfer quantities must be positive.' using errcode='23514'; end if;
  select quantity into source_quantity from public.inventory_levels where organization_id=target_organization_id and store_id=target_source_store_id and product_id=(line->>'product_id')::uuid and variant_id is not distinct from nullif(line->>'variant_id','')::uuid for update;
  if source_quantity is null or source_quantity < (line->>'quantity')::numeric then raise exception 'Source stock is insufficient for this transfer.' using errcode='23514'; end if;
  insert into public.stock_transfer_lines (organization_id,stock_transfer_id,product_id,variant_id,quantity) values (target_organization_id,transfer_id,(line->>'product_id')::uuid,nullif(line->>'variant_id','')::uuid,(line->>'quantity')::numeric);
  perform private.apply_inventory_change(target_organization_id,target_source_store_id,(line->>'product_id')::uuid,nullif(line->>'variant_id','')::uuid,-(line->>'quantity')::numeric,'TRANSFER_OUT',actor_id,'Stock transfer out','stock_transfer',transfer_id);
  perform private.apply_inventory_change(target_organization_id,target_destination_store_id,(line->>'product_id')::uuid,nullif(line->>'variant_id','')::uuid,(line->>'quantity')::numeric,'TRANSFER_IN',actor_id,'Stock transfer in','stock_transfer',transfer_id);
 end loop; return transfer_id; end; $$;

create function private.create_stock_request(
  target_organization_id uuid,
  target_requesting_store_id uuid,
  target_source_warehouse_id uuid,
  target_note text,
  target_lines jsonb,
  target_operation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  request_id uuid;
  request_number bigint;
  warehouse_store_id uuid;
  existing_request public.stock_requests%rowtype;
  product_row record;
  line jsonb;
  normalized_note text;
  requested_lines jsonb;
  persisted_lines jsonb;
begin
  if (select auth.uid()) is null
     or (not (select private.has_permission(target_organization_id, 'inventory.manage')) and not (select private.has_inventory_capability(target_organization_id, 'inventory.transfer.create'))) then
    raise exception 'Inventory permission is required.' using errcode = '42501';
  end if;

  if target_operation_id is null then
    raise exception 'A stable stock-request operation ID is required.' using errcode = '23514';
  end if;

  if target_lines is null
     or jsonb_typeof(target_lines) <> 'array'
     or jsonb_array_length(target_lines) not between 1 and 100
     or (target_note is not null and char_length(btrim(target_note)) > 500) then
    raise exception 'A stock request needs one to 100 items and valid notes.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(target_lines) requested(value)
    where jsonb_typeof(requested.value) <> 'object'
      or coalesce(requested.value ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (requested.value ? 'variant_id' and requested.value -> 'variant_id' <> 'null'::jsonb and coalesce(requested.value ->> 'variant_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
      or coalesce(requested.value ->> 'quantity', '') !~ '^\d+(\.\d{1,3})?$'
      or (requested.value ->> 'quantity')::numeric <= 0
  ) then
    raise exception 'Request lines need active items and positive quantities.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from (
      select
        lower(btrim(value ->> 'product_id')) as product_id,
        coalesce(nullif(lower(btrim(value ->> 'variant_id')), ''), '') as variant_id,
        count(*) as line_count
      from jsonb_array_elements(target_lines)
      group by 1, 2
    ) duplicate_line
    where duplicate_line.line_count > 1
  ) then
    raise exception 'Each request item can appear only once.' using errcode = '23514';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'product_id', normalized.product_id,
        'variant_id', normalized.variant_id,
        'quantity', normalized.quantity
      )
      order by normalized.product_id, normalized.variant_id
    ),
    '[]'::jsonb
  )
  into requested_lines
  from (
    select
      lower(btrim(value ->> 'product_id')) as product_id,
      coalesce(nullif(lower(btrim(value ->> 'variant_id')), ''), '') as variant_id,
      ((value ->> 'quantity')::numeric(14,3))::text as quantity
    from jsonb_array_elements(target_lines)
  ) normalized;

  normalized_note := nullif(btrim(target_note), '');
  actor_id := private.inventory_actor(target_organization_id, target_requesting_store_id);
  if actor_id is null then
    raise exception 'An assigned employee is required for the requesting store.' using errcode = '42501';
  end if;

  select *
  into existing_request
  from public.stock_requests request_row
  where request_row.organization_id = target_organization_id
    and request_row.operation_id = target_operation_id
  for update;

  if found then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'product_id', request_line.product_id::text,
          'variant_id', coalesce(request_line.variant_id::text, ''),
          'quantity', request_line.requested_quantity::text
        )
        order by request_line.product_id::text, coalesce(request_line.variant_id::text, '')
      ),
      '[]'::jsonb
    )
    into persisted_lines
    from public.stock_request_lines request_line
    where request_line.organization_id = target_organization_id
      and request_line.stock_request_id = existing_request.id;

    if existing_request.requesting_store_id = target_requesting_store_id
       and existing_request.source_warehouse_id = target_source_warehouse_id
       and existing_request.requested_by_employee_id = actor_id
       and existing_request.note is not distinct from normalized_note
       and persisted_lines = requested_lines then
      return existing_request.id;
    end if;

    raise exception 'This operation ID is already assigned to a different stock request.' using errcode = '23505';
  end if;

  select warehouse.store_id
  into warehouse_store_id
  from public.supply_chain_warehouses warehouse
  where warehouse.id = target_source_warehouse_id
    and warehouse.organization_id = target_organization_id
    and warehouse.is_active;

  if warehouse_store_id is null or warehouse_store_id = target_requesting_store_id then
    raise exception 'Choose an active warehouse at a different stock location.' using errcode = '23514';
  end if;

  request_number := nextval('private.tindio_stock_request_number_sequence'::regclass);
  insert into public.stock_requests (
    organization_id,
    request_number,
    requesting_store_id,
    source_warehouse_id,
    note,
    requested_by_employee_id,
    operation_id
  )
  values (
    target_organization_id,
    request_number,
    target_requesting_store_id,
    target_source_warehouse_id,
    normalized_note,
    actor_id,
    target_operation_id
  )
  returning id into request_id;

  for line in select value from jsonb_array_elements(target_lines) order by value ->> 'product_id', coalesce(value ->> 'variant_id', '')
  loop
    select product.name as product_name, variant.name as variant_name, product.unit
    into product_row
    from public.products product
    left join public.product_variants variant
      on variant.id = nullif(line ->> 'variant_id', '')::uuid
      and variant.product_id = product.id
      and variant.organization_id = product.organization_id
    where product.id = (line ->> 'product_id')::uuid
      and product.organization_id = target_organization_id
      and product.status = 'active'
      and product.track_inventory
      and (nullif(line ->> 'variant_id', '') is null or variant.id is not null);

    if not found then
      raise exception 'Every request item must be an active tracked product.' using errcode = '23514';
    end if;

    if not exists (
      select 1
      from public.inventory_levels level
      where level.organization_id = target_organization_id
        and level.store_id = target_requesting_store_id
        and level.product_id = (line ->> 'product_id')::uuid
        and level.variant_id is not distinct from nullif(line ->> 'variant_id', '')::uuid
    ) then
      raise exception 'Initialize the destination stock projection for every requested item.' using errcode = '23514';
    end if;

    insert into public.stock_request_lines (
      organization_id,
      stock_request_id,
      product_id,
      variant_id,
      product_name_snapshot,
      variant_name_snapshot,
      unit_snapshot,
      requested_quantity
    )
    values (
      target_organization_id,
      request_id,
      (line ->> 'product_id')::uuid,
      nullif(line ->> 'variant_id', '')::uuid,
      product_row.product_name,
      product_row.variant_name,
      product_row.unit,
      (line ->> 'quantity')::numeric(14,3)
    );
  end loop;

  perform private.write_audit_log(
    target_organization_id,
    'STOCK_REQUEST_SUBMITTED',
    'inventory.manage',
    actor_id,
    null,
    target_requesting_store_id,
    null,
    null,
    null,
    normalized_note,
    jsonb_build_object('stock_request_id', request_id, 'request_number', request_number, 'source_warehouse_id', target_source_warehouse_id)
  );
  return request_id;
end;
$$;

commit;
-- Phase 6: add capability-level inventory transfer authorization without
-- removing the established inventory permissions.  The existing document,
-- ledger, idempotency, discrepancy, and audit procedures remain canonical.
begin;

insert into public.permissions (code, category, name, description)
values
  ('inventory.transfer.create', 'Inventory', 'Create transfer requests', 'Create an authorized request for stock to move between stores.'),
  ('inventory.transfer.send', 'Inventory', 'Send stock transfers', 'Approve, pick, and dispatch stock from an authorized source store.'),
  ('inventory.transfer.receive', 'Inventory', 'Receive stock transfers', 'Record authorized stock-transfer receipts at an assigned destination store.'),
  ('inventory.count.create', 'Inventory', 'Create inventory counts', 'Create and prepare an inventory count.'),
  ('inventory.count.finalize', 'Inventory', 'Finalize inventory counts', 'Submit, post, or cancel an authorized inventory count.'),
  ('inventory.adjust.create', 'Inventory', 'Create inventory adjustments', 'Prepare an authorized inventory adjustment.'),
  ('inventory.adjust.post', 'Inventory', 'Post inventory adjustments', 'Post an authorized inventory adjustment to the immutable stock ledger.'),
  ('inventory.valuation.view', 'Inventory', 'View inventory valuation', 'View inventory valuation and cost-sensitive stock values.'),
  ('purchasing.view', 'Purchasing', 'View purchasing', 'View authorized suppliers, purchase orders, and receiving records.'),
  ('purchasing.po.create', 'Purchasing', 'Create purchase orders', 'Create and maintain authorized purchase orders.'),
  ('purchasing.receive', 'Purchasing', 'Receive purchase orders', 'Receive authorized supplier deliveries.'),
  ('purchasing.suppliers.manage', 'Purchasing', 'Manage suppliers', 'Create and maintain supplier records.'),
  ('purchasing.return', 'Purchasing', 'Return stock to suppliers', 'Record authorized supplier returns.')
on conflict (code) do update
set category = excluded.category,
    name = excluded.name,
    description = excluded.description;

-- Existing capability bundles keep their effective access.  This is based on
-- assigned capabilities, not on role codes, so organization-defined roles
-- migrate safely alongside preset roles.
with compatibility (legacy_permission, capability) as (
  values
    ('inventory.manage', 'inventory.transfer.create'),
    ('inventory.manage', 'inventory.transfer.send'),
    ('inventory.manage', 'inventory.transfer.receive'),
    ('inventory.manage', 'inventory.count.create'),
    ('inventory.manage', 'inventory.count.finalize'),
    ('inventory.manage', 'inventory.adjust.create'),
    ('inventory.manage', 'inventory.adjust.post'),
    ('inventory.manage', 'inventory.valuation.view'),
    ('inventory.manage', 'purchasing.view'),
    ('inventory.manage', 'purchasing.po.create'),
    ('inventory.manage', 'purchasing.receive'),
    ('inventory.manage', 'purchasing.suppliers.manage'),
    ('inventory.manage', 'purchasing.return'),
    ('inventory.transfers', 'inventory.transfer.create'),
    ('inventory.transfers', 'inventory.transfer.send'),
    ('inventory.transfers', 'inventory.transfer.receive'),
    ('inventory.count', 'inventory.count.create'),
    ('inventory.count', 'inventory.count.finalize'),
    ('inventory.adjust', 'inventory.adjust.create'),
    ('inventory.adjust', 'inventory.adjust.post'),
    ('inventory.purchase_orders', 'purchasing.view'),
    ('inventory.purchase_orders', 'purchasing.po.create'),
    ('inventory.receive', 'purchasing.receive'),
    ('inventory.suppliers', 'purchasing.suppliers.manage'),
    ('products.view_cost', 'inventory.valuation.view')
)
insert into public.role_permissions (organization_id, role_id, permission_code)
select distinct role_permission.organization_id, role_permission.role_id, compatibility.capability
from public.role_permissions role_permission
join compatibility on compatibility.legacy_permission = role_permission.permission_code
on conflict do nothing;

-- This resolver centralizes compatibility at the capability boundary.  A
-- customer-created role can use only the new code; an older role remains
-- operational through its already-assigned legacy capability.
create or replace function private.has_inventory_capability(
  target_organization_id uuid,
  requested_capability text
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
        and (
          role_permission.permission_code = requested_capability
          or role_permission.permission_code = 'inventory.manage'
          or (
            requested_capability in ('inventory.transfer.create', 'inventory.transfer.send', 'inventory.transfer.receive')
            and role_permission.permission_code = 'inventory.transfers'
          )
          or (
            requested_capability in ('inventory.count.create', 'inventory.count.finalize')
            and role_permission.permission_code = 'inventory.count'
          )
          or (
            requested_capability in ('inventory.adjust.create', 'inventory.adjust.post')
            and role_permission.permission_code = 'inventory.adjust'
          )
          or (
            requested_capability in ('purchasing.view', 'purchasing.po.create')
            and role_permission.permission_code = 'inventory.purchase_orders'
          )
          or (
            requested_capability = 'purchasing.receive'
            and role_permission.permission_code = 'inventory.receive'
          )
          or (
            requested_capability = 'purchasing.suppliers.manage'
            and role_permission.permission_code = 'inventory.suppliers'
          )
          or (
            requested_capability = 'inventory.valuation.view'
            and role_permission.permission_code = 'products.view_cost'
          )
        )
    ),
    false
  );
$$;

commit;
-- Phase 6: add capability-level inventory transfer authorization without
-- removing the established inventory permissions.  The existing document,
-- ledger, idempotency, discrepancy, and audit procedures remain canonical.
begin;

insert into public.permissions (code, category, name, description)
values
  ('inventory.transfer.create', 'Inventory', 'Create transfer requests', 'Create an authorized request for stock to move between stores.'),
  ('inventory.transfer.send', 'Inventory', 'Send stock transfers', 'Approve, pick, and dispatch stock from an authorized source store.'),
  ('inventory.transfer.receive', 'Inventory', 'Receive stock transfers', 'Record authorized stock-transfer receipts at an assigned destination store.'),
  ('inventory.count.create', 'Inventory', 'Create inventory counts', 'Create and prepare an inventory count.'),
  ('inventory.count.finalize', 'Inventory', 'Finalize inventory counts', 'Submit, post, or cancel an authorized inventory count.'),
  ('inventory.adjust.create', 'Inventory', 'Create inventory adjustments', 'Prepare an authorized inventory adjustment.'),
  ('inventory.adjust.post', 'Inventory', 'Post inventory adjustments', 'Post an authorized inventory adjustment to the immutable stock ledger.'),
  ('inventory.valuation.view', 'Inventory', 'View inventory valuation', 'View inventory valuation and cost-sensitive stock values.'),
  ('purchasing.view', 'Purchasing', 'View purchasing', 'View authorized suppliers, purchase orders, and receiving records.'),
  ('purchasing.po.create', 'Purchasing', 'Create purchase orders', 'Create and maintain authorized purchase orders.'),
  ('purchasing.receive', 'Purchasing', 'Receive purchase orders', 'Receive authorized supplier deliveries.'),
  ('purchasing.suppliers.manage', 'Purchasing', 'Manage suppliers', 'Create and maintain supplier records.'),
  ('purchasing.return', 'Purchasing', 'Return stock to suppliers', 'Record authorized supplier returns.')
on conflict (code) do update
set category = excluded.category,
    name = excluded.name,
    description = excluded.description;

-- Existing capability bundles keep their effective access.  This is based on
-- assigned capabilities, not on role codes, so organization-defined roles
-- migrate safely alongside preset roles.
with compatibility (legacy_permission, capability) as (
  values
    ('inventory.manage', 'inventory.transfer.create'),
    ('inventory.manage', 'inventory.transfer.send'),
    ('inventory.manage', 'inventory.transfer.receive'),
    ('inventory.manage', 'inventory.count.create'),
    ('inventory.manage', 'inventory.count.finalize'),
    ('inventory.manage', 'inventory.adjust.create'),
    ('inventory.manage', 'inventory.adjust.post'),
    ('inventory.manage', 'inventory.valuation.view'),
    ('inventory.manage', 'purchasing.view'),
    ('inventory.manage', 'purchasing.po.create'),
    ('inventory.manage', 'purchasing.receive'),
    ('inventory.manage', 'purchasing.suppliers.manage'),
    ('inventory.manage', 'purchasing.return'),
    ('inventory.transfers', 'inventory.transfer.create'),
    ('inventory.transfers', 'inventory.transfer.send'),
    ('inventory.transfers', 'inventory.transfer.receive'),
    ('inventory.count', 'inventory.count.create'),
    ('inventory.count', 'inventory.count.finalize'),
    ('inventory.adjust', 'inventory.adjust.create'),
    ('inventory.adjust', 'inventory.adjust.post'),
    ('inventory.purchase_orders', 'purchasing.view'),
    ('inventory.purchase_orders', 'purchasing.po.create'),
    ('inventory.receive', 'purchasing.receive'),
    ('inventory.suppliers', 'purchasing.suppliers.manage'),
    ('products.view_cost', 'inventory.valuation.view')
)
insert into public.role_permissions (organization_id, role_id, permission_code)
select distinct role_permission.organization_id, role_permission.role_id, compatibility.capability
from public.role_permissions role_permission
join compatibility on compatibility.legacy_permission = role_permission.permission_code
on conflict do nothing;

-- This resolver centralizes compatibility at the capability boundary.  A
-- customer-created role can use only the new code; an older role remains
-- operational through its already-assigned legacy capability.
create or replace function private.has_inventory_capability(
  target_organization_id uuid,
  requested_capability text
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
        and (
          role_permission.permission_code = requested_capability
          or role_permission.permission_code = 'inventory.manage'
          or (
            requested_capability in ('inventory.transfer.create', 'inventory.transfer.send', 'inventory.transfer.receive')
            and role_permission.permission_code = 'inventory.transfers'
          )
          or (
            requested_capability in ('inventory.count.create', 'inventory.count.finalize')
            and role_permission.permission_code = 'inventory.count'
          )
          or (
            requested_capability in ('inventory.adjust.create', 'inventory.adjust.post')
            and role_permission.permission_code = 'inventory.adjust'
          )
          or (
            requested_capability in ('purchasing.view', 'purchasing.po.create')
            and role_permission.permission_code = 'inventory.purchase_orders'
          )
          or (
            requested_capability = 'purchasing.receive'
            and role_permission.permission_code = 'inventory.receive'
          )
          or (
            requested_capability = 'purchasing.suppliers.manage'
            and role_permission.permission_code = 'inventory.suppliers'
          )
          or (
            requested_capability = 'inventory.valuation.view'
            and role_permission.permission_code = 'products.view_cost'
          )
        )
    ),
    false
  );
$$;

commit;
-- Phase 6: add capability-level inventory transfer authorization without
-- removing the established inventory permissions.  The existing document,
-- ledger, idempotency, discrepancy, and audit procedures remain canonical.
begin;

insert into public.permissions (code, category, name, description)
values
  ('inventory.transfer.create', 'Inventory', 'Create transfer requests', 'Create an authorized request for stock to move between stores.'),
  ('inventory.transfer.send', 'Inventory', 'Send stock transfers', 'Approve, pick, and dispatch stock from an authorized source store.'),
  ('inventory.transfer.receive', 'Inventory', 'Receive stock transfers', 'Record authorized stock-transfer receipts at an assigned destination store.'),
  ('inventory.count.create', 'Inventory', 'Create inventory counts', 'Create and prepare an inventory count.'),
  ('inventory.count.finalize', 'Inventory', 'Finalize inventory counts', 'Submit, post, or cancel an authorized inventory count.'),
  ('inventory.adjust.create', 'Inventory', 'Create inventory adjustments', 'Prepare an authorized inventory adjustment.'),
  ('inventory.adjust.post', 'Inventory', 'Post inventory adjustments', 'Post an authorized inventory adjustment to the immutable stock ledger.'),
  ('inventory.valuation.view', 'Inventory', 'View inventory valuation', 'View inventory valuation and cost-sensitive stock values.'),
  ('purchasing.view', 'Purchasing', 'View purchasing', 'View authorized suppliers, purchase orders, and receiving records.'),
  ('purchasing.po.create', 'Purchasing', 'Create purchase orders', 'Create and maintain authorized purchase orders.'),
  ('purchasing.receive', 'Purchasing', 'Receive purchase orders', 'Receive authorized supplier deliveries.'),
  ('purchasing.suppliers.manage', 'Purchasing', 'Manage suppliers', 'Create and maintain supplier records.'),
  ('purchasing.return', 'Purchasing', 'Return stock to suppliers', 'Record authorized supplier returns.')
on conflict (code) do update
set category = excluded.category,
    name = excluded.name,
    description = excluded.description;

-- Existing capability bundles keep their effective access.  This is based on
-- assigned capabilities, not on role codes, so organization-defined roles
-- migrate safely alongside preset roles.
with compatibility (legacy_permission, capability) as (
  values
    ('inventory.manage', 'inventory.transfer.create'),
    ('inventory.manage', 'inventory.transfer.send'),
    ('inventory.manage', 'inventory.transfer.receive'),
    ('inventory.manage', 'inventory.count.create'),
    ('inventory.manage', 'inventory.count.finalize'),
    ('inventory.manage', 'inventory.adjust.create'),
    ('inventory.manage', 'inventory.adjust.post'),
    ('inventory.manage', 'inventory.valuation.view'),
    ('inventory.manage', 'purchasing.view'),
    ('inventory.manage', 'purchasing.po.create'),
    ('inventory.manage', 'purchasing.receive'),
    ('inventory.manage', 'purchasing.suppliers.manage'),
    ('inventory.manage', 'purchasing.return'),
    ('inventory.transfers', 'inventory.transfer.create'),
    ('inventory.transfers', 'inventory.transfer.send'),
    ('inventory.transfers', 'inventory.transfer.receive'),
    ('inventory.count', 'inventory.count.create'),
    ('inventory.count', 'inventory.count.finalize'),
    ('inventory.adjust', 'inventory.adjust.create'),
    ('inventory.adjust', 'inventory.adjust.post'),
    ('inventory.purchase_orders', 'purchasing.view'),
    ('inventory.purchase_orders', 'purchasing.po.create'),
    ('inventory.receive', 'purchasing.receive'),
    ('inventory.suppliers', 'purchasing.suppliers.manage'),
    ('products.view_cost', 'inventory.valuation.view')
)
insert into public.role_permissions (organization_id, role_id, permission_code)
select distinct role_permission.organization_id, role_permission.role_id, compatibility.capability
from public.role_permissions role_permission
join compatibility on compatibility.legacy_permission = role_permission.permission_code
on conflict do nothing;

-- This resolver centralizes compatibility at the capability boundary.  A
-- customer-created role can use only the new code; an older role remains
-- operational through its already-assigned legacy capability.
create or replace function private.has_inventory_capability(
  target_organization_id uuid,
  requested_capability text
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
        and (
          role_permission.permission_code = requested_capability
          or role_permission.permission_code = 'inventory.manage'
          or (
            requested_capability in ('inventory.transfer.create', 'inventory.transfer.send', 'inventory.transfer.receive')
            and role_permission.permission_code = 'inventory.transfers'
          )
          or (
            requested_capability in ('inventory.count.create', 'inventory.count.finalize')
            and role_permission.permission_code = 'inventory.count'
          )
          or (
            requested_capability in ('inventory.adjust.create', 'inventory.adjust.post')
            and role_permission.permission_code = 'inventory.adjust'
          )
          or (
            requested_capability in ('purchasing.view', 'purchasing.po.create')
            and role_permission.permission_code = 'inventory.purchase_orders'
          )
          or (
            requested_capability = 'purchasing.receive'
            and role_permission.permission_code = 'inventory.receive'
          )
          or (
            requested_capability = 'purchasing.suppliers.manage'
            and role_permission.permission_code = 'inventory.suppliers'
          )
          or (
            requested_capability = 'inventory.valuation.view'
            and role_permission.permission_code = 'products.view_cost'
          )
        )
    ),
    false
  );
$$;

commit;
-- Phase 6: add capability-level inventory transfer authorization without
-- removing the established inventory permissions.  The existing document,
-- ledger, idempotency, discrepancy, and audit procedures remain canonical.
begin;

insert into public.permissions (code, category, name, description)
values
  ('inventory.transfer.create', 'Inventory', 'Create transfer requests', 'Create an authorized request for stock to move between stores.'),
  ('inventory.transfer.send', 'Inventory', 'Send stock transfers', 'Approve, pick, and dispatch stock from an authorized source store.'),
  ('inventory.transfer.receive', 'Inventory', 'Receive stock transfers', 'Record authorized stock-transfer receipts at an assigned destination store.'),
  ('inventory.count.create', 'Inventory', 'Create inventory counts', 'Create and prepare an inventory count.'),
  ('inventory.count.finalize', 'Inventory', 'Finalize inventory counts', 'Submit, post, or cancel an authorized inventory count.'),
  ('inventory.adjust.create', 'Inventory', 'Create inventory adjustments', 'Prepare an authorized inventory adjustment.'),
  ('inventory.adjust.post', 'Inventory', 'Post inventory adjustments', 'Post an authorized inventory adjustment to the immutable stock ledger.'),
  ('inventory.valuation.view', 'Inventory', 'View inventory valuation', 'View inventory valuation and cost-sensitive stock values.'),
  ('purchasing.view', 'Purchasing', 'View purchasing', 'View authorized suppliers, purchase orders, and receiving records.'),
  ('purchasing.po.create', 'Purchasing', 'Create purchase orders', 'Create and maintain authorized purchase orders.'),
  ('purchasing.receive', 'Purchasing', 'Receive purchase orders', 'Receive authorized supplier deliveries.'),
  ('purchasing.suppliers.manage', 'Purchasing', 'Manage suppliers', 'Create and maintain supplier records.'),
  ('purchasing.return', 'Purchasing', 'Return stock to suppliers', 'Record authorized supplier returns.')
on conflict (code) do update
set category = excluded.category,
    name = excluded.name,
    description = excluded.description;

-- Existing capability bundles keep their effective access.  This is based on
-- assigned capabilities, not on role codes, so organization-defined roles
-- migrate safely alongside preset roles.
with compatibility (legacy_permission, capability) as (
  values
    ('inventory.manage', 'inventory.transfer.create'),
    ('inventory.manage', 'inventory.transfer.send'),
    ('inventory.manage', 'inventory.transfer.receive'),
    ('inventory.manage', 'inventory.count.create'),
    ('inventory.manage', 'inventory.count.finalize'),
    ('inventory.manage', 'inventory.adjust.create'),
    ('inventory.manage', 'inventory.adjust.post'),
    ('inventory.manage', 'inventory.valuation.view'),
    ('inventory.manage', 'purchasing.view'),
    ('inventory.manage', 'purchasing.po.create'),
    ('inventory.manage', 'purchasing.receive'),
    ('inventory.manage', 'purchasing.suppliers.manage'),
    ('inventory.manage', 'purchasing.return'),
    ('inventory.transfers', 'inventory.transfer.create'),
    ('inventory.transfers', 'inventory.transfer.send'),
    ('inventory.transfers', 'inventory.transfer.receive'),
    ('inventory.count', 'inventory.count.create'),
    ('inventory.count', 'inventory.count.finalize'),
    ('inventory.adjust', 'inventory.adjust.create'),
    ('inventory.adjust', 'inventory.adjust.post'),
    ('inventory.purchase_orders', 'purchasing.view'),
    ('inventory.purchase_orders', 'purchasing.po.create'),
    ('inventory.receive', 'purchasing.receive'),
    ('inventory.suppliers', 'purchasing.suppliers.manage'),
    ('products.view_cost', 'inventory.valuation.view')
)
insert into public.role_permissions (organization_id, role_id, permission_code)
select distinct role_permission.organization_id, role_permission.role_id, compatibility.capability
from public.role_permissions role_permission
join compatibility on compatibility.legacy_permission = role_permission.permission_code
on conflict do nothing;

-- This resolver centralizes compatibility at the capability boundary.  A
-- customer-created role can use only the new code; an older role remains
-- operational through its already-assigned legacy capability.
create or replace function private.has_inventory_capability(
  target_organization_id uuid,
  requested_capability text
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
        and (
          role_permission.permission_code = requested_capability
          or role_permission.permission_code = 'inventory.manage'
          or (
            requested_capability in ('inventory.transfer.create', 'inventory.transfer.send', 'inventory.transfer.receive')
            and role_permission.permission_code = 'inventory.transfers'
          )
          or (
            requested_capability in ('inventory.count.create', 'inventory.count.finalize')
            and role_permission.permission_code = 'inventory.count'
          )
          or (
            requested_capability in ('inventory.adjust.create', 'inventory.adjust.post')
            and role_permission.permission_code = 'inventory.adjust'
          )
          or (
            requested_capability in ('purchasing.view', 'purchasing.po.create')
            and role_permission.permission_code = 'inventory.purchase_orders'
          )
          or (
            requested_capability = 'purchasing.receive'
            and role_permission.permission_code = 'inventory.receive'
          )
          or (
            requested_capability = 'purchasing.suppliers.manage'
            and role_permission.permission_code = 'inventory.suppliers'
          )
          or (
            requested_capability = 'inventory.valuation.view'
            and role_permission.permission_code = 'products.view_cost'
          )
        )
    ),
    false
  );
$$;

commit;
-- Phase 6: add capability-level inventory transfer authorization without
-- removing the established inventory permissions.  The existing document,
-- ledger, idempotency, discrepancy, and audit procedures remain canonical.
begin;

insert into public.permissions (code, category, name, description)
values
  ('inventory.transfer.create', 'Inventory', 'Create transfer requests', 'Create an authorized request for stock to move between stores.'),
  ('inventory.transfer.send', 'Inventory', 'Send stock transfers', 'Approve, pick, and dispatch stock from an authorized source store.'),
  ('inventory.transfer.receive', 'Inventory', 'Receive stock transfers', 'Record authorized stock-transfer receipts at an assigned destination store.'),
  ('inventory.count.create', 'Inventory', 'Create inventory counts', 'Create and prepare an inventory count.'),
  ('inventory.count.finalize', 'Inventory', 'Finalize inventory counts', 'Submit, post, or cancel an authorized inventory count.'),
  ('inventory.adjust.create', 'Inventory', 'Create inventory adjustments', 'Prepare an authorized inventory adjustment.'),
  ('inventory.adjust.post', 'Inventory', 'Post inventory adjustments', 'Post an authorized inventory adjustment to the immutable stock ledger.'),
  ('inventory.valuation.view', 'Inventory', 'View inventory valuation', 'View inventory valuation and cost-sensitive stock values.'),
  ('purchasing.view', 'Purchasing', 'View purchasing', 'View authorized suppliers, purchase orders, and receiving records.'),
  ('purchasing.po.create', 'Purchasing', 'Create purchase orders', 'Create and maintain authorized purchase orders.'),
  ('purchasing.receive', 'Purchasing', 'Receive purchase orders', 'Receive authorized supplier deliveries.'),
  ('purchasing.suppliers.manage', 'Purchasing', 'Manage suppliers', 'Create and maintain supplier records.'),
  ('purchasing.return', 'Purchasing', 'Return stock to suppliers', 'Record authorized supplier returns.')
on conflict (code) do update
set category = excluded.category,
    name = excluded.name,
    description = excluded.description;

-- Existing capability bundles keep their effective access.  This is based on
-- assigned capabilities, not on role codes, so organization-defined roles
-- migrate safely alongside preset roles.
with compatibility (legacy_permission, capability) as (
  values
    ('inventory.manage', 'inventory.transfer.create'),
    ('inventory.manage', 'inventory.transfer.send'),
    ('inventory.manage', 'inventory.transfer.receive'),
    ('inventory.manage', 'inventory.count.create'),
    ('inventory.manage', 'inventory.count.finalize'),
    ('inventory.manage', 'inventory.adjust.create'),
    ('inventory.manage', 'inventory.adjust.post'),
    ('inventory.manage', 'inventory.valuation.view'),
    ('inventory.manage', 'purchasing.view'),
    ('inventory.manage', 'purchasing.po.create'),
    ('inventory.manage', 'purchasing.receive'),
    ('inventory.manage', 'purchasing.suppliers.manage'),
    ('inventory.manage', 'purchasing.return'),
    ('inventory.transfers', 'inventory.transfer.create'),
    ('inventory.transfers', 'inventory.transfer.send'),
    ('inventory.transfers', 'inventory.transfer.receive'),
    ('inventory.count', 'inventory.count.create'),
    ('inventory.count', 'inventory.count.finalize'),
    ('inventory.adjust', 'inventory.adjust.create'),
    ('inventory.adjust', 'inventory.adjust.post'),
    ('inventory.purchase_orders', 'purchasing.view'),
    ('inventory.purchase_orders', 'purchasing.po.create'),
    ('inventory.receive', 'purchasing.receive'),
    ('inventory.suppliers', 'purchasing.suppliers.manage'),
    ('products.view_cost', 'inventory.valuation.view')
)
insert into public.role_permissions (organization_id, role_id, permission_code)
select distinct role_permission.organization_id, role_permission.role_id, compatibility.capability
from public.role_permissions role_permission
join compatibility on compatibility.legacy_permission = role_permission.permission_code
on conflict do nothing;

-- This resolver centralizes compatibility at the capability boundary.  A
-- customer-created role can use only the new code; an older role remains
-- operational through its already-assigned legacy capability.
create or replace function private.has_inventory_capability(
  target_organization_id uuid,
  requested_capability text
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
        and (
          role_permission.permission_code = requested_capability
          or role_permission.permission_code = 'inventory.manage'
          or (
            requested_capability in ('inventory.transfer.create', 'inventory.transfer.send', 'inventory.transfer.receive')
            and role_permission.permission_code = 'inventory.transfers'
          )
          or (
            requested_capability in ('inventory.count.create', 'inventory.count.finalize')
            and role_permission.permission_code = 'inventory.count'
          )
          or (
            requested_capability in ('inventory.adjust.create', 'inventory.adjust.post')
            and role_permission.permission_code = 'inventory.adjust'
          )
          or (
            requested_capability in ('purchasing.view', 'purchasing.po.create')
            and role_permission.permission_code = 'inventory.purchase_orders'
          )
          or (
            requested_capability = 'purchasing.receive'
            and role_permission.permission_code = 'inventory.receive'
          )
          or (
            requested_capability = 'purchasing.suppliers.manage'
            and role_permission.permission_code = 'inventory.suppliers'
          )
          or (
            requested_capability = 'inventory.valuation.view'
            and role_permission.permission_code = 'products.view_cost'
          )
        )
    ),
    false
  );
$$;

commit;
-- Phase 6: add capability-level inventory transfer authorization without
-- removing the established inventory permissions.  The existing document,
-- ledger, idempotency, discrepancy, and audit procedures remain canonical.
begin;

insert into public.permissions (code, category, name, description)
values
  ('inventory.transfer.create', 'Inventory', 'Create transfer requests', 'Create an authorized request for stock to move between stores.'),
  ('inventory.transfer.send', 'Inventory', 'Send stock transfers', 'Approve, pick, and dispatch stock from an authorized source store.'),
  ('inventory.transfer.receive', 'Inventory', 'Receive stock transfers', 'Record authorized stock-transfer receipts at an assigned destination store.'),
  ('inventory.count.create', 'Inventory', 'Create inventory counts', 'Create and prepare an inventory count.'),
  ('inventory.count.finalize', 'Inventory', 'Finalize inventory counts', 'Submit, post, or cancel an authorized inventory count.'),
  ('inventory.adjust.create', 'Inventory', 'Create inventory adjustments', 'Prepare an authorized inventory adjustment.'),
  ('inventory.adjust.post', 'Inventory', 'Post inventory adjustments', 'Post an authorized inventory adjustment to the immutable stock ledger.'),
  ('inventory.valuation.view', 'Inventory', 'View inventory valuation', 'View inventory valuation and cost-sensitive stock values.'),
  ('purchasing.view', 'Purchasing', 'View purchasing', 'View authorized suppliers, purchase orders, and receiving records.'),
  ('purchasing.po.create', 'Purchasing', 'Create purchase orders', 'Create and maintain authorized purchase orders.'),
  ('purchasing.receive', 'Purchasing', 'Receive purchase orders', 'Receive authorized supplier deliveries.'),
  ('purchasing.suppliers.manage', 'Purchasing', 'Manage suppliers', 'Create and maintain supplier records.'),
  ('purchasing.return', 'Purchasing', 'Return stock to suppliers', 'Record authorized supplier returns.')
on conflict (code) do update
set category = excluded.category,
    name = excluded.name,
    description = excluded.description;

-- Existing capability bundles keep their effective access.  This is based on
-- assigned capabilities, not on role codes, so organization-defined roles
-- migrate safely alongside preset roles.
with compatibility (legacy_permission, capability) as (
  values
    ('inventory.manage', 'inventory.transfer.create'),
    ('inventory.manage', 'inventory.transfer.send'),
    ('inventory.manage', 'inventory.transfer.receive'),
    ('inventory.manage', 'inventory.count.create'),
    ('inventory.manage', 'inventory.count.finalize'),
    ('inventory.manage', 'inventory.adjust.create'),
    ('inventory.manage', 'inventory.adjust.post'),
    ('inventory.manage', 'inventory.valuation.view'),
    ('inventory.manage', 'purchasing.view'),
    ('inventory.manage', 'purchasing.po.create'),
    ('inventory.manage', 'purchasing.receive'),
    ('inventory.manage', 'purchasing.suppliers.manage'),
    ('inventory.manage', 'purchasing.return'),
    ('inventory.transfers', 'inventory.transfer.create'),
    ('inventory.transfers', 'inventory.transfer.send'),
    ('inventory.transfers', 'inventory.transfer.receive'),
    ('inventory.count', 'inventory.count.create'),
    ('inventory.count', 'inventory.count.finalize'),
    ('inventory.adjust', 'inventory.adjust.create'),
    ('inventory.adjust', 'inventory.adjust.post'),
    ('inventory.purchase_orders', 'purchasing.view'),
    ('inventory.purchase_orders', 'purchasing.po.create'),
    ('inventory.receive', 'purchasing.receive'),
    ('inventory.suppliers', 'purchasing.suppliers.manage'),
    ('products.view_cost', 'inventory.valuation.view')
)
insert into public.role_permissions (organization_id, role_id, permission_code)
select distinct role_permission.organization_id, role_permission.role_id, compatibility.capability
from public.role_permissions role_permission
join compatibility on compatibility.legacy_permission = role_permission.permission_code
on conflict do nothing;

-- This resolver centralizes compatibility at the capability boundary.  A
-- customer-created role can use only the new code; an older role remains
-- operational through its already-assigned legacy capability.
create or replace function private.has_inventory_capability(
  target_organization_id uuid,
  requested_capability text
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
        and (
          role_permission.permission_code = requested_capability
          or role_permission.permission_code = 'inventory.manage'
          or (
            requested_capability in ('inventory.transfer.create', 'inventory.transfer.send', 'inventory.transfer.receive')
            and role_permission.permission_code = 'inventory.transfers'
          )
          or (
            requested_capability in ('inventory.count.create', 'inventory.count.finalize')
            and role_permission.permission_code = 'inventory.count'
          )
          or (
            requested_capability in ('inventory.adjust.create', 'inventory.adjust.post')
            and role_permission.permission_code = 'inventory.adjust'
          )
          or (
            requested_capability in ('purchasing.view', 'purchasing.po.create')
            and role_permission.permission_code = 'inventory.purchase_orders'
          )
          or (
            requested_capability = 'purchasing.receive'
            and role_permission.permission_code = 'inventory.receive'
          )
          or (
            requested_capability = 'purchasing.suppliers.manage'
            and role_permission.permission_code = 'inventory.suppliers'
          )
          or (
            requested_capability = 'inventory.valuation.view'
            and role_permission.permission_code = 'products.view_cost'
          )
        )
    ),
    false
  );
$$;

commit;
-- Phase 6: add capability-level inventory transfer authorization without
-- removing the established inventory permissions.  The existing document,
-- ledger, idempotency, discrepancy, and audit procedures remain canonical.
begin;

insert into public.permissions (code, category, name, description)
values
  ('inventory.transfer.create', 'Inventory', 'Create transfer requests', 'Create an authorized request for stock to move between stores.'),
  ('inventory.transfer.send', 'Inventory', 'Send stock transfers', 'Approve, pick, and dispatch stock from an authorized source store.'),
  ('inventory.transfer.receive', 'Inventory', 'Receive stock transfers', 'Record authorized stock-transfer receipts at an assigned destination store.'),
  ('inventory.count.create', 'Inventory', 'Create inventory counts', 'Create and prepare an inventory count.'),
  ('inventory.count.finalize', 'Inventory', 'Finalize inventory counts', 'Submit, post, or cancel an authorized inventory count.'),
  ('inventory.adjust.create', 'Inventory', 'Create inventory adjustments', 'Prepare an authorized inventory adjustment.'),
  ('inventory.adjust.post', 'Inventory', 'Post inventory adjustments', 'Post an authorized inventory adjustment to the immutable stock ledger.'),
  ('inventory.valuation.view', 'Inventory', 'View inventory valuation', 'View inventory valuation and cost-sensitive stock values.'),
  ('purchasing.view', 'Purchasing', 'View purchasing', 'View authorized suppliers, purchase orders, and receiving records.'),
  ('purchasing.po.create', 'Purchasing', 'Create purchase orders', 'Create and maintain authorized purchase orders.'),
  ('purchasing.receive', 'Purchasing', 'Receive purchase orders', 'Receive authorized supplier deliveries.'),
  ('purchasing.suppliers.manage', 'Purchasing', 'Manage suppliers', 'Create and maintain supplier records.'),
  ('purchasing.return', 'Purchasing', 'Return stock to suppliers', 'Record authorized supplier returns.')
on conflict (code) do update
set category = excluded.category,
    name = excluded.name,
    description = excluded.description;

-- Existing capability bundles keep their effective access.  This is based on
-- assigned capabilities, not on role codes, so organization-defined roles
-- migrate safely alongside preset roles.
with compatibility (legacy_permission, capability) as (
  values
    ('inventory.manage', 'inventory.transfer.create'),
    ('inventory.manage', 'inventory.transfer.send'),
    ('inventory.manage', 'inventory.transfer.receive'),
    ('inventory.manage', 'inventory.count.create'),
    ('inventory.manage', 'inventory.count.finalize'),
    ('inventory.manage', 'inventory.adjust.create'),
    ('inventory.manage', 'inventory.adjust.post'),
    ('inventory.manage', 'inventory.valuation.view'),
    ('inventory.manage', 'purchasing.view'),
    ('inventory.manage', 'purchasing.po.create'),
    ('inventory.manage', 'purchasing.receive'),
    ('inventory.manage', 'purchasing.suppliers.manage'),
    ('inventory.manage', 'purchasing.return'),
    ('inventory.transfers', 'inventory.transfer.create'),
    ('inventory.transfers', 'inventory.transfer.send'),
    ('inventory.transfers', 'inventory.transfer.receive'),
    ('inventory.count', 'inventory.count.create'),
    ('inventory.count', 'inventory.count.finalize'),
    ('inventory.adjust', 'inventory.adjust.create'),
    ('inventory.adjust', 'inventory.adjust.post'),
    ('inventory.purchase_orders', 'purchasing.view'),
    ('inventory.purchase_orders', 'purchasing.po.create'),
    ('inventory.receive', 'purchasing.receive'),
    ('inventory.suppliers', 'purchasing.suppliers.manage'),
    ('products.view_cost', 'inventory.valuation.view')
)
insert into public.role_permissions (organization_id, role_id, permission_code)
select distinct role_permission.organization_id, role_permission.role_id, compatibility.capability
from public.role_permissions role_permission
join compatibility on compatibility.legacy_permission = role_permission.permission_code
on conflict do nothing;

-- This resolver centralizes compatibility at the capability boundary.  A
-- customer-created role can use only the new code; an older role remains
-- operational through its already-assigned legacy capability.
create or replace function private.has_inventory_capability(
  target_organization_id uuid,
  requested_capability text
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
        and (
          role_permission.permission_code = requested_capability
          or role_permission.permission_code = 'inventory.manage'
          or (
            requested_capability in ('inventory.transfer.create', 'inventory.transfer.send', 'inventory.transfer.receive')
            and role_permission.permission_code = 'inventory.transfers'
          )
          or (
            requested_capability in ('inventory.count.create', 'inventory.count.finalize')
            and role_permission.permission_code = 'inventory.count'
          )
          or (
            requested_capability in ('inventory.adjust.create', 'inventory.adjust.post')
            and role_permission.permission_code = 'inventory.adjust'
          )
          or (
            requested_capability in ('purchasing.view', 'purchasing.po.create')
            and role_permission.permission_code = 'inventory.purchase_orders'
          )
          or (
            requested_capability = 'purchasing.receive'
            and role_permission.permission_code = 'inventory.receive'
          )
          or (
            requested_capability = 'purchasing.suppliers.manage'
            and role_permission.permission_code = 'inventory.suppliers'
          )
          or (
            requested_capability = 'inventory.valuation.view'
            and role_permission.permission_code = 'products.view_cost'
          )
        )
    ),
    false
  );
$$;

-- A sender must be able to discover the request that targets its authorized
-- warehouse, while a receiver continues to see requests for its destination.
create or replace function private.has_stock_request_read_scope(
  target_organization_id uuid,
  target_stock_request_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.stock_requests stock_request
    left join public.supply_chain_warehouses warehouse
      on warehouse.id = stock_request.source_warehouse_id
     and warehouse.organization_id = stock_request.organization_id
    where stock_request.id = target_stock_request_id
      and stock_request.organization_id = target_organization_id
      and (
        (select private.has_store_read_scope(target_organization_id, stock_request.requesting_store_id))
        or (warehouse.store_id is not null and (select private.has_store_read_scope(target_organization_id, warehouse.store_id)))
      )
  );
$$;

-- Transfer documents remain readable only where both a transfer capability and
-- the existing source/destination store scope grant access.
drop policy if exists stock_requests_select_inventory_manager on public.stock_requests;
create policy stock_requests_select_inventory_transfer_scope
  on public.stock_requests
  for select
  to authenticated
  using (
    (select private.has_any_inventory_capability(
      organization_id,
      array['inventory.transfer.create', 'inventory.transfer.send', 'inventory.transfer.receive']
    ))
    and (select private.has_stock_request_read_scope(organization_id, id))
  );

drop policy if exists stock_request_lines_select_inventory_manager on public.stock_request_lines;
create policy stock_request_lines_select_inventory_transfer_scope
  on public.stock_request_lines
  for select
  to authenticated
  using (
    (select private.has_any_inventory_capability(
      organization_id,
      array['inventory.transfer.create', 'inventory.transfer.send', 'inventory.transfer.receive']
    ))
    and (select private.has_stock_request_read_scope(organization_id, stock_request_id))
  );

drop policy if exists stock_transfers_select_inventory_manager on public.stock_transfers;
create policy stock_transfers_select_inventory_transfer_scope
  on public.stock_transfers
  for select
  to authenticated
  using (
    (select private.has_any_inventory_capability(
      organization_id,
      array['inventory.transfer.create', 'inventory.transfer.send', 'inventory.transfer.receive']
    ))
    and (select private.has_stock_transfer_read_scope(organization_id, id))
  );

drop policy if exists stock_transfer_lines_select_inventory_manager on public.stock_transfer_lines;
create policy stock_transfer_lines_select_inventory_transfer_scope
  on public.stock_transfer_lines
  for select
  to authenticated
  using (
    (select private.has_any_inventory_capability(
      organization_id,
      array['inventory.transfer.create', 'inventory.transfer.send', 'inventory.transfer.receive']
    ))
    and (select private.has_stock_transfer_read_scope(organization_id, stock_transfer_id))
  );

drop policy if exists stock_transfer_receipts_select_manager on public.stock_transfer_receipts;
create policy stock_transfer_receipts_select_inventory_transfer_scope
  on public.stock_transfer_receipts
  for select
  to authenticated
  using (
    (select private.has_any_inventory_capability(
      organization_id,
      array['inventory.transfer.create', 'inventory.transfer.send', 'inventory.transfer.receive']
    ))
    and (select private.has_stock_transfer_read_scope(organization_id, stock_transfer_id))
  );

drop policy if exists stock_transfer_receipt_lines_select_manager on public.stock_transfer_receipt_lines;
create policy stock_transfer_receipt_lines_select_inventory_transfer_scope
  on public.stock_transfer_receipt_lines
  for select
  to authenticated
  using (
    (select private.has_any_inventory_capability(
      organization_id,
      array['inventory.transfer.create', 'inventory.transfer.send', 'inventory.transfer.receive']
    ))
    and exists (
      select 1
      from public.stock_transfer_receipts receipt
      where receipt.id = stock_transfer_receipt_lines.stock_transfer_receipt_id
        and receipt.organization_id = stock_transfer_receipt_lines.organization_id
        and (select private.has_stock_transfer_read_scope(receipt.organization_id, receipt.stock_transfer_id))
    )
  );

drop policy if exists stock_request_discrepancies_select_inventory_manager on public.stock_request_discrepancies;
create policy stock_request_discrepancies_select_inventory_transfer_scope
  on public.stock_request_discrepancies
  for select
  to authenticated
  using (
    (select private.has_any_inventory_capability(
      organization_id,
      array['inventory.transfer.create', 'inventory.transfer.send', 'inventory.transfer.receive']
    ))
    and (select private.has_stock_request_read_scope(organization_id, stock_request_id))
  );

-- A request creator needs the authorized source warehouse name and identifier
-- to create a canonical request. Configuration mutations remain protected by
-- inventory.manage and are intentionally not broadened here.
drop policy if exists supply_chain_warehouses_select_inventory_manager on public.supply_chain_warehouses;
create policy supply_chain_warehouses_select_inventory_transfer_scope
  on public.supply_chain_warehouses
  for select
  to authenticated
  using (
    (select private.has_any_inventory_capability(
      organization_id,
      array['inventory.transfer.create', 'inventory.transfer.send']
    ))
    and (select private.has_store_read_scope(organization_id, store_id))
  );

revoke all on function private.has_inventory_capability(uuid, text),
  private.has_all_inventory_capabilities(uuid, text[]),
  private.has_any_inventory_capability(uuid, text[])
from public, anon, service_role;
grant execute on function private.has_inventory_capability(uuid, text),
  private.has_all_inventory_capabilities(uuid, text[]),
  private.has_any_inventory_capability(uuid, text[])
to authenticated;

comment on function private.has_inventory_capability(uuid, text) is
  'Capability-based inventory authorization with explicit legacy inventory permission compatibility. No role names are used.';
comment on function private.has_all_inventory_capabilities(uuid, text[]) is
  'Requires every listed inventory capability for the active employee in the active organization.';
comment on function private.has_any_inventory_capability(uuid, text[]) is
  'Returns whether the active employee has any listed inventory capability in the active organization.';

notify pgrst, 'reload schema';

commit;
