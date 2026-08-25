-- TINDIO Improvement 6: immutable receipt presentation, digital delivery
-- requests, and auditable return-plus-new-sale exchanges.
--
-- Completed sales, receipts, refunds, payments, and inventory movements stay
-- immutable. This migration only adds settings snapshots and relationship
-- records around those completed transactions.

begin;

create table public.receipt_settings (
  organization_id uuid primary key references public.organizations (id) on delete restrict,
  business_name text not null,
  business_address text,
  business_phone text,
  business_email text,
  business_tax_id text,
  business_website text,
  header_message text,
  footer_message text not null default 'Thank you for shopping with us.',
  paper_width_mm smallint not null default 80,
  show_store_address boolean not null default true,
  show_store_phone boolean not null default true,
  show_cashier boolean not null default true,
  show_register boolean not null default true,
  show_payment_details boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint receipt_settings_business_name_length check (char_length(btrim(business_name)) between 2 and 160),
  constraint receipt_settings_business_address_length check (business_address is null or char_length(btrim(business_address)) between 2 and 500),
  constraint receipt_settings_business_phone_length check (business_phone is null or char_length(btrim(business_phone)) between 2 and 40),
  constraint receipt_settings_business_email_length check (business_email is null or char_length(btrim(business_email)) between 3 and 320),
  constraint receipt_settings_business_tax_id_length check (business_tax_id is null or char_length(btrim(business_tax_id)) between 2 and 80),
  constraint receipt_settings_business_website_length check (business_website is null or char_length(btrim(business_website)) between 3 and 2048),
  constraint receipt_settings_header_message_length check (header_message is null or char_length(btrim(header_message)) between 2 and 160),
  constraint receipt_settings_footer_message_length check (char_length(btrim(footer_message)) between 2 and 240),
  constraint receipt_settings_paper_width_values check (paper_width_mm in (58, 80))
);

insert into public.receipt_settings (organization_id, business_name)
select organization.id, organization.name
from public.organizations organization
on conflict (organization_id) do nothing;

create or replace function private.seed_receipt_settings_for_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.receipt_settings (organization_id, business_name)
  values (new.id, new.name)
  on conflict (organization_id) do nothing;
  return new;
end;
$$;

drop trigger if exists organizations_seed_receipt_settings on public.organizations;
create trigger organizations_seed_receipt_settings
after insert on public.organizations
for each row execute function private.seed_receipt_settings_for_organization();

alter table public.receipts
  add column receipt_layout_snapshot jsonb;

alter table public.receipts
  add constraint receipts_layout_snapshot_object check (
    receipt_layout_snapshot is null or jsonb_typeof(receipt_layout_snapshot) = 'object'
  );

alter table public.receipts
  add constraint receipts_id_organization_unique unique (id, organization_id);

create or replace function private.capture_receipt_layout_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings_record public.receipt_settings%rowtype;
  sale_record public.sales%rowtype;
  store_record public.stores%rowtype;
begin
  if new.receipt_layout_snapshot is not null then
    return new;
  end if;

  select settings.*
  into settings_record
  from public.receipt_settings settings
  where settings.organization_id = new.organization_id;

  select sale.*
  into sale_record
  from public.sales sale
  where sale.id = new.sale_id
    and sale.organization_id = new.organization_id;

  if sale_record.id is null then
    raise exception 'A receipt must belong to an existing sale.' using errcode = '23514';
  end if;

  select store.*
  into store_record
  from public.stores store
  where store.id = sale_record.store_id
    and store.organization_id = new.organization_id;

  if settings_record.organization_id is null then
    raise exception 'Receipt settings are missing for this organization.' using errcode = '23514';
  end if;

  new.receipt_layout_snapshot := jsonb_strip_nulls(jsonb_build_object(
    'version', 1,
    'paper_width_mm', settings_record.paper_width_mm,
    'business_name', settings_record.business_name,
    'business_address', settings_record.business_address,
    'business_phone', settings_record.business_phone,
    'business_email', settings_record.business_email,
    'business_tax_id', settings_record.business_tax_id,
    'business_website', settings_record.business_website,
    'header_message', settings_record.header_message,
    'footer_message', settings_record.footer_message,
    'show_store_address', settings_record.show_store_address,
    'show_store_phone', settings_record.show_store_phone,
    'show_cashier', settings_record.show_cashier,
    'show_register', settings_record.show_register,
    'show_payment_details', settings_record.show_payment_details,
    'store_name', sale_record.store_name_snapshot,
    'store_address', store_record.address,
    'store_phone', store_record.phone
  ));

  return new;
