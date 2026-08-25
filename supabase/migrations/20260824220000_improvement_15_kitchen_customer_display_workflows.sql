-- Improvement 15: station-aware kitchen execution and a richer paired customer
-- display. Kitchen records remain operational snapshots of the authoritative
-- completed sale; customer-display receipts are scoped to the paired display's
-- current completed sale capability.
begin;

create table public.kitchen_station_category_routes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  category_id uuid not null,
  station text not null,
  updated_by_employee_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kitchen_station_category_routes_id_organization_unique unique (id, organization_id),
  constraint kitchen_station_category_routes_category_organization_fkey
    foreign key (category_id, organization_id)
    references public.categories (id, organization_id) on delete restrict,
  constraint kitchen_station_category_routes_employee_organization_fkey
    foreign key (updated_by_employee_id, organization_id)
    references public.employees (id, organization_id) on delete restrict,
  constraint kitchen_station_category_routes_unique unique (organization_id, category_id),
  constraint kitchen_station_category_routes_station_values
    check (station in ('KITCHEN', 'BAR', 'DESSERT'))
);

create index kitchen_station_category_routes_organization_station_idx
  on public.kitchen_station_category_routes (organization_id, station);

create trigger kitchen_station_category_routes_set_updated_at
before update on public.kitchen_station_category_routes
for each row execute function private.set_updated_at();

alter table public.kitchen_station_category_routes enable row level security;
revoke all on table public.kitchen_station_category_routes from public, anon, authenticated, service_role;

alter table public.kitchen_orders
  add column priority text not null default 'NORMAL';

alter table public.kitchen_orders
  add constraint kitchen_orders_priority_values check (priority in ('NORMAL', 'RUSH'));

alter table public.kitchen_order_items
  add column station text not null default 'KITCHEN',
  add column status text not null default 'NEW',
  add column started_at timestamptz,
  add column ready_at timestamptz,
  add column completed_at timestamptz;

-- Existing records pre-date line-level execution. Mirror their parent state so
-- old order history remains internally consistent after this extension.
update public.kitchen_order_items kitchen_item
set
  status = kitchen_order.status,
  started_at = kitchen_order.started_at,
  ready_at = kitchen_order.ready_at,
  completed_at = kitchen_order.completed_at
from public.kitchen_orders kitchen_order
where kitchen_order.id = kitchen_item.kitchen_order_id
  and kitchen_order.organization_id = kitchen_item.organization_id;

alter table public.kitchen_order_items
  add constraint kitchen_order_items_station_values check (station in ('KITCHEN', 'BAR', 'DESSERT')),
  add constraint kitchen_order_items_status_values check (status in ('NEW', 'PREPARING', 'READY', 'COMPLETED')),
  add constraint kitchen_order_items_status_timestamps check (
    (status = 'NEW' and started_at is null and ready_at is null and completed_at is null)
    or (status = 'PREPARING' and started_at is not null and ready_at is null and completed_at is null)
    or (status = 'READY' and started_at is not null and ready_at is not null and completed_at is null)
    or (status = 'COMPLETED' and started_at is not null and ready_at is not null and completed_at is not null)
  );

create index kitchen_order_items_station_queue_idx
  on public.kitchen_order_items (organization_id, station, status, created_at)
  where status in ('NEW', 'PREPARING', 'READY');

create or replace function private.default_kitchen_station_for_category(
  target_organization_id uuid,
  target_category_id uuid,
  target_category_name text
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select route.station
      from public.kitchen_station_category_routes route
      where route.organization_id = $1
        and route.category_id = $2
    ),
    case
      when lower(coalesce($3, '')) ~ '(bar|beverage|drink|coffee|cocktail)' then 'BAR'
      when lower(coalesce($3, '')) ~ '(dessert|cake|pastry|ice[ -]?cream)' then 'DESSERT'
      else 'KITCHEN'
    end
  );
$$;

create or replace function private.issue_kitchen_order_from_completed_sale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_order_id uuid;
  resolved_order_number bigint;
