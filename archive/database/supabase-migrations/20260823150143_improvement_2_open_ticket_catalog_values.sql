begin;

create or replace function private.validate_advanced_cart(
  target_organization_id uuid,
  target_store_id uuid,
  target_cart jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_items jsonb;
begin
  if target_cart is null or jsonb_typeof(target_cart) <> 'array'
    or jsonb_array_length(target_cart) not between 1 and 100 then
    raise exception 'An open ticket must contain between 1 and 100 items.' using errcode = '23514';
  end if;

  select jsonb_agg(jsonb_build_object(
    'product_id', line.value -> 'product_id',
    'variant_id', coalesce(line.value -> 'variant_id', 'null'::jsonb),
    'quantity', line.value -> 'quantity',
    'unit_price_minor', coalesce(line.value -> 'unit_price_minor', 'null'::jsonb)
  ) order by line.ordinality)
  into normalized_items
  from jsonb_array_elements(target_cart) with ordinality as line(value, ordinality);

  perform private.quote_checkout_subtotal(
    target_organization_id,
    target_store_id,
    normalized_items
  );
end;
$$;

revoke execute on function private.validate_advanced_cart(uuid, uuid, jsonb)
from public, anon, authenticated, service_role;

comment on function private.validate_advanced_cart(uuid, uuid, jsonb)
is 'Validates held POS carts using the same server-authoritative catalogue price and quantity rules as checkout.';

commit;
