-- TINDIO Phase 7: customer CRM and an immutable loyalty-points ledger.
-- Loyalty redemptions are recorded as a non-cash tender so a sale keeps its
-- full merchandise value while payment, receipt, refund, and shift cash data
-- remain mathematically consistent.

begin;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  full_name text not null,
  email text,
  phone text,
  address text,
  birthday date,
  notes text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_id_organization_unique unique (id, organization_id),
  constraint customers_full_name_length check (char_length(btrim(full_name)) between 1 and 160),
  constraint customers_email_length check (email is null or char_length(btrim(email)) between 3 and 320),
  constraint customers_phone_length check (phone is null or char_length(btrim(phone)) between 3 and 40),
  constraint customers_address_length check (address is null or char_length(btrim(address)) between 2 and 500),
  constraint customers_notes_length check (notes is null or char_length(btrim(notes)) between 2 and 1000),
  constraint customers_status_values check (status in ('active', 'archived'))
);

create index customers_organization_status_name_idx
  on public.customers (organization_id, status, full_name, created_at desc);
create index customers_organization_phone_idx
  on public.customers (organization_id, phone)
  where phone is not null;
create index customers_organization_email_idx
  on public.customers (organization_id, lower(email))
  where email is not null;

create trigger customers_set_updated_at
before update on public.customers
for each row execute function private.set_updated_at();

create table public.loyalty_programs (
  organization_id uuid primary key references public.organizations (id) on delete restrict,
  is_enabled boolean not null default true,
  earn_spend_minor bigint not null default 10000,
  earn_points integer not null default 1,
  redemption_value_minor bigint not null default 100,
  minimum_redemption_points integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loyalty_programs_earn_spend_positive check (earn_spend_minor between 1 and 1000000000000),
  constraint loyalty_programs_earn_points_positive check (earn_points between 1 and 1000000),
  constraint loyalty_programs_redemption_value_positive check (redemption_value_minor between 1 and 1000000000000),
  constraint loyalty_programs_minimum_points_positive check (minimum_redemption_points between 1 and 100000000)
);

create trigger loyalty_programs_set_updated_at
before update on public.loyalty_programs
for each row execute function private.set_updated_at();

create table public.loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id uuid not null,
  sale_id uuid,
  refund_id uuid,
  entry_type text not null,
  points_delta integer not null,
  note text,
  created_at timestamptz not null default now(),
  constraint loyalty_transactions_customer_organization_fkey
    foreign key (customer_id, organization_id)
    references public.customers (id, organization_id)
    on delete restrict,
  constraint loyalty_transactions_sale_organization_fkey
    foreign key (sale_id, organization_id)
    references public.sales (id, organization_id)
    on delete restrict,
  constraint loyalty_transactions_refund_organization_fkey
    foreign key (refund_id, organization_id)
    references public.refunds (id, organization_id)
    on delete restrict,
  constraint loyalty_transactions_entry_type_values check (
    entry_type in ('SALE_EARN', 'REDEMPTION', 'REFUND_EARN_REVERSAL')
  ),
  constraint loyalty_transactions_points_nonzero check (points_delta <> 0),
  constraint loyalty_transactions_note_length check (
    note is null or char_length(btrim(note)) between 2 and 500
  ),
  constraint loyalty_transactions_entry_source check (
    (entry_type in ('SALE_EARN', 'REDEMPTION') and sale_id is not null and refund_id is null)
    or (entry_type = 'REFUND_EARN_REVERSAL' and sale_id is not null and refund_id is not null)
  )
);

create index loyalty_transactions_customer_created_idx
  on public.loyalty_transactions (organization_id, customer_id, created_at desc);
create unique index loyalty_transactions_sale_entry_unique_idx
  on public.loyalty_transactions (sale_id, entry_type)
  where sale_id is not null and entry_type in ('SALE_EARN', 'REDEMPTION');
