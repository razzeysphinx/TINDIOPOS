-- Correct the Improvement 6 email validation pattern without rewriting the
-- applied receipt-delivery migration. PostgreSQL regex string escaping differs
-- from JavaScript escaping, so use explicit mailbox-shape checks instead.

begin;

create or replace function private.valid_receipt_email(target_email text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select target_email is not null
    and char_length(target_email) between 3 and 320
    and position('@' in target_email) > 1
    and position('@' in reverse(target_email)) = 1
    and position('.' in split_part(target_email, '@', 2)) > 1
    and target_email !~ '[[:space:]]'
$$;

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
    or (normalized_business_email is not null and not private.valid_receipt_email(normalized_business_email))
    or (normalized_business_tax_id is not null and char_length(normalized_business_tax_id) not between 2 and 80)
    or (normalized_business_website is not null and char_length(normalized_business_website) not between 3 and 2048)
    or (normalized_header_message is not null and char_length(normalized_header_message) not between 2 and 160)
    or char_length(normalized_footer_message) not between 2 and 240
    or target_paper_width_mm not in (58, 80) then
    raise exception 'Check the receipt business information and layout values.' using errcode = '23514';
  end if;

  insert into public.receipt_settings (
    organization_id, business_name, business_address, business_phone, business_email,
    business_tax_id, business_website, header_message, footer_message, paper_width_mm,
    show_store_address, show_store_phone, show_cashier, show_register, show_payment_details
  )
  values (
    target_organization_id, normalized_business_name, normalized_business_address,
    normalized_business_phone, normalized_business_email, normalized_business_tax_id,
    normalized_business_website, normalized_header_message, normalized_footer_message,
    target_paper_width_mm, target_show_store_address, target_show_store_phone,
    target_show_cashier, target_show_register, target_show_payment_details
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
    or not private.valid_receipt_email(normalized_recipient) then
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
    select 1 from public.receipts receipt
    where receipt.id = target_receipt_id and receipt.organization_id = target_organization_id
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
    organization_id, receipt_id, requested_by_employee_id, idempotency_key,
    delivery_channel, recipient
  )
  values (
    target_organization_id, target_receipt_id, actor_employee_id,
    target_idempotency_key, normalized_channel, normalized_recipient
  )
  returning id into new_delivery_id;

  return query select new_delivery_id, 'QUEUED'::text, false;
end;
$$;

revoke execute on function private.valid_receipt_email(text) from public, anon, authenticated, service_role;
revoke execute on function public.update_receipt_settings(uuid, text, text, text, text, text, text, text, text, smallint, boolean, boolean, boolean, boolean, boolean), public.queue_receipt_delivery(uuid, uuid, text, text, uuid) from public, anon, service_role;
grant execute on function public.update_receipt_settings(uuid, text, text, text, text, text, text, text, text, smallint, boolean, boolean, boolean, boolean, boolean), public.queue_receipt_delivery(uuid, uuid, text, text, uuid) to authenticated;

commit;
