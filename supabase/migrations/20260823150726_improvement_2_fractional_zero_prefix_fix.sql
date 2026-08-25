begin;

do $migration$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'private.quote_checkout_subtotal(uuid,uuid,jsonb)'::regprocedure
  ) into function_definition;
  function_definition := replace(
    function_definition,
    $old$^[1-9][0-9]{0,3}([.][0-9]{1,3})?$old$,
    $new$^(?:0|[1-9][0-9]{0,3})([.][0-9]{1,3})?$new$
  );
  function_definition := replace(
    function_definition,
    $old$quantity := (checkout_line.value ->> 'quantity')::numeric(14, 3);$old$,
    $new$quantity := (checkout_line.value ->> 'quantity')::numeric(14, 3);
    if quantity <= 0 then raise exception 'Each checkout item must have a quantity greater than zero.' using errcode = '23514'; end if;$new$
  );
  execute function_definition;

  select pg_get_functiondef(
    'private.checkout_catalog_special_sale(uuid,uuid,uuid,uuid,jsonb,jsonb)'::regprocedure
  ) into function_definition;
  function_definition := replace(
    function_definition,
    $old$^[1-9][0-9]{0,3}([.][0-9]{1,3})?$old$,
    $new$^(?:0|[1-9][0-9]{0,3})([.][0-9]{1,3})?$new$
  );
  function_definition := replace(
    function_definition,
    $old$quantity := (checkout_line.value ->> 'quantity')::numeric(14, 3);$old$,
    $new$quantity := (checkout_line.value ->> 'quantity')::numeric(14, 3);
    if quantity <= 0 then raise exception 'Each checkout item must have a quantity greater than zero.' using errcode = '23514'; end if;$new$
  );
  execute function_definition;

  select pg_get_functiondef(
    'private.checkout_advanced_sale(uuid,uuid,uuid,uuid,jsonb,jsonb,uuid,integer,uuid,uuid,uuid,uuid)'::regprocedure
  ) into function_definition;
  function_definition := replace(
    function_definition,
    $old$^[1-9][0-9]{0,3}([.][0-9]{1,3})?$old$,
    $new$^(?:0|[1-9][0-9]{0,3})([.][0-9]{1,3})?$new$
  );
  function_definition := replace(
    function_definition,
    $old$quantity := (line ->> 'quantity')::numeric(14, 3);$old$,
    $new$quantity := (line ->> 'quantity')::numeric(14, 3);
    if quantity <= 0 then raise exception 'Each checkout item must have a quantity greater than zero.' using errcode = '23514'; end if;$new$
  );
  execute function_definition;
end;
$migration$;

commit;
