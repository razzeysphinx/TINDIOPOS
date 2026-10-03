-- TINDIO Phase 11: durable per-device sequence reservation and contiguous checkpoints.
begin;

create table public.pos_device_sync_checkpoints (
  organization_id uuid not null,
  device_id uuid not null,
  server_checkpoint bigint not null default 0 check (server_checkpoint >= 0),
  updated_at timestamptz not null default now(),
  primary key (organization_id, device_id),
  constraint pos_device_sync_checkpoints_device_org_fkey foreign key (device_id, organization_id)
    references public.pos_devices (id, organization_id) on delete restrict
);

create table public.pos_device_sequence_receipts (
  organization_id uuid not null,
  device_id uuid not null,
  store_id uuid not null,
  register_id uuid not null,
  device_sequence bigint not null check (device_sequence > 0),
  idempotency_key uuid not null,
  local_receipt_reference text not null check (local_receipt_reference ~ '^OFF-[A-Z0-9]{6,32}$'),
  state text not null check (state in ('RECEIVED', 'APPLIED', 'CONFLICT')),
  first_seen_at timestamptz not null default now(),
  finalized_at timestamptz,
  primary key (organization_id, device_id, device_sequence),
  unique (organization_id, idempotency_key),
  constraint pos_device_sequence_receipts_device_org_fkey foreign key (device_id, organization_id)
    references public.pos_devices (id, organization_id) on delete restrict,
  constraint pos_device_sequence_receipts_store_org_fkey foreign key (store_id, organization_id)
    references public.stores (id, organization_id) on delete restrict,
  constraint pos_device_sequence_receipts_register_org_fkey foreign key (register_id, organization_id)
    references public.registers (id, organization_id) on delete restrict
);

create index pos_device_sequence_receipts_checkpoint_idx
  on public.pos_device_sequence_receipts (organization_id, device_id, state, device_sequence);
create index pos_device_sequence_receipts_idempotency_idx
  on public.pos_device_sequence_receipts (organization_id, idempotency_key);

alter table public.pos_device_sync_checkpoints enable row level security;
alter table public.pos_device_sequence_receipts enable row level security;
revoke all on table public.pos_device_sync_checkpoints from public, anon, authenticated, service_role;
revoke all on table public.pos_device_sequence_receipts from public, anon, authenticated, service_role;

create or replace function private.require_pos_sequence_access(
  target_organization_id uuid,
  target_device_id uuid,
  target_store_id uuid,
  target_register_id uuid
)
returns void
language plpgsql security definer set search_path = '' as $$
declare actor_employee_id uuid;
begin
  actor_employee_id := private.current_employee_id(target_organization_id);
  if actor_employee_id is null or not (select private.has_permission(target_organization_id, 'sales.create')) then
    raise exception 'Sales permission is required.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.pos_devices device
    join public.employee_stores assignment on assignment.organization_id=device.organization_id and assignment.employee_id=actor_employee_id and assignment.store_id=device.store_id
    join public.stores store on store.id=device.store_id and store.organization_id=device.organization_id and store.is_active
    join public.registers register on register.id=device.register_id and register.organization_id=device.organization_id and register.store_id=device.store_id and register.is_active
    where device.organization_id=target_organization_id and device.id=target_device_id
      and device.store_id=target_store_id and device.register_id=target_register_id and device.status='active'
  ) then
    raise exception 'An active device, register, and employee store assignment are required.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.reserve_pos_device_sequence(
  target_organization_id uuid,
  target_device_id uuid,
  target_store_id uuid,
  target_register_id uuid,
  target_device_sequence bigint,
  target_idempotency_key uuid,
  target_local_receipt_reference text
)
returns table (status text, server_checkpoint bigint, expected_sequence bigint)
language plpgsql security definer set search_path = '' as $$
declare current_checkpoint bigint; existing_idempotency uuid; existing_sequence bigint;
begin
  if target_device_sequence is null or target_device_sequence <= 0 or target_idempotency_key is null
    or target_local_receipt_reference !~ '^OFF-[A-Z0-9]{6,32}$' then
    raise exception 'The device sequence reservation is invalid.' using errcode = '23514';
  end if;
  perform private.require_pos_sequence_access(target_organization_id,target_device_id,target_store_id,target_register_id);
  insert into public.pos_device_sync_checkpoints (organization_id,device_id) values (target_organization_id,target_device_id)
    on conflict (organization_id,device_id) do nothing;
  select checkpoint.server_checkpoint into current_checkpoint from public.pos_device_sync_checkpoints checkpoint
    where checkpoint.organization_id=target_organization_id and checkpoint.device_id=target_device_id for update;
  select receipt.idempotency_key into existing_idempotency from public.pos_device_sequence_receipts receipt
    where receipt.organization_id=target_organization_id and receipt.device_id=target_device_id and receipt.device_sequence=target_device_sequence for update;
  if existing_idempotency is not null then
    status := case when existing_idempotency=target_idempotency_key then 'REPLAY' else 'DUPLICATE_SEQUENCE' end;
    server_checkpoint := current_checkpoint; expected_sequence := current_checkpoint+1; return next; return;
  end if;
  select receipt.device_sequence into existing_sequence from public.pos_device_sequence_receipts receipt
    where receipt.organization_id=target_organization_id and receipt.idempotency_key=target_idempotency_key for update;
  if existing_sequence is not null then
    status := 'IDEMPOTENCY_SEQUENCE_MISMATCH'; server_checkpoint := current_checkpoint; expected_sequence := current_checkpoint+1; return next; return;
  end if;
  if target_device_sequence > current_checkpoint+1 then
    status := 'GAP'; server_checkpoint := current_checkpoint; expected_sequence := current_checkpoint+1; return next; return;
  end if;
  if target_device_sequence < current_checkpoint+1 then
    status := 'OUT_OF_ORDER'; server_checkpoint := current_checkpoint; expected_sequence := current_checkpoint+1; return next; return;
  end if;
  insert into public.pos_device_sequence_receipts (organization_id,device_id,store_id,register_id,device_sequence,idempotency_key,local_receipt_reference,state)
    values (target_organization_id,target_device_id,target_store_id,target_register_id,target_device_sequence,target_idempotency_key,target_local_receipt_reference,'RECEIVED');
  status := 'ACCEPTED'; server_checkpoint := current_checkpoint; expected_sequence := current_checkpoint+1; return next;
