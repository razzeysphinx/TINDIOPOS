begin;

create or replace function public.get_pos_catalog_v2(
  target_organization_id uuid,
  target_store_id uuid,
  target_mode text default 'search',
  target_query text default null,
  target_category_id uuid default null,
  target_offset integer default 0,
  target_limit integer default 24
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_profile_id uuid;
  selected_employee_id uuid;
  permissions text[] := '{}'::text[];
  effective_store_ids uuid[] := '{}'::uuid[];
  modifiers_enabled boolean := false;
  raw_items_json jsonb := '[]'::jsonb;
  items_json jsonb := '[]'::jsonb;
  has_more boolean := false;
begin
  if target_mode is null
    or target_mode not in ('search', 'favorites', 'recent') then
    return jsonb_build_object(
      'ok', false,
      'reason', 'CATALOG_MODE_INVALID'
    );
  end if;

  if target_offset is null
    or target_offset < 0
    or target_offset > 10000
    or target_limit is null
    or target_limit < 1
    or target_limit > 24 then
    return jsonb_build_object(
      'ok', false,
      'reason', 'CATALOG_PAGE_INVALID'
    );
  end if;

  actor_profile_id := private.current_profile_id();

  if actor_profile_id is null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'IDENTITY_UNMAPPED'
    );
  end if;

  select employee.id
  into selected_employee_id
  from public.employees employee
  where employee.profile_id = actor_profile_id
    and employee.organization_id = target_organization_id
    and employee.status = 'active'
  order by employee.created_at, employee.id
  limit 1;

  if selected_employee_id is null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'ORGANIZATION_FORBIDDEN'
    );
  end if;

  select
    coalesce(
      array_agg(
        distinct role_permission.permission_code
        order by role_permission.permission_code
      ),
      '{}'::text[]
    )
  into permissions
  from public.employee_roles employee_role
  join public.role_permissions role_permission
    on role_permission.organization_id = employee_role.organization_id
    and role_permission.role_id = employee_role.role_id
  where employee_role.organization_id = target_organization_id
    and employee_role.employee_id = selected_employee_id;

  if not (
    'pos.access' = any(permissions)
    and 'sales.create' = any(permissions)
  ) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'POS_ACCESS_FORBIDDEN'
    );
  end if;

  if 'stores.manage' = any(permissions) then
    select
      coalesce(
        array_agg(store.id order by store.created_at, store.id),
        '{}'::uuid[]
      )
    into effective_store_ids
    from public.stores store
    where store.organization_id = target_organization_id
      and store.is_active;
  else
    select
      coalesce(
        array_agg(distinct store.id order by store.id),
        '{}'::uuid[]
      )
    into effective_store_ids
    from public.employee_stores assignment
    join public.stores store
      on store.organization_id = assignment.organization_id
      and store.id = assignment.store_id
      and store.is_active
    where assignment.organization_id = target_organization_id
      and assignment.employee_id = selected_employee_id;
  end if;

  if target_store_id is null
    or not target_store_id = any(effective_store_ids) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'STORE_FORBIDDEN'
    );
  end if;

  if not exists (
    select 1
    from public.shifts shift
    where shift.organization_id = target_organization_id
      and shift.store_id = target_store_id
      and shift.opened_by_employee_id = selected_employee_id
      and shift.status = 'open'
  ) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'ACTIVE_SHIFT_REQUIRED'
    );
  end if;

  select
    coalesce(
      bool_or(feature.is_enabled)
        filter (where feature.feature_key = 'modifiers'),
      false
    )
  into modifiers_enabled
  from public.organization_features feature
  where feature.organization_id = target_organization_id;

  if target_mode = 'search' then
    select
      coalesce(
        jsonb_agg(to_jsonb(catalog_item)),
        '[]'::jsonb
      )
    into raw_items_json
    from public.search_pos_catalog(
      target_organization_id,
      target_store_id,
      target_query,
      target_category_id,
      target_offset,
      target_limit + 1
    ) catalog_item;
  elsif target_mode = 'favorites' then
    select
      coalesce(
        jsonb_agg(to_jsonb(catalog_item)),
        '[]'::jsonb
      )
    into raw_items_json
    from (
      select *
      from public.get_pos_favorite_items(
        target_organization_id,
        target_store_id
      )
      offset target_offset
      limit target_limit + 1
    ) catalog_item;
  else
    select
      coalesce(
        jsonb_agg(to_jsonb(catalog_item)),
        '[]'::jsonb
      )
    into raw_items_json
    from (
      select *
      from public.get_pos_recent_items(
        target_organization_id,
        target_store_id,
        least(target_offset + target_limit + 1, 24)
      )
      offset target_offset
      limit target_limit + 1
    ) catalog_item;
  end if;

  has_more := jsonb_array_length(raw_items_json) > target_limit;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'productId', item.value -> 'product_id',
          'variantId', item.value -> 'variant_id',
          'categoryId', item.value -> 'category_id',
          'productName', item.value -> 'product_name',
          'variantName', item.value -> 'variant_name',
          'sku', item.value -> 'sku',
          'barcode', item.value -> 'barcode',
          'priceMinor', item.value -> 'price_minor',
          'unit', item.value -> 'unit',
          'imageUrl', item.value -> 'image_url',
          'isVariablePrice', item.value -> 'is_variable_price',
          'allowFractionalQuantity',
            item.value -> 'allow_fractional_quantity',
          'hasModifiers',
            modifiers_enabled
            and exists (
              select 1
              from public.product_modifier_groups assignment
              where assignment.organization_id = target_organization_id
                and assignment.product_id =
                  (item.value ->> 'product_id')::uuid
            )
        )
        order by item.ordinality
      ),
      '[]'::jsonb
    )
  into items_json
  from jsonb_array_elements(raw_items_json)
    with ordinality as item(value, ordinality)
  where item.ordinality <= target_limit;

  return jsonb_build_object(
    'ok', true,
    'organizationId', target_organization_id,
    'storeId', target_store_id,
    'mode', target_mode,
    'offset', target_offset,
    'limit', target_limit,
    'items', items_json,
    'hasMore', has_more
  );