end;
$$;

drop trigger if exists receipts_capture_layout_snapshot on public.receipts;
create trigger receipts_capture_layout_snapshot
before insert on public.receipts
for each row execute function private.capture_receipt_layout_snapshot();

alter table public.receipt_settings enable row level security;

revoke all on table public.receipt_settings from public, anon, authenticated, service_role;
grant select on table public.receipt_settings to authenticated;

create policy receipt_settings_select_settings_manager
on public.receipt_settings
for select
to authenticated
using ((select private.has_permission(organization_id, 'settings.manage')));

create or replace function public.update_receipt_settings(
  target_organization_id uuid,
  target_business_name text,
  target_business_address text,
  target_business_phone text,
  target_business_email text,
  target_business_tax_id text,
  target_business_website text,
  target_header_message text,
  target_footer_message text,
  target_paper_width_mm smallint,
  target_show_store_address boolean,
  target_show_store_phone boolean,
  target_show_cashier boolean,
  target_show_register boolean,
  target_show_payment_details boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_business_name text;
  normalized_business_address text;
  normalized_business_phone text;
  normalized_business_email text;
  normalized_business_tax_id text;
  normalized_business_website text;
  normalized_header_message text;
  normalized_footer_message text;
begin
  if target_organization_id is null
    or (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'settings.manage')) then
    raise exception 'Settings permission is required.' using errcode = '42501';
  end if;

  normalized_business_name := trim(coalesce(target_business_name, ''));
  normalized_business_address := nullif(trim(coalesce(target_business_address, '')), '');
  normalized_business_phone := nullif(trim(coalesce(target_business_phone, '')), '');
  normalized_business_email := nullif(lower(trim(coalesce(target_business_email, ''))), '');
  normalized_business_tax_id := nullif(trim(coalesce(target_business_tax_id, '')), '');
  normalized_business_website := nullif(trim(coalesce(target_business_website, '')), '');
  normalized_header_message := nullif(trim(coalesce(target_header_message, '')), '');
  normalized_footer_message := trim(coalesce(target_footer_message, ''));

  if char_length(normalized_business_name) not between 2 and 160
    or (normalized_business_address is not null and char_length(normalized_business_address) not between 2 and 500)
    or (normalized_business_phone is not null and char_length(normalized_business_phone) not between 2 and 40)
    or (normalized_business_email is not null and (char_length(normalized_business_email) not between 3 and 320 or normalized_business_email !~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'))
    or (normalized_business_tax_id is not null and char_length(normalized_business_tax_id) not between 2 and 80)
    or (normalized_business_website is not null and char_length(normalized_business_website) not between 3 and 2048)
    or (normalized_header_message is not null and char_length(normalized_header_message) not between 2 and 160)
    or char_length(normalized_footer_message) not between 2 and 240
    or target_paper_width_mm not in (58, 80) then
    raise exception 'Check the receipt business information and layout values.' using errcode = '23514';
  end if;

  insert into public.receipt_settings (
    organization_id,
    business_name,
    business_address,
    business_phone,
    business_email,
    business_tax_id,
    business_website,
    header_message,
    footer_message,
    paper_width_mm,
    show_store_address,
    show_store_phone,
    show_cashier,
    show_register,
    show_payment_details
  )
  values (
    target_organization_id,
    normalized_business_name,
    normalized_business_address,
    normalized_business_phone,
    normalized_business_email,
    normalized_business_tax_id,
    normalized_business_website,
    normalized_header_message,
    normalized_footer_message,
    target_paper_width_mm,
    target_show_store_address,
    target_show_store_phone,
    target_show_cashier,
    target_show_register,
    target_show_payment_details
  )
  on conflict (organization_id) do update
  set
    business_name = excluded.business_name,
    business_address = excluded.business_address,
    business_phone = excluded.business_phone,
    business_email = excluded.business_email,
    business_tax_id = excluded.business_tax_id,
    business_website = excluded.business_website,
    header_message = excluded.header_message,
    footer_message = excluded.footer_message,
    paper_width_mm = excluded.paper_width_mm,
    show_store_address = excluded.show_store_address,
    show_store_phone = excluded.show_store_phone,
    show_cashier = excluded.show_cashier,
    show_register = excluded.show_register,
    show_payment_details = excluded.show_payment_details,
    updated_at = now();

  return true;
end;
$$;

create table public.receipt_delivery_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  receipt_id uuid not null,
  requested_by_employee_id uuid not null,
  idempotency_key uuid not null,
  delivery_channel text not null,
  recipient text not null,
  status text not null default 'QUEUED',
  provider_message_id text,
  delivered_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  constraint receipt_delivery_requests_receipt_organization_fkey
    foreign key (receipt_id, organization_id)
    references public.receipts (id, organization_id)
    on delete restrict,
  constraint receipt_delivery_requests_employee_organization_fkey
    foreign key (requested_by_employee_id, organization_id)
    references public.employees (id, organization_id)
    on delete restrict,
  constraint receipt_delivery_requests_organization_key_unique unique (organization_id, idempotency_key),
  constraint receipt_delivery_requests_channel_values check (delivery_channel in ('EMAIL')),
  constraint receipt_delivery_requests_status_values check (status in ('QUEUED', 'DELIVERED', 'FAILED', 'CANCELLED')),
  constraint receipt_delivery_requests_recipient_length check (char_length(btrim(recipient)) between 3 and 320),
  constraint receipt_delivery_requests_provider_id_length check (provider_message_id is null or char_length(btrim(provider_message_id)) between 1 and 320),
  constraint receipt_delivery_requests_failure_reason_length check (failure_reason is null or char_length(btrim(failure_reason)) between 2 and 500),
  constraint receipt_delivery_requests_status_timestamps check (
    (status = 'QUEUED' and delivered_at is null and failed_at is null)
    or (status = 'DELIVERED' and delivered_at is not null and failed_at is null)
    or (status in ('FAILED', 'CANCELLED') and failed_at is not null)
  )
);

create index receipt_delivery_requests_receipt_created_idx
  on public.receipt_delivery_requests (organization_id, receipt_id, created_at desc);

alter table public.receipt_delivery_requests enable row level security;

revoke all on table public.receipt_delivery_requests from public, anon, authenticated, service_role;
grant select on table public.receipt_delivery_requests to authenticated;

create policy receipt_delivery_requests_select_reprint_authorized
on public.receipt_delivery_requests
for select
to authenticated
using ((select private.has_permission(organization_id, 'receipts.reprint')));

create or replace function public.queue_receipt_delivery(
  target_organization_id uuid,
  target_receipt_id uuid,
  target_delivery_channel text,
  target_recipient text,
  target_idempotency_key uuid
)
returns table (
  delivery_request_id uuid,
  delivery_status text,
  was_replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  normalized_channel text;
  normalized_recipient text;
  canonical_payload jsonb;
  existing_actor_employee_id uuid;
  existing_payload jsonb;
  existing_delivery_id uuid;
  existing_status text;
  new_delivery_id uuid;
begin
  if target_organization_id is null
    or target_receipt_id is null
    or target_idempotency_key is null
    or (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'receipts.reprint')) then
    raise exception 'Receipt reprint permission is required.' using errcode = '42501';
  end if;

  normalized_channel := upper(trim(coalesce(target_delivery_channel, '')));
  normalized_recipient := lower(trim(coalesce(target_recipient, '')));
  if normalized_channel <> 'EMAIL'
    or char_length(normalized_recipient) not between 3 and 320
    or normalized_recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address for this digital receipt.' using errcode = '23514';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active'
  order by employee.created_at
  limit 1;

  if actor_employee_id is null then
    raise exception 'An active employee record is required.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.receipts receipt
    where receipt.id = target_receipt_id
      and receipt.organization_id = target_organization_id
  ) then
    raise exception 'The receipt was not found.' using errcode = 'P0002';
  end if;

  canonical_payload := jsonb_build_object(
    'delivery_channel', normalized_channel,
    'recipient', normalized_recipient,
    'receipt_id', target_receipt_id
  );

  select
    request.requested_by_employee_id,
    jsonb_build_object(
      'delivery_channel', request.delivery_channel,
      'recipient', request.recipient,
      'receipt_id', request.receipt_id
    ),
    request.id,
    request.status
  into
    existing_actor_employee_id,
    existing_payload,
    existing_delivery_id,
    existing_status
  from public.receipt_delivery_requests request
  where request.organization_id = target_organization_id
    and request.idempotency_key = target_idempotency_key
  for update;

  if found then
    if existing_actor_employee_id is distinct from actor_employee_id
      or existing_payload is distinct from canonical_payload then
      raise exception 'This delivery key was already used for a different request.' using errcode = '23505';
    end if;

    return query select existing_delivery_id, existing_status, true;
    return;
  end if;

  insert into public.receipt_delivery_requests (
    organization_id,
    receipt_id,
    requested_by_employee_id,
    idempotency_key,
    delivery_channel,
    recipient
  )
  values (
    target_organization_id,
    target_receipt_id,
    actor_employee_id,
    target_idempotency_key,
    normalized_channel,
    normalized_recipient
  )
  returning id into new_delivery_id;

  return query select new_delivery_id, 'QUEUED'::text, false;
