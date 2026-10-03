-- TINDIO Phase 10: repair the advanced-sale line shape identified by db lint.
-- A Phase 8 function inserted a modifier amount where the quantity belonged.

begin;

do $$
declare
  function_definition text;
  old_values text := $values$values (target_organization_id, checkout_result.sale_id, (line ->> 'product_id')::uuid, nullif(line ->> 'variant_id', '')::uuid, line ->> 'product_name', nullif(line ->> 'variant_name', ''), nullif(line ->> 'sku', ''), line ->> 'unit', (line ->> 'base_price_minor')::bigint + (line ->> 'modifier_total_minor')::bigint, (line ->> 'modifier_total_minor')::bigint, line -> 'modifiers', ((line ->> 'base_price_minor')::bigint + (line ->> 'modifier_total_minor')::bigint) * (line ->> 'quantity')::integer);$values$;
  corrected_values text := $values$values (target_organization_id, checkout_result.sale_id, (line ->> 'product_id')::uuid, nullif(line ->> 'variant_id', '')::uuid, line ->> 'product_name', nullif(line ->> 'variant_name', ''), nullif(line ->> 'sku', ''), line ->> 'unit', (line ->> 'quantity')::integer, (line ->> 'base_price_minor')::bigint, (line ->> 'modifier_total_minor')::bigint, line -> 'modifiers', ((line ->> 'base_price_minor')::bigint + (line ->> 'modifier_total_minor')::bigint) * (line ->> 'quantity')::integer);$values$;
begin
  select pg_get_functiondef(
    'private.checkout_advanced_sale(uuid,uuid,uuid,uuid,jsonb,jsonb,uuid,integer,uuid,uuid,uuid,uuid)'::regprocedure
  ) into function_definition;

  if position(old_values in function_definition) = 0 then
    raise exception 'Unexpected checkout_advanced_sale line definition; aborting safe migration.';
  end if;

  execute replace(function_definition, old_values, corrected_values);
end;
$$;

commit;