begin
  if new.dining_option_id is null or old.dining_option_id is not null then
    return new;
  end if;

  select receipt.receipt_number
  into resolved_order_number
  from public.receipts receipt
  where receipt.organization_id = new.organization_id
    and receipt.sale_id = new.id;

  if resolved_order_number is null then
    raise exception 'A completed dining sale must have a receipt before it can be sent to the kitchen.' using errcode = '23514';
  end if;

  insert into public.kitchen_orders (
    organization_id,
    store_id,
    register_id,
    sale_id,
    order_number,
    dining_option_name_snapshot,
    order_label,
    order_note
  )
  values (
    new.organization_id,
    new.store_id,
    new.register_id,
    new.id,
    resolved_order_number,
    new.dining_option_name_snapshot,
    coalesce(
      (
        select ticket.label
        from public.open_tickets ticket
        where ticket.organization_id = new.organization_id
          and ticket.id = new.open_ticket_id
      ),
      'Order #' || resolved_order_number::text
    ),
    (
      select ticket.note
      from public.open_tickets ticket
      where ticket.organization_id = new.organization_id
        and ticket.id = new.open_ticket_id
    )
  )
  returning id into resolved_order_id;

  insert into public.kitchen_order_items (
    organization_id,
    kitchen_order_id,
    sale_item_id,
    line_number,
    product_name_snapshot,
    variant_name_snapshot,
    modifiers_snapshot,
    quantity,
    station
  )
  select
    sale_item.organization_id,
    resolved_order_id,
    sale_item.id,
    row_number() over (order by sale_item.created_at, sale_item.id)::smallint,
    sale_item.product_name_snapshot,
    sale_item.variant_name_snapshot,
    sale_item.modifiers_snapshot,
    sale_item.quantity,
    private.default_kitchen_station_for_category(
      sale_item.organization_id,
      product.category_id,
      category.name
    )
  from public.sale_items sale_item
  join public.products product
    on product.id = sale_item.product_id
   and product.organization_id = sale_item.organization_id
  left join public.categories category
    on category.id = product.category_id
   and category.organization_id = product.organization_id
  where sale_item.organization_id = new.organization_id
    and sale_item.sale_id = new.id;

  if not found then
    raise exception 'A completed dining sale must have at least one line before it can be sent to the kitchen.' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop function public.get_kitchen_orders(uuid, uuid);
drop function private.get_kitchen_orders(uuid, uuid);

create function private.get_kitchen_orders(
  target_organization_id uuid,
  target_store_id uuid default null
)
returns table (
  kitchen_order_id uuid,
  store_id uuid,
  store_name text,
  order_number bigint,
  order_label text,
  order_note text,
  dining_option_name text,
  priority text,
  status text,
  created_at timestamptz,
  started_at timestamptz,
  ready_at timestamptz,
  completed_at timestamptz,
  items jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not (
      (select private.has_permission(target_organization_id, 'kitchen.view'))
      or (select private.has_permission(target_organization_id, 'kitchen.manage'))
    ) then
    raise exception 'Kitchen display access is required.' using errcode = '42501';
  end if;

  return query
  select
    kitchen_order.id,
    kitchen_order.store_id,
    store.name,
    kitchen_order.order_number,
    kitchen_order.order_label,
    kitchen_order.order_note,
    kitchen_order.dining_option_name_snapshot,
    kitchen_order.priority,
    kitchen_order.status,
    kitchen_order.created_at,
    kitchen_order.started_at,
    kitchen_order.ready_at,
    kitchen_order.completed_at,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', kitchen_item.id,
          'name', kitchen_item.product_name_snapshot,
          'variant_name', kitchen_item.variant_name_snapshot,
          'modifiers', kitchen_item.modifiers_snapshot,
          'quantity', kitchen_item.quantity,
          'station', kitchen_item.station,
          'status', kitchen_item.status,
          'started_at', kitchen_item.started_at,
          'ready_at', kitchen_item.ready_at,
          'completed_at', kitchen_item.completed_at
        ) order by kitchen_item.line_number
      ) filter (where kitchen_item.id is not null),
      '[]'::jsonb
    )
  from public.kitchen_orders kitchen_order
  join public.stores store
    on store.id = kitchen_order.store_id
   and store.organization_id = kitchen_order.organization_id
  left join public.kitchen_order_items kitchen_item
    on kitchen_item.kitchen_order_id = kitchen_order.id
   and kitchen_item.organization_id = kitchen_order.organization_id
  where kitchen_order.organization_id = target_organization_id
    and (target_store_id is null or kitchen_order.store_id = target_store_id)
    and (
      kitchen_order.status <> 'COMPLETED'
      or kitchen_order.completed_at >= now() - interval '4 hours'
    )
    and exists (
      select 1
      from public.employees employee
      join public.employee_stores employee_store
        on employee_store.employee_id = employee.id
       and employee_store.organization_id = employee.organization_id
      where employee.organization_id = target_organization_id
        and employee.profile_id = (select auth.uid())
        and employee.status = 'active'
        and employee_store.store_id = kitchen_order.store_id
    )
  group by
    kitchen_order.id,
    kitchen_order.store_id,
    store.name,
    kitchen_order.order_number,
    kitchen_order.order_label,
    kitchen_order.order_note,
    kitchen_order.dining_option_name_snapshot,
    kitchen_order.priority,
    kitchen_order.status,
    kitchen_order.created_at,
    kitchen_order.started_at,
    kitchen_order.ready_at,
    kitchen_order.completed_at
  order by
    case kitchen_order.priority when 'RUSH' then 0 else 1 end,
    case kitchen_order.status
      when 'NEW' then 1
      when 'PREPARING' then 2
      when 'READY' then 3
      else 4
    end,
    kitchen_order.created_at;