end;
$$;

create or replace function public.get_pos_modifiers_v2(
  target_organization_id uuid,
  target_store_id uuid,
  target_product_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_profile_id uuid;
  selected_employee_id uuid;
  permissions text[] := '{}'::text[];
  effective_store_ids uuid[] := '{}'::uuid[];
  modifiers_enabled boolean := false;
  groups_json jsonb := '[]'::jsonb;
begin
  actor_profile_id := private.current_profile_id();

  if actor_profile_id is null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'IDENTITY_UNMAPPED'
    );
  end if;

  select employee.id
  into selected_employee_id
  from public.employees employee
  where employee.profile_id = actor_profile_id
    and employee.organization_id = target_organization_id
    and employee.status = 'active'
  order by employee.created_at, employee.id
  limit 1;

  if selected_employee_id is null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'ORGANIZATION_FORBIDDEN'
    );
  end if;

  select
    coalesce(
      array_agg(
        distinct role_permission.permission_code
        order by role_permission.permission_code
      ),
      '{}'::text[]
    )
  into permissions
  from public.employee_roles employee_role
  join public.role_permissions role_permission
    on role_permission.organization_id = employee_role.organization_id
    and role_permission.role_id = employee_role.role_id
  where employee_role.organization_id = target_organization_id
    and employee_role.employee_id = selected_employee_id;

  if not (
    'pos.access' = any(permissions)
    and 'sales.create' = any(permissions)
  ) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'POS_ACCESS_FORBIDDEN'
    );
  end if;

  if 'stores.manage' = any(permissions) then
    select
      coalesce(
        array_agg(store.id order by store.created_at, store.id),
        '{}'::uuid[]
      )
    into effective_store_ids
    from public.stores store
    where store.organization_id = target_organization_id
      and store.is_active;
  else
    select
      coalesce(
        array_agg(distinct store.id order by store.id),
        '{}'::uuid[]
      )
    into effective_store_ids
    from public.employee_stores assignment
    join public.stores store
      on store.organization_id = assignment.organization_id
      and store.id = assignment.store_id
      and store.is_active
    where assignment.organization_id = target_organization_id
      and assignment.employee_id = selected_employee_id;
  end if;

  if target_store_id is null
    or not target_store_id = any(effective_store_ids) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'STORE_FORBIDDEN'
    );
  end if;

  if not exists (
    select 1
    from public.shifts shift
    where shift.organization_id = target_organization_id
      and shift.store_id = target_store_id
      and shift.opened_by_employee_id = selected_employee_id
      and shift.status = 'open'
  ) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'ACTIVE_SHIFT_REQUIRED'
    );
  end if;

  select
    coalesce(
      bool_or(feature.is_enabled)
        filter (where feature.feature_key = 'modifiers'),
      false
    )
  into modifiers_enabled
  from public.organization_features feature
  where feature.organization_id = target_organization_id;

  if not modifiers_enabled then
    return jsonb_build_object(
      'ok', true,
      'organizationId', target_organization_id,
      'storeId', target_store_id,
      'productId', target_product_id,
      'groups', '[]'::jsonb
    );
  end if;

  if not exists (
    select 1
    from public.products product
    join public.product_store_settings setting
      on setting.organization_id = product.organization_id
      and setting.product_id = product.id
      and setting.store_id = target_store_id
      and setting.is_available
    where product.organization_id = target_organization_id
      and product.id = target_product_id
      and product.status = 'active'
  ) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'PRODUCT_FORBIDDEN'
    );
  end if;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', modifier_group.group_id,
          'name', modifier_group.group_name,
          'minSelections', modifier_group.min_selections,
          'maxSelections', modifier_group.max_selections,
          'options',
            coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'id', modifier_option.value -> 'id',
                    'name', modifier_option.value -> 'name',
                    'priceMinor',
                      modifier_option.value -> 'price_minor'
                  )
                  order by modifier_option.ordinality
                )
                from jsonb_array_elements(
                  coalesce(modifier_group.options, '[]'::jsonb)
                ) with ordinality as modifier_option(value, ordinality)
              ),
              '[]'::jsonb
            )
        )
      ),
      '[]'::jsonb
    )
  into groups_json
  from public.get_pos_product_modifiers(
    target_organization_id,
    target_store_id,
    target_product_id
  ) modifier_group;

  return jsonb_build_object(
    'ok', true,
    'organizationId', target_organization_id,
    'storeId', target_store_id,
    'productId', target_product_id,
    'groups', groups_json
  );
end;
$$;

revoke all
on function public.get_pos_catalog_v2(uuid, uuid, text, text, uuid, integer, integer)
from public, anon, service_role;

revoke all
on function public.get_pos_modifiers_v2(uuid, uuid, uuid)
from public, anon, service_role;

grant execute
on function public.get_pos_catalog_v2(uuid, uuid, text, text, uuid, integer, integer)
to authenticated;

grant execute
on function public.get_pos_modifiers_v2(uuid, uuid, uuid)
to authenticated;

comment on function public.get_pos_catalog_v2(uuid, uuid, text, text, uuid, integer, integer)
is
'POS V2 catalog wrapper. Resolves provider-neutral identity, POS scope, active shift, modifiers feature availability, and returns catalog items in the V2 camelCase contract.';

comment on function public.get_pos_modifiers_v2(uuid, uuid, uuid)
is
'POS V2 lazy modifier wrapper. Resolves provider-neutral identity, POS scope, active shift, modifiers feature availability, and returns one product''s modifier groups in the V2 camelCase contract.';

notify pgrst, 'reload schema';

commit;
