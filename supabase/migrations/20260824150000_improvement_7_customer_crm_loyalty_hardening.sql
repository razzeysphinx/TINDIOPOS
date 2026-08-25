-- Improvement 7: complete the customer CRM without replacing the established
-- Phase 7 sales and loyalty ledger. Customer numbers and card codes are
-- generated server-side; segment changes and manual loyalty entries pass
-- through permission-checked, auditable routines.

begin;

alter table public.customers
  add column customer_number bigint,
  add column loyalty_card_code text;

with numbered_customers as (
  select
    customer.id,
    row_number() over (
      partition by customer.organization_id
      order by customer.created_at, customer.id
    )::bigint as customer_number
  from public.customers customer
)
update public.customers customer
set customer_number = numbered_customers.customer_number
from numbered_customers
where numbered_customers.id = customer.id;

update public.customers
set loyalty_card_code = 'TND-' || lpad(customer_number::text, 8, '0')
where loyalty_card_code is null;

alter table public.customers
  alter column customer_number set not null,
  alter column loyalty_card_code set not null,
  alter column customer_number set default 0,
  alter column loyalty_card_code set default '',
  add constraint customers_customer_number_positive check (customer_number > 0),
  add constraint customers_loyalty_card_code_length check (
    char_length(btrim(loyalty_card_code)) between 3 and 80
  ),
  add constraint customers_organization_customer_number_unique unique (organization_id, customer_number);

create unique index customers_organization_loyalty_card_code_unique_idx
  on public.customers (organization_id, lower(loyalty_card_code));

create or replace function private.assign_customer_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.customer_number <> 0 then
      raise exception 'Customer numbers are assigned by TINDIO.' using errcode = '42501';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(new.organization_id::text, 702017)
    );

    select coalesce(max(customer.customer_number), 0) + 1
    into new.customer_number
    from public.customers customer
    where customer.organization_id = new.organization_id;
  end if;

  new.loyalty_card_code := nullif(btrim(coalesce(new.loyalty_card_code, '')), '');
  if new.loyalty_card_code is null then
    new.loyalty_card_code := 'TND-' || lpad(new.customer_number::text, 8, '0');
  end if;

  return new;
end;
$$;

revoke execute on function private.assign_customer_identity()
from public, anon, authenticated, service_role;

create trigger customers_assign_identity
before insert or update of loyalty_card_code on public.customers
for each row execute function private.assign_customer_identity();

create table public.customer_segments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  constraint customer_segments_id_organization_unique unique (id, organization_id),
  constraint customer_segments_name_length check (char_length(btrim(name)) between 1 and 80),
  constraint customer_segments_description_length check (
    description is null or char_length(btrim(description)) between 2 and 500
  )
);

create unique index customer_segments_organization_name_unique_idx
  on public.customer_segments (organization_id, lower(name));

create table public.customer_segment_memberships (
  organization_id uuid not null,
  customer_id uuid not null,
  segment_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (customer_id, segment_id),
  constraint customer_segment_memberships_customer_organization_fkey
    foreign key (customer_id, organization_id)
    references public.customers (id, organization_id)
    on delete restrict,
  constraint customer_segment_memberships_segment_organization_fkey
    foreign key (segment_id, organization_id)
    references public.customer_segments (id, organization_id)
    on delete restrict
);

create index customer_segment_memberships_organization_segment_idx
  on public.customer_segment_memberships (organization_id, segment_id, customer_id);

alter table public.customer_segments enable row level security;
alter table public.customer_segment_memberships enable row level security;

revoke all on table public.customer_segments, public.customer_segment_memberships
from public, anon, authenticated, service_role;

grant select on public.customer_segments, public.customer_segment_memberships to authenticated;

create policy customer_segments_select_manager
on public.customer_segments
for select
to authenticated
using ((select private.has_permission(organization_id, 'customers.manage')));

create policy customer_segment_memberships_select_manager
on public.customer_segment_memberships
for select
to authenticated
using ((select private.has_permission(organization_id, 'customers.manage')));

