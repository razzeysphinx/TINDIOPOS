# TINDIO Database Rebuild and Neon Migration Blueprint

## Objective

Rebuild the database side of TINDIO into a clean, deterministic, provider-neutral PostgreSQL foundation that can run locally in Docker today and move to Neon later without carrying forward the current historical migration corruption or Supabase-specific coupling.

This is a rebuild of the database installation and provider boundaries, not a redesign of TINDIO's business truth.

## Business invariants that must survive the rebuild

- No active shift means no POS transaction.
- Inventory movements are append-only ledger events.
- Inventory projections are derived/controlled state and are never silently rewritten.
- Cross-store stock moves only through accountable transfer documents.
- Financial refund and physical stock return remain separate.
- Stable operation IDs remain idempotent and retries cannot double-post stock.
- Organization and store isolation remain authoritative at the database/server boundary.
- Manager approvals remain auditable.
- Money remains integer minor units.
- Completed sales, receipts, refunds, and posted inventory documents remain immutable business records.

## Why rebuild instead of continuing to patch historical migrations

The project is still local/preproduction. That gives us an opportunity to replace a long, fragile historical migration chain with a clean baseline after the current schema is proven correct.

The existing migration history contains many incremental fixes and one known structurally corrupted transfer-RBAC migration. Continuing to patch that history increases risk and makes a later provider migration harder.

The target is therefore:

1. recover one canonical working local schema;
2. prove it with tests;
3. export a clean provider-neutral baseline;
4. archive/remove obsolete historical migration noise from the active migration path;
5. continue future changes with short, forward-only migrations.

## Target architecture

```text
UI / routes
    |
    v
feature actions/services
    |
    v
application repositories / command services
    |
    +--> auth boundary
    |
    +--> database boundary
    |
    +--> realtime boundary
    |
    v
PostgreSQL
```

Feature code must not know whether the database is Supabase Postgres, local Docker Postgres, or Neon.

## Target repository structure

```text
src/
  lib/
    auth/
      session.ts                 # provider-neutral application identity
      provider.ts                # auth provider interface
      supabase-provider.ts       # temporary migration adapter
      neon-provider.ts           # later
    database/
      client.ts                  # provider-neutral DB entry point
      transaction.ts
      errors.ts
      health.ts
    realtime/
      bus.ts                     # application realtime interface
      supabase-adapter.ts        # temporary
      server-events-adapter.ts   # target
  features/
    <feature>/
      data.ts                    # reads only
      service.ts                 # business commands
      actions.ts                 # thin web adapter

database/
  baseline/
    0001_tindio_baseline.sql
  migrations/
    <future forward-only migrations>
  provider/
    local/
      identity.sql
      roles.sql
    neon/
      identity.sql
      roles.sql
  tests/
    integrity/
    rbac/
    inventory/
    checkout/

supabase/
  migrations-legacy/             # archived only after baseline cutover
```

The exact folder cutover happens only after the clean baseline is proven.

## Rebuild phases

### R0 — Safety branch and freeze

- Work only on an isolated rebuild branch.
- Keep `TINDIO-PREPRODUCTION` untouched until the rebuild passes.
- Freeze new database feature work while the schema is being normalized.
- Preserve all canonical business behavior.

Exit condition: rebuild branch exists and no production/shared database is targeted.

### R1 — Recover a canonical local schema

Repair the current migration chain only enough to produce one deterministic, working local database.

Priority blocker:

`supabase/migrations/20260910142940_granular_inventory_transfer_rbac.sql`

Requirements:

- one transaction;
- one definition of each transfer procedure;
- no orphan PL/pgSQL fragments;
- no runtime source rewriting;
- no hidden capability GUC transport;
- granular capabilities are inside the correct functions;
- canonical stock/ledger/idempotency logic preserved.

Exit condition:

- local reset from zero succeeds;
- database tests pass;
- inventory tests pass;
- typecheck/lint/build pass.

