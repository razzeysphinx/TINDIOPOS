-- MOB-10 A29: make an expired delta cursor explicit and provide a scoped,
-- authoritative resnapshot. Retention maintenance is owner-only; mobile
-- clients can observe the boundary but can never move it.

begin;

create table private.pos_sync_retention_state (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  retained_after_revision bigint not null default 0 check (retained_after_revision >= 0),
  updated_at timestamptz not null default now()
);

revoke all on table private.pos_sync_retention_state from public, anon, authenticated, service_role;

create or replace function public.get_pos_sync_revision(
  target_organization_id uuid,
  target_device_id uuid
) returns table(current_revision bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_pos_sync_access(target_organization_id, target_device_id);
  return query
  select greatest(
    coalesce((select state.retained_after_revision from private.pos_sync_retention_state state where state.organization_id = target_organization_id), 0),
    coalesce((select max(change.revision) from public.pos_sync_changes change where change.organization_id = target_organization_id), 0)
  );
end;
$$;

create or replace function public.get_pos_sync_retention_state(
  target_organization_id uuid,
  target_device_id uuid
) returns table(retained_after_revision bigint, current_revision bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_pos_sync_access(target_organization_id, target_device_id);

  return query
  select
    coalesce(retention.retained_after_revision, 0),
    greatest(
      coalesce(retention.retained_after_revision, 0),
      coalesce((
        select max(change.revision)
        from public.pos_sync_changes change
        where change.organization_id = target_organization_id
      ), 0)
    )
  from (select 1) seed
  left join private.pos_sync_retention_state retention
    on retention.organization_id = target_organization_id;
end;
$$;

create or replace function private.prune_pos_sync_changes(
  target_organization_id uuid,
  target_through_revision bigint
) returns table(retained_after_revision bigint, deleted_changes bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  maximum_revision bigint;
  effective_boundary bigint;
  removed bigint;
begin
  if target_organization_id is null or target_through_revision is null or target_through_revision < 0 then
    raise exception 'Invalid sync retention boundary.' using errcode = '22023';
  end if;

  select coalesce(max(change.revision), 0)
  into maximum_revision
  from public.pos_sync_changes change
  where change.organization_id = target_organization_id;

  if target_through_revision > greatest(
    maximum_revision,
    coalesce((select state.retained_after_revision from private.pos_sync_retention_state state where state.organization_id = target_organization_id), 0)
  ) then
    raise exception 'Sync retention boundary is beyond the authoritative revision.' using errcode = '22023';
  end if;

  insert into private.pos_sync_retention_state(organization_id, retained_after_revision, updated_at)
  values (target_organization_id, target_through_revision, now())
  on conflict (organization_id) do update
  set retained_after_revision = greatest(private.pos_sync_retention_state.retained_after_revision, excluded.retained_after_revision),
      updated_at = case
        when excluded.retained_after_revision > private.pos_sync_retention_state.retained_after_revision then now()
        else private.pos_sync_retention_state.updated_at
      end
  returning private.pos_sync_retention_state.retained_after_revision into effective_boundary;

  delete from public.pos_sync_changes change
  where change.organization_id = target_organization_id
    and change.revision <= effective_boundary;
  get diagnostics removed = row_count;

  return query select effective_boundary, removed;
end;
$$;

create or replace function public.get_pos_sync_resnapshot_v1(
  target_organization_id uuid,
  target_device_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_store_id uuid;
  boundary bigint;
  revision bigint;
  catalog jsonb := '[]'::jsonb;
  catalog_page jsonb;
  page_offset integer := 0;
  page_limit integer;
  reference_snapshot jsonb;
begin
  select access.store_id
  into selected_store_id
  from private.require_pos_sync_access(target_organization_id, target_device_id) access;

  select
    coalesce(retention.retained_after_revision, 0),
    greatest(
      coalesce(retention.retained_after_revision, 0),
      coalesce((select max(change.revision) from public.pos_sync_changes change where change.organization_id = target_organization_id), 0)
    )
  into boundary, revision
  from (select 1) seed
  left join private.pos_sync_retention_state retention
    on retention.organization_id = target_organization_id;

  while page_offset < 10000 loop
    page_limit := least(48, 10000 - page_offset);
    select coalesce(
      jsonb_agg(jsonb_build_object(
        'productId', item.product_id,
        'variantId', item.variant_id,
        'categoryId', item.category_id,
        'productName', item.product_name,
        'variantName', item.variant_name,
        'sku', item.sku,
        'barcode', item.barcode,
        'priceMinor', item.price_minor,
        'unit', item.unit,
        'imageUrl', item.image_url,
        'isVariablePrice', item.is_variable_price,
        'allowFractionalQuantity', item.allow_fractional_quantity,
        'hasModifiers', exists (
          select 1
          from public.product_modifier_groups assignment
          where assignment.organization_id = target_organization_id
            and assignment.product_id = item.product_id
        )
      )), '[]'::jsonb)
    into catalog_page
    from public.search_pos_catalog(target_organization_id, selected_store_id, '', null, page_offset, page_limit) item;

    catalog := catalog || catalog_page;
    exit when jsonb_array_length(catalog_page) < page_limit;
    page_offset := page_offset + page_limit;
  end loop;

  select public.get_pos_reference_bundle_v2(target_organization_id)
  into reference_snapshot;

  return jsonb_build_object(
    'organizationId', target_organization_id,
    'deviceId', target_device_id,
    'storeId', selected_store_id,
    'serverRevision', revision,
    'retainedAfterRevision', boundary,
    'catalog', catalog,
    'reference', reference_snapshot
  );
end;
$$;

comment on function private.prune_pos_sync_changes(uuid, bigint)
is 'Owner-only monotonic POS delta retention maintenance. Never callable through the mobile API.';
comment on function public.get_pos_sync_resnapshot_v1(uuid, uuid)
is 'Returns one device/store-scoped authoritative cache snapshot at a declared revision after cursor expiry.';

revoke execute on function public.get_pos_sync_retention_state(uuid, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.get_pos_sync_resnapshot_v1(uuid, uuid) from public, anon, authenticated, service_role;
revoke execute on function private.prune_pos_sync_changes(uuid, bigint) from public, anon, authenticated, service_role, tindio_authenticated;
grant execute on function public.get_pos_sync_retention_state(uuid, uuid) to tindio_authenticated;
grant execute on function public.get_pos_sync_resnapshot_v1(uuid, uuid) to tindio_authenticated;

notify pgrst, 'reload schema';
commit;
