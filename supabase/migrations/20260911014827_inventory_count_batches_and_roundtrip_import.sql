-- Phase 8: physical stocktake batches and a safe count-spreadsheet round trip.
--
-- Count documents and inventory movements remain the only stock truth.  A
-- batch coordinates independently scoped store counts; it never owns stock or
-- posts a shared variance.  Spreadsheet import writes only counted quantities
-- into an existing open count document, then the existing reconciliation and
-- posting procedures remain responsible for inventory movements.
begin;

create sequence if not exists private.inventory_count_batch_number_sequence;

create table if not exists public.inventory_count_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  batch_number bigint not null default nextval('private.inventory_count_batch_number_sequence'),
  name text not null,
  note text,
  created_by_employee_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint inventory_count_batches_organization_number_unique unique (organization_id, batch_number),
  constraint inventory_count_batches_name_present check (char_length(btrim(name)) between 1 and 160),
  constraint inventory_count_batches_note_length check (note is null or char_length(note) <= 500),
  constraint inventory_count_batches_employee_organization_fkey
    foreign key (created_by_employee_id, organization_id)
    references public.employees(id, organization_id) on delete restrict
);

create table if not exists public.inventory_count_batch_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  inventory_count_batch_id uuid not null references public.inventory_count_batches(id) on delete restrict,
  inventory_count_id uuid not null,
  store_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint inventory_count_batch_documents_batch_count_unique unique (inventory_count_batch_id, inventory_count_id),
  constraint inventory_count_batch_documents_batch_store_unique unique (inventory_count_batch_id, store_id),
  constraint inventory_count_batch_documents_count_organization_fkey
    foreign key (inventory_count_id, organization_id)
    references public.inventory_counts(id, organization_id) on delete restrict,
  constraint inventory_count_batch_documents_store_organization_fkey
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id) on delete restrict
);

create index if not exists inventory_count_batches_organization_created_idx
  on public.inventory_count_batches (organization_id, created_at desc);
create index if not exists inventory_count_batch_documents_organization_store_idx
  on public.inventory_count_batch_documents (organization_id, store_id, inventory_count_batch_id);

alter table public.inventory_count_batches enable row level security;
alter table public.inventory_count_batch_documents enable row level security;
revoke all on table public.inventory_count_batches from public, anon, authenticated;
revoke all on table public.inventory_count_batch_documents from public, anon, authenticated;
grant select on table public.inventory_count_batches to authenticated;
grant select on table public.inventory_count_batch_documents to authenticated;

drop policy if exists inventory_count_batches_select_authorized_scope on public.inventory_count_batches;
create policy inventory_count_batches_select_authorized_scope
on public.inventory_count_batches for select to authenticated
using (
  (select private.has_any_inventory_capability(
    organization_id,
    array['inventory.count.create', 'inventory.count.finalize']
  ))
  and exists (
    select 1
    from public.inventory_count_batch_documents batch_document
    join public.inventory_counts count_document
      on count_document.id = batch_document.inventory_count_id
     and count_document.organization_id = batch_document.organization_id
    where batch_document.organization_id = inventory_count_batches.organization_id
      and batch_document.inventory_count_batch_id = inventory_count_batches.id
      and (select private.has_store_read_scope(count_document.organization_id, count_document.store_id))
  )
);

drop policy if exists inventory_count_batch_documents_select_authorized_scope on public.inventory_count_batch_documents;
create policy inventory_count_batch_documents_select_authorized_scope
on public.inventory_count_batch_documents for select to authenticated
using (
  (select private.has_any_inventory_capability(
    organization_id,
    array['inventory.count.create', 'inventory.count.finalize']
  ))
  and exists (
    select 1
    from public.inventory_counts count_document
    where count_document.id = inventory_count_batch_documents.inventory_count_id
      and count_document.organization_id = inventory_count_batch_documents.organization_id
      and (select private.has_store_read_scope(count_document.organization_id, count_document.store_id))
  )
);

