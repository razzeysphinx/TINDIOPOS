-- Phase 08: consolidate inventory counts / stocktake around the current
-- document lifecycle while retaining historical legacy rows as read-only
-- evidence.

alter table public.inventory_counts
  alter column status set default 'draft';

create or replace function private.guard_inventory_count_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('posted', 'completed') then
      raise exception 'Posted inventory counts are immutable.' using errcode = '23514';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' and new.status in ('open', 'completed') then
    raise exception 'Legacy inventory count states are read-only compatibility evidence.' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' then
    if old.status in ('posted', 'completed') then
      raise exception 'Posted inventory counts are immutable.' using errcode = '23514';
    end if;
    if new.status in ('open', 'completed') and new.status is distinct from old.status then
      raise exception 'Legacy inventory count states are read-only compatibility evidence.' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists inventory_counts_guard_canonical_lifecycle on public.inventory_counts;
create trigger inventory_counts_guard_canonical_lifecycle
before insert or update or delete on public.inventory_counts
for each row execute function private.guard_inventory_count_lifecycle();

create or replace function private.guard_inventory_count_line_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_status text;
  parent_organization_id uuid;
  parent_count_id uuid;
begin
  parent_organization_id := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  parent_count_id := case when tg_op = 'DELETE' then old.inventory_count_id else new.inventory_count_id end;

  select count_document.status
  into parent_status
  from public.inventory_counts count_document
  where count_document.id = parent_count_id
    and count_document.organization_id = parent_organization_id;

  if parent_status in ('posted', 'completed', 'cancelled') then
    raise exception 'Terminal inventory count lines are immutable.' using errcode = '23514';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists inventory_count_lines_guard_terminal_document on public.inventory_count_lines;
create trigger inventory_count_lines_guard_terminal_document
before insert or update or delete on public.inventory_count_lines
for each row execute function private.guard_inventory_count_line_lifecycle();

create or replace function private.audit_inventory_count_line_saved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  count_document public.inventory_counts%rowtype;
  actor_id uuid;
begin
  if new.counted_quantity is null then
    return new;
  end if;

  select count_row.*
  into count_document
  from public.inventory_counts count_row
  where count_row.id = new.inventory_count_id
    and count_row.organization_id = new.organization_id;

  actor_id := private.inventory_count_actor(new.organization_id, count_document.store_id);

  perform private.write_audit_log(
    new.organization_id,
    'INVENTORY_COUNT_LINE_SAVED',
    'inventory.count',
    actor_id,
    null,
    count_document.store_id,
    null,
    null,
    null,
    'Physical count quantity saved',
    jsonb_build_object(
      'inventory_count_id', new.inventory_count_id,
      'count_number', count_document.count_number,
      'inventory_count_line_id', new.id,
      'counted_quantity', new.counted_quantity,
      'reconciled_expected_quantity', new.reconciled_expected_quantity
    )
  );

  return new;
end;
$$;

drop trigger if exists inventory_count_lines_audit_physical_quantity on public.inventory_count_lines;
create trigger inventory_count_lines_audit_physical_quantity
after insert or update of counted_quantity on public.inventory_count_lines
for each row execute function private.audit_inventory_count_line_saved();

create or replace function private.cancel_inventory_count(
  target_organization_id uuid,
  target_inventory_count_id uuid,
  target_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  count_document public.inventory_counts%rowtype;
  actor_id uuid;
begin
  select count_row.*
  into count_document
  from public.inventory_counts count_row
  where count_row.id = target_inventory_count_id
    and count_row.organization_id = target_organization_id
  for update;

  if count_document.id is null
    or count_document.status not in ('draft', 'in_progress', 'ready_for_review') then
    raise exception 'Only a canonical active count can be cancelled.' using errcode = '23514';
  end if;

  actor_id := private.inventory_count_actor(
    target_organization_id,
    count_document.store_id,
    array['inventory.count.finalize']::text[]
  );

  update public.inventory_counts
  set status = 'cancelled',
      note = coalesce(nullif(btrim(target_note), ''), note),
      updated_at = clock_timestamp()
  where id = target_inventory_count_id;

  perform private.write_audit_log(
    target_organization_id,
    'INVENTORY_COUNT_CANCELLED',
    'inventory.count',
    actor_id,
    null,
    count_document.store_id,
    null,
    null,
    null,
    target_note,
    jsonb_build_object(
      'inventory_count_id', count_document.id,
      'count_number', count_document.count_number
    )
  );
end;
$$;

-- These superseded private entry points are not required by the current
-- public wrappers.  In particular, direct private.post_inventory_count would
-- bypass the operation-ID reservation owned by the canonical public command.
revoke execute on function private.create_inventory_count_draft(uuid, uuid, text)
from public, anon, authenticated, service_role;
revoke execute on function private.complete_inventory_count(uuid, uuid, text, jsonb)
from public, anon, authenticated, service_role;
revoke execute on function private.post_inventory_count(uuid, uuid)
from public, anon, authenticated, service_role;

revoke execute on function private.guard_inventory_count_lifecycle()
from public, anon, authenticated, service_role;
revoke execute on function private.guard_inventory_count_line_lifecycle()
from public, anon, authenticated, service_role;
revoke execute on function private.audit_inventory_count_line_saved()
from public, anon, authenticated, service_role;

comment on function private.guard_inventory_count_lifecycle() is
  'Prevents new legacy open/completed states and makes posted/completed count documents immutable while retaining historical rows.';
comment on function private.guard_inventory_count_line_lifecycle() is
  'Prevents mutation of count lines after their count document becomes posted, completed, or cancelled.';
comment on function private.audit_inventory_count_line_saved() is
  'Records immutable audit evidence whenever a manual or CSV physical count quantity is saved.';
