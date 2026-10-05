-- Provider-neutral kitchen change dispatch.
--
-- The original baseline emitted a provider-specific broadcast from the
-- kitchen_orders trigger. Keep the committed status transition and its
-- notification record in the same transaction, while leaving delivery to the
-- application reconciliation layer.

begin;

create table if not exists private.kitchen_order_change_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid not null,
  kitchen_order_id uuid not null,
  status text not null,
  source_updated_at timestamptz not null,
  occurred_at timestamptz not null default now(),
  constraint kitchen_order_change_events_status_check
    check (status in ('NEW', 'PREPARING', 'READY', 'COMPLETED')),
  constraint kitchen_order_change_events_organization_fkey
    foreign key (organization_id) references public.organizations(id) on delete restrict,
  constraint kitchen_order_change_events_store_organization_fkey
    foreign key (store_id, organization_id)
    references public.stores(id, organization_id) on delete restrict,
  constraint kitchen_order_change_events_order_organization_fkey
    foreign key (kitchen_order_id, organization_id)
    references public.kitchen_orders(id, organization_id) on delete restrict,
  constraint kitchen_order_change_events_source_unique
    unique (kitchen_order_id, status, source_updated_at)
);

comment on table private.kitchen_order_change_events is
  'Durable, tenant-scoped kitchen status-change outbox. It is not API exposed and is consumed only by trusted TINDIO application infrastructure.';

create index if not exists kitchen_order_change_events_scope_cursor_idx
  on private.kitchen_order_change_events (organization_id, store_id, occurred_at, id);

alter table private.kitchen_order_change_events enable row level security;

revoke all on table private.kitchen_order_change_events from public;
revoke all on table private.kitchen_order_change_events from tindio_anon;
revoke all on table private.kitchen_order_change_events from tindio_authenticated;
revoke all on table private.kitchen_order_change_events from tindio_service;

create or replace function private.broadcast_kitchen_order_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.kitchen_order_change_events (
    organization_id,
    store_id,
    kitchen_order_id,
    status,
    source_updated_at
  )
  values (
    new.organization_id,
    new.store_id,
    new.id,
    new.status,
    new.updated_at
  )
  on conflict (kitchen_order_id, status, source_updated_at) do nothing;

  return null;
end;
$$;

revoke all on function private.broadcast_kitchen_order_change() from public;
revoke all on function private.broadcast_kitchen_order_change() from tindio_anon;
revoke all on function private.broadcast_kitchen_order_change() from tindio_authenticated;
revoke all on function private.broadcast_kitchen_order_change() from tindio_service;

commit;