end;
$$;

create function public.get_kitchen_orders(
  target_organization_id uuid,
  target_store_id uuid default null
)
returns table (
  kitchen_order_id uuid,
  store_id uuid,
  store_name text,
  order_number bigint,
  order_label text,
  order_note text,
  dining_option_name text,
  priority text,
  status text,
  created_at timestamptz,
  started_at timestamptz,
  ready_at timestamptz,
  completed_at timestamptz,
  items jsonb
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.get_kitchen_orders($1, $2);
$$;

create or replace function private.update_kitchen_order_status(
  target_organization_id uuid,
  target_kitchen_order_id uuid,
  target_status text
)
returns table (status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
  resolved_store_id uuid;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'kitchen.manage')) then
    raise exception 'Kitchen order management access is required.' using errcode = '42501';
  end if;

  if target_status not in ('PREPARING', 'READY', 'COMPLETED') then
    raise exception 'Choose a valid next kitchen status.' using errcode = '22023';
  end if;

  select kitchen_order.status, kitchen_order.store_id
  into current_status, resolved_store_id
  from public.kitchen_orders kitchen_order
  where kitchen_order.id = target_kitchen_order_id
    and kitchen_order.organization_id = target_organization_id
  for update;

  if current_status is null then
    raise exception 'This kitchen order is no longer available.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.employees employee
    join public.employee_stores employee_store
      on employee_store.employee_id = employee.id
     and employee_store.organization_id = employee.organization_id
    where employee.organization_id = target_organization_id
      and employee.profile_id = (select auth.uid())
      and employee.status = 'active'
      and employee_store.store_id = resolved_store_id
  ) then
    raise exception 'You are not assigned to this kitchen order store.' using errcode = '42501';
  end if;

  if not (
    (current_status = 'NEW' and target_status = 'PREPARING')
    or (current_status = 'PREPARING' and target_status = 'READY')
    or (current_status = 'READY' and target_status = 'COMPLETED')
  ) then
    raise exception 'Kitchen orders must be advanced one status at a time.' using errcode = '23514';
  end if;

  update public.kitchen_order_items kitchen_item
  set
    status = target_status,
    started_at = case when target_status = 'PREPARING' then now() else kitchen_item.started_at end,
    ready_at = case when target_status = 'READY' then now() else kitchen_item.ready_at end,
    completed_at = case when target_status = 'COMPLETED' then now() else kitchen_item.completed_at end
  where kitchen_item.kitchen_order_id = target_kitchen_order_id
    and kitchen_item.organization_id = target_organization_id;

  return query
  update public.kitchen_orders kitchen_order
  set
    status = target_status,
    started_at = case when target_status = 'PREPARING' then now() else kitchen_order.started_at end,
    ready_at = case when target_status = 'READY' then now() else kitchen_order.ready_at end,
    completed_at = case when target_status = 'COMPLETED' then now() else kitchen_order.completed_at end
  where kitchen_order.id = target_kitchen_order_id
    and kitchen_order.organization_id = target_organization_id
  returning kitchen_order.status;
end;
$$;

