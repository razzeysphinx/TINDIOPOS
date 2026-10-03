begin;

-- The public API deliberately keeps the user-facing message generic. The
-- DETAIL is only recorded by the server-side checkout log, so a mismatch can
-- be traced without exposing SQL implementation details in the POS.
do $migration$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'private.checkout_advanced_sale(uuid,uuid,uuid,uuid,jsonb,jsonb,uuid,integer,uuid,uuid,uuid,uuid)'::regprocedure
  ) into function_definition;

  function_definition := regexp_replace(
    function_definition,
    $pattern$if paid_total <> grand_total then raise exception 'Payments must exactly cover the sale total before completion.' using errcode = '23514'; end if;$pattern$,
    $replacement$if paid_total <> grand_total then
    raise exception 'Payments must exactly cover the sale total before completion.'
      using errcode = '23514',
        detail = format(
          'checkout_function=private.checkout_advanced_sale expected_minor=%s applied_minor=%s',
          grand_total,
          paid_total
        );
  end if;$replacement$
  );

  if position('checkout_function=private.checkout_advanced_sale' in function_definition) = 0 then
    raise exception 'Expected advanced checkout payment-total guard was not found.';
  end if;
  execute function_definition;
end;
$migration$;

commit;
