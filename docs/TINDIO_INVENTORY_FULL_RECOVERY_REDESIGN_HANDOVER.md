# TINDIO Inventory — Full Recovery and Redesign Handover

This handover separates completed work, confirmed defects, proposed design, and unfinished verification. **The full inventory recovery and redesign is not complete.** The audit and local database baseline have progressed, and three uncommitted files contain the first verified recovery changes.

## 1. User’s objective and constraints

The user requested a full recovery and redesign of TINDIO Inventory, covering:

- Application code, APIs/server actions, services, and UI.
- Database schema, SQL/RPCs, migrations, and generated types.
- Inventory calculations, ledger, transfers, receiving, adjustments, counts, purchasing, units, valuation, and history.
- RBAC, store scope, RLS, and tenant isolation.
- Relevant Git branches and history.

Preserve this direction:

```text
Organization → Stores → Products → Variants → Store Inventory
```

The main operational priority is:

```text
Store A → Stock Transfer → Store B
```

TINDIO must remain multi-store first. Do not introduce mandatory requests or approvals unless security or audit requirements justify them.

The user explicitly rejected isolated quick fixes and hidden technical debt. Changes must follow understood dependencies, controlled implementation phases, and real workflow verification.

Before major implementation, the user required a report covering architecture, Git history, affected files, conflicts, root causes, restoration/removal candidates, competitor research, proposed architecture, schema, RBAC/RLS, migration strategy, development phases, tests, and rollback. A preliminary report was delivered, but several parts require deeper evidence as described below.

## 2. Repository and environment

| Item | Value |
|---|---|
| Repository | `C:\Users\peral\Documents\PROGRAMMING\TINDIO POS` |
| Current branch, last verified | `recovery/inventory-audit-f7d08c4` |
| Current HEAD, last verified | `f7d08c40e8e51321adb4ee217ef7dfcf8070fece` |
| Checkpoint commit | `chore: checkpoint r3.4 repository certification hardening` |
| Original branch | `TINDIO-PREPRODUCTION` |
| Previous HEAD | `89292cd2351df790c5e119c23fbfe25026877ad1` |
| Remote | `https://github.com/razzeysphinx/TINDIOPOS` |
| Package manager | pnpm 10.34.5 |
| Supabase CLI | 2.115.0 |
| Local Postgres configuration | Major version 17 |
| Local Supabase project ID | `TINDIO_POS` |

No recovery changes have been pushed. No new commit was created after the checkpoint.

Repository instructions require reading the relevant installed Next.js documentation under `node_modules/next/dist/docs/` before writing Next.js code. The installed Next.js version is 16.3.1.

Use `pnpm.cmd` in PowerShell. Docker is installed in a nonstandard per-user location:

```text
C:\Users\peral\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe
```

Commands used successfully:

```powershell
$env:Path = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin;$env:Path"
$env:SUPABASE_TELEMETRY_DISABLED = '1'
pnpm.cmd exec supabase --version
```

Docker and Supabase required execution outside the workspace sandbox. Earlier claims that they were uninstalled were incorrect: Docker was outside PATH, and sandbox restrictions affected CLI execution.

## 3. Protection and current working changes

The recovery branch preserves the committed R3.4 checkpoint.

The last verified working tree contained exactly:

```text
 M scripts/certify-repository.mjs
?? supabase/migrations/20260916100000_inventory_stock_page_lint_repair.sql
?? supabase/tests/database/inventory_stock_page_execution.test.sql
```

The generated database type file was temporarily regenerated. Its content matched the checked-in schema contract; the apparent change was line endings. It was restored to CRLF and no longer appeared dirty.

Do not discard these three files. Review their current contents before continuing.

### Important database protection limitation

The existing local Supabase stack was reset repeatedly with explicit `--local` commands. Those resets recreated the local database from migrations and seed data.

There was **no recorded backup of the local database before its first reset**. Therefore:

- The original local database contents cannot be treated as preserved evidence.
- The current local database is a reconstructed test baseline.
- No remote database was inspected or modified during this phase.
- Do not describe this as a production-data recovery or a verified production-data reconciliation.

## 4. R3.4 work completed before the redesign