-- Count authorization is explicit at the caller boundary. Legacy bundles are
-- resolved by private.has_inventory_capability; no role name is consulted.
create or replace function private.inventory_count_actor(
  target_organization_id uuid,
  target_store_id uuid,
  requested_capabilities text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
begin
  if (select auth.uid()) is null
    or coalesce(cardinality(requested_capabilities), 0) = 0
    or not (select private.has_all_inventory_capabilities(target_organization_id, requested_capabilities)) then
    raise exception 'Inventory count permission is required.' using errcode = '42501';
  end if;
  if not (select private.has_store_read_scope(target_organization_id, target_store_id)) then
    raise exception 'Store access is required for this inventory count.' using errcode = '42501';
  end if;

  actor_id := private.current_employee_id(target_organization_id);
  if actor_id is null or not exists (
    select 1
    from public.employees employee
    where employee.id = actor_id
      and employee.organization_id = target_organization_id
      and employee.status = 'active'
  ) then
    raise exception 'An active employee record is required.' using errcode = '42501';
  end if;
  return actor_id;
end;
$$;

create or replace function private.inventory_count_actor(
  target_organization_id uuid,
  target_store_id uuid
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.inventory_count_actor(
    target_organization_id,
    target_store_id,
    array['inventory.count.create']::text[]
  );
$$;

-- Preserve the canonical count definitions and replace only the finalization
-- actor calls. Creation and editing continue through the explicit two-argument
-- create-capability overload above.
do $$
declare
  target record;
  current_definition text;
  updated_definition text;
begin
  for target in
    select *
    from (
      values
        ('private.submit_inventory_count_for_review(uuid,uuid)'::regprocedure, array['inventory.count.finalize']::text[]),
        ('private.post_inventory_count(uuid,uuid)'::regprocedure, array['inventory.count.finalize']::text[]),
        ('private.cancel_inventory_count(uuid,uuid,text)'::regprocedure, array['inventory.count.finalize']::text[])
    ) as mappings(function_signature, required_capabilities)
  loop
    select pg_get_functiondef(target.function_signature)
    into current_definition;
    updated_definition := replace(
      current_definition,
      'private.inventory_count_actor(target_organization_id, count_document.store_id)',
      format(
        'private.inventory_count_actor(target_organization_id, count_document.store_id, %L::text[])',
        target.required_capabilities
      )
    );
    if updated_definition = current_definition then
      raise exception 'Canonical inventory-count procedure % does not contain the expected actor call.', target.function_signature
        using errcode = 'XX000';
    end if;
    execute updated_definition;
  end loop;

  select pg_get_functiondef('private.complete_inventory_count(uuid,uuid,text,jsonb)'::regprocedure)
  into current_definition;
  updated_definition := replace(
    current_definition,
    'actor_id:=private.inventory_actor(target_organization_id,target_store_id);',
    'perform private.inventory_count_actor(target_organization_id, target_store_id, array[''inventory.count.create'', ''inventory.count.finalize'']::text[]); actor_id:=private.inventory_actor(target_organization_id,target_store_id);'
  );
  if updated_definition = current_definition then
    raise exception 'Canonical complete-inventory-count procedure does not contain the expected actor call.' using errcode = 'XX000';
  end if;
  execute updated_definition;
end;
$$;

drop policy if exists inventory_counts_select_authorized_scope on public.inventory_counts;
create policy inventory_counts_select_authorized_scope
on public.inventory_counts for select to authenticated
using (
  (select private.has_any_inventory_capability(
    organization_id,
    array['inventory.count.create', 'inventory.count.finalize']
  ))
  and (select private.has_store_read_scope(organization_id, store_id))
);

drop policy if exists inventory_count_lines_select_authorized_scope on public.inventory_count_lines;
create policy inventory_count_lines_select_authorized_scope
on public.inventory_count_lines for select to authenticated
using (
  (select private.has_any_inventory_capability(
    organization_id,
    array['inventory.count.create', 'inventory.count.finalize']
  ))
  and exists (
    select 1
    from public.inventory_counts count_document
    where count_document.id = inventory_count_lines.inventory_count_id
      and count_document.organization_id = inventory_count_lines.organization_id
      and (select private.has_store_read_scope(count_document.organization_id, count_document.store_id))
  )
);

create or replace function public.get_inventory_count_suppliers(target_organization_id uuid)
returns table (id uuid, name text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not (select private.has_inventory_capability(target_organization_id, 'inventory.count.create')) then
    raise exception 'Inventory count creation permission is required.' using errcode = '42501';
  end if;

  return query
  select supplier.id, supplier.name
  from public.suppliers supplier
  where supplier.organization_id = target_organization_id
    and supplier.is_active
  order by lower(supplier.name), supplier.id;
end;
$$;

create or replace function private.create_inventory_count_batch(
  target_organization_id uuid,
  target_name text,
  target_note text,
  target_store_ids uuid[],
  target_count_mode text,
  target_sort_mode text,
  target_include_zero_stock boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  batch_id uuid;
  target_store_id uuid;
  count_id uuid;
  normalized_store_ids uuid[];
begin
  normalized_store_ids := array(
    select distinct store_id
    from unnest(coalesce(target_store_ids, array[]::uuid[])) store_id
    order by store_id
  );
  if coalesce(cardinality(normalized_store_ids), 0) < 2
    or cardinality(normalized_store_ids) > 50 then
    raise exception 'Choose between two and fifty stores for one count batch.' using errcode = '22023';
  end if;
  if target_count_mode not in ('standard', 'blind')
    or target_sort_mode not in ('category_name', 'supplier_name', 'sku', 'barcode', 'product_name') then
    raise exception 'Choose valid count batch options.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(target_name, ''))) = 0 then
    raise exception 'Enter a count batch name.' using errcode = '22023';
  end if;

  actor_id := private.inventory_count_actor(target_organization_id, normalized_store_ids[1]);
  foreach target_store_id in array normalized_store_ids loop
    perform private.inventory_count_actor(target_organization_id, target_store_id);
  end loop;

  insert into public.inventory_count_batches (
    organization_id, name, note, created_by_employee_id
  ) values (
    target_organization_id,
    btrim(target_name),
    nullif(btrim(target_note), ''),
    actor_id
  ) returning id into batch_id;

  foreach target_store_id in array normalized_store_ids loop
    count_id := private.create_inventory_count_plan(
      target_organization_id,
      target_store_id,
      target_note,
      target_count_mode,
      'full_store',
      null,
      '[]'::jsonb,
      target_sort_mode,
      target_include_zero_stock
    );
    insert into public.inventory_count_batch_documents (
      organization_id, inventory_count_batch_id, inventory_count_id, store_id
    ) values (
      target_organization_id, batch_id, count_id, target_store_id
    );
  end loop;

  perform private.write_audit_log(
    target_organization_id,
    'INVENTORY_COUNT_BATCH_PREPARED',
    'inventory.count',
    actor_id,
    null,
    null,
    null,
    null,
    null,
    target_note,
    jsonb_build_object(
      'inventory_count_batch_id', batch_id,
      'name', btrim(target_name),
      'store_count', cardinality(normalized_store_ids),
      'count_mode', target_count_mode,
      'sort_mode', target_sort_mode,
      'include_zero_stock', target_include_zero_stock
    )
  );
  return batch_id;
end;
$$;

create or replace function private.import_inventory_count_lines(
  target_organization_id uuid,
  target_inventory_count_id uuid,
  target_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  count_document public.inventory_counts%rowtype;
  actor_id uuid;
  row_value jsonb;
  row_line_id uuid;
  row_product_id uuid;
  row_variant_id uuid;
  row_quantity numeric(14,3);
  count_line public.inventory_count_lines%rowtype;
  imported_count integer := 0;
begin
  if jsonb_typeof(coalesce(target_rows, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(target_rows, '[]'::jsonb)) = 0
    or jsonb_array_length(coalesce(target_rows, '[]'::jsonb)) > 500 then
    raise exception 'Provide between one and five hundred valid count rows.' using errcode = '22023';
  end if;

  select count_row.* into count_document
  from public.inventory_counts count_row
  where count_row.id = target_inventory_count_id
    and count_row.organization_id = target_organization_id
  for update;
  if count_document.id is null then
    raise exception 'Inventory count was not found.' using errcode = '23503';
  end if;
  if count_document.status not in ('draft', 'in_progress') then
    raise exception 'Only an open inventory count can import physical quantities.' using errcode = '23514';
  end if;
  actor_id := private.inventory_count_actor(target_organization_id, count_document.store_id);

  if exists (
    select 1
    from jsonb_array_elements(target_rows) duplicate_row
    group by duplicate_row ->> 'count_line_id'
    having count(*) > 1
  ) then
    raise exception 'The spreadsheet contains a duplicate count line.' using errcode = '22023';
  end if;

  -- Validate every row before recording any quantity.  The enclosing function
  -- is one transaction, so a malformed or cross-document spreadsheet cannot
  -- leave a partial physical count behind.
  for row_value in select value from jsonb_array_elements(target_rows) loop
    if coalesce(row_value ->> 'count_line_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(row_value ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (coalesce(row_value ->> 'variant_id', '') <> '' and row_value ->> 'variant_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
      or coalesce(row_value ->> 'counted_quantity', '') !~ '^\d{1,8}(\.\d{1,3})?$' then
      raise exception 'The spreadsheet contains an invalid count identifier or quantity.' using errcode = '22023';
    end if;
    row_line_id := (row_value ->> 'count_line_id')::uuid;
    row_product_id := (row_value ->> 'product_id')::uuid;
    row_variant_id := nullif(row_value ->> 'variant_id', '')::uuid;
    row_quantity := (row_value ->> 'counted_quantity')::numeric(14,3);

    select line.* into count_line
    from public.inventory_count_lines line
    where line.id = row_line_id
      and line.organization_id = target_organization_id
      and line.inventory_count_id = target_inventory_count_id
      and line.product_id = row_product_id
      and line.variant_id is not distinct from row_variant_id
    for update;
    if count_line.id is null then
      raise exception 'The spreadsheet contains a line that does not belong to this count.' using errcode = '23503';
    end if;
  end loop;

  for row_value in select value from jsonb_array_elements(target_rows) loop
    perform private.save_inventory_count_line(
      target_organization_id,
      target_inventory_count_id,
      (row_value ->> 'product_id')::uuid,
      nullif(row_value ->> 'variant_id', '')::uuid,
      (row_value ->> 'counted_quantity')::numeric(14,3)
    );
    imported_count := imported_count + 1;
  end loop;

  perform private.write_audit_log(
    target_organization_id,
    'INVENTORY_COUNT_LINES_IMPORTED',
    'inventory.count',
    actor_id,
    null,
    count_document.store_id,
    null,
    null,
    null,
    'Count spreadsheet import',
    jsonb_build_object(
      'inventory_count_id', count_document.id,
      'count_number', count_document.count_number,
      'imported_line_count', imported_count
    )
  );
  return imported_count;
end;
$$;

create or replace function public.create_inventory_count_batch(
  target_organization_id uuid,
  target_name text,
  target_note text,
  target_store_ids uuid[],
  target_count_mode text,
  target_sort_mode text,
  target_include_zero_stock boolean
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_inventory_count_batch(
    target_organization_id,
    target_name,
    target_note,
    target_store_ids,
    target_count_mode,
    target_sort_mode,
    target_include_zero_stock
  );
$$;

create or replace function public.import_inventory_count_lines(
  target_organization_id uuid,
  target_inventory_count_id uuid,
  target_rows jsonb
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.import_inventory_count_lines(
    target_organization_id,
    target_inventory_count_id,
    target_rows
  );
$$;

revoke execute on function private.create_inventory_count_batch(uuid, text, text, uuid[], text, text, boolean) from public, anon, service_role;
revoke execute on function private.import_inventory_count_lines(uuid, uuid, jsonb) from public, anon, service_role;
revoke execute on function public.create_inventory_count_batch(uuid, text, text, uuid[], text, text, boolean) from public, anon, service_role;
revoke execute on function public.import_inventory_count_lines(uuid, uuid, jsonb) from public, anon, service_role;
grant execute on function public.create_inventory_count_batch(uuid, text, text, uuid[], text, text, boolean) to authenticated;
grant execute on function public.import_inventory_count_lines(uuid, uuid, jsonb) to authenticated;
grant execute on function private.create_inventory_count_batch(uuid, text, text, uuid[], text, text, boolean) to authenticated;
grant execute on function private.import_inventory_count_lines(uuid, uuid, jsonb) to authenticated;

comment on table public.inventory_count_batches is
  'Coordination-only parent for independently authoritative store inventory counts. It has no stock balance or movement authority.';
comment on function public.import_inventory_count_lines(uuid, uuid, jsonb) is
  'Imports validated nonblank physical quantities into one open count document. It never updates inventory levels or posts a variance.';

commit;