end;
$$;

create table public.sale_exchanges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  refund_id uuid not null,
  replacement_sale_id uuid not null,
  linked_by_employee_id uuid not null,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint sale_exchanges_refund_organization_fkey
    foreign key (refund_id, organization_id)
    references public.refunds (id, organization_id)
    on delete restrict,
  constraint sale_exchanges_replacement_sale_organization_fkey
    foreign key (replacement_sale_id, organization_id)
    references public.sales (id, organization_id)
    on delete restrict,
  constraint sale_exchanges_employee_organization_fkey
    foreign key (linked_by_employee_id, organization_id)
    references public.employees (id, organization_id)
    on delete restrict,
  constraint sale_exchanges_organization_refund_unique unique (organization_id, refund_id),
  constraint sale_exchanges_organization_replacement_sale_unique unique (organization_id, replacement_sale_id),
  constraint sale_exchanges_organization_key_unique unique (organization_id, idempotency_key)
);

create index sale_exchanges_organization_created_idx
  on public.sale_exchanges (organization_id, created_at desc);

alter table public.sale_exchanges enable row level security;

revoke all on table public.sale_exchanges from public, anon, authenticated, service_role;
grant select on table public.sale_exchanges to authenticated;

create policy sale_exchanges_select_receipts_authorized
on public.sale_exchanges
for select
to authenticated
using ((select private.has_permission(organization_id, 'receipts.view')));