Earlier work created the repository certification engine and repaired several stale source checks.

The checkpoint included:

```text
package.json
scripts/certification-local-target-preflight.mjs
scripts/certify-repository.mjs
scripts/context-help-check.mjs
scripts/inventory-offline-performance-integrity-check.mjs
scripts/phase-2-back-office-navigation-check.mjs
scripts/phase-3-dashboard-access-check.mjs
src/app/(back-office)/back-office/inventory/page.tsx
```

The application pagination change requests 51 movement rows for a 50-row page so the UI can detect whether another page exists.

Two known automated tests still expect the old 50-row query:

1. `test:inventory-performance-accessibility`
2. `test:inventory-adjustment-activity`

Both failed on a source-text assertion expecting:

```text
activityPageOffset + INVENTORY_ACTIVITY_PAGE_SIZE - 1
```

The current application fetch intentionally uses:

```text
activityPageOffset + INVENTORY_ACTIVITY_PAGE_SIZE
```

These tests remain unfinished. They were not repaired during the latest database recovery work.

The certification catalogue previously discovered 60 package test commands:

- 59 automated.
- One manual integration test: `test:tenant-load`, requiring an authenticated application session.

Do not report full static certification as passing.

## 5. Audit scope actually completed

The audit inspected major inventory application paths, relevant SQL migrations, authorization helpers, database tests, source checks, local Git heads, and recent inventory history.

A filename-based search identified **177 candidate files** matching inventory, stock, transfer, purchasing, product, variant, RBAC, permission, or audit terms.

That number is a discovery result—not proof that every connected file was fully read or every dependency traced. A complete durable dependency inventory has not yet been written.

Major areas examined:

- Inventory and replenishment pages.
- Inventory actions, schemas, workspaces, and permissions.
- Catalog adjustment entry points.
- POS incoming transfer handling.
- Ledger/projection schema and posting helpers.
- Transfer, receiving, count, valuation, and authorization migrations.
- Schema-contract v3.
- Existing database test suites.
- Certification scripts.

## 6. Current inventory architecture

The system already has a substantial inventory foundation.

```text
UI / server-rendered page
    ↓
Server action / API
    ↓
Public Postgres RPC
    ↓
Private authorization and transaction functions
    ↓
Inventory document + inventory movement + balance projection
    ↓
Audit/history and scoped read models
```

### Core entities

- `organizations`
- `stores`
- `products`
- `product_variants`
- `product_store_settings`
- `inventory_levels`
- `inventory_movements`

The stock identity is effectively:

```text
organization_id + store_id + product_id + variant_id
```

`inventory_levels` uses a `UNIQUE NULLS NOT DISTINCT` constraint for this identity, supporting simple products with a null variant.

### Quantity and ledger

- `inventory_levels` stores current quantity.
- `inventory_movements` stores signed changes, quantities before/after, movement type, actor, reason, and document references.
- Ledger constraints require `quantity_after = quantity_before + quantity_delta`.
- Later migrations add metadata and append-only enforcement.
- `private.apply_inventory_change_v2` provides a shared posting mechanism with stock projection locking and ledger insertion.
- Modern receiving, transfers, adjustments, production, and other workflows use this foundation, but **complete proof that every stock writer follows one invariant remains unfinished**.

Use careful terminology: the ledger is the intended authoritative history; the balance table is the operational projection. Do not claim their reconciliation has been exhaustively proven across all paths.

### Documents

Existing tables include:

- Purchase orders and lines.
- Goods receipts and lines.
- Inventory counts and lines.
- Count batches and batch-document associations.
- Stock transfers and lines.
- Transfer receipts.
- Stock requests and request lines.
- Replenishment rules.
- Adjustment-related records and reasons.
- Supplier returns and production-related records.

### Main application files

- `src/app/(back-office)/back-office/inventory/page.tsx`
- `src/app/(back-office)/back-office/replenishment/page.tsx`
- `src/features/inventory/advanced-inventory-actions.ts`
- `src/features/inventory/supply-chain-actions.ts`
- `src/features/inventory/inventory-transfer-workspace.tsx`
- `src/features/inventory/inventory-count-workspace.tsx`
- `src/features/catalog/actions.ts`
- `src/lib/auth/inventory-capabilities.ts`
- `src/features/inventory/inventory-schema-contract.ts`
- `src/features/pos/pos-incoming-transfer-inbox.tsx`