create unique index loyalty_transactions_refund_entry_unique_idx
  on public.loyalty_transactions (refund_id, entry_type)
  where refund_id is not null;

alter table public.sales
  add column customer_id uuid,
  add column loyalty_redemption_minor bigint not null default 0,
  add column loyalty_points_redeemed integer not null default 0,
  add column loyalty_points_earned integer not null default 0,
  add constraint sales_customer_organization_fkey
    foreign key (customer_id, organization_id)
    references public.customers (id, organization_id)
    on delete restrict,
  add constraint sales_loyalty_values_nonnegative check (
    loyalty_redemption_minor >= 0
    and loyalty_points_redeemed >= 0
    and loyalty_points_earned >= 0
  );

create index sales_customer_completed_idx
  on public.sales (organization_id, customer_id, completed_at desc)
  where customer_id is not null;

alter table public.payment_methods
  add column is_loyalty_redemption boolean not null default false,
  add constraint payment_methods_loyalty_redemption_shape check (
    not is_loyalty_redemption
    or (code = 'LOYALTY' and payment_type = 'VOUCHER')
  );

create unique index payment_methods_organization_loyalty_redemption_unique_idx
  on public.payment_methods (organization_id)
  where is_loyalty_redemption;

create or replace function private.seed_loyalty_for_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.loyalty_programs (organization_id)
  values (new.id)
  on conflict (organization_id) do nothing;

  insert into public.payment_methods (
    organization_id,
    name,
    code,
    payment_type,
    is_enabled,
    requires_reference,
    sort_order,
    is_loyalty_redemption
  )
  values (new.id, 'Loyalty points', 'LOYALTY', 'VOUCHER', true, false, 99990, true)
  on conflict (organization_id, code) do update
  set is_loyalty_redemption = true;

  return new;
end;
$$;

revoke execute on function private.seed_loyalty_for_organization()
from public, anon, authenticated, service_role;

create trigger organizations_seed_loyalty
after insert on public.organizations
for each row execute function private.seed_loyalty_for_organization();

insert into public.loyalty_programs (organization_id)
select organization.id
from public.organizations organization
on conflict (organization_id) do nothing;

insert into public.payment_methods (
  organization_id,
  name,
  code,
  payment_type,
  is_enabled,
  requires_reference,
  sort_order,
  is_loyalty_redemption
)
select organization.id, 'Loyalty points', 'LOYALTY', 'VOUCHER', true, false, 99990, true
from public.organizations organization
on conflict (organization_id, code) do update
set is_loyalty_redemption = true;

insert into public.store_payment_methods (
  organization_id,
  store_id,
  payment_method_id,
  is_enabled
)
select store.organization_id, store.id, payment_method.id, true
from public.stores store
join public.payment_methods payment_method
  on payment_method.organization_id = store.organization_id
 and payment_method.is_loyalty_redemption
on conflict (store_id, payment_method_id) do nothing;

alter table public.customers enable row level security;
alter table public.loyalty_programs enable row level security;
alter table public.loyalty_transactions enable row level security;

revoke all on table public.customers, public.loyalty_programs, public.loyalty_transactions
from public, anon, authenticated, service_role;

grant select, insert on public.customers to authenticated;
grant update (full_name, email, phone, address, birthday, notes, status) on public.customers to authenticated;
grant select on public.loyalty_programs, public.loyalty_transactions to authenticated;
grant update (is_enabled, earn_spend_minor, earn_points, redemption_value_minor, minimum_redemption_points)
on public.loyalty_programs to authenticated;

create policy customers_select_manager
on public.customers
for select
to authenticated
using ((select private.has_permission(organization_id, 'customers.manage')));

create policy customers_insert_manager
on public.customers
for insert
to authenticated
with check ((select private.has_permission(organization_id, 'customers.manage')));

create policy customers_update_manager
on public.customers
for update
to authenticated
using ((select private.has_permission(organization_id, 'customers.manage')))
with check ((select private.has_permission(organization_id, 'customers.manage')));

