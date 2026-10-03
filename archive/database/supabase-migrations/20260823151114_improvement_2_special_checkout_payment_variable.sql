begin;

-- See 20260823151015: the consolidated checkout function already uses the
-- selected_payment_method_id variable. Avoid a second brittle source-text
-- rewrite so a fresh local QA database can be recreated deterministically.
do $migration$
begin
  if to_regprocedure('private.checkout_catalog_special_sale(uuid,uuid,uuid,uuid,jsonb,jsonb)') is null then
    raise exception 'Special checkout function is missing.';
  end if;
end;
$migration$;

commit;
