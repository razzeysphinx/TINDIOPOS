-- TINDIO Planning Document Phase 6: lightweight QR loyalty cards.
--
-- This complements, rather than replaces, the existing immutable
-- loyalty-points ledger. A QR contains only an opaque card UUID plus an
-- unguessable verification secret. Stamps and reward state stay in Postgres.

begin;

create table public.loyalty_cards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  customer_id uuid not null,
  card_code text not null,
  verification_token_hash bytea not null,
  stamp_count integer not null default 0,
  stamp_target integer not null default 10,
  status text not null default 'active',
  replaces_card_id uuid,
  issued_by_employee_id uuid not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz,
  deactivated_at timestamptz,
  deactivation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loyalty_cards_id_organization_unique unique (id, organization_id),
  constraint loyalty_cards_customer_organization_fkey
    foreign key (customer_id, organization_id)
    references public.customers (id, organization_id)
    on delete restrict,
  constraint loyalty_cards_issued_by_organization_fkey
    foreign key (issued_by_employee_id, organization_id)
    references public.employees (id, organization_id)
    on delete restrict,
  constraint loyalty_cards_replaces_card_fkey
    foreign key (replaces_card_id, organization_id)
    references public.loyalty_cards (id, organization_id)
    on delete restrict,
  constraint loyalty_cards_card_code_format
    check (card_code ~ '^TND-LY-[A-Z0-9]{10}$'),
  constraint loyalty_cards_token_hash_length
    check (octet_length(verification_token_hash) = 32),
  constraint loyalty_cards_stamp_bounds
    check (stamp_count between 0 and stamp_target and stamp_target between 1 and 100),
  constraint loyalty_cards_status_values
    check (status in ('active', 'reward_claimed', 'revoked', 'replaced', 'expired')),
  constraint loyalty_cards_deactivation_reason_length
    check (deactivation_reason is null or char_length(btrim(deactivation_reason)) between 2 and 500)
);

create unique index loyalty_cards_organization_card_code_unique_idx
  on public.loyalty_cards (organization_id, lower(card_code));
create unique index loyalty_cards_one_active_customer_idx
  on public.loyalty_cards (organization_id, customer_id)
  where status = 'active';
create index loyalty_cards_customer_issued_idx
  on public.loyalty_cards (organization_id, customer_id, issued_at desc);
create index loyalty_cards_verification_lookup_idx
  on public.loyalty_cards (id)
  where status = 'active';

create trigger loyalty_cards_set_updated_at
before update on public.loyalty_cards
for each row execute function private.set_updated_at();

create table public.loyalty_card_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  loyalty_card_id uuid not null,
  customer_id uuid not null,
  event_type text not null,
  stamp_count_before integer not null,
  stamp_delta integer not null default 0,
  stamp_count_after integer not null,
  actor_employee_id uuid not null,
  store_id uuid,
  register_id uuid,
  sale_id uuid,
  idempotency_key uuid,
  reason text,
  created_at timestamptz not null default now(),
  constraint loyalty_card_events_card_organization_fkey
    foreign key (loyalty_card_id, organization_id)
    references public.loyalty_cards (id, organization_id)
    on delete restrict,
  constraint loyalty_card_events_customer_organization_fkey
    foreign key (customer_id, organization_id)
    references public.customers (id, organization_id)
    on delete restrict,
  constraint loyalty_card_events_actor_organization_fkey
    foreign key (actor_employee_id, organization_id)
    references public.employees (id, organization_id)
    on delete restrict,
  constraint loyalty_card_events_store_organization_fkey
    foreign key (store_id, organization_id)
    references public.stores (id, organization_id)
    on delete restrict,
  constraint loyalty_card_events_register_organization_fkey
    foreign key (register_id, organization_id)
    references public.registers (id, organization_id)
    on delete restrict,
  constraint loyalty_card_events_sale_organization_fkey
    foreign key (sale_id, organization_id)
    references public.sales (id, organization_id)
    on delete restrict,
  constraint loyalty_card_events_type_values
    check (event_type in ('ISSUED', 'STAMP_ADDED', 'REWARD_CLAIMED', 'REVOKED', 'REPLACED', 'QR_ROTATED')),
  constraint loyalty_card_events_stamp_math
    check (
      (event_type = 'STAMP_ADDED' and stamp_delta = 1 and stamp_count_after = stamp_count_before + 1)
      or (event_type <> 'STAMP_ADDED' and stamp_delta = 0 and stamp_count_after = stamp_count_before)
    ),
  constraint loyalty_card_events_stamp_bounds
    check (stamp_count_before >= 0 and stamp_count_after >= 0),
  constraint loyalty_card_events_reason_length
    check (reason is null or char_length(btrim(reason)) between 2 and 500)
);