create or replace function private.update_kitchen_order_item_status(
  target_organization_id uuid,
  target_kitchen_order_item_id uuid,
  target_status text
)
returns table (order_status text, item_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
  resolved_order_id uuid;
  resolved_store_id uuid;
  resolved_order_status text;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'kitchen.manage')) then
    raise exception 'Kitchen order management access is required.' using errcode = '42501';
  end if;

  if target_status not in ('PREPARING', 'READY', 'COMPLETED') then
    raise exception 'Choose a valid next kitchen item status.' using errcode = '22023';
  end if;

  select kitchen_item.status, kitchen_item.kitchen_order_id, kitchen_order.store_id
  into current_status, resolved_order_id, resolved_store_id
  from public.kitchen_order_items kitchen_item
  join public.kitchen_orders kitchen_order
    on kitchen_order.id = kitchen_item.kitchen_order_id
   and kitchen_order.organization_id = kitchen_item.organization_id
  where kitchen_item.id = target_kitchen_order_item_id
    and kitchen_item.organization_id = target_organization_id
  for update of kitchen_item, kitchen_order;

  if resolved_order_id is null then
    raise exception 'This kitchen item is no longer available.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.employees employee
    join public.employee_stores employee_store
      on employee_store.employee_id = employee.id
     and employee_store.organization_id = employee.organization_id
    where employee.organization_id = target_organization_id
      and employee.profile_id = (select auth.uid())
      and employee.status = 'active'
      and employee_store.store_id = resolved_store_id
  ) then
    raise exception 'You are not assigned to this kitchen order store.' using errcode = '42501';
  end if;

  if not (
    (current_status = 'NEW' and target_status = 'PREPARING')
    or (current_status = 'PREPARING' and target_status = 'READY')
    or (current_status = 'READY' and target_status = 'COMPLETED')
  ) then
    raise exception 'Kitchen items must be advanced one status at a time.' using errcode = '23514';
  end if;

  update public.kitchen_order_items kitchen_item
  set
    status = target_status,
    started_at = case when target_status = 'PREPARING' then now() else kitchen_item.started_at end,
    ready_at = case when target_status = 'READY' then now() else kitchen_item.ready_at end,
    completed_at = case when target_status = 'COMPLETED' then now() else kitchen_item.completed_at end
  where kitchen_item.id = target_kitchen_order_item_id
    and kitchen_item.organization_id = target_organization_id;

  select case
    when bool_and(kitchen_item.status = 'COMPLETED') then 'COMPLETED'
    when bool_and(kitchen_item.status in ('READY', 'COMPLETED')) then 'READY'
    when bool_or(kitchen_item.status in ('PREPARING', 'READY', 'COMPLETED')) then 'PREPARING'
    else 'NEW'
  end
  into resolved_order_status
  from public.kitchen_order_items kitchen_item
  where kitchen_item.kitchen_order_id = resolved_order_id
    and kitchen_item.organization_id = target_organization_id;

  update public.kitchen_orders kitchen_order
  set
    status = resolved_order_status,
    started_at = case
      when resolved_order_status = 'NEW' then null
      else coalesce(kitchen_order.started_at, now())
    end,
    ready_at = case
      when resolved_order_status in ('READY', 'COMPLETED') then coalesce(kitchen_order.ready_at, now())
      else null
    end,
    completed_at = case
      when resolved_order_status = 'COMPLETED' then coalesce(kitchen_order.completed_at, now())
      else null
    end
  where kitchen_order.id = resolved_order_id
    and kitchen_order.organization_id = target_organization_id;

  return query select resolved_order_status, target_status;
end;
$$;

create or replace function private.set_kitchen_order_priority(
  target_organization_id uuid,
  target_kitchen_order_id uuid,
  target_priority text
)
returns table (priority text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_store_id uuid;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'kitchen.manage')) then
    raise exception 'Kitchen order management access is required.' using errcode = '42501';
  end if;

  if target_priority not in ('NORMAL', 'RUSH') then
    raise exception 'Choose a valid kitchen priority.' using errcode = '22023';
  end if;

  select kitchen_order.store_id into resolved_store_id
  from public.kitchen_orders kitchen_order
  where kitchen_order.id = target_kitchen_order_id
    and kitchen_order.organization_id = target_organization_id
  for update;

  if resolved_store_id is null then
    raise exception 'This kitchen order is no longer available.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.employees employee
    join public.employee_stores employee_store
      on employee_store.employee_id = employee.id
     and employee_store.organization_id = employee.organization_id
    where employee.organization_id = target_organization_id
      and employee.profile_id = (select auth.uid())
      and employee.status = 'active'
      and employee_store.store_id = resolved_store_id
  ) then
    raise exception 'You are not assigned to this kitchen order store.' using errcode = '42501';
  end if;

  return query
  update public.kitchen_orders kitchen_order
  set priority = target_priority
  where kitchen_order.id = target_kitchen_order_id
    and kitchen_order.organization_id = target_organization_id
  returning kitchen_order.priority;
