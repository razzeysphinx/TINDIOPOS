# TINDIO Fresh-Chat Handover

**Prepared:** 2026-09-15  
**Repository:** `razzeysphinx/TINDIOPOS`  
**Branch:** `TINDIO-PREPRODUCTION`  
**Current HEAD:** `af8f3b0` — `Merge pull request #1 from razzeysphinx/rebuild/neon-ready-foundation-v4`

## Current Status

Do not assume the earlier Packet 006 repair remains in the worktree. At handover creation, the repository was clean before this document was added, but the current checkout contains an inventory RBAC migration reconstruction defect.

The latest verified command was:

```powershell
pnpm.cmd run test:inventory-rbac
```

It failed one test:

```text
granular transfer migration has one coherent transaction and no orphan PL/pgSQL fragments
PL/pgSQL fragment appears outside a CREATE OR REPLACE FUNCTION block: /\breceipt_id\s+uuid\s*;/i
```

The failing test is in:

```text
scripts/inventory-granular-rbac-check.mjs
```

The affected migration is:

```text
supabase/migrations/20260910142940_granular_inventory_transfer_rbac.sql
```

The test output indicates that the migration has orphan procedural declarations after function definitions were reconstructed or removed. Treat this as a same-class Packet 006 Phase 0 reconstruction failure, not as an unrelated application issue.

## Required Next Task

Continue the applicable Packet 006/Inventory RBAC repair only after first reading the current authoritative packet supplied by the user.

1. Inspect `20260910142940_granular_inventory_transfer_rbac.sql` around the orphan `receipt_id uuid;` declaration.
2. Restore the affected canonical complete function body from the approved historical/canonical migration source.
3. Preserve all stock mathematics, idempotency, ledger operations, organization/store validation, RLS, and audit behavior.
4. Change only the authorization guard where the packet explicitly requires granular capabilities.
5. Ensure all eight canonical transfer procedures contain their required capability guard inside their own function body:

   - `private.transfer_stock`: `inventory.transfer.create` + `inventory.transfer.send`
   - `private.create_stock_request`: `inventory.transfer.create`
   - `private.approve_stock_request`: `inventory.transfer.send`
   - `private.start_stock_request_picking`: `inventory.transfer.send`
   - `private.dispatch_stock_request`: `inventory.transfer.send`
   - `private.receive_stock_request`: `inventory.transfer.receive`
   - `private.create_direct_stock_transfer`: `inventory.transfer.create` + `inventory.transfer.send`
   - `private.receive_stock_transfer`: `inventory.transfer.receive`

6. Do not reintroduce `tindio.inventory_required_capabilities`, function-source rewriting (`pg_get_functiondef`, dynamic replacement), role-name authorization, direct `inventory_levels` writes, or duplicate transfer ledger behavior.

## Validation Sequence

After the migration reconstruction is coherent, run:

```powershell
git diff --check
pnpm.cmd run test:inventory-rbac
pnpm.cmd run test:inventory-purchasing-rbac
pnpm.cmd run test:inventory-count-stocktake
pnpm.cmd run test:inventory-schema-contract
```

Only continue to database work after these static gates pass.

## Database Safety Blocker from Prior Work

Before any `supabase db reset --local` or migration operation:

1. Inspect `.env.local` without exposing values.
2. Confirm **both** the Supabase URL and the database connection target are local.
3. In the previous session, the public Supabase URL appeared local but `DATABASE_URL` was non-local. Therefore no reset, migration, push, or remote database operation was performed.

If the database target is non-local, stop and report it. Do not run a local reset against a potentially shared/remote database.

## Constraints

- Do not run `supabase db push`.
- Do not commit or push Git changes.
- Do not run `db reset` until the database target is confirmed local.
- Do not edit historical migrations unless the current authoritative packet explicitly identifies an **unapplied** migration to repair.
- Do not upgrade dependencies.
- Do not weaken RLS, organization isolation, store scope, idempotency, ledger behavior, or permission checks.
- Use permissions/capabilities, never hardcoded role names.

## Files Worth Inspecting First

```text
supabase/migrations/20260910142940_granular_inventory_transfer_rbac.sql
scripts/inventory-granular-rbac-check.mjs
supabase/migrations/20260911062913_purchasing_granular_rbac_integration.sql
scripts/inventory-purchasing-granular-rbac-check.mjs
supabase/migrations/20260911014827_inventory_count_batches_and_roundtrip_import.sql
scripts/inventory-count-stocktake-check.mjs
```

## Last Known Test State

| Check | Result |
| --- | --- |
| `pnpm.cmd run test:inventory-rbac` | **Failed**: orphan `receipt_id uuid;` fragment outside a function block |
| `test:inventory-purchasing-rbac` | Not run in the current checkout because the first static gate failed |
| `test:inventory-count-stocktake` | Not run in the current checkout because the first static gate failed |
| `test:inventory-schema-contract` | Not run in the current checkout because the first static gate failed |
| Database migration/reset tests | Not run; local database target was not confirmed |