create policy loyalty_programs_select_sales_or_manager
on public.loyalty_programs
for select
to authenticated
using (
  (select private.has_permission(organization_id, 'sales.create'))
  or (select private.has_permission(organization_id, 'customers.manage'))
);

create policy loyalty_programs_update_settings_manager
on public.loyalty_programs
for update
to authenticated
using ((select private.has_permission(organization_id, 'settings.manage')))
with check ((select private.has_permission(organization_id, 'settings.manage')));

create policy loyalty_transactions_select_customer_manager
on public.loyalty_transactions
for select
to authenticated
using ((select private.has_permission(organization_id, 'customers.manage')));

create or replace function public.search_pos_customers(
  target_organization_id uuid,
  target_store_id uuid,
  target_query text,
  target_limit integer
)
returns table (
  customer_id uuid,
  full_name text,
  phone text,
  email text,
  loyalty_points integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_query text := nullif(btrim(coalesce(target_query, '')), '');
begin
  if target_organization_id is null
    or target_store_id is null
    or target_limit not between 1 and 20 then
    raise exception 'A store and a result limit between 1 and 20 are required.' using errcode = '23514';
  end if;

  if normalized_query is not null and char_length(normalized_query) > 100 then
    raise exception 'Customer search is limited to 100 characters.' using errcode = '23514';
  end if;

  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'sales.create'))
    or not exists (
      select 1
      from public.employees employee
      join public.employee_stores employee_store
        on employee_store.employee_id = employee.id
       and employee_store.organization_id = employee.organization_id
       and employee_store.store_id = target_store_id
      where employee.organization_id = target_organization_id
        and employee.profile_id = (select auth.uid())
        and employee.status = 'active'
    ) then
    raise exception 'POS customer access requires an active store assignment.' using errcode = '42501';
  end if;

  return query
  select
    customer.id,
    customer.full_name,
    customer.phone,
    customer.email,
    coalesce((
      select sum(transaction.points_delta)::integer
      from public.loyalty_transactions transaction
      where transaction.organization_id = customer.organization_id
        and transaction.customer_id = customer.id
    ), 0)::integer
  from public.customers customer
  where customer.organization_id = target_organization_id
    and customer.status = 'active'
    and (
      normalized_query is null
      or customer.full_name ilike '%' || normalized_query || '%'
      or coalesce(customer.phone, '') ilike '%' || normalized_query || '%'
      or coalesce(customer.email, '') ilike '%' || normalized_query || '%'
    )
  order by customer.full_name, customer.created_at desc
  limit target_limit;
end;
$$;

create or replace function public.get_customer_summary(
  target_organization_id uuid,
  target_customer_id uuid
)
returns table (
  customer_id uuid,
  full_name text,
  status text,
  sale_count bigint,
  lifetime_spend_minor bigint,
  average_sale_minor bigint,
  last_purchase_at timestamptz,
  loyalty_points integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'customers.manage')) then
    raise exception 'Customer management permission is required.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.customers customer
    where customer.id = target_customer_id and customer.organization_id = target_organization_id
  ) then
    raise exception 'The customer was not found.' using errcode = 'P0002';
  end if;

  return query
  select
    customer.id,
    customer.full_name,
    customer.status,
    coalesce((
      select count(*) from public.sales sale
      where sale.organization_id = customer.organization_id and sale.customer_id = customer.id
    ), 0)::bigint,
    coalesce((
      select sum(sale.total_minor) from public.sales sale
      where sale.organization_id = customer.organization_id and sale.customer_id = customer.id
    ), 0)::bigint,
    coalesce((
      select avg(sale.total_minor)::bigint from public.sales sale
      where sale.organization_id = customer.organization_id and sale.customer_id = customer.id
    ), 0)::bigint,
    (
      select max(sale.completed_at) from public.sales sale
      where sale.organization_id = customer.organization_id and sale.customer_id = customer.id
    ),
    coalesce((
      select sum(transaction.points_delta)::integer from public.loyalty_transactions transaction
      where transaction.organization_id = customer.organization_id and transaction.customer_id = customer.id
    ), 0)::integer
  from public.customers customer
  where customer.id = target_customer_id and customer.organization_id = target_organization_id;