end;
$$;

create or replace function private.get_kitchen_station_routes(
  target_organization_id uuid
)
returns table (category_id uuid, category_name text, station text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'kitchen.manage')) then
    raise exception 'Kitchen order management access is required.' using errcode = '42501';
  end if;

  return query
  select category.id, category.name, coalesce(route.station, private.default_kitchen_station_for_category(category.organization_id, category.id, category.name))
  from public.categories category
  left join public.kitchen_station_category_routes route
    on route.organization_id = category.organization_id
   and route.category_id = category.id
  where category.organization_id = target_organization_id
    and not category.is_archived
  order by lower(category.name);
end;
$$;

create or replace function private.set_kitchen_station_category_route(
  target_organization_id uuid,
  target_category_id uuid,
  target_station text
)
returns table (category_id uuid, station text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
begin
  if (select auth.uid()) is null
    or not (select private.has_permission(target_organization_id, 'kitchen.manage')) then
    raise exception 'Kitchen order management access is required.' using errcode = '42501';
  end if;

  if target_station not in ('KITCHEN', 'BAR', 'DESSERT') then
    raise exception 'Choose a valid kitchen station.' using errcode = '22023';
  end if;

  select employee.id into actor_employee_id
  from public.employees employee
  where employee.organization_id = target_organization_id
    and employee.profile_id = (select auth.uid())
    and employee.status = 'active';

  if actor_employee_id is null or not exists (
    select 1
    from public.categories category
    where category.id = target_category_id
      and category.organization_id = target_organization_id
      and not category.is_archived
  ) then
    raise exception 'This category is unavailable for kitchen routing.' using errcode = 'P0002';
  end if;

  return query
  insert into public.kitchen_station_category_routes (
    organization_id, category_id, station, updated_by_employee_id
  )
  values (
    target_organization_id, target_category_id, target_station, actor_employee_id
  )
  on conflict on constraint kitchen_station_category_routes_unique do update
  set station = excluded.station, updated_by_employee_id = excluded.updated_by_employee_id
  returning kitchen_station_category_routes.category_id, kitchen_station_category_routes.station;
end;
$$;

create or replace function public.update_kitchen_order_item_status(
  target_organization_id uuid,
  target_kitchen_order_item_id uuid,
  target_status text
)
returns table (order_status text, item_status text)
language sql
security invoker
set search_path = ''
as $$
  select * from private.update_kitchen_order_item_status($1, $2, $3);
$$;

create or replace function public.set_kitchen_order_priority(
  target_organization_id uuid,
  target_kitchen_order_id uuid,
  target_priority text
)
returns table (priority text)
language sql
security invoker
set search_path = ''
as $$
  select * from private.set_kitchen_order_priority($1, $2, $3);
$$;

create or replace function public.get_kitchen_station_routes(
  target_organization_id uuid
)
returns table (category_id uuid, category_name text, station text)
language sql
security invoker
set search_path = ''
as $$
  select * from private.get_kitchen_station_routes($1);
$$;

create or replace function public.set_kitchen_station_category_route(
  target_organization_id uuid,
  target_category_id uuid,
  target_station text
)
returns table (category_id uuid, station text)
language sql
security invoker
set search_path = ''
as $$
  select * from private.set_kitchen_station_category_route($1, $2, $3);
$$;

-- A digital receipt has the same opaque display capability as the paired
-- customer screen and is only available for that screen's current completed
-- sale. It does not expose customer contact data or payment references.
create or replace function public.get_customer_display_receipt(
  target_access_token_hash text,
  target_sale_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  display_record public.customer_display_sessions%rowtype;
  receipt_payload jsonb;
begin
  if target_access_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'This digital receipt is unavailable.' using errcode = 'P0002';
  end if;

  select display.* into display_record
  from public.customer_display_sessions display
  where display.access_token_hash = target_access_token_hash
    and display.is_active;

  if display_record.id is null
    or display_record.current_state ->> 'status' <> 'complete'
    or display_record.current_state ->> 'saleId' is distinct from target_sale_id::text then
    raise exception 'This digital receipt is unavailable.' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'business_name', sale.organization_name_snapshot,
    'store_name', sale.store_name_snapshot,
    'register_name', sale.register_name_snapshot,
    'currency_code', sale.currency_code,
    'receipt_number', receipt.receipt_number,
    'issued_at', receipt.issued_at,
    'subtotal_minor', sale.subtotal_minor,
    'discount_minor', sale.discount_minor,
    'tax_minor', sale.tax_minor,
    'total_minor', sale.total_minor,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', sale_item.product_name_snapshot,
        'variant_name', sale_item.variant_name_snapshot,
        'modifiers', sale_item.modifiers_snapshot,
        'quantity', sale_item.quantity,
        'line_total_minor', sale_item.line_total_minor
      ) order by sale_item.created_at, sale_item.id)
      from public.sale_items sale_item
      where sale_item.organization_id = sale.organization_id
        and sale_item.sale_id = sale.id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', payment.payment_method_name_snapshot,
        'amount_minor', payment.amount_minor,
        'tendered_minor', payment.amount_tendered_minor,
        'change_minor', payment.change_given_minor
      ) order by payment.created_at, payment.id)
      from public.payments payment
      where payment.organization_id = sale.organization_id
        and payment.sale_id = sale.id
    ), '[]'::jsonb)
  )
  into receipt_payload
  from public.sales sale
  join public.receipts receipt
    on receipt.organization_id = sale.organization_id
   and receipt.sale_id = sale.id
  where sale.id = target_sale_id
    and sale.organization_id = display_record.organization_id
    and sale.store_id = display_record.store_id
    and sale.register_id = display_record.register_id;

  if receipt_payload is null then
    raise exception 'This digital receipt is unavailable.' using errcode = 'P0002';
  end if;

  return receipt_payload;