create index loyalty_card_events_card_created_idx
  on public.loyalty_card_events (organization_id, loyalty_card_id, created_at desc);
create index loyalty_card_events_customer_created_idx
  on public.loyalty_card_events (organization_id, customer_id, created_at desc);
create unique index loyalty_card_events_stamp_sale_unique_idx
  on public.loyalty_card_events (organization_id, sale_id)
  where event_type = 'STAMP_ADDED' and sale_id is not null;
create unique index loyalty_card_events_reward_claim_once_idx
  on public.loyalty_card_events (loyalty_card_id)
  where event_type = 'REWARD_CLAIMED';
create unique index loyalty_card_events_idempotency_unique_idx
  on public.loyalty_card_events (organization_id, idempotency_key)
  where idempotency_key is not null;

alter table public.loyalty_cards enable row level security;
alter table public.loyalty_card_events enable row level security;

revoke all on table public.loyalty_cards, public.loyalty_card_events
from public, anon, authenticated, service_role;

create function public.get_customer_loyalty_cards(
  target_organization_id uuid,
  target_customer_id uuid
)
returns table (
  card_id uuid,
  card_code text,
  status text,
  stamp_count integer,
  stamp_target integer,
  issued_at timestamptz,
  expires_at timestamptz,
  deactivated_at timestamptz,
  deactivation_reason text
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

  return query
  select
    card.id,
    card.card_code,
    card.status,
    card.stamp_count,
    card.stamp_target,
    card.issued_at,
    card.expires_at,
    card.deactivated_at,
    card.deactivation_reason
  from public.loyalty_cards card
  where card.organization_id = target_organization_id
    and card.customer_id = target_customer_id
  order by card.issued_at desc, card.id desc;
end;
$$;

create function public.get_customer_loyalty_card_events(
  target_organization_id uuid,
  target_customer_id uuid
)
returns table (
  event_id uuid,
  loyalty_card_id uuid,
  card_code text,
  event_type text,
  stamp_count_before integer,
  stamp_delta integer,
  stamp_count_after integer,
  sale_id uuid,
  reason text,
  created_at timestamptz
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

  return query
  select
    event.id,
    event.loyalty_card_id,
    card.card_code,
    event.event_type,
    event.stamp_count_before,
    event.stamp_delta,
    event.stamp_count_after,
    event.sale_id,
    event.reason,
    event.created_at
  from public.loyalty_card_events event
  join public.loyalty_cards card
    on card.id = event.loyalty_card_id
   and card.organization_id = event.organization_id
  where event.organization_id = target_organization_id
    and event.customer_id = target_customer_id
  order by event.created_at desc, event.id desc
  limit 50;
end;
$$;

create function public.issue_loyalty_card(
  target_organization_id uuid,
  target_customer_id uuid,
  target_card_code text,
  target_verification_token text,
  target_replaces_card_id uuid default null,
  target_reason text default null
)
returns table (
  card_id uuid,
  card_code text,
  stamp_count integer,
  stamp_target integer,
  status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  normalized_card_code text := upper(btrim(coalesce(target_card_code, '')));
  normalized_reason text := nullif(btrim(coalesce(target_reason, '')), '');
  existing_card public.loyalty_cards%rowtype;
  issued_card public.loyalty_cards%rowtype;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'customers.manage')) then
    raise exception 'Customer management permission is required.' using errcode = '42501';
  end if;

  if normalized_card_code !~ '^TND-LY-[A-Z0-9]{10}$'
    or target_verification_token !~ '^[a-f0-9]{64}$'
    or (target_replaces_card_id is not null and char_length(coalesce(normalized_reason, '')) not between 2 and 500) then
    raise exception 'The loyalty card details are invalid.' using errcode = '23514';
  end if;

  select private.current_employee_id(target_organization_id)
  into actor_employee_id;
  if actor_employee_id is null then
    raise exception 'An active employee is required to issue a loyalty card.' using errcode = '42501';
  end if;

  perform 1
  from public.customers customer
  where customer.id = target_customer_id
    and customer.organization_id = target_organization_id
    and customer.status = 'active'
  for key share;
  if not found then
    raise exception 'The customer is not active in this organization.' using errcode = 'P0002';
  end if;

  if target_replaces_card_id is not null then
    select card.*
    into existing_card
    from public.loyalty_cards card
    where card.id = target_replaces_card_id
      and card.organization_id = target_organization_id
      and card.customer_id = target_customer_id
      and card.status in ('active', 'reward_claimed')
    for update;

    if existing_card.id is null then
      raise exception 'The active loyalty card could not be replaced.' using errcode = 'P0002';
    end if;

    update public.loyalty_cards card
    set
      status = 'replaced',
      deactivated_at = now(),
      deactivation_reason = normalized_reason
    where card.id = existing_card.id
      and card.organization_id = target_organization_id;

    insert into public.loyalty_card_events (
      organization_id, loyalty_card_id, customer_id, event_type,
      stamp_count_before, stamp_delta, stamp_count_after,
      actor_employee_id, reason
    )
    values (
      target_organization_id, existing_card.id, target_customer_id, 'REPLACED',
      existing_card.stamp_count, 0, existing_card.stamp_count,
      actor_employee_id, normalized_reason
    );
  elsif exists (
    select 1
    from public.loyalty_cards card
    where card.organization_id = target_organization_id
      and card.customer_id = target_customer_id
      and card.status = 'active'
  ) then
    raise exception 'This customer already has an active QR loyalty card.' using errcode = '23505';
  end if;

  insert into public.loyalty_cards (
    organization_id,
    customer_id,
    card_code,
    verification_token_hash,
    replaces_card_id,
    issued_by_employee_id
  )
  values (
    target_organization_id,
    target_customer_id,
    normalized_card_code,
    extensions.digest(target_verification_token, 'sha256'),
    target_replaces_card_id,
    actor_employee_id
  )
  returning * into issued_card;

  insert into public.loyalty_card_events (
    organization_id, loyalty_card_id, customer_id, event_type,
    stamp_count_before, stamp_delta, stamp_count_after,
    actor_employee_id, reason
  )
  values (
    target_organization_id, issued_card.id, target_customer_id, 'ISSUED',
    0, 0, 0,
    actor_employee_id, normalized_reason
  );

  perform private.write_audit_log(
    target_organization_id,
    'LOYALTY_CARD_ISSUED',
    'loyalty.card.issue',
    actor_employee_id,
    null,
    null,
    null,
    null,
    null,
    normalized_reason,
    jsonb_build_object(
      'customer_id', target_customer_id,
      'loyalty_card_id', issued_card.id,
      'card_code', issued_card.card_code,
      'replaces_card_id', target_replaces_card_id
    )
  );

  return query select issued_card.id, issued_card.card_code, issued_card.stamp_count, issued_card.stamp_target, issued_card.status;
end;
$$;

create function public.rotate_loyalty_card_qr(
  target_organization_id uuid,
  target_loyalty_card_id uuid,
  target_verification_token text,
  target_reason text
)
returns table (
  card_id uuid,
  card_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  normalized_reason text := btrim(coalesce(target_reason, ''));
  card_record public.loyalty_cards%rowtype;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'customers.manage')) then
    raise exception 'Customer management permission is required.' using errcode = '42501';
  end if;

  if target_verification_token !~ '^[a-f0-9]{64}$'
    or char_length(normalized_reason) not between 2 and 500 then
    raise exception 'A new QR token and a reason between 2 and 500 characters are required.' using errcode = '23514';
  end if;

  select private.current_employee_id(target_organization_id)
  into actor_employee_id;
  if actor_employee_id is null then
    raise exception 'An active employee is required to rotate this QR code.' using errcode = '42501';
  end if;

  select card.*
  into card_record
  from public.loyalty_cards card
  where card.id = target_loyalty_card_id
    and card.organization_id = target_organization_id
    and card.status = 'active'
    and (card.expires_at is null or card.expires_at > now())
  for update;
  if card_record.id is null then
    raise exception 'Only an active, unexpired loyalty card can receive a new QR code.' using errcode = 'P0002';
  end if;

  update public.loyalty_cards card
  set verification_token_hash = extensions.digest(target_verification_token, 'sha256')
  where card.id = card_record.id
    and card.organization_id = target_organization_id;

  insert into public.loyalty_card_events (
    organization_id, loyalty_card_id, customer_id, event_type,
    stamp_count_before, stamp_delta, stamp_count_after,
    actor_employee_id, reason
  )
  values (
    target_organization_id, card_record.id, card_record.customer_id, 'QR_ROTATED',
    card_record.stamp_count, 0, card_record.stamp_count,
    actor_employee_id, normalized_reason
  );

  perform private.write_audit_log(
    target_organization_id,
    'LOYALTY_CARD_QR_ROTATED',
    'loyalty.card.rotate_qr',
    actor_employee_id,
    null,
    null,
    null,
    null,
    null,
    normalized_reason,
    jsonb_build_object('loyalty_card_id', card_record.id, 'customer_id', card_record.customer_id)
  );

  return query select card_record.id, card_record.card_code;
