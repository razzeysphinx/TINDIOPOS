-- TINDIO Neon Recovery R1 final gate repair.
--
-- Supabase local database lint reports SQLSTATE 42702 in:
--
--   public.get_pos_device_sync_checkpoint(uuid, uuid)
--
-- The function returns an OUT column named device_id and also used
-- unqualified device_id in the ON CONFLICT inference target.
--
-- Preserve the public RPC signature and runtime behavior.
-- Remove only the PL/pgSQL name ambiguity by targeting the named PK constraint.

begin;

create or replace function public.get_pos_device_sync_checkpoint(
  target_organization_id uuid,
  target_device_id uuid
)
returns table (
  device_id uuid,
  server_checkpoint bigint,
  next_expected_sequence bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  device_store_id uuid;
  device_register_id uuid;
begin
  select
    device.store_id,
    device.register_id
  into
    device_store_id,
    device_register_id
  from public.pos_devices device
  where device.organization_id =
      target_organization_id
    and device.id =
      target_device_id;

  perform private.require_pos_sequence_access(
    target_organization_id,
    target_device_id,
    device_store_id,
    device_register_id
  );

  insert into public.pos_device_sync_checkpoints (
    organization_id,
    device_id
  )
  values (
    target_organization_id,
    target_device_id
  )
  on conflict on constraint
    pos_device_sync_checkpoints_pkey
  do nothing;

  return query
  select
    checkpoint.device_id,
    checkpoint.server_checkpoint,
    checkpoint.server_checkpoint + 1,
    checkpoint.updated_at
  from public.pos_device_sync_checkpoints checkpoint
  where checkpoint.organization_id =
      target_organization_id
    and checkpoint.device_id =
      target_device_id;
end;
$$;

revoke execute
on function public.get_pos_device_sync_checkpoint(
  uuid,
  uuid
)
from
  public,
  anon,
  service_role;

grant execute
on function public.get_pos_device_sync_checkpoint(
  uuid,
  uuid
)
to authenticated;

comment on function public.get_pos_device_sync_checkpoint(
  uuid,
  uuid
)
is
'Returns the durable sequence checkpoint for one authorized POS device. Recovery R1 uses the named checkpoint primary-key constraint to avoid PL/pgSQL OUT-parameter ambiguity without changing the RPC contract.';

commit;
