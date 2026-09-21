begin;

create or replace function private.is_made_to_order_composite(
  target_organization_id uuid,
  target_product_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.products product
    where product.organization_id = target_organization_id
      and product.id = target_product_id
      and product.status = 'active'
      and product.product_type = 'simple'
      and product.track_inventory
      and product.is_composite
      and product.composite_inventory_mode = 'made_to_order'
  );
$function$;

revoke execute on function private.is_made_to_order_composite(uuid,uuid)
from public, anon, authenticated, service_role;


create or replace function private.consume_made_to_order_composite_sale(
  target_organization_id uuid,
  target_store_id uuid,
  target_product_id uuid,
  target_quantity numeric,
  target_actor_employee_id uuid,
  target_sale_id uuid,
  target_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  component record;
  component_level public.inventory_levels%rowtype;
  component_quantity numeric(14,3);
begin
  if target_organization_id is null
    or target_store_id is null
    or target_product_id is null
    or target_actor_employee_id is null
    or target_sale_id is null
    or target_quantity is null
    or target_quantity <= 0
    or target_quantity <> round(target_quantity, 3) then
    raise exception 'A valid made-to-order sale quantity is required.'
      using errcode = '23514';
  end if;

  if not private.is_made_to_order_composite(
    target_organization_id,
    target_product_id
  ) then
    raise exception 'That product is not a made-to-order composite.'
      using errcode = '23514';
  end if;

  for component in
    select
      recipe.component_product_id,
      recipe.component_variant_id,
      recipe.quantity_per_composite,
      component_product.name
    from public.product_components recipe
    join public.products component_product
      on component_product.id = recipe.component_product_id
     and component_product.organization_id = recipe.organization_id
    where recipe.organization_id = target_organization_id
      and recipe.product_id = target_product_id
      and component_product.track_inventory
    order by recipe.component_product_id, recipe.component_variant_id
  loop
    component_quantity :=
      round(component.quantity_per_composite * target_quantity, 3);

    select level.*
    into component_level
    from public.inventory_levels level
    where level.organization_id = target_organization_id
      and level.store_id = target_store_id
      and level.product_id = component.component_product_id
      and level.variant_id is not distinct from component.component_variant_id
    for update;

    if component_level.id is null then
      raise exception
        'The stock projection is not initialized for composite component %.',
        component.name
        using errcode = '23514';
    end if;

    perform private.apply_inventory_change_v2(
      target_organization_id,
      target_store_id,
      component.component_product_id,
      component.component_variant_id,
      -component_quantity,
      'SALE',
      target_actor_employee_id,
      coalesce(nullif(btrim(target_reason), ''), 'Made-to-order composite sale'),
      'composite_sale',
      target_sale_id,
      component_level.average_cost_minor
    );
  end loop;
end;
$function$;

revoke execute on function private.consume_made_to_order_composite_sale(
  uuid,uuid,uuid,numeric,uuid,uuid,text
)
from public, anon, authenticated, service_role;


create or replace function private.validate_pos_cart_stock(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid,
  target_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
    and employee.profile_id = (select auth.uid())
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
$function$;


-- Patch the retained integer first-time checkout implementation.
do $migration$
declare
  function_definition text;
  old_fragment text;
  new_fragment text;
begin
  select pg_get_functiondef(
    'private.checkout_sale_v1(uuid,uuid,uuid,uuid,jsonb,jsonb)'::regprocedure
  )
  into function_definition;

  old_fragment := '    if tracks_inventory then';

  if position(old_fragment in function_definition) = 0 then
    raise exception
      'Expected checkout_sale_v1 tracked-stock block was not found.';
  end if;

  new_fragment :=
$replacement$    if tracks_inventory
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
    elsif tracks_inventory then$replacement$;

  execute replace(
    function_definition,
    old_fragment,
    new_fragment
  );
end;
$migration$;


-- Patch the fractional/manual-price checkout implementation.
--
-- This function has previously been re-emitted through pg_get_functiondef(...)
-- by checkout payment-settlement migrations. Match the exact tracked-product
-- predicate semantically rather than relying on historical whitespace, while
-- still requiring exactly one guarded match.
do $migration$
declare
  function_definition text;

  tracked_stock_pattern constant text :=
    'if[[:space:]]+exists[[:space:]]*'
    || '\([[:space:]]*'
    || 'select[[:space:]]+1[[:space:]]+'
    || 'from[[:space:]]+public[.]products[[:space:]]+product[[:space:]]+'
    || 'where[[:space:]]+product[.]id[[:space:]]*=[[:space:]]*checkout_line[.]product_id[[:space:]]+'
    || 'and[[:space:]]+product[.]organization_id[[:space:]]*=[[:space:]]*target_organization_id[[:space:]]+'
    || 'and[[:space:]]+product[.]track_inventory[[:space:]]*'
    || '\)[[:space:]]+then';

  tracked_stock_replacement constant text :=
$replacement$if checkout_line.variant_id is null
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
    ) then$replacement$;

  match_count integer;
begin
  if to_regprocedure(
    'private.checkout_catalog_special_sale(uuid,uuid,uuid,uuid,jsonb,jsonb)'
  ) is null then
    raise exception
      'Special catalogue checkout function is missing.';
  end if;

  select pg_get_functiondef(
    'private.checkout_catalog_special_sale(uuid,uuid,uuid,uuid,jsonb,jsonb)'::regprocedure
  )
  into function_definition;

  select count(*)
  into match_count
  from regexp_matches(
    function_definition,
    tracked_stock_pattern,
    'g'
  );

  if match_count <> 1 then
    raise exception
      'Expected exactly one special-checkout tracked-stock branch; found %.',
      match_count;
  end if;

  function_definition :=
    regexp_replace(
      function_definition,
      tracked_stock_pattern,
      tracked_stock_replacement,
      ''
    );

  if function_definition !~ 'private[.]consume_made_to_order_composite_sale'
    or function_definition !~ 'elsif[[:space:]]+exists'
    or function_definition !~ 'product[.]track_inventory' then
    raise exception
      'Special-checkout made-to-order patch verification failed.';
  end if;

  execute function_definition;
end;
$migration$;


create or replace function private.get_checkout_stock_warning(
  target_organization_id uuid,
  target_store_id uuid,
  target_sale_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  negative_item_count integer;
begin
  if (select auth.uid()) is null
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
$function$;


comment on function private.validate_pos_cart_stock(uuid,uuid,uuid,jsonb)
is 'POS stock preflight. Ordinary tracked items and stocked assemblies validate finished inventory; made_to_order composites validate aggregated tracked recipe-component requirements.';

comment on function private.consume_made_to_order_composite_sale(
  uuid,uuid,uuid,numeric,uuid,uuid,text
)
is 'Consumes tracked recipe components once for a made_to_order sale without decrementing the composite finished-stock projection.';

comment on function private.get_checkout_stock_warning(uuid,uuid,uuid)
is 'Warn-policy post-sale stock check. made_to_order lines use tracked recipe components; ordinary products and stocked assemblies use directly sold stock.';

notify pgrst, 'reload schema';

commit;