alter table public.loyalty_transactions
  drop constraint loyalty_transactions_entry_type_values,
  drop constraint loyalty_transactions_entry_source,
  add constraint loyalty_transactions_entry_type_values check (
    entry_type in ('SALE_EARN', 'REDEMPTION', 'REFUND_EARN_REVERSAL', 'MANUAL_ADJUSTMENT')
  ),
  add constraint loyalty_transactions_entry_source check (
    (entry_type in ('SALE_EARN', 'REDEMPTION') and sale_id is not null and refund_id is null)
    or (entry_type = 'REFUND_EARN_REVERSAL' and sale_id is not null and refund_id is not null)
    or (entry_type = 'MANUAL_ADJUSTMENT' and sale_id is null and refund_id is null)
  );

drop function public.search_pos_customers(uuid, uuid, text, integer);

create function public.search_pos_customers(
  target_organization_id uuid,
  target_store_id uuid,
  target_query text,
  target_limit integer
)
returns table (
  customer_id uuid,
  customer_number bigint,
  loyalty_card_code text,
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

  perform private.require_pos_workspace_access(
    target_organization_id,
    target_store_id
  );

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
    customer.customer_number,
    customer.loyalty_card_code,
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
      or customer.loyalty_card_code ilike '%' || normalized_query || '%'
      or customer.customer_number::text = normalized_query
    )
  order by customer.full_name, customer.created_at desc
  limit target_limit;
end;
$$;

revoke execute on function public.search_pos_customers(uuid, uuid, text, integer)
from public, anon, service_role;
grant execute on function public.search_pos_customers(uuid, uuid, text, integer) to authenticated;

create function public.create_customer_segment(
  target_organization_id uuid,
  target_name text,
  target_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := btrim(coalesce(target_name, ''));
  normalized_description text := nullif(btrim(coalesce(target_description, '')), '');
  created_segment_id uuid;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'customers.manage')) then
    raise exception 'Customer management permission is required.' using errcode = '42501';
  end if;

  if char_length(normalized_name) not between 1 and 80
    or (normalized_description is not null and char_length(normalized_description) not between 2 and 500) then
    raise exception 'Check the customer segment details.' using errcode = '23514';
  end if;

  insert into public.customer_segments (organization_id, name, description)
  values (target_organization_id, normalized_name, normalized_description)
  returning id into created_segment_id;

  return created_segment_id;
end;
$$;

create function public.update_customer_profile(
  target_organization_id uuid,
  target_customer_id uuid,
  target_full_name text,
  target_email text,
  target_phone text,
  target_address text,
  target_birthday date,
  target_notes text,
  target_loyalty_card_code text,
  target_segment_ids uuid[] default '{}'::uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_full_name text := btrim(coalesce(target_full_name, ''));
  normalized_email text := nullif(btrim(coalesce(target_email, '')), '');
  normalized_phone text := nullif(btrim(coalesce(target_phone, '')), '');
  normalized_address text := nullif(btrim(coalesce(target_address, '')), '');
  normalized_notes text := nullif(btrim(coalesce(target_notes, '')), '');
  normalized_loyalty_card_code text := nullif(btrim(coalesce(target_loyalty_card_code, '')), '');
  normalized_segment_ids uuid[] := coalesce(target_segment_ids, '{}'::uuid[]);
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'customers.manage')) then
    raise exception 'Customer management permission is required.' using errcode = '42501';
  end if;

  if char_length(normalized_full_name) not between 1 and 160
    or (normalized_email is not null and char_length(normalized_email) not between 3 and 320)
    or (normalized_phone is not null and char_length(normalized_phone) not between 3 and 40)
    or (normalized_address is not null and char_length(normalized_address) not between 2 and 500)
    or (normalized_notes is not null and char_length(normalized_notes) not between 2 and 1000)
    or (normalized_loyalty_card_code is not null and char_length(normalized_loyalty_card_code) not between 3 and 80)
    or cardinality(normalized_segment_ids) > 20
    or cardinality(normalized_segment_ids) <> (
      select count(*)::integer
      from (select distinct segment_id from unnest(normalized_segment_ids) as input(segment_id)) unique_segments
    ) then
    raise exception 'Check the customer profile details.' using errcode = '23514';
  end if;

  perform 1
  from public.customers customer
  where customer.id = target_customer_id
    and customer.organization_id = target_organization_id
  for update;

  if not found then
    raise exception 'The customer was not found.' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from unnest(normalized_segment_ids) as requested(segment_id)
    left join public.customer_segments segment
      on segment.id = requested.segment_id
     and segment.organization_id = target_organization_id
    where segment.id is null
  ) then
    raise exception 'One or more customer segments are unavailable.' using errcode = '23514';
  end if;

  update public.customers
  set
    full_name = normalized_full_name,
    email = normalized_email,
    phone = normalized_phone,
    address = normalized_address,
    birthday = target_birthday,
    notes = normalized_notes,
    loyalty_card_code = normalized_loyalty_card_code
  where id = target_customer_id
    and organization_id = target_organization_id;

  delete from public.customer_segment_memberships membership
  where membership.organization_id = target_organization_id
    and membership.customer_id = target_customer_id;

  insert into public.customer_segment_memberships (organization_id, customer_id, segment_id)
  select target_organization_id, target_customer_id, requested.segment_id
  from unnest(normalized_segment_ids) as requested(segment_id);
