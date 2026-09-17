-- Phase 05: canonical physical-transfer lifecycle and direct-store adapters.
-- Request/replenishment writers remain on their temporary legacy contract.
begin;

do $$
begin
  if exists (
    select 1
    from public.stock_transfers
    where status not in (
      'draft', 'submitted', 'approved', 'dispatched', 'partially_received',
      'received', 'cancelled', 'in_transit', 'completed'
    )
  ) then
    raise exception 'An unmapped stock transfer status blocks the canonical lifecycle migration.'
      using errcode = '23514';
  end if;
end;
$$;

alter table public.stock_transfers
  drop constraint stock_transfers_received_state,
  drop constraint stock_transfers_status_values,
  add constraint stock_transfers_status_values check (
    status in (
      'draft', 'submitted', 'approved', 'dispatched', 'partially_received',
      'received', 'cancelled', 'in_transit', 'completed'
    )
  ),
  add constraint stock_transfers_received_state check (
    (
      status in ('partially_received', 'received')
      and received_by_employee_id is not null
      and received_at is not null
    )
    or (
      status in ('draft', 'submitted', 'approved', 'dispatched', 'cancelled', 'in_transit')
      and received_by_employee_id is null
      and received_at is null
    )
    or (
      status = 'completed'
      and (
        (received_by_employee_id is null and received_at is null)
        or (received_by_employee_id is not null and received_at is not null)
      )
    )
  );

-- Only direct physical transfers are normalized. Request-linked compatibility
-- rows remain untouched until the replenishment migration.
update public.stock_transfers
set status = 'dispatched'
where stock_request_id is null
  and status = 'in_transit';

create table private.stock_transfer_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  stock_transfer_id uuid not null,
  operation_id uuid not null,
  command text not null,
  normalized_payload jsonb not null,
  from_status text,
  to_status text not null,
  actor_employee_id uuid not null,
  result_id uuid not null,
  note text,
  created_at timestamptz not null default now(),
  constraint stock_transfer_operations_organization_fkey
    foreign key (organization_id)
    references public.organizations (id)
    on delete restrict,
  constraint stock_transfer_operations_transfer_organization_fkey
    foreign key (stock_transfer_id, organization_id)
    references public.stock_transfers (id, organization_id)
    on delete restrict,
  constraint stock_transfer_operations_actor_organization_fkey
    foreign key (actor_employee_id, organization_id)
    references public.employees (id, organization_id)
    on delete restrict,
  constraint stock_transfer_operations_organization_operation_unique
    unique (organization_id, operation_id),
  constraint stock_transfer_operations_command_values
    check (command in ('create', 'submit', 'approve', 'dispatch', 'receive', 'cancel')),
  constraint stock_transfer_operations_from_status_values
    check (
      from_status is null
      or from_status in (
        'draft', 'submitted', 'approved', 'dispatched', 'partially_received',
        'received', 'cancelled', 'in_transit', 'completed'
      )
    ),
  constraint stock_transfer_operations_to_status_values
    check (to_status in ('draft', 'submitted', 'approved', 'dispatched', 'partially_received', 'received', 'cancelled')),
  constraint stock_transfer_operations_note_length
    check (note is null or char_length(note) <= 500)
);

create index stock_transfer_operations_transfer_created_idx
  on private.stock_transfer_operations (organization_id, stock_transfer_id, created_at, id);
create index stock_transfer_operations_actor_created_idx
  on private.stock_transfer_operations (organization_id, actor_employee_id, created_at desc);

revoke all on table private.stock_transfer_operations
from public, anon, authenticated, service_role;

comment on table private.stock_transfer_operations is
  'Immutable idempotency and custody evidence for canonical stock-transfer lifecycle commands. It is not exposed through the Data API.';
comment on column private.stock_transfer_operations.normalized_payload is
  'Stable command payload used to distinguish exact replay from operation-key reuse.';
comment on column private.stock_transfer_operations.result_id is
  'The original transfer ID for lifecycle commands or receipt ID for receive commands.';

