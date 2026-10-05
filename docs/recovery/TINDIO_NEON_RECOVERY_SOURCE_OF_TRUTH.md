# TINDIO NEON RECOVERY — SOURCE OF TRUTH v2.0

**Status:** LOCKED / USER APPROVED  
**Audit date:** 2026-10-01  
**Repository:** `razzeysphinx/TINDIOPOS`  
**Recovery branch:** `recovery/neon-canonical-rebuild`  
**Verified pre-lock remote HEAD:** `31b25905371f4cdd981eb4c3f231284d1c57ee2b`  
**Default branch:** `TINDIO-PREPRODUCTION`  
**Recovery branch relationship to default:** 50 commits ahead / 0 commits behind  

---

# 1. WHY THIS DOCUMENT EXISTS

The repository currently contains three overlapping planning documents:

1. `docs/recovery/TINDIO_NEON_RECOVERY_SOURCE_OF_TRUTH.md`
2. `docs/TINDIO_DATABASE_REBUILD_NEON_BLUEPRINT.md`
3. `docs/TINDIO_MOBILE_NEON_SOURCE_OF_TRUTH.md`

The current Recovery Source of Truth declares:

> `RECOVERY PHASES: R0 through R9 exactly as defined in this packet.`

However, the committed file currently defines only **R0 through R5**.

The older Database Rebuild Blueprint defines **R0 through R12**, with a different meaning for R6 onward.

The Mobile + Offline + Neon Source of Truth separately defines **Mobile Phases 00–26** and explicitly says phase numbering must not be casually changed.

Therefore the recovery program needs one complete, current recovery phase map before work continues beyond R5.

This locked v2.0 document completes that recovery map while preserving the separate Mobile 00–26 roadmap.

---

# 2. REPOSITORY AUDIT SNAPSHOT

Current recursive repository tree:

```text
Total tree entries: 1,388
Files: 1,145

src/: 375 files
apps/mobile/: 133 files
scripts/: 209 files
scripts/recovery/: 26 files
docs/: 66 files
docs/recovery/: 14 files
database/: 12 files
supabase/: 294 files
archive/database/supabase-migrations/: 213 files
supabase/tests/: 79 files
```

Canonical database structure currently exists:

```text
database/baseline/
  0001_tindio_baseline.sql
  0001_tindio_baseline.manifest.json

database/migrations/
  0002_provider_neutral_business_identity.sql
  0003_provider_neutral_roles_rls.sql
  0004_inventory_replenishment_read_models.sql
  0005_inventory_core_read_model_extension.sql
  0006_inventory_purchasing_read_model.sql

database/provider/local/
  00_roles.sql
  01_identity.sql

database/provider/neon/
  00_extensions.sql
  00_roles.sql
  01_identity.sql
```

This means the intended provider-neutral database foundation is real and is no longer only a planning concept.

---

# 3. CURRENT RECOVERY STATUS

```text
R0  COMPLETE
R1  COMPLETE
R2  COMPLETE
R3  COMPLETE
R4  COMPLETE

R5  COMPLETE
R6  COMPLETE
R7  COMPLETE
R8  COMPLETE
R9  COMPLETE
```

R5 current slices:

```text
R5-S1   COMPLETE
R5-S2   COMPLETE

  R5-S2B   COMPLETE + PUSHED + VERIFIED
  R5-S2C   COMPLETE + PUSHED + VERIFIED
  R5-S2D1  COMPLETE + PUSHED + VERIFIED
  R5-S2D2  COMPLETE + PUSHED + VERIFIED
  R5-S2E   COMPLETE
  R5-S2F   COMPLETE

R5-S3   COMPLETE
R5-S4   COMPLETE
R5-S5   COMPLETE
R5-S6   COMPLETE
```

The letters/numbers under an R phase are execution slices only.

They are **not new recovery phases**.

---

# 4. ARE WE STILL ON TRACK?

## YES — ARCHITECTURALLY

The implementation sequence currently matches the evidence-driven R5 plan:

```text
Inventory + Replenishment
→ Management + Catalog
→ POS + Dashboard + Reports
→ Shared DB boundary + residual hotspots
→ final performance certification
```

Current repository evidence shows that this priority order is still correct.

## R5 ORIGINAL STATIC BASELINE

Original R5-S1 baseline recorded:

```text
369 scanned source files
87 files with DB calls
272 .from() calls
177 .rpc() calls
449 total static DB call sites
```

## CURRENT D1-ERA EVIDENCE

The committed R5 evidence after the current Inventory work records:

```text
373 scanned source files
89 files with DB calls
218 .from() calls
179 .rpc() calls
397 total static DB call sites
```

Change from original R5 baseline:

```text
.from():
272 → 218
reduction = 54

total DB call sites:
449 → 397
reduction = 52
```

This is progress, not drift.

## INVENTORY / REPLENISHMENT PROGRESS

Original:

```text
Inventory page:
49 .from()
10 .rpc()
59 total

Replenishment page:
19 .from()
1 .rpc()
20 total
```

Current:

```text
Inventory page:
14 .from()
10 .rpc()
24 total

Replenishment page:
0 .from()
0 .rpc()
0 total
```

Inventory `.from()` reduction so far:

```text
49 → 14
```

Replenishment direct page fan-out:

```text
20 → 0
```

R5-S2D2 is designed to remove the remaining ordinary Inventory page table reads while retaining specialized bounded RPCs.

---

# 5. CURRENT REMAINING R5 HOTSPOTS

Current measured high-fan-out files include:

```text
src/features/management/data.ts
  30 DB call sites

src/app/(back-office)/back-office/inventory/page.tsx
  24 DB call sites before R5-S2D2

src/features/pos/data.ts
  22 DB call sites

src/features/inventory/advanced-inventory-actions.ts
  21 RPC sites

src/features/advanced-sales/service.ts
  18 DB call sites

src/features/catalog/service.ts
  18 DB call sites

src/features/management/service.ts
  17 DB call sites

src/features/customers/service.ts
  13 DB call sites

src/features/receipts/detail/data.ts
  13 DB call sites

src/features/catalog/data.ts
  12 DB call sites

src/features/customers/data.ts
  12 DB call sites

src/lib/auth/dal.ts
  10 DB call sites

src/app/(back-office)/back-office/shifts/page.tsx
  9 DB call sites

src/features/time-clock/data.ts
  8 DB call sites

src/features/dashboard/data.ts
  7 DB call sites
```

This directly supports the planned R5-S3, R5-S4 and R5-S5 order.

---

# 6. IMPORTANT DOCUMENTATION DEFECT FOUND

The current committed:

```text
docs/recovery/TINDIO_NEON_RECOVERY_SOURCE_OF_TRUTH.md
```

is incomplete.

It says:

```text
R0 through R9
```

but only defines:

```text
R0
R1
R2
R3
R4
R5
```

No committed R6, R7, R8 or R9 definitions currently exist inside that file.

The older:

```text
docs/TINDIO_DATABASE_REBUILD_NEON_BLUEPRINT.md
```

cannot simply fill this gap because it defines a different R6–R12 sequence.

Therefore R6 onward must be explicitly locked before execution reaches R6.

---

# 7. SOURCE-OF-TRUTH PRECEDENCE AFTER APPROVAL

If this v2 plan is approved and committed, precedence should become:

```text
1. docs/recovery/TINDIO_NEON_RECOVERY_SOURCE_OF_TRUTH.md
   → current Neon recovery program R0–R9

2. docs/TINDIO_MOBILE_NEON_SOURCE_OF_TRUTH.md
   → separate Mobile / Offline program Phases 00–26

3. docs/TINDIO_DATABASE_REBUILD_NEON_BLUEPRINT.md
   → historical architecture/reference blueprint

4. handovers / packet notes / screenshots
   → execution evidence, not phase-number authority
```

The Mobile 00–26 roadmap is NOT renumbered by the recovery program.

There is still no Mobile Phase 27.

---

# 8. LOCKED RECOVERY PRINCIPLES