create or replace function public.link_sale_exchange(
  target_organization_id uuid,
  target_refund_id uuid,
  target_replacement_receipt_number bigint,
  target_idempotency_key uuid
)
returns table (
  exchange_id uuid,
  replacement_sale_id uuid,
  replacement_receipt_number bigint,
  was_replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  refund_record public.refunds%rowtype;
  replacement_sale_record public.sales%rowtype;
  original_sale_id uuid;
  canonical_payload jsonb;
  existing_actor_employee_id uuid;
  existing_payload jsonb;
  existing_exchange_id uuid;
  existing_replacement_sale_id uuid;
  existing_replacement_receipt_number bigint;
  new_exchange_id uuid;
begin
  if target_organization_id is null
    or target_refund_id is null
    or target_replacement_receipt_number is null
    or target_replacement_receipt_number <= 0
    or target_idempotency_key is null
    or (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'sales.refund'))
    or not (select private.has_permission(target_organization_id, 'sales.create')) then
    raise exception 'Sales and refund permission are required to record an exchange.' using errcode = '42501';
  end if;

  select employee.id
  into actor_employee_id
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active'
  order by employee.created_at
  limit 1;

  if actor_employee_id is null then
    raise exception 'An active employee record is required.' using errcode = '42501';
  end if;

  canonical_payload := jsonb_build_object(
    'refund_id', target_refund_id,
    'replacement_receipt_number', target_replacement_receipt_number
  );

  select
    exchange.linked_by_employee_id,
    jsonb_build_object(
      'refund_id', exchange.refund_id,
      'replacement_receipt_number', receipt.receipt_number
    ),
    exchange.id,
    exchange.replacement_sale_id,
    receipt.receipt_number
  into
    existing_actor_employee_id,
    existing_payload,
    existing_exchange_id,
    existing_replacement_sale_id,
    existing_replacement_receipt_number
  from public.sale_exchanges exchange
  join public.receipts receipt
    on receipt.sale_id = exchange.replacement_sale_id
   and receipt.organization_id = exchange.organization_id
  where exchange.organization_id = target_organization_id
    and exchange.idempotency_key = target_idempotency_key
  for update of exchange;

  if found then
    if existing_actor_employee_id is distinct from actor_employee_id
      or existing_payload is distinct from canonical_payload then
      raise exception 'This exchange key was already used for a different request.' using errcode = '23505';
    end if;

    return query select existing_exchange_id, existing_replacement_sale_id, existing_replacement_receipt_number, true;
    return;
  end if;

  select refund.*
  into refund_record
  from public.refunds refund
  where refund.id = target_refund_id
    and refund.organization_id = target_organization_id
    and refund.status = 'completed'
  for key share;

  if refund_record.id is null then
    raise exception 'The completed return was not found.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.employee_stores employee_store
    where employee_store.organization_id = target_organization_id
      and employee_store.employee_id = actor_employee_id
      and employee_store.store_id = refund_record.store_id
  ) then
    raise exception 'An assignment to the return store is required.' using errcode = '42501';
  end if;

  select sale.*
  into replacement_sale_record
  from public.receipts receipt
  join public.sales sale
    on sale.id = receipt.sale_id
   and sale.organization_id = receipt.organization_id
  where receipt.organization_id = target_organization_id
    and receipt.receipt_number = target_replacement_receipt_number
    and sale.status = 'completed'
  for key share of sale;

  if replacement_sale_record.id is null then
    raise exception 'The replacement receipt was not found.' using errcode = 'P0002';
  end if;

  original_sale_id := refund_record.sale_id;
  if replacement_sale_record.id = original_sale_id then
    raise exception 'A return cannot be exchanged against its original sale.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.sale_exchanges exchange
    where exchange.organization_id = target_organization_id
      and (exchange.refund_id = target_refund_id or exchange.replacement_sale_id = replacement_sale_record.id)
  ) then
    raise exception 'That return or replacement sale is already linked to an exchange.' using errcode = '23505';
  end if;

  insert into public.sale_exchanges (
    organization_id,
    refund_id,
    replacement_sale_id,
    linked_by_employee_id,
    idempotency_key
  )
  values (
    target_organization_id,
    target_refund_id,
    replacement_sale_record.id,
    actor_employee_id,
    target_idempotency_key
  )
  returning id into new_exchange_id;

  return query select new_exchange_id, replacement_sale_record.id, target_replacement_receipt_number, false;
