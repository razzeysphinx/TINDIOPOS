begin;

-- The checkout function was consolidated with qualified sale-item columns in
-- 20260823144601_improvement_2_checkout_catalog_pricing.sql. This migration
-- originally attempted a brittle source-text rewrite and therefore failed on
-- clean database rebuilds even though the correct implementation already
-- exists. Keep the historical migration version as a validation-only step.
do $migration$
begin
  if to_regprocedure('private.checkout_catalog_special_sale(uuid,uuid,uuid,uuid,jsonb,jsonb)') is null then
    raise exception 'Special checkout function is missing.';
  end if;
end;
$migration$;

commit;
