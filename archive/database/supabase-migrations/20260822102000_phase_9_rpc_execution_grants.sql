-- Phase 9 compatibility: authenticated public RPC wrappers invoke private procedures.
begin;

revoke execute on function private.inventory_actor(uuid,uuid), private.apply_inventory_change(uuid,uuid,uuid,uuid,numeric,text,uuid,text,text,uuid), private.validate_purchase_order_line(), private.validate_inventory_count_line(), private.validate_stock_transfer_line(), private.create_supplier(uuid,text,text,text,text,text,text), private.create_purchase_order(uuid,uuid,uuid,text,date,jsonb), private.receive_purchase_order(uuid,uuid,jsonb,text), private.complete_inventory_count(uuid,uuid,text,jsonb), private.transfer_stock(uuid,uuid,uuid,jsonb,text) from public, anon, service_role;
grant execute on function private.create_supplier(uuid,text,text,text,text,text,text), private.create_purchase_order(uuid,uuid,uuid,text,date,jsonb), private.receive_purchase_order(uuid,uuid,jsonb,text), private.complete_inventory_count(uuid,uuid,text,jsonb), private.transfer_stock(uuid,uuid,uuid,jsonb,text) to authenticated;

commit;