## 7. Confirmed architectural overlap

### A. Two transfer orchestration paths

**Direct transfer**

```text
transferStockAction
    → create_direct_stock_transfer
    → source stock deduction
    → in_transit
    → receive_stock_transfer
    → destination stock increase
```

`transferStockAction` requires create and send capabilities. The inspected SQL also checks valid active stores, tracked items, source stock, availability in both stores, initialized destination projection, and operation identity.

**Request-backed replenishment**

```text
create_stock_request
    → approve_stock_request
    → start_stock_request_picking
    → dispatch_stock_request
    → receive_stock_request
```

Both routes use `stock_transfers`, but they maintain separate command orchestration and receipt entry points.

This overlap is confirmed. It is **not proof that either path is corrupt**. The next design decision is how to consolidate their shared lifecycle while preserving existing documents, permissions, and operational behavior.

### B. Two adjustment entry points

The legacy catalog action:

```text
adjustInventoryAction
    → public.adjust_inventory
    → private.adjust_inventory
```

The modern inventory action:

```text
recordInventoryAdjustmentV2Action
    → public.record_inventory_adjustment_v3
    → private.record_inventory_adjustment
```

The legacy path is still referenced by catalog forms and is an approval-aware public contract. It cannot be deleted as dead code.

The modern path carries a stable operation ID and uses granular inventory capabilities.

Before consolidation, trace opening-stock behavior, approval semantics, retry behavior, ledger metadata, and every caller of the legacy action.

### C. Mixed permission generations

Current granular capabilities coexist with compatibility permissions such as:

```text
inventory.manage
inventory.adjust
inventory.count
inventory.transfers
inventory.purchase_orders
inventory.receive
inventory.suppliers
```

This is partly deliberate compatibility logic. Some UI, exports, settings, and documentation still use broad manager permissions.

Do not remove the compatibility mapping until persisted role assignments are analyzed and an explicit permission migration preserves intended authority.

### D. Large composition and historical compatibility code

The inventory page includes many queries, transformations, modules, and compatibility paths. Several blocks are marked `CANDIDATE_FOR_REMOVAL`.

Those comments are not deletion authorization by themselves. Confirm callers, routes, links, tests, and user-facing replacement coverage first.

## 8. Git history findings

The inspected local heads were:

- `TINDIO-PREPRODUCTION`
- `recovery/inventory-audit-f7d08c4`

Both pointed to the checkpoint when checked.

The remote-tracking preproduction branch pointed to the prior commit. No fresh remote fetch was recorded, so these findings describe locally available Git state.

Relevant reachable history includes:

- Core inventory implementation.
- Count batches and round-trip imports.
- Direct transfer lifecycle.
- Granular transfer and purchasing RBAC.
- Database foundation/baseline work.
- Provider-neutral identity and authorization.
- RPC hardening and schema contracts v2/v3.
- R3.4 certification checkpoint.

A reachable commit has the message:

```text
2ce0109 feat: add inventory count batches, round-trip imports,
granular RBAC IF ANYTHING HAPPENS, DELETE THIS COMMIT AND REVERT
```

Do not follow that commit-message instruction. It is historical data, and reverting it would affect later dependent work.

Two unreachable commits were found:

- `a158cf916cbe3ee29834dd075165b34406305673` — database foundation verification runner.
- `3fb990336c5bc41e0dd76ee9fbf6a98c3f9aa2f7` — deterministic transfer RBAC migration rebuild.

Similar runner work exists in reachable history. No restoration candidate was established. Do not claim a complete forensic comparison of every unreachable object was performed.

## 9. Database recovery results

The local Supabase services run at:

- API: `http://127.0.0.1:54321`
- Database port: `54322`
- Studio: `http://127.0.0.1:54323`

Do not print local or remote secrets in subsequent logs. Earlier status commands emitted local development credentials; future status handling should capture and redact them.

### Original reconstructed baseline