The recovery program exists to repair the incomplete Supabase → Neon migration without rebuilding TINDIO business truth.

Final architecture remains:

```text
Supabase
  → Auth
  → temporary Realtime where still required

TINDIO
  → identity boundary
  → RBAC
  → domain/services
  → API contracts
  → business logic

Neon PostgreSQL
  → authoritative business database
```

Protected core:

```text
inventory ledger
inventory idempotency
checkout idempotency
atomic checkout
sales
payments
receipts
refunds
tenant isolation
store isolation
RBAC
transfers
purchasing
counts
shifts
devices
offline/sync
```

No phase may weaken these to make migration easier.

---

# 9. FINAL RECOVERY PHASE MAP — R0 THROUGH R9

# R0 — SAFETY + RECOVERY FREEZE

**Status:** COMPLETE

Purpose:

```text
establish isolated recovery branch
protect live/shared databases
record repository/database starting truth
prevent destructive accidental operations
```

Exit:

```text
safe branch
safe local target
known rollback source
no live destructive write
```

---

# R1 — CANONICAL LOCAL SCHEMA RECOVERY

**Status:** COMPLETE

Purpose:

```text
repair migration-chain blockers only enough to reproduce one correct local schema
run full local DB/security/application gates
capture drift evidence
```

Important outcome:

```text
211 historical migrations preserved
+ 2 forward recovery migrations
= 213 active local migrations
```

No historical migration rewrite.

No live Neon write.

---

# R2 — CANONICAL BASELINE CONSTRUCTION

**Status:** COMPLETE

Purpose:

```text
capture the proven final local PostgreSQL schema
produce deterministic provider-independent baseline
exclude provider-owned Supabase infrastructure
```

Output:

```text
database/baseline/0001_tindio_baseline.sql
database/baseline/0001_tindio_baseline.manifest.json
```

---

# R3 — PROVIDER-NEUTRAL IDENTITY SQL

**Status:** COMPLETE

Purpose:

```text
remove direct provider auth helpers from canonical business SQL
introduce TINDIO-owned identity boundary
```

Canonical identity:

```text
private.current_profile_id()
```

Provider adapters:

```text
database/provider/local/01_identity.sql
database/provider/neon/01_identity.sql
```

Canonical business baseline result:

```text
auth.uid() = 0
auth.user_id() = 0
auth.jwt() = 0
```

---

# R4 — ROLES / RLS / SECURITY NORMALIZATION

**Status:** COMPLETE

Purpose:

```text
remove provider-owned role names from canonical business security
normalize canonical access classes
preserve RLS/RBAC/tenant/store truth
```

Canonical roles:

```text
tindio_anon
tindio_authenticated
tindio_service
```

Provider role mapping remains in adapter SQL.

---

# R5 — DATABASE ACCESS + PERFORMANCE REWRITE

**Status:** COMPLETE

Purpose:

```text
reduce application/database round trips
remove high-fan-out direct read orchestration
keep hardened atomic RPCs where they are the stronger boundary
move provider access behind stable feature/database boundaries
prove performance with measurements
```

Performance method:

```text
MEASURE
→ IDENTIFY
→ CONSOLIDATE
→ REDUCE ROUND-TRIPS
→ VERIFY INVARIANTS
→ MEASURE AGAIN
```

No speculative index creation.

## R5-S1 — Static DB Access Baseline

**Status:** COMPLETE

Output:

```text
docs/recovery/evidence/r5-static-db-access.json
docs/recovery/evidence/r5-static-db-access.md
```

## R5-S2 — Inventory + Replenishment

**Status:** COMPLETE

Execution order:

```text
R5-S2B  Replenishment read consolidation
        COMPLETE + PUSHED + VERIFIED

R5-S2C  Inventory core read consolidation
        COMPLETE + PUSHED + VERIFIED

R5-S2D1 Purchasing read consolidation
        COMPLETE + PUSHED + VERIFIED

  R5-S2D2 Valuation + Activity reference cleanup
        COMPLETE + PUSHED + VERIFIED

  R5-S2E  Fan-out cleanup + regenerate measured evidence
        COMPLETE

  R5-S2F  Full Inventory/Replenishment certification
        COMPLETE
```

