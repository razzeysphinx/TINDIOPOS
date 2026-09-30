begin;

CREATE OR REPLACE FUNCTION "private"."current_identity_subject"()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  select null::text;
$function$;

CREATE OR REPLACE FUNCTION "private"."current_identity_email"()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  select null::text;
$function$;

revoke execute on function private.current_identity_subject() from public, anon, authenticated, service_role;
revoke execute on function private.current_identity_email() from public, anon, authenticated, service_role;

-- Complete winning definitions for all 131 business functions.

CREATE OR REPLACE FUNCTION "private"."accept_employee_invitation"("invitation_token_hash" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  current_user_id uuid := (select private.current_profile_id());
  current_user_email text := lower(coalesce((select private.current_identity_email()), ''));
  invitation public.employee_invitations%rowtype;
  new_employee_id uuid;
begin
  if current_user_id is null or current_user_email = '' then
    raise exception 'Authentication with a verified email is required.' using errcode = '42501';
  end if;

  if invitation_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invitation token is invalid.' using errcode = '22023';
  end if;

  select *
  into invitation
  from public.employee_invitations employee_invitation
  where employee_invitation.token_hash = invitation_token_hash
    and employee_invitation.email = current_user_email
    and employee_invitation.accepted_at is null
    and employee_invitation.revoked_at is null
    and employee_invitation.expires_at > now()
  for update;

  if not found then
    raise exception 'Invitation is invalid, expired, or belongs to another email.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.employees employee
    where employee.profile_id = current_user_id
  ) then
    raise exception 'This account already belongs to an organization.' using errcode = '23505';
  end if;

  insert into public.employees (
    organization_id,
    profile_id,
    employee_number,
    job_title,
    status
  )
  values (
    invitation.organization_id,
    current_user_id,
    invitation.employee_number,
    invitation.job_title,
    'active'
  )
  returning id into new_employee_id;

  insert into public.employee_roles (organization_id, employee_id, role_id)
  values (invitation.organization_id, new_employee_id, invitation.role_id);

  insert into public.employee_stores (organization_id, employee_id, store_id)
  values (invitation.organization_id, new_employee_id, invitation.store_id);

  update public.employee_invitations
  set
    accepted_by = current_user_id,
    accepted_at = now()
  where id = invitation.id;

  return new_employee_id;
end;
$_$;

CREATE OR REPLACE FUNCTION "private"."adjust_inventory"("target_organization_id" "uuid", "target_store_id" "uuid", "target_product_id" "uuid", "target_variant_id" "uuid", "target_quantity_delta" numeric, "target_movement_type" "text", "target_reason" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_id uuid;
  product_kind text;
  tracks_stock boolean;
  current_quantity numeric(14, 3);
  next_quantity numeric(14, 3);
  new_movement_id uuid;
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'inventory.manage')) then
    raise exception 'Inventory management permission is required.' using errcode = '42501';
  end if;

  if target_quantity_delta is null
    or target_quantity_delta = 0
    or target_quantity_delta <> round(target_quantity_delta, 3) then
    raise exception 'Quantity must be non-zero with at most three decimal places.'
      using errcode = '23514';
  end if;

  if target_movement_type not in ('OPENING_STOCK', 'ADJUSTMENT') then
    raise exception 'Unsupported inventory movement type.' using errcode = '23514';
  end if;

  if char_length(trim(coalesce(target_reason, ''))) not between 2 and 500 then
    raise exception 'Inventory reason must contain between 2 and 500 characters.'
      using errcode = '23514';
  end if;

  select employee.id
  into actor_id
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select private.current_profile_id())
    and employee.status = 'active'
  limit 1;

  if actor_id is null then
    raise exception 'An active employee record is required.' using errcode = '42501';
  end if;

  select product.product_type, product.track_inventory
  into product_kind, tracks_stock
  from public.products product
  join public.product_store_settings setting
    on setting.organization_id = product.organization_id
   and setting.product_id = product.id
   and setting.store_id = target_store_id
   and setting.is_available
  join public.stores store
    on store.id = setting.store_id
   and store.organization_id = setting.organization_id
   and store.is_active
  where product.id = target_product_id
    and product.organization_id = target_organization_id
    and product.status = 'active';

  if product_kind is null or not tracks_stock then
    raise exception 'Select an active, inventory-tracked product available at this store.'
      using errcode = '23514';
  end if;

  if product_kind = 'simple' and target_variant_id is not null then
    raise exception 'Simple products do not accept a variant.' using errcode = '23514';
  end if;

  if product_kind = 'variable' and (
    target_variant_id is null
    or not exists (
      select 1
      from public.product_variants variant
      where variant.id = target_variant_id
        and variant.product_id = target_product_id
        and variant.organization_id = target_organization_id
        and variant.is_active
    )
  ) then
    raise exception 'Select an active variant belonging to this product.'
      using errcode = '23514';
  end if;

  select inventory_level.quantity
  into current_quantity
  from public.inventory_levels inventory_level
  where inventory_level.organization_id = target_organization_id
    and inventory_level.store_id = target_store_id
    and inventory_level.product_id = target_product_id
    and inventory_level.variant_id is not distinct from target_variant_id
  for update;

  if current_quantity is null then
    raise exception 'The stock projection is not initialized for this item and store.'
      using errcode = '23514';
  end if;

  if target_movement_type = 'OPENING_STOCK' and (
    current_quantity <> 0
    or exists (
      select 1
      from public.inventory_movements movement
      where movement.organization_id = target_organization_id
        and movement.store_id = target_store_id
        and movement.product_id = target_product_id
        and movement.variant_id is not distinct from target_variant_id
    )
  ) then
    raise exception 'Opening stock can only be recorded once on an untouched item.'
      using errcode = '23514';
  end if;

  next_quantity := current_quantity + target_quantity_delta;

  update public.inventory_levels
  set
    quantity = next_quantity,
    updated_at = now()
  where organization_id = target_organization_id
    and store_id = target_store_id
    and product_id = target_product_id
    and variant_id is not distinct from target_variant_id;

  insert into public.inventory_movements (
    organization_id,
    store_id,
    product_id,
    variant_id,
    quantity_delta,
    quantity_before,
    quantity_after,
    movement_type,
    actor_employee_id,
    reason
  )
  values (
    target_organization_id,
    target_store_id,
    target_product_id,
    target_variant_id,
    target_quantity_delta,
    current_quantity,
    next_quantity,
    target_movement_type,
    actor_id,
    trim(target_reason)
  )
  returning id into new_movement_id;

  return new_movement_id;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."approve_inventory_transfer"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid", "target_note" "text", "target_operation_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_id uuid;
  existing_operation private.stock_transfer_operations%rowtype;
  normalized_note text;
  operation_payload jsonb;
  transfer public.stock_transfers%rowtype;
begin
  if target_operation_id is null then
    raise exception 'A stable approval operation ID is required.' using errcode = '23514';
  end if;
  if target_note is not null and char_length(btrim(target_note)) > 500 then
    raise exception 'The transfer note is too long.' using errcode = '23514';
  end if;
  select * into transfer from public.stock_transfers item
  where item.organization_id = target_organization_id and item.id = target_stock_transfer_id;
  if transfer.id is null or transfer.stock_request_id is not null then
    raise exception 'Choose a canonical direct transfer in this organization.' using errcode = '23514';
  end if;
  if (select private.current_profile_id()) is null
     or not (select private.has_inventory_capability(target_organization_id, 'inventory.transfer.send')) then
    raise exception 'Transfer send permission is required.' using errcode = '42501';
  end if;
  actor_id := private.inventory_actor(target_organization_id, transfer.source_store_id);
  if actor_id is null then
    raise exception 'An active employee assigned to the source store is required.' using errcode = '42501';
  end if;

  normalized_note := nullif(btrim(target_note), '');
  operation_payload := jsonb_build_object('stock_transfer_id', target_stock_transfer_id, 'note', normalized_note);
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text || ':' || target_operation_id::text, 0));
  select * into existing_operation
  from private.stock_transfer_operations operation
  where operation.organization_id = target_organization_id and operation.operation_id = target_operation_id
  for update;
  if found then
    if existing_operation.command = 'approve' and existing_operation.normalized_payload = operation_payload then
      return existing_operation.result_id;
    end if;
    raise exception 'This operation ID is already assigned to a different transfer command.' using errcode = '23505';
  end if;

  select * into transfer from public.stock_transfers item
  where item.organization_id = target_organization_id and item.id = target_stock_transfer_id
  for update;
  if transfer.status <> 'submitted' then
    raise exception 'Only a submitted transfer can be approved.' using errcode = '23514';
  end if;

  update public.stock_transfers set status = 'approved' where id = transfer.id;
  insert into private.stock_transfer_operations (
    organization_id, stock_transfer_id, operation_id, command, normalized_payload,
    from_status, to_status, actor_employee_id, result_id, note
  ) values (
    target_organization_id, transfer.id, target_operation_id, 'approve', operation_payload,
    'submitted', 'approved', actor_id, transfer.id, normalized_note
  );
  perform private.write_audit_log(
    target_organization_id, 'STOCK_TRANSFER_APPROVED', 'inventory.transfer.send', actor_id,
    null, transfer.source_store_id, null, null, null, normalized_note,
    jsonb_build_object('stock_transfer_id', transfer.id, 'transfer_number', transfer.transfer_number, 'operation_id', target_operation_id)
  );
  return transfer.id;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."approve_stock_request"("target_organization_id" "uuid", "target_stock_request_id" "uuid", "target_lines" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare request_row public.stock_requests%rowtype; actor_id uuid; line jsonb; request_line public.stock_request_lines%rowtype; warehouse_store_id uuid;
begin
  if (select private.current_profile_id()) is null
     or (
       not (select private.has_permission(target_organization_id, 'inventory.manage'))
       and not (select private.has_inventory_capability(target_organization_id, 'inventory.transfer.send'))
     ) then raise exception 'Inventory permission is required.' using errcode = '42501'; end if;
  if target_lines is null or jsonb_typeof(target_lines) <> 'array' or jsonb_array_length(target_lines) not between 1 and 100 then raise exception 'Approval needs every request line.' using errcode = '23514'; end if;
  select * into request_row from public.stock_requests request where request.id = target_stock_request_id and request.organization_id = target_organization_id and request.status = 'requested' for update;
  if request_row.id is null then raise exception 'Only a submitted request can be approved.' using errcode = '23514'; end if;
  select warehouse.store_id into warehouse_store_id from public.supply_chain_warehouses warehouse where warehouse.id = request_row.source_warehouse_id and warehouse.organization_id = target_organization_id and warehouse.is_active;
  actor_id := private.inventory_actor(target_organization_id, warehouse_store_id);
  if actor_id is null then raise exception 'An assigned employee is required for the source warehouse.' using errcode = '42501'; end if;
  if (select count(*) from public.stock_request_lines where stock_request_id = request_row.id) <> jsonb_array_length(target_lines)
    or exists (select 1 from jsonb_array_elements(target_lines) approval(value) where jsonb_typeof(approval.value) <> 'object' or coalesce(approval.value->>'stock_request_line_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or coalesce(approval.value->>'approved_quantity','') !~ '^\d+(\.\d{1,3})?$')
    or (select count(*) from jsonb_array_elements(target_lines)) <> (select count(distinct value->>'stock_request_line_id') from jsonb_array_elements(target_lines)) then raise exception 'Approval lines are invalid.' using errcode = '23514'; end if;
  for line in select value from jsonb_array_elements(target_lines) loop
    select * into request_line from public.stock_request_lines item where item.id = (line->>'stock_request_line_id')::uuid and item.stock_request_id = request_row.id and item.organization_id = target_organization_id for update;
    if request_line.id is null or (line->>'approved_quantity')::numeric > request_line.requested_quantity then raise exception 'Approved quantity cannot exceed the request.' using errcode = '23514'; end if;
    update public.stock_request_lines set approved_quantity = (line->>'approved_quantity')::numeric(14,3) where id = request_line.id;
  end loop;
  if not exists (select 1 from public.stock_request_lines where stock_request_id = request_row.id and approved_quantity > 0) then raise exception 'Approve at least one requested quantity.' using errcode = '23514'; end if;
  update public.stock_requests set status = 'approved', approved_by_employee_id = actor_id, approved_at = now() where id = request_row.id;
  perform private.write_audit_log(target_organization_id, 'STOCK_REQUEST_APPROVED', 'inventory.manage', actor_id, null, request_row.requesting_store_id, null, null, null, null, jsonb_build_object('stock_request_id', request_row.id));
end;
$_$;

CREATE OR REPLACE FUNCTION "private"."can_access_kitchen_realtime_topic"("target_topic" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select coalesce(
    (select private.current_profile_id()) is not null
    and exists (
      select 1
      from public.employees employee
      join public.employee_stores employee_store
        on employee_store.employee_id = employee.id
       and employee_store.organization_id = employee.organization_id
      join public.employee_roles employee_role
        on employee_role.employee_id = employee.id
       and employee_role.organization_id = employee.organization_id
      join public.role_permissions role_permission
        on role_permission.role_id = employee_role.role_id
       and role_permission.organization_id = employee_role.organization_id
      where employee.profile_id = (select private.current_profile_id())
        and employee.status = 'active'
        and role_permission.permission_code in ('kitchen.view', 'kitchen.manage')
        and target_topic = private.kitchen_realtime_topic(
          employee.organization_id,
          employee_store.store_id
        )
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION "private"."can_grant_role"("target_organization_id" "uuid", "target_role_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select
    (select private.current_profile_id()) is not null
    and (select private.has_permission(
      target_organization_id,
      'employees.manage'
    ))
    and exists (
      select 1
      from public.roles role
      where role.id = target_role_id
        and role.organization_id = target_organization_id
    )
    and not exists (
      select 1
      from public.role_permissions role_permission
      where role_permission.organization_id = target_organization_id
        and role_permission.role_id = target_role_id
        and not (select private.has_permission(
          target_organization_id,
          role_permission.permission_code
        ))
    );
$$;

CREATE OR REPLACE FUNCTION "private"."cancel_inventory_transfer"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid", "target_note" "text", "target_operation_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_id uuid;
  existing_operation private.stock_transfer_operations%rowtype;
  normalized_note text;
  operation_payload jsonb;
  required_capability text;
  transfer public.stock_transfers%rowtype;
begin
  if target_operation_id is null then
    raise exception 'A stable cancellation operation ID is required.' using errcode = '23514';
  end if;
  if target_note is not null and char_length(btrim(target_note)) > 500 then
    raise exception 'The transfer cancellation note is too long.' using errcode = '23514';
  end if;
  select * into transfer from public.stock_transfers item
  where item.organization_id = target_organization_id and item.id = target_stock_transfer_id;
  if transfer.id is null or transfer.stock_request_id is not null then
    raise exception 'Choose a canonical direct transfer in this organization.' using errcode = '23514';
  end if;
  if (select private.current_profile_id()) is null
     or not (
       (select private.has_inventory_capability(target_organization_id, 'inventory.transfer.create'))
       or (select private.has_inventory_capability(target_organization_id, 'inventory.transfer.send'))
     ) then
    raise exception 'Transfer cancellation permission is required.' using errcode = '42501';
  end if;
  actor_id := private.inventory_actor(target_organization_id, transfer.source_store_id);
  if actor_id is null then
    raise exception 'An active employee assigned to the source store is required.' using errcode = '42501';
  end if;

  normalized_note := nullif(btrim(target_note), '');
  operation_payload := jsonb_build_object('stock_transfer_id', target_stock_transfer_id, 'note', normalized_note);
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text || ':' || target_operation_id::text, 0));
  select * into existing_operation
  from private.stock_transfer_operations operation
  where operation.organization_id = target_organization_id and operation.operation_id = target_operation_id
  for update;
  if found then
    if existing_operation.command = 'cancel' and existing_operation.normalized_payload = operation_payload then
      return existing_operation.result_id;
    end if;
    raise exception 'This operation ID is already assigned to a different transfer command.' using errcode = '23505';
  end if;

  select * into transfer from public.stock_transfers item
  where item.organization_id = target_organization_id and item.id = target_stock_transfer_id
  for update;
  if transfer.status not in ('draft', 'submitted', 'approved') then
    raise exception 'Only a pre-dispatch transfer can be cancelled.' using errcode = '23514';
  end if;
  required_capability := case when transfer.status = 'approved' then 'inventory.transfer.send' else 'inventory.transfer.create' end;
  if not (select private.has_inventory_capability(target_organization_id, required_capability)) then
    raise exception 'The required transfer cancellation permission is missing.' using errcode = '42501';
  end if;

  update public.stock_transfers set status = 'cancelled' where id = transfer.id;
  insert into private.stock_transfer_operations (
    organization_id, stock_transfer_id, operation_id, command, normalized_payload,
    from_status, to_status, actor_employee_id, result_id, note
  ) values (
    target_organization_id, transfer.id, target_operation_id, 'cancel', operation_payload,
    transfer.status, 'cancelled', actor_id, transfer.id, normalized_note
  );
  perform private.write_audit_log(
    target_organization_id, 'STOCK_TRANSFER_CANCELLED', required_capability, actor_id,
    null, transfer.source_store_id, null, null, null, normalized_note,
    jsonb_build_object('stock_transfer_id', transfer.id, 'transfer_number', transfer.transfer_number, 'operation_id', target_operation_id)
  );
  return transfer.id;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."cancel_open_ticket"("target_organization_id" "uuid", "target_ticket_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  target_ticket public.open_tickets%rowtype;
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'sales.create')) then
    raise exception 'Sales permission is required.' using errcode = '42501';
  end if;

  select ticket.*
  into target_ticket
  from public.open_tickets ticket
  where ticket.id = target_ticket_id
    and ticket.organization_id = target_organization_id
    and ticket.status = 'open'
  for update;

  if target_ticket.id is null then
    raise exception 'This open ticket is no longer available.' using errcode = 'P0002';
  end if;

  perform private.require_active_pos_shift(
    target_organization_id,
    target_ticket.store_id,
    target_ticket.register_id
  );

  update public.open_tickets ticket
  set status = 'cancelled'
  where ticket.id = target_ticket.id
    and ticket.organization_id = target_organization_id;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."cancel_purchase_order"("target_organization_id" "uuid", "target_purchase_order_id" "uuid", "target_note" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  purchase public.purchase_orders%rowtype;
  actor_id uuid;
  normalized_note text;
begin
  if (select private.current_profile_id()) is null
     or (not (select private.has_permission(target_organization_id, 'inventory.manage')) and not (select private.has_inventory_capability(target_organization_id, 'purchasing.po.create'))) then
    raise exception 'Inventory permission is required.' using errcode = '42501';
  end if;

  select *
  into purchase
  from public.purchase_orders purchase_order
  where purchase_order.id = target_purchase_order_id
    and purchase_order.organization_id = target_organization_id
    and purchase_order.status in ('draft', 'ordered', 'partially_received')
  for update;

  if purchase.id is null then
    raise exception 'This purchase order cannot be cancelled.' using errcode = '23514';
  end if;

  actor_id := private.inventory_actor(target_organization_id, purchase.store_id);
  if actor_id is null then
    raise exception 'An assigned employee is required for this store.' using errcode = '42501';
  end if;

  normalized_note := nullif(btrim(target_note), '');
  update public.purchase_orders
  set status = 'cancelled'
  where id = purchase.id;

  perform private.write_audit_log(
    target_organization_id,
    'PURCHASE_ORDER_CANCELLED',
    'inventory.manage',
    actor_id,
    null,
    purchase.store_id,
    null,
    null,
    null,
    normalized_note,
    jsonb_build_object('purchase_order_id', purchase.id, 'remaining_quantity', (
      select coalesce(sum(ordered_quantity - received_quantity), 0)
      from public.purchase_order_lines purchase_line
      where purchase_line.purchase_order_id = purchase.id
    ))
  );

  return purchase.id;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."checkout_advanced_sale"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_idempotency_key" "uuid", "target_items" "jsonb", "target_payments" "jsonb", "target_customer_id" "uuid", "target_loyalty_redemption_points" integer, "target_discount_id" "uuid", "target_tax_rate_id" "uuid", "target_dining_option_id" "uuid", "target_open_ticket_id" "uuid") RETURNS TABLE("sale_id" "uuid", "receipt_number" bigint, "total_minor" bigint, "change_minor" bigint, "payment_summary" "jsonb", "was_replayed" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  actor_employee_id uuid; existing_request public.advanced_checkout_requests%rowtype; request_payload jsonb;
  selected_customer public.customers%rowtype; loyalty_program public.loyalty_programs%rowtype;
  selected_discount public.discounts%rowtype; selected_tax public.tax_rates%rowtype; selected_dining public.dining_options%rowtype;
  selected_ticket public.open_tickets%rowtype; selected_fake_method record; selected_payment record;
  normalized_items jsonb; quoted_lines jsonb := '[]'::jsonb; line jsonb; option_ids jsonb; option_snapshot jsonb;
  product_name text; variant_name text; sku text; item_unit text; base_price bigint; modifier_price bigint; quantity numeric(14, 3);
  subtotal bigint := 0; discount_total bigint := 0; tax_total bigint := 0; grand_total bigint; tax_inclusive boolean := false;
  loyalty_payment_method_id uuid; redemption_minor bigint := 0; earned_points integer := 0; customer_balance integer := 0;
  decorated_payments jsonb; synthetic_payment jsonb; synthetic_key uuid; checkout_result record; new_payment_summary jsonb := '[]'::jsonb;
  paid_total bigint := 0; change_total bigint := 0; remaining bigint; applied bigint; tendered bigint; payment_change bigint;
  payment_method_id uuid; payment_name text; payment_code text; payment_type text; payment_requires_reference boolean; payment_is_loyalty boolean;
  payment_reference text; payment_note text; requested_amount bigint; receipt_value bigint;
begin
  if target_organization_id is null or target_store_id is null or target_register_id is null or target_idempotency_key is null then
    raise exception 'A store, register, and checkout key are required.' using errcode = '23514';
  end if;
  if (select private.current_profile_id()) is null or not (select private.has_permission(target_organization_id, 'sales.create')) then
    raise exception 'Sales permission is required.' using errcode = '42501';
  end if;
  if target_items is null or jsonb_typeof(target_items) <> 'array' or jsonb_array_length(target_items) not between 1 and 100
    or target_payments is null or jsonb_typeof(target_payments) <> 'array' or jsonb_array_length(target_payments) not between 1 and 10 then
    raise exception 'Checkout items and payments must contain between 1 and their supported limit.' using errcode = '23514';
  end if;
  if coalesce(target_loyalty_redemption_points, 0) not between 0 and 100000000 then
    raise exception 'Loyalty redemption points must be between 0 and 100,000,000.' using errcode = '23514';
  end if;

  select employee.id into actor_employee_id from public.employees employee
  join public.employee_stores es on es.employee_id = employee.id and es.organization_id = employee.organization_id and es.store_id = target_store_id
  join public.registers register on register.id = target_register_id and register.organization_id = employee.organization_id and register.store_id = target_store_id and register.is_active
  where employee.organization_id = target_organization_id and employee.profile_id = (select private.current_profile_id()) and employee.status = 'active';
  if actor_employee_id is null then raise exception 'An active assigned employee and register are required.' using errcode = '42501'; end if;

  request_payload := jsonb_build_object('items', target_items, 'payments', target_payments, 'store_id', target_store_id, 'register_id', target_register_id, 'customer_id', target_customer_id, 'loyalty_redemption_points', coalesce(target_loyalty_redemption_points, 0), 'discount_id', target_discount_id, 'tax_rate_id', target_tax_rate_id, 'dining_option_id', target_dining_option_id, 'open_ticket_id', target_open_ticket_id);
  select * into existing_request from public.advanced_checkout_requests request where request.organization_id = target_organization_id and request.idempotency_key = target_idempotency_key for update;
  if found then
    if existing_request.actor_employee_id is distinct from actor_employee_id or existing_request.request_payload is distinct from request_payload then raise exception 'This checkout key was already used for a different request.' using errcode = '23505'; end if;
    if existing_request.sale_id is null then raise exception 'The prior checkout did not finish. Try again with a new checkout key.' using errcode = '40001'; end if;
    select receipt.receipt_number into receipt_value from public.receipts receipt where receipt.sale_id = existing_request.sale_id and receipt.organization_id = target_organization_id;
    select coalesce(jsonb_agg(jsonb_build_object('payment_method_id', payment.payment_method_id, 'name', payment.payment_method_name_snapshot, 'code', payment.payment_method_code_snapshot, 'type', payment.payment_method_type_snapshot, 'amount_minor', payment.amount_minor, 'amount_tendered_minor', payment.amount_tendered_minor, 'change_given_minor', payment.change_given_minor, 'reference_number', payment.reference_number, 'note', payment.note) order by payment.created_at, payment.id), '[]'::jsonb) into new_payment_summary from public.payments payment where payment.sale_id = existing_request.sale_id and payment.organization_id = target_organization_id;
    return query select sale.id, receipt_value, sale.total_minor, coalesce((select sum(payment.change_given_minor) from public.payments payment where payment.sale_id = sale.id), 0)::bigint, new_payment_summary, true from public.sales sale where sale.id = existing_request.sale_id and sale.organization_id = target_organization_id;
    return;
  end if;
  perform private.require_active_pos_shift(
    target_organization_id,
    target_store_id,
    target_register_id
  );

  insert into public.advanced_checkout_requests (organization_id, actor_employee_id, idempotency_key, request_payload) values (target_organization_id, actor_employee_id, target_idempotency_key, request_payload);

  select jsonb_agg(jsonb_build_object('product_id', item.value -> 'product_id', 'variant_id', coalesce(item.value -> 'variant_id', 'null'::jsonb), 'quantity', item.value -> 'quantity', 'unit_price_minor', coalesce(item.value -> 'unit_price_minor', 'null'::jsonb)) order by item.ordinality) into normalized_items from jsonb_array_elements(target_items) with ordinality item(value, ordinality);
  perform private.quote_checkout_subtotal(target_organization_id, target_store_id, normalized_items);

  for line in select value from jsonb_array_elements(target_items) loop
    if jsonb_typeof(line -> 'product_id') <> 'string' or coalesce(line ->> 'quantity', '') !~ '^(?:0|[1-9][0-9]{0,3})([.][0-9]{1,3})?' then raise exception 'Each checkout item must have valid item references and quantity.' using errcode = '23514'; end if;
    quantity := (line ->> 'quantity')::numeric(14, 3);
    if quantity <= 0 then raise exception 'Each checkout item must have a quantity greater than zero.' using errcode = '23514'; end if;
    if line ? 'item_note' and (
      jsonb_typeof(line -> 'item_note') <> 'string'
      or char_length(btrim(line ->> 'item_note')) not between 1 and 500
    ) then
      raise exception 'Item notes must contain between 1 and 500 characters.' using errcode = '23514';
    end if;
    if quantity <= 0 then raise exception 'Each checkout item must have a quantity greater than zero.' using errcode = '23514'; end if;
    if nullif(line ->> 'variant_id', '') is null then
      select product.name, null::text, product.sku, product.unit, coalesce(setting.price_override_minor, product.price_minor) into product_name, variant_name, sku, item_unit, base_price from public.products product join public.product_store_settings setting on setting.organization_id = product.organization_id and setting.product_id = product.id and setting.store_id = target_store_id and setting.is_available where product.id = (line ->> 'product_id')::uuid and product.organization_id = target_organization_id and product.status = 'active' and product.product_type = 'simple';
    else
      select product.name, variant.name, variant.sku, product.unit, variant.price_minor into product_name, variant_name, sku, item_unit, base_price from public.products product join public.product_store_settings setting on setting.organization_id = product.organization_id and setting.product_id = product.id and setting.store_id = target_store_id and setting.is_available join public.product_variants variant on variant.id = (line ->> 'variant_id')::uuid and variant.product_id = product.id and variant.organization_id = product.organization_id and variant.is_active where product.id = (line ->> 'product_id')::uuid and product.organization_id = target_organization_id and product.status = 'active' and product.product_type = 'variable';
    end if;
    if base_price is null then raise exception 'Every checkout item must be active and available at this store.' using errcode = '23514'; end if;
    if quantity <> trunc(quantity) and not exists (select 1 from public.products product where product.id = (line ->> 'product_id')::uuid and product.organization_id = target_organization_id and product.allow_fractional_quantity) then raise exception 'This product must be sold in whole units.' using errcode = '23514'; end if;
    if exists (select 1 from public.products product where product.id = (line ->> 'product_id')::uuid and product.organization_id = target_organization_id and product.is_variable_price) then
      if jsonb_typeof(line -> 'unit_price_minor') <> 'number' or coalesce(line ->> 'unit_price_minor', '') !~ '^[1-9][0-9]{0,9}$' then raise exception 'Enter a supported manual price for this product.' using errcode = '23514'; end if;
      base_price := (line ->> 'unit_price_minor')::bigint;
    elsif line ? 'unit_price_minor' and line -> 'unit_price_minor' <> 'null'::jsonb then
      raise exception 'Manual pricing is not enabled for this product.' using errcode = '23514';
    end if;
    option_ids := coalesce(line -> 'modifier_option_ids', '[]'::jsonb);
    if jsonb_typeof(option_ids) <> 'array' or jsonb_array_length(option_ids) > 50 or exists (select 1 from jsonb_array_elements(option_ids) option where jsonb_typeof(option) <> 'string' or option #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then raise exception 'Modifier selections are invalid.' using errcode = '23514'; end if;
    if (select count(*) from jsonb_array_elements_text(option_ids)) <> (select count(distinct value) from jsonb_array_elements_text(option_ids)) then raise exception 'Choose each modifier option only once.' using errcode = '23514'; end if;
    if exists (select 1 from jsonb_array_elements_text(option_ids) selected(option_id) left join public.modifier_options option on option.id = selected.option_id::uuid and option.organization_id = target_organization_id and option.is_active left join public.product_modifier_groups assignment on assignment.modifier_group_id = option.modifier_group_id and assignment.organization_id = option.organization_id and assignment.product_id = (line ->> 'product_id')::uuid where option.id is null or assignment.product_id is null) then raise exception 'One or more modifiers are unavailable for this product.' using errcode = '23514'; end if;
    if exists (select 1 from public.product_modifier_groups assignment join public.modifier_groups grp on grp.id = assignment.modifier_group_id and grp.organization_id = assignment.organization_id and grp.is_active left join public.modifier_options option on option.modifier_group_id = grp.id and option.organization_id = grp.organization_id and option.is_active and option.id in (select value::uuid from jsonb_array_elements_text(option_ids)) where assignment.organization_id = target_organization_id and assignment.product_id = (line ->> 'product_id')::uuid group by grp.id, grp.min_selections, grp.max_selections having count(option.id) < grp.min_selections or count(option.id) > grp.max_selections) then raise exception 'Choose the required number of options for each modifier group.' using errcode = '23514'; end if;
    select coalesce(sum(option.price_adjustment_minor), 0)::bigint, coalesce(jsonb_agg(jsonb_build_object('id', option.id, 'name', option.name, 'price_adjustment_minor', option.price_adjustment_minor) order by option.sort_order, lower(option.name)), '[]'::jsonb) into modifier_price, option_snapshot from public.modifier_options option where option.id in (select value::uuid from jsonb_array_elements_text(option_ids));
    subtotal := subtotal + round((base_price + modifier_price)::numeric * quantity)::bigint;
    quoted_lines := quoted_lines || jsonb_build_array(jsonb_build_object('product_id', line ->> 'product_id', 'variant_id', nullif(line ->> 'variant_id', ''), 'quantity', quantity, 'product_name', product_name, 'variant_name', variant_name, 'sku', sku, 'unit', item_unit, 'base_price_minor', base_price, 'modifier_total_minor', modifier_price, 'modifiers', option_snapshot, 'item_note', nullif(btrim(line ->> 'item_note'), '')));
  end loop;
  if subtotal <= 0 then raise exception 'A checkout total must be greater than zero.' using errcode = '23514'; end if;

  if target_discount_id is not null then select * into selected_discount from public.discounts discount where discount.id = target_discount_id and discount.organization_id = target_organization_id and discount.is_active for key share; if selected_discount.id is null then raise exception 'The selected discount is not active.' using errcode = '23514'; end if; discount_total := case when selected_discount.discount_type = 'percentage' then round(subtotal::numeric * selected_discount.percentage_bps / 10000)::bigint else selected_discount.amount_minor end; discount_total := least(discount_total, subtotal); end if;
  if target_tax_rate_id is not null then select * into selected_tax from public.tax_rates tax where tax.id = target_tax_rate_id and tax.organization_id = target_organization_id and tax.is_active for key share; elsif exists (select 1 from public.tax_rates tax where tax.organization_id = target_organization_id and tax.is_active and tax.is_default) then select * into selected_tax from public.tax_rates tax where tax.organization_id = target_organization_id and tax.is_active and tax.is_default for key share; end if;
  if selected_tax.id is not null then tax_inclusive := selected_tax.is_inclusive; tax_total := case when tax_inclusive then round((subtotal - discount_total)::numeric * selected_tax.rate_bps / (10000 + selected_tax.rate_bps))::bigint else round((subtotal - discount_total)::numeric * selected_tax.rate_bps / 10000)::bigint end; end if;
  grand_total := subtotal - discount_total + case when tax_inclusive then 0 else tax_total end;
  if grand_total <= 0 then raise exception 'The discount leaves no balance to collect.' using errcode = '23514'; end if;
  if target_dining_option_id is not null then select * into selected_dining from public.dining_options option where option.id = target_dining_option_id and option.organization_id = target_organization_id and option.is_active for key share; if selected_dining.id is null then raise exception 'The selected dining option is not active.' using errcode = '23514'; end if; end if;
  if target_open_ticket_id is not null then select * into selected_ticket from public.open_tickets ticket where ticket.id = target_open_ticket_id and ticket.organization_id = target_organization_id and ticket.store_id = target_store_id and ticket.register_id = target_register_id and ticket.status = 'open' for update; if selected_ticket.id is null then raise exception 'The selected open ticket is no longer available.' using errcode = '23514'; end if; end if;

  if target_customer_id is null and coalesce(target_loyalty_redemption_points, 0) > 0 then raise exception 'Assign a customer before redeeming loyalty points.' using errcode = '23514'; end if;
  if target_customer_id is not null then
    select * into selected_customer from public.customers customer where customer.id = target_customer_id and customer.organization_id = target_organization_id and customer.status = 'active' for update; if selected_customer.id is null then raise exception 'The selected customer is not active in this organization.' using errcode = '23514'; end if;
    select * into loyalty_program from public.loyalty_programs program where program.organization_id = target_organization_id for key share;
    if coalesce(target_loyalty_redemption_points, 0) > 0 then
      if loyalty_program.organization_id is null or not loyalty_program.is_enabled then raise exception 'Loyalty redemption is currently disabled.' using errcode = '23514'; end if;
      if target_loyalty_redemption_points < loyalty_program.minimum_redemption_points then raise exception 'This redemption is below the program minimum.' using errcode = '23514'; end if;
      select coalesce(sum(transaction.points_delta), 0)::integer into customer_balance from public.loyalty_transactions transaction where transaction.organization_id = target_organization_id and transaction.customer_id = target_customer_id; if customer_balance < target_loyalty_redemption_points then raise exception 'The customer does not have enough loyalty points.' using errcode = '23514'; end if;
      redemption_minor := target_loyalty_redemption_points::bigint * loyalty_program.redemption_value_minor; if redemption_minor > grand_total then raise exception 'Loyalty points cannot exceed this sale total.' using errcode = '23514'; end if;
      select method.id into loyalty_payment_method_id from public.payment_methods method join public.store_payment_methods store_method on store_method.organization_id = method.organization_id and store_method.payment_method_id = method.id and store_method.store_id = target_store_id and store_method.is_enabled where method.organization_id = target_organization_id and method.is_loyalty_redemption and method.is_enabled for key share; if loyalty_payment_method_id is null then raise exception 'Loyalty redemption is not enabled for this store.' using errcode = '23514'; end if;
    end if;
  end if;
  if redemption_minor > 0 then
    if jsonb_array_length(target_payments) >= 10 then raise exception 'Use at most nine customer payment entries when redeeming loyalty points.' using errcode = '23514'; end if;
    decorated_payments := jsonb_build_array(jsonb_build_object('payment_method_id', loyalty_payment_method_id, 'amount_minor', redemption_minor, '_tindio_loyalty', true)) || target_payments;
  else decorated_payments := target_payments; end if;

  select method.id, method.payment_type, method.requires_reference into selected_fake_method from public.payment_methods method join public.store_payment_methods store_method on store_method.organization_id = method.organization_id and store_method.payment_method_id = method.id and store_method.store_id = target_store_id and store_method.is_enabled where method.organization_id = target_organization_id and method.is_enabled and not method.is_loyalty_redemption order by method.sort_order, method.created_at limit 1 for key share; if selected_fake_method.id is null then raise exception 'No standard payment method is enabled for this store.' using errcode = '23514'; end if;
  synthetic_payment := jsonb_build_object('payment_method_id', selected_fake_method.id) || case when selected_fake_method.payment_type = 'CASH' then jsonb_build_object('amount_tendered_minor', private.quote_checkout_subtotal(target_organization_id, target_store_id, normalized_items)) else jsonb_build_object('amount_minor', private.quote_checkout_subtotal(target_organization_id, target_store_id, normalized_items)) end || case when selected_fake_method.requires_reference then jsonb_build_object('reference_number', 'TINDIO-INTERNAL') else '{}'::jsonb end;
  synthetic_key := (substr(md5('tindio-advanced:' || target_idempotency_key::text), 1, 8) || '-' || substr(md5('tindio-advanced:' || target_idempotency_key::text), 9, 4) || '-' || substr(md5('tindio-advanced:' || target_idempotency_key::text), 13, 4) || '-' || substr(md5('tindio-advanced:' || target_idempotency_key::text), 17, 4) || '-' || substr(md5('tindio-advanced:' || target_idempotency_key::text), 21, 12))::uuid;
  select * into checkout_result from private.checkout_sale(target_organization_id, target_store_id, target_register_id, synthetic_key, normalized_items, jsonb_build_array(synthetic_payment));
  if checkout_result.was_replayed then raise exception 'The internal checkout was unexpectedly replayed. Start a new checkout.' using errcode = '40001'; end if;

  delete from public.payments payment where payment.sale_id = checkout_result.sale_id and payment.organization_id = target_organization_id;
  delete from public.sale_items sale_item where sale_item.sale_id = checkout_result.sale_id and sale_item.organization_id = target_organization_id;
  for line in select value from jsonb_array_elements(quoted_lines) loop
    insert into public.sale_items (organization_id, sale_id, product_id, variant_id, product_name_snapshot, variant_name_snapshot, sku_snapshot, unit_snapshot, quantity, unit_price_minor, modifier_total_minor, modifiers_snapshot, item_note, line_total_minor)
    values (target_organization_id, checkout_result.sale_id, (line ->> 'product_id')::uuid, nullif(line ->> 'variant_id', '')::uuid, line ->> 'product_name', nullif(line ->> 'variant_name', ''), nullif(line ->> 'sku', ''), line ->> 'unit', (line ->> 'quantity')::numeric(14, 3), (line ->> 'base_price_minor')::bigint, (line ->> 'modifier_total_minor')::bigint, line -> 'modifiers', nullif(btrim(line ->> 'item_note'), ''), round(((line ->> 'base_price_minor')::bigint + (line ->> 'modifier_total_minor')::bigint)::numeric * (line ->> 'quantity')::numeric(14, 3))::bigint);
  end loop;
  update public.sales sale set subtotal_minor = subtotal, discount_minor = discount_total, tax_minor = tax_total, tax_is_inclusive = tax_inclusive, total_minor = grand_total, discount_id = selected_discount.id, discount_name_snapshot = selected_discount.name, tax_rate_id = selected_tax.id, tax_name_snapshot = selected_tax.name, dining_option_id = selected_dining.id, dining_option_name_snapshot = selected_dining.name, open_ticket_id = selected_ticket.id, customer_id = target_customer_id, loyalty_redemption_minor = redemption_minor, loyalty_points_redeemed = coalesce(target_loyalty_redemption_points, 0) where sale.id = checkout_result.sale_id and sale.organization_id = target_organization_id;

  for selected_payment in select value, ordinality from jsonb_array_elements(decorated_payments) with ordinality payment(value, ordinality) order by ordinality loop
    remaining := grand_total - paid_total; if remaining <= 0 then raise exception 'No additional payment is needed for this sale.' using errcode = '23514'; end if;
    if jsonb_typeof(selected_payment.value -> 'payment_method_id') <> 'string' then raise exception 'Each payment must include a valid payment method.' using errcode = '23514'; end if;
    payment_method_id := (selected_payment.value ->> 'payment_method_id')::uuid;
    select method.name, method.code, method.payment_type, method.requires_reference, method.is_loyalty_redemption into payment_name, payment_code, payment_type, payment_requires_reference, payment_is_loyalty from public.payment_methods method join public.store_payment_methods store_method on store_method.organization_id = method.organization_id and store_method.payment_method_id = method.id and store_method.store_id = target_store_id and store_method.is_enabled where method.id = (selected_payment.value ->> 'payment_method_id')::uuid and method.organization_id = target_organization_id and method.is_enabled for key share;
    if payment_name is null then raise exception 'That payment method is not enabled for this store.' using errcode = '23514'; end if;
    if payment_is_loyalty and (selected_payment.ordinality <> 1 or redemption_minor = 0 or payment_method_id <> loyalty_payment_method_id or not coalesce((selected_payment.value ->> '_tindio_loyalty')::boolean, false)) then raise exception 'Loyalty payment can only be created from a validated redemption.' using errcode = '23514'; end if;
    if not payment_is_loyalty and selected_payment.value ? '_tindio_loyalty' then raise exception 'Invalid payment method.' using errcode = '23514'; end if;
    payment_reference := nullif(btrim(selected_payment.value ->> 'reference_number'), ''); payment_note := nullif(btrim(selected_payment.value ->> 'note'), ''); if payment_requires_reference and payment_reference is null then raise exception 'A reference number is required for the selected payment method.' using errcode = '23514'; end if;
    select settlement.applied_minor, settlement.tendered_minor, settlement.change_minor into applied, tendered, payment_change from private.settle_checkout_payment(payment_type, nullif(selected_payment.value ->> 'amount_minor', '')::bigint, nullif(selected_payment.value ->> 'amount_tendered_minor', '')::bigint, remaining) settlement;
    insert into public.payments (organization_id, sale_id, payment_method_id, payment_method_name_snapshot, payment_method_code_snapshot, payment_method_type_snapshot, amount_minor, amount_tendered_minor, change_given_minor, reference_number, note) values (target_organization_id, checkout_result.sale_id, payment_method_id, payment_name, payment_code, payment_type, applied, tendered, payment_change, payment_reference, payment_note);
    paid_total := paid_total + applied; change_total := change_total + coalesce(payment_change, 0); new_payment_summary := new_payment_summary || jsonb_build_array(jsonb_build_object('payment_method_id', payment_method_id, 'name', payment_name, 'code', payment_code, 'type', payment_type, 'amount_minor', applied, 'amount_tendered_minor', tendered, 'change_given_minor', payment_change, 'reference_number', payment_reference, 'note', payment_note));
  end loop;
  if paid_total <> grand_total then
    raise exception 'Payments must exactly cover the sale total before completion.'
      using errcode = '23514',
        detail = format(
          'checkout_function=private.checkout_advanced_sale expected_minor=%s applied_minor=%s',
          grand_total,
          paid_total
        );
  end if;
  if target_customer_id is not null and loyalty_program.is_enabled then earned_points := floor((grand_total - redemption_minor)::numeric / loyalty_program.earn_spend_minor)::integer * loyalty_program.earn_points; update public.sales set loyalty_points_earned = earned_points where id = checkout_result.sale_id and organization_id = target_organization_id; if redemption_minor > 0 then insert into public.loyalty_transactions (organization_id, customer_id, sale_id, entry_type, points_delta, note) values (target_organization_id, target_customer_id, checkout_result.sale_id, 'REDEMPTION', -target_loyalty_redemption_points, 'Redeemed during advanced POS checkout'); end if; if earned_points > 0 then insert into public.loyalty_transactions (organization_id, customer_id, sale_id, entry_type, points_delta, note) values (target_organization_id, target_customer_id, checkout_result.sale_id, 'SALE_EARN', earned_points, 'Earned from advanced POS checkout'); end if; end if;
  if selected_ticket.id is not null then update public.open_tickets set status = 'completed', sale_id = checkout_result.sale_id where id = selected_ticket.id and organization_id = target_organization_id; end if;
  update public.advanced_checkout_requests set state = 'completed', sale_id = checkout_result.sale_id, completed_at = now() where organization_id = target_organization_id and idempotency_key = target_idempotency_key;
  return query select checkout_result.sale_id, checkout_result.receipt_number, grand_total, change_total, new_payment_summary, false;
end;
$_$;

CREATE OR REPLACE FUNCTION "private"."checkout_catalog_special_sale"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_idempotency_key" "uuid", "target_items" "jsonb", "target_payments" "jsonb") RETURNS TABLE("sale_id" "uuid", "receipt_number" bigint, "total_minor" bigint, "change_minor" bigint, "payment_summary" "jsonb", "was_replayed" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  actor_employee_id uuid;
  organization_name_snapshot text;
  store_name_snapshot text;
  register_name_snapshot text;
  cashier_name_snapshot text;
  sale_currency_code text;
  checkout_request_id uuid;
  checkout_line record;
  quantity numeric(14, 3);
  resolved_price_minor bigint;
  requested_price_minor bigint;
  line_total_minor bigint;
  product_name_snapshot text;
  variant_name_snapshot text;
  sku_snapshot text;
  unit_snapshot text;
  tracks_inventory boolean;
  product_allows_fractional boolean;
  product_is_variable_price boolean;
  current_quantity numeric(14, 3);
  next_quantity numeric(14, 3);
  calculated_subtotal_minor bigint := 0;
  new_sale_id uuid;
  new_receipt_number bigint;
  payment_row jsonb;
  selected_payment_method_id uuid;
  payment_name text;
  payment_code text;
  payment_type text;
  payment_requires_reference boolean;
  tendered_minor bigint;
  applied_minor bigint;
  change_given_minor bigint;
  payment_reference text;
  payment_note text;
  canonical_payload jsonb;
begin
  if target_items is null or jsonb_typeof(target_items) <> 'array'
    or jsonb_array_length(target_items) not between 1 and 100
    or target_payments is null or jsonb_typeof(target_payments) <> 'array'
    or jsonb_array_length(target_payments) <> 1 then
    raise exception 'Special catalogue checkout requires valid items and one internal payment.' using errcode = '23514';
  end if;
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'sales.create')) then
    raise exception 'Sales permission is required.' using errcode = '42501';
  end if;

  select
    employee.id,
    organization.name,
    store.name,
    register.name,
    coalesce(nullif(profile.full_name, ''), profile.email),
    organization.currency_code
  into
    actor_employee_id,
    organization_name_snapshot,
    store_name_snapshot,
    register_name_snapshot,
    cashier_name_snapshot,
    sale_currency_code
  from public.employees employee
  join public.employee_stores employee_store
    on employee_store.employee_id = employee.id
   and employee_store.organization_id = employee.organization_id
   and employee_store.store_id = target_store_id
  join public.organizations organization on organization.id = employee.organization_id
  join public.stores store
    on store.id = target_store_id
   and store.organization_id = employee.organization_id
   and store.is_active
  join public.registers register
    on register.id = target_register_id
   and register.store_id = store.id
   and register.organization_id = store.organization_id
   and register.is_active
  join public.profiles profile on profile.id = employee.profile_id
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select private.current_profile_id())
    and employee.status = 'active';

  if actor_employee_id is null then
    raise exception 'An active assigned employee and register are required.' using errcode = '42501';
  end if;

  canonical_payload := jsonb_build_object(
    'items', target_items,
    'payments', target_payments,
    'register_id', target_register_id,
    'store_id', target_store_id
  );
  insert into public.checkout_requests (
    organization_id, actor_employee_id, idempotency_key, request_payload
  ) values (
    target_organization_id, actor_employee_id, target_idempotency_key, canonical_payload
  ) on conflict (organization_id, idempotency_key) do nothing
  returning id into checkout_request_id;
  if checkout_request_id is null then
    raise exception 'The prior checkout request did not complete. Try again with a new checkout key.' using errcode = '40001';
  end if;

  insert into public.sales (
    organization_id, store_id, register_id, cashier_employee_id, currency_code,
    organization_name_snapshot, store_name_snapshot, register_name_snapshot, cashier_name_snapshot
  ) values (
    target_organization_id, target_store_id, target_register_id, actor_employee_id, sale_currency_code,
    organization_name_snapshot, store_name_snapshot, register_name_snapshot, cashier_name_snapshot
  ) returning id into new_sale_id;

  for checkout_line in
    select value
    from jsonb_array_elements(target_items)
  loop
    if jsonb_typeof(checkout_line.value) <> 'object'
      or jsonb_typeof(checkout_line.value -> 'product_id') <> 'string'
      or coalesce(checkout_line.value ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(checkout_line.value ->> 'quantity', '') !~ '^(?:0|[1-9][0-9]{0,3})([.][0-9]{1,3})?$' then
      raise exception 'Each checkout item must have valid item references and quantity.' using errcode = '23514';
    end if;
    quantity := (checkout_line.value ->> 'quantity')::numeric(14, 3);
    if quantity <= 0 then raise exception 'Each checkout item must have a quantity greater than zero.' using errcode = '23514'; end if;
    if quantity <= 0 then
      raise exception 'Each checkout item must have a quantity greater than zero.' using errcode = '23514';
    end if;
    product_name_snapshot := null;
    variant_name_snapshot := null;
    sku_snapshot := null;
    unit_snapshot := null;
    resolved_price_minor := null;
    tracks_inventory := null;

    if nullif(checkout_line.value ->> 'variant_id', '') is null then
      select
        product.name,
        null::text,
        product.sku,
        product.unit,
        coalesce(setting.price_override_minor, product.price_minor),
        product.track_inventory,
        product.allow_fractional_quantity,
        product.is_variable_price
      into
        product_name_snapshot,
        variant_name_snapshot,
        sku_snapshot,
        unit_snapshot,
        resolved_price_minor,
        tracks_inventory,
        product_allows_fractional,
        product_is_variable_price
      from public.products product
      join public.product_store_settings setting
        on setting.organization_id = product.organization_id
       and setting.product_id = product.id
       and setting.store_id = target_store_id
       and setting.is_available
      where product.id = (checkout_line.value ->> 'product_id')::uuid
        and product.organization_id = target_organization_id
        and product.status = 'active'
        and product.product_type = 'simple'
      for share of product;
    else
      if jsonb_typeof(checkout_line.value -> 'variant_id') <> 'string'
        or checkout_line.value ->> 'variant_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception 'Each checkout item must have valid item references and quantity.' using errcode = '23514';
      end if;
      select
        product.name,
        variant.name,
        variant.sku,
        product.unit,
        variant.price_minor,
        product.track_inventory,
        product.allow_fractional_quantity,
        false
      into
        product_name_snapshot,
        variant_name_snapshot,
        sku_snapshot,
        unit_snapshot,
        resolved_price_minor,
        tracks_inventory,
        product_allows_fractional,
        product_is_variable_price
      from public.products product
      join public.product_store_settings setting
        on setting.organization_id = product.organization_id
       and setting.product_id = product.id
       and setting.store_id = target_store_id
       and setting.is_available
      join public.product_variants variant
        on variant.id = (checkout_line.value ->> 'variant_id')::uuid
       and variant.product_id = product.id
       and variant.organization_id = product.organization_id
       and variant.is_active
      where product.id = (checkout_line.value ->> 'product_id')::uuid
        and product.organization_id = target_organization_id
        and product.status = 'active'
        and product.product_type = 'variable'
      for share of product, variant;
    end if;

    if resolved_price_minor is null then
      raise exception 'Every checkout item must be active and available at this store.' using errcode = '23514';
    end if;
    if quantity <> trunc(quantity) and not product_allows_fractional then
      raise exception 'This product must be sold in whole units.' using errcode = '23514';
    end if;
    if product_is_variable_price then
      if jsonb_typeof(checkout_line.value -> 'unit_price_minor') <> 'number'
        or coalesce(checkout_line.value ->> 'unit_price_minor', '') !~ '^[1-9][0-9]{0,9}$' then
        raise exception 'Enter a supported manual price for this product.' using errcode = '23514';
      end if;
      requested_price_minor := (checkout_line.value ->> 'unit_price_minor')::bigint;
      resolved_price_minor := requested_price_minor;
    elsif checkout_line.value ? 'unit_price_minor'
      and checkout_line.value -> 'unit_price_minor' <> 'null'::jsonb then
      raise exception 'Manual pricing is not enabled for this product.' using errcode = '23514';
    end if;

    line_total_minor := round(resolved_price_minor::numeric * quantity)::bigint;
    calculated_subtotal_minor := calculated_subtotal_minor + line_total_minor;

    insert into public.sale_items (
      organization_id, sale_id, product_id, variant_id, product_name_snapshot,
      variant_name_snapshot, sku_snapshot, unit_snapshot, quantity,
      unit_price_minor, modifier_total_minor, modifiers_snapshot, line_total_minor
    ) values (
      target_organization_id, new_sale_id, (checkout_line.value ->> 'product_id')::uuid,
      nullif(checkout_line.value ->> 'variant_id', '')::uuid, product_name_snapshot,
      variant_name_snapshot, sku_snapshot, unit_snapshot, quantity,
      resolved_price_minor, 0, '[]'::jsonb, line_total_minor
    );
  end loop;

  if calculated_subtotal_minor <= 0 then
    raise exception 'A checkout total must be greater than zero.' using errcode = '23514';
  end if;

  update public.sales
  set subtotal_minor = calculated_subtotal_minor,
      total_minor = calculated_subtotal_minor
  where id = new_sale_id and organization_id = target_organization_id;

  -- Lock and ledger tracked stock only after the sale has a stable source ID.
  for checkout_line in
    select item.id, item.product_id, item.variant_id, item.quantity
    from public.sale_items item
    where item.organization_id = target_organization_id and item.sale_id = new_sale_id
    order by item.product_id, item.variant_id nulls first
  loop
    select inventory_level.quantity into current_quantity
    from public.inventory_levels inventory_level
    where inventory_level.organization_id = target_organization_id
      and inventory_level.store_id = target_store_id
      and inventory_level.product_id = checkout_line.product_id
      and inventory_level.variant_id is not distinct from checkout_line.variant_id
    for update;

    if checkout_line.variant_id is null
      and private.is_made_to_order_composite(
        target_organization_id,
        checkout_line.product_id
      ) then
      perform private.consume_made_to_order_composite_sale(
        target_organization_id,
        target_store_id,
        checkout_line.product_id,
        checkout_line.quantity,
        actor_employee_id,
        new_sale_id,
        'Catalog checkout'
      );
    elsif exists (
      select 1
      from public.products product
      where product.id = checkout_line.product_id
        and product.organization_id = target_organization_id
        and product.track_inventory
    ) then
      if current_quantity is null then
        raise exception 'The stock projection is not initialized for one checkout item.' using errcode = '23514';
      end if;
      next_quantity := current_quantity - checkout_line.quantity;
      update public.inventory_levels inventory_level
      set quantity = next_quantity, updated_at = now()
      where inventory_level.organization_id = target_organization_id
        and inventory_level.store_id = target_store_id
        and inventory_level.product_id = checkout_line.product_id
        and inventory_level.variant_id is not distinct from checkout_line.variant_id;
      insert into public.inventory_movements (
        organization_id, store_id, product_id, variant_id, quantity_delta,
        quantity_before, quantity_after, movement_type, actor_employee_id, reason, source_type, source_id
      ) values (
        target_organization_id, target_store_id, checkout_line.product_id, checkout_line.variant_id,
        -checkout_line.quantity, current_quantity, next_quantity, 'SALE', actor_employee_id,
        'Catalog checkout', 'sale', new_sale_id
      );
    end if;
  end loop;

  payment_row := target_payments -> 0;
  if jsonb_typeof(payment_row -> 'payment_method_id') <> 'string'
    or coalesce(payment_row ->> 'payment_method_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'Each payment must include a valid payment method.' using errcode = '23514';
  end if;
  selected_payment_method_id := (payment_row ->> 'payment_method_id')::uuid;
  select method.name, method.code, method.payment_type, method.requires_reference
  into payment_name, payment_code, payment_type, payment_requires_reference
  from public.payment_methods method
  join public.store_payment_methods store_method
    on store_method.organization_id = method.organization_id
   and store_method.payment_method_id = method.id
   and store_method.store_id = target_store_id
   and store_method.is_enabled
  where method.id = selected_payment_method_id
    and method.organization_id = target_organization_id
    and method.is_enabled
    and not method.is_loyalty_redemption;
  if payment_name is null then
    raise exception 'That payment method is not enabled for this store.' using errcode = '23514';
  end if;
  payment_reference := nullif(btrim(payment_row ->> 'reference_number'), '');
  payment_note := nullif(btrim(payment_row ->> 'note'), '');
  if payment_requires_reference and payment_reference is null then
    raise exception 'A reference number is required for the selected payment method.' using errcode = '23514';
  end if;
  select settlement.applied_minor, settlement.tendered_minor, settlement.change_minor
  into applied_minor, tendered_minor, change_given_minor
  from private.settle_checkout_payment(
    payment_type,
    nullif(payment_row ->> 'amount_minor', '')::bigint,
    nullif(payment_row ->> 'amount_tendered_minor', '')::bigint,
    calculated_subtotal_minor
  ) settlement;
  if applied_minor <> calculated_subtotal_minor then
    raise exception 'The internal payment must exactly cover this sale.' using errcode = '23514';
  end if;
  insert into public.payments (
    organization_id, sale_id, payment_method_id, payment_method_name_snapshot,
    payment_method_code_snapshot, payment_method_type_snapshot, amount_minor,
    amount_tendered_minor, change_given_minor, reference_number, note
  ) values (
    target_organization_id, new_sale_id, selected_payment_method_id, payment_name, payment_code,
    payment_type, applied_minor, tendered_minor, change_given_minor, payment_reference, payment_note
  );

  new_receipt_number := nextval('private.tindio_receipt_number_sequence'::regclass);
  insert into public.receipts (organization_id, sale_id, receipt_number)
  values (target_organization_id, new_sale_id, new_receipt_number);
  update public.checkout_requests
  set state = 'completed', sale_id = new_sale_id, completed_at = now()
  where id = checkout_request_id;

  return query select
    new_sale_id,
    new_receipt_number,
    calculated_subtotal_minor,
    coalesce(change_given_minor, 0),
    jsonb_build_array(jsonb_build_object(
      'payment_method_id', selected_payment_method_id,
      'name', payment_name,
      'code', payment_code,
      'type', payment_type,
      'amount_minor', applied_minor,
      'amount_tendered_minor', tendered_minor,
      'change_given_minor', change_given_minor,
      'reference_number', payment_reference,
      'note', payment_note
    )),
    false;
end;
$_$;

CREATE OR REPLACE FUNCTION "private"."checkout_sale"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_idempotency_key" "uuid", "target_items" "jsonb", "target_payments" "jsonb") RETURNS TABLE("sale_id" "uuid", "receipt_number" bigint, "total_minor" bigint, "change_minor" bigint, "payment_summary" "jsonb", "was_replayed" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_employee_id uuid;
  existing_actor_employee_id uuid;
  existing_payload jsonb;
  existing_sale_id uuid;
  existing_payment_summary jsonb;
  canonical_payload jsonb;
begin
  if target_organization_id is null
    or target_store_id is null
    or target_register_id is null
    or target_idempotency_key is null then
    raise exception 'A store, register, and checkout key are required.'
      using errcode = '23514';
  end if;

  if (select private.current_profile_id()) is null
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
    on store.id = target_store_id
   and store.organization_id = employee.organization_id
   and store.is_active
  join public.registers register
    on register.id = target_register_id
   and register.store_id = store.id
   and register.organization_id = store.organization_id
   and register.is_active
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select private.current_profile_id())
    and employee.status = 'active';

  if actor_employee_id is null then
    raise exception 'An active assigned employee and register are required.'
      using errcode = '42501';
  end if;

  canonical_payload := jsonb_build_object(
    'items', target_items,
    'payments', target_payments,
    'register_id', target_register_id,
    'store_id', target_store_id
  );

  select
    request.actor_employee_id,
    request.request_payload,
    request.sale_id
  into
    existing_actor_employee_id,
    existing_payload,
    existing_sale_id
  from public.checkout_requests request
  where request.organization_id = target_organization_id
    and request.idempotency_key = target_idempotency_key
  for update;

  if found then
    if existing_actor_employee_id is distinct from actor_employee_id
      or existing_payload is distinct from canonical_payload then
      raise exception 'This checkout key was already used for a different request.'
        using errcode = '23505';
    end if;

    if existing_sale_id is null then
      raise exception 'The prior checkout request did not complete. Try again with a new checkout key.'
        using errcode = '40001';
    end if;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'payment_method_id', payment.payment_method_id,
          'name', payment.payment_method_name_snapshot,
          'code', payment.payment_method_code_snapshot,
          'type', payment.payment_method_type_snapshot,
          'amount_minor', payment.amount_minor,
          'amount_tendered_minor', payment.amount_tendered_minor,
          'change_given_minor', payment.change_given_minor,
          'reference_number', payment.reference_number,
          'note', payment.note
        ) order by payment.created_at, payment.id
      ),
      '[]'::jsonb
    )
    into existing_payment_summary
    from public.payments payment
    where payment.sale_id = existing_sale_id
      and payment.organization_id = target_organization_id;

    return query
    select
      completed_sale.id,
      receipt.receipt_number,
      completed_sale.total_minor,
      coalesce((
        select sum(payment.change_given_minor)
        from public.payments payment
        where payment.sale_id = completed_sale.id
          and payment.organization_id = completed_sale.organization_id
      ), 0)::bigint,
      existing_payment_summary,
      true
    from public.sales completed_sale
    join public.receipts receipt
      on receipt.sale_id = completed_sale.id
     and receipt.organization_id = completed_sale.organization_id
    where completed_sale.id = existing_sale_id
      and completed_sale.organization_id = target_organization_id;
    return;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(target_items, '[]'::jsonb)) item(value)
    where coalesce(item.value ->> 'quantity', '') like '%.%'
      or (item.value ? 'unit_price_minor' and item.value -> 'unit_price_minor' <> 'null'::jsonb)
  ) then
    return query
    select *
    from private.checkout_catalog_special_sale(
      target_organization_id,
      target_store_id,
      target_register_id,
      target_idempotency_key,
      target_items,
      target_payments
    );
    return;
  end if;

  return query
  select *
  from private.checkout_sale_v1(
    target_organization_id,
    target_store_id,
    target_register_id,
    target_idempotency_key,
    target_items,
    target_payments
  );
end;
$$;

CREATE OR REPLACE FUNCTION "private"."checkout_sale_v1"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_idempotency_key" "uuid", "target_items" "jsonb", "target_payments" "jsonb") RETURNS TABLE("sale_id" "uuid", "receipt_number" bigint, "total_minor" bigint, "change_minor" bigint, "payment_summary" "jsonb", "was_replayed" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  actor_employee_id uuid;
  organization_name_snapshot text;
  store_name_snapshot text;
  register_name_snapshot text;
  cashier_name_snapshot text;
  sale_currency_code text;
  checkout_request_id uuid;
  existing_actor_employee_id uuid;
  existing_payload jsonb;
  existing_sale_id uuid;
  existing_payment_summary jsonb;
  canonical_payload jsonb;
  checkout_line record;
  payment_input record;
  product_name_snapshot text;
  variant_name_snapshot text;
  sku_snapshot text;
  unit_snapshot text;
  resolved_price_minor bigint;
  tracks_inventory boolean;
  current_quantity numeric(14, 3);
  next_quantity numeric(14, 3);
  next_line_total_minor bigint;
  calculated_subtotal_minor bigint := 0;
  calculated_paid_minor bigint := 0;
  calculated_change_minor bigint := 0;
  remaining_minor bigint;
  requested_amount_minor bigint;
  tendered_minor bigint;
  applied_minor bigint;
  payment_change_minor bigint;
  selected_payment_method_id uuid;
  selected_payment_method_name text;
  selected_payment_method_code text;
  selected_payment_method_type text;
  selected_requires_reference boolean;
  selected_reference_number text;
  selected_note text;
  new_sale_id uuid;
  new_receipt_number bigint;
  new_payment_summary jsonb := '[]'::jsonb;
begin
  if target_organization_id is null
    or target_store_id is null
    or target_register_id is null
    or target_idempotency_key is null then
    raise exception 'A store, register, and checkout key are required.'
      using errcode = '23514';
  end if;

  if target_items is null or jsonb_typeof(target_items) <> 'array' then
    raise exception 'Checkout items must be an array.' using errcode = '23514';
  end if;

  if jsonb_array_length(target_items) not between 1 and 100 then
    raise exception 'A checkout must contain between 1 and 100 items.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(target_items) as item(item_value)
    where jsonb_typeof(item.item_value) <> 'object'
      or jsonb_typeof(item.item_value -> 'product_id') <> 'string'
      or coalesce(item.item_value ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (
        item.item_value ? 'variant_id'
        and item.item_value -> 'variant_id' <> 'null'::jsonb
        and (
          jsonb_typeof(item.item_value -> 'variant_id') <> 'string'
          or coalesce(item.item_value ->> 'variant_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        )
      )
      or coalesce(item.item_value ->> 'quantity', '') !~ '^[1-9][0-9]{0,3}$'
  ) then
    raise exception 'Each checkout item must have valid item references and quantity.'
      using errcode = '23514';
  end if;

  if target_payments is null or jsonb_typeof(target_payments) <> 'array' then
    raise exception 'Checkout payments must be an array.' using errcode = '23514';
  end if;

  if jsonb_array_length(target_payments) not between 1 and 10 then
    raise exception 'A checkout must contain between 1 and 10 payments.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(target_payments) as payment(payment_value)
    where jsonb_typeof(payment.payment_value) <> 'object'
      or jsonb_typeof(payment.payment_value -> 'payment_method_id') <> 'string'
      or coalesce(payment.payment_value ->> 'payment_method_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (
        payment.payment_value ? 'amount_minor'
        and (
          jsonb_typeof(payment.payment_value -> 'amount_minor') <> 'number'
          or coalesce(payment.payment_value ->> 'amount_minor', '') !~ '^[0-9]{1,13}$'
        )
      )
      or (
        payment.payment_value ? 'amount_tendered_minor'
        and (
          jsonb_typeof(payment.payment_value -> 'amount_tendered_minor') <> 'number'
          or coalesce(payment.payment_value ->> 'amount_tendered_minor', '') !~ '^[0-9]{1,13}$'
        )
      )
      or (
        payment.payment_value ? 'reference_number'
        and jsonb_typeof(payment.payment_value -> 'reference_number') not in ('string', 'null')
      )
      or (
        payment.payment_value ? 'note'
        and jsonb_typeof(payment.payment_value -> 'note') not in ('string', 'null')
      )
      or char_length(coalesce(payment.payment_value ->> 'reference_number', '')) > 120
      or char_length(coalesce(payment.payment_value ->> 'note', '')) > 500
  ) then
    raise exception 'Each payment must include a valid payment method and supported amounts.'
      using errcode = '23514';
  end if;

  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'sales.create')) then
    raise exception 'Sales permission is required.' using errcode = '42501';
  end if;

  select
    employee.id,
    organization.name,
    store.name,
    register.name,
    coalesce(nullif(profile.full_name, ''), profile.email),
    organization.currency_code
  into
    actor_employee_id,
    organization_name_snapshot,
    store_name_snapshot,
    register_name_snapshot,
    cashier_name_snapshot,
    sale_currency_code
  from public.employees employee
  join public.employee_stores employee_store
    on employee_store.employee_id = employee.id
   and employee_store.organization_id = employee.organization_id
   and employee_store.store_id = target_store_id
  join public.organizations organization
    on organization.id = employee.organization_id
  join public.stores store
    on store.id = target_store_id
   and store.organization_id = employee.organization_id
   and store.is_active
  join public.registers register
    on register.id = target_register_id
   and register.store_id = store.id
   and register.organization_id = store.organization_id
   and register.is_active
  join public.profiles profile
    on profile.id = employee.profile_id
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select private.current_profile_id())
    and employee.status = 'active';

  if actor_employee_id is null then
    raise exception 'An active assigned employee and register are required.'
      using errcode = '42501';
  end if;

  canonical_payload := jsonb_build_object(
    'items', target_items,
    'payments', target_payments,
    'register_id', target_register_id,
    'store_id', target_store_id
  );

  insert into public.checkout_requests (
    organization_id,
    actor_employee_id,
    idempotency_key,
    request_payload
  )
  values (
    target_organization_id,
    actor_employee_id,
    target_idempotency_key,
    canonical_payload
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning id into checkout_request_id;

  if checkout_request_id is null then
    select
      request.actor_employee_id,
      request.request_payload,
      request.sale_id
    into
      existing_actor_employee_id,
      existing_payload,
      existing_sale_id
    from public.checkout_requests request
    where request.organization_id = target_organization_id
      and request.idempotency_key = target_idempotency_key
    for update;

    if existing_actor_employee_id is distinct from actor_employee_id
      or existing_payload is distinct from canonical_payload then
      raise exception 'This checkout key was already used for a different request.'
        using errcode = '23505';
    end if;

    if existing_sale_id is null then
      raise exception 'The prior checkout request did not complete. Try again with a new checkout key.'
        using errcode = '40001';
    end if;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'payment_method_id', payment.payment_method_id,
          'name', payment.payment_method_name_snapshot,
          'code', payment.payment_method_code_snapshot,
          'type', payment.payment_method_type_snapshot,
          'amount_minor', payment.amount_minor,
          'amount_tendered_minor', payment.amount_tendered_minor,
          'change_given_minor', payment.change_given_minor,
          'reference_number', payment.reference_number,
          'note', payment.note
        ) order by payment.created_at, payment.id
      ),
      '[]'::jsonb
    )
    into existing_payment_summary
    from public.payments payment
    where payment.sale_id = existing_sale_id
      and payment.organization_id = target_organization_id;

    return query
    select
      completed_sale.id,
      receipt.receipt_number,
      completed_sale.total_minor,
      coalesce((
        select sum(payment.change_given_minor)
        from public.payments payment
        where payment.sale_id = completed_sale.id
          and payment.organization_id = completed_sale.organization_id
      ), 0)::bigint,
      existing_payment_summary,
      true
    from public.sales completed_sale
    join public.receipts receipt
      on receipt.sale_id = completed_sale.id
     and receipt.organization_id = completed_sale.organization_id
    where completed_sale.id = existing_sale_id
      and completed_sale.organization_id = target_organization_id;
    return;
  end if;

  if exists (
    with parsed_items as (
      select
        (item.item_value ->> 'product_id')::uuid as product_id,
        nullif(item.item_value ->> 'variant_id', '')::uuid as variant_id,
        (item.item_value ->> 'quantity')::integer as quantity
      from jsonb_array_elements(target_items) as item(item_value)
    )
    select 1
    from parsed_items
    group by product_id, variant_id
    having sum(quantity) > 10000
  ) then
    raise exception 'The quantity for one item cannot exceed 10,000.'
      using errcode = '23514';
  end if;

  insert into public.sales (
    organization_id,
    store_id,
    register_id,
    cashier_employee_id,
    currency_code,
    organization_name_snapshot,
    store_name_snapshot,
    register_name_snapshot,
    cashier_name_snapshot
  )
  values (
    target_organization_id,
    target_store_id,
    target_register_id,
    actor_employee_id,
    sale_currency_code,
    organization_name_snapshot,
    store_name_snapshot,
    register_name_snapshot,
    cashier_name_snapshot
  )
  returning id into new_sale_id;

  for checkout_line in
    with parsed_items as (
      select
        (item.item_value ->> 'product_id')::uuid as product_id,
        nullif(item.item_value ->> 'variant_id', '')::uuid as variant_id,
        (item.item_value ->> 'quantity')::integer as quantity
      from jsonb_array_elements(target_items) as item(item_value)
    )
    select product_id, variant_id, sum(quantity)::integer as quantity
    from parsed_items
    group by product_id, variant_id
    order by product_id, variant_id nulls first
  loop
    product_name_snapshot := null;
    variant_name_snapshot := null;
    sku_snapshot := null;
    unit_snapshot := null;
    resolved_price_minor := null;
    tracks_inventory := null;

    if checkout_line.variant_id is null then
      select
        product.name,
        null::text,
        product.sku,
        product.unit,
        product.price_minor,
        product.track_inventory
      into
        product_name_snapshot,
        variant_name_snapshot,
        sku_snapshot,
        unit_snapshot,
        resolved_price_minor,
        tracks_inventory
      from public.products product
      join public.product_store_settings setting
        on setting.organization_id = product.organization_id
       and setting.product_id = product.id
       and setting.store_id = target_store_id
       and setting.is_available
      where product.id = checkout_line.product_id
        and product.organization_id = target_organization_id
        and product.status = 'active'
        and product.product_type = 'simple'
      for share of product;
    else
      select
        product.name,
        variant.name,
        variant.sku,
        product.unit,
        variant.price_minor,
        product.track_inventory
      into
        product_name_snapshot,
        variant_name_snapshot,
        sku_snapshot,
        unit_snapshot,
        resolved_price_minor,
        tracks_inventory
      from public.products product
      join public.product_store_settings setting
        on setting.organization_id = product.organization_id
       and setting.product_id = product.id
       and setting.store_id = target_store_id
       and setting.is_available
      join public.product_variants variant
        on variant.id = checkout_line.variant_id
       and variant.product_id = product.id
       and variant.organization_id = product.organization_id
       and variant.is_active
      where product.id = checkout_line.product_id
        and product.organization_id = target_organization_id
        and product.status = 'active'
        and product.product_type = 'variable'
      for share of product, variant;
    end if;

    if resolved_price_minor is null then
      raise exception 'Every checkout item must be active and available at this store.'
        using errcode = '23514';
    end if;

    next_line_total_minor := resolved_price_minor * checkout_line.quantity;
    calculated_subtotal_minor := calculated_subtotal_minor + next_line_total_minor;

    insert into public.sale_items (
      organization_id,
      sale_id,
      product_id,
      variant_id,
      product_name_snapshot,
      variant_name_snapshot,
      sku_snapshot,
      unit_snapshot,
      quantity,
      unit_price_minor,
      line_total_minor
    )
    values (
      target_organization_id,
      new_sale_id,
      checkout_line.product_id,
      checkout_line.variant_id,
      product_name_snapshot,
      variant_name_snapshot,
      sku_snapshot,
      unit_snapshot,
      checkout_line.quantity,
      resolved_price_minor,
      next_line_total_minor
    );

    if tracks_inventory
      and checkout_line.variant_id is null
      and private.is_made_to_order_composite(
        target_organization_id,
        checkout_line.product_id
      ) then
      perform private.consume_made_to_order_composite_sale(
        target_organization_id,
        target_store_id,
        checkout_line.product_id,
        checkout_line.quantity,
        actor_employee_id,
        new_sale_id,
        'POS checkout'
      );
    elsif tracks_inventory then
      select inventory_level.quantity
      into current_quantity
      from public.inventory_levels inventory_level
      where inventory_level.organization_id = target_organization_id
        and inventory_level.store_id = target_store_id
        and inventory_level.product_id = checkout_line.product_id
        and inventory_level.variant_id is not distinct from checkout_line.variant_id
      for update;

      if not found then
        raise exception 'The stock projection is not initialized for one checkout item.'
          using errcode = '23514';
      end if;

      next_quantity := current_quantity - checkout_line.quantity;

      update public.inventory_levels inventory_level
      set
        quantity = next_quantity,
        updated_at = now()
      where inventory_level.organization_id = target_organization_id
        and inventory_level.store_id = target_store_id
        and inventory_level.product_id = checkout_line.product_id
        and inventory_level.variant_id is not distinct from checkout_line.variant_id;

      insert into public.inventory_movements (
        organization_id,
        store_id,
        product_id,
        variant_id,
        quantity_delta,
        quantity_before,
        quantity_after,
        movement_type,
        actor_employee_id,
        reason,
        source_type,
        source_id
      )
      values (
        target_organization_id,
        target_store_id,
        checkout_line.product_id,
        checkout_line.variant_id,
        -checkout_line.quantity,
        current_quantity,
        next_quantity,
        'SALE',
        actor_employee_id,
        'POS checkout',
        'sale',
        new_sale_id
      );
    end if;
  end loop;

  if calculated_subtotal_minor <= 0 then
    raise exception 'A checkout total must be greater than zero.' using errcode = '23514';
  end if;

  update public.sales sale
  set
    subtotal_minor = calculated_subtotal_minor,
    total_minor = calculated_subtotal_minor
  where sale.id = new_sale_id
    and sale.organization_id = target_organization_id;

  for payment_input in
    select payment_value, ordinality
    from jsonb_array_elements(target_payments) with ordinality as payment(payment_value, ordinality)
    order by ordinality
  loop
    remaining_minor := calculated_subtotal_minor - calculated_paid_minor;

    if remaining_minor <= 0 then
      raise exception 'No additional payment is needed for this sale.' using errcode = '23514';
    end if;

    selected_payment_method_id := (payment_input.payment_value ->> 'payment_method_id')::uuid;
    selected_payment_method_name := null;
    selected_payment_method_code := null;
    selected_payment_method_type := null;
    selected_requires_reference := null;

    select
      payment_method.name,
      payment_method.code,
      payment_method.payment_type,
      payment_method.requires_reference
    into
      selected_payment_method_name,
      selected_payment_method_code,
      selected_payment_method_type,
      selected_requires_reference
    from public.payment_methods payment_method
    join public.store_payment_methods store_method
      on store_method.organization_id = payment_method.organization_id
     and store_method.payment_method_id = payment_method.id
     and store_method.store_id = target_store_id
     and store_method.is_enabled
    where payment_method.id = selected_payment_method_id
      and payment_method.organization_id = target_organization_id
      and payment_method.is_enabled
    for key share;

    if selected_payment_method_name is null then
      raise exception 'That payment method is not enabled for this store.'
        using errcode = '23514';
    end if;

    selected_reference_number := nullif(btrim(payment_input.payment_value ->> 'reference_number'), '');
    selected_note := nullif(btrim(payment_input.payment_value ->> 'note'), '');

    if selected_requires_reference and selected_reference_number is null then
      raise exception 'A reference number is required for the selected payment method.'
        using errcode = '23514';
    end if;

    select settlement.applied_minor, settlement.tendered_minor, settlement.change_minor
    into applied_minor, tendered_minor, payment_change_minor
    from private.settle_checkout_payment(
      selected_payment_method_type,
      nullif(payment_input.payment_value ->> 'amount_minor', '')::bigint,
      nullif(payment_input.payment_value ->> 'amount_tendered_minor', '')::bigint,
      remaining_minor
    ) settlement;

    insert into public.payments (
      organization_id,
      sale_id,
      payment_method_id,
      payment_method_name_snapshot,
      payment_method_code_snapshot,
      payment_method_type_snapshot,
      amount_minor,
      amount_tendered_minor,
      change_given_minor,
      reference_number,
      note
    )
    values (
      target_organization_id,
      new_sale_id,
      selected_payment_method_id,
      selected_payment_method_name,
      selected_payment_method_code,
      selected_payment_method_type,
      applied_minor,
      tendered_minor,
      payment_change_minor,
      selected_reference_number,
      selected_note
    );

    calculated_paid_minor := calculated_paid_minor + applied_minor;
    calculated_change_minor := calculated_change_minor + coalesce(payment_change_minor, 0);
    new_payment_summary := new_payment_summary || jsonb_build_array(
      jsonb_build_object(
        'payment_method_id', selected_payment_method_id,
        'name', selected_payment_method_name,
        'code', selected_payment_method_code,
        'type', selected_payment_method_type,
        'amount_minor', applied_minor,
        'amount_tendered_minor', tendered_minor,
        'change_given_minor', payment_change_minor,
        'reference_number', selected_reference_number,
        'note', selected_note
      )
    );
  end loop;

  if calculated_paid_minor <> calculated_subtotal_minor then
    raise exception 'Payments must exactly cover the sale total before completion.'
      using errcode = '23514';
  end if;

  new_receipt_number := nextval('private.tindio_receipt_number_sequence'::regclass);

  insert into public.receipts (
    organization_id,
    sale_id,
    receipt_number
  )
  values (
    target_organization_id,
    new_sale_id,
    new_receipt_number
  );

  update public.checkout_requests request
  set
    state = 'completed',
    sale_id = new_sale_id,
    completed_at = now()
  where request.id = checkout_request_id;

  return query
  select
    new_sale_id,
    new_receipt_number,
    calculated_subtotal_minor,
    calculated_change_minor,
    new_payment_summary,
    false;
end;
$_$;

CREATE OR REPLACE FUNCTION "private"."claim_product_unit_operation"("target_organization_id" "uuid", "target_operation_id" "uuid", "target_command" "text", "target_payload" "jsonb", "target_result_unit_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  existing private.product_unit_operations%rowtype;
begin
  if target_operation_id is null then
    raise exception 'A stable product-unit operation ID is required.' using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_organization_id::text || ':product-unit-operation:' || target_operation_id::text, 0)
  );

  select operation.* into existing
  from private.product_unit_operations operation
  where operation.organization_id = target_organization_id
    and operation.operation_id = target_operation_id;

  if found then
    if existing.command <> target_command or existing.normalized_payload <> target_payload then
      raise exception 'This operation ID is already assigned to a different product-unit command.' using errcode = '23505';
    end if;
    return existing.result_unit_id;
  end if;

  insert into private.product_unit_operations (
    organization_id, operation_id, command, normalized_payload, result_unit_id, actor_profile_id
  ) values (
    target_organization_id, target_operation_id, target_command, target_payload,
    target_result_unit_id, (select private.current_profile_id())
  );
  return null;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."close_register_shift"("target_organization_id" "uuid", "target_shift_id" "uuid", "target_counted_cash_minor" bigint, "target_closing_note" "text") RETURNS TABLE("shift_id" "uuid", "expected_cash_minor" bigint, "counted_cash_minor" bigint, "difference_minor" bigint, "closed_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_employee_id uuid;
  target_shift public.shifts%rowtype;
  calculated_cash record;
  normalized_closing_note text;
begin
  if target_organization_id is null
    or target_shift_id is null
    or target_counted_cash_minor is null
    or target_counted_cash_minor < 0 then
    raise exception 'A shift and non-negative counted cash amount are required.'
      using errcode = '23514';
  end if;

  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'shifts.close')) then
    raise exception 'Shift closing permission is required.' using errcode = '42501';
  end if;

  normalized_closing_note := nullif(trim(coalesce(target_closing_note, '')), '');
  if normalized_closing_note is not null
    and char_length(normalized_closing_note) not between 2 and 500 then
    raise exception 'A closing note must contain between 2 and 500 characters.'
      using errcode = '23514';
  end if;

  select shift.*
  into target_shift
  from public.shifts shift
  where shift.id = target_shift_id
    and shift.organization_id = target_organization_id
    and shift.status = 'open'
  for update;

  if target_shift.id is null then
    raise exception 'The open shift was not found.' using errcode = 'P0002';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  join public.employee_stores employee_store
    on employee_store.employee_id = employee.id
   and employee_store.organization_id = employee.organization_id
   and employee_store.store_id = target_shift.store_id
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select private.current_profile_id())
    and employee.status = 'active';

  if actor_employee_id is null then
    raise exception 'An active employee assignment for this shift store is required.'
      using errcode = '42501';
  end if;

  if target_shift.opened_by_employee_id is distinct from actor_employee_id then
    raise exception 'Only the employee who opened this shift can close it.'
      using errcode = '42501';
  end if;

  select *
  into calculated_cash
  from private.calculate_shift_cash(target_shift.id);

  return query
  update public.shifts shift
  set
    status = 'closed',
    closed_by_employee_id = actor_employee_id,
    expected_cash_minor = calculated_cash.expected_cash_minor,
    counted_cash_minor = target_counted_cash_minor,
    difference_minor = target_counted_cash_minor - calculated_cash.expected_cash_minor,
    closing_note = normalized_closing_note,
    closed_at = now()
  where shift.id = target_shift.id
    and shift.organization_id = target_organization_id
  returning
    shift.id,
    shift.expected_cash_minor,
    shift.counted_cash_minor,
    shift.difference_minor,
    shift.closed_at;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."complete_inventory_count"("target_organization_id" "uuid", "target_store_id" "uuid", "target_note" "text", "target_lines" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare actor_id uuid; count_id uuid; line jsonb; expected numeric(14,3); counted numeric(14,3); target_line_product_id uuid; target_line_variant_id uuid;
begin
 if (select private.current_profile_id()) is null or not (select private.has_permission(target_organization_id,'inventory.manage')) then raise exception 'Inventory permission is required.' using errcode='42501'; end if;
 if target_lines is null or jsonb_typeof(target_lines) <> 'array' or jsonb_array_length(target_lines) not between 1 and 500 then raise exception 'A count needs one to 500 items.' using errcode='23514'; end if;
 perform private.inventory_count_actor(target_organization_id, target_store_id, array['inventory.count.create', 'inventory.count.finalize']::text[]);
  actor_id := private.inventory_actor(target_organization_id, target_store_id); if actor_id is null then raise exception 'An assigned employee is required for this store.' using errcode='42501'; end if;
 insert into public.inventory_counts (organization_id,store_id,status,note,started_by_employee_id,completed_by_employee_id,completed_at) values (target_organization_id,target_store_id,'completed',nullif(btrim(target_note),''),actor_id,actor_id,now()) returning id into count_id;
 for line in select value from jsonb_array_elements(target_lines) loop
  if coalesce(line->>'counted_quantity','') !~ '^\d+(\.\d{1,3})?$' then raise exception 'Counted quantities must be non-negative.' using errcode='23514'; end if;
  target_line_product_id:=(line->>'product_id')::uuid; target_line_variant_id:=nullif(line->>'variant_id','')::uuid; counted:=(line->>'counted_quantity')::numeric;
  select level.quantity into expected from public.inventory_levels level where level.organization_id=target_organization_id and level.store_id=target_store_id and level.product_id=target_line_product_id and level.variant_id is not distinct from target_line_variant_id for update; if not found then raise exception 'One count item has no stock projection.' using errcode='23514'; end if;
  insert into public.inventory_count_lines (organization_id,inventory_count_id,product_id,variant_id,expected_quantity,counted_quantity) values (target_organization_id,count_id,target_line_product_id,target_line_variant_id,expected,counted);
  if counted <> expected then perform private.apply_inventory_change(target_organization_id,target_store_id,target_line_product_id,target_line_variant_id,counted-expected,'COUNT',actor_id,'Inventory count','inventory_count',count_id); end if;
 end loop; return count_id; end; $_$;

CREATE OR REPLACE FUNCTION "private"."create_catalog_product"("target_organization_id" "uuid", "target_category_id" "uuid", "target_name" "text", "target_description" "text", "target_product_type" "text", "target_sku" "text", "target_barcode" "text", "target_price_minor" bigint, "target_cost_minor" bigint, "target_track_inventory" boolean, "target_unit" "text", "target_store_ids" "uuid"[], "target_variants" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  new_product_id uuid;
  requested_store_count integer;
  valid_store_count integer;
  variant_count integer;
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'products.manage')) then
    raise exception 'Product management permission is required.' using errcode = '42501';
  end if;

  if target_category_id is not null and not exists (
    select 1
    from public.categories category
    where category.id = target_category_id
      and category.organization_id = target_organization_id
      and not category.is_archived
  ) then
    raise exception 'Select an active category in this organization.' using errcode = '23503';
  end if;

  if target_store_ids is null or cardinality(target_store_ids) = 0 then
    raise exception 'Select at least one active store.' using errcode = '23514';
  end if;

  select count(distinct requested_store_id)
  into requested_store_count
  from unnest(target_store_ids) as requested_store_id;

  select count(*)
  into valid_store_count
  from public.stores store
  where store.organization_id = target_organization_id
    and store.id = any(target_store_ids)
    and store.is_active;

  if requested_store_count <> valid_store_count then
    raise exception 'Every selected store must be active and belong to this organization.'
      using errcode = '23503';
  end if;

  if jsonb_typeof(coalesce(target_variants, '[]'::jsonb)) <> 'array' then
    raise exception 'Variants must be supplied as a JSON array.' using errcode = '22023';
  end if;

  variant_count := jsonb_array_length(coalesce(target_variants, '[]'::jsonb));

  if target_product_type = 'simple' and variant_count <> 0 then
    raise exception 'Simple products cannot contain variants.' using errcode = '23514';
  end if;

  if target_product_type = 'variable' and variant_count not between 1 and 100 then
    raise exception 'Variable products require between 1 and 100 variants.'
      using errcode = '23514';
  end if;

  if (
    coalesce(target_cost_minor, 0) <> 0
    or exists (
      select 1
      from jsonb_array_elements(coalesce(target_variants, '[]'::jsonb)) variant
      where coalesce((variant ->> 'cost_minor')::bigint, 0) <> 0
    )
  ) and not (select private.has_permission(
    target_organization_id,
    'products.view_cost'
  )) then
    raise exception 'Product cost permission is required.' using errcode = '42501';
  end if;

  insert into public.products (
    organization_id,
    category_id,
    name,
    description,
    product_type,
    sku,
    barcode,
    price_minor,
    cost_minor,
    track_inventory,
    unit
  )
  values (
    target_organization_id,
    target_category_id,
    trim(target_name),
    nullif(trim(target_description), ''),
    target_product_type,
    nullif(upper(trim(target_sku)), ''),
    nullif(trim(target_barcode), ''),
    target_price_minor,
    target_cost_minor,
    target_track_inventory,
    lower(trim(target_unit))
  )
  returning id into new_product_id;

  if target_product_type = 'variable' then
    insert into public.product_variants (
      organization_id,
      product_id,
      name,
      option_values,
      sku,
      barcode,
      price_minor,
      cost_minor,
      sort_order
    )
    select
      target_organization_id,
      new_product_id,
      trim(variant.name),
      coalesce(variant.option_values, '{}'::jsonb),
      nullif(upper(trim(variant.sku)), ''),
      nullif(trim(variant.barcode), ''),
      variant.price_minor,
      variant.cost_minor,
      variant.sort_order
    from jsonb_to_recordset(target_variants) as variant(
      name text,
      option_values jsonb,
      sku text,
      barcode text,
      price_minor bigint,
      cost_minor bigint,
      sort_order integer
    );
  end if;

  insert into public.product_store_settings (
    organization_id,
    store_id,
    product_id,
    is_available
  )
  select
    target_organization_id,
    selected_store_id,
    new_product_id,
    true
  from (
    select distinct unnest(target_store_ids) as selected_store_id
  ) selected_stores;

  return new_product_id;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."create_direct_stock_transfer"("target_organization_id" "uuid", "target_source_store_id" "uuid", "target_destination_store_id" "uuid", "target_lines" "jsonb", "target_note" "text", "target_operation_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_id uuid;
  destination_actor_id uuid;
  existing_transfer public.stock_transfers%rowtype;
  normalized_lines jsonb;
  normalized_note text;
  persisted_lines jsonb;
  transfer_id uuid;
begin
  if (select private.current_profile_id()) is null
     or not (select private.has_inventory_capability(target_organization_id, 'inventory.transfer.create'))
     or not (select private.has_inventory_capability(target_organization_id, 'inventory.transfer.send')) then
    raise exception 'Transfer create and send permissions are required.' using errcode = '42501';
  end if;
  if target_operation_id is null then
    raise exception 'A stable transfer operation ID is required.' using errcode = '23514';
  end if;
  if target_source_store_id is null
     or target_destination_store_id is null
     or target_source_store_id = target_destination_store_id
     or (target_note is not null and char_length(btrim(target_note)) > 500) then
    raise exception 'Choose two different stores and a valid note.' using errcode = '23514';
  end if;

  actor_id := private.inventory_actor(target_organization_id, target_source_store_id);
  destination_actor_id := private.inventory_actor(target_organization_id, target_destination_store_id);
  if actor_id is null or destination_actor_id is null then
    raise exception 'An active employee with access to both stores is required for this transfer.' using errcode = '42501';
  end if;
  normalized_note := nullif(btrim(target_note), '');
  normalized_lines := private.normalize_inventory_transfer_lines(target_lines);

  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text || ':' || target_operation_id::text, 0));
  select * into existing_transfer
  from public.stock_transfers transfer
  where transfer.organization_id = target_organization_id
    and transfer.operation_id = target_operation_id
  for update;
  if found then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'product_id', existing_line.product_id,
          'variant_id', existing_line.variant_id,
          'quantity', existing_line.quantity::text
        ) order by existing_line.product_id, existing_line.variant_id
      ),
      '[]'::jsonb
    ) into persisted_lines
    from public.stock_transfer_lines existing_line
    where existing_line.organization_id = target_organization_id
      and existing_line.stock_transfer_id = existing_transfer.id;

    if existing_transfer.stock_request_id is null
       and existing_transfer.source_store_id = target_source_store_id
       and existing_transfer.destination_store_id = target_destination_store_id
       and existing_transfer.transferred_by_employee_id = actor_id
       and existing_transfer.note is not distinct from normalized_note
       and persisted_lines = normalized_lines then
      return existing_transfer.id;
    end if;
    raise exception 'This operation ID is already assigned to a different transfer.' using errcode = '23505';
  end if;

  transfer_id := private.create_inventory_transfer_draft(
    target_organization_id,
    target_source_store_id,
    target_destination_store_id,
    normalized_lines,
    normalized_note,
    target_operation_id
  );
  perform private.submit_inventory_transfer(
    target_organization_id,
    transfer_id,
    null,
    private.inventory_transfer_child_operation_id(target_operation_id, 'submit')
  );
  perform private.approve_inventory_transfer(
    target_organization_id,
    transfer_id,
    null,
    private.inventory_transfer_child_operation_id(target_operation_id, 'approve')
  );
  perform private.dispatch_inventory_transfer(
    target_organization_id,
    transfer_id,
    null,
    private.inventory_transfer_child_operation_id(target_operation_id, 'dispatch')
  );
  return transfer_id;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."create_inventory_adjustment_reason"("target_organization_id" "uuid", "target_code" "text", "target_name" "text", "target_movement_type" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare reason_id uuid;
begin
  if (select private.current_profile_id()) is null or not (select private.has_permission(target_organization_id, 'inventory.manage')) then raise exception 'Inventory permission is required.' using errcode = '42501'; end if;
  insert into public.inventory_adjustment_reasons (organization_id, code, name, movement_type)
  values (target_organization_id, upper(btrim(target_code)), btrim(target_name), target_movement_type)
  returning id into reason_id;
  return reason_id;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."create_inventory_transfer_draft"("target_organization_id" "uuid", "target_source_store_id" "uuid", "target_destination_store_id" "uuid", "target_lines" "jsonb", "target_note" "text", "target_operation_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_id uuid;
  existing_operation private.stock_transfer_operations%rowtype;
  line jsonb;
  normalized_lines jsonb;
  normalized_note text;
  operation_payload jsonb;
  product_row record;
  transfer_id uuid;
  transfer_number bigint;
begin
  if (select private.current_profile_id()) is null
     or not (select private.has_inventory_capability(target_organization_id, 'inventory.transfer.create')) then
    raise exception 'Transfer creation permission is required.' using errcode = '42501';
  end if;

  actor_id := private.inventory_actor(target_organization_id, target_source_store_id);
  if actor_id is null then
    raise exception 'An active employee assigned to the source store is required.' using errcode = '42501';
  end if;

  if target_operation_id is null then
    raise exception 'A stable transfer operation ID is required.' using errcode = '23514';
  end if;
  if target_source_store_id is null
     or target_destination_store_id is null
     or target_source_store_id = target_destination_store_id
     or (target_note is not null and char_length(btrim(target_note)) > 500) then
    raise exception 'Choose two different stores and a valid note.' using errcode = '23514';
  end if;

  normalized_note := nullif(btrim(target_note), '');
  normalized_lines := private.normalize_inventory_transfer_lines(target_lines);
  operation_payload := jsonb_build_object(
    'source_store_id', target_source_store_id,
    'destination_store_id', target_destination_store_id,
    'note', normalized_note,
    'lines', normalized_lines
  );

  perform pg_advisory_xact_lock(hashtextextended(
    target_organization_id::text || ':' || target_operation_id::text,
    0
  ));

  select *
  into existing_operation
  from private.stock_transfer_operations operation
  where operation.organization_id = target_organization_id
    and operation.operation_id = target_operation_id
  for update;

  if found then
    if existing_operation.command = 'create'
       and existing_operation.normalized_payload = operation_payload then
      return existing_operation.result_id;
    end if;
    raise exception 'This operation ID is already assigned to a different transfer command.' using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.stock_transfers transfer
    where transfer.organization_id = target_organization_id
      and transfer.operation_id = target_operation_id
  ) then
    raise exception 'This operation ID is already assigned to a historical transfer.' using errcode = '23505';
  end if;

  if not exists (
    select 1 from public.stores store
    where store.organization_id = target_organization_id
      and store.id = target_source_store_id
      and store.is_active
  ) or not exists (
    select 1 from public.stores store
    where store.organization_id = target_organization_id
      and store.id = target_destination_store_id
      and store.is_active
  ) then
    raise exception 'Choose active source and destination stores in this organization.' using errcode = '23514';
  end if;

  transfer_number := nextval('private.tindio_stock_transfer_number_sequence'::regclass);
  insert into public.stock_transfers (
    organization_id,
    transfer_number,
    operation_id,
    source_store_id,
    destination_store_id,
    stock_request_id,
    status,
    note,
    transferred_by_employee_id
  ) values (
    target_organization_id,
    transfer_number,
    target_operation_id,
    target_source_store_id,
    target_destination_store_id,
    null,
    'draft',
    normalized_note,
    actor_id
  ) returning id into transfer_id;

  for line in
    select value
    from jsonb_array_elements(normalized_lines)
    order by value ->> 'product_id', value ->> 'variant_id'
  loop
    select product.id, variant.id as variant_id
    into product_row
    from public.products product
    left join public.product_variants variant
      on variant.id = nullif(line ->> 'variant_id', '')::uuid
     and variant.product_id = product.id
     and variant.organization_id = product.organization_id
     and variant.is_active
    where product.id = (line ->> 'product_id')::uuid
      and product.organization_id = target_organization_id
      and product.status = 'active'
      and product.track_inventory
      and (nullif(line ->> 'variant_id', '') is null or variant.id is not null);

    if product_row.id is null then
      raise exception 'Every transfer item must be an active tracked product in this organization.' using errcode = '23514';
    end if;

    if not exists (
      select 1
      from public.product_store_settings setting
      where setting.organization_id = target_organization_id
        and setting.product_id = product_row.id
        and setting.store_id in (target_source_store_id, target_destination_store_id)
        and setting.is_available
      group by setting.product_id
      having count(*) = 2
    ) then
      raise exception 'Each transfer item must be available in both stores.' using errcode = '23514';
    end if;

    if (
      select count(*)
      from public.inventory_levels level
      where level.organization_id = target_organization_id
        and level.store_id in (target_source_store_id, target_destination_store_id)
        and level.product_id = product_row.id
        and level.variant_id is not distinct from nullif(line ->> 'variant_id', '')::uuid
    ) <> 2 then
      raise exception 'Both store stock projections must exist before drafting a transfer.' using errcode = '23514';
    end if;

    insert into public.stock_transfer_lines (
      organization_id,
      stock_transfer_id,
      stock_request_line_id,
      product_id,
      variant_id,
      quantity,
      unit_cost_minor,
      unit_cost_is_known
    ) values (
      target_organization_id,
      transfer_id,
      null,
      product_row.id,
      nullif(line ->> 'variant_id', '')::uuid,
      (line ->> 'quantity')::numeric(14,3),
      0,
      false
    );
  end loop;

  insert into private.stock_transfer_operations (
    organization_id, stock_transfer_id, operation_id, command,
    normalized_payload, from_status, to_status, actor_employee_id,
    result_id, note
  ) values (
    target_organization_id, transfer_id, target_operation_id, 'create',
    operation_payload, null, 'draft', actor_id, transfer_id, normalized_note
  );

  perform private.write_audit_log(
    target_organization_id,
    'STOCK_TRANSFER_DRAFT_CREATED',
    'inventory.transfer.create',
    actor_id,
    null,
    target_source_store_id,
    null,
    null,
    null,
    normalized_note,
    jsonb_build_object(
      'stock_transfer_id', transfer_id,
      'transfer_number', transfer_number,
      'source_store_id', target_source_store_id,
      'destination_store_id', target_destination_store_id,
      'operation_id', target_operation_id,
      'lines', normalized_lines
    )
  );

  return transfer_id;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."create_purchase_order"("target_organization_id" "uuid", "target_store_id" "uuid", "target_supplier_id" "uuid", "target_notes" "text", "target_expected_at" "date", "target_lines" "jsonb", "target_operation_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  actor_id uuid;
  order_id uuid;
  existing_order public.purchase_orders%rowtype;
  line jsonb;
  product_row record;
  purchase_unit_row record;
  next_number bigint;
  normalized_note text;
  requested_lines jsonb;
  persisted_lines jsonb;
begin
  if (select private.current_profile_id()) is null
     or (not (select private.has_permission(target_organization_id, 'inventory.manage')) and not (select private.has_inventory_capability(target_organization_id, 'purchasing.po.create'))) then
    raise exception 'Inventory permission is required.' using errcode = '42501';
  end if;

  if target_operation_id is null then
    raise exception 'A stable purchase-order operation ID is required.' using errcode = '23514';
  end if;

  if target_lines is null
     or jsonb_typeof(target_lines) <> 'array'
     or jsonb_array_length(target_lines) not between 1 and 100 then
    raise exception 'A purchase order needs one to 100 items.' using errcode = '23514';
  end if;

  for line in select value from jsonb_array_elements(target_lines)
  loop
    if coalesce(line ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or (nullif(line ->> 'variant_id', '') is not null and coalesce(line ->> 'variant_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
       or coalesce(line ->> 'purchase_unit_code', '') !~ '^[A-Za-z0-9][A-Za-z0-9 _-]{0,23}$'
       or coalesce(line ->> 'quantity', '') !~ '^\d+(\.\d{1,3})?$'
       or (line ->> 'quantity')::numeric <= 0
       or coalesce(line ->> 'unit_cost_minor', '') !~ '^\d+$' then
      raise exception 'Purchase order items, units, quantities, and costs must be valid.' using errcode = '23514';
    end if;
  end loop;

  if exists (
    select 1
    from (
      select lower(btrim(value ->> 'product_id')) as product_id,
             coalesce(nullif(lower(btrim(value ->> 'variant_id')), ''), '') as variant_id,
             count(*) as line_count
      from jsonb_array_elements(target_lines)
      group by 1, 2
    ) duplicate_line
    where duplicate_line.line_count > 1
  ) then
    raise exception 'Each item can appear only once in a purchase order.' using errcode = '23514';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'product_id', normalized.product_id,
        'variant_id', normalized.variant_id,
        'purchase_unit_code', normalized.purchase_unit_code,
        'quantity', normalized.quantity,
        'unit_cost_minor', normalized.unit_cost_minor
      ) order by normalized.product_id, normalized.variant_id
    ),
    '[]'::jsonb
  )
  into requested_lines
  from (
    select lower(btrim(value ->> 'product_id')) as product_id,
           coalesce(nullif(lower(btrim(value ->> 'variant_id')), ''), '') as variant_id,
           lower(btrim(value ->> 'purchase_unit_code')) as purchase_unit_code,
           ((value ->> 'quantity')::numeric(14,3))::text as quantity,
           ((value ->> 'unit_cost_minor')::bigint)::text as unit_cost_minor
    from jsonb_array_elements(target_lines)
  ) normalized;

  normalized_note := nullif(btrim(target_notes), '');
  actor_id := private.inventory_actor(target_organization_id, target_store_id);
  if actor_id is null then
    raise exception 'An assigned employee is required for this store.' using errcode = '42501';
  end if;

  select * into existing_order
  from public.purchase_orders purchase_order
  where purchase_order.organization_id = target_organization_id
    and purchase_order.operation_id = target_operation_id
  for update;

  if found then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'product_id', purchase_line.product_id::text,
          'variant_id', coalesce(purchase_line.variant_id::text, ''),
          'purchase_unit_code', purchase_line.purchase_unit_code_snapshot,
          'quantity', purchase_line.ordered_quantity::text,
          'unit_cost_minor', purchase_line.unit_cost_minor::text
        ) order by purchase_line.product_id::text, coalesce(purchase_line.variant_id::text, '')
      ),
      '[]'::jsonb
    ) into persisted_lines
    from public.purchase_order_lines purchase_line
    where purchase_line.organization_id = target_organization_id
      and purchase_line.purchase_order_id = existing_order.id;

    if existing_order.store_id = target_store_id
       and existing_order.supplier_id = target_supplier_id
       and existing_order.created_by_employee_id = actor_id
       and existing_order.requested_expected_at is not distinct from target_expected_at
       and existing_order.notes is not distinct from normalized_note
       and persisted_lines = requested_lines then
      return existing_order.id;
    end if;

    raise exception 'This operation ID is already assigned to a different purchase order request.' using errcode = '23505';
  end if;

  if not exists (
    select 1
    from public.suppliers supplier
    where supplier.id = target_supplier_id
      and supplier.organization_id = target_organization_id
      and supplier.is_active
  ) then
    raise exception 'Choose an active supplier.' using errcode = '23514';
  end if;

  next_number := nextval('private.tindio_purchase_order_number_sequence'::regclass);
  insert into public.purchase_orders (
    organization_id, store_id, supplier_id, order_number, status, notes,
    expected_at, requested_expected_at, ordered_at, created_by_employee_id, operation_id
  ) values (
    target_organization_id, target_store_id, target_supplier_id, next_number,
    'ordered', normalized_note, target_expected_at, target_expected_at, now(), actor_id, target_operation_id
  ) returning id into order_id;

  for line in select value from jsonb_array_elements(target_lines)
  loop
    select product.name as product_name, variant.name as variant_name
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
      and (nullif(line ->> 'variant_id', '') is null or variant.id is not null)
      and exists (
        select 1 from public.product_store_settings store_setting
        where store_setting.organization_id = target_organization_id
          and store_setting.store_id = target_store_id
          and store_setting.product_id = product.id
          and store_setting.is_available
      );

    if not found then
      raise exception 'Every order item must be an active tracked item available in the receiving store.' using errcode = '23514';
    end if;

    select product_unit.unit_code, product_unit.unit_name, product_unit.factor_to_base
    into purchase_unit_row
    from public.product_units product_unit
    where product_unit.organization_id = target_organization_id
      and product_unit.product_id = (line ->> 'product_id')::uuid
      and product_unit.unit_code = lower(btrim(line ->> 'purchase_unit_code'))
      and (product_unit.is_purchase_unit or product_unit.is_base);

    if not found then
      raise exception 'Choose a configured purchase unit for every order item.' using errcode = '23514';
    end if;

    insert into public.purchase_order_lines (
      organization_id, purchase_order_id, product_id, variant_id,
      product_name_snapshot, variant_name_snapshot, unit_snapshot,
      purchase_unit_code_snapshot, purchase_unit_factor_to_base,
      ordered_quantity, unit_cost_minor
    ) values (
      target_organization_id, order_id, (line ->> 'product_id')::uuid,
      nullif(line ->> 'variant_id', '')::uuid, product_row.product_name,
      product_row.variant_name, purchase_unit_row.unit_name,
      purchase_unit_row.unit_code, purchase_unit_row.factor_to_base,
      (line ->> 'quantity')::numeric(14,3), (line ->> 'unit_cost_minor')::bigint
    );
  end loop;

  return order_id;
end;
$_$;

CREATE OR REPLACE FUNCTION "private"."create_stock_request"("target_organization_id" "uuid", "target_requesting_store_id" "uuid", "target_source_warehouse_id" "uuid", "target_note" "text", "target_lines" "jsonb", "target_operation_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
  if (select private.current_profile_id()) is null
     or (
       not (select private.has_permission(target_organization_id, 'inventory.manage'))
       and not (select private.has_inventory_capability(target_organization_id, 'inventory.transfer.create'))
     ) then
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
$_$;

CREATE OR REPLACE FUNCTION "private"."create_supplier"("target_organization_id" "uuid", "target_name" "text", "target_contact_name" "text", "target_email" "text", "target_phone" "text", "target_address" "text", "target_notes" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$ declare supplier_id uuid; begin
 if (select private.current_profile_id()) is null or (not (select private.has_permission(target_organization_id, 'inventory.manage')) and not (select private.has_inventory_capability(target_organization_id, 'purchasing.suppliers.manage'))) then raise exception 'Inventory permission is required.' using errcode='42501'; end if;
 insert into public.suppliers (organization_id,name,contact_name,email,phone,address,notes) values (target_organization_id,nullif(btrim(target_name),''),nullif(btrim(target_contact_name),''),nullif(btrim(target_email),''),nullif(btrim(target_phone),''),nullif(btrim(target_address),''),nullif(btrim(target_notes),'')) returning id into supplier_id; return supplier_id; end; $$;

CREATE OR REPLACE FUNCTION "private"."create_supply_chain_warehouse"("target_organization_id" "uuid", "target_store_id" "uuid", "target_code" "text", "target_name" "text", "target_notes" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare actor_id uuid; warehouse_id uuid;
begin
  if (select private.current_profile_id()) is null or not (select private.has_permission(target_organization_id, 'inventory.manage')) then
    raise exception 'Inventory permission is required.' using errcode = '42501';
  end if;
  if target_code is null or upper(btrim(target_code)) !~ '^[A-Z][A-Z0-9_-]{1,39}$'
    or target_name is null or char_length(btrim(target_name)) not between 2 and 120
    or (target_notes is not null and char_length(btrim(target_notes)) > 500) then
    raise exception 'Provide a warehouse code, name, and valid notes.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.stores store where store.id = target_store_id and store.organization_id = target_organization_id and store.is_active) then
    raise exception 'Choose an active store stock location for this warehouse.' using errcode = '23514';
  end if;
  actor_id := private.inventory_actor(target_organization_id, target_store_id);
  if actor_id is null then raise exception 'An assigned employee is required for the warehouse store.' using errcode = '42501'; end if;
  insert into public.supply_chain_warehouses (organization_id, store_id, code, name, notes, created_by_employee_id)
  values (target_organization_id, target_store_id, upper(btrim(target_code)), btrim(target_name), nullif(btrim(target_notes), ''), actor_id)
  returning id into warehouse_id;
  perform private.write_audit_log(target_organization_id, 'SUPPLY_CHAIN_WAREHOUSE_CREATED', 'inventory.manage', actor_id, null, target_store_id, null, null, null, null, jsonb_build_object('warehouse_id', warehouse_id));
  return warehouse_id;
end;
$_$;

CREATE OR REPLACE FUNCTION "private"."delete_catalog_product_if_eligible"("target_organization_id" "uuid", "target_product_id" "uuid", "target_confirmation_name" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  existing_name text;
  existing_status text;
  actor_employee_id uuid;
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'products.manage')) then
    raise exception 'Product management permission is required.' using errcode = '42501';
  end if;

  actor_employee_id := private.current_employee_id(target_organization_id);

  select product.name, product.status
  into existing_name, existing_status
  from public.products product
  where product.id = target_product_id
    and product.organization_id = target_organization_id
  for update;

  if not found then
    raise exception 'The product could not be found.' using errcode = '23503';
  end if;

  if existing_status <> 'archived' then
    raise exception 'Archive this product before deleting it permanently.' using errcode = '55000';
  end if;

  if btrim(coalesce(target_confirmation_name, '')) <> existing_name then
    raise exception 'Enter the exact product name to confirm permanent deletion.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.audit_logs audit
    where audit.organization_id = target_organization_id
      and audit.metadata ->> 'product_id' = target_product_id::text
  ) then
    raise exception 'This product has audit history and cannot be deleted. Keep it archived instead.' using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.product_components component
    where component.organization_id = target_organization_id
      and component.component_product_id = target_product_id
  ) then
    raise exception 'This product is used by a composite product and cannot be deleted. Keep it archived instead.' using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.inventory_levels level
    where level.organization_id = target_organization_id
      and level.product_id = target_product_id
      and level.quantity <> 0
  ) then
    raise exception 'This product has stock on hand and cannot be deleted. Keep it archived instead.' using errcode = '55000';
  end if;

  begin
    -- Empty inventory rows and unsold variants are setup records, not business
    -- history. Removing them allows a never-used archived product to be deleted
    -- while every financial, inventory, purchasing, count, transfer, and receipt
    -- relationship continues to be protected by its restrictive foreign key.
    delete from public.inventory_levels
    where organization_id = target_organization_id
      and product_id = target_product_id;

    delete from public.product_variants
    where organization_id = target_organization_id
      and product_id = target_product_id;

    delete from public.products
    where organization_id = target_organization_id
      and id = target_product_id;
  exception
    when foreign_key_violation then
      raise exception 'This product has business history and cannot be deleted. Keep it archived instead.' using errcode = '55000';
  end;

  perform private.write_audit_log(
    target_organization_id,
    'CATALOG_PRODUCT_DELETED',
    'DELETE_CATALOG_PRODUCT',
    actor_employee_id,
    null,
    null,
    null,
    null,
    null,
    'Archived product permanently deleted after dependency checks.',
    jsonb_build_object('product_id', target_product_id, 'product_name', existing_name)
  );

  return existing_name;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."dispatch_inventory_transfer"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid", "target_note" "text", "target_operation_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare transfer public.stock_transfers%rowtype;
begin
  select * into transfer from public.stock_transfers where organization_id = target_organization_id and id = target_stock_transfer_id;
  if transfer.id is null or transfer.stock_request_id is not null then raise exception 'Choose a canonical direct transfer in this organization.' using errcode = '23514'; end if;
  if (select private.current_profile_id()) is null or not (select private.has_inventory_capability(target_organization_id, 'inventory.transfer.send')) then
    raise exception 'Transfer send permission is required.' using errcode = '42501';
  end if;
  return private.dispatch_inventory_transfer_core(target_organization_id, target_stock_transfer_id, target_note, target_operation_id, false);
end;
$$;

CREATE OR REPLACE FUNCTION "private"."dispatch_stock_request"("target_organization_id" "uuid", "target_stock_request_id" "uuid", "target_note" "text", "target_operation_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  request_row public.stock_requests%rowtype;
  existing_transfer public.stock_transfers%rowtype;
  request_line public.stock_request_lines%rowtype;
  actor_id uuid; warehouse_store_id uuid; transfer_id uuid; transfer_number bigint;
  normalized_note text := nullif(btrim(target_note), '');
  effective_note text;
  create_payload jsonb; transition_payload jsonb;
  submit_id uuid; approve_id uuid; dispatch_id uuid;
begin
  if (select private.current_profile_id()) is null or not (select private.has_inventory_capability(target_organization_id, 'inventory.transfer.send')) then
    raise exception 'Transfer send permission is required.' using errcode = '42501';
  end if;
  if target_operation_id is null then raise exception 'A stable transfer-dispatch operation ID is required.' using errcode = '23514'; end if;
  if target_note is not null and char_length(btrim(target_note)) > 500 then raise exception 'Dispatch note is too long.' using errcode = '23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text || ':' || target_operation_id::text, 0));
  select * into request_row from public.stock_requests item
   where item.id = target_stock_request_id and item.organization_id = target_organization_id for update;
  if request_row.id is null then raise exception 'Choose a stock request in this organization.' using errcode = '23514'; end if;
  select warehouse.store_id into warehouse_store_id from public.supply_chain_warehouses warehouse
   where warehouse.id = request_row.source_warehouse_id and warehouse.organization_id = target_organization_id and warehouse.is_active;
  actor_id := private.inventory_actor(target_organization_id, warehouse_store_id);
  if actor_id is null then raise exception 'An assigned employee is required for the source warehouse.' using errcode = '42501'; end if;
  effective_note := coalesce(normalized_note, request_row.note);
  select * into existing_transfer from public.stock_transfers transfer
   where transfer.organization_id = target_organization_id and transfer.operation_id = target_operation_id for update;
  if found then
    if existing_transfer.stock_request_id = request_row.id and existing_transfer.source_store_id = warehouse_store_id
      and existing_transfer.destination_store_id = request_row.requesting_store_id
      and existing_transfer.transferred_by_employee_id = actor_id and existing_transfer.note is not distinct from effective_note then return existing_transfer.id; end if;
    raise exception 'This operation ID is already assigned to a different transfer dispatch.' using errcode = '23505';
  end if;
  if request_row.status <> 'picking' then raise exception 'Only a picked request can be dispatched.' using errcode = '23514'; end if;
  transfer_number := nextval('private.tindio_stock_transfer_number_sequence'::regclass);
  insert into public.stock_transfers (organization_id, transfer_number, operation_id, source_store_id,
    destination_store_id, stock_request_id, status, note, transferred_by_employee_id)
  values (target_organization_id, transfer_number, target_operation_id, warehouse_store_id,
    request_row.requesting_store_id, request_row.id, 'draft', effective_note, actor_id) returning id into transfer_id;
  for request_line in select * from public.stock_request_lines item
    where item.stock_request_id = request_row.id and item.picked_quantity > 0 order by item.product_id, item.variant_id
  loop
    insert into public.stock_transfer_lines (organization_id, stock_transfer_id, stock_request_line_id,
      product_id, variant_id, quantity, unit_cost_minor, unit_cost_is_known)
    values (target_organization_id, transfer_id, request_line.id, request_line.product_id,
      request_line.variant_id, request_line.picked_quantity, 0, false);
  end loop;
  if not found then raise exception 'A picked request must contain at least one item.' using errcode = '23514'; end if;
  create_payload := jsonb_build_object('stock_request_id', request_row.id, 'source_store_id', warehouse_store_id,
    'destination_store_id', request_row.requesting_store_id, 'note', effective_note);
  insert into private.stock_transfer_operations (organization_id, stock_transfer_id, operation_id, command,
    normalized_payload, from_status, to_status, actor_employee_id, result_id, note)
  values (target_organization_id, transfer_id, target_operation_id, 'create', create_payload, null, 'draft', actor_id, transfer_id, effective_note);
  submit_id := private.inventory_transfer_child_operation_id(target_operation_id, 'submit');
  approve_id := private.inventory_transfer_child_operation_id(target_operation_id, 'approve');
  dispatch_id := private.inventory_transfer_child_operation_id(target_operation_id, 'dispatch');
  transition_payload := jsonb_build_object('stock_transfer_id', transfer_id, 'note', normalized_note);
  update public.stock_transfers set status = 'submitted' where id = transfer_id;
  insert into private.stock_transfer_operations (organization_id, stock_transfer_id, operation_id, command, normalized_payload, from_status, to_status, actor_employee_id, result_id, note)
  values (target_organization_id, transfer_id, submit_id, 'submit', transition_payload, 'draft', 'submitted', actor_id, transfer_id, normalized_note);
  update public.stock_transfers set status = 'approved' where id = transfer_id;
  insert into private.stock_transfer_operations (organization_id, stock_transfer_id, operation_id, command, normalized_payload, from_status, to_status, actor_employee_id, result_id, note)
  values (target_organization_id, transfer_id, approve_id, 'approve', transition_payload, 'submitted', 'approved', actor_id, transfer_id, normalized_note);
  perform private.dispatch_inventory_transfer_core(target_organization_id, transfer_id, normalized_note, dispatch_id, true);
  update public.stock_request_lines set dispatched_quantity = picked_quantity where stock_request_id = request_row.id and picked_quantity > 0;
  update public.stock_requests set status = 'dispatched', dispatched_by_employee_id = actor_id, dispatched_at = now() where id = request_row.id;
  perform private.write_audit_log(target_organization_id, 'STOCK_REQUEST_DISPATCHED', 'inventory.transfer.send', actor_id,
    null, warehouse_store_id, null, null, null, effective_note,
    jsonb_build_object('stock_request_id', request_row.id, 'request_number', request_row.request_number,
      'stock_transfer_id', transfer_id, 'transfer_number', transfer_number, 'destination_store_id', request_row.requesting_store_id));
  return transfer_id;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."enforce_open_ticket_capabilities"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  target_organization_id uuid;
begin
  if tg_op = 'DELETE' then
    target_organization_id := old.organization_id;
  else
    target_organization_id := new.organization_id;
  end if;

  -- Internal database maintenance has no Supabase user context. Every client
  -- request has private.current_profile_id() and must satisfy the full POS ticket capability.
  if (select private.current_profile_id()) is not null then
    perform private.require_pos_capabilities(
      target_organization_id,
      array['pos.access', 'sales.create', 'tickets.manage']
    );
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."get_catalog_costs"("target_organization_id" "uuid", "requested_product_ids" "uuid"[]) RETURNS TABLE("product_id" "uuid", "variant_id" "uuid", "cost_minor" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(
      target_organization_id,
      'products.view_cost'
    )) then
    raise exception 'Product cost permission is required.' using errcode = '42501';
  end if;

  return query
  select product.id, null::uuid, product.cost_minor
  from public.products product
  where product.organization_id = target_organization_id
    and (
      requested_product_ids is null
      or product.id = any(requested_product_ids)
    )
  union all
  select variant.product_id, variant.id, variant.cost_minor
  from public.product_variants variant
  where variant.organization_id = target_organization_id
    and (
      requested_product_ids is null
      or variant.product_id = any(requested_product_ids)
    );
end;
$$;

CREATE OR REPLACE FUNCTION "private"."get_checkout_stock_warning"("target_organization_id" "uuid", "target_store_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  negative_item_count integer;
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'sales.create')) then
    raise exception 'Sales permission is required.' using errcode = '42501';
  end if;
  if private.inventory_actor(target_organization_id, target_store_id) is null then
    raise exception 'You are not assigned to this store.' using errcode = '42501';
  end if;
  if private.resolve_negative_stock_policy(target_organization_id, target_store_id) <> 'warn' then
    return 0;
  end if;

  select count(*)::integer
  into negative_item_count
  from public.inventory_levels level
  where level.organization_id = target_organization_id
    and level.store_id = target_store_id
    and level.quantity < 0;
  return negative_item_count;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."get_checkout_stock_warning"("target_organization_id" "uuid", "target_store_id" "uuid", "target_sale_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  negative_item_count integer;
begin
  if (select private.current_profile_id()) is null
    or not (
      select private.has_permission(target_organization_id, 'sales.create')
    ) then
    raise exception 'Sales permission is required.'
      using errcode = '42501';
  end if;

  if private.inventory_actor(
    target_organization_id,
    target_store_id
  ) is null then
    raise exception 'You are not assigned to this store.'
      using errcode = '42501';
  end if;

  if private.resolve_negative_stock_policy(
    target_organization_id,
    target_store_id
  ) <> 'warn' then
    return 0;
  end if;

  if not exists (
    select 1
    from public.sales sale
    where sale.id = target_sale_id
      and sale.organization_id = target_organization_id
      and sale.store_id = target_store_id
  ) then
    raise exception 'The completed sale was not found in this store.'
      using errcode = 'P0002';
  end if;

  with direct_positions as (
    select item.product_id, item.variant_id
    from public.sale_items item
    join public.products product
      on product.id = item.product_id
     and product.organization_id = item.organization_id
     and product.track_inventory
    where item.organization_id = target_organization_id
      and item.sale_id = target_sale_id
      and not (
        item.variant_id is null
        and product.is_composite
        and product.composite_inventory_mode = 'made_to_order'
      )
  ),
  made_to_order_positions as (
    select
      recipe.component_product_id as product_id,
      recipe.component_variant_id as variant_id
    from public.sale_items item
    join public.products parent
      on parent.id = item.product_id
     and parent.organization_id = item.organization_id
     and parent.track_inventory
     and parent.is_composite
     and parent.composite_inventory_mode = 'made_to_order'
    join public.product_components recipe
      on recipe.organization_id = parent.organization_id
     and recipe.product_id = parent.id
    join public.products component_product
      on component_product.id = recipe.component_product_id
     and component_product.organization_id = recipe.organization_id
     and component_product.track_inventory
    where item.organization_id = target_organization_id
      and item.sale_id = target_sale_id
      and item.variant_id is null
  ),
  sale_stock_positions as (
    select * from direct_positions
    union
    select * from made_to_order_positions
  )
  select count(*)::integer
  into negative_item_count
  from sale_stock_positions position
  join public.inventory_levels level
    on level.organization_id = target_organization_id
   and level.store_id = target_store_id
   and level.product_id = position.product_id
   and level.variant_id is not distinct from position.variant_id
   and level.quantity < 0;

  return negative_item_count;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."get_customer_display_management_sessions"("target_organization_id" "uuid") RETURNS TABLE("register_id" "uuid", "created_at" timestamp with time zone, "last_published_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if (select private.current_profile_id()) is null
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

CREATE OR REPLACE FUNCTION "private"."get_inventory_count_awareness"("target_organization_id" "uuid") RETURNS TABLE("store_id" "uuid", "product_id" "uuid", "variant_id" "uuid", "last_counted_at" timestamp with time zone, "expected_quantity" numeric, "counted_quantity" numeric, "inventory_count_id" "uuid", "count_number" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if (select private.current_profile_id()) is null or not (
    (select private.has_permission(target_organization_id, 'inventory.view'))
    or (select private.has_permission(target_organization_id, 'inventory.count'))
    or (select private.has_permission(target_organization_id, 'inventory.manage'))
  ) then
    raise exception 'Inventory read permission is required.' using errcode = '42501';
  end if;

  return query
  select
    level.store_id,
    level.product_id,
    level.variant_id,
    latest.last_counted_at,
    latest.expected_quantity,
    latest.counted_quantity,
    latest.inventory_count_id,
    latest.count_number
  from public.inventory_levels level
  join public.products product
    on product.id = level.product_id
   and product.organization_id = level.organization_id
   and product.status = 'active'
   and product.track_inventory
  left join lateral (
    select
      coalesce(count_document.completed_at, count_document.updated_at) as last_counted_at,
      count_line.expected_quantity,
      count_line.counted_quantity,
      count_document.id as inventory_count_id,
      count_document.count_number
    from public.inventory_count_lines count_line
    join public.inventory_counts count_document
      on count_document.id = count_line.inventory_count_id
     and count_document.organization_id = count_line.organization_id
    where count_line.organization_id = target_organization_id
      and count_document.store_id = level.store_id
      and count_line.product_id = level.product_id
      and count_line.variant_id is not distinct from level.variant_id
      and count_line.counted_quantity is not null
      and count_document.status in ('posted', 'completed')
    order by coalesce(count_document.completed_at, count_document.updated_at) desc,
      count_document.id desc
    limit 1
  ) latest on true
  where level.organization_id = target_organization_id
    and (select private.has_store_read_scope(target_organization_id, level.store_id))
  order by level.store_id, level.product_id, level.variant_id nulls first;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."get_kitchen_orders"("target_organization_id" "uuid", "target_store_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("kitchen_order_id" "uuid", "store_id" "uuid", "store_name" "text", "order_number" bigint, "order_label" "text", "order_note" "text", "dining_option_name" "text", "priority" "text", "status" "text", "created_at" timestamp with time zone, "started_at" timestamp with time zone, "ready_at" timestamp with time zone, "completed_at" timestamp with time zone, "items" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if (select private.current_profile_id()) is null
    or not (
      (select private.has_permission(target_organization_id, 'kitchen.view'))
      or (select private.has_permission(target_organization_id, 'kitchen.manage'))
    ) then
    raise exception 'Kitchen display access is required.' using errcode = '42501';
  end if;

  return query
  select
    kitchen_order.id,
    kitchen_order.store_id,
    store.name,
    kitchen_order.order_number,
    kitchen_order.order_label,
    kitchen_order.order_note,
    kitchen_order.dining_option_name_snapshot,
    kitchen_order.priority,
    kitchen_order.status,
    kitchen_order.created_at,
    kitchen_order.started_at,
    kitchen_order.ready_at,
    kitchen_order.completed_at,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', kitchen_item.id,
          'name', kitchen_item.product_name_snapshot,
          'variant_name', kitchen_item.variant_name_snapshot,
          'modifiers', kitchen_item.modifiers_snapshot,
          'quantity', kitchen_item.quantity,
          'station', kitchen_item.station,
          'status', kitchen_item.status,
          'started_at', kitchen_item.started_at,
          'ready_at', kitchen_item.ready_at,
          'completed_at', kitchen_item.completed_at
        ) order by kitchen_item.line_number
      ) filter (where kitchen_item.id is not null),
      '[]'::jsonb
    )
  from public.kitchen_orders kitchen_order
  join public.stores store
    on store.id = kitchen_order.store_id
   and store.organization_id = kitchen_order.organization_id
  left join public.kitchen_order_items kitchen_item
    on kitchen_item.kitchen_order_id = kitchen_order.id
   and kitchen_item.organization_id = kitchen_order.organization_id
  where kitchen_order.organization_id = target_organization_id
    and (target_store_id is null or kitchen_order.store_id = target_store_id)
    and (
      kitchen_order.status <> 'COMPLETED'
      or kitchen_order.completed_at >= now() - interval '4 hours'
    )
    and exists (
      select 1
      from public.employees employee
      join public.employee_stores employee_store
        on employee_store.employee_id = employee.id
       and employee_store.organization_id = employee.organization_id
      where employee.organization_id = target_organization_id
        and employee.profile_id = (select private.current_profile_id())
        and employee.status = 'active'
        and employee_store.store_id = kitchen_order.store_id
    )
  group by
    kitchen_order.id,
    kitchen_order.store_id,
    store.name,
    kitchen_order.order_number,
    kitchen_order.order_label,
    kitchen_order.order_note,
    kitchen_order.dining_option_name_snapshot,
    kitchen_order.priority,
    kitchen_order.status,
    kitchen_order.created_at,
    kitchen_order.started_at,
    kitchen_order.ready_at,
    kitchen_order.completed_at
  order by
    case kitchen_order.priority when 'RUSH' then 0 else 1 end,
    case kitchen_order.status
      when 'NEW' then 1
      when 'PREPARING' then 2
      when 'READY' then 3
      else 4
    end,
    kitchen_order.created_at;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."get_kitchen_station_routes"("target_organization_id" "uuid") RETURNS TABLE("category_id" "uuid", "category_name" "text", "station" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'kitchen.manage')) then
    raise exception 'Kitchen order management access is required.' using errcode = '42501';
  end if;

  return query
  select category.id, category.name, coalesce(route.station, private.default_kitchen_station_for_category(category.organization_id, category.id, category.name))
  from public.categories category
  left join public.kitchen_station_category_routes route
    on route.organization_id = category.organization_id
   and route.category_id = category.id
  where category.organization_id = target_organization_id
    and not category.is_archived
  order by lower(category.name);
end;
$$;

CREATE OR REPLACE FUNCTION "private"."get_pos_customer_display_sessions"("target_organization_id" "uuid") RETURNS TABLE("register_id" "uuid", "realtime_topic" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if (select private.current_profile_id()) is null
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
        and employee.profile_id = (select private.current_profile_id())
        and employee.status = 'active'
        and employee_store.store_id = display.store_id
    );
end;
$$;

CREATE OR REPLACE FUNCTION "private"."get_pos_customer_display_sessions_with_ids"("target_organization_id" "uuid") RETURNS TABLE("session_id" "uuid", "register_id" "uuid", "realtime_topic" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'sales.create')) then
    raise exception 'Sales permission is required.' using errcode = '42501';
  end if;

  return query
  select display.id, display.register_id, display.realtime_topic
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
        and employee.profile_id = (select private.current_profile_id())
        and employee.status = 'active'
        and employee_store.store_id = display.store_id
    );
end;
$$;

CREATE OR REPLACE FUNCTION "private"."get_reporting_snapshot"("target_organization_id" "uuid", "target_start_date" "date", "target_end_date" "date", "target_store_id" "uuid", "target_required_permission" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  organization_timezone text;
  period_start timestamptz;
  period_end timestamptz;
  can_view_cost boolean;
begin
  if (select private.current_profile_id()) is null
     or target_required_permission not in ('dashboard.view', 'reports.view')
     or not (select private.has_permission(target_organization_id, target_required_permission)) then
    raise exception 'Reporting access is required.' using errcode = '42501';
  end if;

  if target_start_date is null
     or target_end_date is null
     or target_end_date < target_start_date
     or target_end_date - target_start_date > 365 then
    raise exception 'Choose a report range from one to 366 days.' using errcode = '22023';
  end if;

  select organization.timezone into organization_timezone
  from public.organizations organization
  where organization.id = target_organization_id;

  if organization_timezone is null then
    raise exception 'The organization could not be resolved.' using errcode = '23514';
  end if;

  if target_store_id is not null and not exists (
    select 1 from public.stores store
    where store.id = target_store_id and store.organization_id = target_organization_id
  ) then
    raise exception 'Choose a store from this organization.' using errcode = '23514';
  end if;

  period_start := target_start_date::timestamp at time zone organization_timezone;
  period_end := (target_end_date + 1)::timestamp at time zone organization_timezone;
  can_view_cost := (select private.has_permission(target_organization_id, 'products.view_cost'));

  return (
    with sales_in_period as materialized (
      select sale.*
      from public.sales sale
      where sale.organization_id = target_organization_id
        and sale.completed_at >= period_start
        and sale.completed_at < period_end
        and (target_store_id is null or sale.store_id = target_store_id)
    ),
    refunds_in_period as materialized (
      select refund.*
      from public.refunds refund
      where refund.organization_id = target_organization_id
        and refund.completed_at >= period_start
        and refund.completed_at < period_end
        and (target_store_id is null or refund.store_id = target_store_id)
    ),
    financial_inputs as materialized (
      select
        coalesce(sum(sale.subtotal_minor), 0)::bigint as gross_sales_minor,
        coalesce(sum(sale.total_minor), 0)::bigint as sales_total_minor,
        coalesce(sum(sale.discount_minor), 0)::bigint as discounts_minor,
        coalesce(sum(sale.tax_minor), 0)::bigint as taxes_minor,
        count(*)::integer as transaction_count,
        coalesce(round(sum(sale.total_minor)::numeric / nullif(count(*), 0)), 0)::bigint as average_order_minor
      from sales_in_period sale
    ),
    sales_cogs as materialized (
      select coalesce(sum(sale_item.cogs_minor), 0)::bigint as cogs_minor
      from public.sale_items sale_item
      join sales_in_period sale on sale.id = sale_item.sale_id
    ),
    refunded_cogs as materialized (
      select coalesce(sum(round(refund_item.quantity * sale_item.unit_cost_minor)), 0)::bigint as cogs_minor
      from public.refund_items refund_item
      join refunds_in_period refund on refund.id = refund_item.refund_id
      join public.sale_items sale_item on sale_item.id = refund_item.sale_item_id
    ),
    financial_rows as materialized (
      select
        financial.gross_sales_minor,
        financial.sales_total_minor,
        financial.discounts_minor,
        financial.taxes_minor,
        financial.transaction_count,
        financial.average_order_minor,
        (select coalesce(sum(refund.total_minor), 0)::bigint from refunds_in_period refund) as refunds_minor,
        (sales_cost.cogs_minor - refund_cost.cogs_minor)::bigint as cogs_minor
      from financial_inputs financial
      cross join sales_cogs sales_cost
      cross join refunded_cogs refund_cost
    ),
    daily_sales as (
      select
        (sale.completed_at at time zone organization_timezone)::date as report_date,
        sum(sale.total_minor)::bigint as sales_minor,
        count(*)::integer as transaction_count
      from sales_in_period sale
      group by 1
    ),
    daily_refunds as (
      select
        (refund.completed_at at time zone organization_timezone)::date as report_date,
        sum(refund.total_minor)::bigint as refunds_minor
      from refunds_in_period refund
      group by 1
    ),
    product_sales as (
      select
        sale_item.product_id,
        sale_item.variant_id,
        concat_ws(' / ', sale_item.product_name_snapshot, sale_item.variant_name_snapshot) as product_name,
        coalesce(sum(sale_item.quantity), 0)::numeric as quantity_sold,
        sum(sale_item.line_total_minor)::bigint as sales_minor
      from public.sale_items sale_item
      join sales_in_period sale on sale.id = sale_item.sale_id
      group by sale_item.product_id, sale_item.variant_id, sale_item.product_name_snapshot, sale_item.variant_name_snapshot
    ),
    product_refunds as (
      select
        refund_item.product_id,
        refund_item.variant_id,
        coalesce(sum(refund_item.quantity), 0)::numeric as quantity_refunded,
        sum(refund_item.line_total_minor)::bigint as refunds_minor
      from public.refund_items refund_item
      join refunds_in_period refund on refund.id = refund_item.refund_id
      group by refund_item.product_id, refund_item.variant_id
    ),
    product_rows as materialized (
      select
        coalesce(sale_row.product_id, refund_row.product_id) as product_id,
        coalesce(sale_row.variant_id, refund_row.variant_id) as variant_id,
        coalesce(sale_row.product_name, 'Refunded product') as product_name,
        coalesce(sale_row.quantity_sold, 0)::numeric as quantity_sold,
        coalesce(refund_row.quantity_refunded, 0)::numeric as quantity_refunded,
        coalesce(sale_row.sales_minor, 0)::bigint as sales_minor,
        coalesce(refund_row.refunds_minor, 0)::bigint as refunds_minor
      from product_sales sale_row
      full join product_refunds refund_row
        on refund_row.product_id = sale_row.product_id
       and refund_row.variant_id is not distinct from sale_row.variant_id
    ),
    category_rows as (
      select
        coalesce(category.name, 'Uncategorized') as category_name,
        sum(sale_item.line_total_minor)::bigint as sales_minor,
        coalesce(sum(sale_item.quantity), 0)::numeric as quantity_sold
      from public.sale_items sale_item
      join sales_in_period sale on sale.id = sale_item.sale_id
      join public.products product on product.id = sale_item.product_id and product.organization_id = sale_item.organization_id
      left join public.categories category on category.id = product.category_id and category.organization_id = product.organization_id
      group by coalesce(category.name, 'Uncategorized')
    ),
    employee_rows as (
      select sale.cashier_employee_id, sale.cashier_name_snapshot as employee_name, count(*)::integer as transaction_count, sum(sale.total_minor)::bigint as sales_minor
      from sales_in_period sale
      group by sale.cashier_employee_id, sale.cashier_name_snapshot
    ),
    store_rows as (
      select sale.store_id, sale.store_name_snapshot as store_name, count(*)::integer as transaction_count, sum(sale.total_minor)::bigint as sales_minor
      from sales_in_period sale
      group by sale.store_id, sale.store_name_snapshot
    ),
    register_rows as (
      select sale.register_id, sale.register_name_snapshot as register_name, count(*)::integer as transaction_count, sum(sale.total_minor)::bigint as sales_minor
      from sales_in_period sale
      group by sale.register_id, sale.register_name_snapshot
    ),
    customer_rows as (
      select sale.customer_id, coalesce(customer.full_name, 'Former customer') as customer_name, count(*)::integer as transaction_count, sum(sale.total_minor)::bigint as sales_minor
      from sales_in_period sale
      left join public.customers customer on customer.id = sale.customer_id and customer.organization_id = sale.organization_id
      where sale.customer_id is not null
      group by sale.customer_id, coalesce(customer.full_name, 'Former customer')
    ),
    hourly_rows as (
      select
        extract(hour from sale.completed_at at time zone organization_timezone)::integer as hour_of_day,
        count(*)::integer as transaction_count,
        sum(sale.total_minor)::bigint as sales_minor
      from sales_in_period sale
      group by 1
    ),
    payment_rows as (
      select payment.payment_method_name_snapshot as payment_method_name, payment.payment_method_type_snapshot as payment_method_type, sum(payment.amount_minor)::bigint as amount_minor, count(*)::integer as payment_count
      from public.payments payment
      join sales_in_period sale on sale.id = payment.sale_id
      group by payment.payment_method_name_snapshot, payment.payment_method_type_snapshot
    ),
    inventory_positions as materialized (
      select
        level.store_id,
        level.product_id,
        level.variant_id,
        level.quantity,
        level.average_cost_minor,
        coalesce(setting.low_stock_level, 0)::numeric as low_stock_level,
        concat_ws(' / ', product.name, variant.name) as item_name
      from public.inventory_levels level
      join public.products product on product.id = level.product_id and product.organization_id = level.organization_id
      left join public.product_variants variant on variant.id = level.variant_id and variant.product_id = level.product_id and variant.organization_id = level.organization_id
      left join public.product_store_settings setting on setting.organization_id = level.organization_id and setting.product_id = level.product_id and setting.store_id = level.store_id
      where level.organization_id = target_organization_id
        and (target_store_id is null or level.store_id = target_store_id)
    ),
    recent_sale_activity as materialized (
      select distinct movement.store_id, movement.product_id, movement.variant_id
      from public.inventory_movements movement
      where movement.organization_id = target_organization_id
        and movement.movement_type = 'SALE'
        and movement.created_at >= now() - interval '90 days'
        and (target_store_id is null or movement.store_id = target_store_id)
    ),
    inventory_movement_rows as materialized (
      select movement.movement_type, count(*)::integer as movement_count, coalesce(sum(movement.quantity_delta), 0)::numeric as quantity_delta
      from public.inventory_movements movement
      where movement.organization_id = target_organization_id
        and movement.created_at >= period_start
        and movement.created_at < period_end
        and (target_store_id is null or movement.store_id = target_store_id)
      group by movement.movement_type
    ),
    security_audit_rows as materialized (
      select audit.event_type, audit.operation_code
      from public.audit_logs audit
      where audit.organization_id = target_organization_id
        and audit.created_at >= period_start
        and audit.created_at < period_end
        and (target_store_id is null or audit.store_id = target_store_id)
    ),
    cash_discrepancy_rows as materialized (
      select shift.difference_minor
      from public.shifts shift
      where shift.organization_id = target_organization_id
        and shift.status = 'closed'
        and shift.closed_at >= period_start
        and shift.closed_at < period_end
        and (target_store_id is null or shift.store_id = target_store_id)
        and shift.difference_minor is not null
    )
    select jsonb_build_object(
      'period', jsonb_build_object('start_date', target_start_date, 'end_date', target_end_date, 'store_id', target_store_id, 'timezone', organization_timezone),
      'summary', (
        select jsonb_build_object(
          'gross_sales_minor', financial.gross_sales_minor,
          'sales_total_minor', financial.sales_total_minor,
          'refunds_minor', financial.refunds_minor,
          'net_sales_minor', financial.sales_total_minor - financial.refunds_minor,
          'transaction_count', financial.transaction_count,
          'average_order_minor', financial.average_order_minor,
          'discounts_minor', financial.discounts_minor,
          'taxes_minor', financial.taxes_minor,
          'cost_access', can_view_cost,
          'cogs_minor', case when can_view_cost then financial.cogs_minor else null end,
          'gross_profit_minor', case when can_view_cost then financial.sales_total_minor - financial.refunds_minor - financial.cogs_minor else null end,
          'gross_margin_bps', case when can_view_cost and financial.sales_total_minor - financial.refunds_minor <> 0 then round(((financial.sales_total_minor - financial.refunds_minor - financial.cogs_minor)::numeric / (financial.sales_total_minor - financial.refunds_minor)) * 10000)::integer else null end,
          'estimated_gross_profit_minor', case when can_view_cost then financial.sales_total_minor - financial.refunds_minor - financial.cogs_minor else null end
        ) from financial_rows financial
      ),
      'sales_by_day', (
        select coalesce(jsonb_agg(jsonb_build_object('date', coalesce(daily_sale.report_date, daily_refund.report_date), 'sales_minor', coalesce(daily_sale.sales_minor, 0), 'refunds_minor', coalesce(daily_refund.refunds_minor, 0), 'net_sales_minor', coalesce(daily_sale.sales_minor, 0) - coalesce(daily_refund.refunds_minor, 0), 'transaction_count', coalesce(daily_sale.transaction_count, 0)) order by coalesce(daily_sale.report_date, daily_refund.report_date)), '[]'::jsonb)
        from daily_sales daily_sale full join daily_refunds daily_refund on daily_refund.report_date = daily_sale.report_date
      ),
      'top_products', (
        select coalesce(jsonb_agg(jsonb_build_object('product_id', product_row.product_id, 'variant_id', product_row.variant_id, 'name', product_row.product_name, 'quantity_sold', product_row.quantity_sold, 'quantity_refunded', product_row.quantity_refunded, 'sales_minor', product_row.sales_minor, 'refunds_minor', product_row.refunds_minor, 'net_sales_minor', product_row.sales_minor - product_row.refunds_minor) order by product_row.sales_minor - product_row.refunds_minor desc, product_row.product_name), '[]'::jsonb)
        from (select * from product_rows order by sales_minor - refunds_minor desc, product_name limit 10) product_row
      ),
      'sales_by_category', (
        select coalesce(jsonb_agg(jsonb_build_object('name', category_row.category_name, 'sales_minor', category_row.sales_minor, 'quantity_sold', category_row.quantity_sold) order by category_row.sales_minor desc, category_row.category_name), '[]'::jsonb) from category_rows category_row
      ),
      'sales_by_employee', (
        select coalesce(jsonb_agg(jsonb_build_object('employee_id', employee_row.cashier_employee_id, 'name', employee_row.employee_name, 'transaction_count', employee_row.transaction_count, 'sales_minor', employee_row.sales_minor) order by employee_row.sales_minor desc, employee_row.employee_name), '[]'::jsonb) from employee_rows employee_row
      ),
      'sales_by_store', (
        select coalesce(jsonb_agg(jsonb_build_object('store_id', store_row.store_id, 'name', store_row.store_name, 'transaction_count', store_row.transaction_count, 'sales_minor', store_row.sales_minor) order by store_row.sales_minor desc, store_row.store_name), '[]'::jsonb) from store_rows store_row
      ),
      'sales_by_register', (
        select coalesce(jsonb_agg(jsonb_build_object('register_id', register_row.register_id, 'name', register_row.register_name, 'transaction_count', register_row.transaction_count, 'sales_minor', register_row.sales_minor) order by register_row.sales_minor desc, register_row.register_name), '[]'::jsonb) from register_rows register_row
      ),
      'sales_by_customer', (
        select coalesce(jsonb_agg(jsonb_build_object('customer_id', customer_row.customer_id, 'name', customer_row.customer_name, 'transaction_count', customer_row.transaction_count, 'sales_minor', customer_row.sales_minor) order by customer_row.sales_minor desc, customer_row.customer_name), '[]'::jsonb) from customer_rows customer_row
      ),
      'sales_by_hour', (
        select coalesce(jsonb_agg(jsonb_build_object('hour', hourly_row.hour_of_day, 'label', lpad(hourly_row.hour_of_day::text, 2, '0') || ':00', 'transaction_count', hourly_row.transaction_count, 'sales_minor', hourly_row.sales_minor) order by hourly_row.hour_of_day), '[]'::jsonb) from hourly_rows hourly_row
      ),
      'payments', (
        select coalesce(jsonb_agg(jsonb_build_object('name', payment_row.payment_method_name, 'type', payment_row.payment_method_type, 'amount_minor', payment_row.amount_minor, 'payment_count', payment_row.payment_count) order by payment_row.amount_minor desc, payment_row.payment_method_name), '[]'::jsonb) from payment_rows payment_row
      ),
      'inventory', jsonb_build_object(
        'cost_access', can_view_cost,
        'stock_item_count', (select count(*)::integer from inventory_positions),
        'on_hand_quantity', (select coalesce(sum(position.quantity), 0)::numeric from inventory_positions position),
        'low_stock_count', (select count(*)::integer from inventory_positions position where position.low_stock_level > 0 and position.quantity <= position.low_stock_level),
        'out_of_stock_count', (select count(*)::integer from inventory_positions position where position.quantity = 0),
        'negative_stock_count', (select count(*)::integer from inventory_positions position where position.quantity < 0),
        'dead_stock_count', (select count(*)::integer from inventory_positions position left join recent_sale_activity activity on activity.store_id = position.store_id and activity.product_id = position.product_id and activity.variant_id is not distinct from position.variant_id where position.quantity > 0 and activity.product_id is null),
        'inventory_valuation_minor', case when can_view_cost then (select coalesce(sum(position.quantity * position.average_cost_minor), 0)::bigint from inventory_positions position) else null end,
        'fast_movers', (select coalesce(jsonb_agg(jsonb_build_object('product_id', mover.product_id, 'variant_id', mover.variant_id, 'name', mover.product_name, 'quantity_sold', mover.quantity_sold - mover.quantity_refunded, 'net_sales_minor', mover.sales_minor - mover.refunds_minor) order by mover.quantity_sold - mover.quantity_refunded desc, mover.product_name), '[]'::jsonb) from (select * from product_rows where quantity_sold - quantity_refunded > 0 order by quantity_sold - quantity_refunded desc, product_name limit 5) mover),
        'slow_movers', (select coalesce(jsonb_agg(jsonb_build_object('product_id', mover.product_id, 'variant_id', mover.variant_id, 'name', mover.item_name, 'quantity_on_hand', mover.quantity, 'quantity_sold', mover.quantity_sold) order by mover.quantity_sold, mover.quantity desc, mover.item_name), '[]'::jsonb) from (select position.product_id, position.variant_id, position.item_name, position.quantity, coalesce(product_row.quantity_sold - product_row.quantity_refunded, 0) as quantity_sold from inventory_positions position left join product_rows product_row on product_row.product_id = position.product_id and product_row.variant_id is not distinct from position.variant_id where position.quantity > 0 and coalesce(product_row.quantity_sold - product_row.quantity_refunded, 0) > 0 order by coalesce(product_row.quantity_sold - product_row.quantity_refunded, 0), position.quantity desc, position.item_name limit 5) mover),
        'activity', jsonb_build_object(
          'manual_adjustment_count', (select coalesce(sum(movement.movement_count) filter (where movement.movement_type in ('ADJUSTMENT', 'DAMAGE', 'LOSS', 'COUNT')), 0)::integer from inventory_movement_rows movement),
          'purchase_receipt_count', (select coalesce(sum(movement.movement_count) filter (where movement.movement_type = 'RECEIPT'), 0)::integer from inventory_movement_rows movement),
          'transfer_count', (select coalesce(sum(movement.movement_count) filter (where movement.movement_type in ('TRANSFER_IN', 'TRANSFER_OUT')), 0)::integer from inventory_movement_rows movement)
        ),
        'movement_by_type', (select coalesce(jsonb_agg(jsonb_build_object('movement_type', inventory_row.movement_type, 'movement_count', inventory_row.movement_count, 'quantity_delta', inventory_row.quantity_delta) order by inventory_row.movement_type), '[]'::jsonb) from inventory_movement_rows inventory_row)
      ),
      'security', jsonb_build_object(
        'refund_count', (select count(*)::integer from refunds_in_period),
        'void_count', (select count(*)::integer from security_audit_rows audit where audit.operation_code = 'sales.void' and audit.event_type = 'APPROVAL_CONSUMED'),
        'price_override_count', (select count(*)::integer from security_audit_rows audit where audit.operation_code = 'prices.override' and audit.event_type = 'APPROVAL_CONSUMED'),
        'high_discount_count', (select count(*)::integer from sales_in_period sale where sale.discount_minor > 0 and sale.discount_minor * 100 >= sale.subtotal_minor * 20),
        'manager_approval_count', (select count(*)::integer from security_audit_rows audit where audit.event_type = 'APPROVAL_APPROVED'),
        'cash_discrepancy_count', (select count(*)::integer from cash_discrepancy_rows),
        'cash_discrepancy_minor', (select coalesce(sum(difference_minor), 0)::bigint from cash_discrepancy_rows),
        'cash_discrepancy_absolute_minor', (select coalesce(sum(abs(difference_minor)), 0)::bigint from cash_discrepancy_rows),
        'manual_inventory_change_count', (select coalesce(sum(movement.movement_count) filter (where movement.movement_type in ('ADJUSTMENT', 'DAMAGE', 'LOSS', 'COUNT')), 0)::integer from inventory_movement_rows movement),
        'events', (select coalesce(jsonb_agg(jsonb_build_object('event_type', event_row.event_type, 'event_count', event_row.event_count) order by event_row.event_count desc, event_row.event_type), '[]'::jsonb) from (select audit.event_type, count(*)::integer as event_count from security_audit_rows audit group by audit.event_type order by count(*) desc, audit.event_type limit 10) event_row)
      )
    )
  );
end;
$$;

CREATE OR REPLACE FUNCTION "private"."get_scoped_reporting_snapshot"("target_organization_id" "uuid", "target_start_date" "date", "target_end_date" "date", "target_store_id" "uuid", "target_required_permission" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if (select private.current_profile_id()) is null
     or target_required_permission not in ('dashboard.view', 'reports.view')
     or not (select private.has_permission(target_organization_id, target_required_permission)) then
    raise exception 'Reporting access is required.' using errcode = '42501';
  end if;

  -- `stores.manage` is the explicit organization-wide reporting authority.
  -- Any other reporting role must request one of its employee-store links.
  if not (select private.has_permission(target_organization_id, 'stores.manage')) then
    if target_store_id is null then
      raise exception 'Choose one of your assigned stores for reporting.' using errcode = '42501';
    end if;

    if not exists (
      select 1
      from public.employees employee
      join public.employee_stores assignment
        on assignment.employee_id = employee.id
       and assignment.organization_id = employee.organization_id
      where employee.organization_id = target_organization_id
        and employee.profile_id = (select private.current_profile_id())
        and employee.status = 'active'
        and assignment.store_id = target_store_id
    ) then
      raise exception 'Reporting is limited to your assigned stores.' using errcode = '42501';
    end if;
  end if;

  return private.get_reporting_snapshot(
    target_organization_id,
    target_start_date,
    target_end_date,
    target_store_id,
    target_required_permission
  );
end;
$$;

CREATE OR REPLACE FUNCTION "private"."guard_employee_lifecycle_transition"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if (new.status is distinct from old.status or new.archived_at is distinct from old.archived_at)
    and (select private.current_profile_id()) is not null
    and coalesce(current_setting('tindio.employee_lifecycle_change', true), '') <> 'authorized' then
    raise exception 'Use the controlled employee lifecycle workflow to change status.' using errcode = '42501';
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."has_organization_membership"("target_organization_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select coalesce(
    (select private.current_profile_id()) is not null
    and exists (
      select 1
      from public.employees employee
      where employee.organization_id = target_organization_id
        and employee.profile_id = (select private.current_profile_id())
        and employee.status = 'active'
    ), false);
$$;

CREATE OR REPLACE FUNCTION "private"."has_shift_access"("target_organization_id" "uuid", "target_store_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select
    (select private.current_profile_id()) is not null
    and (
      (select private.has_permission(target_organization_id, 'settings.manage'))
      or exists (
        select 1
        from public.employees employee
        join public.employee_stores employee_store
          on employee_store.employee_id = employee.id
         and employee_store.organization_id = employee.organization_id
         and employee_store.store_id = target_store_id
        where employee.organization_id = target_organization_id
          and employee.profile_id = (select private.current_profile_id())
          and employee.status = 'active'
          and (
            (select private.has_permission(target_organization_id, 'shifts.open'))
            or (select private.has_permission(target_organization_id, 'shifts.close'))
            or (select private.has_permission(target_organization_id, 'cash.pay_in'))
            or (select private.has_permission(target_organization_id, 'cash.pay_out'))
          )
      )
    );
$$;

CREATE OR REPLACE FUNCTION "private"."import_catalog_products_v3"("target_organization_id" "uuid", "target_store_ids" "uuid"[], "target_rows" "jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  import_row record; row_number integer; row_json jsonb; row_name text; row_sku text; row_barcode text;
  row_category_id uuid; row_unit text; row_price_minor bigint; row_cost_minor bigint;
  row_price_override_minor bigint; row_product_id uuid; seen_skus text[] := '{}'; seen_barcodes text[] := '{}'; imported_count integer := 0;
begin
  if (select private.current_profile_id()) is null or not (select private.has_permission(target_organization_id,'products.manage')) then raise exception 'Product management permission is required.' using errcode='42501'; end if;
  if jsonb_typeof(target_rows)<>'array' or jsonb_array_length(target_rows) not between 1 and 500 then raise exception 'Import between 1 and 500 product rows at a time.' using errcode='22023'; end if;
  if target_store_ids is null or cardinality(target_store_ids) not between 1 and 100 or cardinality(target_store_ids)<>(select count(distinct id) from unnest(target_store_ids) id) then raise exception 'Choose unique stores for this import.' using errcode='22023'; end if;
  if exists(select 1 from unnest(target_store_ids) id where not private.has_store_read_scope(target_organization_id,id))
    or exists(select 1 from unnest(target_store_ids) id where not exists(select 1 from public.stores s where s.id=id and s.organization_id=target_organization_id and s.is_active)) then raise exception 'Every import store must be active and authorized.' using errcode='42501'; end if;
  for import_row in select value,ordinality from jsonb_array_elements(target_rows) with ordinality loop
    row_json:=import_row.value; row_number:=case when coalesce(row_json->>'row_number','')~'^[1-9][0-9]*$' then (row_json->>'row_number')::integer else import_row.ordinality::integer end;
    row_name:=btrim(coalesce(row_json->>'name','')); row_sku:=nullif(upper(btrim(coalesce(row_json->>'sku',''))),''); row_barcode:=nullif(btrim(coalesce(row_json->>'barcode','')),''); row_unit:=lower(btrim(coalesce(row_json->>'unit','each')));
    if jsonb_typeof(row_json)<>'object' then raise exception 'CSV row % must be an object.',row_number using errcode='22023'; end if;
    if row_json ? 'low_stock_level' then raise exception 'CSV row % contains legacy low_stock_level. Configure replenishment rules in Stock & Restock.',row_number using errcode='55000'; end if;
    if char_length(row_name) not between 1 and 160 then raise exception 'CSV row % needs a product name of at most 160 characters.',row_number using errcode='22023'; end if;
    if char_length(coalesce(row_json->>'description',''))>2000 then raise exception 'CSV row % has a description longer than 2,000 characters.',row_number using errcode='22023'; end if;
    if row_sku is not null and row_sku!~'^[A-Z0-9][A-Z0-9._-]{0,63}$' then raise exception 'CSV row % has an invalid SKU.',row_number using errcode='22023'; end if;
    if row_barcode is not null and row_barcode!~'^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$' then raise exception 'CSV row % has an invalid barcode.',row_number using errcode='22023'; end if;
    if char_length(row_unit) not between 1 and 24 or row_unit!~'^[a-z][a-z0-9 _-]*$' then raise exception 'CSV row % has an invalid base unit.',row_number using errcode='22023'; end if;
    if jsonb_typeof(row_json->'track_inventory')<>'boolean' or jsonb_typeof(row_json->'is_variable_price')<>'boolean' or jsonb_typeof(row_json->'allow_fractional_quantity')<>'boolean' then raise exception 'CSV row % has invalid yes/no values.',row_number using errcode='22023'; end if;
    if coalesce(row_json->>'price_minor','')!~'^\d{1,10}$' or coalesce(row_json->>'cost_minor','')!~'^\d{1,10}$' then raise exception 'CSV row % has an invalid price or cost.',row_number using errcode='22023'; end if;
    if nullif(btrim(coalesce(row_json->>'image_url','')),'') is not null and btrim(row_json->>'image_url')!~*'^https?://' then raise exception 'CSV row % has an invalid image URL.',row_number using errcode='22023'; end if;
    if jsonb_typeof(row_json->'price_override_minor') not in ('number','null') then raise exception 'CSV row % has invalid store price data.',row_number using errcode='22023'; end if;
    if jsonb_typeof(row_json->'price_override_minor')='number' and row_json->>'price_override_minor'!~'^\d{1,10}$' then raise exception 'CSV row % has an invalid store price.',row_number using errcode='22023'; end if;
    if nullif(row_json->>'category_id','') is not null and ((row_json->>'category_id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or not exists(select 1 from public.categories c where c.id=(row_json->>'category_id')::uuid and c.organization_id=target_organization_id and not c.is_archived)) then raise exception 'CSV row % references an unavailable category.',row_number using errcode='23503'; end if;
    if row_sku is not null and row_sku=any(seen_skus) then raise exception 'CSV row % repeats a SKU in this file.',row_number using errcode='23505'; end if;
    if row_barcode is not null and row_barcode=any(seen_barcodes) then raise exception 'CSV row % repeats a barcode in this file.',row_number using errcode='23505'; end if;
    if row_sku is not null then seen_skus:=array_append(seen_skus,row_sku); end if; if row_barcode is not null then seen_barcodes:=array_append(seen_barcodes,row_barcode); end if;
  end loop;
  for import_row in select value from jsonb_array_elements(target_rows) loop
    row_json:=import_row.value; row_category_id:=nullif(row_json->>'category_id','')::uuid; row_price_minor:=(row_json->>'price_minor')::bigint; row_cost_minor:=(row_json->>'cost_minor')::bigint;
    row_price_override_minor:=case when jsonb_typeof(row_json->'price_override_minor')='number' then (row_json->>'price_override_minor')::bigint else null end;
    row_product_id:=private.create_catalog_product_v2(target_organization_id,row_category_id,btrim(row_json->>'name'),coalesce(row_json->>'description',''),'simple',coalesce(row_json->>'sku',''),coalesce(row_json->>'barcode',''),row_price_minor,row_cost_minor,(row_json->>'track_inventory')::boolean,coalesce(row_json->>'unit','each'),target_store_ids,'[]'::jsonb,coalesce(row_json->>'image_url',''),(row_json->>'is_variable_price')::boolean,(row_json->>'allow_fractional_quantity')::boolean);
    if row_price_override_minor is not null then update public.product_store_settings set price_override_minor=row_price_override_minor where organization_id=target_organization_id and product_id=row_product_id and store_id=any(target_store_ids); end if;
    imported_count:=imported_count+1;
  end loop;
  return imported_count;
end;
$_$;

CREATE OR REPLACE FUNCTION "private"."import_customers_csv"("target_organization_id" "uuid", "target_rows" "jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
  if (select private.current_profile_id()) is null
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
    and employee.profile_id = (select private.current_profile_id())
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
$_$;

CREATE OR REPLACE FUNCTION "private"."import_inventory_adjustments_csv"("target_organization_id" "uuid", "target_store_id" "uuid", "target_reason_code" "text", "target_rows" "jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
  if (select private.current_profile_id()) is null or not (select private.has_permission(target_organization_id, 'inventory.manage')) then raise exception 'Inventory management permission is required.' using errcode = '42501'; end if;
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
$_$;

CREATE OR REPLACE FUNCTION "private"."import_inventory_adjustments_csv"("target_organization_id" "uuid", "target_store_id" "uuid", "target_reason_code" "text", "target_rows" "jsonb", "target_operation_id" "uuid", "target_approval_request_id" "uuid" DEFAULT NULL::"uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  import_row record;
  row_json jsonb;
  row_number integer;
  actor_id uuid;
  batch_id uuid;
  existing_batch public.inventory_adjustment_import_batches%rowtype;
  expected_payload jsonb;
  payload_fingerprint text;
  normalized_reason_code text;
  seen_items text[] := '{}';
  row_product_id uuid;
  row_variant_id uuid;
  row_quantity numeric(14,3);
  row_note text;
begin
  if (select private.current_profile_id()) is null or target_operation_id is null then
    raise exception 'Inventory adjustment permission and operation identity are required.' using errcode = '42501';
  end if;
  if coalesce(jsonb_typeof(target_rows), '') <> 'array'
    or coalesce(jsonb_array_length(target_rows), 0) not between 1 and 500 then
    raise exception 'Import between 1 and 500 adjustment rows at a time.' using errcode = '23514';
  end if;

  normalized_reason_code := upper(btrim(coalesce(target_reason_code, '')));
  if not exists (
    select 1 from public.inventory_adjustment_reasons reason
    where reason.organization_id = target_organization_id
      and reason.code = normalized_reason_code
      and reason.is_active
  ) then
    raise exception 'Choose an active adjustment reason.' using errcode = '23514';
  end if;

  for import_row in
    select value, ordinality from jsonb_array_elements(target_rows) with ordinality
  loop
    row_json := import_row.value;
    row_number := case
      when coalesce(row_json ->> 'row_number', '') ~ '^[1-9][0-9]*$'
        then (row_json ->> 'row_number')::integer
      else import_row.ordinality::integer
    end;
    if jsonb_typeof(row_json) <> 'object'
      or coalesce(row_json ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'CSV row % needs a valid item.', row_number using errcode = '23514';
    end if;
    if row_json ? 'variant_id'
      and row_json -> 'variant_id' <> 'null'::jsonb
      and coalesce(row_json ->> 'variant_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'CSV row % has an invalid variant.', row_number using errcode = '23514';
    end if;
    if coalesce(row_json ->> 'quantity_delta', '') !~ '^-?\d{1,8}(\.\d{1,3})?$'
      or (row_json ->> 'quantity_delta')::numeric = 0 then
      raise exception 'CSV row % needs a non-zero quantity change.', row_number using errcode = '23514';
    end if;
    if char_length(btrim(coalesce(row_json ->> 'note', ''))) not between 2 and 500 then
      raise exception 'CSV row % needs an explanation between 2 and 500 characters.', row_number using errcode = '23514';
    end if;
    row_product_id := (row_json ->> 'product_id')::uuid;
    row_variant_id := nullif(row_json ->> 'variant_id', '')::uuid;
    if concat(row_product_id::text, '|', coalesce(row_variant_id::text, '')) = any(seen_items) then
      raise exception 'CSV row % repeats an item in this file.', row_number using errcode = '23505';
    end if;
    seen_items := array_append(seen_items, concat(row_product_id::text, '|', coalesce(row_variant_id::text, '')));
  end loop;

  expected_payload := jsonb_build_object(
    'store_id', target_store_id,
    'reason_code', normalized_reason_code,
    'operation_id', target_operation_id,
    'rows', target_rows
  );
  payload_fingerprint := md5(expected_payload::text);

  perform private.authorize_sensitive_operation(
    target_organization_id,
    'inventory.adjust',
    target_approval_request_id,
    expected_payload,
    target_operation_id
  );

  actor_id := private.inventory_actor(target_organization_id, target_store_id);
  if actor_id is null then
    raise exception 'An assigned employee is required for this store.' using errcode = '42501';
  end if;

  insert into public.inventory_adjustment_import_batches (
    organization_id,
    operation_id,
    store_id,
    reason_code,
    payload_fingerprint,
    item_count,
    created_by_employee_id
  ) values (
    target_organization_id,
    target_operation_id,
    target_store_id,
    normalized_reason_code,
    payload_fingerprint,
    jsonb_array_length(target_rows),
    actor_id
  ) on conflict (organization_id, operation_id) do nothing
  returning id into batch_id;

  if batch_id is null then
    select batch.* into existing_batch
    from public.inventory_adjustment_import_batches batch
    where batch.organization_id = target_organization_id
      and batch.operation_id = target_operation_id
    for key share;

    if existing_batch.id is null then
      raise exception 'The adjustment import operation could not be recovered.' using errcode = 'P0002';
    end if;
    if existing_batch.store_id <> target_store_id
      or existing_batch.reason_code <> normalized_reason_code
      or existing_batch.item_count <> jsonb_array_length(target_rows)
      or existing_batch.payload_fingerprint <> payload_fingerprint then
      raise exception 'This adjustment import operation identity was already used for different details.' using errcode = '23505';
    end if;
    return existing_batch.item_count;
  end if;

  for import_row in
    select value from jsonb_array_elements(target_rows)
  loop
    row_quantity := (import_row.value ->> 'quantity_delta')::numeric;
    row_note := btrim(import_row.value ->> 'note');
    perform private.post_inventory_adjustment(
      target_organization_id,
      target_store_id,
      (import_row.value ->> 'product_id')::uuid,
      nullif(import_row.value ->> 'variant_id', '')::uuid,
      row_quantity,
      normalized_reason_code,
      row_note,
      gen_random_uuid(),
      actor_id,
      batch_id
    );
  end loop;

  perform private.write_audit_log(
    target_organization_id,
    'INVENTORY_ADJUSTMENTS_IMPORTED',
    'inventory.adjust',
    actor_id,
    null,
    target_store_id,
    null,
    null,
    null,
    'CSV inventory adjustment import',
    jsonb_build_object(
      'batch_id', batch_id,
      'operation_id', target_operation_id,
      'row_count', jsonb_array_length(target_rows),
      'reason_code', normalized_reason_code
    )
  );

  return jsonb_array_length(target_rows);
end;
$_$;

CREATE OR REPLACE FUNCTION "private"."import_suppliers_csv"("target_organization_id" "uuid", "target_rows" "jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  import_row record;
  row_json jsonb;
  row_number integer;
  row_name text;
  actor_employee_id uuid;
  seen_names text[] := '{}';
  imported_count integer := 0;
begin
  if (select private.current_profile_id()) is null
    or (not (select private.has_permission(target_organization_id, 'inventory.manage')) and not (select private.has_inventory_capability(target_organization_id, 'purchasing.suppliers.manage'))) then
    raise exception 'Inventory management permission is required.' using errcode = '42501';
  end if;
  if jsonb_typeof(target_rows) <> 'array' or jsonb_array_length(target_rows) not between 1 and 500 then
    raise exception 'Import between 1 and 500 supplier rows at a time.' using errcode = '22023';
  end if;
  select employee.id into actor_employee_id from public.employees employee where employee.organization_id = target_organization_id and employee.profile_id = (select private.current_profile_id()) and employee.status = 'active' limit 1;

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
$_$;

CREATE OR REPLACE FUNCTION "private"."inventory_organization_actor"("target_organization_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select employee.id
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select private.current_profile_id())
    and employee.status = 'active'
  limit 1;
$$;

CREATE OR REPLACE FUNCTION "private"."open_register_shift"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_opening_cash_minor" bigint, "target_opening_note" "text") RETURNS TABLE("shift_id" "uuid", "opened_at" timestamp with time zone, "was_replayed" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_employee_id uuid;
  existing_shift public.shifts%rowtype;
  normalized_opening_note text;
begin
  if target_organization_id is null
    or target_store_id is null
    or target_register_id is null
    or target_opening_cash_minor is null
    or target_opening_cash_minor < 0 then
    raise exception 'A store, register, and non-negative opening cash amount are required.'
      using errcode = '23514';
  end if;

  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'shifts.open')) then
    raise exception 'Shift opening permission is required.' using errcode = '42501';
  end if;

  normalized_opening_note := nullif(trim(coalesce(target_opening_note, '')), '');
  if normalized_opening_note is not null
    and char_length(normalized_opening_note) not between 2 and 500 then
    raise exception 'An opening note must contain between 2 and 500 characters.'
      using errcode = '23514';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  join public.employee_stores employee_store
    on employee_store.employee_id = employee.id
   and employee_store.organization_id = employee.organization_id
   and employee_store.store_id = target_store_id
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select private.current_profile_id())
    and employee.status = 'active'
  for update of employee;

  if actor_employee_id is null then
    raise exception 'An active employee assignment for this store is required.'
      using errcode = '42501';
  end if;

  perform 1
  from public.registers register
  join public.stores store
    on store.id = register.store_id
   and store.organization_id = register.organization_id
  where register.id = target_register_id
    and register.organization_id = target_organization_id
    and register.store_id = target_store_id
    and register.is_active
    and store.is_active
  for update of register;

  if not found then
    raise exception 'Select an active register belonging to this store.' using errcode = '23514';
  end if;

  select shift.*
  into existing_shift
  from public.shifts shift
  where shift.organization_id = target_organization_id
    and shift.register_id = target_register_id
    and shift.status = 'open'
  for update;

  if existing_shift.id is not null then
    if existing_shift.opened_by_employee_id = actor_employee_id
      and existing_shift.opening_cash_minor = target_opening_cash_minor
      and existing_shift.opening_note is not distinct from normalized_opening_note then
      return query select existing_shift.id, existing_shift.opened_at, true;
      return;
    end if;

    raise exception 'This register already has an open shift.' using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.shifts shift
    where shift.organization_id = target_organization_id
      and shift.opened_by_employee_id = actor_employee_id
      and shift.status = 'open'
  ) then
    raise exception 'Close your existing register shift before opening another one.'
      using errcode = '23505';
  end if;

  return query
  insert into public.shifts as inserted_shift (
    organization_id,
    store_id,
    register_id,
    opened_by_employee_id,
    opening_cash_minor,
    opening_note
  )
  values (
    target_organization_id,
    target_store_id,
    target_register_id,
    actor_employee_id,
    target_opening_cash_minor,
    normalized_opening_note
  )
  returning inserted_shift.id, inserted_shift.opened_at, false;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."provision_customer_display_session"("target_organization_id" "uuid", "target_register_id" "uuid", "target_access_token_hash" "text", "target_realtime_topic" "text") RETURNS TABLE("session_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  resolved_store_id uuid;
  actor_employee_id uuid;
  new_session_id uuid;
begin
  if (select private.current_profile_id()) is null
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
    and employee.profile_id = (select private.current_profile_id())
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
$_$;

CREATE OR REPLACE FUNCTION "private"."receive_inventory_transfer"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid", "target_lines" "jsonb", "target_note" "text", "target_operation_id" "uuid", "allow_legacy_in_transit" boolean) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare transfer public.stock_transfers%rowtype;
begin
  select * into transfer from public.stock_transfers where organization_id = target_organization_id and id = target_stock_transfer_id;
  if transfer.id is null then raise exception 'Choose a canonical direct transfer in this organization.' using errcode = '23514'; end if;
  if transfer.stock_request_id is not null then raise exception 'Receive replenishment transfers from the stock request workflow so shortages stay traceable.' using errcode = '23514'; end if;
  if (select private.current_profile_id()) is null or not (select private.has_inventory_capability(target_organization_id, 'inventory.transfer.receive')) then
    raise exception 'Transfer receive permission is required.' using errcode = '42501';
  end if;
  return private.receive_inventory_transfer_core(target_organization_id, target_stock_transfer_id, target_lines, target_note, target_operation_id, false);
end;
$$;

CREATE OR REPLACE FUNCTION "private"."receive_purchase_order"("target_organization_id" "uuid", "target_purchase_order_id" "uuid", "target_lines" "jsonb", "target_note" "text", "target_operation_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  purchase public.purchase_orders%rowtype;
  existing_receipt public.goods_receipts%rowtype;
  actor_id uuid;
  receipt_id uuid;
  receipt_number bigint;
  line jsonb;
  po_line public.purchase_order_lines%rowtype;
  quantity_received numeric(14,3);
  base_quantity_received numeric(14,6);
  total_remaining numeric(14,3);
  normalized_note text;
  requested_lines jsonb;
  persisted_lines jsonb;
begin
  if (select private.current_profile_id()) is null
     or (not (select private.has_permission(target_organization_id, 'inventory.manage')) and not (select private.has_inventory_capability(target_organization_id, 'purchasing.receive'))) then
    raise exception 'Inventory permission is required.' using errcode = '42501';
  end if;

  if target_operation_id is null then
    raise exception 'A stable goods-receipt operation ID is required.' using errcode = '23514';
  end if;

  if target_lines is null
     or jsonb_typeof(target_lines) <> 'array'
     or jsonb_array_length(target_lines) not between 1 and 100 then
    raise exception 'A receipt needs one to 100 items.' using errcode = '23514';
  end if;

  for line in select value from jsonb_array_elements(target_lines)
  loop
    if coalesce(line ->> 'purchase_order_line_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce(line ->> 'quantity', '') !~ '^\d+(\.\d{1,3})?$'
       or (line ->> 'quantity')::numeric <= 0 then
      raise exception 'Receipt quantities must be positive.' using errcode = '23514';
    end if;
  end loop;

  if exists (
    select 1
    from (
      select lower(btrim(value ->> 'purchase_order_line_id')) as purchase_order_line_id, count(*) as line_count
      from jsonb_array_elements(target_lines)
      group by 1
    ) duplicate_line
    where duplicate_line.line_count > 1
  ) then
    raise exception 'Each order line can be received once per receipt.' using errcode = '23514';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'purchase_order_line_id', normalized.purchase_order_line_id,
        'quantity', normalized.quantity
      )
      order by normalized.purchase_order_line_id
    ),
    '[]'::jsonb
  )
  into requested_lines
  from (
    select
      lower(btrim(value ->> 'purchase_order_line_id')) as purchase_order_line_id,
      ((value ->> 'quantity')::numeric(14,3))::text as quantity
    from jsonb_array_elements(target_lines)
  ) normalized;

  normalized_note := nullif(btrim(target_note), '');

  select *
  into existing_receipt
  from public.goods_receipts goods_receipt
  where goods_receipt.organization_id = target_organization_id
    and goods_receipt.operation_id = target_operation_id
  for update;

  if found then
    select *
    into purchase
    from public.purchase_orders purchase_order
    where purchase_order.id = target_purchase_order_id
      and purchase_order.organization_id = target_organization_id
    for update;

    actor_id := private.inventory_actor(target_organization_id, purchase.store_id);
    if purchase.id is not null
       and actor_id is not null then
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'purchase_order_line_id', receipt_line.purchase_order_line_id::text,
            'quantity', receipt_line.quantity_received::text
          )
          order by receipt_line.purchase_order_line_id::text
        ),
        '[]'::jsonb
      )
      into persisted_lines
      from public.goods_receipt_lines receipt_line
      where receipt_line.organization_id = target_organization_id
        and receipt_line.goods_receipt_id = existing_receipt.id;

      if existing_receipt.purchase_order_id = target_purchase_order_id
         and existing_receipt.store_id = purchase.store_id
         and existing_receipt.received_by_employee_id = actor_id
         and existing_receipt.note is not distinct from normalized_note
         and persisted_lines = requested_lines then
        return existing_receipt.id;
      end if;
    end if;

    raise exception 'This operation ID is already assigned to a different goods receipt request.' using errcode = '23505';
  end if;

  select *
  into purchase
  from public.purchase_orders purchase_order
  where purchase_order.id = target_purchase_order_id
    and purchase_order.organization_id = target_organization_id
    and purchase_order.status in ('ordered', 'partially_received')
  for update;

  if purchase.id is null then
    raise exception 'This purchase order cannot be received.' using errcode = '23514';
  end if;

  actor_id := private.inventory_actor(target_organization_id, purchase.store_id);
  if actor_id is null then
    raise exception 'An assigned employee is required for this store.' using errcode = '42501';
  end if;

  receipt_number := nextval('private.tindio_goods_receipt_number_sequence'::regclass);
  insert into public.goods_receipts (
    organization_id,
    purchase_order_id,
    store_id,
    received_by_employee_id,
    note,
    receipt_number,
    operation_id
  )
  values (
    target_organization_id,
    purchase.id,
    purchase.store_id,
    actor_id,
    normalized_note,
    receipt_number,
    target_operation_id
  )
  returning id into receipt_id;

  for line in select value from jsonb_array_elements(target_lines)
  loop
    select *
    into po_line
    from public.purchase_order_lines purchase_line
    where purchase_line.id = (line ->> 'purchase_order_line_id')::uuid
      and purchase_line.purchase_order_id = purchase.id
      and purchase_line.organization_id = target_organization_id
    for update;

    if po_line.id is null then
      raise exception 'A receipt line does not belong to this purchase order.' using errcode = '23514';
    end if;

    quantity_received := (line ->> 'quantity')::numeric(14,3);
    if po_line.received_quantity + quantity_received > po_line.ordered_quantity then
      raise exception 'Received quantity cannot exceed the ordered quantity.' using errcode = '23514';
    end if;

    base_quantity_received := quantity_received * po_line.purchase_unit_factor_to_base;
    if base_quantity_received <> round(base_quantity_received, 3) then
      raise exception 'This received quantity cannot be expressed in the product base unit to three decimal places.' using errcode = '23514';
    end if;

    insert into public.goods_receipt_lines (
      organization_id,
      goods_receipt_id,
      purchase_order_line_id,
      quantity_received
    )
    values (
      target_organization_id,
      receipt_id,
      po_line.id,
      quantity_received
    );

    update public.purchase_order_lines
    set received_quantity = received_quantity + quantity_received
    where id = po_line.id;

    perform private.apply_inventory_change_v2(
      target_organization_id,
      purchase.store_id,
      po_line.product_id,
      po_line.variant_id,
      round(base_quantity_received, 3),
      'RECEIPT',
      actor_id,
      format('Goods receipt GR-%s', lpad(receipt_number::text, 6, '0')),
      'goods_receipt',
      receipt_id,
      round(po_line.unit_cost_minor::numeric / po_line.purchase_unit_factor_to_base)::bigint
    );
  end loop;

  select coalesce(sum(ordered_quantity - received_quantity), 0)
  into total_remaining
  from public.purchase_order_lines purchase_line
  where purchase_line.purchase_order_id = purchase.id;

  update public.purchase_orders
  set
    status = case when total_remaining = 0 then 'received' else 'partially_received' end,
    received_at = now(),
    received_by_employee_id = actor_id
  where id = purchase.id;

  perform private.write_audit_log(
    target_organization_id,
    'PURCHASE_ORDER_RECEIVED',
    'inventory.manage',
    actor_id,
    null,
    purchase.store_id,
    null,
    null,
    null,
    normalized_note,
    jsonb_build_object(
      'purchase_order_id', purchase.id,
      'goods_receipt_id', receipt_id,
      'goods_receipt_number', receipt_number,
      'operation_id', target_operation_id
    )
  );

  return receipt_id;
end;
$_$;

CREATE OR REPLACE FUNCTION "private"."receive_stock_request"("target_organization_id" "uuid", "target_stock_request_id" "uuid", "target_lines" "jsonb", "target_note" "text", "target_operation_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  request_row public.stock_requests%rowtype; transfer_row public.stock_transfers%rowtype;
  existing_receipt public.stock_transfer_receipts%rowtype; transfer_line public.stock_transfer_lines%rowtype;
  request_line public.stock_request_lines%rowtype; actor_id uuid; receipt_id uuid; line jsonb;
  received_now numeric(14,3); short_now numeric(14,3); total_remaining numeric(14,3); has_shortage boolean;
  normalized_note text := nullif(btrim(target_note), ''); normalized_lines jsonb;
begin
  if (select private.current_profile_id()) is null or not (select private.has_inventory_capability(target_organization_id, 'inventory.transfer.receive')) then
    raise exception 'Transfer receive permission is required.' using errcode = '42501';
  end if;
  if target_operation_id is null then raise exception 'A stable transfer-receipt operation ID is required.' using errcode = '23514'; end if;
  normalized_lines := private.normalize_inventory_transfer_receipt_lines(target_lines);
  select * into request_row from public.stock_requests item
   where item.id = target_stock_request_id and item.organization_id = target_organization_id for update;
  if request_row.id is null then raise exception 'Choose a stock request in this organization.' using errcode = '23514'; end if;
  actor_id := private.inventory_actor(target_organization_id, request_row.requesting_store_id);
  if actor_id is null then raise exception 'An assigned employee is required for the requesting store.' using errcode = '42501'; end if;
  select * into transfer_row from public.stock_transfers transfer
   where transfer.organization_id = target_organization_id and transfer.stock_request_id = request_row.id for update;
  if transfer_row.id is null then raise exception 'The dispatched stock transfer is unavailable.' using errcode = '23514'; end if;
  select * into existing_receipt from public.stock_transfer_receipts receipt
   where receipt.organization_id = target_organization_id and receipt.operation_id = target_operation_id for update;
  if found then
    if existing_receipt.stock_transfer_id = transfer_row.id and existing_receipt.destination_store_id = request_row.requesting_store_id
      and existing_receipt.received_by_employee_id = actor_id and existing_receipt.note is not distinct from normalized_note
      and existing_receipt.operation_payload = normalized_lines then return request_row.id; end if;
    raise exception 'This operation ID is already assigned to a different transfer receipt.' using errcode = '23505';
  end if;
  if request_row.status not in ('dispatched', 'partially_received') or transfer_row.status not in ('dispatched', 'partially_received') then
    raise exception 'This request is not available for receiving.' using errcode = '23514';
  end if;
  receipt_id := private.receive_inventory_transfer_core(target_organization_id, transfer_row.id, target_lines, target_note, target_operation_id, true);
  for line in select value from jsonb_array_elements(target_lines)
  loop
    select * into transfer_line from public.stock_transfer_lines item where item.id = (line ->> 'stock_transfer_line_id')::uuid
      and item.stock_transfer_id = transfer_row.id and item.organization_id = target_organization_id and item.stock_request_line_id is not null;
    select * into request_line from public.stock_request_lines item where item.id = transfer_line.stock_request_line_id
      and item.stock_request_id = request_row.id and item.organization_id = target_organization_id for update;
    received_now := (line ->> 'received_quantity')::numeric(14,3); short_now := (line ->> 'short_quantity')::numeric(14,3);
    update public.stock_request_lines set received_quantity = received_quantity + received_now,
      short_quantity = short_quantity + short_now where id = request_line.id;
    if short_now > 0 then
      if char_length(btrim(coalesce(line ->> 'discrepancy_note', ''))) not between 2 and 500 then raise exception 'A shortage requires a discrepancy note.' using errcode = '23514'; end if;
      insert into public.stock_request_discrepancies (organization_id, stock_request_id, stock_request_line_id,
        stock_transfer_line_id, short_quantity, note, reported_by_employee_id)
      values (target_organization_id, request_row.id, request_line.id, transfer_line.id, short_now,
        btrim(line ->> 'discrepancy_note'), actor_id);
    end if;
  end loop;
  select coalesce(sum(quantity - received_quantity - short_quantity), 0) into total_remaining
    from public.stock_transfer_lines where stock_transfer_id = transfer_row.id;
  select exists(select 1 from public.stock_transfer_lines where stock_transfer_id = transfer_row.id and short_quantity > 0) into has_shortage;
  update public.stock_requests set status = case when total_remaining > 0 then 'partially_received'
      when has_shortage then 'received_with_discrepancy' else 'received' end,
    received_by_employee_id = actor_id, received_at = case when total_remaining = 0 then now() else received_at end
   where id = request_row.id;
  perform private.write_audit_log(target_organization_id,
    case when total_remaining = 0 then 'STOCK_REQUEST_RECEIVED' else 'STOCK_REQUEST_PARTIALLY_RECEIVED' end,
    'inventory.transfer.receive', actor_id, null, request_row.requesting_store_id, null, null, null, normalized_note,
    jsonb_build_object('stock_request_id', request_row.id, 'request_number', request_row.request_number,
      'stock_transfer_id', transfer_row.id, 'receipt_id', receipt_id, 'remaining_quantity', total_remaining,
      'has_discrepancy', has_shortage));
  return request_row.id;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."record_cash_movement"("target_organization_id" "uuid", "target_shift_id" "uuid", "target_movement_type" "text", "target_amount_minor" bigint, "target_reason" "text", "target_idempotency_key" "uuid") RETURNS TABLE("cash_movement_id" "uuid", "created_at" timestamp with time zone, "was_replayed" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_employee_id uuid;
  target_shift public.shifts%rowtype;
  existing_movement public.cash_movements%rowtype;
  normalized_reason text;
  required_permission text;
begin
  if target_organization_id is null
    or target_shift_id is null
    or target_idempotency_key is null
    or target_amount_minor is null
    or target_amount_minor <= 0 then
    raise exception 'An open shift, positive amount, and cash movement key are required.'
      using errcode = '23514';
  end if;

  if target_movement_type is null
    or target_movement_type not in ('PAY_IN', 'PAY_OUT') then
    raise exception 'Select either a cash pay-in or pay-out.' using errcode = '23514';
  end if;

  required_permission := case target_movement_type
    when 'PAY_IN' then 'cash.pay_in'
    else 'cash.pay_out'
  end;

  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, required_permission)) then
    raise exception 'Cash movement permission is required.' using errcode = '42501';
  end if;

  normalized_reason := trim(coalesce(target_reason, ''));
  if char_length(normalized_reason) not between 2 and 500 then
    raise exception 'A cash movement reason must contain between 2 and 500 characters.'
      using errcode = '23514';
  end if;

  select shift.*
  into target_shift
  from public.shifts shift
  where shift.id = target_shift_id
    and shift.organization_id = target_organization_id
    and shift.status = 'open'
  for update;

  if target_shift.id is null then
    raise exception 'The open shift was not found.' using errcode = 'P0002';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  join public.employee_stores employee_store
    on employee_store.employee_id = employee.id
   and employee_store.organization_id = employee.organization_id
   and employee_store.store_id = target_shift.store_id
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select private.current_profile_id())
    and employee.status = 'active';

  if actor_employee_id is null then
    raise exception 'An active employee assignment for this shift store is required.'
      using errcode = '42501';
  end if;

  if target_shift.opened_by_employee_id is distinct from actor_employee_id then
    raise exception 'Only the employee who opened this shift can record cash movements.'
      using errcode = '42501';
  end if;

  select movement.*
  into existing_movement
  from public.cash_movements movement
  where movement.organization_id = target_organization_id
    and movement.idempotency_key = target_idempotency_key
  for update;

  if existing_movement.id is not null then
    if existing_movement.shift_id is distinct from target_shift_id
      or existing_movement.employee_id is distinct from actor_employee_id
      or existing_movement.movement_type is distinct from target_movement_type
      or existing_movement.amount_minor is distinct from target_amount_minor
      or existing_movement.reason is distinct from normalized_reason then
      raise exception 'This cash movement key was already used for a different request.'
        using errcode = '23505';
    end if;

    return query select existing_movement.id, existing_movement.created_at, true;
    return;
  end if;

  return query
  insert into public.cash_movements as inserted_movement (
    organization_id,
    shift_id,
    store_id,
    register_id,
    employee_id,
    movement_type,
    amount_minor,
    reason,
    idempotency_key
  )
  values (
    target_organization_id,
    target_shift.id,
    target_shift.store_id,
    target_shift.register_id,
    actor_employee_id,
    target_movement_type,
    target_amount_minor,
    normalized_reason,
    target_idempotency_key
  )
  returning inserted_movement.id, inserted_movement.created_at, false;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."record_inventory_adjustment"("target_organization_id" "uuid", "target_store_id" "uuid", "target_product_id" "uuid", "target_variant_id" "uuid", "target_quantity_delta" numeric, "target_reason_code" "text", "target_note" "text", "target_operation_id" "uuid", "target_approval_request_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_id uuid;
  selected_reason public.inventory_adjustment_reasons%rowtype;
  resolved_note text;
  expected_payload jsonb;
begin
  if (select private.current_profile_id()) is null then
    raise exception 'Inventory adjustment permission is required.' using errcode = '42501';
  end if;

  resolved_note := nullif(btrim(coalesce(target_note, '')), '');
  if char_length(coalesce(resolved_note, '')) not between 2 and 500 then
    raise exception 'Provide an adjustment explanation between 2 and 500 characters.' using errcode = '23514';
  end if;

  select reason.* into selected_reason
  from public.inventory_adjustment_reasons reason
  where reason.organization_id = target_organization_id
    and reason.code = upper(btrim(coalesce(target_reason_code, '')))
    and reason.is_active;
  if selected_reason.id is null then
    raise exception 'Choose an active adjustment reason.' using errcode = '23514';
  end if;

  expected_payload := jsonb_build_object(
    'store_id', target_store_id,
    'product_id', target_product_id,
    'variant_id', target_variant_id,
    'quantity_delta', target_quantity_delta,
    'reason_code', selected_reason.code,
    'movement_type', selected_reason.movement_type,
    'note', resolved_note
  );

  perform private.authorize_sensitive_operation(
    target_organization_id,
    'inventory.adjust',
    target_approval_request_id,
    expected_payload,
    target_operation_id
  );

  actor_id := private.inventory_actor(target_organization_id, target_store_id);
  if actor_id is null then
    raise exception 'An assigned employee is required for this store.' using errcode = '42501';
  end if;

  return private.post_inventory_adjustment(
    target_organization_id,
    target_store_id,
    target_product_id,
    target_variant_id,
    target_quantity_delta,
    target_reason_code,
    resolved_note,
    target_operation_id,
    actor_id
  );
end;
$$;

CREATE OR REPLACE FUNCTION "private"."record_inventory_adjustment_v2"("target_organization_id" "uuid", "target_store_id" "uuid", "target_product_id" "uuid", "target_variant_id" "uuid", "target_quantity_delta" numeric, "target_reason_code" "text", "target_note" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_id uuid;
  selected_reason public.inventory_adjustment_reasons%rowtype;
  adjustment_id uuid;
  created_adjustment_number bigint;
  movement_id uuid;
  resolved_note text;
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'inventory.manage')) then
    raise exception 'Inventory permission is required.' using errcode = '42501';
  end if;
  if target_quantity_delta = 0 then
    raise exception 'Adjustment quantity must not be zero.' using errcode = '23514';
  end if;

  actor_id := private.inventory_actor(target_organization_id, target_store_id);
  if actor_id is null then
    raise exception 'An assigned employee is required for this store.' using errcode = '42501';
  end if;

  select reason.* into selected_reason
  from public.inventory_adjustment_reasons reason
  where reason.organization_id = target_organization_id
    and reason.code = upper(btrim(coalesce(target_reason_code, '')))
    and reason.is_active;
  if selected_reason.id is null then
    raise exception 'Choose an active adjustment reason.' using errcode = '23514';
  end if;

  resolved_note := coalesce(nullif(btrim(target_note), ''), selected_reason.name);
  insert into public.inventory_adjustments (
    organization_id, store_id, product_id, variant_id, quantity_delta,
    reason_code, note, created_by_employee_id
  ) values (
    target_organization_id, target_store_id, target_product_id, target_variant_id,
    target_quantity_delta, selected_reason.code, resolved_note, actor_id
  ) returning id, adjustment_number into adjustment_id, created_adjustment_number;

  perform private.apply_inventory_change_v2(
    target_organization_id, target_store_id, target_product_id, target_variant_id,
    target_quantity_delta, selected_reason.movement_type, actor_id, resolved_note,
    'inventory_adjustment', adjustment_id, null, selected_reason.code
  );

  select movement.id into movement_id
  from public.inventory_movements movement
  where movement.organization_id = target_organization_id
    and movement.source_type = 'inventory_adjustment'
    and movement.source_id = adjustment_id;

  perform private.write_audit_log(
    target_organization_id, 'INVENTORY_ADJUSTED', 'inventory.adjust', actor_id,
    null, target_store_id, null, null, null, resolved_note,
    jsonb_build_object(
      'adjustment_id', adjustment_id,
      'adjustment_number', created_adjustment_number,
      'reason_code', selected_reason.code,
      'quantity_delta', target_quantity_delta
    )
  );
  return movement_id;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."refund_sale"("target_organization_id" "uuid", "target_sale_id" "uuid", "target_payment_method_id" "uuid", "target_idempotency_key" "uuid", "target_reason" "text", "target_reference_number" "text", "target_items" "jsonb") RETURNS TABLE("refund_id" "uuid", "refund_number" bigint, "total_minor" bigint, "was_replayed" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_employee_id uuid;
  existing_actor_employee_id uuid;
  existing_payload jsonb;
  existing_refund_id uuid;
  original_sale public.sales%rowtype;
  original_item public.sale_items%rowtype;
  refund_item_value jsonb;
  selected_sale_item_id uuid;
  selected_quantity integer;
  selected_return_to_stock boolean;
  already_refunded_quantity integer;
  calculated_total_minor bigint := 0;
  new_refund_id uuid;
  new_refund_number bigint;
  current_quantity numeric(14, 3);
  next_quantity numeric(14, 3);
  payment_method_record public.payment_methods%rowtype;
  canonical_payload jsonb;
  normalized_reason text;
  normalized_reference_number text;
  seen_sale_item_ids uuid[] := array[]::uuid[];
begin
  if target_organization_id is null
    or target_sale_id is null
    or target_idempotency_key is null then
    raise exception 'A sale and refund key are required.' using errcode = '23514';
  end if;

  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'sales.refund')) then
    raise exception 'Sales refund permission is required.' using errcode = '42501';
  end if;

  normalized_reason := trim(coalesce(target_reason, ''));
  normalized_reference_number := nullif(trim(coalesce(target_reference_number, '')), '');

  if char_length(normalized_reason) not between 2 and 500 then
    raise exception 'A refund reason must contain between 2 and 500 characters.'
      using errcode = '23514';
  end if;

  if normalized_reference_number is not null
    and char_length(normalized_reference_number) not between 1 and 120 then
    raise exception 'A refund reference must contain at most 120 characters.'
      using errcode = '23514';
  end if;

  if coalesce(jsonb_typeof(target_items), '') <> 'array'
    or coalesce(jsonb_array_length(target_items), 0) not between 1 and 100 then
    raise exception 'Select between 1 and 100 sale items to refund.' using errcode = '23514';
  end if;

  -- A missing return_to_stock flag retains the established behavior (restore
  -- tracked stock). When supplied, it must be a JSON boolean: strings such as
  -- "true", numeric values, and JSON null are rejected instead of coerced.
  if exists (
    select 1
    from jsonb_array_elements(target_items) as item(value)
    where jsonb_typeof(item.value) <> 'object'
      or (
        item.value ? 'return_to_stock'
        and jsonb_typeof(item.value -> 'return_to_stock') <> 'boolean'
      )
  ) then
    raise exception 'Each refund line must provide return_to_stock as a boolean when supplied.'
      using errcode = '23514';
  end if;

  select sale.*
  into original_sale
  from public.sales sale
  where sale.id = target_sale_id
    and sale.organization_id = target_organization_id
    and sale.status = 'completed'
  for update;

  if original_sale.id is null then
    raise exception 'The completed sale was not found.' using errcode = 'P0002';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  join public.employee_stores employee_store
    on employee_store.employee_id = employee.id
   and employee_store.organization_id = employee.organization_id
   and employee_store.store_id = original_sale.store_id
  join public.stores store
    on store.id = original_sale.store_id
   and store.organization_id = original_sale.organization_id
   and store.is_active
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select private.current_profile_id())
    and employee.status = 'active';

  if actor_employee_id is null then
    raise exception 'An active employee assignment for the original sale store is required.'
      using errcode = '42501';
  end if;

  canonical_payload := jsonb_build_object(
    'items', target_items,
    'payment_method_id', target_payment_method_id,
    'reason', normalized_reason,
    'reference_number', normalized_reference_number,
    'sale_id', target_sale_id
  );

  select
    request.actor_employee_id,
    request.request_payload,
    request.refund_id
  into
    existing_actor_employee_id,
    existing_payload,
    existing_refund_id
  from public.refund_requests request
  where request.organization_id = target_organization_id
    and request.idempotency_key = target_idempotency_key
  for update;

  if found then
    if existing_actor_employee_id is distinct from actor_employee_id
      or existing_payload is distinct from canonical_payload then
      raise exception 'This refund key was already used for a different request.'
        using errcode = '23505';
    end if;

    if existing_refund_id is null then
      raise exception 'The prior refund request did not complete. Try again with a new key.'
        using errcode = '40001';
    end if;

    return query
    select refund.id, refund.refund_number, refund.total_minor, true
    from public.refunds refund
    where refund.id = existing_refund_id
      and refund.organization_id = target_organization_id;
    return;
  end if;

  -- Lock stock projections in a stable order before the line loop. This keeps
  -- independent refunds from acquiring inventory locks in conflicting orders.
  perform 1
  from public.inventory_levels level
  join public.sale_items sale_item
    on sale_item.organization_id = level.organization_id
   and sale_item.product_id = level.product_id
   and sale_item.variant_id is not distinct from level.variant_id
  where level.organization_id = target_organization_id
    and level.store_id = original_sale.store_id
    and sale_item.sale_id = target_sale_id
    and sale_item.id in (
      select (item.value ->> 'sale_item_id')::uuid
      from jsonb_array_elements(target_items) as item(value)
    )
    and exists (
      select 1
      from public.inventory_movements movement
      where movement.organization_id = target_organization_id
        and movement.store_id = original_sale.store_id
        and movement.product_id = sale_item.product_id
        and movement.variant_id is not distinct from sale_item.variant_id
        and movement.movement_type = 'SALE'
        and movement.source_type = 'sale'
        and movement.source_id = target_sale_id
    )
  order by level.product_id, level.variant_id nulls first
  for update;

  insert into public.refund_requests (
    organization_id,
    actor_employee_id,
    idempotency_key,
    request_payload
  )
  values (
    target_organization_id,
    actor_employee_id,
    target_idempotency_key,
    canonical_payload
  );

  new_refund_number := nextval('private.tindio_refund_number_sequence'::regclass);

  insert into public.refunds (
    organization_id,
    sale_id,
    store_id,
    register_id,
    refunded_by_employee_id,
    refund_number,
    currency_code,
    reason
  )
  values (
    target_organization_id,
    target_sale_id,
    original_sale.store_id,
    original_sale.register_id,
    actor_employee_id,
    new_refund_number,
    original_sale.currency_code,
    normalized_reason
  )
  returning id into new_refund_id;

  for refund_item_value in
    select item.value
    from jsonb_array_elements(target_items) as item(value)
    order by item.value ->> 'sale_item_id'
  loop
    begin
      selected_sale_item_id := (refund_item_value ->> 'sale_item_id')::uuid;
      selected_quantity := (refund_item_value ->> 'quantity')::integer;
      selected_return_to_stock := coalesce(
        (refund_item_value ->> 'return_to_stock')::boolean,
        true
      );
    exception
      when others then
        raise exception 'Each refund line needs a valid sale item and whole quantity.'
          using errcode = '23514';
    end;

    if selected_quantity not between 1 and 10000 then
      raise exception 'Refund quantities must be whole numbers between 1 and 10000.'
        using errcode = '23514';
    end if;

    if selected_sale_item_id = any(seen_sale_item_ids) then
      raise exception 'Each sale item can only appear once in a refund.'
        using errcode = '23514';
    end if;
    seen_sale_item_ids := array_append(seen_sale_item_ids, selected_sale_item_id);

    select sale_item.*
    into original_item
    from public.sale_items sale_item
    where sale_item.id = selected_sale_item_id
      and sale_item.organization_id = target_organization_id
      and sale_item.sale_id = target_sale_id
    for update;

    if original_item.id is null then
      raise exception 'One or more selected items do not belong to this sale.'
        using errcode = '23514';
    end if;

    select coalesce(sum(refund_item.quantity), 0)::integer
    into already_refunded_quantity
    from public.refund_items refund_item
    join public.refunds prior_refund
      on prior_refund.id = refund_item.refund_id
     and prior_refund.organization_id = refund_item.organization_id
    where refund_item.organization_id = target_organization_id
      and refund_item.sale_item_id = original_item.id
      and prior_refund.sale_id = target_sale_id
      and prior_refund.status = 'completed';

    if already_refunded_quantity + selected_quantity > original_item.quantity then
      raise exception 'This refund exceeds the quantity remaining on the original sale.'
        using errcode = '23514';
    end if;

    insert into public.refund_items (
      organization_id,
      refund_id,
      sale_item_id,
      product_id,
      variant_id,
      product_name_snapshot,
      variant_name_snapshot,
      sku_snapshot,
      unit_snapshot,
      quantity,
      unit_price_minor,
      line_total_minor,
      returned_to_stock
    )
    values (
      target_organization_id,
      new_refund_id,
      original_item.id,
      original_item.product_id,
      original_item.variant_id,
      original_item.product_name_snapshot,
      original_item.variant_name_snapshot,
      original_item.sku_snapshot,
      original_item.unit_snapshot,
      selected_quantity,
      original_item.unit_price_minor,
      original_item.unit_price_minor * selected_quantity,
      selected_return_to_stock
    );

    calculated_total_minor := calculated_total_minor
      + original_item.unit_price_minor * selected_quantity;

    if selected_return_to_stock and exists (
      select 1
      from public.inventory_movements movement
      where movement.organization_id = target_organization_id
        and movement.store_id = original_sale.store_id
        and movement.product_id = original_item.product_id
        and movement.variant_id is not distinct from original_item.variant_id
        and movement.movement_type = 'SALE'
        and movement.source_type = 'sale'
        and movement.source_id = target_sale_id
    ) then
      select level.quantity
      into current_quantity
      from public.inventory_levels level
      where level.organization_id = target_organization_id
        and level.store_id = original_sale.store_id
        and level.product_id = original_item.product_id
        and level.variant_id is not distinct from original_item.variant_id;

      if current_quantity is null then
        raise exception 'The stock projection is unavailable for a tracked sale item.'
          using errcode = '23514';
      end if;

      next_quantity := current_quantity + selected_quantity;

      update public.inventory_levels
      set
        quantity = next_quantity,
        updated_at = now()
      where organization_id = target_organization_id
        and store_id = original_sale.store_id
        and product_id = original_item.product_id
        and variant_id is not distinct from original_item.variant_id;

      insert into public.inventory_movements (
        organization_id,
        store_id,
        product_id,
        variant_id,
        quantity_delta,
        quantity_before,
        quantity_after,
        movement_type,
        actor_employee_id,
        reason,
        source_type,
        source_id
      )
      values (
        target_organization_id,
        original_sale.store_id,
        original_item.product_id,
        original_item.variant_id,
        selected_quantity,
        current_quantity,
        next_quantity,
        'REFUND',
        actor_employee_id,
        normalized_reason,
        'refund',
        new_refund_id
      );
    end if;
  end loop;

  if calculated_total_minor > 0 then
    if target_payment_method_id is null then
      raise exception 'Select the method used to return the payment.' using errcode = '23514';
    end if;

    select payment_method.*
    into payment_method_record
    from public.payment_methods payment_method
    join public.store_payment_methods store_payment_method
      on store_payment_method.organization_id = payment_method.organization_id
     and store_payment_method.payment_method_id = payment_method.id
     and store_payment_method.store_id = original_sale.store_id
     and store_payment_method.is_enabled
    where payment_method.organization_id = target_organization_id
      and payment_method.id = target_payment_method_id
      and payment_method.is_enabled;

    if payment_method_record.id is null then
      raise exception 'Select an enabled payment method for the original sale store.'
        using errcode = '23514';
    end if;

    if payment_method_record.requires_reference and normalized_reference_number is null then
      raise exception 'A reference is required for this refund payment method.'
        using errcode = '23514';
    end if;

    insert into public.refund_payments (
      organization_id,
      refund_id,
      payment_method_id,
      payment_method_name_snapshot,
      payment_method_code_snapshot,
      payment_method_type_snapshot,
      amount_minor,
      reference_number
    )
    values (
      target_organization_id,
      new_refund_id,
      payment_method_record.id,
      payment_method_record.name,
      payment_method_record.code,
      payment_method_record.payment_type,
      calculated_total_minor,
      normalized_reference_number
    );
  end if;

  update public.refunds refund
  set total_minor = calculated_total_minor
  where refund.id = new_refund_id
    and refund.organization_id = target_organization_id;

  update public.refund_requests request
  set
    state = 'completed',
    refund_id = new_refund_id,
    completed_at = now()
  where request.organization_id = target_organization_id
    and request.idempotency_key = target_idempotency_key;

  return query
  select new_refund_id, new_refund_number, calculated_total_minor, false;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."remove_inventory_policy_override"("target_organization_id" "uuid", "target_store_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_id uuid;
  removed_policy text;
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'inventory.manage')) then
    raise exception 'Inventory permission is required.' using errcode = '42501';
  end if;

  actor_id := private.inventory_actor(target_organization_id, target_store_id);
  if actor_id is null then
    raise exception 'You do not have access to manage this store.' using errcode = '42501';
  end if;

  delete from public.inventory_policies policy
  where policy.organization_id = target_organization_id
    and policy.store_id = target_store_id
  returning policy.negative_stock_policy into removed_policy;

  if found then
    perform private.write_audit_log(
      target_organization_id,
      'INVENTORY_POLICY_OVERRIDE_REMOVED',
      'inventory.manage',
      actor_id,
      null,
      target_store_id,
      null,
      null,
      null,
      null,
      jsonb_build_object(
        'previous_negative_stock_policy', removed_policy,
        'scope', 'store_override'
      )
    );
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."request_manager_approval"("target_organization_id" "uuid", "target_operation_code" "text", "target_reason" "text", "target_payload" "jsonb") RETURNS TABLE("decision" "text", "approval_request_id" "uuid", "expires_at" timestamp with time zone, "message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_employee_id uuid;
  required_permission text;
  resolved_store_id uuid;
  resolved_register_id uuid;
  resolved_amount_minor bigint;
  resolved_decision text;
  existing_request public.approval_requests%rowtype;
  normalized_reason text;
begin
  if (select private.current_profile_id()) is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;

  required_permission := private.approval_operation_permission(target_operation_code);
  if required_permission is null then
    raise exception 'This approval operation is not supported.' using errcode = '23514';
  end if;

  actor_employee_id := private.current_employee_id(target_organization_id);
  if actor_employee_id is null then
    raise exception 'An active employee is required.' using errcode = '42501';
  end if;

  if not private.has_permission(target_organization_id, 'approvals.request') then
    raise exception 'Approval-request permission is required.' using errcode = '42501';
  end if;

  if target_operation_code = 'inventory.adjust'
    and not private.has_any_inventory_capability(
      target_organization_id,
      array['inventory.adjust.create', 'inventory.adjust.post']
    ) then
    raise exception 'Inventory adjustment permission is required.' using errcode = '42501';
  end if;

  normalized_reason := trim(coalesce(target_reason, ''));
  if char_length(normalized_reason) not between 2 and 500 then
    raise exception 'Provide a reason between 2 and 500 characters.' using errcode = '23514';
  end if;

  select context.store_id, context.register_id, context.amount_minor
  into resolved_store_id, resolved_register_id, resolved_amount_minor
  from private.resolve_approval_context(
    target_organization_id,
    target_operation_code,
    target_payload
  ) context;

  if not private.has_store_read_scope(target_organization_id, resolved_store_id) then
    raise exception 'You do not have access to the store for this request.' using errcode = '42501';
  end if;

  resolved_decision := private.approval_decision(
    target_organization_id,
    target_operation_code,
    resolved_amount_minor
  );

  if resolved_decision = 'DENIED' and not (
    private.employee_has_permission(target_organization_id, actor_employee_id, 'approvals.bypass')
    and private.employee_has_permission(target_organization_id, actor_employee_id, required_permission)
  ) then
    return query select 'DENIED'::text, null::uuid, null::timestamptz, 'This operation is disabled by the organization approval rule.'::text;
    return;
  end if;

  if resolved_decision = 'ALLOWED'
    and private.employee_has_permission(target_organization_id, actor_employee_id, required_permission) then
    return query select 'ALLOWED'::text, null::uuid, null::timestamptz, 'This operation is allowed for your role.'::text;
    return;
  end if;

  select * into existing_request
  from public.approval_requests request
  where request.organization_id = target_organization_id
    and request.requested_by_employee_id = actor_employee_id
    and request.operation_code = target_operation_code
    and request.request_payload = target_payload
    and request.status = 'PENDING'
    and request.expires_at > now()
  order by request.requested_at desc
  limit 1
  for update;

  if existing_request.id is not null then
    return query select 'APPROVAL_REQUIRED'::text, existing_request.id, existing_request.expires_at, 'Manager approval is pending.'::text;
    return;
  end if;

  insert into public.approval_requests (
    organization_id,
    store_id,
    register_id,
    requested_by_employee_id,
    operation_code,
    requested_amount_minor,
    reason,
    request_payload
  )
  values (
    target_organization_id,
    resolved_store_id,
    resolved_register_id,
    actor_employee_id,
    target_operation_code,
    resolved_amount_minor,
    normalized_reason,
    target_payload
  )
  returning id, public.approval_requests.expires_at into approval_request_id, expires_at;

  perform private.write_audit_log(
    target_organization_id,
    'APPROVAL_REQUESTED',
    target_operation_code,
    actor_employee_id,
    null,
    resolved_store_id,
    resolved_register_id,
    approval_request_id,
    resolved_amount_minor,
    normalized_reason,
    jsonb_build_object('status', 'PENDING')
  );

  decision := 'APPROVAL_REQUIRED';
  message := 'Manager approval is required for this operation.';
  return next;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."require_attendance_terminal"("target_organization_id" "uuid", "target_store_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_employee_id uuid;
begin
  if (select private.current_profile_id()) is null
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

CREATE OR REPLACE FUNCTION "private"."require_employee_manager_target"("target_organization_id" "uuid", "target_employee_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_id uuid;
begin
  if (select private.current_profile_id()) is null
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

CREATE OR REPLACE FUNCTION "private"."require_pos_capabilities"("target_organization_id" "uuid", "required_permission_codes" "text"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  missing_permission_code text;
begin
  if (select private.current_profile_id()) is null then
    raise exception 'An authenticated employee is required.' using errcode = '42501';
  end if;

  select required.permission_code
  into missing_permission_code
  from unnest(coalesce(required_permission_codes, '{}'::text[])) as required(permission_code)
  where not (select private.has_permission(target_organization_id, required.permission_code))
  order by required.permission_code
  limit 1;

  if missing_permission_code is not null then
    raise exception 'The % permission is required.', missing_permission_code using errcode = '42501';
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."return_to_supplier"("target_organization_id" "uuid", "target_store_id" "uuid", "target_supplier_id" "uuid", "target_lines" "jsonb", "target_note" "text", "target_operation_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  actor_id uuid;
  return_id uuid;
  existing_return public.supplier_returns%rowtype;
  line jsonb;
  stock_level public.inventory_levels%rowtype;
  line_quantity numeric(14,3);
  normalized_note text;
  normalized_lines jsonb;
  persisted_lines jsonb;
begin
  if (select private.current_profile_id()) is null
     or (
       not (select private.has_permission(target_organization_id, 'inventory.manage'))
       and not (select private.has_inventory_capability(target_organization_id, 'purchasing.return'))
     ) then
    raise exception 'Supplier-return permission is required.' using errcode = '42501';
  end if;
  if target_operation_id is null then
    raise exception 'An operation ID is required for a supplier return.' using errcode = '23514';
  end if;
  if target_lines is null
     or jsonb_typeof(target_lines) <> 'array'
     or jsonb_array_length(target_lines) not between 1 and 100 then
    raise exception 'A supplier return needs one to 100 items.' using errcode = '23514';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(target_lines) requested(line)
    where coalesce(requested.line->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or (
         nullif(requested.line->>'variant_id', '') is not null
         and requested.line->>'variant_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       )
       or coalesce(requested.line->>'quantity', '') !~ '^\d+(\.\d{1,3})?$'
       or (requested.line->>'quantity')::numeric <= 0
  ) then
    raise exception 'Supplier-return lines must include valid items and quantities.' using errcode = '23514';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'product_id', (requested.line->>'product_id')::uuid,
      'variant_id', nullif(requested.line->>'variant_id', '')::uuid,
      'quantity', (requested.line->>'quantity')::numeric(14,3)
    ) order by
      (requested.line->>'product_id')::uuid,
      nullif(requested.line->>'variant_id', '')::uuid nulls first
  )
  into normalized_lines
  from jsonb_array_elements(target_lines) requested(line);

  if jsonb_array_length(normalized_lines) <> (
    select count(*)
    from (
      select distinct
        requested.line->>'product_id',
        coalesce(requested.line->>'variant_id', '')
      from jsonb_array_elements(target_lines) requested(line)
    ) unique_lines
  ) then
    raise exception 'Each item can appear only once in a supplier return.' using errcode = '23514';
  end if;

  actor_id := private.inventory_actor(target_organization_id, target_store_id);
  if actor_id is null then
    raise exception 'An assigned employee is required for this store.' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.suppliers supplier
    where supplier.id = target_supplier_id
      and supplier.organization_id = target_organization_id
      and supplier.is_active
  ) then
    raise exception 'Choose an active supplier.' using errcode = '23514';
  end if;

  normalized_note := nullif(btrim(target_note), '');
  select supplier_return.* into existing_return
  from public.supplier_returns supplier_return
  where supplier_return.organization_id = target_organization_id
    and supplier_return.operation_id = target_operation_id;

  if found then
    select jsonb_agg(
      jsonb_build_object(
        'product_id', return_line.product_id,
        'variant_id', return_line.variant_id,
        'quantity', return_line.quantity
      ) order by return_line.product_id, return_line.variant_id nulls first
    )
    into persisted_lines
    from public.supplier_return_lines return_line
    where return_line.organization_id = target_organization_id
      and return_line.supplier_return_id = existing_return.id;

    if existing_return.store_id is distinct from target_store_id
       or existing_return.supplier_id is distinct from target_supplier_id
       or existing_return.note is distinct from normalized_note
       or persisted_lines is distinct from normalized_lines then
      raise exception 'This operation ID is already assigned to a different supplier-return payload.' using errcode = '23505';
    end if;
    return existing_return.id;
  end if;

  insert into public.supplier_returns (
    organization_id, supplier_id, store_id, returned_by_employee_id, note, operation_id
  ) values (
    target_organization_id, target_supplier_id, target_store_id, actor_id,
    normalized_note, target_operation_id
  ) returning id into return_id;

  for line in select value from jsonb_array_elements(normalized_lines)
  loop
    line_quantity := (line->>'quantity')::numeric(14,3);
    select level.* into stock_level
    from public.inventory_levels level
    where level.organization_id = target_organization_id
      and level.store_id = target_store_id
      and level.product_id = (line->>'product_id')::uuid
      and level.variant_id is not distinct from nullif(line->>'variant_id', '')::uuid
    for update;

    if stock_level.id is null or stock_level.quantity < line_quantity then
      raise exception 'Stock is insufficient for this supplier return.' using errcode = '23514';
    end if;

    insert into public.supplier_return_lines (
      organization_id, supplier_return_id, product_id, variant_id, quantity, unit_cost_minor
    ) values (
      target_organization_id, return_id, stock_level.product_id, stock_level.variant_id,
      line_quantity, stock_level.average_cost_minor
    );
    perform private.apply_inventory_change_v2(
      target_organization_id, target_store_id, stock_level.product_id, stock_level.variant_id,
      -line_quantity, 'SUPPLIER_RETURN', actor_id, 'Returned to supplier', 'supplier_return',
      return_id, stock_level.average_cost_minor
    );
  end loop;

  perform private.write_audit_log(
    target_organization_id, 'SUPPLIER_RETURN_CREATED', 'purchasing.return', actor_id,
    null, target_store_id, null, null, null, normalized_note,
    jsonb_build_object(
      'supplier_return_id', return_id,
      'supplier_id', target_supplier_id,
      'operation_id', target_operation_id,
      'lines', normalized_lines
    )
  );
  return return_id;
end;
$_$;

CREATE OR REPLACE FUNCTION "private"."save_open_ticket_v2"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_ticket_id" "uuid", "target_customer_id" "uuid", "target_dining_option_id" "uuid", "target_assigned_employee_id" "uuid", "target_label" "text", "target_note" "text", "target_cart" "jsonb") RETURNS TABLE("ticket_id" "uuid", "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_employee_id uuid;
  selected_assignee_id uuid;
  normalized_label text := nullif(btrim(coalesce(target_label, '')), '');
  normalized_note text := nullif(btrim(coalesce(target_note, '')), '');
  normalized_cart jsonb;
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'sales.create')) then
    raise exception 'Sales permission is required.' using errcode = '42501';
  end if;

  if normalized_label is null or char_length(normalized_label) > 100
    or (normalized_note is not null and char_length(normalized_note) > 500) then
    raise exception 'Enter a ticket label up to 100 characters and an optional note up to 500 characters.' using errcode = '23514';
  end if;

  actor_employee_id := private.require_active_pos_shift(
    target_organization_id,
    target_store_id,
    target_register_id
  );
  selected_assignee_id := coalesce(target_assigned_employee_id, actor_employee_id);

  if selected_assignee_id <> actor_employee_id
    and not (select private.has_permission(target_organization_id, 'employees.manage')) then
    raise exception 'Employee management permission is required to reassign tickets.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.employees employee
    join public.employee_stores employee_store
      on employee_store.employee_id = employee.id
     and employee_store.organization_id = employee.organization_id
    where employee.id = selected_assignee_id
      and employee.organization_id = target_organization_id
      and employee_store.store_id = target_store_id
      and employee.status = 'active'
  ) then
    raise exception 'Assign this ticket to an active employee at the selected store.' using errcode = '23514';
  end if;

  perform private.validate_advanced_cart(target_organization_id, target_store_id, target_cart);
  normalized_cart := private.normalize_open_ticket_cart(target_cart);

  if target_customer_id is not null and not exists (
    select 1 from public.customers customer
    where customer.id = target_customer_id
      and customer.organization_id = target_organization_id
      and customer.status = 'active'
  ) then
    raise exception 'The selected customer is not active in this organization.' using errcode = '23514';
  end if;

  if target_dining_option_id is not null and not exists (
    select 1 from public.dining_options option
    where option.id = target_dining_option_id
      and option.organization_id = target_organization_id
      and option.is_active
  ) then
    raise exception 'The selected dining option is not active.' using errcode = '23514';
  end if;

  if target_ticket_id is null then
    return query
    insert into public.open_tickets as open_ticket (
      organization_id, store_id, register_id, opened_by_employee_id,
      assigned_employee_id, customer_id, dining_option_id, label, note, cart
    )
    values (
      target_organization_id, target_store_id, target_register_id, actor_employee_id,
      selected_assignee_id, target_customer_id, target_dining_option_id,
      normalized_label, normalized_note, normalized_cart
    )
    returning open_ticket.id, open_ticket.created_at, open_ticket.updated_at;
    return;
  end if;

  return query
  update public.open_tickets ticket
  set
    customer_id = target_customer_id,
    dining_option_id = target_dining_option_id,
    assigned_employee_id = selected_assignee_id,
    label = normalized_label,
    note = normalized_note,
    cart = normalized_cart
  where ticket.id = target_ticket_id
    and ticket.organization_id = target_organization_id
    and ticket.store_id = target_store_id
    and ticket.register_id = target_register_id
    and ticket.status = 'open'
  returning ticket.id, ticket.created_at, ticket.updated_at;

  if not found then
    raise exception 'This open ticket is no longer available.' using errcode = 'P0002';
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."set_catalog_product_archived_safely"("target_organization_id" "uuid", "target_product_id" "uuid", "target_is_archived" boolean) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_employee_id uuid;
  existing_name text;
  existing_status text;
  next_status text := case when target_is_archived then 'archived' else 'active' end;
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'products.manage')) then
    raise exception 'Product management permission is required.' using errcode = '42501';
  end if;

  actor_employee_id := private.current_employee_id(target_organization_id);

  select product.name, product.status
  into existing_name, existing_status
  from public.products product
  where product.id = target_product_id
    and product.organization_id = target_organization_id
  for update;

  if not found then
    raise exception 'The product could not be found.' using errcode = '23503';
  end if;

  if existing_status = next_status then
    return existing_name;
  end if;

  if target_is_archived and exists (
    select 1
    from public.inventory_levels level
    where level.organization_id = target_organization_id
      and level.product_id = target_product_id
      and level.quantity <> 0
  ) then
    raise exception 'Resolve this product’s stock on hand before archiving it.' using errcode = '55000';
  end if;

  if target_is_archived and exists (
    select 1
    from public.purchase_order_lines line
    join public.purchase_orders purchase_order
      on purchase_order.id = line.purchase_order_id
     and purchase_order.organization_id = line.organization_id
    where line.organization_id = target_organization_id
      and line.product_id = target_product_id
      and purchase_order.status in ('draft', 'ordered', 'partially_received')
  ) then
    raise exception 'Resolve open purchase orders for this product before archiving it.' using errcode = '55000';
  end if;

  if target_is_archived and exists (
    select 1
    from public.inventory_count_lines line
    join public.inventory_counts inventory_count
      on inventory_count.id = line.inventory_count_id
     and inventory_count.organization_id = line.organization_id
    where line.organization_id = target_organization_id
      and line.product_id = target_product_id
      and inventory_count.status in ('draft', 'in_progress', 'ready_for_review', 'open')
  ) then
    raise exception 'Finish or cancel open inventory counts for this product before archiving it.' using errcode = '55000';
  end if;

  if target_is_archived and exists (
    select 1
    from public.stock_request_lines line
    join public.stock_requests request
      on request.id = line.stock_request_id
     and request.organization_id = line.organization_id
    where line.organization_id = target_organization_id
      and line.product_id = target_product_id
      and request.status in ('requested', 'approved', 'picking', 'dispatched', 'partially_received')
  ) then
    raise exception 'Resolve open stock requests for this product before archiving it.' using errcode = '55000';
  end if;

  if target_is_archived and exists (
    select 1
    from public.stock_transfer_lines line
    join public.stock_transfers transfer
      on transfer.id = line.stock_transfer_id
     and transfer.organization_id = line.organization_id
    where line.organization_id = target_organization_id
      and line.product_id = target_product_id
      and transfer.status in ('in_transit', 'partially_received')
  ) then
    raise exception 'Receive or resolve open transfers for this product before archiving it.' using errcode = '55000';
  end if;

  if target_is_archived and exists (
    select 1
    from public.product_components component
    join public.products parent_product
      on parent_product.id = component.product_id
     and parent_product.organization_id = component.organization_id
    where component.organization_id = target_organization_id
      and component.component_product_id = target_product_id
      and parent_product.status = 'active'
  ) then
    raise exception 'Remove this product from active composite recipes before archiving it.' using errcode = '55000';
  end if;

  update public.products
  set status = next_status
  where organization_id = target_organization_id
    and id = target_product_id;

  perform private.write_audit_log(
    target_organization_id,
    case when target_is_archived then 'CATALOG_PRODUCT_ARCHIVED' else 'CATALOG_PRODUCT_RESTORED' end,
    'products.manage',
    actor_employee_id,
    null,
    null,
    null,
    null,
    null,
    null,
    jsonb_build_object('product_id', target_product_id, 'product_name', existing_name)
  );

  return existing_name;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."set_catalog_product_store_availability"("target_organization_id" "uuid", "target_product_id" "uuid", "target_store_ids" "uuid"[]) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  manageable_store_ids uuid[];
  selected_store_ids uuid[];
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'products.manage')) then
    raise exception 'Product management permission is required.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.products product
    where product.id = target_product_id
      and product.organization_id = target_organization_id
  ) then
    raise exception 'The product could not be found.' using errcode = '23503';
  end if;

  -- Organization-wide store managers (including Owner) can manage every
  -- active store. Other product managers are limited to their employee-store
  -- assignments through the same scope predicate used by Back Office reads.
  select coalesce(array_agg(store.id order by store.id), '{}'::uuid[])
  into manageable_store_ids
  from public.stores store
  where store.organization_id = target_organization_id
    and store.is_active
    and (select private.has_store_read_scope(target_organization_id, store.id));

  if cardinality(manageable_store_ids) = 0 then
    raise exception 'No active stores are available for this product.' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct requested.store_id), '{}'::uuid[])
  into selected_store_ids
  from unnest(coalesce(target_store_ids, '{}'::uuid[])) as requested(store_id);

  if exists (
    select 1
    from unnest(selected_store_ids) as selected(store_id)
    where not (selected.store_id = any(manageable_store_ids))
  ) then
    raise exception 'Store access is required to change product availability.' using errcode = '42501';
  end if;

  -- Never delete product_store_settings. A store removed from the selected
  -- list becomes unavailable, retaining its configuration and inventory
  -- history for audit and future reactivation.
  insert into public.product_store_settings (
    organization_id,
    product_id,
    store_id,
    is_available
  )
  select
    target_organization_id,
    target_product_id,
    managed.store_id,
    managed.store_id = any(selected_store_ids)
  from unnest(manageable_store_ids) as managed(store_id)
  on conflict (store_id, product_id) do update
  set is_available = excluded.is_available
  where public.product_store_settings.is_available is distinct from excluded.is_available;

  return cardinality(selected_store_ids);
end;
$$;

CREATE OR REPLACE FUNCTION "private"."set_customer_display_state"("target_organization_id" "uuid", "target_session_id" "uuid", "target_state" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  resolved_store_id uuid;
  resolved_register_id uuid;
  actor_employee_id uuid;
begin
  if (select private.current_profile_id()) is null
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
    and employee.profile_id = (select private.current_profile_id())
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

CREATE OR REPLACE FUNCTION "private"."set_kitchen_order_priority"("target_organization_id" "uuid", "target_kitchen_order_id" "uuid", "target_priority" "text") RETURNS TABLE("priority" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  resolved_store_id uuid;
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'kitchen.manage')) then
    raise exception 'Kitchen order management access is required.' using errcode = '42501';
  end if;

  if target_priority not in ('NORMAL', 'RUSH') then
    raise exception 'Choose a valid kitchen priority.' using errcode = '22023';
  end if;

  select kitchen_order.store_id into resolved_store_id
  from public.kitchen_orders kitchen_order
  where kitchen_order.id = target_kitchen_order_id
    and kitchen_order.organization_id = target_organization_id
  for update;

  if resolved_store_id is null then
    raise exception 'This kitchen order is no longer available.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.employees employee
    join public.employee_stores employee_store
      on employee_store.employee_id = employee.id
     and employee_store.organization_id = employee.organization_id
    where employee.organization_id = target_organization_id
      and employee.profile_id = (select private.current_profile_id())
      and employee.status = 'active'
      and employee_store.store_id = resolved_store_id
  ) then
    raise exception 'You are not assigned to this kitchen order store.' using errcode = '42501';
  end if;

  return query
  update public.kitchen_orders kitchen_order
  set priority = target_priority
  where kitchen_order.id = target_kitchen_order_id
    and kitchen_order.organization_id = target_organization_id
  returning kitchen_order.priority;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."set_kitchen_station_category_route"("target_organization_id" "uuid", "target_category_id" "uuid", "target_station" "text") RETURNS TABLE("category_id" "uuid", "station" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_employee_id uuid;
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'kitchen.manage')) then
    raise exception 'Kitchen order management access is required.' using errcode = '42501';
  end if;

  if target_station not in ('KITCHEN', 'BAR', 'DESSERT') then
    raise exception 'Choose a valid kitchen station.' using errcode = '22023';
  end if;

  select employee.id into actor_employee_id
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select private.current_profile_id())
    and employee.status = 'active';

  if actor_employee_id is null or not exists (
    select 1
    from public.categories category
    where category.id = target_category_id
      and category.organization_id = target_organization_id
      and not category.is_archived
  ) then
    raise exception 'This category is unavailable for kitchen routing.' using errcode = 'P0002';
  end if;

  return query
  insert into public.kitchen_station_category_routes (
    organization_id, category_id, station, updated_by_employee_id
  )
  values (
    target_organization_id, target_category_id, target_station, actor_employee_id
  )
  on conflict on constraint kitchen_station_category_routes_unique do update
  set station = excluded.station, updated_by_employee_id = excluded.updated_by_employee_id
  returning kitchen_station_category_routes.category_id, kitchen_station_category_routes.station;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."ship_stock_transfer"("target_organization_id" "uuid", "target_source_store_id" "uuid", "target_destination_store_id" "uuid", "target_lines" "jsonb", "target_note" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare actor_id uuid; transfer_id uuid; line jsonb; source_level public.inventory_levels%rowtype; line_quantity numeric(14,3);
begin
  if (select private.current_profile_id()) is null or not (select private.has_permission(target_organization_id, 'inventory.manage')) then raise exception 'Inventory permission is required.' using errcode = '42501'; end if;
  if target_source_store_id = target_destination_store_id or target_lines is null or jsonb_typeof(target_lines) <> 'array' or jsonb_array_length(target_lines) not between 1 and 100 then raise exception 'Choose two stores and one to 100 transfer items.' using errcode = '23514'; end if;
  if exists (select 1 from jsonb_array_elements(target_lines) requested(value) where jsonb_typeof(requested.value) <> 'object' or coalesce(requested.value->>'product_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or (requested.value ? 'variant_id' and requested.value->'variant_id' <> 'null'::jsonb and coalesce(requested.value->>'variant_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') or coalesce(requested.value->>'quantity','') !~ '^\d+(\.\d{1,3})?$' or (requested.value->>'quantity')::numeric <= 0) then raise exception 'Transfer lines must contain valid items and positive quantities.' using errcode = '23514'; end if;
  if (select count(*) from jsonb_array_elements(target_lines)) <> (select count(distinct (value->>'product_id') || ':' || coalesce(value->>'variant_id','')) from jsonb_array_elements(target_lines)) then raise exception 'Each transfer item can appear only once.' using errcode = '23514'; end if;
  actor_id := private.inventory_actor(target_organization_id, target_source_store_id);
  if actor_id is null then raise exception 'An assigned employee is required for the source store.' using errcode = '42501'; end if;
  if not exists (select 1 from public.stores store where store.id = target_destination_store_id and store.organization_id = target_organization_id and store.is_active) then raise exception 'Choose an active destination store.' using errcode = '23514'; end if;
  insert into public.stock_transfers (organization_id, source_store_id, destination_store_id, status, note, transferred_by_employee_id)
  values (target_organization_id, target_source_store_id, target_destination_store_id, 'in_transit', nullif(btrim(target_note), ''), actor_id)
  returning id into transfer_id;
  for line in select value from jsonb_array_elements(target_lines) order by value->>'product_id', coalesce(value->>'variant_id','') loop
    line_quantity := (line->>'quantity')::numeric(14,3);
    select * into source_level from public.inventory_levels level where level.organization_id = target_organization_id and level.store_id = target_source_store_id and level.product_id = (line->>'product_id')::uuid and level.variant_id is not distinct from nullif(line->>'variant_id','')::uuid for update;
    if source_level.id is null or source_level.quantity < line_quantity then raise exception 'Source stock is insufficient for this transfer.' using errcode = '23514'; end if;
    if not exists (select 1 from public.inventory_levels level where level.organization_id = target_organization_id and level.store_id = target_destination_store_id and level.product_id = source_level.product_id and level.variant_id is not distinct from source_level.variant_id) then raise exception 'The destination stock projection is not initialized for one transfer item.' using errcode = '23514'; end if;
    insert into public.stock_transfer_lines (organization_id, stock_transfer_id, product_id, variant_id, quantity, unit_cost_minor)
    values (target_organization_id, transfer_id, source_level.product_id, source_level.variant_id, line_quantity, source_level.average_cost_minor);
    perform private.apply_inventory_change_v2(target_organization_id, target_source_store_id, source_level.product_id, source_level.variant_id, -line_quantity, 'TRANSFER_OUT', actor_id, 'Stock transferred out', 'stock_transfer', transfer_id, source_level.average_cost_minor);
  end loop;
  perform private.write_audit_log(target_organization_id, 'STOCK_TRANSFER_SHIPPED', 'inventory.manage', actor_id, null, target_source_store_id, null, null, null, target_note, jsonb_build_object('transfer_id', transfer_id, 'destination_store_id', target_destination_store_id));
  return transfer_id;
end;
$_$;

CREATE OR REPLACE FUNCTION "private"."start_stock_request_picking"("target_organization_id" "uuid", "target_stock_request_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare request_row public.stock_requests%rowtype; actor_id uuid; warehouse_store_id uuid;
begin
  if (select private.current_profile_id()) is null
     or (
       not (select private.has_permission(target_organization_id, 'inventory.manage'))
       and not (select private.has_inventory_capability(target_organization_id, 'inventory.transfer.send'))
     ) then raise exception 'Inventory permission is required.' using errcode = '42501'; end if;
  select * into request_row from public.stock_requests request where request.id = target_stock_request_id and request.organization_id = target_organization_id and request.status = 'approved' for update;
  if request_row.id is null then raise exception 'Only an approved request can be picked.' using errcode = '23514'; end if;
  select warehouse.store_id into warehouse_store_id from public.supply_chain_warehouses warehouse where warehouse.id = request_row.source_warehouse_id and warehouse.organization_id = target_organization_id and warehouse.is_active;
  actor_id := private.inventory_actor(target_organization_id, warehouse_store_id);
  if actor_id is null then raise exception 'An assigned employee is required for the source warehouse.' using errcode = '42501'; end if;
  update public.stock_request_lines set picked_quantity = approved_quantity where stock_request_id = request_row.id;
  update public.stock_requests set status = 'picking', picked_by_employee_id = actor_id, picked_at = now() where id = request_row.id;
  perform private.write_audit_log(target_organization_id, 'STOCK_REQUEST_PICKING_STARTED', 'inventory.manage', actor_id, null, warehouse_store_id, null, null, null, null, jsonb_build_object('stock_request_id', request_row.id));
end;
$$;

CREATE OR REPLACE FUNCTION "private"."submit_inventory_transfer"("target_organization_id" "uuid", "target_stock_transfer_id" "uuid", "target_note" "text", "target_operation_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_id uuid;
  existing_operation private.stock_transfer_operations%rowtype;
  normalized_note text;
  operation_payload jsonb;
  transfer public.stock_transfers%rowtype;
begin
  if target_operation_id is null then
    raise exception 'A stable submit operation ID is required.' using errcode = '23514';
  end if;
  if target_note is not null and char_length(btrim(target_note)) > 500 then
    raise exception 'The transfer note is too long.' using errcode = '23514';
  end if;

  select * into transfer
  from public.stock_transfers item
  where item.organization_id = target_organization_id
    and item.id = target_stock_transfer_id;
  if transfer.id is null or transfer.stock_request_id is not null then
    raise exception 'Choose a canonical direct transfer in this organization.' using errcode = '23514';
  end if;
  if (select private.current_profile_id()) is null
     or not (select private.has_inventory_capability(target_organization_id, 'inventory.transfer.create')) then
    raise exception 'Transfer creation permission is required.' using errcode = '42501';
  end if;
  actor_id := private.inventory_actor(target_organization_id, transfer.source_store_id);
  if actor_id is null then
    raise exception 'An active employee assigned to the source store is required.' using errcode = '42501';
  end if;

  normalized_note := nullif(btrim(target_note), '');
  operation_payload := jsonb_build_object('stock_transfer_id', target_stock_transfer_id, 'note', normalized_note);
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text || ':' || target_operation_id::text, 0));

  select * into existing_operation
  from private.stock_transfer_operations operation
  where operation.organization_id = target_organization_id
    and operation.operation_id = target_operation_id
  for update;
  if found then
    if existing_operation.command = 'submit' and existing_operation.normalized_payload = operation_payload then
      return existing_operation.result_id;
    end if;
    raise exception 'This operation ID is already assigned to a different transfer command.' using errcode = '23505';
  end if;

  select * into transfer
  from public.stock_transfers item
  where item.organization_id = target_organization_id
    and item.id = target_stock_transfer_id
  for update;
  if transfer.status <> 'draft' then
    raise exception 'Only a draft transfer can be submitted.' using errcode = '23514';
  end if;

  update public.stock_transfers set status = 'submitted' where id = transfer.id;
  insert into private.stock_transfer_operations (
    organization_id, stock_transfer_id, operation_id, command, normalized_payload,
    from_status, to_status, actor_employee_id, result_id, note
  ) values (
    target_organization_id, transfer.id, target_operation_id, 'submit', operation_payload,
    'draft', 'submitted', actor_id, transfer.id, normalized_note
  );
  perform private.write_audit_log(
    target_organization_id, 'STOCK_TRANSFER_SUBMITTED', 'inventory.transfer.create', actor_id,
    null, transfer.source_store_id, null, null, null, normalized_note,
    jsonb_build_object('stock_transfer_id', transfer.id, 'transfer_number', transfer.transfer_number, 'operation_id', target_operation_id)
  );
  return transfer.id;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."transfer_stock"("target_organization_id" "uuid", "target_source_store_id" "uuid", "target_destination_store_id" "uuid", "target_lines" "jsonb", "target_note" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$ declare actor_id uuid; transfer_id uuid; line jsonb; source_quantity numeric(14,3); begin
 if (select private.current_profile_id()) is null
     or (
       not (select private.has_permission(target_organization_id, 'inventory.manage'))
       and not (select private.has_all_inventory_capabilities(
         target_organization_id,
         array['inventory.transfer.create', 'inventory.transfer.send']::text[]
       ))
     ) then raise exception 'Inventory permission is required.' using errcode='42501'; end if;
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
 end loop; return transfer_id; end; $_$;

CREATE OR REPLACE FUNCTION "private"."update_business_profile_features"("target_organization_id" "uuid", "target_business_type" "text", "target_feature_settings" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  normalized_business_type text := lower(btrim(coalesce(target_business_type, '')));
  actor_employee_id uuid;
  previous_business_type text;
  previous_feature_settings jsonb;
  current_feature_settings jsonb;
begin
  if (select private.current_profile_id()) is null
     or not (select private.has_permission(target_organization_id, 'settings.manage')) then
    raise exception 'Business profile permission is required.' using errcode = '42501';
  end if;

  if normalized_business_type not in (
    'retail', 'grocery', 'convenience_store', 'restaurant_cafe',
    'bar', 'wholesale', 'service', 'other'
  ) then
    raise exception 'Choose a supported business type.' using errcode = '22023';
  end if;

  if target_feature_settings is null or jsonb_typeof(target_feature_settings) <> 'object' then
    raise exception 'Feature settings must be an object.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_each(target_feature_settings) as setting(feature_key, feature_value)
    where setting.feature_key not in (
      'inventory', 'shifts', 'time_clock', 'open_tickets', 'dining',
      'modifiers', 'loyalty', 'customer_display', 'kitchen_display',
      'purchase_orders', 'transfers', 'production', 'weighted_products',
      'multi_store'
    )
      or jsonb_typeof(setting.feature_value) <> 'boolean'
  ) then
    raise exception 'Feature settings contain an unsupported value.' using errcode = '22023';
  end if;

  select organization.business_type
  into previous_business_type
  from public.organizations organization
  where organization.id = target_organization_id
  for update;

  if previous_business_type is null then
    raise exception 'The organization could not be found.' using errcode = '23514';
  end if;

  select coalesce(jsonb_object_agg(feature.feature_key, feature.is_enabled), '{}'::jsonb)
  into previous_feature_settings
  from public.organization_features feature
  where feature.organization_id = target_organization_id;

  select private.current_employee_id(target_organization_id)
  into actor_employee_id;

  if actor_employee_id is null then
    raise exception 'An active employee is required.' using errcode = '42501';
  end if;

  update public.organizations
  set business_type = normalized_business_type
  where id = target_organization_id;

  insert into public.organization_features (
    organization_id,
    feature_key,
    is_enabled,
    updated_by_employee_id
  )
  select
    target_organization_id,
    recommendation.feature_key,
    case
      when target_feature_settings ? recommendation.feature_key
        then (target_feature_settings ->> recommendation.feature_key)::boolean
      else coalesce(current_feature.is_enabled, recommendation.is_enabled)
    end,
    actor_employee_id
  from private.business_feature_recommendations(normalized_business_type) recommendation
  left join public.organization_features current_feature
    on current_feature.organization_id = target_organization_id
   and current_feature.feature_key = recommendation.feature_key
  on conflict (organization_id, feature_key) do update
  set is_enabled = excluded.is_enabled,
      updated_by_employee_id = excluded.updated_by_employee_id;

  select coalesce(jsonb_object_agg(feature.feature_key, feature.is_enabled), '{}'::jsonb)
  into current_feature_settings
  from public.organization_features feature
  where feature.organization_id = target_organization_id;

  perform private.write_audit_log(
    target_organization_id,
    'BUSINESS_PROFILE_UPDATED',
    'settings.manage',
    actor_employee_id,
    null,
    null,
    null,
    null,
    null,
    null,
    jsonb_build_object(
      'previous_business_type', previous_business_type,
      'business_type', normalized_business_type,
      'previous_feature_settings', previous_feature_settings,
      'feature_settings', current_feature_settings
    )
  );

  return current_feature_settings;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."update_catalog_product_v2"("target_organization_id" "uuid", "target_product_id" "uuid", "target_name" "text", "target_description" "text", "target_category_id" "uuid", "target_sku" "text", "target_barcode" "text", "target_price_minor" bigint, "target_cost_minor" bigint, "target_track_inventory" boolean, "target_unit" "text", "target_image_url" "text", "target_is_variable_price" boolean, "target_allow_fractional_quantity" boolean) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  existing_product_type text;
  existing_cost_minor bigint;
  existing_unit text;
  effective_cost_minor bigint;
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'products.manage')) then
    raise exception 'Product management permission is required.' using errcode = '42501';
  end if;

  select product.product_type, product.cost_minor, product.unit
  into existing_product_type, existing_cost_minor, existing_unit
  from public.products product
  where product.id = target_product_id
    and product.organization_id = target_organization_id;

  if not found then
    raise exception 'The product could not be found.' using errcode = '23503';
  end if;

  if lower(btrim(target_unit)) is distinct from existing_unit then
    raise exception 'The base unit is fixed after product creation to protect inventory and conversion history. Create a new product to use a different unit.' using errcode = '23514';
  end if;

  if target_category_id is not null and not exists (
    select 1
    from public.categories category
    where category.id = target_category_id
      and category.organization_id = target_organization_id
      and not category.is_archived
  ) then
    raise exception 'Select an active category in this organization.' using errcode = '23503';
  end if;

  if existing_product_type <> 'variable'
    and target_cost_minor is not null
    and target_cost_minor is distinct from existing_cost_minor
    and not (select private.has_permission(target_organization_id, 'products.view_cost')) then
    raise exception 'Product cost permission is required.' using errcode = '42501';
  end if;

  effective_cost_minor := coalesce(target_cost_minor, existing_cost_minor);

  if existing_product_type = 'variable' then
    update public.products
    set name = target_name,
        description = nullif(target_description, ''),
        category_id = target_category_id,
        track_inventory = target_track_inventory,
        unit = lower(target_unit),
        image_url = nullif(btrim(target_image_url), ''),
        is_variable_price = false,
        allow_fractional_quantity = target_allow_fractional_quantity
    where id = target_product_id
      and organization_id = target_organization_id;
  else
    update public.products
    set name = target_name,
        description = nullif(target_description, ''),
        category_id = target_category_id,
        sku = nullif(target_sku, ''),
        barcode = nullif(target_barcode, ''),
        price_minor = target_price_minor,
        cost_minor = effective_cost_minor,
        track_inventory = target_track_inventory,
        unit = lower(target_unit),
        image_url = nullif(btrim(target_image_url), ''),
        is_variable_price = target_is_variable_price,
        allow_fractional_quantity = target_allow_fractional_quantity
    where id = target_product_id
      and organization_id = target_organization_id;
  end if;

  return existing_product_type;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."update_employee_assignments_unscoped"("target_organization_id" "uuid", "target_employee_id" "uuid", "target_job_title" "text", "target_status" "text", "target_role_ids" "uuid"[], "target_store_ids" "uuid"[]) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  normalized_job_title text := nullif(btrim(target_job_title), '');
  normalized_status text := lower(btrim(target_status));
  actor_employee_id uuid;
  target_profile_id uuid;
  current_status text;
  current_role_ids uuid[];
  requested_role_ids uuid[];
  effective_store_ids uuid[];
  valid_role_count integer;
  valid_store_count integer;
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'employees.manage')) then
    raise exception 'Employee management permission is required.' using errcode = '42501';
  end if;

  if normalized_status not in ('active', 'inactive', 'suspended') then
    raise exception 'Choose an active, inactive, or suspended employee status.' using errcode = '22023';
  end if;

  if normalized_job_title is not null and char_length(normalized_job_title) > 120 then
    raise exception 'Job title must contain at most 120 characters.' using errcode = '22023';
  end if;

  if coalesce(cardinality(target_role_ids), 0) = 0
    or coalesce(cardinality(target_store_ids), 0) = 0 then
    raise exception 'Assign at least one role and one active store.' using errcode = '22023';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select private.current_profile_id())
    and employee.status = 'active';

  select employee.profile_id, employee.status
  into target_profile_id, current_status
  from public.employees employee
  where employee.id = target_employee_id
    and employee.organization_id = target_organization_id;

  if target_profile_id is null then
    raise exception 'Select an employee in this organization.' using errcode = '23503';
  end if;

  select coalesce(array_agg(employee_role.role_id order by employee_role.role_id), '{}'::uuid[])
  into current_role_ids
  from public.employee_roles employee_role
  where employee_role.organization_id = target_organization_id
    and employee_role.employee_id = target_employee_id;

  select coalesce(array_agg(distinct requested_role_id order by requested_role_id), '{}'::uuid[])
  into requested_role_ids
  from unnest(target_role_ids) as requested_role_id;

  if target_profile_id = (select private.current_profile_id()) then
    if not (select private.has_permission(target_organization_id, 'organization.manage')) then
      raise exception 'Only organization managers can update their own employee record.' using errcode = '42501';
    end if;

    if normalized_status is distinct from current_status
      or requested_role_ids is distinct from current_role_ids then
      raise exception 'You cannot change your own role assignments or status.' using errcode = '42501';
    end if;
  end if;

  select count(*)
  into valid_role_count
  from public.roles role
  where role.organization_id = target_organization_id
    and role.id = any(target_role_ids);

  if valid_role_count <> cardinality(array(select distinct unnest(target_role_ids))) then
    raise exception 'Every assigned role must belong to this organization.' using errcode = '23503';
  end if;

  if exists (
    select 1
    from unnest(target_role_ids) as requested_role_id
    where not (select private.can_grant_role(target_organization_id, requested_role_id))
  ) then
    raise exception 'You cannot assign a role containing permissions you do not hold.' using errcode = '42501';
  end if;

  select count(*)
  into valid_store_count
  from public.stores store
  where store.organization_id = target_organization_id
    and store.id = any(target_store_ids)
    and store.is_active;

  if valid_store_count <> cardinality(array(select distinct unnest(target_store_ids))) then
    raise exception 'Every assigned store must be active and belong to this organization.' using errcode = '23503';
  end if;

  update public.employees
  set
    job_title = normalized_job_title,
    status = normalized_status
  where id = target_employee_id
    and organization_id = target_organization_id;

  delete from public.employee_roles
  where employee_id = target_employee_id
    and organization_id = target_organization_id;

  insert into public.employee_roles (organization_id, employee_id, role_id)
  select target_organization_id, target_employee_id, distinct_role_id
  from unnest(target_role_ids) as distinct_role_id
  on conflict do nothing;

  delete from public.employee_stores
  where employee_id = target_employee_id
    and organization_id = target_organization_id;

  insert into public.employee_stores (organization_id, employee_id, store_id)
  select target_organization_id, target_employee_id, distinct_store_id
  from unnest(target_store_ids) as distinct_store_id
  on conflict do nothing;

  perform private.sync_organization_manager_store_access(
    target_organization_id,
    target_employee_id
  );

  select coalesce(array_agg(employee_store.store_id order by employee_store.store_id), '{}'::uuid[])
  into effective_store_ids
  from public.employee_stores employee_store
  where employee_store.organization_id = target_organization_id
    and employee_store.employee_id = target_employee_id;

  perform private.write_audit_log(
    target_organization_id,
    'EMPLOYEE_ASSIGNMENTS_UPDATED',
    'employees.manage',
    actor_employee_id,
    target_employee_id,
    null,
    null,
    null,
    null,
    null,
    jsonb_build_object(
      'status', normalized_status,
      'role_ids', requested_role_ids,
      'store_ids', effective_store_ids,
      'requested_store_ids', target_store_ids
    )
  );

  return target_employee_id;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."update_inventory_policy"("target_organization_id" "uuid", "target_store_id" "uuid", "target_negative_stock_policy" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_id uuid;
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'inventory.manage')) then
    raise exception 'Inventory permission is required.' using errcode = '42501';
  end if;

  if target_negative_stock_policy not in ('allow', 'warn', 'block')
    or not exists (
      select 1
      from public.stores store
      where store.id = target_store_id
        and store.organization_id = target_organization_id
        and store.is_active
    ) then
    raise exception 'Choose an active store and a valid negative-stock policy.' using errcode = '23514';
  end if;

  actor_id := private.inventory_actor(target_organization_id, target_store_id);
  if actor_id is null then
    raise exception 'You do not have access to manage this store.' using errcode = '42501';
  end if;

  insert into public.inventory_policies (
    organization_id,
    store_id,
    negative_stock_policy,
    updated_by_employee_id
  )
  values (
    target_organization_id,
    target_store_id,
    target_negative_stock_policy,
    actor_id
  )
  on conflict (organization_id, store_id) do update
    set negative_stock_policy = excluded.negative_stock_policy,
        updated_by_employee_id = excluded.updated_by_employee_id,
        updated_at = now();

  perform private.write_audit_log(
    target_organization_id,
    'INVENTORY_POLICY_UPDATED',
    'inventory.manage',
    actor_id,
    null,
    target_store_id,
    null,
    null,
    null,
    null,
    jsonb_build_object(
      'negative_stock_policy', target_negative_stock_policy,
      'scope', 'store_override'
    )
  );
end;
$$;

CREATE OR REPLACE FUNCTION "private"."update_kitchen_order_item_status"("target_organization_id" "uuid", "target_kitchen_order_item_id" "uuid", "target_status" "text") RETURNS TABLE("order_status" "text", "item_status" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  current_status text;
  resolved_order_id uuid;
  resolved_store_id uuid;
  resolved_order_status text;
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'kitchen.manage')) then
    raise exception 'Kitchen order management access is required.' using errcode = '42501';
  end if;

  if target_status not in ('PREPARING', 'READY', 'COMPLETED') then
    raise exception 'Choose a valid next kitchen item status.' using errcode = '22023';
  end if;

  select kitchen_item.status, kitchen_item.kitchen_order_id, kitchen_order.store_id
  into current_status, resolved_order_id, resolved_store_id
  from public.kitchen_order_items kitchen_item
  join public.kitchen_orders kitchen_order
    on kitchen_order.id = kitchen_item.kitchen_order_id
   and kitchen_order.organization_id = kitchen_item.organization_id
  where kitchen_item.id = target_kitchen_order_item_id
    and kitchen_item.organization_id = target_organization_id
  for update of kitchen_item, kitchen_order;

  if resolved_order_id is null then
    raise exception 'This kitchen item is no longer available.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.employees employee
    join public.employee_stores employee_store
      on employee_store.employee_id = employee.id
     and employee_store.organization_id = employee.organization_id
    where employee.organization_id = target_organization_id
      and employee.profile_id = (select private.current_profile_id())
      and employee.status = 'active'
      and employee_store.store_id = resolved_store_id
  ) then
    raise exception 'You are not assigned to this kitchen order store.' using errcode = '42501';
  end if;

  if not (
    (current_status = 'NEW' and target_status = 'PREPARING')
    or (current_status = 'PREPARING' and target_status = 'READY')
    or (current_status = 'READY' and target_status = 'COMPLETED')
  ) then
    raise exception 'Kitchen items must be advanced one status at a time.' using errcode = '23514';
  end if;

  update public.kitchen_order_items kitchen_item
  set
    status = target_status,
    started_at = case when target_status = 'PREPARING' then now() else kitchen_item.started_at end,
    ready_at = case when target_status = 'READY' then now() else kitchen_item.ready_at end,
    completed_at = case when target_status = 'COMPLETED' then now() else kitchen_item.completed_at end
  where kitchen_item.id = target_kitchen_order_item_id
    and kitchen_item.organization_id = target_organization_id;

  select case
    when bool_and(kitchen_item.status = 'COMPLETED') then 'COMPLETED'
    when bool_and(kitchen_item.status in ('READY', 'COMPLETED')) then 'READY'
    when bool_or(kitchen_item.status in ('PREPARING', 'READY', 'COMPLETED')) then 'PREPARING'
    else 'NEW'
  end
  into resolved_order_status
  from public.kitchen_order_items kitchen_item
  where kitchen_item.kitchen_order_id = resolved_order_id
    and kitchen_item.organization_id = target_organization_id;

  update public.kitchen_orders kitchen_order
  set
    status = resolved_order_status,
    started_at = case
      when resolved_order_status = 'NEW' then null
      else coalesce(kitchen_order.started_at, now())
    end,
    ready_at = case
      when resolved_order_status in ('READY', 'COMPLETED') then coalesce(kitchen_order.ready_at, now())
      else null
    end,
    completed_at = case
      when resolved_order_status = 'COMPLETED' then coalesce(kitchen_order.completed_at, now())
      else null
    end
  where kitchen_order.id = resolved_order_id
    and kitchen_order.organization_id = target_organization_id;

  return query select resolved_order_status, target_status;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."update_kitchen_order_status"("target_organization_id" "uuid", "target_kitchen_order_id" "uuid", "target_status" "text") RETURNS TABLE("status" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  current_status text;
  resolved_store_id uuid;
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'kitchen.manage')) then
    raise exception 'Kitchen order management access is required.' using errcode = '42501';
  end if;

  if target_status not in ('PREPARING', 'READY', 'COMPLETED') then
    raise exception 'Choose a valid next kitchen status.' using errcode = '22023';
  end if;

  select kitchen_order.status, kitchen_order.store_id
  into current_status, resolved_store_id
  from public.kitchen_orders kitchen_order
  where kitchen_order.id = target_kitchen_order_id
    and kitchen_order.organization_id = target_organization_id
  for update;

  if current_status is null then
    raise exception 'This kitchen order is no longer available.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.employees employee
    join public.employee_stores employee_store
      on employee_store.employee_id = employee.id
     and employee_store.organization_id = employee.organization_id
    where employee.organization_id = target_organization_id
      and employee.profile_id = (select private.current_profile_id())
      and employee.status = 'active'
      and employee_store.store_id = resolved_store_id
  ) then
    raise exception 'You are not assigned to this kitchen order store.' using errcode = '42501';
  end if;

  if not (
    (current_status = 'NEW' and target_status = 'PREPARING')
    or (current_status = 'PREPARING' and target_status = 'READY')
    or (current_status = 'READY' and target_status = 'COMPLETED')
  ) then
    raise exception 'Kitchen orders must be advanced one status at a time.' using errcode = '23514';
  end if;

  update public.kitchen_order_items kitchen_item
  set
    status = target_status,
    started_at = case when target_status = 'PREPARING' then now() else kitchen_item.started_at end,
    ready_at = case when target_status = 'READY' then now() else kitchen_item.ready_at end,
    completed_at = case when target_status = 'COMPLETED' then now() else kitchen_item.completed_at end
  where kitchen_item.kitchen_order_id = target_kitchen_order_id
    and kitchen_item.organization_id = target_organization_id;

  return query
  update public.kitchen_orders kitchen_order
  set
    status = target_status,
    started_at = case when target_status = 'PREPARING' then now() else kitchen_order.started_at end,
    ready_at = case when target_status = 'READY' then now() else kitchen_order.ready_at end,
    completed_at = case when target_status = 'COMPLETED' then now() else kitchen_order.completed_at end
  where kitchen_order.id = target_kitchen_order_id
    and kitchen_order.organization_id = target_organization_id
  returning kitchen_order.status;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."update_organization_inventory_policy"("target_organization_id" "uuid", "target_negative_stock_policy" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_id uuid;
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'inventory.manage'))
    or not (select private.has_permission(target_organization_id, 'stores.manage')) then
    raise exception 'Organization-wide inventory policy permission is required.' using errcode = '42501';
  end if;

  if target_negative_stock_policy not in ('allow', 'warn', 'block')
    or not exists (
      select 1
      from public.organizations organization
      where organization.id = target_organization_id
    ) then
    raise exception 'Choose a valid organization and negative-stock policy.' using errcode = '23514';
  end if;

  actor_id := private.inventory_organization_actor(target_organization_id);
  if actor_id is null then
    raise exception 'An active employee is required for this organization.' using errcode = '42501';
  end if;

  insert into public.inventory_policy_defaults (
    organization_id,
    negative_stock_policy,
    updated_by_employee_id
  )
  values (
    target_organization_id,
    target_negative_stock_policy,
    actor_id
  )
  on conflict (organization_id) do update
    set negative_stock_policy = excluded.negative_stock_policy,
        updated_by_employee_id = excluded.updated_by_employee_id,
        updated_at = now();

  perform private.write_audit_log(
    target_organization_id,
    'INVENTORY_POLICY_DEFAULT_UPDATED',
    'inventory.manage',
    actor_id,
    null,
    null,
    null,
    null,
    null,
    null,
    jsonb_build_object(
      'negative_stock_policy', target_negative_stock_policy,
      'scope', 'organization_default'
    )
  );
end;
$$;

CREATE OR REPLACE FUNCTION "private"."update_shift_cash_close_setting"("target_organization_id" "uuid", "target_show_expected_cash_before_close" boolean) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if target_organization_id is null or target_show_expected_cash_before_close is null then
    raise exception 'Choose a cash-close visibility setting.' using errcode = '23514';
  end if;

  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'settings.manage')) then
    raise exception 'Settings permission is required.' using errcode = '42501';
  end if;

  update public.organizations organization
  set show_expected_cash_before_close = target_show_expected_cash_before_close
  where organization.id = target_organization_id;

  if not found then
    raise exception 'The organization was not found.' using errcode = 'P0002';
  end if;

  return target_show_expected_cash_before_close;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."update_supplier_lead_time"("target_organization_id" "uuid", "target_supplier_id" "uuid", "target_lead_time_days" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare actor_id uuid;
begin
  if (select private.current_profile_id()) is null or not (select private.has_permission(target_organization_id, 'inventory.manage')) then raise exception 'Inventory permission is required.' using errcode = '42501'; end if;
  if target_lead_time_days is null or target_lead_time_days not between 0 and 365 then raise exception 'Supplier lead time must be between zero and 365 days.' using errcode = '23514'; end if;
  if not exists (select 1 from public.suppliers supplier where supplier.id = target_supplier_id and supplier.organization_id = target_organization_id) then raise exception 'Choose a supplier in this organization.' using errcode = '23514'; end if;
  select employee.id into actor_id from public.employees employee where employee.organization_id = target_organization_id and employee.profile_id = (select private.current_profile_id()) and employee.status = 'active' order by employee.created_at limit 1;
  if actor_id is null then raise exception 'An active employee record is required.' using errcode = '42501'; end if;
  update public.suppliers set lead_time_days = target_lead_time_days where id = target_supplier_id and organization_id = target_organization_id;
  perform private.write_audit_log(target_organization_id, 'SUPPLIER_LEAD_TIME_UPDATED', 'inventory.manage', actor_id, null, null, null, null, null, null, jsonb_build_object('supplier_id', target_supplier_id, 'lead_time_days', target_lead_time_days));
end;
$$;

CREATE OR REPLACE FUNCTION "private"."upsert_inventory_replenishment_rule"("target_organization_id" "uuid", "target_store_id" "uuid", "target_product_id" "uuid", "target_variant_id" "uuid", "target_preferred_warehouse_id" "uuid", "target_reorder_point" numeric, "target_target_stock" numeric) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare actor_id uuid; rule_id uuid; warehouse_store_id uuid;
begin
  if (select private.current_profile_id()) is null or not (select private.has_permission(target_organization_id, 'inventory.manage')) then raise exception 'Inventory permission is required.' using errcode = '42501'; end if;
  if target_reorder_point is null or target_target_stock is null or target_reorder_point < 0 or target_target_stock <= 0 or target_target_stock < target_reorder_point or target_reorder_point <> round(target_reorder_point, 3) or target_target_stock <> round(target_target_stock, 3) then raise exception 'Reorder point and target stock must be valid quantities.' using errcode = '23514'; end if;
  actor_id := private.inventory_actor(target_organization_id, target_store_id);
  if actor_id is null then raise exception 'An assigned employee is required for the requesting store.' using errcode = '42501'; end if;
  if not exists (select 1 from public.inventory_levels level where level.organization_id = target_organization_id and level.store_id = target_store_id and level.product_id = target_product_id and level.variant_id is not distinct from target_variant_id) then raise exception 'Initialize the destination stock projection before setting a replenishment rule.' using errcode = '23514'; end if;
  if not exists (select 1 from public.products product left join public.product_variants variant on variant.id = target_variant_id and variant.product_id = product.id and variant.organization_id = product.organization_id where product.id = target_product_id and product.organization_id = target_organization_id and product.status = 'active' and product.track_inventory and (target_variant_id is null or variant.id is not null)) then raise exception 'Choose an active tracked saleable item.' using errcode = '23514'; end if;
  if target_preferred_warehouse_id is not null then
    select warehouse.store_id into warehouse_store_id from public.supply_chain_warehouses warehouse where warehouse.id = target_preferred_warehouse_id and warehouse.organization_id = target_organization_id and warehouse.is_active;
    if warehouse_store_id is null or warehouse_store_id = target_store_id then raise exception 'Choose an active warehouse at a different stock location.' using errcode = '23514'; end if;
  end if;
  insert into public.inventory_replenishment_rules (organization_id, store_id, product_id, variant_id, preferred_warehouse_id, reorder_point, target_stock, updated_by_employee_id)
  values (target_organization_id, target_store_id, target_product_id, target_variant_id, target_preferred_warehouse_id, target_reorder_point, target_target_stock, actor_id)
  on conflict (organization_id, store_id, product_id, variant_id) do update set preferred_warehouse_id = excluded.preferred_warehouse_id, reorder_point = excluded.reorder_point, target_stock = excluded.target_stock, updated_by_employee_id = excluded.updated_by_employee_id, updated_at = now()
  returning id into rule_id;
  perform private.write_audit_log(target_organization_id, 'INVENTORY_REPLENISHMENT_RULE_SAVED', 'inventory.manage', actor_id, null, target_store_id, null, null, null, null, jsonb_build_object('rule_id', rule_id, 'product_id', target_product_id, 'variant_id', target_variant_id, 'reorder_point', target_reorder_point, 'target_stock', target_target_stock));
  return rule_id;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."validate_pos_cart_stock"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_items" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  actor_employee_id uuid;
  selected_line record;
  resolved_policy text;
  affected_items jsonb;
begin
  perform private.require_pos_capabilities(
    target_organization_id,
    array['pos.access', 'sales.create', 'payments.accept']
  );

  if target_store_id is null or target_register_id is null
    or target_items is null or jsonb_typeof(target_items) <> 'array'
    or jsonb_array_length(target_items) not between 1 and 100 then
    raise exception 'A store, register, and one or more cart items are required.'
      using errcode = '23514';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  join public.employee_stores employee_store
    on employee_store.employee_id = employee.id
   and employee_store.organization_id = employee.organization_id
   and employee_store.store_id = target_store_id
  join public.registers register
    on register.id = target_register_id
   and register.organization_id = employee.organization_id
   and register.store_id = target_store_id
   and register.is_active
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select private.current_profile_id())
    and employee.status = 'active';

  if actor_employee_id is null then
    raise exception 'An active assigned employee and register are required.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.shifts shift
    where shift.organization_id = target_organization_id
      and shift.store_id = target_store_id
      and shift.register_id = target_register_id
      and shift.opened_by_employee_id = actor_employee_id
      and shift.status = 'open'
  ) then
    raise exception 'Open your assigned register shift before charging a sale.'
      using errcode = '42501';
  end if;

  for selected_line in
    select value from jsonb_array_elements(target_items)
  loop
    if jsonb_typeof(selected_line.value) <> 'object'
      or jsonb_typeof(selected_line.value -> 'product_id') <> 'string'
      or coalesce(selected_line.value ->> 'product_id', '')
        !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (
        selected_line.value -> 'variant_id' is distinct from 'null'::jsonb
        and jsonb_typeof(selected_line.value -> 'variant_id') <> 'string'
      )
      or (
        nullif(selected_line.value ->> 'variant_id', '') is not null
        and selected_line.value ->> 'variant_id'
          !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
      or jsonb_typeof(selected_line.value -> 'quantity') <> 'number'
      or coalesce(selected_line.value ->> 'quantity', '')
        !~ '^(?:0|[1-9][0-9]{0,3})(?:[.][0-9]{1,3})?$'
      or (selected_line.value ->> 'quantity')::numeric(14,3) <= 0 then
      raise exception
        'Each stock-check item must have valid references and a positive quantity.'
        using errcode = '23514';
    end if;
  end loop;

  resolved_policy := private.resolve_negative_stock_policy(
    target_organization_id,
    target_store_id
  );

  with requested_items as (
    select
      (line.value ->> 'product_id')::uuid as product_id,
      nullif(line.value ->> 'variant_id', '')::uuid as variant_id,
      sum((line.value ->> 'quantity')::numeric(14,3)) as cart_quantity
    from jsonb_array_elements(target_items) line(value)
    group by
      (line.value ->> 'product_id')::uuid,
      nullif(line.value ->> 'variant_id', '')::uuid
  ),
  direct_requirements as (
    select
      requested.product_id as stock_product_id,
      requested.variant_id as stock_variant_id,
      requested.cart_quantity as required_quantity,
      product.name as stock_product_name,
      variant.name as stock_variant_name
    from requested_items requested
    join public.products product
      on product.id = requested.product_id
     and product.organization_id = target_organization_id
     and product.status = 'active'
     and product.track_inventory
    join public.product_store_settings setting
      on setting.organization_id = product.organization_id
     and setting.product_id = product.id
     and setting.store_id = target_store_id
     and setting.is_available
    left join public.product_variants variant
      on variant.id = requested.variant_id
     and variant.product_id = product.id
     and variant.organization_id = product.organization_id
     and variant.is_active
    where (
      requested.variant_id is null
      and product.product_type = 'simple'
    ) or (
      requested.variant_id is not null
      and product.product_type = 'variable'
      and variant.id is not null
    )
  ),
  finished_stock_requirements as (
    select direct.*
    from direct_requirements direct
    join public.products product
      on product.id = direct.stock_product_id
     and product.organization_id = target_organization_id
    where not (
      direct.stock_variant_id is null
      and product.is_composite
      and product.composite_inventory_mode = 'made_to_order'
    )
  ),
  made_to_order_requirements as (
    select
      recipe.component_product_id as stock_product_id,
      recipe.component_variant_id as stock_variant_id,
      round(requested.cart_quantity * recipe.quantity_per_composite, 3)
        as required_quantity,
      component_product.name as stock_product_name,
      component_variant.name as stock_variant_name
    from requested_items requested
    join public.products parent
      on parent.id = requested.product_id
     and parent.organization_id = target_organization_id
     and parent.status = 'active'
     and parent.product_type = 'simple'
     and parent.track_inventory
     and parent.is_composite
     and parent.composite_inventory_mode = 'made_to_order'
    join public.product_store_settings setting
      on setting.organization_id = parent.organization_id
     and setting.product_id = parent.id
     and setting.store_id = target_store_id
     and setting.is_available
    join public.product_components recipe
      on recipe.organization_id = parent.organization_id
     and recipe.product_id = parent.id
    join public.products component_product
      on component_product.id = recipe.component_product_id
     and component_product.organization_id = recipe.organization_id
     and component_product.track_inventory
    left join public.product_variants component_variant
      on component_variant.id = recipe.component_variant_id
     and component_variant.product_id = recipe.component_product_id
     and component_variant.organization_id = recipe.organization_id
    where requested.variant_id is null
  ),
  raw_requirements as (
    select * from finished_stock_requirements
    union all
    select * from made_to_order_requirements
  ),
  aggregated_requirements as (
    select
      requirement.stock_product_id,
      requirement.stock_variant_id,
      sum(requirement.required_quantity)::numeric(14,3) as required_quantity,
      min(requirement.stock_product_name) as stock_product_name,
      min(requirement.stock_variant_name) as stock_variant_name
    from raw_requirements requirement
    group by requirement.stock_product_id, requirement.stock_variant_id
  ),
  tracked_positions as (
    select
      requirement.*,
      coalesce(level.quantity, 0::numeric) as available_quantity
    from aggregated_requirements requirement
    left join public.inventory_levels level
      on level.organization_id = target_organization_id
     and level.store_id = target_store_id
     and level.product_id = requirement.stock_product_id
     and level.variant_id is not distinct from requirement.stock_variant_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'product_id', tracked.stock_product_id,
        'variant_id', tracked.stock_variant_id,
        'product_name', tracked.stock_product_name,
        'variant_name', tracked.stock_variant_name,
        'available_quantity', tracked.available_quantity,
        'cart_quantity', tracked.required_quantity,
        'projected_quantity',
          tracked.available_quantity - tracked.required_quantity
      )
      order by
        lower(tracked.stock_product_name),
        lower(coalesce(tracked.stock_variant_name, ''))
    ) filter (
      where tracked.available_quantity - tracked.required_quantity < 0
    ),
    '[]'::jsonb
  )
  into affected_items
  from tracked_positions tracked;

  return jsonb_build_object(
    'policy', resolved_policy,
    'items', affected_items,
    'checked_at', clock_timestamp()
  );
end;
$_$;

CREATE OR REPLACE FUNCTION "public"."add_loyalty_card_stamp"("target_organization_id" "uuid", "target_loyalty_card_id" "uuid", "target_reason" "text", "target_sale_id" "uuid" DEFAULT NULL::"uuid", "target_idempotency_key" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("card_id" "uuid", "stamp_count" integer, "stamp_target" integer, "status" "text", "was_replayed" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_employee_id uuid;
  normalized_reason text := nullif(btrim(coalesce(target_reason, '')), '');
  card_record public.loyalty_cards%rowtype;
  previous_event public.loyalty_card_events%rowtype;
  resolved_store_id uuid;
  resolved_register_id uuid;
begin
  if (select private.current_profile_id()) is null
    or not (
      (select private.has_permission(target_organization_id, 'customers.manage'))
      or (select private.has_permission(target_organization_id, 'sales.create'))
    ) then
    raise exception 'Sales or customer management permission is required to add a stamp.' using errcode = '42501';
  end if;

  if target_idempotency_key is null
    or (target_sale_id is null and char_length(coalesce(normalized_reason, '')) not between 2 and 500)
    or (target_sale_id is not null and normalized_reason is not null and char_length(normalized_reason) not between 2 and 500) then
    raise exception 'Provide an action key and, for a manual stamp, a reason between 2 and 500 characters.' using errcode = '23514';
  end if;

  select private.current_employee_id(target_organization_id)
  into actor_employee_id;
  if actor_employee_id is null then
    raise exception 'An active employee is required to add a loyalty stamp.' using errcode = '42501';
  end if;

  select event.*
  into previous_event
  from public.loyalty_card_events event
  where event.organization_id = target_organization_id
    and event.idempotency_key = target_idempotency_key
  for key share;

  if previous_event.id is not null then
    if previous_event.event_type <> 'STAMP_ADDED'
      or previous_event.loyalty_card_id <> target_loyalty_card_id then
      raise exception 'This loyalty action key is already in use.' using errcode = '23505';
    end if;

    select card.*
    into card_record
    from public.loyalty_cards card
    where card.id = target_loyalty_card_id
      and card.organization_id = target_organization_id;

    return query select card_record.id, card_record.stamp_count, card_record.stamp_target, card_record.status, true;
    return;
  end if;

  select card.*
  into card_record
  from public.loyalty_cards card
  join public.customers customer
    on customer.id = card.customer_id
   and customer.organization_id = card.organization_id
  where card.id = target_loyalty_card_id
    and card.organization_id = target_organization_id
    and card.status = 'active'
    and customer.status = 'active'
  for update of card;

  if card_record.id is null then
    raise exception 'The loyalty card is not active.' using errcode = 'P0002';
  end if;

  if card_record.expires_at is not null and card_record.expires_at <= now() then
    update public.loyalty_cards card
    set status = 'expired', deactivated_at = now(), deactivation_reason = 'Card expired.'
    where card.id = card_record.id
      and card.organization_id = target_organization_id;
    raise exception 'The loyalty card has expired.' using errcode = '23514';
  end if;

  if card_record.stamp_count >= card_record.stamp_target then
    raise exception 'This loyalty card already has a reward ready to claim.' using errcode = '23514';
  end if;

  if target_sale_id is not null then
    perform 1
    from public.sales sale
    where sale.id = target_sale_id
      and sale.organization_id = target_organization_id
      and sale.customer_id = card_record.customer_id
      and sale.status = 'completed'
    for key share;
    if not found then
      raise exception 'The completed sale does not belong to this loyalty-card customer.' using errcode = 'P0002';
    end if;
  end if;

  select shift.store_id, shift.register_id
  into resolved_store_id, resolved_register_id
  from public.shifts shift
  where shift.organization_id = target_organization_id
    and shift.opened_by_employee_id = actor_employee_id
    and shift.status = 'open'
  order by shift.opened_at desc
  limit 1;

  update public.loyalty_cards card
  set stamp_count = card.stamp_count + 1
  where card.id = card_record.id
    and card.organization_id = target_organization_id
  returning * into card_record;

  insert into public.loyalty_card_events (
    organization_id, loyalty_card_id, customer_id, event_type,
    stamp_count_before, stamp_delta, stamp_count_after,
    actor_employee_id, store_id, register_id, sale_id, idempotency_key, reason
  )
  values (
    target_organization_id, card_record.id, card_record.customer_id, 'STAMP_ADDED',
    card_record.stamp_count - 1, 1, card_record.stamp_count,
    actor_employee_id, resolved_store_id, resolved_register_id, target_sale_id, target_idempotency_key,
    coalesce(normalized_reason, 'Completed sale stamp.')
  );

  perform private.write_audit_log(
    target_organization_id,
    'LOYALTY_CARD_STAMP_ADDED',
    'loyalty.card.stamp',
    actor_employee_id,
    null,
    resolved_store_id,
    resolved_register_id,
    null,
    null,
    coalesce(normalized_reason, 'Completed sale stamp.'),
    jsonb_build_object(
      'loyalty_card_id', card_record.id,
      'customer_id', card_record.customer_id,
      'sale_id', target_sale_id,
      'stamp_count_before', card_record.stamp_count - 1,
      'stamp_count_after', card_record.stamp_count
    )
  );

  return query select card_record.id, card_record.stamp_count, card_record.stamp_target, card_record.status, false;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."adjust_customer_loyalty_points"("target_organization_id" "uuid", "target_customer_id" "uuid", "target_points_delta" integer, "target_reason" "text") RETURNS TABLE("loyalty_transaction_id" "uuid", "loyalty_points" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  normalized_reason text := btrim(coalesce(target_reason, ''));
  actor_employee_id uuid;
  created_transaction_id uuid;
  updated_balance integer;
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'customers.manage')) then
    raise exception 'Customer management permission is required.' using errcode = '42501';
  end if;

  if target_points_delta is null
    or target_points_delta = 0
    or target_points_delta not between -1000000 and 1000000
    or char_length(normalized_reason) not between 2 and 500 then
    raise exception 'Enter a non-zero adjustment and a reason between 2 and 500 characters.'
      using errcode = '23514';
  end if;

  select private.current_employee_id(target_organization_id)
  into actor_employee_id;

  if actor_employee_id is null then
    raise exception 'An active employee is required for a loyalty adjustment.' using errcode = '42501';
  end if;

  perform 1
  from public.customers customer
  where customer.id = target_customer_id
    and customer.organization_id = target_organization_id
    and customer.status = 'active'
  for update;

  if not found then
    raise exception 'The customer is not active in this organization.' using errcode = 'P0002';
  end if;

  insert into public.loyalty_transactions (
    organization_id,
    customer_id,
    entry_type,
    points_delta,
    note
  )
  values (
    target_organization_id,
    target_customer_id,
    'MANUAL_ADJUSTMENT',
    target_points_delta,
    normalized_reason
  )
  returning id into created_transaction_id;

  select coalesce(sum(transaction.points_delta), 0)::integer
  into updated_balance
  from public.loyalty_transactions transaction
  where transaction.organization_id = target_organization_id
    and transaction.customer_id = target_customer_id;

  perform private.write_audit_log(
    target_organization_id,
    'CUSTOMER_LOYALTY_ADJUSTED',
    'loyalty.adjust',
    actor_employee_id,
    null,
    null,
    null,
    null,
    abs(target_points_delta)::bigint,
    normalized_reason,
    jsonb_build_object(
      'customer_id', target_customer_id,
      'loyalty_transaction_id', created_transaction_id,
      'points_delta', target_points_delta,
      'resulting_balance', updated_balance
    )
  );

  return query select created_transaction_id, updated_balance;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."bootstrap_organization"("organization_name" "text", "store_name" "text", "register_name" "text", "currency_code" "text" DEFAULT 'PHP'::"text", "timezone_name" "text" DEFAULT 'Asia/Manila'::"text") RETURNS TABLE("organization_id" "uuid", "store_id" "uuid", "register_id" "uuid")
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $_$
declare
  current_user_id uuid := (select public.current_profile_id());
  normalized_organization_name text := btrim(organization_name);
  normalized_store_name text := btrim(store_name);
  normalized_register_name text := btrim(register_name);
  normalized_currency_code text := upper(btrim(currency_code));
  normalized_timezone text := btrim(timezone_name);
  new_organization_id uuid;
  new_store_id uuid;
  new_register_id uuid;
  new_employee_id uuid;
  owner_role_id uuid;
  admin_role_id uuid;
  manager_role_id uuid;
  cashier_role_id uuid;
  inventory_role_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if char_length(normalized_organization_name) not between 2 and 160 then
    raise exception 'Organization name must contain between 2 and 160 characters.' using errcode = '22023';
  end if;

  if char_length(normalized_store_name) not between 2 and 160 then
    raise exception 'Store name must contain between 2 and 160 characters.' using errcode = '22023';
  end if;

  if char_length(normalized_register_name) not between 2 and 160 then
    raise exception 'Register name must contain between 2 and 160 characters.' using errcode = '22023';
  end if;

  if normalized_currency_code !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be a three-letter ISO code.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_timezone_names where name = normalized_timezone
  ) then
    raise exception 'Timezone is not recognized by PostgreSQL.' using errcode = '22023';
  end if;

  insert into public.organizations (name, currency_code, timezone, created_by)
  values (normalized_organization_name, normalized_currency_code, normalized_timezone, current_user_id)
  returning id into new_organization_id;

  insert into public.roles (organization_id, name, code, description, is_system)
  values (new_organization_id, 'Owner', 'owner', 'Full organization ownership.', true)
  returning id into owner_role_id;
  insert into public.roles (organization_id, name, code, description, is_system)
  values (new_organization_id, 'Admin', 'admin', 'Administrative access without ownership controls.', true)
  returning id into admin_role_id;
  insert into public.roles (organization_id, name, code, description, is_system)
  values (new_organization_id, 'Manager', 'manager', 'Store management and operational oversight.', true)
  returning id into manager_role_id;
  insert into public.roles (organization_id, name, code, description, is_system)
  values (new_organization_id, 'Cashier', 'cashier', 'Point-of-sale and register operations.', true)
  returning id into cashier_role_id;
  insert into public.roles (organization_id, name, code, description, is_system)
  values (new_organization_id, 'Inventory Staff', 'inventory_staff', 'Product and inventory operations.', true)
  returning id into inventory_role_id;

  insert into public.role_permissions (organization_id, role_id, permission_code)
  select new_organization_id, owner_role_id, permission.code
  from public.permissions permission
  on conflict do nothing;

  insert into public.role_permissions (organization_id, role_id, permission_code)
  select new_organization_id, admin_role_id, permission.code
  from public.permissions permission
  where permission.code not in ('organization.manage', 'organization.archive', 'organization.lifecycle', 'recovery.manage')
  on conflict do nothing;

  insert into public.role_permissions (organization_id, role_id, permission_code)
  select new_organization_id, manager_role_id, permission.code
  from public.permissions permission
  where permission.code in (
    'sales.create', 'sales.refund', 'discounts.apply', 'prices.override',
    'receipts.view', 'receipts.reprint', 'shifts.open', 'shifts.close',
    'cash.pay_in', 'cash.pay_out', 'products.manage', 'products.view_cost',
    'inventory.manage', 'customers.manage', 'employees.manage',
    'reports.view', 'registers.manage', 'dashboard.view',
    'kitchen.view', 'kitchen.manage', 'pos.access', 'pos.edit_quantity',
    'pos.remove_item', 'payments.accept', 'tickets.manage', 'cash_drawer.open',
    'shifts.view_expected_cash', 'shifts.view_history', 'shifts.force_close',
    'inventory.view', 'inventory.adjust', 'inventory.count', 'inventory.receive',
    'inventory.purchase_orders', 'inventory.transfers', 'inventory.suppliers',
    'approvals.request', 'approvals.authorize', 'audit.view'
  )
  on conflict do nothing;

  insert into public.role_permissions (organization_id, role_id, permission_code)
  select new_organization_id, cashier_role_id, permission.code
  from public.permissions permission
  where permission.code in (
    'sales.create', 'discounts.apply', 'receipts.view', 'receipts.reprint',
    'shifts.open', 'shifts.close', 'cash.pay_in', 'cash.pay_out',
    'pos.access', 'pos.edit_quantity', 'pos.remove_item', 'payments.accept',
    'approvals.request'
  )
  on conflict do nothing;

  insert into public.role_permissions (organization_id, role_id, permission_code)
  select new_organization_id, inventory_role_id, permission.code
  from public.permissions permission
  where permission.code in (
    'products.manage', 'products.view_cost', 'inventory.manage',
    'inventory.view', 'inventory.adjust', 'inventory.count', 'inventory.receive',
    'inventory.purchase_orders', 'inventory.transfers', 'inventory.suppliers',
    'approvals.request'
  )
  on conflict do nothing;

  insert into public.stores (organization_id, name, code)
  values (new_organization_id, normalized_store_name, 'MAIN')
  returning id into new_store_id;
  insert into public.registers (organization_id, store_id, name, code)
  values (new_organization_id, new_store_id, normalized_register_name, 'REG-01')
  returning id into new_register_id;
  insert into public.employees (organization_id, profile_id, employee_number, job_title)
  values (
    new_organization_id,
    current_user_id,
    'OWNER-' || upper(substr(replace(current_user_id::text, '-', ''), 1, 8)),
    'Owner'
  )
  returning id into new_employee_id;
  insert into public.employee_roles (organization_id, employee_id, role_id)
  values (new_organization_id, new_employee_id, owner_role_id);
  insert into public.employee_stores (organization_id, employee_id, store_id)
  values (new_organization_id, new_employee_id, new_store_id);

  return query select new_organization_id, new_store_id, new_register_id;
end;
$_$;

CREATE OR REPLACE FUNCTION "public"."claim_loyalty_card_reward"("target_organization_id" "uuid", "target_loyalty_card_id" "uuid", "target_reason" "text", "target_sale_id" "uuid" DEFAULT NULL::"uuid", "target_idempotency_key" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("card_id" "uuid", "status" "text", "was_replayed" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_employee_id uuid;
  normalized_reason text := btrim(coalesce(target_reason, ''));
  card_record public.loyalty_cards%rowtype;
  previous_event public.loyalty_card_events%rowtype;
  resolved_store_id uuid;
  resolved_register_id uuid;
begin
  if (select private.current_profile_id()) is null
    or not (
      (select private.has_permission(target_organization_id, 'customers.manage'))
      or (select private.has_permission(target_organization_id, 'sales.create'))
    ) then
    raise exception 'Sales or customer management permission is required to claim this reward.' using errcode = '42501';
  end if;

  if target_idempotency_key is null
    or char_length(normalized_reason) not between 2 and 500 then
    raise exception 'Provide an action key and a claim reason between 2 and 500 characters.' using errcode = '23514';
  end if;

  select private.current_employee_id(target_organization_id)
  into actor_employee_id;
  if actor_employee_id is null then
    raise exception 'An active employee is required to claim a loyalty reward.' using errcode = '42501';
  end if;

  select event.*
  into previous_event
  from public.loyalty_card_events event
  where event.organization_id = target_organization_id
    and event.idempotency_key = target_idempotency_key
  for key share;

  if previous_event.id is not null then
    if previous_event.event_type <> 'REWARD_CLAIMED'
      or previous_event.loyalty_card_id <> target_loyalty_card_id then
      raise exception 'This loyalty action key is already in use.' using errcode = '23505';
    end if;

    select card.*
    into card_record
    from public.loyalty_cards card
    where card.id = target_loyalty_card_id
      and card.organization_id = target_organization_id;

    return query select card_record.id, card_record.status, true;
    return;
  end if;

  select card.*
  into card_record
  from public.loyalty_cards card
  join public.customers customer
    on customer.id = card.customer_id
   and customer.organization_id = card.organization_id
  where card.id = target_loyalty_card_id
    and card.organization_id = target_organization_id
    and card.status = 'active'
    and customer.status = 'active'
    and (card.expires_at is null or card.expires_at > now())
  for update of card;

  if card_record.id is null then
    raise exception 'The loyalty card is not active.' using errcode = 'P0002';
  end if;

  if card_record.stamp_count < card_record.stamp_target then
    raise exception 'This loyalty card has not reached its reward target.' using errcode = '23514';
  end if;

  if target_sale_id is not null then
    perform 1
    from public.sales sale
    where sale.id = target_sale_id
      and sale.organization_id = target_organization_id
      and sale.customer_id = card_record.customer_id
      and sale.status = 'completed'
    for key share;
    if not found then
      raise exception 'The completed sale does not belong to this loyalty-card customer.' using errcode = 'P0002';
    end if;
  end if;

  select shift.store_id, shift.register_id
  into resolved_store_id, resolved_register_id
  from public.shifts shift
  where shift.organization_id = target_organization_id
    and shift.opened_by_employee_id = actor_employee_id
    and shift.status = 'open'
  order by shift.opened_at desc
  limit 1;

  update public.loyalty_cards card
  set
    status = 'reward_claimed',
    deactivated_at = now(),
    deactivation_reason = normalized_reason
  where card.id = card_record.id
    and card.organization_id = target_organization_id
  returning * into card_record;

  insert into public.loyalty_card_events (
    organization_id, loyalty_card_id, customer_id, event_type,
    stamp_count_before, stamp_delta, stamp_count_after,
    actor_employee_id, store_id, register_id, sale_id, idempotency_key, reason
  )
  values (
    target_organization_id, card_record.id, card_record.customer_id, 'REWARD_CLAIMED',
    card_record.stamp_count, 0, card_record.stamp_count,
    actor_employee_id, resolved_store_id, resolved_register_id, target_sale_id, target_idempotency_key,
    normalized_reason
  );

  perform private.write_audit_log(
    target_organization_id,
    'LOYALTY_CARD_REWARD_CLAIMED',
    'loyalty.card.claim_reward',
    actor_employee_id,
    null,
    resolved_store_id,
    resolved_register_id,
    null,
    null,
    normalized_reason,
    jsonb_build_object(
      'loyalty_card_id', card_record.id,
      'customer_id', card_record.customer_id,
      'sale_id', target_sale_id,
      'stamp_count', card_record.stamp_count
    )
  );

  return query select card_record.id, card_record.status, false;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."create_custom_role"("target_organization_id" "uuid", "role_name" "text", "role_code" "text", "role_description" "text", "permission_codes" "text"[]) RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $_$
declare
  normalized_name text := btrim(role_name);
  normalized_code text := lower(btrim(role_code));
  normalized_description text := nullif(btrim(role_description), '');
  new_role_id uuid;
begin
  if (select public.current_profile_id()) is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if char_length(normalized_name) not between 2 and 80 then
    raise exception 'Role name must contain between 2 and 80 characters.' using errcode = '22023';
  end if;

  if normalized_code !~ '^[a-z][a-z0-9_]{1,39}$' then
    raise exception 'Role code has an invalid format.' using errcode = '22023';
  end if;

  if coalesce(cardinality(permission_codes), 0) = 0 then
    raise exception 'Select at least one permission.' using errcode = '22023';
  end if;

  insert into public.roles (
    organization_id,
    name,
    code,
    description,
    is_system
  )
  values (
    target_organization_id,
    normalized_name,
    normalized_code,
    normalized_description,
    false
  )
  returning id into new_role_id;

  insert into public.role_permissions (
    organization_id,
    role_id,
    permission_code
  )
  select
    target_organization_id,
    new_role_id,
    requested_permission.permission_code
  from (
    select distinct unnest(permission_codes) as permission_code
  ) requested_permission;

  return new_role_id;
end;
$_$;

CREATE OR REPLACE FUNCTION "public"."create_customer_segment"("target_organization_id" "uuid", "target_name" "text", "target_description" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  normalized_name text := btrim(coalesce(target_name, ''));
  normalized_description text := nullif(btrim(coalesce(target_description, '')), '');
  created_segment_id uuid;
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'customers.manage')) then
    raise exception 'Customer management permission is required.' using errcode = '42501';
  end if;

  if char_length(normalized_name) not between 1 and 80
    or (normalized_description is not null and char_length(normalized_description) not between 2 and 500) then
    raise exception 'Check the customer segment details.' using errcode = '23514';
  end if;

  insert into public.customer_segments (organization_id, name, description)
  values (target_organization_id, normalized_name, normalized_description)
  returning id into created_segment_id;

  return created_segment_id;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."create_product_unit"("target_organization_id" "uuid", "target_product_id" "uuid", "target_unit_code" "text", "target_unit_name" "text", "target_factor_to_base" numeric, "target_is_sale_unit" boolean, "target_is_purchase_unit" boolean, "target_operation_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  normalized_code text := lower(btrim(target_unit_code));
  normalized_name text := btrim(target_unit_name);
  payload jsonb;
  unit_id uuid := gen_random_uuid();
  replay_id uuid;
  actor_employee_id uuid;
begin
  if (select private.current_profile_id()) is null
     or not (select private.has_permission(target_organization_id, 'products.manage')) then
    raise exception 'Product management permission is required.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.products product
    where product.id = target_product_id and product.organization_id = target_organization_id
  ) then
    raise exception 'The product could not be found.' using errcode = '23503';
  end if;

  payload := jsonb_build_object(
    'product_id', target_product_id, 'unit_code', normalized_code,
    'unit_name', normalized_name, 'factor_to_base', target_factor_to_base,
    'is_sale_unit', target_is_sale_unit, 'is_purchase_unit', target_is_purchase_unit
  );
  replay_id := private.claim_product_unit_operation(
    target_organization_id, target_operation_id, 'create', payload, unit_id
  );
  if replay_id is not null then return replay_id; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_organization_id::text || ':' || target_product_id::text || ':product-unit:' || normalized_code, 0)
  );
  if exists (
    select 1 from public.product_units unit
    where unit.product_id = target_product_id and unit.unit_code = normalized_code
  ) then
    raise exception 'This unit code already exists for the product.' using errcode = '23505';
  end if;

  insert into public.product_units (
    id, organization_id, product_id, unit_code, unit_name, factor_to_base,
    is_base, is_sale_unit, is_purchase_unit
  ) values (
    unit_id, target_organization_id, target_product_id, normalized_code, normalized_name,
    target_factor_to_base, false, coalesce(target_is_sale_unit, false), coalesce(target_is_purchase_unit, false)
  );

  actor_employee_id := private.current_employee_id(target_organization_id);
  perform private.write_audit_log(
    target_organization_id, 'PRODUCT_UNIT_CREATED', 'products.manage', actor_employee_id,
    null, null, null, null, null, null,
    jsonb_build_object('product_id', target_product_id, 'unit_id', unit_id,
      'operation_id', target_operation_id, 'old_values', null, 'new_values', payload)
  );
  return unit_id;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."create_purchase_order_v2"("target_organization_id" "uuid", "target_store_id" "uuid", "target_supplier_id" "uuid", "target_notes" "text", "target_lines" "jsonb", "target_operation_id" "uuid", "target_expected_at" "date" DEFAULT NULL::"date") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  order_id uuid;
  was_existing boolean;
  actor_id uuid;
begin
  if (select private.current_profile_id()) is null
     or not (
       (select private.has_permission(target_organization_id, 'inventory.manage'))
       or (select private.has_inventory_capability(target_organization_id, 'purchasing.po.create'))
     )
     or not (select private.has_permission(target_organization_id, 'products.view_cost')) then
    raise exception 'Purchase-order creation and product-cost permission are required.' using errcode = '42501';
  end if;
  if target_operation_id is null then
    raise exception 'A stable purchase-order operation ID is required.' using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_organization_id::text || ':purchase-order:' || target_operation_id::text, 0)
  );
  was_existing := exists (
    select 1 from public.purchase_orders purchase_order
    where purchase_order.organization_id = target_organization_id
      and purchase_order.operation_id = target_operation_id
  );

  order_id := private.create_purchase_order(
    target_organization_id, target_store_id, target_supplier_id, target_notes,
    target_expected_at, target_lines, target_operation_id
  );

  if not was_existing then
    actor_id := private.inventory_actor(target_organization_id, target_store_id);
    perform private.write_audit_log(
      target_organization_id, 'PURCHASE_ORDER_CREATED', 'purchasing.po.create', actor_id,
      null, target_store_id, null, null, null, nullif(btrim(target_notes), ''),
      jsonb_build_object('purchase_order_id', order_id, 'supplier_id', target_supplier_id,
        'operation_id', target_operation_id)
    );
  end if;
  return order_id;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."create_store_scoped_payment_method"("target_organization_id" "uuid", "target_name" "text", "target_code" "text", "target_payment_type" "text", "target_requires_reference" boolean, "target_store_ids" "uuid"[]) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  normalized_name text := nullif(btrim(coalesce(target_name, '')), '');
  normalized_code text := upper(nullif(btrim(coalesce(target_code, '')), ''));
  normalized_payment_type text := upper(nullif(btrim(coalesce(target_payment_type, '')), ''));
  target_store_count integer := coalesce(cardinality(target_store_ids), 0);
  created_method_id uuid;
begin
  if target_organization_id is null
    or normalized_name is null
    or char_length(normalized_name) > 100
    or normalized_code is null
    or normalized_code !~ '^[A-Z][A-Z0-9_]{1,39}$'
    or normalized_payment_type is null
    or normalized_payment_type not in ('CASH', 'CARD', 'E_WALLET', 'BANK_TRANSFER', 'VOUCHER', 'OTHER')
    or target_requires_reference is null then
    raise exception 'Enter a valid payment method name, code, category, and reference setting.'
      using errcode = '23514';
  end if;

  if normalized_code in ('CASH', 'CARD', 'GCASH', 'MAYA', 'BANK_TRANSFER') then
    raise exception 'TINDIO default payment methods are managed from the preset list.'
      using errcode = '23514';
  end if;

  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'settings.manage')) then
    raise exception 'Settings permission is required to configure payment methods.' using errcode = '42501';
  end if;

  if target_store_count = 0
    or exists (
      select 1
      from unnest(target_store_ids) as requested(store_id)
      where requested.store_id is null
    )
    or target_store_count <> (
      select count(distinct requested.store_id)
      from unnest(target_store_ids) as requested(store_id)
    )
    or target_store_count <> (
      select count(*)
      from public.stores store
      where store.organization_id = target_organization_id
        and store.is_active
        and store.id = any(target_store_ids)
    ) then
    raise exception 'Select one or more unique active stores in this organization.'
      using errcode = '23514';
  end if;

  insert into public.payment_methods (
    organization_id,
    name,
    code,
    payment_type,
    requires_reference,
    sort_order
  )
  values (
    target_organization_id,
    normalized_name,
    normalized_code,
    normalized_payment_type,
    target_requires_reference,
    100
  )
  returning id into created_method_id;

  insert into public.store_payment_methods (
    organization_id,
    store_id,
    payment_method_id,
    is_enabled
  )
  select
    target_organization_id,
    requested.store_id,
    created_method_id,
    true
  from unnest(target_store_ids) as requested(store_id);

  return created_method_id;
end;
$_$;

CREATE OR REPLACE FUNCTION "public"."delete_product_unit"("target_organization_id" "uuid", "target_unit_id" "uuid", "target_operation_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  current_unit public.product_units%rowtype;
  payload jsonb := jsonb_build_object('unit_id', target_unit_id);
  replay_id uuid;
  old_values jsonb;
  actor_employee_id uuid;
begin
  if (select private.current_profile_id()) is null
     or not (select private.has_permission(target_organization_id, 'products.manage')) then
    raise exception 'Product management permission is required.' using errcode = '42501';
  end if;
  replay_id := private.claim_product_unit_operation(
    target_organization_id, target_operation_id, 'delete', payload, target_unit_id
  );
  if replay_id is not null then return replay_id; end if;

  select unit.* into current_unit
  from public.product_units unit
  where unit.id = target_unit_id and unit.organization_id = target_organization_id
  for update;
  if not found then raise exception 'The product unit could not be found.' using errcode = '23503'; end if;
  if current_unit.is_base then raise exception 'The base unit cannot be deleted.' using errcode = '23514'; end if;

  old_values := jsonb_build_object(
    'unit_code', current_unit.unit_code, 'unit_name', current_unit.unit_name,
    'factor_to_base', current_unit.factor_to_base, 'is_sale_unit', current_unit.is_sale_unit,
    'is_purchase_unit', current_unit.is_purchase_unit
  );
  delete from public.product_units where id = target_unit_id;

  actor_employee_id := private.current_employee_id(target_organization_id);
  perform private.write_audit_log(
    target_organization_id, 'PRODUCT_UNIT_DELETED', 'products.manage', actor_employee_id,
    null, null, null, null, null, null,
    jsonb_build_object('product_id', current_unit.product_id, 'unit_id', target_unit_id,
      'operation_id', target_operation_id, 'old_values', old_values, 'new_values', null)
  );
  return target_unit_id;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."delete_unused_setup_record"("target_organization_id" "uuid", "target_record_type" "text", "target_record_id" "uuid", "target_confirmation_name" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  required_permission text;
  record_name text;
  record_is_inactive boolean;
  record_is_system boolean;
  actor_employee_id uuid;
begin
  if target_record_type not in (
    'category',
    'custom_role',
    'payment_method',
    'discount',
    'tax_rate',
    'dining_option',
    'ticket_template',
    'modifier_group',
    'supplier'
  ) then
    raise exception 'This record type cannot be permanently deleted.' using errcode = '22023';
  end if;

  required_permission := case target_record_type
    when 'custom_role' then 'roles.manage'
    when 'payment_method' then 'settings.manage'
    when 'supplier' then 'inventory.manage'
    else 'products.manage'
  end;

  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, required_permission)) then
    raise exception 'You do not have permission to permanently delete this record.' using errcode = '42501';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select private.current_profile_id())
    and employee.status = 'active';

  case target_record_type
    when 'category' then
      select category.name, category.is_archived
      into record_name, record_is_inactive
      from public.categories category
      where category.id = target_record_id
        and category.organization_id = target_organization_id;

    when 'custom_role' then
      select role.name, false, role.is_system
      into record_name, record_is_inactive, record_is_system
      from public.roles role
      where role.id = target_record_id
        and role.organization_id = target_organization_id;

    when 'payment_method' then
      select payment_method.name, not payment_method.is_enabled
      into record_name, record_is_inactive
      from public.payment_methods payment_method
      where payment_method.id = target_record_id
        and payment_method.organization_id = target_organization_id;

    when 'discount' then
      select discount.name, not discount.is_active
      into record_name, record_is_inactive
      from public.discounts discount
      where discount.id = target_record_id
        and discount.organization_id = target_organization_id;

    when 'tax_rate' then
      select tax_rate.name, not tax_rate.is_active
      into record_name, record_is_inactive
      from public.tax_rates tax_rate
      where tax_rate.id = target_record_id
        and tax_rate.organization_id = target_organization_id;

    when 'dining_option' then
      select dining_option.name, not dining_option.is_active
      into record_name, record_is_inactive
      from public.dining_options dining_option
      where dining_option.id = target_record_id
        and dining_option.organization_id = target_organization_id;

    when 'ticket_template' then
      select ticket_template.label, not ticket_template.is_active
      into record_name, record_is_inactive
      from public.ticket_templates ticket_template
      where ticket_template.id = target_record_id
        and ticket_template.organization_id = target_organization_id;

    when 'modifier_group' then
      select modifier_group.name, not modifier_group.is_active
      into record_name, record_is_inactive
      from public.modifier_groups modifier_group
      where modifier_group.id = target_record_id
        and modifier_group.organization_id = target_organization_id;

    when 'supplier' then
      select supplier.name, not supplier.is_active
      into record_name, record_is_inactive
      from public.suppliers supplier
      where supplier.id = target_record_id
        and supplier.organization_id = target_organization_id;
  end case;

  if record_name is null then
    raise exception 'Select a record in this organization.' using errcode = '23503';
  end if;

  if target_record_type = 'custom_role' and record_is_system then
    raise exception 'System roles cannot be permanently deleted.' using errcode = '23514';
  end if;

  if target_record_type <> 'custom_role' and not record_is_inactive then
    raise exception 'Archive or disable this record before permanently deleting it.' using errcode = '23514';
  end if;

  if btrim(coalesce(target_confirmation_name, '')) <> record_name then
    raise exception 'Type the exact record name to confirm permanent deletion.' using errcode = '22023';
  end if;

  case target_record_type
    when 'category' then
      if exists (
        select 1 from public.products product
        where product.organization_id = target_organization_id
          and product.category_id = target_record_id
      ) then
        raise exception 'This category is still assigned to products. Reassign them before deletion.' using errcode = '23514';
      end if;

      if exists (
        select 1 from public.kitchen_station_category_routes route
        where route.organization_id = target_organization_id
          and route.category_id = target_record_id
      ) then
        raise exception 'This category is still assigned to a kitchen station. Remove that route before deletion.' using errcode = '23514';
      end if;

      delete from public.categories
      where id = target_record_id and organization_id = target_organization_id;

    when 'custom_role' then
      if exists (
        select 1 from public.employee_roles employee_role
        where employee_role.organization_id = target_organization_id
          and employee_role.role_id = target_record_id
      ) then
        raise exception 'This role is assigned to employees. Reassign them before deletion.' using errcode = '23514';
      end if;

      if exists (
        select 1 from public.employee_invitations invitation
        where invitation.organization_id = target_organization_id
          and invitation.role_id = target_record_id
      ) then
        raise exception 'This role is still referenced by an employee invitation. Revoke the invitation before deletion.' using errcode = '23514';
      end if;

      delete from public.roles
      where id = target_record_id and organization_id = target_organization_id and not is_system;

    when 'payment_method' then
      if exists (
        select 1 from public.payments payment
        where payment.organization_id = target_organization_id
          and payment.payment_method_id = target_record_id
      ) or exists (
        select 1 from public.refund_payments refund_payment
        where refund_payment.organization_id = target_organization_id
          and refund_payment.payment_method_id = target_record_id
      ) then
        raise exception 'This payment method appears in payment history and can only remain disabled.' using errcode = '23514';
      end if;

      delete from public.store_payment_methods
      where organization_id = target_organization_id and payment_method_id = target_record_id;

      delete from public.payment_methods
      where id = target_record_id and organization_id = target_organization_id;

    when 'discount' then
      if exists (
        select 1 from public.sales sale
        where sale.organization_id = target_organization_id
          and sale.discount_id = target_record_id
      ) then
        raise exception 'This discount appears in sales history and can only remain archived.' using errcode = '23514';
      end if;

      delete from public.discounts
      where id = target_record_id and organization_id = target_organization_id;

    when 'tax_rate' then
      if exists (
        select 1 from public.sales sale
        where sale.organization_id = target_organization_id
          and sale.tax_rate_id = target_record_id
      ) then
        raise exception 'This tax rate appears in sales history and can only remain archived.' using errcode = '23514';
      end if;

      delete from public.tax_rates
      where id = target_record_id and organization_id = target_organization_id;

    when 'dining_option' then
      if exists (
        select 1 from public.sales sale
        where sale.organization_id = target_organization_id
          and sale.dining_option_id = target_record_id
      ) or exists (
        select 1 from public.open_tickets ticket
        where ticket.organization_id = target_organization_id
          and ticket.dining_option_id = target_record_id
      ) then
        raise exception 'This dining option appears in ticket or sales history and can only remain archived.' using errcode = '23514';
      end if;

      if exists (
        select 1 from public.ticket_templates template
        where template.organization_id = target_organization_id
          and template.dining_option_id = target_record_id
      ) then
        raise exception 'This dining option is still used by ticket templates. Update those templates before deletion.' using errcode = '23514';
      end if;

      delete from public.dining_options
      where id = target_record_id and organization_id = target_organization_id;

    when 'ticket_template' then
      delete from public.ticket_templates
      where id = target_record_id and organization_id = target_organization_id;

    when 'modifier_group' then
      if exists (
        select 1 from public.product_modifier_groups assignment
        where assignment.organization_id = target_organization_id
          and assignment.modifier_group_id = target_record_id
      ) then
        raise exception 'This modifier group is still assigned to products. Remove those assignments before deletion.' using errcode = '23514';
      end if;

      delete from public.modifier_options
      where organization_id = target_organization_id and modifier_group_id = target_record_id;

      delete from public.modifier_groups
      where id = target_record_id and organization_id = target_organization_id;

    when 'supplier' then
      if exists (
        select 1 from public.purchase_orders purchase_order
        where purchase_order.organization_id = target_organization_id
          and purchase_order.supplier_id = target_record_id
      ) or exists (
        select 1 from public.supplier_returns supplier_return
        where supplier_return.organization_id = target_organization_id
          and supplier_return.supplier_id = target_record_id
      ) then
        raise exception 'This supplier appears in purchasing history and can only remain inactive.' using errcode = '23514';
      end if;

      delete from public.suppliers
      where id = target_record_id and organization_id = target_organization_id;
  end case;

  perform private.write_audit_log(
    target_organization_id,
    'SETUP_RECORD_DELETED',
    required_permission,
    actor_employee_id,
    null,
    null,
    null,
    null,
    null,
    null,
    jsonb_build_object(
      'record_type', target_record_type,
      'record_id', target_record_id,
      'record_name', record_name
    )
  );

  return record_name;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."get_customer_loyalty_card_events"("target_organization_id" "uuid", "target_customer_id" "uuid") RETURNS TABLE("event_id" "uuid", "loyalty_card_id" "uuid", "card_code" "text", "event_type" "text", "stamp_count_before" integer, "stamp_delta" integer, "stamp_count_after" integer, "sale_id" "uuid", "reason" "text", "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'customers.manage')) then
    raise exception 'Customer management permission is required.' using errcode = '42501';
  end if;

  return query
  select
    event.id,
    event.loyalty_card_id,
    card.card_code,
    event.event_type,
    event.stamp_count_before,
    event.stamp_delta,
    event.stamp_count_after,
    event.sale_id,
    event.reason,
    event.created_at
  from public.loyalty_card_events event
  join public.loyalty_cards card
    on card.id = event.loyalty_card_id
   and card.organization_id = event.organization_id
  where event.organization_id = target_organization_id
    and event.customer_id = target_customer_id
  order by event.created_at desc, event.id desc
  limit 50;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."get_customer_loyalty_cards"("target_organization_id" "uuid", "target_customer_id" "uuid") RETURNS TABLE("card_id" "uuid", "card_code" "text", "status" "text", "stamp_count" integer, "stamp_target" integer, "issued_at" timestamp with time zone, "expires_at" timestamp with time zone, "deactivated_at" timestamp with time zone, "deactivation_reason" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'customers.manage')) then
    raise exception 'Customer management permission is required.' using errcode = '42501';
  end if;

  return query
  select
    card.id,
    card.card_code,
    card.status,
    card.stamp_count,
    card.stamp_target,
    card.issued_at,
    card.expires_at,
    card.deactivated_at,
    card.deactivation_reason
  from public.loyalty_cards card
  where card.organization_id = target_organization_id
    and card.customer_id = target_customer_id
  order by card.issued_at desc, card.id desc;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."get_customer_purchase_history"("target_organization_id" "uuid", "target_customer_id" "uuid", "target_limit" integer) RETURNS TABLE("sale_id" "uuid", "receipt_number" bigint, "completed_at" timestamp with time zone, "total_minor" bigint, "currency_code" "text", "store_name" "text", "loyalty_points_earned" integer, "loyalty_points_redeemed" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if target_limit not between 1 and 100 then
    raise exception 'Purchase history limit must be between 1 and 100.' using errcode = '23514';
  end if;

  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'customers.manage')) then
    raise exception 'Customer management permission is required.' using errcode = '42501';
  end if;

  return query
  select
    sale.id,
    receipt.receipt_number,
    sale.completed_at,
    sale.total_minor,
    sale.currency_code,
    sale.store_name_snapshot,
    sale.loyalty_points_earned,
    sale.loyalty_points_redeemed
  from public.sales sale
  left join public.receipts receipt
    on receipt.sale_id = sale.id and receipt.organization_id = sale.organization_id
  where sale.organization_id = target_organization_id
    and sale.customer_id = target_customer_id
  order by sale.completed_at desc, sale.id desc
  limit target_limit;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."get_customer_summary"("target_organization_id" "uuid", "target_customer_id" "uuid") RETURNS TABLE("customer_id" "uuid", "full_name" "text", "status" "text", "sale_count" bigint, "lifetime_spend_minor" bigint, "average_sale_minor" bigint, "last_purchase_at" timestamp with time zone, "loyalty_points" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'customers.manage')) then
    raise exception 'Customer management permission is required.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.customers customer
    where customer.id = target_customer_id and customer.organization_id = target_organization_id
  ) then
    raise exception 'The customer was not found.' using errcode = 'P0002';
  end if;

  return query
  select
    customer.id,
    customer.full_name,
    customer.status,
    coalesce((
      select count(*) from public.sales sale
      where sale.organization_id = customer.organization_id and sale.customer_id = customer.id
    ), 0)::bigint,
    coalesce((
      select sum(sale.total_minor) from public.sales sale
      where sale.organization_id = customer.organization_id and sale.customer_id = customer.id
    ), 0)::bigint,
    coalesce((
      select avg(sale.total_minor)::bigint from public.sales sale
      where sale.organization_id = customer.organization_id and sale.customer_id = customer.id
    ), 0)::bigint,
    (
      select max(sale.completed_at) from public.sales sale
      where sale.organization_id = customer.organization_id and sale.customer_id = customer.id
    ),
    coalesce((
      select sum(transaction.points_delta)::integer from public.loyalty_transactions transaction
      where transaction.organization_id = customer.organization_id and transaction.customer_id = customer.id
    ), 0)::integer
  from public.customers customer
  where customer.id = target_customer_id and customer.organization_id = target_organization_id;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."get_dashboard_operational_snapshot"("target_organization_id" "uuid", "target_start_date" "date", "target_end_date" "date", "target_store_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  organization_timezone text;
  period_start timestamptz;
  period_end timestamptz;
  today_start timestamptz;
  tomorrow_start timestamptz;
  can_approve boolean;
  can_cost boolean;
  can_customers boolean;
  can_devices boolean;
  can_inventory boolean;
  can_manage_all_stores boolean;
  can_shifts boolean;
  can_team boolean;
  can_tickets boolean;
begin
  if (select private.current_profile_id()) is null
     or not (select private.has_permission(target_organization_id, 'dashboard.view')) then
    raise exception 'Dashboard access is required.' using errcode = '42501';
  end if;

  if target_start_date is null
     or target_end_date is null
     or target_end_date < target_start_date
     or target_end_date - target_start_date > 365 then
    raise exception 'Choose a dashboard range from one to 366 days.' using errcode = '22023';
  end if;

  select organization.timezone into organization_timezone
  from public.organizations organization
  where organization.id = target_organization_id;

  if organization_timezone is null then
    raise exception 'The organization could not be resolved.' using errcode = '23514';
  end if;

  can_manage_all_stores := (select private.has_permission(target_organization_id, 'stores.manage'));
  if target_store_id is not null and not exists (
    select 1 from public.stores store
    where store.id = target_store_id and store.organization_id = target_organization_id
  ) then
    raise exception 'Choose a store from this organization.' using errcode = '23514';
  end if;

  if not can_manage_all_stores then
    if target_store_id is null or not exists (
      select 1
      from public.employees employee
      join public.employee_stores assignment
        on assignment.employee_id = employee.id
       and assignment.organization_id = employee.organization_id
      where employee.organization_id = target_organization_id
        and employee.profile_id = (select private.current_profile_id())
        and employee.status = 'active'
        and assignment.store_id = target_store_id
    ) then
      raise exception 'Dashboard data is limited to an assigned store.' using errcode = '42501';
    end if;
  end if;

  can_approve := (select private.has_permission(target_organization_id, 'approvals.authorize'))
    or (select private.has_permission(target_organization_id, 'approvals.manage'))
    or (select private.has_permission(target_organization_id, 'audit.view'));
  can_cost := (select private.has_permission(target_organization_id, 'products.view_cost'));
  can_customers := (select private.has_permission(target_organization_id, 'customers.manage'));
  can_devices := (select private.has_permission(target_organization_id, 'devices.manage'));
  can_inventory := (select private.has_permission(target_organization_id, 'inventory.view'))
    or (select private.has_permission(target_organization_id, 'inventory.manage'));
  can_shifts := (select private.has_permission(target_organization_id, 'shifts.view_history'))
    or (select private.has_permission(target_organization_id, 'settings.manage'))
    or (select private.has_permission(target_organization_id, 'shifts.open'))
    or (select private.has_permission(target_organization_id, 'shifts.close'))
    or (select private.has_permission(target_organization_id, 'registers.manage'));
  can_team := (select private.has_permission(target_organization_id, 'employees.manage'))
    or (select private.has_permission(target_organization_id, 'settings.manage'));
  can_tickets := (select private.has_permission(target_organization_id, 'tickets.manage'));

  period_start := target_start_date::timestamp at time zone organization_timezone;
  period_end := (target_end_date + 1)::timestamp at time zone organization_timezone;
  today_start := ((now() at time zone organization_timezone)::date)::timestamp at time zone organization_timezone;
  tomorrow_start := (((now() at time zone organization_timezone)::date) + 1)::timestamp at time zone organization_timezone;

  return (
    with period_sales as materialized (
      select sale.id, sale.store_id, sale.customer_id, sale.total_minor
      from public.sales sale
      where sale.organization_id = target_organization_id
        and sale.completed_at >= period_start
        and sale.completed_at < period_end
        and (target_store_id is null or sale.store_id = target_store_id)
    ),
    period_refunds as materialized (
      select refund.store_id, refund.total_minor
      from public.refunds refund
      where refund.organization_id = target_organization_id
        and refund.completed_at >= period_start
        and refund.completed_at < period_end
        and (target_store_id is null or refund.store_id = target_store_id)
    ),
    sale_cost_coverage as (
      select
        count(*)::integer as sold_line_count,
        count(*) filter (where sale_item.unit_cost_minor = 0)::integer as missing_cost_line_count,
        count(distinct (sale_item.product_id, sale_item.variant_id))
          filter (where sale_item.unit_cost_minor = 0)::integer as missing_cost_item_count
      from public.sale_items sale_item
      join period_sales sale on sale.id = sale_item.sale_id
    ),
    inventory_positions as materialized (
      select
        level.store_id,
        level.quantity,
        level.average_cost_minor,
        coalesce(setting.low_stock_level, 0)::numeric as low_stock_level
      from public.inventory_levels level
      left join public.product_store_settings setting
        on setting.organization_id = level.organization_id
       and setting.store_id = level.store_id
       and setting.product_id = level.product_id
      where level.organization_id = target_organization_id
        and (target_store_id is null or level.store_id = target_store_id)
    ),
    store_sales as (
      select sale.store_id, count(*)::integer as transaction_count, sum(sale.total_minor)::bigint as sales_minor
      from period_sales sale group by sale.store_id
    ),
    store_refunds as (
      select refund.store_id, sum(refund.total_minor)::bigint as refunds_minor
      from period_refunds refund group by refund.store_id
    ),
    store_rows as (
      select
        store.id,
        store.name,
        coalesce(sale.transaction_count, 0)::integer as transaction_count,
        coalesce(sale.sales_minor, 0)::bigint as sales_minor,
        coalesce(refund.refunds_minor, 0)::bigint as refunds_minor
      from public.stores store
      left join store_sales sale on sale.store_id = store.id
      left join store_refunds refund on refund.store_id = store.id
      where store.organization_id = target_organization_id
        and store.is_active
        and (target_store_id is null or store.id = target_store_id)
    )
    select jsonb_build_object(
      'access', jsonb_build_object(
        'approvals', can_approve,
        'cost', can_cost,
        'customers', can_customers,
        'devices', can_devices,
        'inventory', can_inventory,
        'organization_wide', can_manage_all_stores,
        'shifts', can_shifts,
        'team', can_team,
        'tickets', can_tickets
      ),
      'cost', jsonb_build_object(
        'sold_line_count', case when can_cost then (select sold_line_count from sale_cost_coverage) else null end,
        'missing_sales_cost_line_count', case when can_cost then (select missing_cost_line_count from sale_cost_coverage) else null end,
        'missing_sales_cost_item_count', case when can_cost then (select missing_cost_item_count from sale_cost_coverage) else null end,
        'missing_inventory_cost_count', case when can_cost and can_inventory then (
          select count(*)::integer from inventory_positions position
          where position.quantity <> 0 and position.average_cost_minor = 0
        ) else null end
      ),
      'inventory', jsonb_build_object(
        'low_stock_count', case when can_inventory then (
          select count(*)::integer from inventory_positions position
          where position.quantity > 0
            and position.low_stock_level > 0
            and position.quantity <= position.low_stock_level
        ) else null end,
        'out_of_stock_count', case when can_inventory then (
          select count(*)::integer from inventory_positions position where position.quantity = 0
        ) else null end,
        'negative_stock_count', case when can_inventory then (
          select count(*)::integer from inventory_positions position where position.quantity < 0
        ) else null end
      ),
      'operations', jsonb_build_object(
        'active_register_count', case when can_shifts then (
          select count(*)::integer from public.registers register
          where register.organization_id = target_organization_id
            and register.is_active
            and (target_store_id is null or register.store_id = target_store_id)
        ) else null end,
        'open_register_count', case when can_shifts then (
          select count(distinct shift.register_id)::integer from public.shifts shift
          where shift.organization_id = target_organization_id
            and shift.status = 'open'
            and (target_store_id is null or shift.store_id = target_store_id)
        ) else null end,
        'active_shift_count', case when can_shifts then (
          select count(*)::integer from public.shifts shift
          where shift.organization_id = target_organization_id
            and shift.status = 'open'
            and (target_store_id is null or shift.store_id = target_store_id)
        ) else null end,
        'clocked_in_employee_count', case when can_team then (
          select count(distinct entry.employee_id)::integer from public.time_clock_entries entry
          where entry.organization_id = target_organization_id
            and entry.clocked_out_at is null
            and (target_store_id is null or entry.store_id = target_store_id)
        ) else null end,
        'pending_approval_count', case when can_approve then (
          select count(*)::integer from public.approval_requests request
          where request.organization_id = target_organization_id
            and request.status = 'PENDING'
            and request.expires_at > now()
            and (target_store_id is null or request.store_id is null or request.store_id = target_store_id)
        ) else null end,
        'sync_issue_count', case when can_devices then (
          select count(*)::integer from public.offline_sync_events event
          where event.organization_id = target_organization_id
            and event.state in ('CONFLICT', 'FAILED')
            and (target_store_id is null or event.store_id = target_store_id)
        ) else null end,
        'pending_sync_count', case when can_devices then (
          select count(*)::integer from public.offline_sync_events event
          where event.organization_id = target_organization_id
            and event.state in ('LOCAL_PENDING', 'SYNCING')
            and (target_store_id is null or event.store_id = target_store_id)
        ) else null end,
        'devices_not_seen_recently_count', case when can_devices then (
          select count(*)::integer from public.pos_devices device
          where device.organization_id = target_organization_id
            and device.status = 'active'
            and (device.last_seen_at is null or device.last_seen_at < now() - interval '15 minutes')
            and (target_store_id is null or device.store_id = target_store_id)
        ) else null end,
        'open_ticket_count', case when can_tickets then (
          select count(*)::integer from public.open_tickets ticket
          where ticket.organization_id = target_organization_id
            and ticket.status = 'open'
            and (target_store_id is null or ticket.store_id = target_store_id)
        ) else null end,
        'sales_today_count', (
          select count(*)::integer from public.sales sale
          where sale.organization_id = target_organization_id
            and sale.completed_at >= today_start
            and sale.completed_at < tomorrow_start
            and (target_store_id is null or sale.store_id = target_store_id)
        )
      ),
      'people', jsonb_build_object(
        'active_employee_count', case when can_team then (
          select count(*)::integer
          from public.employees employee
          where employee.organization_id = target_organization_id
            and employee.status = 'active'
            and (
              target_store_id is null
              or exists (
                select 1 from public.employee_stores assignment
                where assignment.organization_id = employee.organization_id
                  and assignment.employee_id = employee.id
                  and assignment.store_id = target_store_id
              )
            )
        ) else null end,
        'linked_customers_served', case when can_customers then (
          select count(distinct sale.customer_id)::integer from period_sales sale where sale.customer_id is not null
        ) else null end,
        'new_customer_count', case when can_customers then (
          select count(*)::integer from public.customers customer
          where customer.organization_id = target_organization_id
            and customer.created_at >= period_start
            and customer.created_at < period_end
            and exists (select 1 from period_sales sale where sale.customer_id = customer.id)
        ) else null end,
        'returning_customer_count', case when can_customers then (
          select count(distinct sale.customer_id)::integer
          from period_sales sale
          where sale.customer_id is not null
            and exists (
              select 1 from public.sales previous_sale
              where previous_sale.organization_id = target_organization_id
                and previous_sale.customer_id = sale.customer_id
                and previous_sale.completed_at < period_start
                and (target_store_id is null or previous_sale.store_id = target_store_id)
            )
        ) else null end
      ),
      'store_performance', case when can_manage_all_stores then (
        select coalesce(jsonb_agg(jsonb_build_object(
          'store_id', row.id,
          'name', row.name,
          'transaction_count', row.transaction_count,
          'net_sales_minor', row.sales_minor - row.refunds_minor,
          'average_order_minor', case when row.transaction_count > 0 then round(row.sales_minor::numeric / row.transaction_count)::bigint else 0 end
        ) order by row.sales_minor - row.refunds_minor desc, row.name), '[]'::jsonb)
        from store_rows row
      ) else '[]'::jsonb end
    )
  );
end;
$$;

CREATE OR REPLACE FUNCTION "public"."get_inventory_movement_costs"("target_organization_id" "uuid", "requested_movement_ids" "uuid"[]) RETURNS TABLE("id" "uuid", "unit_cost_minor" bigint, "value_delta_minor" bigint)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select movement.id, movement.unit_cost_minor, movement.value_delta_minor
  from public.inventory_movements movement
  where (select private.current_profile_id()) is not null
    and cardinality(requested_movement_ids) between 1 and 100
    and movement.id = any(requested_movement_ids)
    and movement.organization_id = target_organization_id
    and (select private.has_permission(target_organization_id, 'products.view_cost'))
    and (
      (select private.has_permission(target_organization_id, 'inventory.view'))
      or (select private.has_permission(target_organization_id, 'inventory.manage'))
    )
    and (select private.has_store_read_scope(target_organization_id, movement.store_id));
$$;

CREATE OR REPLACE FUNCTION "public"."get_inventory_stock_page"("target_organization_id" "uuid", "requested_store_id" "uuid" DEFAULT NULL::"uuid", "requested_search" "text" DEFAULT NULL::"text", "requested_category_id" "uuid" DEFAULT NULL::"uuid", "requested_status" "text" DEFAULT 'all'::"text", "requested_restock_policy" "text" DEFAULT 'all'::"text", "requested_sort" "text" DEFAULT 'priority'::"text", "requested_page" integer DEFAULT 1, "requested_page_size" integer DEFAULT 50) RETURNS TABLE("level_id" "uuid", "store_id" "uuid", "store_name" "text", "product_id" "uuid", "product_name" "text", "category_id" "uuid", "category_name" "text", "variant_id" "uuid", "variant_name" "text", "sku" "text", "barcode" "text", "unit" "text", "quantity" numeric, "updated_at" timestamp with time zone, "is_available" boolean, "restock_policy" "text", "reorder_point" numeric, "average_cost_minor" bigint, "total_count" bigint, "negative_count" bigint, "low_count" bigint, "in_stock_count" bigint, "out_of_stock_count" bigint, "active_product_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  normalized_search text := nullif(lower(btrim(coalesce(requested_search, ''))), '');
  normalized_status text := coalesce(nullif(btrim(requested_status), ''), 'all');
  normalized_restock_policy text := coalesce(nullif(btrim(requested_restock_policy), ''), 'all');
  normalized_sort text := coalesce(nullif(btrim(requested_sort), ''), 'priority');
  page_number integer := greatest(coalesce(requested_page, 1), 1);
  page_size integer := least(greatest(coalesce(requested_page_size, 50), 1), 100);
  can_read_cost boolean := false;
  can_manage_reorder boolean := false;
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_any_inventory_capability(
      target_organization_id,
      array[
        'inventory.view',
        'inventory.adjust.create',
        'inventory.adjust.post',
        'inventory.count.create',
        'inventory.count.finalize',
        'inventory.transfer.create',
        'inventory.transfer.send',
        'inventory.transfer.receive'
      ]
    )) then
    raise exception 'Inventory access is required.' using errcode = '42501';
  end if;

  if requested_store_id is not null
    and not (select private.has_store_read_scope(target_organization_id, requested_store_id)) then
    raise exception 'Store access is required to review stock.' using errcode = '42501';
  end if;

  if normalized_status not in ('all', 'attention', 'available', 'in_stock', 'low', 'negative', 'out_of_stock') then
    raise exception 'Choose a valid stock status.' using errcode = '22023';
  end if;
  if normalized_restock_policy not in ('all', 'restock', 'do_not_restock') then
    raise exception 'Choose a valid restock policy.' using errcode = '22023';
  end if;
  if normalized_sort not in ('priority', 'name_asc', 'name_desc', 'quantity_asc', 'quantity_desc', 'updated_desc', 'value_desc') then
    raise exception 'Choose a valid stock sort.' using errcode = '22023';
  end if;

  can_read_cost := (select private.has_permission(target_organization_id, 'products.view_cost'));
  can_manage_reorder := (select private.has_inventory_capability(target_organization_id, 'inventory.manage'));
  if not can_manage_reorder and normalized_status in ('attention', 'low') then
    normalized_status := 'all';
  end if;
  if not can_read_cost and normalized_sort = 'value_desc' then
    normalized_sort := 'priority';
  end if;

  return query
  with scoped_stores as materialized (
    select store.id, store.name
    from public.stores store
    where store.organization_id = target_organization_id
      and store.is_active
      and (requested_store_id is null or store.id = requested_store_id)
      and (select private.has_store_read_scope(target_organization_id, store.id))
  ),
  active_products as materialized (
    select product.id, product.category_id, product.name, product.sku, product.barcode, product.product_type, product.unit
    from public.products product
    where product.organization_id = target_organization_id
      and product.status = 'active'
      and product.track_inventory
  ),
  active_variants as materialized (
    select variant.id, variant.product_id, variant.name, variant.sku, variant.barcode
    from public.product_variants variant
    where variant.organization_id = target_organization_id
      and variant.is_active
  ),
  level_positions as (
    select
      level.id as level_id,
      store.id as store_id,
      store.name as store_name,
      product.id as product_id,
      product.name as product_name,
      product.category_id,
      category.name as category_name,
      variant.id as variant_id,
      variant.name as variant_name,
      coalesce(variant.sku, product.sku) as sku,
      coalesce(variant.barcode, product.barcode) as barcode,
      product.unit,
      level.quantity,
      level.updated_at,
      coalesce(setting.is_available, false) as is_available,
      coalesce(setting.restock_policy, 'restock') as restock_policy,
      case
        when can_manage_reorder then
          coalesce(
            rule.reorder_point,
            case
              when level.variant_id is null
                and product.product_type = 'simple'
              then setting.low_stock_level
              else null
            end
          )
        else null
      end as reorder_point,
      case when can_read_cost then level.average_cost_minor else null end as average_cost_minor
    from public.inventory_levels level
    join scoped_stores store on store.id = level.store_id
    join active_products product on product.id = level.product_id
    left join active_variants variant
      on variant.id = level.variant_id
     and variant.product_id = product.id
    left join public.categories category
      on category.id = product.category_id
     and category.organization_id = target_organization_id
    left join public.product_store_settings setting
      on setting.organization_id = target_organization_id
     and setting.store_id = level.store_id
     and setting.product_id = level.product_id
    left join public.inventory_replenishment_rules rule
      on rule.organization_id = target_organization_id
     and rule.store_id = level.store_id
     and rule.product_id = level.product_id
     and rule.variant_id is not distinct from level.variant_id
    where level.organization_id = target_organization_id
  ),
  uninitialized_simple_positions as (
    select
      null::uuid as level_id,
      store.id as store_id,
      store.name as store_name,
      product.id as product_id,
      product.name as product_name,
      product.category_id,
      category.name as category_name,
      null::uuid as variant_id,
      null::text as variant_name,
      product.sku,
      product.barcode,
      product.unit,
      0::numeric as quantity,
      setting.updated_at,
      setting.is_available,
      setting.restock_policy,
      case
        when can_manage_reorder then
          coalesce(
            rule.reorder_point,
            setting.low_stock_level
          )
        else null
      end as reorder_point,
      null::bigint as average_cost_minor
    from public.product_store_settings setting
    join scoped_stores store on store.id = setting.store_id
    join active_products product
      on product.id = setting.product_id
     and product.product_type = 'simple'
    left join public.categories category
      on category.id = product.category_id
     and category.organization_id = target_organization_id
    left join public.inventory_replenishment_rules rule
      on rule.organization_id = target_organization_id
     and rule.store_id = setting.store_id
     and rule.product_id = product.id
     and rule.variant_id is null
    left join public.inventory_levels level
      on level.organization_id = target_organization_id
     and level.store_id = setting.store_id
     and level.product_id = product.id
     and level.variant_id is null
    where setting.organization_id = target_organization_id
      and level.id is null
  ),
  uninitialized_variant_positions as (
    select
      null::uuid as level_id,
      store.id as store_id,
      store.name as store_name,
      product.id as product_id,
      product.name as product_name,
      product.category_id,
      category.name as category_name,
      variant.id as variant_id,
      variant.name as variant_name,
      coalesce(variant.sku, product.sku) as sku,
      coalesce(variant.barcode, product.barcode) as barcode,
      product.unit,
      0::numeric as quantity,
      setting.updated_at,
      setting.is_available,
      setting.restock_policy,
      case when can_manage_reorder then rule.reorder_point else null end as reorder_point,
      null::bigint as average_cost_minor
    from public.product_store_settings setting
    join scoped_stores store on store.id = setting.store_id
    join active_products product
      on product.id = setting.product_id
     and product.product_type = 'variable'
    join active_variants variant on variant.product_id = product.id
    left join public.categories category
      on category.id = product.category_id
     and category.organization_id = target_organization_id
    left join public.inventory_replenishment_rules rule
      on rule.organization_id = target_organization_id
     and rule.store_id = setting.store_id
     and rule.product_id = product.id
     and rule.variant_id = variant.id
    left join public.inventory_levels level
      on level.organization_id = target_organization_id
     and level.store_id = setting.store_id
     and level.product_id = product.id
     and level.variant_id = variant.id
    where setting.organization_id = target_organization_id
      and level.id is null
  ),
  positions as materialized (
    select * from level_positions
    union all
    select * from uninitialized_simple_positions
    union all
    select * from uninitialized_variant_positions
  ),
  classified as materialized (
    select
      position.*,
      case
        when position.quantity < 0 then 'negative'
        when position.reorder_point is not null and position.quantity <= position.reorder_point then
          case when position.quantity = 0 then 'out_of_stock' else 'low' end
        when position.quantity = 0 then 'out_of_stock'
        else 'in_stock'
      end as stock_condition
    from positions position
  ),
  filter_base as materialized (
    select *
    from classified position
    where (requested_category_id is null or position.category_id = requested_category_id)
      and (normalized_restock_policy = 'all' or position.restock_policy = normalized_restock_policy)
      and (
        normalized_search is null
        or lower(position.product_name) like '%' || normalized_search || '%'
        or lower(coalesce(position.variant_name, '')) like '%' || normalized_search || '%'
        or lower(coalesce(position.sku, '')) like '%' || normalized_search || '%'
        or lower(coalesce(position.barcode, '')) like '%' || normalized_search || '%'
      )
  ),
  metrics as materialized (
    select
      count(*) filter (where metric_position.stock_condition = 'negative') as negative_count,
      count(*) filter (where metric_position.stock_condition = 'low') as low_count,
      count(*) filter (where metric_position.stock_condition = 'in_stock') as in_stock_count,
      count(*) filter (where metric_position.stock_condition = 'out_of_stock') as out_of_stock_count,
      count(distinct metric_position.product_id) as active_product_count
    from filter_base metric_position
  ),
  filtered as materialized (
    select filter_position.*
    from filter_base filter_position
    where normalized_status = 'all'
      or (normalized_status = 'available' and filter_position.is_available)
      or (
        normalized_status = 'attention'
        and filter_position.stock_condition in ('low', 'negative', 'out_of_stock')
      )
      or filter_position.stock_condition = normalized_status
  ),
  paged as (
    select
      position.*,
      count(*) over () as total_count
    from filtered position
    order by
      case when normalized_sort = 'priority' then
        case position.stock_condition when 'negative' then 0 when 'low' then 1 when 'in_stock' then 2 else 3 end
      end asc,
      case when normalized_sort = 'name_asc' then lower(position.product_name) end asc,
      case when normalized_sort = 'name_desc' then lower(position.product_name) end desc,
      case when normalized_sort = 'quantity_asc' then position.quantity end asc,
      case when normalized_sort = 'quantity_desc' then position.quantity end desc,
      case when normalized_sort = 'updated_desc' then position.updated_at end desc,
      case when normalized_sort = 'value_desc' then coalesce(position.average_cost_minor, 0) * position.quantity end desc,
      lower(position.product_name) asc,
      lower(coalesce(position.variant_name, '')) asc,
      lower(position.store_name) asc,
      position.level_id asc nulls last
    limit page_size
    offset (page_number - 1) * page_size
  )
  select
    position.level_id,
    position.store_id,
    position.store_name,
    position.product_id,
    position.product_name,
    position.category_id,
    position.category_name,
    position.variant_id,
    position.variant_name,
    position.sku,
    position.barcode,
    position.unit,
    position.quantity,
    position.updated_at,
    position.is_available,
    position.restock_policy,
    position.reorder_point,
    position.average_cost_minor,
    position.total_count,
    metrics.negative_count,
    metrics.low_count,
    metrics.in_stock_count,
    metrics.out_of_stock_count,
    metrics.active_product_count
  from paged position
  cross join metrics;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."get_inventory_valuation"("target_organization_id" "uuid") RETURNS TABLE("store_id" "uuid", "product_id" "uuid", "variant_id" "uuid", "quantity" numeric, "average_cost_minor" bigint, "value_minor" bigint)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select
    level.store_id,
    level.product_id,
    level.variant_id,
    level.quantity,
    level.average_cost_minor,
    case
      when level.cost_is_known then round(level.quantity * level.average_cost_minor)::bigint
      else null::bigint
    end as value_minor
  from public.inventory_levels level
  where (select private.current_profile_id()) is not null
    and level.organization_id = target_organization_id
    and (select private.has_permission(target_organization_id, 'products.view_cost'))
    and (select private.has_inventory_capability(target_organization_id, 'inventory.valuation.view'))
    and (select private.has_store_read_scope(target_organization_id, level.store_id));
$$;

CREATE OR REPLACE FUNCTION "public"."get_pos_incoming_stock_transfers"("target_organization_id" "uuid") RETURNS TABLE("transfer_id" "uuid", "transfer_number" bigint, "stock_request_id" "uuid", "source_store_id" "uuid", "source_store_name" "text", "destination_store_id" "uuid", "destination_store_name" "text", "status" "text", "note" "text", "lines" "jsonb")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select transfer.id, transfer.transfer_number, transfer.stock_request_id, transfer.source_store_id, source_store.name,
    transfer.destination_store_id, destination_store.name, transfer.status, transfer.note,
    coalesce(jsonb_agg(jsonb_build_object('id', transfer_line.id,
      'label', product.name || coalesce(' / ' || variant.name, ''), 'unit', product.unit,
      'quantity', transfer_line.quantity, 'received_quantity', transfer_line.received_quantity,
      'short_quantity', transfer_line.short_quantity) order by product.name, variant.name nulls first)
      filter (where transfer_line.quantity > transfer_line.received_quantity + transfer_line.short_quantity), '[]'::jsonb)
  from public.stock_transfers transfer
  join public.stores source_store on source_store.id = transfer.source_store_id and source_store.organization_id = transfer.organization_id
  join public.stores destination_store on destination_store.id = transfer.destination_store_id and destination_store.organization_id = transfer.organization_id
  join public.stock_transfer_lines transfer_line on transfer_line.stock_transfer_id = transfer.id and transfer_line.organization_id = transfer.organization_id
  join public.products product on product.id = transfer_line.product_id and product.organization_id = transfer_line.organization_id
  left join public.product_variants variant on variant.id = transfer_line.variant_id and variant.product_id = transfer_line.product_id
    and variant.organization_id = transfer_line.organization_id
  where (select private.current_profile_id()) is not null
    and exists (select 1 from public.organizations organization where organization.id = target_organization_id and organization.status = 'active')
    and (select private.has_inventory_capability(target_organization_id, 'inventory.transfer.receive'))
    and exists (select 1 from public.organization_features feature where feature.organization_id = target_organization_id
      and feature.feature_key in ('inventory', 'transfers') and feature.is_enabled group by feature.organization_id having count(*) = 2)
    and transfer.organization_id = target_organization_id
    and transfer.status in ('dispatched', 'partially_received')
    and (select private.has_store_read_scope(target_organization_id, transfer.destination_store_id))
  group by transfer.id, transfer.transfer_number, transfer.stock_request_id, transfer.source_store_id, source_store.name,
    transfer.destination_store_id, destination_store.name, transfer.status, transfer.note
  having bool_or(transfer_line.quantity > transfer_line.received_quantity + transfer_line.short_quantity)
  order by transfer.transfer_number desc;
$$;

CREATE OR REPLACE FUNCTION "public"."get_pos_product_modifiers"("target_organization_id" "uuid", "target_product_id" "uuid") RETURNS TABLE("group_id" "uuid", "group_name" "text", "min_selections" smallint, "max_selections" smallint, "options" "jsonb")
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if (select public.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'sales.create')) then
    raise exception 'Sales permission is required.' using errcode = '42501';
  end if;

  return query
  select
    modifier_group.id,
    modifier_group.name,
    modifier_group.min_selections,
    modifier_group.max_selections,
    coalesce(jsonb_agg(jsonb_build_object(
      'id', modifier_option.id,
      'name', modifier_option.name,
      'price_minor', modifier_option.price_adjustment_minor
    ) order by modifier_option.sort_order, lower(modifier_option.name)) filter (where modifier_option.id is not null), '[]'::jsonb)
  from public.product_modifier_groups assignment
  join public.modifier_groups modifier_group
    on modifier_group.id = assignment.modifier_group_id
   and modifier_group.organization_id = assignment.organization_id
   and modifier_group.is_active
  left join public.modifier_options modifier_option
    on modifier_option.modifier_group_id = modifier_group.id
   and modifier_option.organization_id = modifier_group.organization_id
   and modifier_option.is_active
  where assignment.organization_id = target_organization_id
    and assignment.product_id = target_product_id
  group by modifier_group.id, modifier_group.name, modifier_group.min_selections, modifier_group.max_selections, assignment.sort_order
  order by assignment.sort_order, lower(modifier_group.name);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."get_pos_receipt_detail"("target_organization_id" "uuid", "target_receipt_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_employee_id uuid;
  can_access_store_receipts boolean := false;
  receipt_record record;
begin
  if target_organization_id is null or target_receipt_id is null then
    raise exception 'The POS receipt request is invalid.' using errcode = '23514';
  end if;

  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'sales.create'))
    or not (select private.has_permission(target_organization_id, 'receipts.view')) then
    raise exception 'Receipt permission is required to view POS receipts.' using errcode = '42501';
  end if;

  actor_employee_id := private.current_employee_id(target_organization_id);
  if actor_employee_id is null then
    raise exception 'An active employee is required to view POS receipts.' using errcode = '42501';
  end if;

  can_access_store_receipts :=
    (select private.has_permission(target_organization_id, 'sales.refund'))
    or (select private.has_permission(target_organization_id, 'approvals.authorize'));

  select
    receipt.id as receipt_id,
    receipt.receipt_number,
    receipt.issued_at,
    receipt.receipt_layout_snapshot,
    sale.id as sale_id,
    sale.store_id,
    sale.register_id,
    sale.cashier_employee_id,
    sale.customer_id,
    sale.currency_code,
    sale.organization_name_snapshot,
    sale.store_name_snapshot,
    sale.register_name_snapshot,
    sale.cashier_name_snapshot,
    sale.subtotal_minor,
    sale.discount_minor,
    sale.tax_minor,
    sale.total_minor
  into receipt_record
  from public.receipts receipt
  join public.sales sale
    on sale.id = receipt.sale_id
   and sale.organization_id = receipt.organization_id
  where receipt.id = target_receipt_id
    and receipt.organization_id = target_organization_id;

  if receipt_record.receipt_id is null then return null; end if;

  if not exists (
    select 1 from public.employee_stores employee_store
    where employee_store.organization_id = target_organization_id
      and employee_store.employee_id = actor_employee_id
      and employee_store.store_id = receipt_record.store_id
  ) or (receipt_record.cashier_employee_id <> actor_employee_id and not can_access_store_receipts) then
    raise exception 'Receipt access is not permitted for this POS employee.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'receipt', jsonb_build_object(
      'id', receipt_record.receipt_id,
      'number', receipt_record.receipt_number,
      'issuedAt', receipt_record.issued_at,
      'layout', receipt_record.receipt_layout_snapshot
    ),
    'customerEmail', (
      select customer.email from public.customers customer
      where customer.organization_id = target_organization_id
        and customer.id = receipt_record.customer_id
    ),
    'sale', jsonb_build_object(
      'id', receipt_record.sale_id,
      'storeId', receipt_record.store_id,
      'registerId', receipt_record.register_id,
      'currencyCode', receipt_record.currency_code,
      'organizationName', receipt_record.organization_name_snapshot,
      'storeName', receipt_record.store_name_snapshot,
      'registerName', receipt_record.register_name_snapshot,
      'cashierName', receipt_record.cashier_name_snapshot,
      'subtotalMinor', receipt_record.subtotal_minor,
      'discountMinor', receipt_record.discount_minor,
      'taxMinor', receipt_record.tax_minor,
      'totalMinor', receipt_record.total_minor
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'name', case when item.variant_name_snapshot is null then item.product_name_snapshot else item.product_name_snapshot || ' · ' || item.variant_name_snapshot end,
        'sku', item.sku_snapshot,
        'quantity', item.quantity,
        'unit', item.unit_snapshot,
        'unitPriceMinor', item.unit_price_minor,
        'lineTotalMinor', item.line_total_minor
      ) order by item.created_at)
      from public.sale_items item
      where item.organization_id = target_organization_id and item.sale_id = receipt_record.sale_id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', payment.id,
        'name', payment.payment_method_name_snapshot,
        'type', payment.payment_method_type_snapshot,
        'amountMinor', payment.amount_minor,
        'tenderedMinor', payment.amount_tendered_minor,
        'changeMinor', payment.change_given_minor,
        'referenceNumber', payment.reference_number
      ) order by payment.created_at)
      from public.payments payment
      where payment.organization_id = target_organization_id and payment.sale_id = receipt_record.sale_id
    ), '[]'::jsonb),
    'refunds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', refund.id,
        'number', refund.refund_number,
        'totalMinor', refund.total_minor,
        'completedAt', refund.completed_at,
        'reason', refund.reason,
        'paymentName', refund_payment.payment_method_name_snapshot,
        'paymentReference', refund_payment.reference_number,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', refund_item.id,
            'saleItemId', refund_item.sale_item_id,
            'name', case when refund_item.variant_name_snapshot is null then refund_item.product_name_snapshot else refund_item.product_name_snapshot || ' · ' || refund_item.variant_name_snapshot end,
            'quantity', refund_item.quantity,
            'unit', refund_item.unit_snapshot,
            'lineTotalMinor', refund_item.line_total_minor
          ) order by refund_item.created_at)
          from public.refund_items refund_item
          where refund_item.organization_id = target_organization_id and refund_item.refund_id = refund.id
        ), '[]'::jsonb)
      ) order by refund.completed_at desc)
      from public.refunds refund
      left join public.refund_payments refund_payment
        on refund_payment.organization_id = refund.organization_id
       and refund_payment.refund_id = refund.id
      where refund.organization_id = target_organization_id
        and refund.sale_id = receipt_record.sale_id
        and refund.status = 'completed'
    ), '[]'::jsonb)
  );
end;
$$;

CREATE OR REPLACE FUNCTION "public"."get_pos_receipt_history"("target_organization_id" "uuid", "target_query" "text" DEFAULT NULL::"text", "target_before_receipt_number" bigint DEFAULT NULL::bigint, "target_limit" integer DEFAULT 25) RETURNS TABLE("receipt_id" "uuid", "sale_id" "uuid", "receipt_number" bigint, "issued_at" timestamp with time zone, "store_id" "uuid", "register_id" "uuid", "store_name" "text", "register_name" "text", "cashier_name" "text", "total_minor" bigint, "currency_code" "text", "refund_total_minor" bigint, "refund_count" bigint, "has_refundable_quantity" boolean, "payment_methods" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  actor_employee_id uuid;
  normalized_query text := nullif(btrim(target_query), '');
  normalized_receipt_query text;
  receipt_query_is_numeric boolean := false;
  can_access_store_receipts boolean := false;
begin
  if target_organization_id is null
    or target_limit is null
    or target_limit not between 1 and 50
    or (target_before_receipt_number is not null and target_before_receipt_number < 1)
    or (normalized_query is not null and char_length(normalized_query) > 100) then
    raise exception 'The POS receipt request is invalid.' using errcode = '23514';
  end if;

  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'sales.create'))
    or not (select private.has_permission(target_organization_id, 'receipts.view')) then
    raise exception 'Receipt permission is required to view POS receipts.' using errcode = '42501';
  end if;

  actor_employee_id := private.current_employee_id(target_organization_id);
  if actor_employee_id is null then
    raise exception 'An active employee is required to view POS receipts.' using errcode = '42501';
  end if;

  can_access_store_receipts :=
    (select private.has_permission(target_organization_id, 'sales.refund'))
    or (select private.has_permission(target_organization_id, 'approvals.authorize'));

  if normalized_query ~ '^#?[0-9]+$' then
    receipt_query_is_numeric := true;
    normalized_receipt_query := ltrim(regexp_replace(normalized_query, '^#', ''), '0');
    if normalized_receipt_query = '' then normalized_receipt_query := '0'; end if;
  end if;

  return query
  select
    receipt.id,
    sale.id,
    receipt.receipt_number,
    receipt.issued_at,
    sale.store_id,
    sale.register_id,
    sale.store_name_snapshot,
    sale.register_name_snapshot,
    sale.cashier_name_snapshot,
    sale.total_minor,
    sale.currency_code,
    refund_summary.total_minor,
    refund_summary.refund_count,
    quantity_summary.has_refundable_quantity,
    payment_summary.methods
  from public.receipts receipt
  join public.sales sale
    on sale.id = receipt.sale_id
   and sale.organization_id = receipt.organization_id
  left join lateral (
    select
      coalesce(sum(refund.total_minor), 0)::bigint as total_minor,
      count(refund.id)::bigint as refund_count
    from public.refunds refund
    where refund.organization_id = target_organization_id
      and refund.sale_id = sale.id
      and refund.status = 'completed'
  ) refund_summary on true
  left join lateral (
    select coalesce(bool_or(
      sale_item.quantity > coalesce(refund_quantity.total_quantity, 0)
    ), false) as has_refundable_quantity
    from public.sale_items sale_item
    left join lateral (
      select coalesce(sum(refund_item.quantity), 0)::integer as total_quantity
      from public.refund_items refund_item
      join public.refunds refund
        on refund.id = refund_item.refund_id
       and refund.organization_id = refund_item.organization_id
       and refund.status = 'completed'
      where refund_item.organization_id = target_organization_id
        and refund.sale_id = sale.id
        and refund_item.sale_item_id = sale_item.id
    ) refund_quantity on true
    where sale_item.organization_id = target_organization_id
      and sale_item.sale_id = sale.id
  ) quantity_summary on true
  left join lateral (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', payment.payment_method_name_snapshot,
      'type', payment.payment_method_type_snapshot
    ) order by payment.created_at), '[]'::jsonb) as methods
    from public.payments payment
    where payment.organization_id = target_organization_id
      and payment.sale_id = sale.id
  ) payment_summary on true
  where receipt.organization_id = target_organization_id
    and exists (
      select 1
      from public.employee_stores employee_store
      where employee_store.organization_id = target_organization_id
        and employee_store.employee_id = actor_employee_id
        and employee_store.store_id = sale.store_id
    )
    and (sale.cashier_employee_id = actor_employee_id or can_access_store_receipts)
    and (target_before_receipt_number is null or receipt.receipt_number < target_before_receipt_number)
    and (
      normalized_query is null
      or (
        receipt_query_is_numeric
        and ltrim(receipt.receipt_number::text, '0') = normalized_receipt_query
      )
      or (
        not receipt_query_is_numeric
        and (
          sale.store_name_snapshot ilike '%' || normalized_query || '%'
          or sale.register_name_snapshot ilike '%' || normalized_query || '%'
          or sale.cashier_name_snapshot ilike '%' || normalized_query || '%'
        )
      )
    )
  -- Receipt number is the cursor, so it must remain the leading sort key.
  order by receipt.receipt_number desc, receipt.issued_at desc
  limit target_limit;
end;
$_$;

CREATE OR REPLACE FUNCTION "public"."get_pos_shift_operational_summary"("target_organization_id" "uuid", "target_shift_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  shift_record public.shifts%rowtype;
  cash_record record;
  opened_by_name text;
  store_name text;
  register_name text;
  show_expected_before_close boolean := true;
  gross_sales_minor bigint := 0;
  refunds_minor bigint := 0;
  discounts_minor bigint := 0;
  expected_cash_minor bigint := 0;
begin
  if target_organization_id is null or target_shift_id is null then
    raise exception 'The POS shift summary request is invalid.' using errcode = '23514';
  end if;

  if (select private.current_profile_id()) is null then
    raise exception 'Sign in is required to view a shift summary.' using errcode = '42501';
  end if;

  select shift.*
  into shift_record
  from public.shifts shift
  where shift.id = target_shift_id
    and shift.organization_id = target_organization_id;

  if shift_record.id is null then
    raise exception 'The shift was not found.' using errcode = 'P0002';
  end if;

  if not (select private.has_shift_access(target_organization_id, shift_record.store_id)) then
    raise exception 'Shift access is required.' using errcode = '42501';
  end if;

  select coalesce(profile.full_name, profile.email, 'Employee')
  into opened_by_name
  from public.employees employee
  join public.profiles profile on profile.id = employee.profile_id
  where employee.id = shift_record.opened_by_employee_id
    and employee.organization_id = target_organization_id;

  select store.name into store_name
  from public.stores store
  where store.id = shift_record.store_id
    and store.organization_id = target_organization_id;

  select register.name into register_name
  from public.registers register
  where register.id = shift_record.register_id
    and register.organization_id = target_organization_id;

  select * into cash_record from private.calculate_shift_cash(shift_record.id);
  select organization.show_expected_cash_before_close
  into show_expected_before_close
  from public.organizations organization
  where organization.id = target_organization_id;

  select
    coalesce(sum(sale.subtotal_minor), 0)::bigint,
    coalesce(sum(sale.discount_minor), 0)::bigint
  into gross_sales_minor, discounts_minor
  from public.sales sale
  where sale.organization_id = target_organization_id
    and sale.shift_id = shift_record.id;

  select coalesce(sum(refund.total_minor), 0)::bigint
  into refunds_minor
  from public.refunds refund
  where refund.organization_id = target_organization_id
    and refund.shift_id = shift_record.id;

  expected_cash_minor := case
    when shift_record.status = 'open' and not coalesce(show_expected_before_close, true) then null
    else cash_record.expected_cash_minor
  end;

  return jsonb_build_object(
    'shift', jsonb_build_object(
      'id', shift_record.id,
      'number', 'SHIFT-' || upper(left(shift_record.id::text, 8)),
      'status', shift_record.status,
      'openedBy', coalesce(opened_by_name, 'Employee'),
      'openedAt', shift_record.opened_at,
      'closedAt', shift_record.closed_at,
      'store', coalesce(store_name, 'Store'),
      'register', coalesce(register_name, 'Register'),
      'startingCashMinor', shift_record.opening_cash_minor,
      'actualCashMinor', shift_record.counted_cash_minor,
      'differenceMinor', shift_record.difference_minor
    ),
    'cash', jsonb_build_object(
      'cashPaymentsMinor', cash_record.cash_sales_minor,
      'cashRefundsMinor', cash_record.cash_refunds_minor,
      'paidInMinor', cash_record.pay_ins_minor,
      'paidOutMinor', cash_record.pay_outs_minor,
      'expectedCashMinor', expected_cash_minor
    ),
    'sales', jsonb_build_object(
      'grossSalesMinor', gross_sales_minor,
      'refundsMinor', refunds_minor,
      'discountsMinor', discounts_minor,
      'netSalesMinor', gross_sales_minor - refunds_minor - discounts_minor
    )
  );
end;
$$;

CREATE OR REPLACE FUNCTION "public"."get_purchase_order_line_costs"("target_organization_id" "uuid", "requested_purchase_order_line_ids" "uuid"[]) RETURNS TABLE("id" "uuid", "unit_cost_minor" bigint)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select line.id, line.unit_cost_minor
  from public.purchase_order_lines line
  join public.purchase_orders purchase
    on purchase.id = line.purchase_order_id
   and purchase.organization_id = line.organization_id
  where (select private.current_profile_id()) is not null
    and cardinality(requested_purchase_order_line_ids) between 1 and 100
    and line.id = any(requested_purchase_order_line_ids)
    and line.organization_id = target_organization_id
    and (select private.has_permission(target_organization_id, 'products.view_cost'))
    and (select private.has_permission(target_organization_id, 'inventory.manage'))
    and (select private.has_store_read_scope(target_organization_id, purchase.store_id));
$$;

CREATE OR REPLACE FUNCTION "public"."get_shift_audit_history"("target_organization_id" "uuid", "target_limit" integer DEFAULT 25) RETURNS TABLE("shift_id" "uuid", "store_id" "uuid", "register_id" "uuid", "opened_by_employee_id" "uuid", "opened_by_name" "text", "opening_cash_minor" bigint, "expected_cash_minor" bigint, "counted_cash_minor" bigint, "difference_minor" bigint, "opening_note" "text", "closing_note" "text", "opened_at" timestamp with time zone, "closed_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  viewer_employee_id uuid;
  can_manage_settings boolean := false;
  can_view_history boolean := false;
begin
  if target_organization_id is null or target_limit is null or target_limit < 1 or target_limit > 100 then
    raise exception 'The shift audit history request is invalid.' using errcode = '23514';
  end if;

  if (select private.current_profile_id()) is null then
    raise exception 'Sign in is required to view shift history.' using errcode = '42501';
  end if;

  select private.current_employee_id(target_organization_id) into viewer_employee_id;
  if viewer_employee_id is null then
    raise exception 'An active employee profile is required to view shift history.' using errcode = '42501';
  end if;

  can_manage_settings := (select private.has_permission(target_organization_id, 'settings.manage'));
  can_view_history := (select private.has_permission(target_organization_id, 'shifts.view_history'));
  if not can_manage_settings and not can_view_history then
    raise exception 'Shift history permission is required.' using errcode = '42501';
  end if;

  return query
  select
    shift.id,
    shift.store_id,
    shift.register_id,
    shift.opened_by_employee_id,
    coalesce(profile.full_name, profile.email, 'Employee'),
    shift.opening_cash_minor,
    shift.expected_cash_minor,
    shift.counted_cash_minor,
    shift.difference_minor,
    shift.opening_note,
    shift.closing_note,
    shift.opened_at,
    shift.closed_at
  from public.shifts shift
  left join public.employees employee
    on employee.id = shift.opened_by_employee_id
   and employee.organization_id = shift.organization_id
  left join public.profiles profile on profile.id = employee.profile_id
  where shift.organization_id = target_organization_id
    and shift.status = 'closed'
    and (
      can_manage_settings
      or exists (
        select 1
        from public.employee_stores employee_store
        where employee_store.organization_id = target_organization_id
          and employee_store.employee_id = viewer_employee_id
          and employee_store.store_id = shift.store_id
      )
    )
  order by shift.closed_at desc, shift.id desc
  limit target_limit;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."get_shift_audit_report"("target_organization_id" "uuid", "target_shift_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  viewer_employee_id uuid;
  target_store_id uuid;
begin
  if target_organization_id is null or target_shift_id is null then
    raise exception 'The shift audit report request is invalid.' using errcode = '23514';
  end if;

  if (select private.current_profile_id()) is null then
    raise exception 'Sign in is required to view a shift audit report.' using errcode = '42501';
  end if;

  if not (select private.has_permission(target_organization_id, 'settings.manage'))
     and not (select private.has_permission(target_organization_id, 'shifts.view_history')) then
    raise exception 'Shift history permission is required.' using errcode = '42501';
  end if;

  select private.current_employee_id(target_organization_id) into viewer_employee_id;
  select shift.store_id into target_store_id
  from public.shifts shift
  where shift.id = target_shift_id
    and shift.organization_id = target_organization_id
    and shift.status = 'closed';

  if viewer_employee_id is null or target_store_id is null then
    raise exception 'The closed shift was not found.' using errcode = 'P0002';
  end if;

  if not (select private.has_permission(target_organization_id, 'stores.manage'))
     and not exists (
       select 1
       from public.employee_stores assignment
       where assignment.organization_id = target_organization_id
         and assignment.employee_id = viewer_employee_id
         and assignment.store_id = target_store_id
     ) then
    raise exception 'You are not assigned to this shift store.' using errcode = '42501';
  end if;

  return public.get_shift_audit_report_internal(target_organization_id, target_shift_id);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."get_shift_audit_report_internal"("target_organization_id" "uuid", "target_shift_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  shift_record public.shifts%rowtype;
  cash_record record;
  viewer_employee_id uuid;
  can_manage_settings boolean := false;
  can_view_history boolean := false;
  can_view_audit boolean := false;
  opened_by_name text;
  closed_by_name text;
  store_name text;
  register_name text;
  gross_sales_minor bigint := 0;
  discounts_minor bigint := 0;
  tax_minor bigint := 0;
  sales_total_minor bigint := 0;
  sale_count integer := 0;
  refunds_minor bigint := 0;
  refund_count integer := 0;
  payment_breakdown jsonb := '[]'::jsonb;
  cash_movement_rows jsonb := '[]'::jsonb;
  audit_rows jsonb := '[]'::jsonb;
begin
  if target_organization_id is null or target_shift_id is null then
    raise exception 'The shift audit report request is invalid.' using errcode = '23514';
  end if;

  if (select private.current_profile_id()) is null then
    raise exception 'Sign in is required to view a shift audit report.' using errcode = '42501';
  end if;

  select private.current_employee_id(target_organization_id)
  into viewer_employee_id;

  if viewer_employee_id is null then
    raise exception 'An active employee profile is required to view a shift audit report.' using errcode = '42501';
  end if;

  select shift.*
  into shift_record
  from public.shifts shift
  where shift.id = target_shift_id
    and shift.organization_id = target_organization_id;

  if shift_record.id is null or shift_record.status <> 'closed' then
    raise exception 'The closed shift was not found.' using errcode = 'P0002';
  end if;

  can_manage_settings := (select private.has_permission(target_organization_id, 'settings.manage'));
  can_view_history := (select private.has_permission(target_organization_id, 'shifts.view_history'));

  if not can_manage_settings and not can_view_history then
    raise exception 'Shift history permission is required.' using errcode = '42501';
  end if;

  if not can_manage_settings and not exists (
    select 1
    from public.employee_stores employee_store
    where employee_store.organization_id = target_organization_id
      and employee_store.employee_id = viewer_employee_id
      and employee_store.store_id = shift_record.store_id
  ) then
    raise exception 'You are not assigned to this shift store.' using errcode = '42501';
  end if;

  select coalesce(profile.full_name, profile.email, 'Employee')
  into opened_by_name
  from public.employees employee
  join public.profiles profile on profile.id = employee.profile_id
  where employee.id = shift_record.opened_by_employee_id
    and employee.organization_id = target_organization_id;

  select coalesce(profile.full_name, profile.email, 'Employee')
  into closed_by_name
  from public.employees employee
  join public.profiles profile on profile.id = employee.profile_id
  where employee.id = shift_record.closed_by_employee_id
    and employee.organization_id = target_organization_id;

  select store.name
  into store_name
  from public.stores store
  where store.id = shift_record.store_id
    and store.organization_id = target_organization_id;

  select register.name
  into register_name
  from public.registers register
  where register.id = shift_record.register_id
    and register.organization_id = target_organization_id;

  select *
  into cash_record
  from private.calculate_shift_cash(shift_record.id);

  select
    coalesce(sum(sale.subtotal_minor), 0)::bigint,
    coalesce(sum(sale.discount_minor), 0)::bigint,
    coalesce(sum(sale.tax_minor), 0)::bigint,
    coalesce(sum(sale.total_minor), 0)::bigint,
    count(*)::integer
  into gross_sales_minor, discounts_minor, tax_minor, sales_total_minor, sale_count
  from public.sales sale
  where sale.organization_id = target_organization_id
    and sale.shift_id = shift_record.id;

  select
    coalesce(sum(refund.total_minor), 0)::bigint,
    count(*)::integer
  into refunds_minor, refund_count
  from public.refunds refund
  where refund.organization_id = target_organization_id
    and refund.shift_id = shift_record.id;

  with payment_activity as (
    select
      payment.payment_method_name_snapshot as payment_name,
      payment.payment_method_type_snapshot as payment_type,
      sum(payment.amount_minor)::bigint as sales_minor,
      0::bigint as refunds_minor,
      count(*)::integer as sale_payment_count,
      0::integer as refund_payment_count
    from public.payments payment
    join public.sales sale
      on sale.id = payment.sale_id
     and sale.organization_id = payment.organization_id
    where payment.organization_id = target_organization_id
      and sale.shift_id = shift_record.id
    group by payment.payment_method_name_snapshot, payment.payment_method_type_snapshot

    union all

    select
      refund_payment.payment_method_name_snapshot as payment_name,
      refund_payment.payment_method_type_snapshot as payment_type,
      0::bigint as sales_minor,
      sum(refund_payment.amount_minor)::bigint as refunds_minor,
      0::integer as sale_payment_count,
      count(*)::integer as refund_payment_count
    from public.refund_payments refund_payment
    join public.refunds refund
      on refund.id = refund_payment.refund_id
     and refund.organization_id = refund_payment.organization_id
    where refund_payment.organization_id = target_organization_id
      and refund.shift_id = shift_record.id
    group by refund_payment.payment_method_name_snapshot, refund_payment.payment_method_type_snapshot
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', breakdown.payment_name,
        'type', breakdown.payment_type,
        'salesMinor', breakdown.sales_minor,
        'refundsMinor', breakdown.refunds_minor,
        'netMinor', breakdown.sales_minor - breakdown.refunds_minor,
        'salePaymentCount', breakdown.sale_payment_count,
        'refundPaymentCount', breakdown.refund_payment_count
      )
      order by lower(breakdown.payment_name), breakdown.payment_type
    ),
    '[]'::jsonb
  )
  into payment_breakdown
  from (
    select
      payment_name,
      payment_type,
      sum(payment_activity.sales_minor)::bigint as sales_minor,
      sum(payment_activity.refunds_minor)::bigint as refunds_minor,
      sum(payment_activity.sale_payment_count)::integer as sale_payment_count,
      sum(payment_activity.refund_payment_count)::integer as refund_payment_count
    from payment_activity
    group by payment_name, payment_type
  ) breakdown;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', movement.id,
        'type', movement.movement_type,
        'amountMinor', movement.amount_minor,
        'reason', movement.reason,
        'createdAt', movement.created_at,
        'employee', coalesce(profile.full_name, profile.email, 'Employee')
      )
      order by movement.created_at desc, movement.id desc
    ),
    '[]'::jsonb
  )
  into cash_movement_rows
  from public.cash_movements movement
  left join public.employees employee
    on employee.id = movement.employee_id
   and employee.organization_id = movement.organization_id
  left join public.profiles profile on profile.id = employee.profile_id
  where movement.organization_id = target_organization_id
    and movement.shift_id = shift_record.id;

  can_view_audit := (select private.has_permission(target_organization_id, 'audit.view'));

  if can_view_audit then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', audit_event.id,
          'eventType', audit_event.event_type,
          'operationCode', audit_event.operation_code,
          'amountMinor', audit_event.amount_minor,
          'reason', audit_event.reason,
          'createdAt', audit_event.created_at,
          'actor', coalesce(profile.full_name, profile.email, 'System'),
          'metadata', audit_event.metadata
        )
        order by audit_event.created_at desc, audit_event.id desc
      ),
      '[]'::jsonb
    )
    into audit_rows
    from (
      select audit.*
      from public.audit_logs audit
      where audit.organization_id = target_organization_id
        and (
          audit.metadata ->> 'shift_id' = shift_record.id::text
          or audit.metadata ->> 'sale_id' in (
            select sale.id::text
            from public.sales sale
            where sale.organization_id = target_organization_id
              and sale.shift_id = shift_record.id
          )
        )
      order by audit.created_at desc, audit.id desc
      limit 100
    ) audit_event
    left join public.employees employee
      on employee.id = audit_event.actor_employee_id
     and employee.organization_id = audit_event.organization_id
    left join public.profiles profile on profile.id = employee.profile_id;
  end if;

  return jsonb_build_object(
    'shift', jsonb_build_object(
      'id', shift_record.id,
      'number', 'SHIFT-' || upper(left(shift_record.id::text, 8)),
      'store', coalesce(store_name, 'Store'),
      'register', coalesce(register_name, 'Register'),
      'openedBy', coalesce(opened_by_name, 'Employee'),
      'closedBy', coalesce(closed_by_name, 'Employee'),
      'openedAt', shift_record.opened_at,
      'closedAt', shift_record.closed_at,
      'openingCashMinor', shift_record.opening_cash_minor,
      'expectedCashMinor', shift_record.expected_cash_minor,
      'countedCashMinor', shift_record.counted_cash_minor,
      'differenceMinor', shift_record.difference_minor,
      'openingNote', shift_record.opening_note,
      'closingNote', shift_record.closing_note
    ),
    'cash', jsonb_build_object(
      'cashPaymentsMinor', cash_record.cash_sales_minor,
      'cashRefundsMinor', cash_record.cash_refunds_minor,
      'paidInMinor', cash_record.pay_ins_minor,
      'paidOutMinor', cash_record.pay_outs_minor,
      'calculatedExpectedCashMinor', cash_record.expected_cash_minor
    ),
    'sales', jsonb_build_object(
      'saleCount', sale_count,
      'grossSalesMinor', gross_sales_minor,
      'discountsMinor', discounts_minor,
      'taxMinor', tax_minor,
      'salesTotalMinor', sales_total_minor,
      'refundCount', refund_count,
      'refundsMinor', refunds_minor,
      'netSalesMinor', sales_total_minor - refunds_minor
    ),
    'paymentBreakdown', payment_breakdown,
    'cashMovements', cash_movement_rows,
    'audit', jsonb_build_object(
      'available', can_view_audit,
      'events', audit_rows,
      'lifecycle', jsonb_build_array(
        jsonb_build_object(
          'eventType', 'SHIFT_OPENED',
          'createdAt', shift_record.opened_at,
          'actor', coalesce(opened_by_name, 'Employee'),
          'reason', shift_record.opening_note
        ),
        jsonb_build_object(
          'eventType', 'SHIFT_CLOSED',
          'createdAt', shift_record.closed_at,
          'actor', coalesce(closed_by_name, 'Employee'),
          'reason', shift_record.closing_note
        )
      )
    )
  );
end;
$$;

CREATE OR REPLACE FUNCTION "public"."issue_loyalty_card"("target_organization_id" "uuid", "target_customer_id" "uuid", "target_card_code" "text", "target_verification_token" "text", "target_replaces_card_id" "uuid" DEFAULT NULL::"uuid", "target_reason" "text" DEFAULT NULL::"text") RETURNS TABLE("card_id" "uuid", "card_code" "text", "stamp_count" integer, "stamp_target" integer, "status" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  actor_employee_id uuid;
  normalized_card_code text := upper(btrim(coalesce(target_card_code, '')));
  normalized_reason text := nullif(btrim(coalesce(target_reason, '')), '');
  existing_card public.loyalty_cards%rowtype;
  issued_card public.loyalty_cards%rowtype;
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'customers.manage')) then
    raise exception 'Customer management permission is required.' using errcode = '42501';
  end if;

  if normalized_card_code !~ '^TND-LY-[A-Z0-9]{10}$'
    or target_verification_token !~ '^[a-f0-9]{64}$'
    or (target_replaces_card_id is not null and char_length(coalesce(normalized_reason, '')) not between 2 and 500) then
    raise exception 'The loyalty card details are invalid.' using errcode = '23514';
  end if;

  select private.current_employee_id(target_organization_id)
  into actor_employee_id;
  if actor_employee_id is null then
    raise exception 'An active employee is required to issue a loyalty card.' using errcode = '42501';
  end if;

  perform 1
  from public.customers customer
  where customer.id = target_customer_id
    and customer.organization_id = target_organization_id
    and customer.status = 'active'
  for key share;
  if not found then
    raise exception 'The customer is not active in this organization.' using errcode = 'P0002';
  end if;

  if target_replaces_card_id is not null then
    select card.*
    into existing_card
    from public.loyalty_cards card
    where card.id = target_replaces_card_id
      and card.organization_id = target_organization_id
      and card.customer_id = target_customer_id
      and card.status in ('active', 'reward_claimed')
    for update;

    if existing_card.id is null then
      raise exception 'The active loyalty card could not be replaced.' using errcode = 'P0002';
    end if;

    update public.loyalty_cards card
    set
      status = 'replaced',
      deactivated_at = now(),
      deactivation_reason = normalized_reason
    where card.id = existing_card.id
      and card.organization_id = target_organization_id;

    insert into public.loyalty_card_events (
      organization_id, loyalty_card_id, customer_id, event_type,
      stamp_count_before, stamp_delta, stamp_count_after,
      actor_employee_id, reason
    )
    values (
      target_organization_id, existing_card.id, target_customer_id, 'REPLACED',
      existing_card.stamp_count, 0, existing_card.stamp_count,
      actor_employee_id, normalized_reason
    );
  elsif exists (
    select 1
    from public.loyalty_cards card
    where card.organization_id = target_organization_id
      and card.customer_id = target_customer_id
      and card.status = 'active'
  ) then
    raise exception 'This customer already has an active QR loyalty card.' using errcode = '23505';
  end if;

  insert into public.loyalty_cards (
    organization_id,
    customer_id,
    card_code,
    verification_token_hash,
    replaces_card_id,
    issued_by_employee_id
  )
  values (
    target_organization_id,
    target_customer_id,
    normalized_card_code,
    extensions.digest(target_verification_token, 'sha256'),
    target_replaces_card_id,
    actor_employee_id
  )
  returning * into issued_card;

  insert into public.loyalty_card_events (
    organization_id, loyalty_card_id, customer_id, event_type,
    stamp_count_before, stamp_delta, stamp_count_after,
    actor_employee_id, reason
  )
  values (
    target_organization_id, issued_card.id, target_customer_id, 'ISSUED',
    0, 0, 0,
    actor_employee_id, normalized_reason
  );

  perform private.write_audit_log(
    target_organization_id,
    'LOYALTY_CARD_ISSUED',
    'loyalty.card.issue',
    actor_employee_id,
    null,
    null,
    null,
    null,
    null,
    normalized_reason,
    jsonb_build_object(
      'customer_id', target_customer_id,
      'loyalty_card_id', issued_card.id,
      'card_code', issued_card.card_code,
      'replaces_card_id', target_replaces_card_id
    )
  );

  return query select issued_card.id, issued_card.card_code, issued_card.stamp_count, issued_card.stamp_target, issued_card.status;
end;
$_$;

CREATE OR REPLACE FUNCTION "public"."link_sale_exchange"("target_organization_id" "uuid", "target_refund_id" "uuid", "target_replacement_receipt_number" bigint, "target_idempotency_key" "uuid") RETURNS TABLE("exchange_id" "uuid", "replacement_sale_id" "uuid", "replacement_receipt_number" bigint, "was_replayed" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_employee_id uuid;
  refund_record public.refunds%rowtype;
  replacement_sale_record public.sales%rowtype;
  original_sale_id uuid;
  canonical_payload jsonb;
  existing_actor_employee_id uuid;
  existing_payload jsonb;
  existing_exchange_id uuid;
  existing_replacement_sale_id uuid;
  existing_replacement_receipt_number bigint;
  new_exchange_id uuid;
begin
  if target_organization_id is null
    or target_refund_id is null
    or target_replacement_receipt_number is null
    or target_replacement_receipt_number <= 0
    or target_idempotency_key is null
    or (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'sales.refund'))
    or not (select private.has_permission(target_organization_id, 'sales.create')) then
    raise exception 'Sales and refund permission are required to record an exchange.' using errcode = '42501';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select private.current_profile_id())
    and employee.status = 'active'
  order by employee.created_at
  limit 1;

  if actor_employee_id is null then
    raise exception 'An active employee record is required.' using errcode = '42501';
  end if;

  canonical_payload := jsonb_build_object(
    'refund_id', target_refund_id,
    'replacement_receipt_number', target_replacement_receipt_number
  );

  select
    exchange.linked_by_employee_id,
    jsonb_build_object(
      'refund_id', exchange.refund_id,
      'replacement_receipt_number', receipt.receipt_number
    ),
    exchange.id,
    exchange.replacement_sale_id,
    receipt.receipt_number
  into
    existing_actor_employee_id,
    existing_payload,
    existing_exchange_id,
    existing_replacement_sale_id,
    existing_replacement_receipt_number
  from public.sale_exchanges exchange
  join public.receipts receipt
    on receipt.sale_id = exchange.replacement_sale_id
   and receipt.organization_id = exchange.organization_id
  where exchange.organization_id = target_organization_id
    and exchange.idempotency_key = target_idempotency_key
  for update of exchange;

  if found then
    if existing_actor_employee_id is distinct from actor_employee_id
      or existing_payload is distinct from canonical_payload then
      raise exception 'This exchange key was already used for a different request.' using errcode = '23505';
    end if;

    return query select existing_exchange_id, existing_replacement_sale_id, existing_replacement_receipt_number, true;
    return;
  end if;

  select refund.*
  into refund_record
  from public.refunds refund
  where refund.id = target_refund_id
    and refund.organization_id = target_organization_id
    and refund.status = 'completed'
  for key share;

  if refund_record.id is null then
    raise exception 'The completed return was not found.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.employee_stores employee_store
    where employee_store.organization_id = target_organization_id
      and employee_store.employee_id = actor_employee_id
      and employee_store.store_id = refund_record.store_id
  ) then
    raise exception 'An assignment to the return store is required.' using errcode = '42501';
  end if;

  select sale.*
  into replacement_sale_record
  from public.receipts receipt
  join public.sales sale
    on sale.id = receipt.sale_id
   and sale.organization_id = receipt.organization_id
  where receipt.organization_id = target_organization_id
    and receipt.receipt_number = target_replacement_receipt_number
    and sale.status = 'completed'
  for key share of sale;

  if replacement_sale_record.id is null then
    raise exception 'The replacement receipt was not found.' using errcode = 'P0002';
  end if;

  original_sale_id := refund_record.sale_id;
  if replacement_sale_record.id = original_sale_id then
    raise exception 'A return cannot be exchanged against its original sale.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.sale_exchanges exchange
    where exchange.organization_id = target_organization_id
      and (exchange.refund_id = target_refund_id or exchange.replacement_sale_id = replacement_sale_record.id)
  ) then
    raise exception 'That return or replacement sale is already linked to an exchange.' using errcode = '23505';
  end if;

  insert into public.sale_exchanges (
    organization_id,
    refund_id,
    replacement_sale_id,
    linked_by_employee_id,
    idempotency_key
  )
  values (
    target_organization_id,
    target_refund_id,
    replacement_sale_record.id,
    actor_employee_id,
    target_idempotency_key
  )
  returning id into new_exchange_id;

  return query select new_exchange_id, replacement_sale_record.id, target_replacement_receipt_number, false;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."produce_composite"("target_organization_id" "uuid", "target_store_id" "uuid", "target_product_id" "uuid", "target_quantity" numeric, "target_note" "text", "target_operation_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_id uuid;
  run_id uuid := gen_random_uuid();
  existing_run public.production_runs%rowtype;
  output_level public.inventory_levels%rowtype;
  component_level public.inventory_levels%rowtype;
  component record;
  normalized_note text := nullif(btrim(target_note), '');
  normalized_payload jsonb;
  recipe_snapshot jsonb;
  cost_snapshot jsonb := '[]'::jsonb;
  component_quantity numeric(14,3);
  total_cost numeric := 0;
  output_unit_cost bigint;
  components_cost_known boolean := true;
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'inventory.manage')) then
    raise exception 'Inventory permission is required.' using errcode = '42501';
  end if;

  if target_operation_id is null then
    raise exception 'A stable production operation ID is required.' using errcode = '23514';
  end if;

  if target_quantity is null
    or target_quantity <= 0
    or target_quantity <> round(target_quantity, 3) then
    raise exception 'Production quantity must be positive and use at most three decimals.' using errcode = '23514';
  end if;

  normalized_payload := jsonb_build_object(
    'store_id', target_store_id,
    'product_id', target_product_id,
    'quantity', target_quantity,
    'note', normalized_note,
    'composite_inventory_mode', 'stocked_assembly'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_organization_id::text || ':composite-production:' || target_operation_id::text,
      0
    )
  );

  select production_run.*
  into existing_run
  from public.production_runs production_run
  where production_run.organization_id = target_organization_id
    and production_run.operation_id = target_operation_id;

  if found then
    if existing_run.normalized_payload is distinct from normalized_payload then
      raise exception 'This operation ID is already assigned to a different production payload.'
        using errcode = '23505';
    end if;
    return existing_run.id;
  end if;

  actor_id := private.inventory_actor(target_organization_id, target_store_id);
  if actor_id is null then
    raise exception 'An assigned employee is required for this store.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.products product
    where product.id = target_product_id
      and product.organization_id = target_organization_id
      and product.is_composite
      and product.composite_inventory_mode = 'stocked_assembly'
      and product.track_inventory
      and product.status = 'active'
  ) then
    raise exception 'Choose an active stocked-assembly composite product.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.product_components recipe
    join public.products component_product
      on component_product.id = recipe.component_product_id
     and component_product.organization_id = recipe.organization_id
    where recipe.organization_id = target_organization_id
      and recipe.product_id = target_product_id
      and not component_product.track_inventory
  ) then
    raise exception 'Stocked assembly recipe components must track inventory.'
      using errcode = '23514';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'component_product_id', recipe.component_product_id,
        'component_variant_id', recipe.component_variant_id,
        'quantity_per_composite', recipe.quantity_per_composite,
        'unit_snapshot', component_product.unit
      )
      order by recipe.component_product_id, recipe.component_variant_id
    ),
    '[]'::jsonb
  )
  into recipe_snapshot
  from public.product_components recipe
  join public.products component_product
    on component_product.id = recipe.component_product_id
   and component_product.organization_id = recipe.organization_id
   and component_product.track_inventory
  where recipe.organization_id = target_organization_id
    and recipe.product_id = target_product_id;

  if jsonb_array_length(recipe_snapshot) = 0 then
    raise exception 'This stocked assembly needs at least one tracked recipe component.'
      using errcode = '23514';
  end if;

  -- Lock every participating stock projection in deterministic identity order.
  perform 1
  from public.inventory_levels level
  where level.organization_id = target_organization_id
    and level.store_id = target_store_id
    and (
      (level.product_id = target_product_id and level.variant_id is null)
      or exists (
        select 1
        from jsonb_to_recordset(recipe_snapshot) as recipe(
          component_product_id uuid,
          component_variant_id uuid,
          quantity_per_composite numeric,
          unit_snapshot text
        )
        where recipe.component_product_id = level.product_id
          and recipe.component_variant_id is not distinct from level.variant_id
      )
    )
  order by level.product_id, level.variant_id nulls first
  for update;

  select level.*
  into output_level
  from public.inventory_levels level
  where level.organization_id = target_organization_id
    and level.store_id = target_store_id
    and level.product_id = target_product_id
    and level.variant_id is null;

  if output_level.id is null then
    raise exception 'The composite output stock projection is not initialized.'
      using errcode = '23514';
  end if;

  for component in
    select *
    from jsonb_to_recordset(recipe_snapshot) as recipe(
      component_product_id uuid,
      component_variant_id uuid,
      quantity_per_composite numeric,
      unit_snapshot text
    )
    order by component_product_id, component_variant_id
  loop
    component_quantity := round(component.quantity_per_composite * target_quantity, 3);

    select level.*
    into component_level
    from public.inventory_levels level
    where level.organization_id = target_organization_id
      and level.store_id = target_store_id
      and level.product_id = component.component_product_id
      and level.variant_id is not distinct from component.component_variant_id;

    if component_level.id is null then
      raise exception 'One production component has no initialized stock projection.'
        using errcode = '23514';
    end if;

    if component_level.quantity < component_quantity then
      raise exception 'One production component has insufficient stock.'
        using errcode = '23514';
    end if;

    total_cost := total_cost + component_quantity * component_level.average_cost_minor;
    components_cost_known := components_cost_known and component_level.cost_is_known;

    cost_snapshot := cost_snapshot || jsonb_build_array(
      jsonb_build_object(
        'component_product_id', component.component_product_id,
        'component_variant_id', component.component_variant_id,
        'quantity_per_composite', component.quantity_per_composite,
        'quantity_consumed', component_quantity,
        'unit_snapshot', component.unit_snapshot,
        'unit_cost_minor', component_level.average_cost_minor,
        'cost_is_known', component_level.cost_is_known,
        'total_cost_minor', round(component_quantity * component_level.average_cost_minor)::bigint
      )
    );
  end loop;

  output_unit_cost := round(total_cost / target_quantity)::bigint;

  insert into public.production_runs (
    id,
    organization_id,
    store_id,
    product_id,
    quantity_produced,
    produced_by_employee_id,
    note,
    operation_id,
    cost_is_known,
    normalized_payload,
    composite_inventory_mode_snapshot
  ) values (
    run_id,
    target_organization_id,
    target_store_id,
    target_product_id,
    target_quantity,
    actor_id,
    normalized_note,
    target_operation_id,
    components_cost_known,
    normalized_payload,
    'stocked_assembly'
  );

  insert into public.production_run_components (
    organization_id,
    production_run_id,
    component_product_id,
    component_variant_id,
    quantity_per_composite_snapshot,
    quantity_consumed,
    unit_snapshot,
    unit_cost_minor,
    cost_is_known,
    total_cost_minor
  )
  select
    target_organization_id,
    run_id,
    snapshot_component.component_product_id,
    snapshot_component.component_variant_id,
    snapshot_component.quantity_per_composite,
    snapshot_component.quantity_consumed,
    snapshot_component.unit_snapshot,
    snapshot_component.unit_cost_minor,
    snapshot_component.cost_is_known,
    snapshot_component.total_cost_minor
  from jsonb_to_recordset(cost_snapshot) as snapshot_component(
    component_product_id uuid,
    component_variant_id uuid,
    quantity_per_composite numeric,
    quantity_consumed numeric,
    unit_snapshot text,
    unit_cost_minor bigint,
    cost_is_known boolean,
    total_cost_minor bigint
  );

  for component in
    select *
    from jsonb_to_recordset(cost_snapshot) as recipe(
      component_product_id uuid,
      component_variant_id uuid,
      quantity_per_composite numeric,
      quantity_consumed numeric,
      unit_snapshot text,
      unit_cost_minor bigint,
      cost_is_known boolean,
      total_cost_minor bigint
    )
    order by component_product_id, component_variant_id
  loop
    perform private.apply_inventory_change_v2(
      target_organization_id,
      target_store_id,
      component.component_product_id,
      component.component_variant_id,
      -component.quantity_consumed,
      'PRODUCTION',
      actor_id,
      'Consumed by production',
      'production_run',
      run_id,
      component.unit_cost_minor
    );
  end loop;

  perform private.apply_inventory_change_v2(
    target_organization_id,
    target_store_id,
    target_product_id,
    null,
    target_quantity,
    'PRODUCTION',
    actor_id,
    'Produced composite stock',
    'production_run',
    run_id,
    output_unit_cost
  );

  perform private.write_audit_log(
    target_organization_id,
    'PRODUCTION_COMPLETED',
    'inventory.manage',
    actor_id,
    null,
    target_store_id,
    null,
    null,
    null,
    target_note,
    jsonb_build_object(
      'production_run_id', run_id,
      'product_id', target_product_id,
      'quantity', target_quantity,
      'unit_cost_minor', output_unit_cost,
      'cost_is_known', components_cost_known,
      'operation_id', target_operation_id,
      'composite_inventory_mode', 'stocked_assembly'
    )
  );

  return run_id;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."queue_receipt_delivery"("target_organization_id" "uuid", "target_receipt_id" "uuid", "target_delivery_channel" "text", "target_recipient" "text", "target_idempotency_key" "uuid") RETURNS TABLE("delivery_request_id" "uuid", "delivery_status" "text", "was_replayed" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_employee_id uuid;
  normalized_channel text;
  normalized_recipient text;
  canonical_payload jsonb;
  existing_actor_employee_id uuid;
  existing_payload jsonb;
  existing_delivery_id uuid;
  existing_status text;
  new_delivery_id uuid;
begin
  if target_organization_id is null or target_receipt_id is null or target_idempotency_key is null
    or (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'receipts.reprint')) then
    raise exception 'Receipt reprint permission is required.' using errcode = '42501';
  end if;
  normalized_channel := upper(trim(coalesce(target_delivery_channel, '')));
  normalized_recipient := lower(trim(coalesce(target_recipient, '')));
  if normalized_channel <> 'EMAIL' or not private.valid_receipt_email(normalized_recipient) then
    raise exception 'Enter a valid email address for this digital receipt.' using errcode = '23514';
  end if;

  actor_employee_id := private.current_employee_id(target_organization_id);
  if actor_employee_id is null then
    raise exception 'An active employee record is required.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.receipts receipt
    where receipt.id = target_receipt_id
      and receipt.organization_id = target_organization_id
      and (select private.has_sale_read_scope(receipt.organization_id, receipt.sale_id))
  ) then
    raise exception 'The receipt was not found in your store scope.' using errcode = '42501';
  end if;

  canonical_payload := jsonb_build_object('delivery_channel', normalized_channel, 'recipient', normalized_recipient, 'receipt_id', target_receipt_id);
  select request.requested_by_employee_id,
    jsonb_build_object('delivery_channel', request.delivery_channel, 'recipient', request.recipient, 'receipt_id', request.receipt_id),
    request.id, request.status
  into existing_actor_employee_id, existing_payload, existing_delivery_id, existing_status
  from public.receipt_delivery_requests request
  where request.organization_id = target_organization_id and request.idempotency_key = target_idempotency_key
  for update;

  if found then
    if existing_actor_employee_id is distinct from actor_employee_id or existing_payload is distinct from canonical_payload then
      raise exception 'This delivery key was already used for a different request.' using errcode = '23505';
    end if;
    return query select existing_delivery_id, existing_status, true;
    return;
  end if;

  insert into public.receipt_delivery_requests (
    organization_id, receipt_id, requested_by_employee_id, idempotency_key, delivery_channel, recipient
  ) values (
    target_organization_id, target_receipt_id, actor_employee_id, target_idempotency_key, normalized_channel, normalized_recipient
  ) returning id into new_delivery_id;
  return query select new_delivery_id, 'QUEUED'::text, false;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."record_offline_sync_event"("target_organization_id" "uuid", "target_store_id" "uuid", "target_register_id" "uuid", "target_shift_id" "uuid", "target_device_id" "uuid", "target_idempotency_key" "uuid", "target_local_receipt_reference" "text", "target_local_created_at" timestamp with time zone, "target_state" "text", "target_conflict_type" "text", "target_failure_message" "text", "target_official_receipt_number" bigint DEFAULT NULL::bigint) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  actor_employee_id uuid;
  actor_name text;
  selected_store_name text;
  selected_register_name text;
  selected_device_name text;
  normalized_state text := upper(nullif(btrim(coalesce(target_state, '')), ''));
  normalized_conflict_type text := upper(nullif(btrim(coalesce(target_conflict_type, '')), ''));
  normalized_message text := nullif(left(btrim(coalesce(target_failure_message, '')), 1000), '');
  normalized_receipt_reference text := upper(nullif(btrim(coalesce(target_local_receipt_reference, '')), ''));
  event_id uuid;
begin
  if target_organization_id is null
    or target_store_id is null
    or target_register_id is null
    or target_idempotency_key is null
    or normalized_receipt_reference is null
    or normalized_receipt_reference !~ '^OFF-[A-Z0-9]{6,32}$'
    or normalized_state not in ('LOCAL_PENDING', 'SYNCING', 'SYNCED', 'CONFLICT', 'FAILED')
    or (normalized_state in ('CONFLICT', 'FAILED') and (
      normalized_conflict_type is null
      or normalized_conflict_type not in (
        'DUPLICATE_TRANSACTION', 'INVALID_SHIFT', 'CLOSED_SHIFT',
        'PRODUCT_ARCHIVED', 'PRICE_CHANGED', 'TAX_CHANGED', 'CUSTOMER_INVALID',
        'INVENTORY_CONFLICT', 'PERMISSION_CHANGED', 'REGISTER_REVOKED', 'DEVICE_REVOKED'
      )
      or normalized_message is null
    )) then
    raise exception 'The offline synchronization event is invalid.' using errcode = '23514';
  end if;

  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'sales.create')) then
    raise exception 'Sales permission is required to report offline synchronization.' using errcode = '42501';
  end if;

  select employee.id, coalesce(nullif(profile.full_name, ''), profile.email)
  into actor_employee_id, actor_name
  from public.employees employee
  join public.profiles profile on profile.id = employee.profile_id
  join public.employee_stores employee_store
    on employee_store.organization_id = employee.organization_id
   and employee_store.employee_id = employee.id
   and employee_store.store_id = target_store_id
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select private.current_profile_id())
    and employee.status = 'active';

  if actor_employee_id is null then
    raise exception 'An active store assignment is required to report offline synchronization.' using errcode = '42501';
  end if;

  select store.name, register.name
  into selected_store_name, selected_register_name
  from public.stores store
  join public.registers register
    on register.id = target_register_id
   and register.organization_id = store.organization_id
   and register.store_id = store.id
  where store.id = target_store_id
    and store.organization_id = target_organization_id;

  if selected_store_name is null then
    raise exception 'The offline sale register is not valid for this organization.' using errcode = '23514';
  end if;

  if target_shift_id is not null and not exists (
    select 1
    from public.shifts shift
    where shift.id = target_shift_id
      and shift.organization_id = target_organization_id
      and shift.store_id = target_store_id
      and shift.register_id = target_register_id
      and shift.opened_by_employee_id = actor_employee_id
  ) then
    raise exception 'The offline sale shift is not valid for this store and register.' using errcode = '23514';
  end if;

  if target_device_id is not null then
    select device.name
    into selected_device_name
    from public.pos_devices device
    where device.id = target_device_id
      and device.organization_id = target_organization_id
      and device.store_id = target_store_id
      and device.register_id = target_register_id;

    if selected_device_name is null then
      raise exception 'The offline sale device is not bound to this store and register.' using errcode = '23514';
    end if;
  end if;

  insert into public.offline_sync_events (
    organization_id, idempotency_key, local_receipt_reference, state,
    conflict_type, failure_message, store_id, register_id, shift_id, device_id,
    employee_id, store_name_snapshot, register_name_snapshot,
    device_name_snapshot, employee_name_snapshot, local_created_at,
    last_attempt_at, attempt_count, official_receipt_number
  ) values (
    target_organization_id, target_idempotency_key, normalized_receipt_reference,
    normalized_state,
    case when normalized_state in ('CONFLICT', 'FAILED') then normalized_conflict_type else null end,
    case when normalized_state in ('CONFLICT', 'FAILED') then normalized_message else null end,
    target_store_id, target_register_id, target_shift_id, target_device_id,
    actor_employee_id, selected_store_name, selected_register_name,
    selected_device_name, actor_name, target_local_created_at,
    now(), 1, target_official_receipt_number
  )
  on conflict (organization_id, idempotency_key) do update
  set
    local_receipt_reference = excluded.local_receipt_reference,
    state = excluded.state,
    conflict_type = excluded.conflict_type,
    failure_message = excluded.failure_message,
    store_id = excluded.store_id,
    register_id = excluded.register_id,
    shift_id = excluded.shift_id,
    device_id = excluded.device_id,
    employee_id = excluded.employee_id,
    store_name_snapshot = excluded.store_name_snapshot,
    register_name_snapshot = excluded.register_name_snapshot,
    device_name_snapshot = excluded.device_name_snapshot,
    employee_name_snapshot = excluded.employee_name_snapshot,
    local_created_at = excluded.local_created_at,
    last_attempt_at = now(),
    attempt_count = public.offline_sync_events.attempt_count + 1,
    official_receipt_number = coalesce(excluded.official_receipt_number, public.offline_sync_events.official_receipt_number)
  returning id into event_id;

  return event_id;
end;
$_$;

CREATE OR REPLACE FUNCTION "public"."restore_tindio_payment_preset"("target_organization_id" "uuid", "target_preset_code" "text", "target_store_ids" "uuid"[]) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  normalized_preset_code text := upper(nullif(btrim(coalesce(target_preset_code, '')), ''));
  preset_name text;
  preset_payment_type text;
  preset_requires_reference boolean;
  preset_sort_order integer;
  target_store_count integer := coalesce(cardinality(target_store_ids), 0);
  restored_method_id uuid;
begin
  if target_organization_id is null then
    raise exception 'Choose the organization for this payment preset.' using errcode = '23514';
  end if;

  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'settings.manage')) then
    raise exception 'Settings permission is required to restore payment presets.' using errcode = '42501';
  end if;

  case normalized_preset_code
    when 'CASH' then
      preset_name := 'Cash';
      preset_payment_type := 'CASH';
      preset_requires_reference := false;
      preset_sort_order := 10;
    when 'CARD' then
      preset_name := 'Card';
      preset_payment_type := 'CARD';
      preset_requires_reference := false;
      preset_sort_order := 20;
    when 'GCASH' then
      preset_name := 'GCash';
      preset_payment_type := 'E_WALLET';
      preset_requires_reference := false;
      preset_sort_order := 30;
    when 'MAYA' then
      preset_name := 'Maya';
      preset_payment_type := 'E_WALLET';
      preset_requires_reference := false;
      preset_sort_order := 40;
    when 'BANK_TRANSFER' then
      preset_name := 'Bank Transfer';
      preset_payment_type := 'BANK_TRANSFER';
      preset_requires_reference := false;
      preset_sort_order := 50;
    else
      raise exception 'Choose a valid TINDIO payment preset.' using errcode = '23514';
  end case;

  if target_store_count = 0
    or exists (
      select 1
      from unnest(target_store_ids) as requested(store_id)
      where requested.store_id is null
    )
    or target_store_count <> (
      select count(distinct requested.store_id)
      from unnest(target_store_ids) as requested(store_id)
    )
    or target_store_count <> (
      select count(*)
      from public.stores store
      where store.organization_id = target_organization_id
        and store.is_active
        and store.id = any(target_store_ids)
    ) then
    raise exception 'Select one or more unique active stores in this organization.'
      using errcode = '23514';
  end if;

  insert into public.payment_methods (
    organization_id,
    name,
    code,
    payment_type,
    requires_reference,
    sort_order
  )
  values (
    target_organization_id,
    preset_name,
    normalized_preset_code,
    preset_payment_type,
    preset_requires_reference,
    preset_sort_order
  )
  on conflict (organization_id, code) do nothing
  returning id into restored_method_id;

  if restored_method_id is null then
    select method.id
    into restored_method_id
    from public.payment_methods method
    where method.organization_id = target_organization_id
      and method.code = normalized_preset_code;

    return restored_method_id;
  end if;

  insert into public.store_payment_methods (
    organization_id,
    store_id,
    payment_method_id,
    is_enabled
  )
  select
    target_organization_id,
    requested.store_id,
    restored_method_id,
    true
  from unnest(target_store_ids) as requested(store_id);

  return restored_method_id;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."revoke_loyalty_card"("target_organization_id" "uuid", "target_loyalty_card_id" "uuid", "target_reason" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor_employee_id uuid;
  normalized_reason text := btrim(coalesce(target_reason, ''));
  card_record public.loyalty_cards%rowtype;
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'customers.manage')) then
    raise exception 'Customer management permission is required.' using errcode = '42501';
  end if;

  if char_length(normalized_reason) not between 2 and 500 then
    raise exception 'Enter a revocation reason between 2 and 500 characters.' using errcode = '23514';
  end if;

  select private.current_employee_id(target_organization_id)
  into actor_employee_id;
  if actor_employee_id is null then
    raise exception 'An active employee is required to revoke this card.' using errcode = '42501';
  end if;

  select card.*
  into card_record
  from public.loyalty_cards card
  where card.id = target_loyalty_card_id
    and card.organization_id = target_organization_id
    and card.status = 'active'
  for update;
  if card_record.id is null then
    raise exception 'Only an active loyalty card can be revoked.' using errcode = 'P0002';
  end if;

  update public.loyalty_cards card
  set
    status = 'revoked',
    deactivated_at = now(),
    deactivation_reason = normalized_reason
  where card.id = card_record.id
    and card.organization_id = target_organization_id;

  insert into public.loyalty_card_events (
    organization_id, loyalty_card_id, customer_id, event_type,
    stamp_count_before, stamp_delta, stamp_count_after,
    actor_employee_id, reason
  )
  values (
    target_organization_id, card_record.id, card_record.customer_id, 'REVOKED',
    card_record.stamp_count, 0, card_record.stamp_count,
    actor_employee_id, normalized_reason
  );

  perform private.write_audit_log(
    target_organization_id,
    'LOYALTY_CARD_REVOKED',
    'loyalty.card.revoke',
    actor_employee_id,
    null,
    null,
    null,
    null,
    null,
    normalized_reason,
    jsonb_build_object('loyalty_card_id', card_record.id, 'customer_id', card_record.customer_id)
  );
end;
$$;

CREATE OR REPLACE FUNCTION "public"."rotate_loyalty_card_qr"("target_organization_id" "uuid", "target_loyalty_card_id" "uuid", "target_verification_token" "text", "target_reason" "text") RETURNS TABLE("card_id" "uuid", "card_code" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  actor_employee_id uuid;
  normalized_reason text := btrim(coalesce(target_reason, ''));
  card_record public.loyalty_cards%rowtype;
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'customers.manage')) then
    raise exception 'Customer management permission is required.' using errcode = '42501';
  end if;

  if target_verification_token !~ '^[a-f0-9]{64}$'
    or char_length(normalized_reason) not between 2 and 500 then
    raise exception 'A new QR token and a reason between 2 and 500 characters are required.' using errcode = '23514';
  end if;

  select private.current_employee_id(target_organization_id)
  into actor_employee_id;
  if actor_employee_id is null then
    raise exception 'An active employee is required to rotate this QR code.' using errcode = '42501';
  end if;

  select card.*
  into card_record
  from public.loyalty_cards card
  where card.id = target_loyalty_card_id
    and card.organization_id = target_organization_id
    and card.status = 'active'
    and (card.expires_at is null or card.expires_at > now())
  for update;
  if card_record.id is null then
    raise exception 'Only an active, unexpired loyalty card can receive a new QR code.' using errcode = 'P0002';
  end if;

  update public.loyalty_cards card
  set verification_token_hash = extensions.digest(target_verification_token, 'sha256')
  where card.id = card_record.id
    and card.organization_id = target_organization_id;

  insert into public.loyalty_card_events (
    organization_id, loyalty_card_id, customer_id, event_type,
    stamp_count_before, stamp_delta, stamp_count_after,
    actor_employee_id, reason
  )
  values (
    target_organization_id, card_record.id, card_record.customer_id, 'QR_ROTATED',
    card_record.stamp_count, 0, card_record.stamp_count,
    actor_employee_id, normalized_reason
  );

  perform private.write_audit_log(
    target_organization_id,
    'LOYALTY_CARD_QR_ROTATED',
    'loyalty.card.rotate_qr',
    actor_employee_id,
    null,
    null,
    null,
    null,
    null,
    normalized_reason,
    jsonb_build_object('loyalty_card_id', card_record.id, 'customer_id', card_record.customer_id)
  );

  return query select card_record.id, card_record.card_code;
end;
$_$;

CREATE OR REPLACE FUNCTION "public"."save_smart_menu_configuration"("target_store_id" "uuid", "target_is_enabled" boolean, "target_show_prices" boolean, "target_show_images" boolean, "target_show_unavailable" boolean, "target_show_variants" boolean, "target_show_modifiers" boolean, "target_category_ids" "uuid"[], "target_product_ids" "uuid"[]) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  target_organization_id uuid;
  target_menu_id uuid;
  actor_employee_id uuid;
  selected_category_ids uuid[] := coalesce(target_category_ids, '{}'::uuid[]);
  selected_product_ids uuid[] := coalesce(target_product_ids, '{}'::uuid[]);
begin
  select store.organization_id
  into target_organization_id
  from public.stores store
  where store.id = target_store_id
    and store.is_active
  for key share;

  if target_organization_id is null then
    raise exception 'Choose an active store for this Smart Menu.' using errcode = 'P0002';
  end if;

  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'settings.manage')) then
    raise exception 'Settings permission is required to configure Smart Menu.' using errcode = '42501';
  end if;

  if target_is_enabled is null
    or target_show_prices is null
    or target_show_images is null
    or target_show_unavailable is null
    or target_show_variants is null
    or target_show_modifiers is null then
    raise exception 'Smart Menu display settings are required.' using errcode = '23514';
  end if;

  if exists (select 1 from unnest(selected_category_ids) selected(category_id) where selected.category_id is null)
    or cardinality(selected_category_ids) <> (select count(distinct selected.category_id) from unnest(selected_category_ids) selected(category_id)) then
    raise exception 'Choose each Smart Menu category only once.' using errcode = '23514';
  end if;

  if exists (select 1 from unnest(selected_product_ids) selected(product_id) where selected.product_id is null)
    or cardinality(selected_product_ids) <> (select count(distinct selected.product_id) from unnest(selected_product_ids) selected(product_id)) then
    raise exception 'Choose each Smart Menu product only once.' using errcode = '23514';
  end if;

  if target_is_enabled and (cardinality(selected_category_ids) = 0 or cardinality(selected_product_ids) = 0) then
    raise exception 'Choose at least one category and product before enabling Smart Menu.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from unnest(selected_category_ids) selected(category_id)
    left join public.categories category
      on category.id = selected.category_id
     and category.organization_id = target_organization_id
    where category.id is null
       or category.is_archived
  ) then
    raise exception 'Smart Menu categories must be active categories in this business.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from unnest(selected_product_ids) selected(product_id)
    left join public.products product
      on product.id = selected.product_id
     and product.organization_id = target_organization_id
    where product.id is null
       or product.status <> 'active'
       or product.is_composite
       or product.category_id is null
       or not (product.category_id = any(selected_category_ids))
  ) then
    raise exception 'Smart Menu products must be active, non-composite products in a selected category.' using errcode = '23514';
  end if;

  select private.current_employee_id(target_organization_id)
  into actor_employee_id;
  if actor_employee_id is null then
    raise exception 'An active employee is required to configure Smart Menu.' using errcode = '42501';
  end if;

  insert into public.smart_menus (
    organization_id,
    store_id,
    is_enabled,
    show_prices,
    show_images,
    show_unavailable,
    show_variants,
    show_modifiers,
    created_by_employee_id,
    updated_by_employee_id
  )
  values (
    target_organization_id,
    target_store_id,
    target_is_enabled,
    target_show_prices,
    target_show_images,
    target_show_unavailable,
    target_show_variants,
    target_show_modifiers,
    actor_employee_id,
    actor_employee_id
  )
  on conflict (organization_id, store_id) do update
  set
    is_enabled = excluded.is_enabled,
    show_prices = excluded.show_prices,
    show_images = excluded.show_images,
    show_unavailable = excluded.show_unavailable,
    show_variants = excluded.show_variants,
    show_modifiers = excluded.show_modifiers,
    updated_by_employee_id = excluded.updated_by_employee_id,
    updated_at = now()
  returning id into target_menu_id;

  delete from public.smart_menu_categories where smart_menu_id = target_menu_id;
  delete from public.smart_menu_products where smart_menu_id = target_menu_id;

  insert into public.smart_menu_categories (smart_menu_id, organization_id, category_id, sort_order)
  select target_menu_id, target_organization_id, selected.category_id, (selected.ordinality - 1)::integer
  from unnest(selected_category_ids) with ordinality as selected(category_id, ordinality);

  insert into public.smart_menu_products (smart_menu_id, organization_id, product_id, sort_order)
  select target_menu_id, target_organization_id, selected.product_id, (selected.ordinality - 1)::integer
  from unnest(selected_product_ids) with ordinality as selected(product_id, ordinality);

  perform private.write_audit_log(
    target_organization_id,
    'SMART_MENU_UPDATED',
    'settings.manage',
    actor_employee_id,
    null,
    target_store_id,
    null,
    null,
    null,
    null,
    jsonb_build_object(
      'smart_menu_id', target_menu_id,
      'is_enabled', target_is_enabled,
      'category_count', cardinality(selected_category_ids),
      'product_count', cardinality(selected_product_ids),
      'show_prices', target_show_prices,
      'show_images', target_show_images,
      'show_unavailable', target_show_unavailable,
      'show_variants', target_show_variants,
      'show_modifiers', target_show_modifiers
    )
  );

  return target_menu_id;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."search_pos_customers"("target_organization_id" "uuid", "target_store_id" "uuid", "target_query" "text", "target_limit" integer) RETURNS TABLE("customer_id" "uuid", "customer_number" bigint, "loyalty_card_code" "text", "full_name" "text", "phone" "text", "email" "text", "loyalty_points" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  normalized_query text := nullif(btrim(coalesce(target_query, '')), '');
begin
  if target_organization_id is null
    or target_store_id is null
    or target_limit not between 1 and 20 then
    raise exception 'A store and a result limit between 1 and 20 are required.' using errcode = '23514';
  end if;

  if normalized_query is not null and char_length(normalized_query) > 100 then
    raise exception 'Customer search is limited to 100 characters.' using errcode = '23514';
  end if;

  perform private.require_pos_workspace_access(
    target_organization_id,
    target_store_id
  );

  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'sales.create'))
    or not exists (
      select 1
      from public.employees employee
      join public.employee_stores employee_store
        on employee_store.employee_id = employee.id
       and employee_store.organization_id = employee.organization_id
       and employee_store.store_id = target_store_id
      where employee.organization_id = target_organization_id
        and employee.profile_id = (select private.current_profile_id())
        and employee.status = 'active'
    ) then
    raise exception 'POS customer access requires an active store assignment.' using errcode = '42501';
  end if;

  return query
  select
    customer.id,
    customer.customer_number,
    customer.loyalty_card_code,
    customer.full_name,
    customer.phone,
    customer.email,
    coalesce((
      select sum(transaction.points_delta)::integer
      from public.loyalty_transactions transaction
      where transaction.organization_id = customer.organization_id
        and transaction.customer_id = customer.id
    ), 0)::integer
  from public.customers customer
  where customer.organization_id = target_organization_id
    and customer.status = 'active'
    and (
      normalized_query is null
      or customer.full_name ilike '%' || normalized_query || '%'
      or coalesce(customer.phone, '') ilike '%' || normalized_query || '%'
      or coalesce(customer.email, '') ilike '%' || normalized_query || '%'
      or customer.loyalty_card_code ilike '%' || normalized_query || '%'
      or customer.customer_number::text = normalized_query
    )
  order by customer.full_name, customer.created_at desc
  limit target_limit;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."set_catalog_product_store_configuration_v3"("target_organization_id" "uuid", "target_product_id" "uuid", "target_store_id" "uuid", "target_price_override_minor" bigint, "target_restock_policy" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare actor_employee_id uuid;
begin
  if (select private.current_profile_id()) is null or not (select private.has_permission(target_organization_id, 'products.manage')) then
    raise exception 'Product management permission is required.' using errcode = '42501';
  end if;
  if not (select private.has_store_read_scope(target_organization_id, target_store_id)) then
    raise exception 'Store access is required to configure this product.' using errcode = '42501';
  end if;
  if target_price_override_minor is not null and target_price_override_minor < 0 then
    raise exception 'Price override must be non-negative.' using errcode = '22023';
  end if;
  if target_restock_policy not in ('restock', 'do_not_restock') then
    raise exception 'Choose a valid restock intention.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.products p where p.id=target_product_id and p.organization_id=target_organization_id)
    or not exists (select 1 from public.stores s where s.id=target_store_id and s.organization_id=target_organization_id and s.is_active) then
    raise exception 'Select an active store and product in this organization.' using errcode = '23503';
  end if;
  actor_employee_id := private.current_employee_id(target_organization_id);
  insert into public.product_store_settings
    (organization_id,product_id,store_id,is_available,price_override_minor,restock_policy)
  values (target_organization_id,target_product_id,target_store_id,true,target_price_override_minor,target_restock_policy)
  on conflict (store_id,product_id) do update
  set is_available=excluded.is_available, price_override_minor=excluded.price_override_minor,
      restock_policy=excluded.restock_policy;
  perform private.write_audit_log(target_organization_id,'PRODUCT_STORE_CONFIGURATION_UPDATED','products.manage',
    actor_employee_id,null,target_store_id,null,null,null,null,
    jsonb_build_object('product_id',target_product_id,'price_override_minor',target_price_override_minor,
      'restock_policy',target_restock_policy,'low_stock_authority','canonical replenishment rule'));
end;
$$;

CREATE OR REPLACE FUNCTION "public"."set_payment_method_offline_policy"("target_organization_id" "uuid", "target_payment_method_id" "uuid", "target_offline_policy" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  selected_payment_type text;
  normalized_policy text := lower(nullif(btrim(coalesce(target_offline_policy, '')), ''));
begin
  if target_organization_id is null
    or target_payment_method_id is null
    or normalized_policy not in ('disabled', 'cash', 'manual_external') then
    raise exception 'Choose a valid offline payment policy.' using errcode = '23514';
  end if;

  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'settings.manage')) then
    raise exception 'Settings permission is required to change offline payment policies.'
      using errcode = '42501';
  end if;

  select payment_method.payment_type
  into selected_payment_type
  from public.payment_methods payment_method
  where payment_method.id = target_payment_method_id
    and payment_method.organization_id = target_organization_id
  for update;

  if selected_payment_type is null then
    raise exception 'The payment method was not found in this organization.' using errcode = 'P0002';
  end if;

  if normalized_policy = 'cash' and selected_payment_type <> 'CASH' then
    raise exception 'Only cash methods can be settled automatically while offline.' using errcode = '23514';
  end if;

  if normalized_policy = 'manual_external' and selected_payment_type = 'CASH' then
    raise exception 'Cash methods use either the cash policy or disabled policy.' using errcode = '23514';
  end if;

  update public.payment_methods payment_method
  set offline_policy = normalized_policy
  where payment_method.id = target_payment_method_id
    and payment_method.organization_id = target_organization_id;

  return true;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."set_store_payment_method_configuration"("target_organization_id" "uuid", "target_store_id" "uuid", "target_payment_method_id" "uuid", "target_is_enabled" boolean) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if target_organization_id is null
    or target_store_id is null
    or target_payment_method_id is null
    or target_is_enabled is null then
    raise exception 'Choose a payment method, active store, and availability setting.' using errcode = '23514';
  end if;

  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'settings.manage')) then
    raise exception 'Settings permission is required to configure payment methods.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.payment_methods method
    where method.organization_id = target_organization_id
      and method.id = target_payment_method_id
  ) then
    raise exception 'The payment method was not found in this organization.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.stores store
    where store.organization_id = target_organization_id
      and store.id = target_store_id
      and store.is_active
  ) then
    raise exception 'The store is not active in this organization.' using errcode = '23514';
  end if;

  insert into public.store_payment_methods (
    organization_id,
    store_id,
    payment_method_id,
    is_enabled
  )
  values (
    target_organization_id,
    target_store_id,
    target_payment_method_id,
    target_is_enabled
  )
  on conflict (store_id, payment_method_id) do update
  set is_enabled = excluded.is_enabled;

  return true;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."update_custom_role"("target_organization_id" "uuid", "target_role_id" "uuid", "role_name" "text", "role_description" "text", "permission_codes" "text"[]) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  normalized_name text := btrim(role_name);
  normalized_description text := nullif(btrim(role_description), '');
  actor_employee_id uuid;
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'roles.manage')) then
    raise exception 'Role management permission is required.' using errcode = '42501';
  end if;

  if char_length(normalized_name) not between 2 and 80 then
    raise exception 'Role name must contain between 2 and 80 characters.' using errcode = '22023';
  end if;

  if coalesce(cardinality(permission_codes), 0) = 0 then
    raise exception 'Select at least one permission.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.roles role
    where role.id = target_role_id
      and role.organization_id = target_organization_id
      and role.is_system
  ) then
    raise exception 'System roles cannot be edited.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.roles role
    where role.id = target_role_id
      and role.organization_id = target_organization_id
      and not role.is_system
  ) then
    raise exception 'Select a custom role in this organization.' using errcode = '23503';
  end if;

  if exists (
    select 1
    from (
      select distinct unnest(permission_codes) as permission_code
    ) requested_permission
    left join public.permissions permission
      on permission.code = requested_permission.permission_code
    where permission.code is null
  ) then
    raise exception 'One or more requested permissions do not exist.' using errcode = '23503';
  end if;

  if exists (
    select 1
    from (
      select distinct unnest(permission_codes) as permission_code
    ) requested_permission
    where not (select private.has_permission(target_organization_id, requested_permission.permission_code))
  ) then
    raise exception 'You cannot grant a permission you do not hold.' using errcode = '42501';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select private.current_profile_id())
    and employee.status = 'active';

  update public.roles
  set
    name = normalized_name,
    description = normalized_description
  where id = target_role_id
    and organization_id = target_organization_id
    and not is_system;

  delete from public.role_permissions
  where organization_id = target_organization_id
    and role_id = target_role_id;

  insert into public.role_permissions (
    organization_id,
    role_id,
    permission_code
  )
  select
    target_organization_id,
    target_role_id,
    requested_permission.permission_code
  from (
    select distinct unnest(permission_codes) as permission_code
  ) requested_permission;

  perform private.write_audit_log(
    target_organization_id,
    'CUSTOM_ROLE_UPDATED',
    'roles.manage',
    actor_employee_id,
    null,
    null,
    null,
    null,
    null,
    null,
    jsonb_build_object('role_id', target_role_id, 'permission_count', cardinality(permission_codes))
  );

  return target_role_id;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."update_customer_profile"("target_organization_id" "uuid", "target_customer_id" "uuid", "target_full_name" "text", "target_email" "text", "target_phone" "text", "target_address" "text", "target_birthday" "date", "target_notes" "text", "target_loyalty_card_code" "text", "target_segment_ids" "uuid"[] DEFAULT '{}'::"uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  normalized_full_name text := btrim(coalesce(target_full_name, ''));
  normalized_email text := nullif(btrim(coalesce(target_email, '')), '');
  normalized_phone text := nullif(btrim(coalesce(target_phone, '')), '');
  normalized_address text := nullif(btrim(coalesce(target_address, '')), '');
  normalized_notes text := nullif(btrim(coalesce(target_notes, '')), '');
  normalized_loyalty_card_code text := nullif(btrim(coalesce(target_loyalty_card_code, '')), '');
  normalized_segment_ids uuid[] := coalesce(target_segment_ids, '{}'::uuid[]);
begin
  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'customers.manage')) then
    raise exception 'Customer management permission is required.' using errcode = '42501';
  end if;

  if char_length(normalized_full_name) not between 1 and 160
    or (normalized_email is not null and char_length(normalized_email) not between 3 and 320)
    or (normalized_phone is not null and char_length(normalized_phone) not between 3 and 40)
    or (normalized_address is not null and char_length(normalized_address) not between 2 and 500)
    or (normalized_notes is not null and char_length(normalized_notes) not between 2 and 1000)
    or (normalized_loyalty_card_code is not null and char_length(normalized_loyalty_card_code) not between 3 and 80)
    or cardinality(normalized_segment_ids) > 20
    or cardinality(normalized_segment_ids) <> (
      select count(*)::integer
      from (select distinct segment_id from unnest(normalized_segment_ids) as input(segment_id)) unique_segments
    ) then
    raise exception 'Check the customer profile details.' using errcode = '23514';
  end if;

  perform 1
  from public.customers customer
  where customer.id = target_customer_id
    and customer.organization_id = target_organization_id
  for update;

  if not found then
    raise exception 'The customer was not found.' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from unnest(normalized_segment_ids) as requested(segment_id)
    left join public.customer_segments segment
      on segment.id = requested.segment_id
     and segment.organization_id = target_organization_id
    where segment.id is null
  ) then
    raise exception 'One or more customer segments are unavailable.' using errcode = '23514';
  end if;

  update public.customers
  set
    full_name = normalized_full_name,
    email = normalized_email,
    phone = normalized_phone,
    address = normalized_address,
    birthday = target_birthday,
    notes = normalized_notes,
    loyalty_card_code = normalized_loyalty_card_code
  where id = target_customer_id
    and organization_id = target_organization_id;

  delete from public.customer_segment_memberships membership
  where membership.organization_id = target_organization_id
    and membership.customer_id = target_customer_id;

  insert into public.customer_segment_memberships (organization_id, customer_id, segment_id)
  select target_organization_id, target_customer_id, requested.segment_id
  from unnest(normalized_segment_ids) as requested(segment_id);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."update_payment_method_configuration"("target_organization_id" "uuid", "target_payment_method_id" "uuid", "target_name" "text", "target_is_enabled" boolean, "target_requires_reference" boolean, "target_sort_order" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  normalized_name text := nullif(btrim(coalesce(target_name, '')), '');
begin
  if target_organization_id is null
    or target_payment_method_id is null
    or normalized_name is null
    or char_length(normalized_name) > 100
    or target_is_enabled is null
    or target_requires_reference is null
    or target_sort_order is null
    or target_sort_order not between 0 and 100000 then
    raise exception 'Enter valid payment method settings.' using errcode = '23514';
  end if;

  if (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'settings.manage')) then
    raise exception 'Settings permission is required to configure payment methods.' using errcode = '42501';
  end if;

  update public.payment_methods method
  set
    name = normalized_name,
    is_enabled = target_is_enabled,
    requires_reference = target_requires_reference,
    sort_order = target_sort_order
  where method.organization_id = target_organization_id
    and method.id = target_payment_method_id;

  if not found then
    raise exception 'The payment method was not found in this organization.' using errcode = 'P0002';
  end if;

  return true;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."update_product_unit"("target_organization_id" "uuid", "target_unit_id" "uuid", "target_unit_code" "text", "target_unit_name" "text", "target_factor_to_base" numeric, "target_is_sale_unit" boolean, "target_is_purchase_unit" boolean, "target_operation_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  current_unit public.product_units%rowtype;
  normalized_code text := lower(btrim(target_unit_code));
  normalized_name text := btrim(target_unit_name);
  payload jsonb;
  replay_id uuid;
  old_values jsonb;
  actor_employee_id uuid;
begin
  if (select private.current_profile_id()) is null
     or not (select private.has_permission(target_organization_id, 'products.manage')) then
    raise exception 'Product management permission is required.' using errcode = '42501';
  end if;

  payload := jsonb_build_object(
    'unit_id', target_unit_id, 'unit_code', normalized_code, 'unit_name', normalized_name,
    'factor_to_base', target_factor_to_base, 'is_sale_unit', target_is_sale_unit,
    'is_purchase_unit', target_is_purchase_unit
  );
  replay_id := private.claim_product_unit_operation(
    target_organization_id, target_operation_id, 'update', payload, target_unit_id
  );
  if replay_id is not null then return replay_id; end if;

  select unit.* into current_unit
  from public.product_units unit
  where unit.id = target_unit_id and unit.organization_id = target_organization_id
  for update;
  if not found then raise exception 'The product unit could not be found.' using errcode = '23503'; end if;

  old_values := jsonb_build_object(
    'unit_code', current_unit.unit_code, 'unit_name', current_unit.unit_name,
    'factor_to_base', current_unit.factor_to_base, 'is_sale_unit', current_unit.is_sale_unit,
    'is_purchase_unit', current_unit.is_purchase_unit
  );
  if current_unit.is_base and (
    normalized_code is distinct from current_unit.unit_code
    or target_factor_to_base is distinct from current_unit.factor_to_base
  ) then
    raise exception 'The base unit code and conversion factor are immutable.' using errcode = '23514';
  end if;

  update public.product_units
  set unit_code = normalized_code, unit_name = normalized_name,
      factor_to_base = target_factor_to_base,
      is_sale_unit = coalesce(target_is_sale_unit, false),
      is_purchase_unit = coalesce(target_is_purchase_unit, false)
  where id = target_unit_id;

  actor_employee_id := private.current_employee_id(target_organization_id);
  perform private.write_audit_log(
    target_organization_id, 'PRODUCT_UNIT_UPDATED', 'products.manage', actor_employee_id,
    null, null, null, null, null, null,
    jsonb_build_object('product_id', current_unit.product_id, 'unit_id', target_unit_id,
      'operation_id', target_operation_id, 'old_values', old_values, 'new_values', payload - 'unit_id')
  );
  return target_unit_id;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."update_receipt_settings"("target_organization_id" "uuid", "target_business_name" "text", "target_business_address" "text", "target_business_phone" "text", "target_business_email" "text", "target_business_tax_id" "text", "target_business_website" "text", "target_header_message" "text", "target_footer_message" "text", "target_paper_width_mm" smallint, "target_show_store_address" boolean, "target_show_store_phone" boolean, "target_show_cashier" boolean, "target_show_register" boolean, "target_show_payment_details" boolean) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  normalized_business_name text;
  normalized_business_address text;
  normalized_business_phone text;
  normalized_business_email text;
  normalized_business_tax_id text;
  normalized_business_website text;
  normalized_header_message text;
  normalized_footer_message text;
begin
  if target_organization_id is null
    or (select private.current_profile_id()) is null
    or not (select private.has_permission(target_organization_id, 'settings.manage')) then
    raise exception 'Settings permission is required.' using errcode = '42501';
  end if;

  normalized_business_name := trim(coalesce(target_business_name, ''));
  normalized_business_address := nullif(trim(coalesce(target_business_address, '')), '');
  normalized_business_phone := nullif(trim(coalesce(target_business_phone, '')), '');
  normalized_business_email := nullif(lower(trim(coalesce(target_business_email, ''))), '');
  normalized_business_tax_id := nullif(trim(coalesce(target_business_tax_id, '')), '');
  normalized_business_website := nullif(trim(coalesce(target_business_website, '')), '');
  normalized_header_message := nullif(trim(coalesce(target_header_message, '')), '');
  normalized_footer_message := trim(coalesce(target_footer_message, ''));

  if char_length(normalized_business_name) not between 2 and 160
    or (normalized_business_address is not null and char_length(normalized_business_address) not between 2 and 500)
    or (normalized_business_phone is not null and char_length(normalized_business_phone) not between 2 and 40)
    or (normalized_business_email is not null and not private.valid_receipt_email(normalized_business_email))
    or (normalized_business_tax_id is not null and char_length(normalized_business_tax_id) not between 2 and 80)
    or (normalized_business_website is not null and char_length(normalized_business_website) not between 3 and 2048)
    or (normalized_header_message is not null and char_length(normalized_header_message) not between 2 and 160)
    or char_length(normalized_footer_message) not between 2 and 240
    or target_paper_width_mm not in (58, 80) then
    raise exception 'Check the receipt business information and layout values.' using errcode = '23514';
  end if;

  insert into public.receipt_settings (
    organization_id, business_name, business_address, business_phone, business_email,
    business_tax_id, business_website, header_message, footer_message, paper_width_mm,
    show_store_address, show_store_phone, show_cashier, show_register, show_payment_details
  )
  values (
    target_organization_id, normalized_business_name, normalized_business_address,
    normalized_business_phone, normalized_business_email, normalized_business_tax_id,
    normalized_business_website, normalized_header_message, normalized_footer_message,
    target_paper_width_mm, target_show_store_address, target_show_store_phone,
    target_show_cashier, target_show_register, target_show_payment_details
  )
  on conflict (organization_id) do update
  set
    business_name = excluded.business_name,
    business_address = excluded.business_address,
    business_phone = excluded.business_phone,
    business_email = excluded.business_email,
    business_tax_id = excluded.business_tax_id,
    business_website = excluded.business_website,
    header_message = excluded.header_message,
    footer_message = excluded.footer_message,
    paper_width_mm = excluded.paper_width_mm,
    show_store_address = excluded.show_store_address,
    show_store_phone = excluded.show_store_phone,
    show_cashier = excluded.show_cashier,
    show_register = excluded.show_register,
    show_payment_details = excluded.show_payment_details,
    updated_at = now();

  return true;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."update_supplier"("target_organization_id" "uuid", "target_supplier_id" "uuid", "target_name" "text", "target_contact_name" "text", "target_email" "text", "target_phone" "text", "target_address" "text", "target_notes" "text", "target_is_active" boolean) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  normalized_name text := nullif(btrim(target_name), '');
  normalized_email text := nullif(btrim(target_email), '');
  actor_employee_id uuid;
begin
  if (select private.current_profile_id()) is null
    or (not (select private.has_permission(target_organization_id, 'inventory.manage')) and not (select private.has_inventory_capability(target_organization_id, 'purchasing.suppliers.manage'))) then
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
    and employee.profile_id = (select private.current_profile_id())
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
$_$;

commit;
