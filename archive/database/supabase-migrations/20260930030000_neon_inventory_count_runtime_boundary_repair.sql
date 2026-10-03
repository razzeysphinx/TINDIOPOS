-- Post-Phase-26 certification repair. Authorization resolution only.
begin;

-- ---------------------------------------------------------------------------
-- 1. PROVIDER-NEUTRAL INVENTORY COUNT ACTOR
create or replace function private.inventory_count_actor(target_organization_id uuid, target_store_id uuid, requested_capabilities text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_profile_id uuid; actor_id uuid;
begin
  actor_profile_id := private.current_profile_id();
  if actor_profile_id is null or coalesce(cardinality(requested_capabilities),0)=0
    or not private.has_all_inventory_capabilities(target_organization_id, requested_capabilities) then
    raise exception 'Inventory count permission is required.' using errcode='42501';
  end if;
  if not private.has_store_read_scope(target_organization_id,target_store_id) then
    raise exception 'Store access is required for this inventory count.' using errcode='42501';
  end if;
  select employee.id into actor_id from public.employees employee
  where employee.organization_id=target_organization_id and employee.profile_id=actor_profile_id and employee.status='active'
  order by employee.created_at, employee.id limit 1;
  if actor_id is null then raise exception 'An active employee record is required.' using errcode='42501'; end if;
  return actor_id;
end; $$;

create or replace function private.inventory_count_actor(target_organization_id uuid, target_store_id uuid)
returns uuid language sql security definer set search_path = '' as $$
  select private.inventory_count_actor(target_organization_id,target_store_id,array['inventory.count.create']::text[]);
$$;

-- ---------------------------------------------------------------------------
-- 2. PROVIDER-NEUTRAL SUPPLIER LOOKUP
create or replace function public.get_inventory_count_suppliers(target_organization_id uuid)
returns table (id uuid, name text) language plpgsql stable security definer set search_path = '' as $$
begin
  if private.current_profile_id() is null or not private.has_inventory_capability(target_organization_id,'inventory.count.create') then
    raise exception 'Inventory count creation permission is required.' using errcode='42501';
  end if;
  return query select supplier.id,supplier.name from public.suppliers supplier
    where supplier.organization_id=target_organization_id and supplier.is_active order by lower(supplier.name),supplier.id;
end; $$;

-- ---------------------------------------------------------------------------
-- 3. COUNT DOCUMENT READ BOUNDARY
create or replace function public.get_inventory_counts_workspace_v2(target_organization_id uuid,target_store_ids uuid[] default null,target_limit integer default 100)
returns table (id uuid,count_number bigint,store_id uuid,status text,note text,started_at timestamptz,started_by_employee_id uuid,completed_at timestamptz,updated_at timestamptz,count_mode text,scope_type text,scope_reference_id uuid,sort_mode text,include_zero_stock boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if target_organization_id is null or target_limit is null or target_limit not between 1 and 100 then raise exception 'Invalid inventory count workspace request.' using errcode='22023'; end if;
  if private.current_profile_id() is null or not private.has_any_inventory_capability(target_organization_id,array['inventory.count.create','inventory.count.finalize']::text[]) then raise exception 'Inventory count access is required.' using errcode='42501'; end if;
  return query select c.id,c.count_number,c.store_id,c.status,c.note,c.started_at,c.started_by_employee_id,c.completed_at,c.updated_at,c.count_mode,c.scope_type,c.scope_reference_id,c.sort_mode,c.include_zero_stock
  from public.inventory_counts c where c.organization_id=target_organization_id
    and c.status in ('draft','in_progress','ready_for_review','posted','cancelled','open','completed')
    and (target_store_ids is null or c.store_id=any(target_store_ids))
    and private.has_store_read_scope(target_organization_id,c.store_id)
  order by c.started_at desc,c.id desc limit target_limit;
end; $$;

-- ---------------------------------------------------------------------------
-- 4. COUNT-LINE READ BOUNDARY
create or replace function public.get_inventory_count_lines_workspace_v2(target_organization_id uuid,target_inventory_count_ids uuid[])
returns table (id uuid,inventory_count_id uuid,product_id uuid,variant_id uuid,expected_quantity numeric,reconciled_expected_quantity numeric,counted_quantity numeric,counted_at timestamptz,product_name_snapshot text,variant_name_snapshot text,category_name_snapshot text,sku_snapshot text,barcode_snapshot text,unit_snapshot text,line_sort_order integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if target_organization_id is null or target_inventory_count_ids is null or cardinality(target_inventory_count_ids) not between 1 and 100 then raise exception 'Choose between one and one hundred inventory counts.' using errcode='22023'; end if;
  if private.current_profile_id() is null or not private.has_any_inventory_capability(target_organization_id,array['inventory.count.create','inventory.count.finalize']::text[]) then raise exception 'Inventory count access is required.' using errcode='42501'; end if;
  return query select l.id,l.inventory_count_id,l.product_id,l.variant_id,l.expected_quantity,l.reconciled_expected_quantity,l.counted_quantity,l.counted_at,l.product_name_snapshot,l.variant_name_snapshot,l.category_name_snapshot,l.sku_snapshot,l.barcode_snapshot,l.unit_snapshot,l.line_sort_order
  from public.inventory_count_lines l join public.inventory_counts c on c.organization_id=l.organization_id and c.id=l.inventory_count_id
  where l.organization_id=target_organization_id and l.inventory_count_id=any(target_inventory_count_ids) and private.has_store_read_scope(target_organization_id,c.store_id)
  order by l.inventory_count_id,l.line_sort_order,l.id;
end; $$;

-- ---------------------------------------------------------------------------
-- 5. COUNT-BATCH READ BOUNDARY
create or replace function public.get_inventory_count_batches_workspace_v2(target_organization_id uuid,target_limit integer default 25)
returns table (id uuid,batch_number bigint,name text,note text,created_at timestamptz,updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if target_organization_id is null or target_limit is null or target_limit not between 1 and 50 then raise exception 'Invalid inventory count batch request.' using errcode='22023'; end if;
  if private.current_profile_id() is null or not private.has_any_inventory_capability(target_organization_id,array['inventory.count.create','inventory.count.finalize']::text[]) then raise exception 'Inventory count access is required.' using errcode='42501'; end if;
  return query select b.id,b.batch_number,b.name,b.note,b.created_at,b.updated_at from public.inventory_count_batches b
  where b.organization_id=target_organization_id and exists (select 1 from public.inventory_count_batch_documents d join public.inventory_counts c on c.organization_id=d.organization_id and c.id=d.inventory_count_id where d.organization_id=b.organization_id and d.inventory_count_batch_id=b.id and private.has_store_read_scope(target_organization_id,c.store_id))
  order by b.created_at desc,b.id desc limit target_limit;
end; $$;

create or replace function public.get_inventory_count_batch_documents_workspace_v2(target_organization_id uuid,target_inventory_count_batch_ids uuid[])
returns table (inventory_count_batch_id uuid,inventory_count_id uuid,store_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if target_organization_id is null or target_inventory_count_batch_ids is null or cardinality(target_inventory_count_batch_ids) not between 1 and 50 then raise exception 'Choose between one and fifty count batches.' using errcode='22023'; end if;
  if private.current_profile_id() is null or not private.has_any_inventory_capability(target_organization_id,array['inventory.count.create','inventory.count.finalize']::text[]) then raise exception 'Inventory count access is required.' using errcode='42501'; end if;
  return query select d.inventory_count_batch_id,d.inventory_count_id,d.store_id from public.inventory_count_batch_documents d
  where d.organization_id=target_organization_id and d.inventory_count_batch_id=any(target_inventory_count_batch_ids) and private.has_store_read_scope(target_organization_id,d.store_id)
  order by d.inventory_count_batch_id,d.store_id,d.inventory_count_id;
end; $$;

revoke execute on function private.inventory_count_actor(uuid,uuid,text[]) from public,anon,authenticated,service_role;
revoke execute on function private.inventory_count_actor(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_inventory_count_suppliers(uuid) from public,anon,service_role;
grant execute on function public.get_inventory_count_suppliers(uuid) to authenticated;
revoke all on function public.get_inventory_counts_workspace_v2(uuid,uuid[],integer) from public,anon,service_role;
grant execute on function public.get_inventory_counts_workspace_v2(uuid,uuid[],integer) to authenticated;
revoke all on function public.get_inventory_count_lines_workspace_v2(uuid,uuid[]) from public,anon,service_role;
grant execute on function public.get_inventory_count_lines_workspace_v2(uuid,uuid[]) to authenticated;
revoke all on function public.get_inventory_count_batches_workspace_v2(uuid,integer) from public,anon,service_role;
grant execute on function public.get_inventory_count_batches_workspace_v2(uuid,integer) to authenticated;
revoke all on function public.get_inventory_count_batch_documents_workspace_v2(uuid,uuid[]) from public,anon,service_role;
grant execute on function public.get_inventory_count_batch_documents_workspace_v2(uuid,uuid[]) to authenticated;
notify pgrst, 'reload schema';
commit;