end;
$$;

create function public.adjust_customer_loyalty_points(
  target_organization_id uuid,
  target_customer_id uuid,
  target_points_delta integer,
  target_reason text
)
returns table (
  loyalty_transaction_id uuid,
  loyalty_points integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_reason text := btrim(coalesce(target_reason, ''));
  actor_employee_id uuid;
  created_transaction_id uuid;
  updated_balance integer;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'customers.manage')) then
    raise exception 'Customer management permission is required.' using errcode = '42501';
  end if;

  if target_points_delta is null
    or target_points_delta = 0
    or target_points_delta not between -1000000 and 1000000
    or char_length(normalized_reason) not between 2 and 500 then
    raise exception 'Enter a non-zero adjustment and a reason between 2 and 500 characters.'
      using errcode = '23514';
  end if;

  select private.current_employee_id(target_organization_id)
  into actor_employee_id;

  if actor_employee_id is null then
    raise exception 'An active employee is required for a loyalty adjustment.' using errcode = '42501';
  end if;

  perform 1
  from public.customers customer
  where customer.id = target_customer_id
    and customer.organization_id = target_organization_id
    and customer.status = 'active'
  for update;

  if not found then
    raise exception 'The customer is not active in this organization.' using errcode = 'P0002';
  end if;

  insert into public.loyalty_transactions (
    organization_id,
    customer_id,
    entry_type,
    points_delta,
    note
  )
  values (
    target_organization_id,
    target_customer_id,
    'MANUAL_ADJUSTMENT',
    target_points_delta,
    normalized_reason
  )
  returning id into created_transaction_id;

  select coalesce(sum(transaction.points_delta), 0)::integer
  into updated_balance
  from public.loyalty_transactions transaction
  where transaction.organization_id = target_organization_id
    and transaction.customer_id = target_customer_id;

  perform private.write_audit_log(
    target_organization_id,
    'CUSTOMER_LOYALTY_ADJUSTED',
    'loyalty.adjust',
    actor_employee_id,
    null,
    null,
    null,
    null,
    abs(target_points_delta)::bigint,
    normalized_reason,
    jsonb_build_object(
      'customer_id', target_customer_id,
      'loyalty_transaction_id', created_transaction_id,
      'points_delta', target_points_delta,
      'resulting_balance', updated_balance
    )
  );

  return query select created_transaction_id, updated_balance;
end;
$$;

revoke execute on function public.create_customer_segment(uuid, text, text)
from public, anon, service_role;
revoke execute on function public.update_customer_profile(uuid, uuid, text, text, text, text, date, text, text, uuid[])
from public, anon, service_role;
revoke execute on function public.adjust_customer_loyalty_points(uuid, uuid, integer, text)
from public, anon, service_role;

grant execute on function public.create_customer_segment(uuid, text, text) to authenticated;
grant execute on function public.update_customer_profile(uuid, uuid, text, text, text, text, date, text, text, uuid[]) to authenticated;
grant execute on function public.adjust_customer_loyalty_points(uuid, uuid, integer, text) to authenticated;

comment on column public.customers.customer_number
is 'Organization-scoped, system-assigned customer ID. It is stable and cannot be edited.';
comment on column public.customers.loyalty_card_code
is 'Organization-scoped barcode or loyalty-card value, automatically assigned when omitted.';
comment on table public.customer_segments
is 'Organization-scoped customer grouping labels managed by authorized CRM users.';
comment on table public.customer_segment_memberships
is 'Current customer-to-segment assignments; changes are made atomically with the customer profile.';
comment on function public.adjust_customer_loyalty_points(uuid, uuid, integer, text)
is 'Creates one immutable, reasoned MANUAL_ADJUSTMENT loyalty entry and a matching audit event.';

commit;
