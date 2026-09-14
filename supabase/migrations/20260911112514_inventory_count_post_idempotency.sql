begin;

-- A count post is a stock-changing operation.  Retain its caller-provided
-- operation identifier on the canonical document so a browser can safely
-- retry after a response timeout without applying the variance twice.
alter table public.inventory_counts
  add column if not exists post_operation_id uuid;

create unique index if not exists inventory_counts_organization_post_operation_id_key
  on public.inventory_counts (organization_id, post_operation_id)
  where post_operation_id is not null;

create or replace function private.post_inventory_count_idempotent(
  target_organization_id uuid,
  target_inventory_count_id uuid,
  target_operation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  count_document public.inventory_counts%rowtype;
begin
  if target_operation_id is null then
    raise exception 'An inventory count posting operation ID is required.' using errcode = '23514';
  end if;

  select count_row.* into count_document
  from public.inventory_counts count_row
  where count_row.id = target_inventory_count_id
    and count_row.organization_id = target_organization_id
  for update;

  if count_document.id is null then
    raise exception 'Only a reviewed inventory count can be posted.' using errcode = '23514';
  end if;

  -- Preserve the existing capability, store-scope, active-employee, and
  -- authenticated-session checks even when this is a successful replay.
  perform private.inventory_count_actor(target_organization_id, count_document.store_id);

  if count_document.status = 'posted'
    and count_document.post_operation_id = target_operation_id then
    return;
  end if;

  if count_document.status <> 'ready_for_review' then
    raise exception 'Only a reviewed inventory count can be posted.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.inventory_counts existing_count
    where existing_count.organization_id = target_organization_id
      and existing_count.post_operation_id = target_operation_id
      and existing_count.id <> target_inventory_count_id
  ) then
    raise exception 'This inventory count posting operation has already been used for another count.' using errcode = '23514';
  end if;

  update public.inventory_counts
  set post_operation_id = target_operation_id,
      updated_at = clock_timestamp()
  where id = count_document.id;

  -- Delegate all ledger, reconciliation, audit, and historical document work
  -- to the existing canonical posting function.  If it fails, this operation
  -- identifier update rolls back with the same transaction.
  perform private.post_inventory_count(target_organization_id, target_inventory_count_id);
end;
$function$;

alter function private.post_inventory_count_idempotent(uuid, uuid, uuid)
  set tindio.inventory_required_capabilities to 'inventory.count.finalize';

create or replace function public.post_inventory_count(
  target_organization_id uuid,
  target_inventory_count_id uuid,
  target_operation_id uuid
)
returns void
language sql
security invoker
set search_path = ''
as $function$
  select private.post_inventory_count_idempotent(
    target_organization_id,
    target_inventory_count_id,
    target_operation_id
  );
$function$;

revoke execute on function private.post_inventory_count_idempotent(uuid, uuid, uuid) from public, anon, service_role;
grant execute on function private.post_inventory_count_idempotent(uuid, uuid, uuid) to authenticated;
revoke execute on function public.post_inventory_count(uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.post_inventory_count(uuid, uuid, uuid) to authenticated;

comment on column public.inventory_counts.post_operation_id is
  'Client operation ID for idempotent inventory-count posting retries; stock remains authoritative in the immutable inventory ledger.';
comment on function private.post_inventory_count_idempotent(uuid, uuid, uuid) is
  'Makes an authorized retry of an inventory-count post a no-op only when it uses the same count operation ID.';

commit;
