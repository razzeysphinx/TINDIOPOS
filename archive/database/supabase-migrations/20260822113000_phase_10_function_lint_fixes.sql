-- TINDIO Phase 10: repair pre-existing static function-validation findings.
-- Each definition is read from PostgreSQL and recreated unchanged except for the
-- qualified/cast expression that the database advisor identified. This keeps the
-- established security attributes, grants, and function contracts intact.

begin;

do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'private.save_open_ticket(uuid,uuid,uuid,uuid,uuid,uuid,text,text,jsonb)'::regprocedure
  ) into function_definition;

  if position('insert into public.open_tickets (' in function_definition) = 0
    or position('returning id, created_at, updated_at;' in function_definition) = 0 then
    raise exception 'Unexpected save_open_ticket definition; aborting safe migration.';
  end if;

  function_definition := replace(
    function_definition,
    'insert into public.open_tickets (',
    'insert into public.open_tickets as open_ticket ('
  );
  function_definition := replace(
    function_definition,
    'returning id, created_at, updated_at;',
    'returning open_ticket.id, open_ticket.created_at, open_ticket.updated_at;'
  );
  execute function_definition;
end;
$$;

do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'private.checkout_advanced_sale(uuid,uuid,uuid,uuid,jsonb,jsonb,uuid,integer,uuid,uuid,uuid,uuid)'::regprocedure
  ) into function_definition;

  if position('delete from public.payments where sale_id = checkout_result.sale_id' in function_definition) = 0
    or position('delete from public.sale_items where sale_id = checkout_result.sale_id' in function_definition) = 0 then
    raise exception 'Unexpected checkout_advanced_sale definition; aborting safe migration.';
  end if;

  function_definition := replace(
    function_definition,
    'delete from public.payments where sale_id = checkout_result.sale_id and organization_id = target_organization_id;',
    'delete from public.payments payment where payment.sale_id = checkout_result.sale_id and payment.organization_id = target_organization_id;'
  );
  function_definition := replace(
    function_definition,
    'delete from public.sale_items where sale_id = checkout_result.sale_id and organization_id = target_organization_id;',
    'delete from public.sale_items sale_item where sale_item.sale_id = checkout_result.sale_id and sale_item.organization_id = target_organization_id;'
  );
  execute function_definition;
end;
$$;

do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'private.checkout_sale_v1(uuid,uuid,uuid,uuid,jsonb,jsonb)'::regprocedure
  ) into function_definition;

  if position('), 0::bigint),' in function_definition) = 0 then
    raise exception 'Unexpected checkout_sale_v1 definition; aborting safe migration.';
  end if;

  function_definition := replace(
    function_definition,
    '), 0::bigint),',
    '), 0)::bigint,'
  );
  execute function_definition;
end;
$$;

commit;