end;
$$;

create function public.revoke_loyalty_card(
  target_organization_id uuid,
  target_loyalty_card_id uuid,
  target_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  normalized_reason text := btrim(coalesce(target_reason, ''));
  card_record public.loyalty_cards%rowtype;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'customers.manage')) then
    raise exception 'Customer management permission is required.' using errcode = '42501';
  end if;

  if char_length(normalized_reason) not between 2 and 500 then
    raise exception 'Enter a revocation reason between 2 and 500 characters.' using errcode = '23514';
  end if;

  select private.current_employee_id(target_organization_id)
  into actor_employee_id;
  if actor_employee_id is null then
    raise exception 'An active employee is required to revoke this card.' using errcode = '42501';
  end if;

  select card.*
  into card_record
  from public.loyalty_cards card
  where card.id = target_loyalty_card_id
    and card.organization_id = target_organization_id
    and card.status = 'active'
  for update;
  if card_record.id is null then
    raise exception 'Only an active loyalty card can be revoked.' using errcode = 'P0002';
  end if;

  update public.loyalty_cards card
  set
    status = 'revoked',
    deactivated_at = now(),
    deactivation_reason = normalized_reason
  where card.id = card_record.id
    and card.organization_id = target_organization_id;

  insert into public.loyalty_card_events (
    organization_id, loyalty_card_id, customer_id, event_type,
    stamp_count_before, stamp_delta, stamp_count_after,
    actor_employee_id, reason
  )
  values (
    target_organization_id, card_record.id, card_record.customer_id, 'REVOKED',
    card_record.stamp_count, 0, card_record.stamp_count,
    actor_employee_id, normalized_reason
  );

  perform private.write_audit_log(
    target_organization_id,
    'LOYALTY_CARD_REVOKED',
    'loyalty.card.revoke',
    actor_employee_id,
    null,
    null,
    null,
    null,
    null,
    normalized_reason,
    jsonb_build_object('loyalty_card_id', card_record.id, 'customer_id', card_record.customer_id)
  );
