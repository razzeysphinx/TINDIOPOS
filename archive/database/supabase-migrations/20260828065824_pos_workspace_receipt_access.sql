-- TINDIO POS workspace: a deliberately narrow receipt projection for the
-- cashier-facing POS. It does not loosen the Back Office receipt policies.
-- Every request is bound to the signed-in active employee, organization, and
-- store assignment. Cross-cashier access is limited to refund/receipt roles.

create index if not exists receipts_organization_receipt_number_desc_idx
  on public.receipts (organization_id, receipt_number desc);

create index if not exists refunds_organization_sale_id_idx
  on public.refunds (organization_id, sale_id);

create or replace function public.get_pos_receipt_history(
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
  refund_total_minor bigint
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
    coalesce(sum(refund.total_minor), 0)::bigint
  from public.receipts receipt
  join public.sales sale
    on sale.id = receipt.sale_id
   and sale.organization_id = receipt.organization_id
  left join public.refunds refund
    on refund.sale_id = sale.id
   and refund.organization_id = sale.organization_id
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
  group by
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
    sale.currency_code
  order by receipt.receipt_number desc
  limit target_limit;
end;
$$;

create or replace function public.get_pos_receipt_detail(
  target_organization_id uuid,
  target_receipt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  can_access_store_receipts boolean := false;
  receipt_record record;
begin
  if target_organization_id is null or target_receipt_id is null then
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

  select
    receipt.id as receipt_id,
    receipt.receipt_number,
    receipt.issued_at,
    receipt.receipt_layout_snapshot,
    sale.id as sale_id,
    sale.store_id,
    sale.register_id,
    sale.cashier_employee_id,
    sale.currency_code,
    sale.organization_name_snapshot,
    sale.store_name_snapshot,
    sale.register_name_snapshot,
    sale.cashier_name_snapshot,
    sale.subtotal_minor,
    sale.discount_minor,
    sale.tax_minor,
    sale.total_minor
  into receipt_record
  from public.receipts receipt
  join public.sales sale
    on sale.id = receipt.sale_id
   and sale.organization_id = receipt.organization_id
  where receipt.id = target_receipt_id
    and receipt.organization_id = target_organization_id;

  if receipt_record.receipt_id is null then
    return null;
  end if;

  if not exists (
    select 1
    from public.employee_stores employee_store
    where employee_store.organization_id = target_organization_id
      and employee_store.employee_id = actor_employee_id
      and employee_store.store_id = receipt_record.store_id
  ) or (receipt_record.cashier_employee_id <> actor_employee_id and not can_access_store_receipts) then
    raise exception 'Receipt access is not permitted for this POS employee.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'receipt', jsonb_build_object(
      'id', receipt_record.receipt_id,
      'number', receipt_record.receipt_number,
      'issuedAt', receipt_record.issued_at,
      'layout', receipt_record.receipt_layout_snapshot
    ),
    'sale', jsonb_build_object(
      'id', receipt_record.sale_id,
      'storeId', receipt_record.store_id,
      'registerId', receipt_record.register_id,
      'currencyCode', receipt_record.currency_code,
      'organizationName', receipt_record.organization_name_snapshot,
      'storeName', receipt_record.store_name_snapshot,
      'registerName', receipt_record.register_name_snapshot,
      'cashierName', receipt_record.cashier_name_snapshot,
      'subtotalMinor', receipt_record.subtotal_minor,
      'discountMinor', receipt_record.discount_minor,
      'taxMinor', receipt_record.tax_minor,
      'totalMinor', receipt_record.total_minor
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'name', case when item.variant_name_snapshot is null then item.product_name_snapshot else item.product_name_snapshot || ' · ' || item.variant_name_snapshot end,
        'sku', item.sku_snapshot,
        'quantity', item.quantity,
        'unit', item.unit_snapshot,
        'unitPriceMinor', item.unit_price_minor,
        'lineTotalMinor', item.line_total_minor
      ) order by item.created_at)
      from public.sale_items item
      where item.organization_id = target_organization_id
        and item.sale_id = receipt_record.sale_id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', payment.id,
        'name', payment.payment_method_name_snapshot,
        'type', payment.payment_method_type_snapshot,
        'amountMinor', payment.amount_minor,
        'tenderedMinor', payment.amount_tendered_minor,
        'changeMinor', payment.change_given_minor,
        'referenceNumber', payment.reference_number
      ) order by payment.created_at)
      from public.payments payment
      where payment.organization_id = target_organization_id
        and payment.sale_id = receipt_record.sale_id
    ), '[]'::jsonb),
    'refunds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', refund.id,
        'number', refund.refund_number,
        'totalMinor', refund.total_minor,
        'completedAt', refund.completed_at,
        'reason', refund.reason,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', refund_item.id,
            'saleItemId', refund_item.sale_item_id,
            'name', case when refund_item.variant_name_snapshot is null then refund_item.product_name_snapshot else refund_item.product_name_snapshot || ' · ' || refund_item.variant_name_snapshot end,
            'quantity', refund_item.quantity,
            'unit', refund_item.unit_snapshot,
            'lineTotalMinor', refund_item.line_total_minor
          ) order by refund_item.created_at)
          from public.refund_items refund_item
          where refund_item.organization_id = target_organization_id
            and refund_item.refund_id = refund.id
        ), '[]'::jsonb)
      ) order by refund.completed_at desc)
      from public.refunds refund
      where refund.organization_id = target_organization_id
        and refund.sale_id = receipt_record.sale_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_pos_receipt_history(uuid, text, bigint, integer)
  from public, anon, service_role;
grant execute on function public.get_pos_receipt_history(uuid, text, bigint, integer)
  to authenticated;

revoke all on function public.get_pos_receipt_detail(uuid, uuid)
  from public, anon, service_role;
grant execute on function public.get_pos_receipt_detail(uuid, uuid)
  to authenticated;

comment on function public.get_pos_receipt_history(uuid, text, bigint, integer) is
  'Narrow cashier-safe POS receipt history. It returns only a caller-owned receipt or, for refund/receipt roles, receipts in an assigned store.';
comment on function public.get_pos_receipt_detail(uuid, uuid) is
  'Narrow cashier-safe POS receipt detail. It returns immutable receipt snapshots without broad table access.';
