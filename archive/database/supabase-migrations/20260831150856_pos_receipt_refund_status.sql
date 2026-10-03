-- The cashier receipt list needs an item-quantity status, not a money-total
-- inference. Taxes, discounts, and zero-priced lines make a summed refund
-- amount insufficient to decide whether another quantity may be returned.
-- This keeps the existing narrow POS projection and every auth/store check.

drop function public.get_pos_receipt_history(uuid, text, bigint, integer);

create function public.get_pos_receipt_history(
  target_organization_id uuid,
  target_query text default null,
  target_before_receipt_number bigint default null,
  target_limit integer default 25
)
returns table (
  receipt_id uuid,
  sale_id uuid,
  receipt_number bigint,
  issued_at timestamptz,
  store_id uuid,
  register_id uuid,
  store_name text,
  register_name text,
  cashier_name text,
  total_minor bigint,
  currency_code text,
  refund_total_minor bigint,
  refund_count bigint,
  has_refundable_quantity boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  normalized_query text := nullif(btrim(target_query), '');
  can_access_store_receipts boolean := false;
begin
  if target_organization_id is null
    or target_limit is null
    or target_limit not between 1 and 50
    or (target_before_receipt_number is not null and target_before_receipt_number < 1)
    or (normalized_query is not null and char_length(normalized_query) > 100) then
    raise exception 'The POS receipt request is invalid.' using errcode = '23514';
  end if;

  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'sales.create')) then
    raise exception 'Sales permission is required to view POS receipts.' using errcode = '42501';
  end if;

  actor_employee_id := private.current_employee_id(target_organization_id);
  if actor_employee_id is null then
    raise exception 'An active employee is required to view POS receipts.' using errcode = '42501';
  end if;

  can_access_store_receipts :=
    (select private.has_permission(target_organization_id, 'sales.refund'))
    or (select private.has_permission(target_organization_id, 'receipts.view'));

  return query
  select
    receipt.id,
    sale.id,
    receipt.receipt_number,
    receipt.issued_at,
    sale.store_id,
    sale.register_id,
    sale.store_name_snapshot,
    sale.register_name_snapshot,
    sale.cashier_name_snapshot,
    sale.total_minor,
    sale.currency_code,
    refund_summary.total_minor,
    refund_summary.refund_count,
    quantity_summary.has_refundable_quantity
  from public.receipts receipt
  join public.sales sale
    on sale.id = receipt.sale_id
   and sale.organization_id = receipt.organization_id
  left join lateral (
    select
      coalesce(sum(refund.total_minor), 0)::bigint as total_minor,
      count(refund.id)::bigint as refund_count
    from public.refunds refund
    where refund.organization_id = target_organization_id
      and refund.sale_id = sale.id
  ) refund_summary on true
  left join lateral (
    select coalesce(bool_or(
      sale_item.quantity > coalesce(refund_quantity.total_quantity, 0)
    ), false) as has_refundable_quantity
    from public.sale_items sale_item
    left join lateral (
      select coalesce(sum(refund_item.quantity), 0)::integer as total_quantity
      from public.refund_items refund_item
      join public.refunds refund
        on refund.id = refund_item.refund_id
       and refund.organization_id = refund_item.organization_id
      where refund_item.organization_id = target_organization_id
        and refund.sale_id = sale.id
        and refund_item.sale_item_id = sale_item.id
    ) refund_quantity on true
    where sale_item.organization_id = target_organization_id
      and sale_item.sale_id = sale.id
  ) quantity_summary on true
  where receipt.organization_id = target_organization_id
    and exists (
      select 1
      from public.employee_stores employee_store
      where employee_store.organization_id = target_organization_id
        and employee_store.employee_id = actor_employee_id
        and employee_store.store_id = sale.store_id
    )
    and (sale.cashier_employee_id = actor_employee_id or can_access_store_receipts)
    and (target_before_receipt_number is null or receipt.receipt_number < target_before_receipt_number)
    and (
      normalized_query is null
      or receipt.receipt_number::text ilike '%' || normalized_query || '%'
      or sale.store_name_snapshot ilike '%' || normalized_query || '%'
      or sale.register_name_snapshot ilike '%' || normalized_query || '%'
      or sale.cashier_name_snapshot ilike '%' || normalized_query || '%'
    )
  order by receipt.receipt_number desc
  limit target_limit;
end;
$$;

revoke all on function public.get_pos_receipt_history(uuid, text, bigint, integer)
  from public, anon, service_role;
grant execute on function public.get_pos_receipt_history(uuid, text, bigint, integer)
  to authenticated;

comment on function public.get_pos_receipt_history(uuid, text, bigint, integer) is
  'Narrow cashier-safe POS receipt history. It returns only a caller-owned receipt or, for refund/receipt roles, receipts in an assigned store. Refund status uses remaining sale-item quantities.';