create or replace function private.normalize_inventory_transfer_lines(target_lines jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  normalized_lines jsonb;
begin
  if target_lines is null
     or jsonb_typeof(target_lines) <> 'array'
     or jsonb_array_length(target_lines) not between 1 and 100 then
    raise exception 'A transfer needs one to 100 items.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(target_lines) transfer_line(value)
    where jsonb_typeof(transfer_line.value) <> 'object'
      or coalesce(transfer_line.value ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (
        nullif(transfer_line.value ->> 'variant_id', '') is not null
        and nullif(transfer_line.value ->> 'variant_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
      or coalesce(transfer_line.value ->> 'quantity', '') !~ '^\d+(\.\d{1,3})?$'
      or (transfer_line.value ->> 'quantity')::numeric <= 0
  )
  or (select count(*) from jsonb_array_elements(target_lines)) <> (
    select count(distinct format(
      '%s|%s',
      lower(btrim(value ->> 'product_id')),
      coalesce(nullif(lower(btrim(value ->> 'variant_id')), ''), '')
    ))
    from jsonb_array_elements(target_lines)
  ) then
    raise exception 'Transfer lines must contain unique, valid items and positive quantities.' using errcode = '23514';
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
  into normalized_lines
  from (
    select
      lower(btrim(value ->> 'product_id')) as product_id,
      nullif(lower(btrim(value ->> 'variant_id')), '') as variant_id,
      ((value ->> 'quantity')::numeric(14,3))::text as quantity
    from jsonb_array_elements(target_lines)
  ) normalized;

  return normalized_lines;
end;
$$;

create or replace function private.normalize_inventory_transfer_receipt_lines(target_lines jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  normalized_lines jsonb;
  uses_legacy_line_shape boolean;
begin
  if target_lines is null
     or jsonb_typeof(target_lines) <> 'array'
     or jsonb_array_length(target_lines) not between 1 and 100 then
    raise exception 'A transfer receipt needs one to 100 items.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(target_lines) receipt(value)
    where jsonb_typeof(receipt.value) <> 'object'
      or coalesce(receipt.value ->> 'stock_transfer_line_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(receipt.value ->> 'received_quantity', receipt.value ->> 'quantity', '') !~ '^\d+(\.\d{1,3})?$'
      or coalesce(receipt.value ->> 'short_quantity', '0') !~ '^\d+(\.\d{1,3})?$'
      or (
        (coalesce(receipt.value ->> 'received_quantity', receipt.value ->> 'quantity'))::numeric
        + (coalesce(receipt.value ->> 'short_quantity', '0'))::numeric
      ) <= 0
      or (
        (coalesce(receipt.value ->> 'short_quantity', '0'))::numeric > 0
        and char_length(btrim(coalesce(receipt.value ->> 'discrepancy_note', ''))) not between 2 and 500
      )
  )
  or (select count(*) from jsonb_array_elements(target_lines)) <> (
    select count(distinct lower(btrim(value ->> 'stock_transfer_line_id')))
    from jsonb_array_elements(target_lines)
  ) then
    raise exception 'Receipt lines, quantities, and discrepancy notes are invalid.' using errcode = '23514';
  end if;

  select bool_and(
    not (value ? 'received_quantity')
    and not (value ? 'short_quantity')
    and not (value ? 'discrepancy_note')
  )
  into uses_legacy_line_shape
  from jsonb_array_elements(target_lines);

  if uses_legacy_line_shape then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'stock_transfer_line_id', normalized.stock_transfer_line_id,
          'quantity', normalized.received_quantity
        )
        order by normalized.stock_transfer_line_id
      ),
      '[]'::jsonb
    )
    into normalized_lines
    from (
      select
        lower(btrim(value ->> 'stock_transfer_line_id')) as stock_transfer_line_id,
        ((value ->> 'quantity')::numeric(14,3))::text as received_quantity
      from jsonb_array_elements(target_lines)
    ) normalized;
  else
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'stock_transfer_line_id', normalized.stock_transfer_line_id,
          'received_quantity', normalized.received_quantity,
          'short_quantity', normalized.short_quantity,
          'discrepancy_note', normalized.discrepancy_note
        )
        order by normalized.stock_transfer_line_id
      ),
      '[]'::jsonb
    )
    into normalized_lines
    from (
      select
        lower(btrim(value ->> 'stock_transfer_line_id')) as stock_transfer_line_id,
        ((coalesce(value ->> 'received_quantity', value ->> 'quantity'))::numeric(14,3))::text as received_quantity,
        ((coalesce(value ->> 'short_quantity', '0'))::numeric(14,3))::text as short_quantity,
        nullif(btrim(coalesce(value ->> 'discrepancy_note', '')), '') as discrepancy_note
      from jsonb_array_elements(target_lines)
    ) normalized;
  end if;

  return normalized_lines;
