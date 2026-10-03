-- Public SQL wrappers execute with the caller's role. Grant their exact private
-- implementations to authenticated users, matching the established Phase 9
-- secure-wrapper pattern while keeping the private schema out of the Data API.
begin;

grant usage on schema private to authenticated;
grant execute on function
  private.update_inventory_policy(uuid, uuid, text),
  private.create_inventory_adjustment_reason(uuid, text, text, text),
  private.record_inventory_adjustment_v2(uuid, uuid, uuid, uuid, numeric, text, text),
  private.ship_stock_transfer(uuid, uuid, uuid, jsonb, text),
  private.receive_stock_transfer(uuid, uuid, jsonb, text),
  private.return_to_supplier(uuid, uuid, uuid, jsonb, text),
  private.produce_composite(uuid, uuid, uuid, numeric, text)
to authenticated;

commit;