R5-S2 certification is complete.

## R5-S3 — Management + Catalog

**Status:** COMPLETE

Scope:

```text
management/data.ts
management/service.ts
catalog/data.ts
catalog/service.ts
related read boundaries
request-scoped client reuse where safe
```

Rules:

```text
preserve RBAC
preserve employee lifecycle
preserve store assignment
preserve product/store settings
preserve atomic command RPCs
```

## R5-S4 — POS + Dashboard + Reports

**Status:** COMPLETE

Scope:

```text
POS bootstrap/reference reads
Dashboard reads
Reports reads
bounded API/database access
```

Rules:

```text
do not break mobile API contracts
do not weaken checkout
do not weaken shifts
do not weaken offline sync
```

## R5-S5 — Shared DB Boundary + Residual Hotspots

**Status:** COMPLETE

Scope is evidence-driven after S2–S4.

Expected candidates currently include:

```text
advanced-sales
customers
receipts
auth DAL
shifts
time-clock
smart-menu
remaining device/offline reads
shared createClient/client-boundary duplication
```

This slice must use the newest DB-access census.

Do not blindly optimize every RPC.

Atomic/hardened RPCs may be intentionally correct.

## R5-S6 — Final Performance + R5 Certification

**Status:** COMPLETE

Required:

```text
regenerate full static DB census
compare against R5-S1
runtime request/query measurements
DB lint
pgTAP/database tests
tenant/store/RBAC tests
inventory invariants
checkout/sales/payment invariants
offline contracts
root typecheck
mobile typecheck
lint
build
static certification
performance evidence
```

Exit:

```text
R5 CERTIFIED
```

No R6 until R5-S6 is green.

---

# R6 — CLEAN NEON REBUILD + PORTABILITY CERTIFICATION

**Status:** COMPLETE

Purpose:

Build a fresh, isolated Neon target from the canonical recovery installation path.

R6 combines the still-relevant portability/readiness intent from the older rebuild blueprint into the current recovery sequence.

Required installation order conceptually:

```text
canonical baseline
→ provider-neutral identity
→ canonical roles/RLS
→ all approved R5 forward migrations
→ Neon provider adapters
```

R6 must prove:

```text
clean install from zero
no dependence on replaying 213 historical Supabase migrations
supported extensions
function/trigger/index creation
canonical grants
RLS
provider-neutral identity
plain PostgreSQL compatibility where applicable
Neon compatibility
fresh database certification
```

Important:

```text
Fresh isolated Neon target only.
No application production cutover.
Current Neon remains rollback/source-of-truth database.
```

Exit:

```text
fresh clean Neon schema certified
installation is reproducible
```

---

# R7 — DATA MIGRATION + RECONCILIATION

**Status:** COMPLETE

Purpose:

Move authoritative business data from the protected current database into the certified clean Neon target.

Before migration:

```text
capture source snapshot
capture row counts
capture financial/inventory invariants
verify source + destination identities
verify rollback
```

Migrate in dependency-safe order.

Certification must include:

```text
organizations
profiles/employees/RBAC
stores/registers/devices
catalog
customers/loyalty
inventory state
inventory ledger
transfers
purchasing
counts
sales
payments
receipts
refunds
shifts/cash
offline/sync authoritative server state
other business configuration
```

Required reconciliation:

```text
row counts
foreign keys
tenant ownership
store ownership
ledger/projection reconciliation
sales totals
payment totals
receipt continuity
refund relationships
inventory invariants
RBAC equivalence
cross-tenant negative tests
```

No application cutover while reconciliation is red.

Exit:

```text
fresh Neon contains certified equivalent business truth
```

---

# R8 — CONTROLLED CUTOVER + PRODUCTION CERTIFICATION

**Status:** COMPLETE

Purpose:

Switch TINDIO application database traffic to the newly certified Neon target using an explicit rollback gate.

Pre-cutover requirements:

```text
R0-R7 green
fresh Neon certified
data reconciliation green
backup/rollback ready
environment/config reviewed
migration window approved
```

Cutover certification:

```text
authentication/session bridge
Back Office
POS web
mobile POS API
inventory
transfers
purchasing
counts
sales
payments
receipts/refunds
shifts
customers
RBAC
multi-store
multi-tenant
devices
offline sync
reports
observability
```

Operational checks:

```text
error rate
query latency
connection behavior
API failures
sync failures
cross-tenant access
inventory reconciliation
financial invariants
```

If locked rollback criteria fail:

```text
ROLL BACK
```

Exit:

```text
new Neon target is authoritative
old Neon retained temporarily as rollback evidence
```

---

# R9 — LEGACY CLEANUP + RECOVERY CLOSURE

**Status:** COMPLETE

Purpose:

Only after successful R8 certification, remove obsolete recovery/migration baggage.

Allowed cleanup after evidence proves it is safe:

```text
archive historical Supabase migration chain from active install path
remove obsolete recovery-only scripts
remove superseded Neon/Supabase migration experiments
remove duplicate migration runners
remove dead provider/database adapters
remove duplicate validation responsibilities
update README/architecture docs
finalize canonical install instructions
```

Repository/branch closure:

```text
verify recovery branch contains all required work
merge recovery branch into intended primary/default branch
verify default branch HEAD and certification
only then consider deleting obsolete recovery/mobile migration branches
never delete unique unmerged work
```

Final recovery proof:

```text
one canonical install path
one authoritative recovery Source of Truth
clean Neon authoritative
protected business invariants certified
rollback evidence archived
R0-R9 documented
```

Exit:

```text
TINDIO NEON RECOVERY = CLOSED
```

Repository closure state:

```text
CLOSED — REPOSITORY ATTESTED
```

The recovery implementation merged normally into `TINDIO-PREPRODUCTION` as
`71dcd409c14ba9b8caef783d255614e4b47457e9` after protected certification and
preview checks passed. Repository closure is attested by the documentation-only
closure record; no branch or database resource deletion is authorized.

---

# 10. WHAT HAPPENS TO THE OLDER R0–R12 BLUEPRINT?

`docs/TINDIO_DATABASE_REBUILD_NEON_BLUEPRINT.md` remains valuable architecture history, but it must not compete with the active recovery phase numbering.

Its still-valid concerns are preserved as follows:

```text
Old R0-R5
→ represented by current Recovery R0-R5

Old plain PostgreSQL compatibility / Neon readiness concerns
→ absorbed into current R6

Old hosted Neon migration/rehearsal concerns
→ absorbed into current R6-R8

Old auth separation
→ provider-neutral identity boundary already handled in R3,
  while Supabase Auth remains intentionally supported during recovery

Old realtime separation
→ remains under the separate Mobile/Platform Source of Truth;
  it is not allowed to block database recovery unless evidence proves coupling

Old offline hardening
→ preserved and certified, not redesigned, during R5/R8
```

After v2 approval, the old blueprint is reference material, not active phase authority.

---

# 11. MOBILE PROGRAM REMAINS SEPARATE

Do NOT merge the Recovery R phases with Mobile Phases 00–26.

The repository already contains substantial Mobile implementation through Phase 26, including:

```text
native mobile foundation
SQLite/local caches
offline authorization
durable outbox
device checkpoints
delta sync
cashier parity
offline inventory intelligence
store-local mode
isolated device mode
sync control center
disaster recovery
hardware adapters
offline-payment risk
security certification
performance instrumentation
Android hardening
Google Play gates
device fleet management
production observability
```

The current recovery branch is also:

---

# Post-R9 certification-tenant lifecycle note

The guarded certification-tenant physical-delete dry run was intentionally
blocked by immutable terminal inventory-count history and rolled back without
deleting data or resources. Physical deletion is therefore unsupported for
that tenant. The chosen cleanup model is the existing generic organization
archive/deactivation lifecycle: retain history and identity linkage, remove
operational eligibility, block future writes, and exclude archived tenants
from normal selection. No production archival occurred in this design packet.