end;
$$;

revoke all on function private.normalize_inventory_transfer_lines(jsonb)
from public, anon, authenticated, service_role;
revoke all on function private.normalize_inventory_transfer_receipt_lines(jsonb)
from public, anon, authenticated, service_role;

-- Draft lines deliberately carry unknown cost truth. Dispatch replaces both
-- fields from the locked source projection immediately before TRANSFER_OUT.
create or replace function private.capture_stock_transfer_line_cost_truth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  transfer_status text;
  source_cost_is_known boolean;
begin
  select transfer.status, level.cost_is_known
  into transfer_status, source_cost_is_known
  from public.stock_transfers transfer
  join public.inventory_levels level
    on level.organization_id = transfer.organization_id
   and level.store_id = transfer.source_store_id
   and level.product_id = new.product_id
   and level.variant_id is not distinct from new.variant_id
  where transfer.id = new.stock_transfer_id
    and transfer.organization_id = new.organization_id;

  if transfer_status in ('draft', 'submitted', 'approved') then
    new.unit_cost_is_known := false;
  else
    new.unit_cost_is_known := coalesce(source_cost_is_known, false);
  end if;
  return new;
end;
$$;

create or replace function private.create_inventory_transfer_draft(
  target_organization_id uuid,
  target_source_store_id uuid,
  target_destination_store_id uuid,
  target_lines jsonb,
  target_note text,
  target_operation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
  if (select auth.uid()) is null
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

create or replace function private.submit_inventory_transfer(
  target_organization_id uuid,
  target_stock_transfer_id uuid,
  target_note text,
  target_operation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
  if (select auth.uid()) is null
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

create or replace function private.approve_inventory_transfer(
  target_organization_id uuid,
  target_stock_transfer_id uuid,
  target_note text,
  target_operation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
  if (select auth.uid()) is null
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

create or replace function private.dispatch_inventory_transfer(
  target_organization_id uuid,
  target_stock_transfer_id uuid,
  target_note text,
  target_operation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  existing_operation private.stock_transfer_operations%rowtype;
  normalized_note text;
  operation_payload jsonb;
  source_level public.inventory_levels%rowtype;
  transfer public.stock_transfers%rowtype;
  transfer_line public.stock_transfer_lines%rowtype;
begin
  if target_operation_id is null then
    raise exception 'A stable dispatch operation ID is required.' using errcode = '23514';
  end if;
  if target_note is not null and char_length(btrim(target_note)) > 500 then
    raise exception 'The transfer note is too long.' using errcode = '23514';
  end if;
  select * into transfer from public.stock_transfers item
  where item.organization_id = target_organization_id and item.id = target_stock_transfer_id;
  if transfer.id is null or transfer.stock_request_id is not null then
    raise exception 'Choose a canonical direct transfer in this organization.' using errcode = '23514';
  end if;
  if (select auth.uid()) is null
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
    if existing_operation.command = 'dispatch' and existing_operation.normalized_payload = operation_payload then
      return existing_operation.result_id;
    end if;
    raise exception 'This operation ID is already assigned to a different transfer command.' using errcode = '23505';
  end if;

  select * into transfer from public.stock_transfers item
  where item.organization_id = target_organization_id and item.id = target_stock_transfer_id
  for update;
  if transfer.status <> 'approved' then
    raise exception 'Only an approved transfer can be dispatched.' using errcode = '23514';
  end if;

  for transfer_line in
    select *
    from public.stock_transfer_lines line
    where line.organization_id = target_organization_id
      and line.stock_transfer_id = transfer.id
      and line.stock_request_line_id is null
    order by line.product_id, line.variant_id nulls first
    for update
  loop
    select * into source_level
    from public.inventory_levels level
    where level.organization_id = target_organization_id
      and level.store_id = transfer.source_store_id
      and level.product_id = transfer_line.product_id
      and level.variant_id is not distinct from transfer_line.variant_id
    for update;

    if source_level.id is null or source_level.quantity < transfer_line.quantity then
      raise exception 'Source stock is insufficient for this transfer.' using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.inventory_levels level
      where level.organization_id = target_organization_id
        and level.store_id = transfer.destination_store_id
        and level.product_id = transfer_line.product_id
        and level.variant_id is not distinct from transfer_line.variant_id
    ) then
      raise exception 'The destination stock projection is not initialized for one transfer item.' using errcode = '23514';
    end if;

    update public.stock_transfer_lines
    set unit_cost_minor = source_level.average_cost_minor,
        unit_cost_is_known = source_level.cost_is_known
    where id = transfer_line.id;

    perform private.apply_inventory_change_v2(
      target_organization_id,
      transfer.source_store_id,
      transfer_line.product_id,
      transfer_line.variant_id,
      -transfer_line.quantity,
      'TRANSFER_OUT',
      actor_id,
      format('Transfer TR-%s dispatched', lpad(transfer.transfer_number::text, 6, '0')),
      'stock_transfer',
      transfer.id,
      source_level.average_cost_minor
    );
  end loop;

  if not found then
    raise exception 'A transfer must contain at least one direct transfer line.' using errcode = '23514';
  end if;

  update public.stock_transfers set status = 'dispatched' where id = transfer.id;
  insert into private.stock_transfer_operations (
    organization_id, stock_transfer_id, operation_id, command, normalized_payload,
    from_status, to_status, actor_employee_id, result_id, note
  ) values (
    target_organization_id, transfer.id, target_operation_id, 'dispatch', operation_payload,
    'approved', 'dispatched', actor_id, transfer.id, normalized_note
  );
  perform private.write_audit_log(
    target_organization_id, 'STOCK_TRANSFER_DISPATCHED', 'inventory.transfer.send', actor_id,
    null, transfer.source_store_id, null, null, null, normalized_note,
    jsonb_build_object('stock_transfer_id', transfer.id, 'transfer_number', transfer.transfer_number, 'operation_id', target_operation_id)
  );
  return transfer.id;
end;
$$;

create or replace function private.receive_inventory_transfer(
  target_organization_id uuid,
  target_stock_transfer_id uuid,
  target_lines jsonb,
  target_note text,
  target_operation_id uuid,
  allow_legacy_in_transit boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  command_payload jsonb;
  existing_operation private.stock_transfer_operations%rowtype;
  existing_receipt public.stock_transfer_receipts%rowtype;
  from_status text;
  has_shortage boolean;
  line jsonb;
  normalized_lines jsonb;
  normalized_note text;
  receipt_id uuid;
  receipt_number bigint;
  received_now numeric(14,3);
  remaining numeric(14,3);
  short_now numeric(14,3);
  to_status text;
  total_remaining numeric(14,3);
  transfer public.stock_transfers%rowtype;
  transfer_line public.stock_transfer_lines%rowtype;
begin
  if target_operation_id is null then
    raise exception 'A stable transfer-receipt operation ID is required.' using errcode = '23514';
  end if;
  if target_note is not null and char_length(btrim(target_note)) > 500 then
    raise exception 'The transfer receipt note is too long.' using errcode = '23514';
  end if;
  normalized_note := nullif(btrim(target_note), '');
  normalized_lines := private.normalize_inventory_transfer_receipt_lines(target_lines);
  command_payload := jsonb_build_object(
    'stock_transfer_id', target_stock_transfer_id,
    'note', normalized_note,
    'lines', normalized_lines
  );

  select * into transfer from public.stock_transfers item
  where item.organization_id = target_organization_id and item.id = target_stock_transfer_id;
  if transfer.id is null then
    raise exception 'Choose a canonical direct transfer in this organization.' using errcode = '23514';
  end if;
  if transfer.stock_request_id is not null then
    raise exception 'Receive replenishment transfers from the stock request workflow so shortages stay traceable.' using errcode = '23514';
  end if;
  if (select auth.uid()) is null
     or not (select private.has_inventory_capability(target_organization_id, 'inventory.transfer.receive')) then
    raise exception 'Transfer receive permission is required.' using errcode = '42501';
  end if;
  actor_id := private.inventory_actor(target_organization_id, transfer.destination_store_id);
  if actor_id is null then
    raise exception 'An active employee assigned to the destination store is required.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text || ':' || target_operation_id::text, 0));
  select * into existing_operation
  from private.stock_transfer_operations operation
  where operation.organization_id = target_organization_id and operation.operation_id = target_operation_id
  for update;
  if found then
    if existing_operation.command = 'receive' and existing_operation.normalized_payload = command_payload then
      return existing_operation.result_id;
    end if;
    raise exception 'This operation ID is already assigned to a different transfer command.' using errcode = '23505';
  end if;

  -- Preserve exact replay for receipts written before the canonical operation
  -- registry existed. Do not fabricate transition history for those rows.
  select * into existing_receipt
  from public.stock_transfer_receipts receipt
  where receipt.organization_id = target_organization_id
    and receipt.operation_id = target_operation_id
  for update;
  if found then
    if existing_receipt.stock_transfer_id = transfer.id
       and existing_receipt.destination_store_id = transfer.destination_store_id
       and existing_receipt.received_by_employee_id = actor_id
       and existing_receipt.note is not distinct from normalized_note
       and existing_receipt.operation_payload = normalized_lines then
      return existing_receipt.id;
    end if;
    raise exception 'This operation ID is already assigned to a different transfer receipt.' using errcode = '23505';
  end if;

  select * into transfer from public.stock_transfers item
  where item.organization_id = target_organization_id and item.id = target_stock_transfer_id
  for update;
  if transfer.status not in ('dispatched', 'partially_received')
     and not (allow_legacy_in_transit and transfer.status = 'in_transit') then
    raise exception 'This transfer is not available for receiving.' using errcode = '23514';
  end if;
  from_status := transfer.status;

  receipt_number := nextval('private.tindio_stock_transfer_receipt_number_sequence'::regclass);
  insert into public.stock_transfer_receipts (
    organization_id, receipt_number, operation_id, operation_payload,
    stock_transfer_id, destination_store_id, received_by_employee_id, note
  ) values (
    target_organization_id, receipt_number, target_operation_id, normalized_lines,
    transfer.id, transfer.destination_store_id, actor_id, normalized_note
  ) returning id into receipt_id;

  for line in
    select value
    from jsonb_array_elements(normalized_lines)
    order by value ->> 'stock_transfer_line_id'
  loop
    select * into transfer_line
    from public.stock_transfer_lines item
    where item.id = (line ->> 'stock_transfer_line_id')::uuid
      and item.stock_transfer_id = transfer.id
      and item.organization_id = target_organization_id
      and item.stock_request_line_id is null
    for update;
    if transfer_line.id is null then
      raise exception 'A receipt line does not belong to this direct transfer.' using errcode = '23514';
    end if;

    received_now := coalesce(line ->> 'received_quantity', line ->> 'quantity')::numeric(14,3);
    short_now := coalesce(line ->> 'short_quantity', '0')::numeric(14,3);
    remaining := transfer_line.quantity - transfer_line.received_quantity - transfer_line.short_quantity;
    if received_now + short_now > remaining then
      raise exception 'Received and short quantities cannot exceed the remaining dispatched quantity.' using errcode = '23514';
    end if;

    if received_now > 0 then
      insert into public.stock_transfer_receipt_lines (
        organization_id, stock_transfer_receipt_id, stock_transfer_line_id, quantity_received
      ) values (
        target_organization_id, receipt_id, transfer_line.id, received_now
      );
      perform private.apply_inventory_change_v2(
        target_organization_id,
        transfer.destination_store_id,
        transfer_line.product_id,
        transfer_line.variant_id,
        received_now,
        'TRANSFER_IN',
        actor_id,
        format('Transfer TR-%s receipt %s', lpad(transfer.transfer_number::text, 6, '0'), lpad(receipt_number::text, 6, '0')),
        'stock_transfer_receipt',
        receipt_id,
        transfer_line.unit_cost_minor
      );
    end if;

    update public.stock_transfer_lines
    set received_quantity = received_quantity + received_now,
        short_quantity = short_quantity + short_now
    where id = transfer_line.id;
  end loop;

  select coalesce(sum(quantity - received_quantity - short_quantity), 0)
  into total_remaining
  from public.stock_transfer_lines
  where stock_transfer_id = transfer.id;
  select exists (
    select 1 from public.stock_transfer_lines
    where stock_transfer_id = transfer.id and short_quantity > 0
  ) into has_shortage;

  to_status := case when total_remaining = 0 then 'received' else 'partially_received' end;
  update public.stock_transfers
  set status = to_status,
      received_by_employee_id = actor_id,
      received_at = now(),
      completed_at = case when total_remaining = 0 then now() else completed_at end
  where id = transfer.id;

  insert into private.stock_transfer_operations (
    organization_id, stock_transfer_id, operation_id, command, normalized_payload,
    from_status, to_status, actor_employee_id, result_id, note
  ) values (
    target_organization_id, transfer.id, target_operation_id, 'receive', command_payload,
    from_status, to_status, actor_id, receipt_id, normalized_note
  );
  perform private.write_audit_log(
    target_organization_id,
    case when total_remaining = 0 then 'STOCK_TRANSFER_RECEIVED' else 'STOCK_TRANSFER_PARTIALLY_RECEIVED' end,
    'inventory.transfer.receive',
    actor_id,
    null,
    transfer.destination_store_id,
    null,
    null,
    null,
    normalized_note,
    jsonb_build_object(
      'stock_transfer_id', transfer.id,
      'transfer_number', transfer.transfer_number,
      'receipt_id', receipt_id,
      'receipt_number', receipt_number,
      'operation_id', target_operation_id,
      'remaining_quantity', total_remaining,
      'has_discrepancy', has_shortage,
      'receipt_lines', normalized_lines
    )
  );
  return receipt_id;
end;
$$;

create or replace function private.cancel_inventory_transfer(
  target_organization_id uuid,
  target_stock_transfer_id uuid,
  target_note text,
  target_operation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
  if (select auth.uid()) is null
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

-- Existing Send transfer callers retain their public signature. Historical
-- retry matching occurs before the canonical chain is invoked.
create or replace function private.create_direct_stock_transfer(
  target_organization_id uuid,
  target_source_store_id uuid,
  target_destination_store_id uuid,
  target_lines jsonb,
  target_note text,
  target_operation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  destination_actor_id uuid;
  existing_transfer public.stock_transfers%rowtype;
  normalized_lines jsonb;
  normalized_note text;
  persisted_lines jsonb;
  transfer_id uuid;
begin
  if (select auth.uid()) is null
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
    target_organization_id, target_source_store_id, target_destination_store_id,
    normalized_lines, normalized_note, target_operation_id
  );
  perform private.submit_inventory_transfer(target_organization_id, transfer_id, null, gen_random_uuid());
  perform private.approve_inventory_transfer(target_organization_id, transfer_id, null, gen_random_uuid());
  perform private.dispatch_inventory_transfer(target_organization_id, transfer_id, null, gen_random_uuid());
  return transfer_id;
end;
$$;

create or replace function private.receive_stock_transfer(
  target_organization_id uuid,
  target_stock_transfer_id uuid,
  target_lines jsonb,
  target_note text,
  target_operation_id uuid
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.receive_inventory_transfer(
    target_organization_id,
    target_stock_transfer_id,
    target_lines,
    target_note,
    target_operation_id,
    true
  );
$$;

create or replace function public.create_inventory_transfer_draft(
  target_organization_id uuid,
  target_source_store_id uuid,
  target_destination_store_id uuid,
  target_lines jsonb,
  target_note text,
  target_operation_id uuid
)
returns uuid language sql security invoker set search_path = '' as $$
  select private.create_inventory_transfer_draft(
    target_organization_id, target_source_store_id, target_destination_store_id,
    target_lines, target_note, target_operation_id
  );
$$;

create or replace function public.submit_inventory_transfer(
  target_organization_id uuid, target_stock_transfer_id uuid,
  target_note text, target_operation_id uuid
)
returns uuid language sql security invoker set search_path = '' as $$
  select private.submit_inventory_transfer(target_organization_id, target_stock_transfer_id, target_note, target_operation_id);
$$;

create or replace function public.approve_inventory_transfer(
  target_organization_id uuid, target_stock_transfer_id uuid,
  target_note text, target_operation_id uuid
)
returns uuid language sql security invoker set search_path = '' as $$
  select private.approve_inventory_transfer(target_organization_id, target_stock_transfer_id, target_note, target_operation_id);
$$;

create or replace function public.dispatch_inventory_transfer(
  target_organization_id uuid, target_stock_transfer_id uuid,
  target_note text, target_operation_id uuid
)
returns uuid language sql security invoker set search_path = '' as $$
  select private.dispatch_inventory_transfer(target_organization_id, target_stock_transfer_id, target_note, target_operation_id);
$$;

create or replace function public.receive_inventory_transfer(
  target_organization_id uuid, target_stock_transfer_id uuid, target_lines jsonb,
  target_note text, target_operation_id uuid
)
returns uuid language sql security invoker set search_path = '' as $$
  select private.receive_inventory_transfer(
    target_organization_id, target_stock_transfer_id, target_lines,
    target_note, target_operation_id, false
  );
$$;

create or replace function public.cancel_inventory_transfer(
  target_organization_id uuid, target_stock_transfer_id uuid,
  target_note text, target_operation_id uuid
)
returns uuid language sql security invoker set search_path = '' as $$
  select private.cancel_inventory_transfer(target_organization_id, target_stock_transfer_id, target_note, target_operation_id);
$$;

-- Corrected reader contract: canonical dispatched rows and temporary legacy
-- in_transit rows are both receivable during the incremental migration.
create or replace function public.get_pos_incoming_stock_transfers(target_organization_id uuid)
returns table (
  transfer_id uuid,
  transfer_number bigint,
  stock_request_id uuid,
  source_store_id uuid,
  source_store_name text,
  destination_store_id uuid,
  destination_store_name text,
  status text,
  note text,
  lines jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    transfer.id,
    transfer.transfer_number,
    transfer.stock_request_id,
    transfer.source_store_id,
    source_store.name,
    transfer.destination_store_id,
    destination_store.name,
    transfer.status,
    transfer.note,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', transfer_line.id,
          'label', product.name || coalesce(' / ' || variant.name, ''),
          'unit', product.unit,
          'quantity', transfer_line.quantity,
          'received_quantity', transfer_line.received_quantity,
          'short_quantity', transfer_line.short_quantity
        ) order by product.name, variant.name nulls first
      ) filter (
        where transfer_line.quantity > transfer_line.received_quantity + transfer_line.short_quantity
      ),
      '[]'::jsonb
    )
  from public.stock_transfers transfer
  join public.stores source_store
    on source_store.id = transfer.source_store_id
   and source_store.organization_id = transfer.organization_id
  join public.stores destination_store
    on destination_store.id = transfer.destination_store_id
   and destination_store.organization_id = transfer.organization_id
  join public.stock_transfer_lines transfer_line
    on transfer_line.stock_transfer_id = transfer.id
   and transfer_line.organization_id = transfer.organization_id
  join public.products product
    on product.id = transfer_line.product_id
   and product.organization_id = transfer_line.organization_id
  left join public.product_variants variant
    on variant.id = transfer_line.variant_id
   and variant.product_id = transfer_line.product_id
   and variant.organization_id = transfer_line.organization_id
  where (select auth.uid()) is not null
    and exists (
      select 1 from public.organizations organization
      where organization.id = target_organization_id and organization.status = 'active'
    )
    and (select private.has_inventory_capability(target_organization_id, 'inventory.transfer.receive'))
    and exists (
      select 1 from public.organization_features feature
      where feature.organization_id = target_organization_id
        and feature.feature_key in ('inventory', 'transfers')
        and feature.is_enabled
      group by feature.organization_id
      having count(*) = 2
    )
    and transfer.organization_id = target_organization_id
    and transfer.status in ('dispatched', 'in_transit', 'partially_received')
    and (select private.has_store_read_scope(target_organization_id, transfer.destination_store_id))
  group by
    transfer.id, transfer.transfer_number, transfer.stock_request_id,
    transfer.source_store_id, source_store.name,
    transfer.destination_store_id, destination_store.name,
    transfer.status, transfer.note
  having bool_or(transfer_line.quantity > transfer_line.received_quantity + transfer_line.short_quantity)
  order by transfer.transfer_number desc;
$$;

revoke all on function private.create_inventory_transfer_draft(uuid, uuid, uuid, jsonb, text, uuid) from public, anon, service_role;
revoke all on function private.submit_inventory_transfer(uuid, uuid, text, uuid) from public, anon, service_role;
revoke all on function private.approve_inventory_transfer(uuid, uuid, text, uuid) from public, anon, service_role;
revoke all on function private.dispatch_inventory_transfer(uuid, uuid, text, uuid) from public, anon, service_role;
revoke all on function private.receive_inventory_transfer(uuid, uuid, jsonb, text, uuid, boolean) from public, anon, service_role;
revoke all on function private.cancel_inventory_transfer(uuid, uuid, text, uuid) from public, anon, service_role;
revoke all on function private.create_direct_stock_transfer(uuid, uuid, uuid, jsonb, text, uuid) from public, anon, service_role;
revoke all on function private.receive_stock_transfer(uuid, uuid, jsonb, text, uuid) from public, anon, service_role;

revoke all on function public.create_inventory_transfer_draft(uuid, uuid, uuid, jsonb, text, uuid) from public, anon, service_role;
revoke all on function public.submit_inventory_transfer(uuid, uuid, text, uuid) from public, anon, service_role;
revoke all on function public.approve_inventory_transfer(uuid, uuid, text, uuid) from public, anon, service_role;
revoke all on function public.dispatch_inventory_transfer(uuid, uuid, text, uuid) from public, anon, service_role;
revoke all on function public.receive_inventory_transfer(uuid, uuid, jsonb, text, uuid) from public, anon, service_role;
revoke all on function public.cancel_inventory_transfer(uuid, uuid, text, uuid) from public, anon, service_role;
revoke all on function public.get_pos_incoming_stock_transfers(uuid) from public, anon, service_role;

grant execute on function private.create_inventory_transfer_draft(uuid, uuid, uuid, jsonb, text, uuid) to authenticated;
grant execute on function private.submit_inventory_transfer(uuid, uuid, text, uuid) to authenticated;
grant execute on function private.approve_inventory_transfer(uuid, uuid, text, uuid) to authenticated;
grant execute on function private.dispatch_inventory_transfer(uuid, uuid, text, uuid) to authenticated;
grant execute on function private.receive_inventory_transfer(uuid, uuid, jsonb, text, uuid, boolean) to authenticated;
grant execute on function private.cancel_inventory_transfer(uuid, uuid, text, uuid) to authenticated;
grant execute on function private.create_direct_stock_transfer(uuid, uuid, uuid, jsonb, text, uuid) to authenticated;
grant execute on function private.receive_stock_transfer(uuid, uuid, jsonb, text, uuid) to authenticated;

grant execute on function public.create_inventory_transfer_draft(uuid, uuid, uuid, jsonb, text, uuid) to authenticated;
grant execute on function public.submit_inventory_transfer(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.approve_inventory_transfer(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.dispatch_inventory_transfer(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.receive_inventory_transfer(uuid, uuid, jsonb, text, uuid) to authenticated;
grant execute on function public.cancel_inventory_transfer(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.get_pos_incoming_stock_transfers(uuid) to authenticated;

comment on function public.create_direct_stock_transfer(uuid, uuid, uuid, jsonb, text, uuid) is
  'Compatibility Send transfer API. It performs canonical create, submit, approve, and dispatch in one transaction and preserves historical operation-key replay.';
comment on function public.receive_stock_transfer(uuid, uuid, jsonb, text, uuid) is
  'Compatibility direct receipt API backed by the canonical receipt engine while preserving historical receipt replay.';
comment on function public.get_pos_incoming_stock_transfers(uuid) is
  'Returns destination-scoped canonical dispatched, legacy in-transit, and partially received transfer documents for authorized POS receivers.';

notify pgrst, 'reload schema';

commit;