Before the new repair migration:

- Existing migration history replayed successfully.
- 63 SQL test files passed.
- 1,282 assertions passed.

However, database lint then found an executable SQL defect that those tests did not cover. Passing tests did not establish complete database correctness.

### Confirmed SQL defect

`public.get_inventory_stock_page` had unqualified column references colliding with PL/pgSQL output parameters:

- `product_id` in the metrics CTE.
- `is_available` in the filtered CTE.

The first repair exposed the second collision. The completed forward migration qualifies the relevant metric and filter columns.

A temporary attempt to set `plpgsql.variable_conflict` was denied by Postgres. That approach did not succeed and is not part of the implementation.

### Final verified database state

After the forward migration:

- Full migration replay: pass.
- 64 SQL test files: pass.
- 1,286 assertions: pass.
- Database lint at error level: zero errors.
- Generated type contract: stable after line-ending normalization.
- `pnpm.cmd run certify:db`: pass.

This is local database certification. It does not establish production health, complete browser workflows, real concurrent-session safety, or overall redesign completion.

## 10. Exact uncommitted recovery changes

### A. Certification tooling

`scripts/certify-repository.mjs`

Changes:

1. Requests `supabase status --output json`.
2. Parses stdout as JSON rather than scanning stdout and stderr for every URL.
3. Validates string fields ending in `_URL` as local service targets.
4. Ignores documentation links in CLI advisory stderr.
5. Compares generated types after normalizing CRLF to LF.
6. Restores the original type-file text when generation changes only line endings.

Outstanding review:

- Add meaningful negative tests for the safety gate.
- Require critical fields such as `DB_URL` and `API_URL`, rather than merely any URL field.
- Reject missing, malformed, or incorrectly typed critical fields.
- Validate expected protocols as well as hostnames.
- Ensure generator failures also preserve the original type file.
- Check how certification should handle approved pending migrations; the current guard protects tracked historical files but allows untracked new migrations.

These are follow-up review points, not already verified behavior.

### B. Forward SQL migration

`supabase/migrations/20260916100000_inventory_stock_page_lint_repair.sql`

This recreates `get_inventory_stock_page` using its existing signature and logic, with explicit qualification in the metrics and filtering CTEs.

It preserves the existing grants and security-definer configuration. Historical migrations were not edited.

### C. Execution regression test

`supabase/tests/database/inventory_stock_page_execution.test.sql`

The rollback-based test creates an owner, organization, store, one simple tracked product, and one variable product with two variants.

It verifies:

1. Page-size enforcement.
2. Total stock-position count.
3. Distinct-product metrics.
4. Both expected products are returned.

**Coverage correction:** this is not a restricted-store authorization test. It supplies a selected store under an owner identity, but does not create another store or restricted user to prove exclusion. The previous final response overstated its store-scope coverage.

## 11. Verification status

| Check | Latest evidence |
|---|---|
| Local migration replay | Pass |
| Complete SQL suite | 64 files, 1,286 assertions pass |
| Database lint | Zero errors |
| Generated database types | Same schema content |
| `certify:db` | Pass |
| Stock-view source checks | Pass |
| RPC-contract source checks | Pass |
| Typecheck | Pass |
| ESLint | Pass |
| `git diff --check` | Pass |
| Production build | Passed earlier at checkpoint baseline; not rerun after latest recovery edits |
| Full static certification | Not passing; two known stale test assertions remain |
| Manual tenant-load test | Not completed |
| Browser inventory workflows | Not completed |
| Real simultaneous transaction tests | Not demonstrated |
| Global ledger/projection reconciliation | Announced but no completed result recorded |
| Remote/production verification | Not performed |

The existing count “concurrent reconciliation” suite tests movements around counting. Do not assume that its name proves overlapping transactions in separate database sessions.

## 12. Competitor research status

The preliminary report named:

- Square
- Shopify POS
- Lightspeed Retail
- Toast
- Clover
- Oracle Retail
- NCR Voyix/Aloha
- Revel
- Epos Now
- TouchBistro

**The requested current top-ten research is incomplete.**

