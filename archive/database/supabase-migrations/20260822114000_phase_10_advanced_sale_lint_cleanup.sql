-- TINDIO Phase 10: qualify the selected advanced-sale payment identifier.

begin;

do $$
declare
  function_definition text;
  old_predicate text := 'where method.id = payment_method_id and method.organization_id = target_organization_id';
  corrected_predicate text := 'where method.id = (selected_payment.value ->> ''payment_method_id'')::uuid and method.organization_id = target_organization_id';
begin
  select pg_get_functiondef(
    'private.checkout_advanced_sale(uuid,uuid,uuid,uuid,jsonb,jsonb,uuid,integer,uuid,uuid,uuid,uuid)'::regprocedure
  ) into function_definition;

  if position(old_predicate in function_definition) = 0 then
    raise exception 'Unexpected checkout_advanced_sale payment predicate; aborting safe migration.';
  end if;

  execute replace(function_definition, old_predicate, corrected_predicate);
end;
$$;

commit;
