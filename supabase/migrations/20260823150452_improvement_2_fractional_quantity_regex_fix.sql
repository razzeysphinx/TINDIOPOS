begin;

do $migration$
declare
  function_definition text;
  target_function regprocedure;
begin
  foreach target_function in array array[
    'private.quote_checkout_subtotal(uuid,uuid,jsonb)'::regprocedure,
    'private.checkout_catalog_special_sale(uuid,uuid,uuid,uuid,jsonb,jsonb)'::regprocedure,
    'private.checkout_advanced_sale(uuid,uuid,uuid,uuid,jsonb,jsonb,uuid,integer,uuid,uuid,uuid,uuid)'::regprocedure
  ]
  loop
    select pg_get_functiondef(target_function) into function_definition;
    function_definition := regexp_replace(
      function_definition,
      E'\\\\+\\.',
      '[.]',
      'g'
    );
    execute function_definition;
  end loop;
end;
$migration$;

comment on function private.quote_checkout_subtotal(uuid, uuid, jsonb)
is 'Server-authoritative subtotal quote with exact fractional quantity validation using up to three decimal places.';

commit;