end;
$$;

create or replace function private.audit_receipt_delivery_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sale_record public.sales%rowtype;
begin
  select sale.*
  into sale_record
  from public.receipts receipt
  join public.sales sale
    on sale.id = receipt.sale_id
   and sale.organization_id = receipt.organization_id
  where receipt.id = new.receipt_id
    and receipt.organization_id = new.organization_id;

  perform private.write_audit_log(
    new.organization_id,
    'RECEIPT_DELIVERY_QUEUED',
    'receipts.reprint',
    new.requested_by_employee_id,
    null,
    sale_record.store_id,
    sale_record.register_id,
    null,
    null,
    null,
    jsonb_build_object(
      'delivery_request_id', new.id,
      'receipt_id', new.receipt_id,
      'delivery_channel', new.delivery_channel,
      'recipient', new.recipient
    )
  );
  return new;
end;
$$;

create or replace function private.audit_sale_exchange_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  refund_record public.refunds%rowtype;
  replacement_receipt_number bigint;
begin
  select refund.*
  into refund_record
  from public.refunds refund
  where refund.id = new.refund_id
    and refund.organization_id = new.organization_id;

  select receipt.receipt_number
  into replacement_receipt_number
  from public.receipts receipt
  where receipt.sale_id = new.replacement_sale_id
    and receipt.organization_id = new.organization_id;

  perform private.write_audit_log(
    new.organization_id,
    'SALE_EXCHANGE_LINKED',
    'sales.refund',
    new.linked_by_employee_id,
    null,
    refund_record.store_id,
    refund_record.register_id,
    null,
    refund_record.total_minor,
    refund_record.reason,
    jsonb_build_object(
      'exchange_id', new.id,
      'refund_id', new.refund_id,
      'replacement_sale_id', new.replacement_sale_id,
      'replacement_receipt_number', replacement_receipt_number
    )
  );
  return new;
