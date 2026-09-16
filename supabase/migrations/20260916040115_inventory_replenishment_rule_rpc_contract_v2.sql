begin;

-- Optional UUID inputs trail required command fields so PostgREST exposes
-- them as genuinely optional properties in generated client types.
create function public.upsert_inventory_replenishment_rule_v2(
  target_organization_id uuid,
  target_store_id uuid,
  target_product_id uuid,
  target_reorder_point numeric,
  target_target_stock numeric,
  target_variant_id uuid default null,
  target_preferred_warehouse_id uuid default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $function$
  select private.upsert_inventory_replenishment_rule(
    target_organization_id,
    target_store_id,
    target_product_id,
    target_variant_id,
    target_preferred_warehouse_id,
    target_reorder_point,
    target_target_stock
  );
$function$;

revoke all
on function public.upsert_inventory_replenishment_rule_v2(
  uuid, uuid, uuid, numeric, numeric, uuid, uuid
)
from public, anon, service_role;

grant execute
on function public.upsert_inventory_replenishment_rule_v2(
  uuid, uuid, uuid, numeric, numeric, uuid, uuid
)
to authenticated;

drop function if exists public.upsert_inventory_replenishment_rule(
  uuid, uuid, uuid, uuid, uuid, numeric, numeric
);

comment on function public.upsert_inventory_replenishment_rule_v2(
  uuid, uuid, uuid, numeric, numeric, uuid, uuid
)
is
'Canonical replenishment-rule command. Product variant and preferred warehouse are optional trailing inputs.';

notify pgrst, 'reload schema';

commit;
