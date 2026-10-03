begin;

-- A new ticket is a complete operation. Return after its insert instead of
-- falling into the update branch (which attempts to update a null ticket id).
create or replace function private.save_open_ticket(
  target_organization_id uuid,
  target_store_id uuid,
  target_register_id uuid,
  target_ticket_id uuid,
  target_customer_id uuid,
  target_dining_option_id uuid,
  target_label text,
  target_note text,
  target_cart jsonb
)
returns table (ticket_id uuid, created_at timestamptz, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  normalized_label text := nullif(btrim(target_label), '');
  normalized_note text := nullif(btrim(target_note), '');
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'sales.create')) then
    raise exception 'Sales permission is required.' using errcode = '42501';
  end if;

  if normalized_label is null or char_length(normalized_label) > 100
    or (normalized_note is not null and char_length(normalized_note) > 500) then
    raise exception 'Enter a ticket label up to 100 characters and an optional note up to 500 characters.' using errcode = '23514';
  end if;

  actor_employee_id := private.require_active_pos_shift(
    target_organization_id,
    target_store_id,
    target_register_id
  );

  perform private.validate_advanced_cart(target_organization_id, target_store_id, target_cart);

  if target_customer_id is not null and not exists (
    select 1
    from public.customers customer
    where customer.id = target_customer_id
      and customer.organization_id = target_organization_id
      and customer.status = 'active'
  ) then
    raise exception 'The selected customer is not active in this organization.' using errcode = '23514';
  end if;

  if target_dining_option_id is not null and not exists (
    select 1
    from public.dining_options option
    where option.id = target_dining_option_id
      and option.organization_id = target_organization_id
      and option.is_active
  ) then
    raise exception 'The selected dining option is not active.' using errcode = '23514';
  end if;

  if target_ticket_id is null then
    return query
    insert into public.open_tickets (
      organization_id,
      store_id,
      register_id,
      opened_by_employee_id,
      customer_id,
      dining_option_id,
      label,
      note,
      cart
    )
    values (
      target_organization_id,
      target_store_id,
      target_register_id,
      actor_employee_id,
      target_customer_id,
      target_dining_option_id,
      normalized_label,
      normalized_note,
      target_cart
    )
    returning id, created_at, updated_at;
    return;
  end if;

  return query
  update public.open_tickets ticket
  set
    customer_id = target_customer_id,
    dining_option_id = target_dining_option_id,
    label = normalized_label,
    note = normalized_note,
    cart = target_cart
  where ticket.id = target_ticket_id
    and ticket.organization_id = target_organization_id
    and ticket.store_id = target_store_id
    and ticket.register_id = target_register_id
    and ticket.status = 'open'
  returning ticket.id, ticket.created_at, ticket.updated_at;

  if not found then
    raise exception 'This open ticket is no longer available.' using errcode = 'P0002';
  end if;
end;
$$;

comment on function private.save_open_ticket(uuid, uuid, uuid, uuid, uuid, uuid, text, text, jsonb)
is 'Creates or updates held tickets for the caller''s active register shift.';

notify pgrst, 'reload schema';

commit;