end;
$$;

create or replace function public.finalize_pos_device_sequence(
  target_organization_id uuid,
  target_device_id uuid,
  target_device_sequence bigint,
  target_idempotency_key uuid,
  target_final_state text
)
returns table (server_checkpoint bigint)
language plpgsql security definer set search_path = '' as $$
declare receipt public.pos_device_sequence_receipts%rowtype; current_checkpoint bigint; normalized_state text; device_store_id uuid; device_register_id uuid;
begin
  normalized_state := upper(nullif(btrim(coalesce(target_final_state,'')),''));
  if normalized_state not in ('APPLIED','CONFLICT') then raise exception 'The sequence finalization state is invalid.' using errcode='23514'; end if;
  select device.store_id,device.register_id into device_store_id,device_register_id from public.pos_devices device where device.organization_id=target_organization_id and device.id=target_device_id;
  perform private.require_pos_sequence_access(target_organization_id,target_device_id,device_store_id,device_register_id);
  select checkpoint.server_checkpoint into current_checkpoint from public.pos_device_sync_checkpoints checkpoint where checkpoint.organization_id=target_organization_id and checkpoint.device_id=target_device_id for update;
  select * into receipt from public.pos_device_sequence_receipts candidate where candidate.organization_id=target_organization_id and candidate.device_id=target_device_id and candidate.device_sequence=target_device_sequence for update;
  if receipt.idempotency_key is null or receipt.idempotency_key <> target_idempotency_key then raise exception 'The sequence receipt does not match this checkout.' using errcode='23514'; end if;
  if receipt.state='RECEIVED' then
    update public.pos_device_sequence_receipts set state=normalized_state,finalized_at=now()
      where organization_id=target_organization_id and device_id=target_device_id and device_sequence=target_device_sequence;
  end if;
  if target_device_sequence=current_checkpoint+1 then
    update public.pos_device_sync_checkpoints set server_checkpoint=target_device_sequence,updated_at=now()
      where organization_id=target_organization_id and device_id=target_device_id;
    current_checkpoint := target_device_sequence;
  end if;
  server_checkpoint := current_checkpoint; return next;
end;
$$;

create or replace function public.get_pos_device_sync_checkpoint(target_organization_id uuid,target_device_id uuid)
returns table (device_id uuid,server_checkpoint bigint,next_expected_sequence bigint,updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare device_store_id uuid; device_register_id uuid;
begin
  select device.store_id,device.register_id into device_store_id,device_register_id from public.pos_devices device where device.organization_id=target_organization_id and device.id=target_device_id;
  perform private.require_pos_sequence_access(target_organization_id,target_device_id,device_store_id,device_register_id);
  insert into public.pos_device_sync_checkpoints (organization_id,device_id) values (target_organization_id,target_device_id) on conflict (organization_id,device_id) do nothing;
  return query select checkpoint.device_id,checkpoint.server_checkpoint,checkpoint.server_checkpoint+1,checkpoint.updated_at from public.pos_device_sync_checkpoints checkpoint where checkpoint.organization_id=target_organization_id and checkpoint.device_id=target_device_id;
end;
$$;

revoke execute on function private.require_pos_sequence_access(uuid,uuid,uuid,uuid) from public, anon, authenticated, service_role;
revoke execute on function public.reserve_pos_device_sequence(uuid,uuid,uuid,uuid,bigint,uuid,text) from public, anon, service_role;
revoke execute on function public.finalize_pos_device_sequence(uuid,uuid,bigint,uuid,text) from public, anon, service_role;
revoke execute on function public.get_pos_device_sync_checkpoint(uuid,uuid) from public, anon, service_role;
grant execute on function public.reserve_pos_device_sequence(uuid,uuid,uuid,uuid,bigint,uuid,text) to authenticated;
grant execute on function public.finalize_pos_device_sequence(uuid,uuid,bigint,uuid,text) to authenticated;
grant execute on function public.get_pos_device_sync_checkpoint(uuid,uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