end;
$$;

drop trigger if exists receipt_delivery_requests_audit_log on public.receipt_delivery_requests;
create trigger receipt_delivery_requests_audit_log
after insert on public.receipt_delivery_requests
for each row execute function private.audit_receipt_delivery_request();

drop trigger if exists sale_exchanges_audit_log on public.sale_exchanges;
create trigger sale_exchanges_audit_log
after insert on public.sale_exchanges
for each row execute function private.audit_sale_exchange_link();

revoke execute on function private.seed_receipt_settings_for_organization(), private.capture_receipt_layout_snapshot(), private.audit_receipt_delivery_request(), private.audit_sale_exchange_link() from public, anon, authenticated, service_role;
revoke execute on function public.update_receipt_settings(uuid, text, text, text, text, text, text, text, text, smallint, boolean, boolean, boolean, boolean, boolean), public.queue_receipt_delivery(uuid, uuid, text, text, uuid), public.link_sale_exchange(uuid, uuid, bigint, uuid) from public, anon, service_role;
grant execute on function public.update_receipt_settings(uuid, text, text, text, text, text, text, text, text, smallint, boolean, boolean, boolean, boolean, boolean), public.queue_receipt_delivery(uuid, uuid, text, text, uuid), public.link_sale_exchange(uuid, uuid, bigint, uuid) to authenticated;

comment on table public.receipt_settings
is 'Organization receipt configuration. New receipts snapshot it at issuance so changing settings never rewrites a historical receipt.';
comment on column public.receipts.receipt_layout_snapshot
is 'Immutable business-information and layout snapshot captured at receipt issuance. Existing receipts intentionally retain null and use their legacy rendering fallback.';
comment on table public.receipt_delivery_requests
is 'Immutable digital-receipt outbox records. A delivery provider can later process QUEUED records without changing the receipt.';
comment on table public.sale_exchanges
is 'Auditable link between one completed return and one separate completed replacement sale. Neither source transaction is edited.';

commit;