end;
$$;

revoke execute on function
  private.default_kitchen_station_for_category(uuid, uuid, text),
  private.issue_kitchen_order_from_completed_sale(),
  private.get_kitchen_orders(uuid, uuid),
  private.update_kitchen_order_status(uuid, uuid, text),
  private.update_kitchen_order_item_status(uuid, uuid, text),
  private.set_kitchen_order_priority(uuid, uuid, text),
  private.get_kitchen_station_routes(uuid),
  private.set_kitchen_station_category_route(uuid, uuid, text)
from public, anon, authenticated, service_role;

revoke execute on function
  public.get_kitchen_orders(uuid, uuid),
  public.update_kitchen_order_status(uuid, uuid, text),
  public.update_kitchen_order_item_status(uuid, uuid, text),
  public.set_kitchen_order_priority(uuid, uuid, text),
  public.get_kitchen_station_routes(uuid),
  public.set_kitchen_station_category_route(uuid, uuid, text),
  public.get_customer_display_receipt(text, uuid)
from public, anon, authenticated, service_role;

grant usage on schema private to authenticated;
grant execute on function
  private.get_kitchen_orders(uuid, uuid),
  private.update_kitchen_order_status(uuid, uuid, text),
  private.update_kitchen_order_item_status(uuid, uuid, text),
  private.set_kitchen_order_priority(uuid, uuid, text),
  private.get_kitchen_station_routes(uuid),
  private.set_kitchen_station_category_route(uuid, uuid, text)
to authenticated;

grant execute on function
  public.get_kitchen_orders(uuid, uuid),
  public.update_kitchen_order_status(uuid, uuid, text),
  public.update_kitchen_order_item_status(uuid, uuid, text),
  public.set_kitchen_order_priority(uuid, uuid, text),
  public.get_kitchen_station_routes(uuid),
  public.set_kitchen_station_category_route(uuid, uuid, text)
to authenticated;

grant execute on function public.get_customer_display_receipt(text, uuid)
to anon, authenticated;

comment on table public.kitchen_station_category_routes
is 'Organization-scoped category-to-station routing used only while issuing immutable kitchen snapshots from completed dining sales.';

comment on function public.update_kitchen_order_item_status(uuid, uuid, text)
is 'Advances one kitchen snapshot item and recalculates its parent operational status without altering the sale or receipt.';

comment on function public.get_customer_display_receipt(text, uuid)
is 'Returns a sanitized receipt only when its sale is the paired display capability''s current completed sale.';

commit;
