-- PostgREST RPC requests are JSON objects, so every public function input
-- must have a stable name. The Phase 8 wrapper was defined positionally.

begin;

create or replace function public.checkout_advanced_sale(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid,
  target_idempotency_key uuid,
  target_items jsonb,
  target_payments jsonb,
  target_customer_id uuid,
  target_loyalty_redemption_points integer,
  target_discount_id uuid,
  target_tax_rate_id uuid,
  target_dining_option_id uuid,
  target_open_ticket_id uuid
)
returns table (
  sale_id uuid,
  receipt_number bigint,
  total_minor bigint,
  change_minor bigint,
  payment_summary jsonb,
  was_replayed boolean
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.checkout_advanced_sale(
    target_organization_id,
    target_store_id,
    target_register_id,
    target_idempotency_key,
    target_items,
    target_payments,
    target_customer_id,
    target_loyalty_redemption_points,
    target_discount_id,
    target_tax_rate_id,
    target_dining_option_id,
    target_open_ticket_id
  );
$$;

revoke execute on function public.checkout_advanced_sale(
  uuid, uuid, uuid, uuid, jsonb, jsonb, uuid, integer, uuid, uuid, uuid, uuid
) from public, anon, service_role;

grant execute on function public.checkout_advanced_sale(
  uuid, uuid, uuid, uuid, jsonb, jsonb, uuid, integer, uuid, uuid, uuid, uuid
) to authenticated;

comment on function public.checkout_advanced_sale(
  uuid, uuid, uuid, uuid, jsonb, jsonb, uuid, integer, uuid, uuid, uuid, uuid
)
is 'Named PostgREST-compatible Phase 8 checkout wrapper. Validates and commits a POS sale atomically.';

notify pgrst, 'reload schema';

commit;