end;
$$;

create function public.add_loyalty_card_stamp(
  target_organization_id uuid,
  target_loyalty_card_id uuid,
  target_reason text,
  target_sale_id uuid default null,
  target_idempotency_key uuid default null
)
returns table (
  card_id uuid,
  stamp_count integer,
  stamp_target integer,
  status text,
  was_replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  normalized_reason text := nullif(btrim(coalesce(target_reason, '')), '');
  card_record public.loyalty_cards%rowtype;
  previous_event public.loyalty_card_events%rowtype;
  resolved_store_id uuid;
  resolved_register_id uuid;
begin
  if (select auth.uid()) is null
    or not (
      (select private.has_permission(target_organization_id, 'customers.manage'))
      or (select private.has_permission(target_organization_id, 'sales.create'))
    ) then
    raise exception 'Sales or customer management permission is required to add a stamp.' using errcode = '42501';
  end if;

  if target_idempotency_key is null
    or (target_sale_id is null and char_length(coalesce(normalized_reason, '')) not between 2 and 500)
    or (target_sale_id is not null and normalized_reason is not null and char_length(normalized_reason) not between 2 and 500) then
    raise exception 'Provide an action key and, for a manual stamp, a reason between 2 and 500 characters.' using errcode = '23514';
  end if;

  select private.current_employee_id(target_organization_id)
  into actor_employee_id;
  if actor_employee_id is null then
    raise exception 'An active employee is required to add a loyalty stamp.' using errcode = '42501';
  end if;

  select event.*
  into previous_event
  from public.loyalty_card_events event
  where event.organization_id = target_organization_id
    and event.idempotency_key = target_idempotency_key
  for key share;

  if previous_event.id is not null then
    if previous_event.event_type <> 'STAMP_ADDED'
      or previous_event.loyalty_card_id <> target_loyalty_card_id then
      raise exception 'This loyalty action key is already in use.' using errcode = '23505';
    end if;

    select card.*
    into card_record
    from public.loyalty_cards card
    where card.id = target_loyalty_card_id
      and card.organization_id = target_organization_id;

    return query select card_record.id, card_record.stamp_count, card_record.stamp_target, card_record.status, true;
    return;
  end if;

  select card.*
  into card_record
  from public.loyalty_cards card
  join public.customers customer
    on customer.id = card.customer_id
   and customer.organization_id = card.organization_id
  where card.id = target_loyalty_card_id
    and card.organization_id = target_organization_id
    and card.status = 'active'
    and customer.status = 'active'
  for update of card;

  if card_record.id is null then
    raise exception 'The loyalty card is not active.' using errcode = 'P0002';
  end if;

  if card_record.expires_at is not null and card_record.expires_at <= now() then
    update public.loyalty_cards card
    set status = 'expired', deactivated_at = now(), deactivation_reason = 'Card expired.'
    where card.id = card_record.id
      and card.organization_id = target_organization_id;
    raise exception 'The loyalty card has expired.' using errcode = '23514';
  end if;

  if card_record.stamp_count >= card_record.stamp_target then
    raise exception 'This loyalty card already has a reward ready to claim.' using errcode = '23514';
  end if;

  if target_sale_id is not null then
    perform 1
    from public.sales sale
    where sale.id = target_sale_id
      and sale.organization_id = target_organization_id
      and sale.customer_id = card_record.customer_id
      and sale.status = 'completed'
    for key share;
    if not found then
      raise exception 'The completed sale does not belong to this loyalty-card customer.' using errcode = 'P0002';
    end if;
  end if;

  select shift.store_id, shift.register_id
  into resolved_store_id, resolved_register_id
  from public.shifts shift
  where shift.organization_id = target_organization_id
    and shift.opened_by_employee_id = actor_employee_id
    and shift.status = 'open'
  order by shift.opened_at desc
  limit 1;

  update public.loyalty_cards card
  set stamp_count = card.stamp_count + 1
  where card.id = card_record.id
    and card.organization_id = target_organization_id
  returning * into card_record;

  insert into public.loyalty_card_events (
    organization_id, loyalty_card_id, customer_id, event_type,
    stamp_count_before, stamp_delta, stamp_count_after,
    actor_employee_id, store_id, register_id, sale_id, idempotency_key, reason
  )
  values (
    target_organization_id, card_record.id, card_record.customer_id, 'STAMP_ADDED',
    card_record.stamp_count - 1, 1, card_record.stamp_count,
    actor_employee_id, resolved_store_id, resolved_register_id, target_sale_id, target_idempotency_key,
    coalesce(normalized_reason, 'Completed sale stamp.')
  );

  perform private.write_audit_log(
    target_organization_id,
    'LOYALTY_CARD_STAMP_ADDED',
    'loyalty.card.stamp',
    actor_employee_id,
    null,
    resolved_store_id,
    resolved_register_id,
    null,
    null,
    coalesce(normalized_reason, 'Completed sale stamp.'),
    jsonb_build_object(
      'loyalty_card_id', card_record.id,
      'customer_id', card_record.customer_id,
      'sale_id', target_sale_id,
      'stamp_count_before', card_record.stamp_count - 1,
      'stamp_count_after', card_record.stamp_count
    )
  );

  return query select card_record.id, card_record.stamp_count, card_record.stamp_target, card_record.status, false;
end;
$$;

create function public.claim_loyalty_card_reward(
  target_organization_id uuid,
  target_loyalty_card_id uuid,
  target_reason text,
  target_sale_id uuid default null,
  target_idempotency_key uuid default null
)
returns table (
  card_id uuid,
  status text,
  was_replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  normalized_reason text := btrim(coalesce(target_reason, ''));
  card_record public.loyalty_cards%rowtype;
  previous_event public.loyalty_card_events%rowtype;
  resolved_store_id uuid;
  resolved_register_id uuid;
begin
  if (select auth.uid()) is null
    or not (
      (select private.has_permission(target_organization_id, 'customers.manage'))
      or (select private.has_permission(target_organization_id, 'sales.create'))
    ) then
    raise exception 'Sales or customer management permission is required to claim this reward.' using errcode = '42501';
  end if;

  if target_idempotency_key is null
    or char_length(normalized_reason) not between 2 and 500 then
    raise exception 'Provide an action key and a claim reason between 2 and 500 characters.' using errcode = '23514';
  end if;

  select private.current_employee_id(target_organization_id)
  into actor_employee_id;
  if actor_employee_id is null then
    raise exception 'An active employee is required to claim a loyalty reward.' using errcode = '42501';
  end if;

  select event.*
  into previous_event
  from public.loyalty_card_events event
  where event.organization_id = target_organization_id
    and event.idempotency_key = target_idempotency_key
  for key share;

  if previous_event.id is not null then
    if previous_event.event_type <> 'REWARD_CLAIMED'
      or previous_event.loyalty_card_id <> target_loyalty_card_id then
      raise exception 'This loyalty action key is already in use.' using errcode = '23505';
    end if;

    select card.*
    into card_record
    from public.loyalty_cards card
    where card.id = target_loyalty_card_id
      and card.organization_id = target_organization_id;

    return query select card_record.id, card_record.status, true;
    return;
  end if;

  select card.*
  into card_record
  from public.loyalty_cards card
  join public.customers customer
    on customer.id = card.customer_id
   and customer.organization_id = card.organization_id
  where card.id = target_loyalty_card_id
    and card.organization_id = target_organization_id
    and card.status = 'active'
    and customer.status = 'active'
    and (card.expires_at is null or card.expires_at > now())
  for update of card;

  if card_record.id is null then
    raise exception 'The loyalty card is not active.' using errcode = 'P0002';
  end if;

  if card_record.stamp_count < card_record.stamp_target then
    raise exception 'This loyalty card has not reached its reward target.' using errcode = '23514';
  end if;

  if target_sale_id is not null then
    perform 1
    from public.sales sale
    where sale.id = target_sale_id
      and sale.organization_id = target_organization_id
      and sale.customer_id = card_record.customer_id
      and sale.status = 'completed'
    for key share;
    if not found then
      raise exception 'The completed sale does not belong to this loyalty-card customer.' using errcode = 'P0002';
    end if;
  end if;

  select shift.store_id, shift.register_id
  into resolved_store_id, resolved_register_id
  from public.shifts shift
  where shift.organization_id = target_organization_id
    and shift.opened_by_employee_id = actor_employee_id
    and shift.status = 'open'
  order by shift.opened_at desc
  limit 1;

  update public.loyalty_cards card
  set
    status = 'reward_claimed',
    deactivated_at = now(),
    deactivation_reason = normalized_reason
  where card.id = card_record.id
    and card.organization_id = target_organization_id
  returning * into card_record;

  insert into public.loyalty_card_events (
    organization_id, loyalty_card_id, customer_id, event_type,
    stamp_count_before, stamp_delta, stamp_count_after,
    actor_employee_id, store_id, register_id, sale_id, idempotency_key, reason
  )
  values (
    target_organization_id, card_record.id, card_record.customer_id, 'REWARD_CLAIMED',
    card_record.stamp_count, 0, card_record.stamp_count,
    actor_employee_id, resolved_store_id, resolved_register_id, target_sale_id, target_idempotency_key,
    normalized_reason
  );

  perform private.write_audit_log(
    target_organization_id,
    'LOYALTY_CARD_REWARD_CLAIMED',
    'loyalty.card.claim_reward',
    actor_employee_id,
    null,
    resolved_store_id,
    resolved_register_id,
    null,
    null,
    normalized_reason,
    jsonb_build_object(
      'loyalty_card_id', card_record.id,
      'customer_id', card_record.customer_id,
      'sale_id', target_sale_id,
      'stamp_count', card_record.stamp_count
    )
  );

  return query select card_record.id, card_record.status, false;
end;
$$;

create function public.verify_loyalty_card_qr(
  target_loyalty_card_id uuid,
  target_verification_token text
)
returns table (
  verification_status text,
  card_code text,
  stamp_count integer,
  stamp_target integer,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  card_record public.loyalty_cards%rowtype;
begin
  if target_verification_token !~ '^[a-f0-9]{64}$' then
    return query select 'invalid'::text, null::text, null::integer, null::integer, null::timestamptz;
    return;
  end if;

  select card.*
  into card_record
  from public.loyalty_cards card
  join public.customers customer
    on customer.id = card.customer_id
   and customer.organization_id = card.organization_id
  where card.id = target_loyalty_card_id
    and card.verification_token_hash = extensions.digest(target_verification_token, 'sha256')
    and customer.status = 'active';

  if card_record.id is null then
    return query select 'invalid'::text, null::text, null::integer, null::integer, null::timestamptz;
    return;
  end if;

  return query
  select
    case
      when card_record.expires_at is not null and card_record.expires_at <= now() then 'expired'
      when card_record.status = 'active' then 'valid'
      else card_record.status
    end,
    card_record.card_code,
    card_record.stamp_count,
    card_record.stamp_target,
    card_record.expires_at;
end;
$$;

revoke execute on function
  public.get_customer_loyalty_cards(uuid, uuid),
  public.get_customer_loyalty_card_events(uuid, uuid),
  public.issue_loyalty_card(uuid, uuid, text, text, uuid, text),
  public.rotate_loyalty_card_qr(uuid, uuid, text, text),
  public.revoke_loyalty_card(uuid, uuid, text),
  public.add_loyalty_card_stamp(uuid, uuid, text, uuid, uuid),
  public.claim_loyalty_card_reward(uuid, uuid, text, uuid, uuid),
  public.verify_loyalty_card_qr(uuid, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.get_customer_loyalty_cards(uuid, uuid),
  public.get_customer_loyalty_card_events(uuid, uuid),
  public.issue_loyalty_card(uuid, uuid, text, text, uuid, text),
  public.rotate_loyalty_card_qr(uuid, uuid, text, text),
  public.revoke_loyalty_card(uuid, uuid, text),
  public.add_loyalty_card_stamp(uuid, uuid, text, uuid, uuid),
  public.claim_loyalty_card_reward(uuid, uuid, text, uuid, uuid)
to authenticated;

grant execute on function public.verify_loyalty_card_qr(uuid, text)
to anon, authenticated;

comment on table public.loyalty_cards is
'QR loyalty stamp cards. QR payloads contain only a card UUID and a rotating opaque secret; stamps stay server-side.';
comment on table public.loyalty_card_events is
'Append-only audit trail for QR-card issue, stamp, reward, revocation, replacement, and QR rotation actions.';

commit;