There was no objective ranking criterion, and evidence depth varied significantly. TouchBistro was not substantiated with useful documentation in the recorded searches. Some Revel evidence was historical. The previous report overstated completion by saying all ten had been reviewed adequately.

Useful primary-source findings already gathered:

| Platform | Supported finding | Source |
|---|---|---|
| Square | Location transfer workflow and transfer history | [Stock transfers](https://squareup.com/help/us/en/article/8254-transfer-stock-between-locations-with-square-for-retail) |
| Shopify | Transfer documents, shipments, fulfillment, and receipt stages | [Creating and processing transfers](https://help.shopify.com/en/manual/products/inventory/inventory-transfers/creating-and-processing-transfers) |
| Lightspeed | Separate permissions for inventory operations | [Employee roles and access](https://retail-support.lightspeedhq.com/hc/en-us/articles/229129608-Setting-up-employee-roles-and-access) |
| Toast | Purchase orders and inventory receiving | [Purchase orders and receiving](https://support.toasttab.com/en/article/Toast-Retail-Generate-Purchase-Orders-Receive-Inventory) |
| Clover | Cross-location integration limitations | [Inventory API FAQ](https://docs.clover.com/dev/docs/inventory-faqs) |
| Oracle Retail | Transfer requests, direct transfers, shipping, receiving, and count integration | [Inventory integration](https://docs.oracle.com/en/industries/retail/store-inventory-op-cloud/24.0.201.0/reiag/integration.htm) |
| NCR | Inventory counting and location workflows | [Inventory counts](https://docs.ncrvoyix.com/restaurant/aloha-smart-manager/using/inventory/counting_inventory_and_managing_locations) |
| Epos Now | Draft/review counts and blind-count permissions | [Stocktake workflow](https://www.eposnow.com/us/resources/how-to-stocktake/) |

Finish a dated comparison across every requested dimension. Mark unavailable evidence explicitly. Vendor workflow documentation does not prove the vendor’s private database architecture.

## 13. Proposed architecture — not yet implemented

The proposal is to preserve useful existing structures and establish consistent command boundaries.

```text
UI
  → validated command
  → authenticated identity + capability + store scope
  → idempotency and document-state validation
  → atomic stock posting
  → ledger + projection + document updates + audit
  → shared scoped read model
```

### Inventory invariants

The design must formally specify and test:

- One stock identity per organization/store/product/variant.
- Quantities expressed in a defined base unit.
- Every committed stock change has a ledger record.
- Ledger posting and projection update commit atomically.
- Repeated requests do not duplicate stock changes.
- Conflicting reuse of an operation ID fails.
- Posted history is immutable.
- Corrections use traceable compensating entries.
- Cross-tenant references are rejected.
- Authorization is enforced inside database commands.
- UI calculations are presentation-only.

### Transfer lifecycle

The preliminary direction is one shared transfer lifecycle with optional request linkage.

Before implementing, settle and document:

- Draft creation versus immediate send.
- Whether a draft reserves stock.
- Source dispatch and destination receipt authority.
- Partial shipments and receipts.
- Shortage, damage, and over-receipt rules.
- Cancellation before dispatch.
- Return or loss accounting after dispatch.
- In-transit quantities and valuation.
- Retry and simultaneous-receipt behavior.
- Historical request-backed transfer compatibility.

An in-transit transfer cannot simply be marked cancelled while silently restoring or discarding stock. Physical custody and compensating movements must be explicit.

### Idempotency

A shared command registry was proposed, but has not been justified against all existing operation tables and unique constraints.

First map current idempotency behavior. Add a new registry only if it removes demonstrated duplication or closes a proven gap; do not create a second competing idempotency authority.

### RBAC

The proposed capability vocabulary includes viewing, adjustment creation/posting, count creation/finalization, transfer creation/sending/receiving, purchasing, settings, and valuation.

Some already exist; others are proposals. Do not assume `inventory.settings.manage` or any new capability is already present in the permission catalogue.

A migration must preserve intended access for existing custom roles and legacy bundles.

## 14. KEEP / RESTORE / IMPROVE / REBUILD / REMOVE / ADD

| Classification | Current direction |
|---|---|
| KEEP | Organization/store/product/variant model, ledger/projection foundation, immutable history, provider-neutral identity, useful existing SQL tests |
| RESTORE | No specific abandoned implementation established as worth restoring |
| IMPROVE | Runtime test coverage, certification safety, read-model correctness, RBAC consistency, documentation, deterministic pagination |
| REBUILD | Shared transfer orchestration and command ownership where dependency tracing proves duplication |
| REMOVE | Only verified obsolete UI/actions after callers and data compatibility are migrated |
| ADD | Missing behavioral tests, reconciliation evidence, real concurrency tests, explicit lifecycle contracts, durable audit documentation |

This classification remains provisional. Do not use it as blanket permission to delete files or rewrite schema.

## 15. Outstanding audit work

Before broad implementation:

1. Write a durable inventory dependency map with exact paths and current RPC signatures.
2. Enumerate every direct and indirect writer to stock projections and movements, including triggers, checkout, refunds, imports, opening stock, production, and returns.
3. Inspect the effective replayed database definitions, grants, constraints, triggers, and RLS policies—not just historical SQL text.
4. Map each capability through UI, server action, public RPC, private function, RLS, and persisted roles.
5. Compare legacy and modern adjustment semantics.
6. Trace both transfer paths through all lifecycle transitions and historical records.
7. Audit quantity precision, unit conversions, rounding, and cost snapshots.
8. Verify tenant-scoped relationships, including child-document foreign keys.
9. Establish reconciliation queries and run them on meaningful fixtures.
10. Finish the competitor comparison.
11. Reproduce reported user-visible failures in the local application.
12. Record evidence and severity for each issue; distinguish confirmed bugs from design debt and untested risks.

## 16. Recommended next execution sequence

Continue on the recovery branch and preserve the three existing changes.

1. **Reconfirm state.** Inspect branch, HEAD, worktree, local service target, and current diffs.
2. **Finish the verification foundation.** Review and test the certification parser changes, document the new SQL defect and its repair, and close the two stale pagination assertions with behavior-focused coverage.
3. **Establish reconciliation and concurrency evidence.** Exercise real commands across two stores and verify ledger/projection totals after each critical action. Use separate sessions for races.
4. **Complete transfer design.** Produce a precise lifecycle/permission/quantity table covering direct and request-backed transfers.
5. **Implement one controlled transfer slice.** Consolidate shared behavior with compatibility adapters and additive migrations. Preserve existing document history.
6. **Verify that slice end to end.** Database, RLS, server actions, browser UI, retries, partial receipt, failures, and tenant isolation.
7. **Then consolidate adjustments, counts, purchasing, and settings.** Apply the same dependency and evidence standard.
8. **Complete final certification.** Full automated checks, production build, manual integration flows, migration rehearsal, and rollback validation.

Do not present another isolated repair as completion of the full redesign.

## 17. Remaining required workflow verification

The full recovery still needs evidence for:

- Product and variant creation.
- Inventory assignment across stores.
- Opening stock.
- Receiving, including partial and duplicate requests.
- Adjustments and approval behavior where configured.
- Counts with intervening stock movement.
- Store A → Store B transfer.
- Partial receiving and discrepancies.
- Safe cancellation/failure/return handling.
- Low-stock thresholds and reorder calculations.
- Unit conversions and rounding.
- Valuation across transfers and receipts.
- Simultaneous commands against the same stock.
- Owner and custom-role access.
- Restricted source/destination store access.
- Tenant isolation.
- Audit trails and source-document navigation.
- Browser behavior and application error handling.

## 18. Rollback and deployment constraints

- Preserve checkpoint `f7d08c4` and the recovery branch.
- Use forward migrations; do not rewrite applied migration history.
- Do not delete ledger or posted document history.
- Back up any database containing valuable data before destructive testing.
- Use isolated test targets for migration rehearsal.
- Preserve compatibility until callers and persisted data are migrated.
- Verify rollback behavior before deployment.
- No remote migration, push, merge, or deployment has occurred in this recovery phase.

**Handover state:** local database certification passes after one forward SQL repair and certification-tooling corrections. The full inventory audit, competitor research, transfer consolidation, broader redesign, and end-to-end verification remain open.
