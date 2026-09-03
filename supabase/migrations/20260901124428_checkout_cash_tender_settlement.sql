begin;

-- Every checkout entry point must use the same settlement rule. Cash tender is
-- physical cash received, while amount_minor is the amount applied to the
-- sale. Non-cash methods have no change semantics.
create or replace function private.settle_checkout_payment(
  target_payment_type text,
  target_requested_amount_minor bigint,
  target_tendered_minor bigint,
  target_remaining_minor bigint
)
returns table (
  applied_minor bigint,
  tendered_minor bigint,
  change_minor bigint
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if target_remaining_minor is null or target_remaining_minor <= 0 then
    raise exception 'No additional payment is needed for this sale.' using errcode = '23514';
  end if;

  if target_payment_type = 'CASH' then
    if target_tendered_minor is null then
      raise exception 'Cash tender is required.' using errcode = '23514';
    end if;

    if target_tendered_minor <= 0 then
      raise exception 'Cash tender must be greater than zero.' using errcode = '23514';
    end if;

    return query
    select
      least(target_tendered_minor, target_remaining_minor),
      target_tendered_minor,
      target_tendered_minor - least(target_tendered_minor, target_remaining_minor);
    return;
  end if;

  if target_requested_amount_minor is null then
    raise exception 'An amount is required for the selected payment method.'
      using errcode = '23514';
  end if;

  if target_requested_amount_minor <= 0
    or target_requested_amount_minor > target_remaining_minor then
    raise exception 'Payment amount must be greater than zero and no more than the remaining balance.'
      using errcode = '23514';
  end if;

  return query
  select target_requested_amount_minor, null::bigint, null::bigint;
end;
$$;

do $migration$
declare
  function_definition text;
  old_fragment text;
  new_fragment text;
begin
  select pg_get_functiondef(
    'private.checkout_sale_v1(uuid,uuid,uuid,uuid,jsonb,jsonb)'::regprocedure
  ) into function_definition;

  old_fragment := $old$
    if selected_payment_method_type = 'CASH' then
      if not (payment_input.payment_value ? 'amount_tendered_minor') then
        raise exception 'Cash tender is required.' using errcode = '23514';
      end if;

      tendered_minor := (payment_input.payment_value ->> 'amount_tendered_minor')::bigint;
      if tendered_minor <= 0 then
        raise exception 'Cash tender must be greater than zero.' using errcode = '23514';
      end if;

      applied_minor := least(tendered_minor, remaining_minor);
      payment_change_minor := tendered_minor - applied_minor;
    else
      if not (payment_input.payment_value ? 'amount_minor') then
        raise exception 'An amount is required for the selected payment method.'
          using errcode = '23514';
      end if;

      requested_amount_minor := (payment_input.payment_value ->> 'amount_minor')::bigint;
      if requested_amount_minor <= 0 or requested_amount_minor > remaining_minor then
        raise exception 'Payment amount must be greater than zero and no more than the remaining balance.'
          using errcode = '23514';
      end if;

      applied_minor := requested_amount_minor;
      tendered_minor := null;
      payment_change_minor := null;
    end if;
$old$;
  new_fragment := $new$
    select settlement.applied_minor, settlement.tendered_minor, settlement.change_minor
    into applied_minor, tendered_minor, payment_change_minor
    from private.settle_checkout_payment(
      selected_payment_method_type,
      nullif(payment_input.payment_value ->> 'amount_minor', '')::bigint,
      nullif(payment_input.payment_value ->> 'amount_tendered_minor', '')::bigint,
      remaining_minor
    ) settlement;
$new$;

  if position(old_fragment in function_definition) = 0 then
    raise exception 'Expected standard checkout payment settlement was not found.';
  end if;
  execute replace(function_definition, old_fragment, new_fragment);

  select pg_get_functiondef(
    'private.checkout_advanced_sale(uuid,uuid,uuid,uuid,jsonb,jsonb,uuid,integer,uuid,uuid,uuid,uuid)'::regprocedure
  ) into function_definition;

  old_fragment := $old$    if payment_type = 'CASH' then tendered := nullif(selected_payment.value ->> 'amount_tendered_minor', '')::bigint; if tendered is null or tendered <= 0 then raise exception 'Cash tender is required.' using errcode = '23514'; end if; applied := least(tendered, remaining); payment_change := tendered - applied; else requested_amount := nullif(selected_payment.value ->> 'amount_minor', '')::bigint; if requested_amount is null or requested_amount <= 0 or requested_amount > remaining then raise exception 'Payment amount must be greater than zero and no more than the remaining balance.' using errcode = '23514'; end if; applied := requested_amount; tendered := null; payment_change := null; end if;
$old$;
  new_fragment := $new$    select settlement.applied_minor, settlement.tendered_minor, settlement.change_minor into applied, tendered, payment_change from private.settle_checkout_payment(payment_type, nullif(selected_payment.value ->> 'amount_minor', '')::bigint, nullif(selected_payment.value ->> 'amount_tendered_minor', '')::bigint, remaining) settlement;
$new$;

  if position(old_fragment in function_definition) = 0 then
    raise exception 'Expected advanced checkout payment settlement was not found.';
  end if;
  execute replace(function_definition, old_fragment, new_fragment);

  select pg_get_functiondef(
    'private.checkout_catalog_special_sale(uuid,uuid,uuid,uuid,jsonb,jsonb)'::regprocedure
  ) into function_definition;

  old_fragment := $old$  if payment_type = 'CASH' then
    tendered_minor := nullif(payment_row ->> 'amount_tendered_minor', '')::bigint;
    if tendered_minor is null or tendered_minor < calculated_subtotal_minor then
      raise exception 'Cash tender must cover the sale total.' using errcode = '23514';
    end if;
    applied_minor := calculated_subtotal_minor;
    change_given_minor := tendered_minor - calculated_subtotal_minor;
  else
    applied_minor := nullif(payment_row ->> 'amount_minor', '')::bigint;
    if applied_minor is null or applied_minor <> calculated_subtotal_minor then
      raise exception 'The internal payment must exactly cover this sale.' using errcode = '23514';
    end if;
    tendered_minor := null;
    change_given_minor := null;
  end if;
$old$;
  new_fragment := $new$  select settlement.applied_minor, settlement.tendered_minor, settlement.change_minor
  into applied_minor, tendered_minor, change_given_minor
  from private.settle_checkout_payment(
    payment_type,
    nullif(payment_row ->> 'amount_minor', '')::bigint,
    nullif(payment_row ->> 'amount_tendered_minor', '')::bigint,
    calculated_subtotal_minor
  ) settlement;
  if applied_minor <> calculated_subtotal_minor then
    raise exception 'The internal payment must exactly cover this sale.' using errcode = '23514';
  end if;
$new$;

  if position(old_fragment in function_definition) = 0 then
    raise exception 'Expected special catalogue checkout payment settlement was not found.';
  end if;
  execute replace(function_definition, old_fragment, new_fragment);
end;
$migration$;

revoke all on function private.settle_checkout_payment(text, bigint, bigint, bigint)
from public, anon, authenticated, service_role;

comment on function private.settle_checkout_payment(text, bigint, bigint, bigint)
is 'Canonical checkout payment settlement. Cash applies only the remaining sale balance and records tender/change separately.';

commit;
