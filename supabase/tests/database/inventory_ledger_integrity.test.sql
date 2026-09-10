-- Rollback-safe verification for Phase 1 ledger metadata and immutability.
-- This script does not leave a test movement behind.

begin;
create extension if not exists pgtap with schema extensions;
select plan(1);

do $body$
declare
  candidate record;
  posted_unit text;
  posted_operation uuid;
  rejected_mutation boolean := false;
begin
  select
    level.organization_id,
    level.store_id,
    level.product_id,
    level.variant_id,
    level.quantity,
    level.id as level_id,
    movement.actor_employee_id,
    product.unit
  into candidate
  from public.inventory_levels level
  join public.products product
    on product.id = level.product_id
   and product.organization_id = level.organization_id
  join lateral (
    select ledger.actor_employee_id
    from public.inventory_movements ledger
    where ledger.organization_id = level.organization_id
      and ledger.store_id = level.store_id
      and ledger.product_id = level.product_id
      and ledger.variant_id is not distinct from level.variant_id
    order by ledger.created_at desc, ledger.id desc
    limit 1
  ) movement on true
  where product.track_inventory
  limit 1;

  if candidate.level_id is null then
    raise exception 'Phase 1 validation needs one tracked inventory level with an actor.';
  end if;

  begin
    insert into public.inventory_movements (
      organization_id,
      store_id,
      product_id,
      variant_id,
      quantity_delta,
      quantity_before,
      quantity_after,
      movement_type,
      actor_employee_id,
      reason,
      source_type,
      source_id
    ) values (
      candidate.organization_id,
      candidate.store_id,
      candidate.product_id,
      candidate.variant_id,
      0.001,
      candidate.quantity,
      candidate.quantity + 0.001,
      'ADJUSTMENT',
      candidate.actor_employee_id,
      'Phase 1 temporary ledger validation',
      'phase_1_validation',
      candidate.level_id
    )
    returning unit_snapshot, operation_id into posted_unit, posted_operation;

    if posted_unit is distinct from candidate.unit
      or posted_operation is distinct from candidate.level_id then
      raise exception 'Phase 1 metadata trigger did not capture the expected unit or operation identity.';
    end if;

    raise exception 'ROLLBACK_PHASE_1_LEDGER_TEST';
  exception
    when raise_exception then
      if sqlerrm <> 'ROLLBACK_PHASE_1_LEDGER_TEST' then
        raise;
      end if;
  end;

  -- The existing canonical posting function must remain compatible with the
  -- new mandatory metadata. The nested block rolls back its temporary level
  -- projection and movement after inspecting the generated record.
  begin
    perform private.apply_inventory_change_v2(
      candidate.organization_id,
      candidate.store_id,
      candidate.product_id,
      candidate.variant_id,
      0.001,
      'ADJUSTMENT',
      candidate.actor_employee_id,
      'Phase 1 canonical ledger validation',
      'phase_1_canonical_validation',
      candidate.level_id,
      null,
      'PHASE_1_TEST'
    );

    select movement.unit_snapshot, movement.operation_id
      into posted_unit, posted_operation
    from public.inventory_movements movement
    where movement.organization_id = candidate.organization_id
      and movement.source_type = 'phase_1_canonical_validation'
      and movement.source_id = candidate.level_id
    order by movement.created_at desc, movement.id desc
    limit 1;

    if posted_unit is distinct from candidate.unit
      or posted_operation is distinct from candidate.level_id then
      raise exception 'Phase 1 canonical posting did not preserve ledger metadata.';
    end if;

    raise exception 'ROLLBACK_PHASE_1_CANONICAL_TEST';
  exception
    when raise_exception then
      if sqlerrm <> 'ROLLBACK_PHASE_1_CANONICAL_TEST' then
        raise;
      end if;
  end;

  begin
    update public.inventory_movements
    set reason = reason
    where id = (
      select id
      from public.inventory_movements
      order by created_at, id
      limit 1
    );
  exception
    when object_not_in_prerequisite_state then
      rejected_mutation := true;
  end;

  if not rejected_mutation then
    raise exception 'Phase 1 append-only guard did not reject the update.';
  end if;

  if exists (
    select 1
    from public.inventory_movements movement
    where movement.unit_snapshot is null
      or movement.operation_id is null
      or (
        movement.source_id is not null
        and movement.operation_id <> movement.source_id
      )
  ) then
    raise exception 'Phase 1 ledger metadata backfill is incomplete.';
  end if;
end;
$body$;

select pass('inventory ledger metadata and append-only integrity verification completed');
select * from finish();
rollback;