end;
$$;

create or replace function public.get_customer_purchase_history(
  target_organization_id uuid,
  target_customer_id uuid,
  target_limit integer
)
returns table (
  sale_id uuid,
  receipt_number bigint,
  completed_at timestamptz,
  total_minor bigint,
  currency_code text,
  store_name text,
  loyalty_points_earned integer,
  loyalty_points_redeemed integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_limit not between 1 and 100 then
    raise exception 'Purchase history limit must be between 1 and 100.' using errcode = '23514';
  end if;

  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'customers.manage')) then
    raise exception 'Customer management permission is required.' using errcode = '42501';
  end if;

  return query
  select
    sale.id,
    receipt.receipt_number,
    sale.completed_at,
    sale.total_minor,
    sale.currency_code,
    sale.store_name_snapshot,
    sale.loyalty_points_earned,
    sale.loyalty_points_redeemed
  from public.sales sale
  left join public.receipts receipt
    on receipt.sale_id = sale.id and receipt.organization_id = sale.organization_id
  where sale.organization_id = target_organization_id
    and sale.customer_id = target_customer_id
  order by sale.completed_at desc, sale.id desc
  limit target_limit;
end;
$$;

revoke execute on function public.search_pos_customers(uuid, uuid, text, integer)
from public, anon, service_role;
revoke execute on function public.get_customer_summary(uuid, uuid)
from public, anon, service_role;
revoke execute on function public.get_customer_purchase_history(uuid, uuid, integer)
from public, anon, service_role;

grant execute on function public.search_pos_customers(uuid, uuid, text, integer) to authenticated;
grant execute on function public.get_customer_summary(uuid, uuid) to authenticated;
grant execute on function public.get_customer_purchase_history(uuid, uuid, integer) to authenticated;