### R2 — Create the clean baseline

Once R1 is green, create a schema-only baseline from the proven local database.

The baseline should include TINDIO-owned schemas and objects, not provider-owned Supabase infrastructure.

Include:

- public tables;
- private functions;
- sequences;
- indexes;
- constraints;
- triggers;
- TINDIO RLS policies;
- TINDIO grants/roles that are intentionally portable;
- comments that encode business/security intent.

Exclude or replace:

- Supabase internal auth tables;
- Supabase storage internals unless TINDIO explicitly owns a dependency;
- realtime internals;
- PostgREST schema reload notifications;
- provider-generated objects.

Exit condition: a fresh plain PostgreSQL Docker database can install the baseline without Supabase services.

### R3 — Introduce provider-neutral database identity

All TINDIO SQL currently depending directly on `auth.uid()` must move behind one TINDIO-owned identity function.

Target contract:

```sql
private.current_profile_id()
```

Application SQL, RLS policies, and security-definer functions reference only that TINDIO function.

Provider adapters implement it:

- local/Supabase compatibility adapter -> Supabase identity;
- Neon adapter -> Neon/JWT identity mechanism.

No business function should directly depend on a provider auth schema after this phase.

Exit condition: searching canonical baseline/business SQL finds no direct provider identity calls outside provider adapter SQL.

### R4 — Normalize database roles and grants

Remove hard dependency on provider-owned role names from business migrations.

Define TINDIO's intended access classes explicitly, then map the active provider to those access classes.

The migration must preserve:

- least privilege;
- server/database enforcement;
- custom roles and permission catalog behavior;
- organization/store scope.

Exit condition: role/grant logic is documented and provider mapping is isolated.

### R5 — Move application data access behind repositories

Existing direct Supabase `.from()` / `.rpc()` usage is migrated feature-by-feature.

Priority order:

1. inventory;
2. checkout/POS;
3. receipts/refunds;
4. shifts/cash;
5. catalog;
6. management/RBAC;
7. customers/loyalty;
8. reports;
9. kitchen/customer display.

Each feature follows:

```text
page/UI -> actions -> service -> data/repository -> database client
```

Rules:

- UI never owns authorization truth;
- actions validate input and delegate;
- services contain business orchestration;
- repositories contain SQL/data access only;
- no provider SDK calls inside feature UI components.

Exit condition: database provider can be changed in one cross-cutting layer instead of every feature.

### R6 — Separate authentication from TINDIO RBAC

Authentication answers: who is the user?

TINDIO RBAC answers: what may that user do in this organization/store?

Preserve TINDIO tables and rules for:

- profiles;
- employees;
- roles;
- permissions;
- employee roles;
- store assignments;
- invitations;
- manager approvals.

Only the authentication provider changes.

During transition, Supabase Auth can remain behind an adapter while database access is decoupled.

Later, Neon Auth can replace it without rewriting TINDIO RBAC.

### R7 — Replace provider-specific realtime

Current Supabase Realtime must not remain embedded in business UI logic.

Target interface:

```text
publish(topic, event)
subscribe(topic, handler)
unsubscribe(topic)
```

Initial adapter may keep Supabase Realtime while feature code moves behind the interface.

Target Neon-ready implementation should use an application-owned realtime path such as server-sent events or WebSockets backed by server-side authorization.

Priority realtime consumers:

- kitchen display;
- customer display;
- operational POS notifications.

### R8 — Preserve and harden offline-first sync

Offline POS must not depend on database provider details.

The client syncs against TINDIO-owned API contracts, not directly against provider tables.

Preserve states:

- Draft;
- Local Pending;
- Syncing;
- Synced;
- Conflict;
- Failed.

Server endpoints remain idempotent and validate organization/store/device/shift authorization before committing.

### R9 — Migration cleanup and historical archive

Only after the new baseline is proven:

- move obsolete historical migrations out of the active migration path;
- keep them in a legacy archive only if they still provide forensic/learning value;
- remove duplicate experimental migrations/scripts;
- remove temporary repair files;
- remove dead Neon/Supabase experiments that are not part of the final architecture;
- keep one authoritative migration runner and one authoritative test per concern.

Do not retain duplicate files that perform the same migration or validation responsibility.

### R10 — Plain PostgreSQL compatibility gate

Run the clean baseline against a plain local PostgreSQL Docker container.

This is the key portability test.

The database must work without Supabase Auth, Realtime, Storage, or PostgREST being present.

Provider adapters may be installed after the baseline.

Exit condition: core schema, functions, inventory, checkout, and RBAC tests pass against plain PostgreSQL.

### R11 — Neon readiness gate

Before creating or changing a hosted Neon database, verify:

- supported PostgreSQL version;
- required extensions;
- no unsupported Supabase internals;
- provider identity adapter ready;
- application database connection boundary ready;
- auth migration plan ready;
- realtime migration plan ready;
- backup/restore drill documented.

No hosted database is required to reach this checkpoint.

### R12 — Neon development migration

When explicitly authorized:

- create Neon development project/branch;
- apply baseline to a disposable branch;
- migrate test/development data only;
- run all database and application tests;
- compare row counts and integrity checks;
- test auth/RLS;
- test POS, inventory, transfers, purchasing, counts, refunds, shifts, and offline replay.

Do not cut over application configuration until this gate is green.

## Migration policy after the rebuild

Future migrations must be:

- forward-only;
- deterministic;
- explicit SQL;
- small enough to review;
- idempotent only where the operation semantics require it;
- free of source-code rewriting of existing functions;
- free of hidden session configuration used to transport authorization requirements;
- accompanied by structural/integrity tests when they redefine critical functions.

Never reconstruct a function by reading `pg_proc` source text and replacing strings.

When a function changes, check in the complete new function definition.

## Critical migration test gates

Every database change must pass, in order:

1. static migration structure checks;
2. repository-specific domain checks;
3. clean local database rebuild;
4. database SQL tests;
5. security/RBAC tests;
6. inventory ledger/idempotency tests;
7. TypeScript typecheck;
8. lint;
9. production build.

A text-presence test is not enough for critical SQL functions. Required permissions and invariants must be verified inside the intended function body.

## Inventory-specific truth to preserve

The rebuilt database must retain these document flows:

```text
Purchase Order -> Receive -> PURCHASE movement
Transfer/Request -> Dispatch -> TRANSFER_OUT
Transfer/Request -> Receive -> TRANSFER_IN
Count -> Finalize/Post -> COUNT movement
Adjustment -> Post -> ADJUST movement
Sale -> Checkout -> SALE movement
Physical merchandise return -> RETURN movement
```

Financial refund alone must never create inventory.

Inventory projection and ledger must remain mathematically reconcilable.

## Immediate execution order

1. harden migration structural tests;
2. repair/rebuild the corrupted granular transfer migration;
3. replay the existing local database from zero;
4. run the complete database/inventory/security suite;
5. generate the canonical baseline;
6. prove the baseline on plain PostgreSQL;
7. add provider-neutral identity/database/realtime boundaries;
8. migrate features away from direct provider access;
9. archive legacy migrations;
10. stop at the Neon-ready checkpoint until hosted migration is explicitly authorized.

## Definition of done

The rebuild is complete when:

- `TINDIO-PREPRODUCTION` can be replaced by a tested rebuild branch without losing business behavior;
- one clean baseline can construct the database from zero;
- new migrations are short and forward-only;
- no active business SQL depends directly on Supabase-only identity/realtime/PostgREST behavior;
- feature code does not depend directly on a database provider SDK;
- local Docker remains fully usable;
- plain PostgreSQL compatibility passes;
- Neon becomes a deployment choice instead of an application rewrite.
