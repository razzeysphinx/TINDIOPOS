-- Improvement 10: retain one authoritative index for the inventory movement report query.
-- The original index has the same key columns and ordering, so this duplicate can be removed safely.
drop index if exists public.inventory_movements_organization_store_created_report_idx;