create or replace function private.quote_checkout_subtotal(
  target_organization_id uuid,
  target_store_id uuid,
  target_items jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_count integer;
  valid_item_count integer;
  calculated_subtotal_minor bigint;
begin
  if target_items is null or jsonb_typeof(target_items) <> 'array'
    or jsonb_array_length(target_items) not between 1 and 100 then
    raise exception 'Checkout items must contain between 1 and 100 items.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(target_items) as item(item_value)
    where jsonb_typeof(item.item_value) <> 'object'
      or jsonb_typeof(item.item_value -> 'product_id') <> 'string'
      or coalesce(item.item_value ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (
        item.item_value ? 'variant_id'
        and item.item_value -> 'variant_id' <> 'null'::jsonb
        and (
          jsonb_typeof(item.item_value -> 'variant_id') <> 'string'
          or coalesce(item.item_value ->> 'variant_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        )
      )
      or coalesce(item.item_value ->> 'quantity', '') !~ '^[1-9][0-9]{0,3}$'
  ) then
    raise exception 'Each checkout item must have valid item references and quantity.'
      using errcode = '23514';
  end if;

  with parsed_items as (
    select
      (item.item_value ->> 'product_id')::uuid as product_id,
      nullif(item.item_value ->> 'variant_id', '')::uuid as variant_id,
      (item.item_value ->> 'quantity')::integer as quantity
    from jsonb_array_elements(target_items) as item(item_value)
  ), resolved_items as (
    select
      parsed.quantity,
      case
        when parsed.variant_id is null
          and product.product_type = 'simple'
          and product.status = 'active'
          and setting.is_available then product.price_minor
        when parsed.variant_id is not null
          and product.product_type = 'variable'
          and product.status = 'active'
          and setting.is_available
          and variant.id is not null
          and variant.is_active then variant.price_minor
        else null
      end as unit_price_minor
    from parsed_items parsed
    left join public.products product
      on product.id = parsed.product_id
     and product.organization_id = target_organization_id
    left join public.product_store_settings setting
      on setting.organization_id = product.organization_id
     and setting.product_id = product.id
     and setting.store_id = target_store_id
    left join public.product_variants variant
      on variant.id = parsed.variant_id
     and variant.product_id = product.id
     and variant.organization_id = product.organization_id
  )
  select
    count(*)::integer,
    count(*) filter (where unit_price_minor is not null)::integer,
    coalesce(sum(unit_price_minor * quantity), 0)::bigint
  into item_count, valid_item_count, calculated_subtotal_minor
  from resolved_items;

  if item_count <> valid_item_count or calculated_subtotal_minor <= 0 then
    raise exception 'Every checkout item must be active and available at this store.'
      using errcode = '23514';
  end if;

  return calculated_subtotal_minor;
end;
$$;

revoke execute on function private.quote_checkout_subtotal(uuid, uuid, jsonb)
from public, anon, authenticated, service_role;

create or replace function private.checkout_sale(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid,
  target_idempotency_key uuid,
  target_items jsonb,
  target_payments jsonb,
  target_customer_id uuid,
  target_loyalty_redemption_points integer
)
returns table (
  sale_id uuid,
  receipt_number bigint,
  total_minor bigint,
  change_minor bigint,
  payment_summary jsonb,
  was_replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_customer public.customers%rowtype;
  loyalty_program public.loyalty_programs%rowtype;
  customer_point_balance integer := 0;
  requested_redemption_points integer := coalesce(target_loyalty_redemption_points, 0);
  redemption_minor bigint := 0;
  earned_points integer := 0;
  quoted_subtotal_minor bigint;
  loyalty_payment_method_id uuid;
  decorated_items jsonb;
  decorated_payments jsonb;
  checkout_result record;
begin
  if requested_redemption_points < 0 or requested_redemption_points > 100000000 then
    raise exception 'Loyalty redemption points must be between 0 and 100,000,000.'
      using errcode = '23514';
  end if;

  if target_payments is null or jsonb_typeof(target_payments) <> 'array'
    or jsonb_array_length(target_payments) > 10 then
    raise exception 'Checkout payments must be an array with no more than 10 payments.'
      using errcode = '23514';
  end if;

  if target_customer_id is null and requested_redemption_points > 0 then
    raise exception 'Assign a customer before redeeming loyalty points.' using errcode = '23514';
  end if;

  if target_customer_id is not null then
    select customer.*
    into selected_customer
    from public.customers customer
    where customer.id = target_customer_id
      and customer.organization_id = target_organization_id
      and customer.status = 'active'
    for update;

    if selected_customer.id is null then
      raise exception 'The selected customer is not active in this organization.'
        using errcode = '23514';
    end if;

    select program.*
    into loyalty_program
    from public.loyalty_programs program
    where program.organization_id = target_organization_id
    for key share;

    if loyalty_program.organization_id is null then
      raise exception 'The loyalty program is not configured for this organization.'
        using errcode = '23514';
    end if;

    if requested_redemption_points > 0 then
      if not loyalty_program.is_enabled then
        raise exception 'Loyalty redemption is currently disabled.' using errcode = '23514';
      end if;

      if requested_redemption_points < loyalty_program.minimum_redemption_points then
        raise exception 'This redemption is below the program minimum.' using errcode = '23514';
      end if;

      select coalesce(sum(transaction.points_delta), 0)::integer
      into customer_point_balance
      from public.loyalty_transactions transaction
      where transaction.organization_id = target_organization_id
        and transaction.customer_id = target_customer_id;

      if customer_point_balance < requested_redemption_points then
        raise exception 'The customer does not have enough loyalty points.' using errcode = '23514';
      end if;

      quoted_subtotal_minor := private.quote_checkout_subtotal(
        target_organization_id,
        target_store_id,
        target_items
      );
      redemption_minor := requested_redemption_points::bigint * loyalty_program.redemption_value_minor;

      if redemption_minor > quoted_subtotal_minor then
        raise exception 'Loyalty points cannot exceed this sale total.' using errcode = '23514';
      end if;

      select payment_method.id
      into loyalty_payment_method_id
      from public.payment_methods payment_method
      join public.store_payment_methods store_payment_method
        on store_payment_method.organization_id = payment_method.organization_id
       and store_payment_method.payment_method_id = payment_method.id
       and store_payment_method.store_id = target_store_id
       and store_payment_method.is_enabled
      where payment_method.organization_id = target_organization_id
        and payment_method.is_loyalty_redemption
        and payment_method.is_enabled
      for key share of payment_method, store_payment_method;

      if loyalty_payment_method_id is null then
        raise exception 'Loyalty redemption is not enabled for this store.' using errcode = '23514';
      end if;
    end if;
  end if;

  select coalesce(
    jsonb_agg(
      item.item_value || jsonb_build_object(
        '_tindio_customer_id', target_customer_id,
        '_tindio_loyalty_redemption_points', requested_redemption_points
      )
      order by item.ordinality
    ),
    '[]'::jsonb
  )
  into decorated_items
  from jsonb_array_elements(target_items) with ordinality as item(item_value, ordinality);

  decorated_payments := target_payments;
  if redemption_minor > 0 then
    if jsonb_array_length(target_payments) >= 10 then
      raise exception 'Use at most nine customer payment entries when redeeming loyalty points.'
        using errcode = '23514';
    end if;

    decorated_payments := jsonb_build_array(jsonb_build_object(
      'payment_method_id', loyalty_payment_method_id,
      'amount_minor', redemption_minor,
      '_tindio_loyalty_customer_id', target_customer_id,
      '_tindio_loyalty_points', requested_redemption_points
    )) || target_payments;
  end if;

  select *
  into checkout_result
  from private.checkout_sale(
    target_organization_id,
    target_store_id,
    target_register_id,
    target_idempotency_key,
    decorated_items,
    decorated_payments
  );

  if checkout_result.was_replayed then
    return query
    select
      checkout_result.sale_id,
      checkout_result.receipt_number,
      checkout_result.total_minor,
      checkout_result.change_minor,
      checkout_result.payment_summary,
      true;
    return;
  end if;

  if target_customer_id is not null then
    if loyalty_program.is_enabled then
      earned_points := floor(
        (checkout_result.total_minor - redemption_minor)::numeric
        / loyalty_program.earn_spend_minor
      )::integer * loyalty_program.earn_points;
    end if;

    update public.sales sale
    set
      customer_id = target_customer_id,
      loyalty_redemption_minor = redemption_minor,
      loyalty_points_redeemed = requested_redemption_points,
      loyalty_points_earned = earned_points
    where sale.id = checkout_result.sale_id
      and sale.organization_id = target_organization_id;

    if requested_redemption_points > 0 then
      insert into public.loyalty_transactions (
        organization_id,
        customer_id,
        sale_id,
        entry_type,
        points_delta,
        note
      )
      values (
        target_organization_id,
        target_customer_id,
        checkout_result.sale_id,
        'REDEMPTION',
        -requested_redemption_points,
        'Redeemed during POS checkout'
      );
    end if;

    if earned_points > 0 then
      insert into public.loyalty_transactions (
        organization_id,
        customer_id,
        sale_id,
        entry_type,
        points_delta,
        note
      )
      values (
        target_organization_id,
        target_customer_id,
        checkout_result.sale_id,
        'SALE_EARN',
        earned_points,
        'Earned from completed sale'
      );
    end if;
  end if;

  return query
  select
    checkout_result.sale_id,
    checkout_result.receipt_number,
    checkout_result.total_minor,
    checkout_result.change_minor,
    checkout_result.payment_summary,
    false;
end;
$$;

create or replace function public.checkout_sale(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid,
  target_idempotency_key uuid,
  target_items jsonb,
  target_payments jsonb,
  target_customer_id uuid,
  target_loyalty_redemption_points integer
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
  from private.checkout_sale(
    target_organization_id,
    target_store_id,
    target_register_id,
    target_idempotency_key,
    target_items,
    target_payments,
    target_customer_id,
    target_loyalty_redemption_points
  );
$$;

revoke execute on function private.checkout_sale(uuid, uuid, uuid, uuid, jsonb, jsonb, uuid, integer)
from public, anon, authenticated, service_role;
revoke execute on function public.checkout_sale(uuid, uuid, uuid, uuid, jsonb, jsonb, uuid, integer)
from public, anon, service_role;

grant execute on function private.checkout_sale(uuid, uuid, uuid, uuid, jsonb, jsonb, uuid, integer)
to authenticated;
grant execute on function public.checkout_sale(uuid, uuid, uuid, uuid, jsonb, jsonb, uuid, integer)
to authenticated;

create or replace function private.reverse_loyalty_earnings_for_refund()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  original_sale public.sales%rowtype;
  cumulative_refund_minor bigint;
  already_reversed_points integer;
  target_reversed_points integer;
  incremental_reversal integer;
begin
  if new.status <> 'completed'
    or new.total_minor <= old.total_minor
    or new.total_minor <= 0 then
    return new;
  end if;

  select sale.*
  into original_sale
  from public.sales sale
  where sale.id = new.sale_id and sale.organization_id = new.organization_id
  for share;

  if original_sale.customer_id is null
    or original_sale.loyalty_points_earned = 0
    or original_sale.total_minor <= 0 then
    return new;
  end if;

  select coalesce(sum(refund.total_minor), 0)::bigint
  into cumulative_refund_minor
  from public.refunds refund
  where refund.organization_id = new.organization_id
    and refund.sale_id = new.sale_id
    and refund.status = 'completed';

  select coalesce(-sum(transaction.points_delta), 0)::integer
  into already_reversed_points
  from public.loyalty_transactions transaction
  where transaction.organization_id = new.organization_id
    and transaction.sale_id = new.sale_id
    and transaction.entry_type = 'REFUND_EARN_REVERSAL';

  target_reversed_points := floor(
    original_sale.loyalty_points_earned::numeric
    * least(cumulative_refund_minor, original_sale.total_minor)::numeric
    / original_sale.total_minor::numeric
  )::integer;
  incremental_reversal := target_reversed_points - already_reversed_points;

  if incremental_reversal > 0 then
    insert into public.loyalty_transactions (
      organization_id,
      customer_id,
      sale_id,
      refund_id,
      entry_type,
      points_delta,
      note
    )
    values (
      new.organization_id,
      original_sale.customer_id,
      new.sale_id,
      new.id,
      'REFUND_EARN_REVERSAL',
      -incremental_reversal,
      'Loyalty points reversed for refund'
    );
  end if;

  return new;
end;
$$;

revoke execute on function private.reverse_loyalty_earnings_for_refund()
from public, anon, authenticated, service_role;

create trigger refunds_reverse_loyalty_earnings
after update of total_minor on public.refunds
for each row execute function private.reverse_loyalty_earnings_for_refund();

comment on table public.customers
is 'Organization-scoped CRM records. Completed sales reference a customer but never expose customer PII through POS catalogue endpoints.';
comment on table public.loyalty_programs
is 'One configurable loyalty earn and redemption rule set per organization.';
comment on table public.loyalty_transactions
is 'Immutable points ledger. Customer balances are derived by summing point deltas.';
comment on function public.search_pos_customers(uuid, uuid, text, integer)
is 'Returns safe active-customer lookup fields for an assigned cashier with sales permission.';
comment on function public.checkout_sale(uuid, uuid, uuid, uuid, jsonb, jsonb, uuid, integer)
is 'Completes checkout with an optional customer and validated loyalty redemption tender; points are ledgered atomically with the sale.';

commit;
