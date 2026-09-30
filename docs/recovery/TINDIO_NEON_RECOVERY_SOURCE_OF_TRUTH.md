TITLE:
TINDIO NEON RECOVERY SOURCE OF TRUTH

STATUS:
LOCKED RECOVERY PROGRAM

PARENT SOURCE OF TRUTH:
docs/TINDIO_MOBILE_NEON_SOURCE_OF_TRUTH.md

PURPOSE:
Repair the incomplete Supabase → Neon architecture migration without redesigning TINDIO business truth.

KEY DECISION:
Reuse valid TINDIO business logic and data.
Rewrite provider-specific / obsolete / inefficient database implementation.
Do not blindly copy all Supabase implementation.
Do not rebuild business logic from imagination.

CURRENT VERIFIED AUDIT:
- 96 public tables
- 7 private tables
- 188 public functions
- 254 private functions
- 398 indexes
- 148 policies
- all 96 public tables RLS-enabled
- 133 live non-adapter functions using auth.uid()
- no canonical live migration ledger
- 211 repository migrations
- 13 migrations newer than current baseline
- role_permissions high sequential-scan evidence
- Inventory page 59 static DB call sites

PROTECTED CORE:
inventory ledger
inventory idempotency
checkout idempotency
atomic checkout
sales/payments/receipts
tenant isolation
store isolation
RBAC
transfers
purchasing
counts
shifts
devices
offline/sync

FINAL TARGET:
Supabase = Auth + temporary Realtime
Supabase Auth remains the authentication provider during recovery.
TINDIO = identity/RBAC/business logic/services
Neon = authoritative business database

RECOVERY PHASES:
R0 through R9 exactly as defined in this packet.

NO BIG BANG:
Each recovery phase must validate and commit independently.

NO MOBILE PHASE RENUMBER:
There is NO Mobile Phase 27.

LIVE DATABASE SAFETY:
Current Neon stays authoritative until R6/R8 cutover.
R0–R5 do not destructively alter current Neon.

MIGRATION SAFETY:
Historical Supabase migrations remain untouched until R9.
They are source material, not the final installation path.

BASELINE RULE:
New canonical baseline is generated only after R1 drift evidence is reviewed.

PERFORMANCE RULE:
Do not create speculative indexes.
Use live evidence and query-shape evidence.

AUTH RULE:
Only provider adapter may directly depend on provider auth helper.
Business SQL must use TINDIO identity/RBAC boundary.

ROLLBACK RULE:
Current Neon remains rollback source until clean branch is certified.

R1 GATE REPAIR

The original audited historical migration set contains 211 migrations.

R1 discovered one real privilege defect:
open_tickets RLS depends on private.has_active_pos_shift_access(), but authenticated EXECUTE had been revoked.

One forward-only recovery migration was added to repair that privilege contract locally:

20260930111500_recovery_r1_pos_shift_rls_execute_grant.sql

Therefore during R1 completion:

211 historical migrations
+ 1 recovery forward migration
= 212 active local migrations

Historical migrations remain unmodified.

This recovery migration is NOT automatically applied to current live Neon during R1.

The canonical R2 baseline will absorb the final intended privilege state instead of preserving migration noise.

R1 FINAL GATE REPAIR

R1 local database lint detected SQLSTATE 42702 in:

public.get_pos_device_sync_checkpoint(uuid, uuid)

Cause:
The RPC RETURNS TABLE exposes device_id as a PL/pgSQL OUT variable while its INSERT used device_id in an unqualified ON CONFLICT column inference list.

Resolution:
A second recovery-only forward migration replaces only this function and uses:

ON CONFLICT ON CONSTRAINT pos_device_sync_checkpoints_pkey

Public RPC shape, authorization, checkpoint semantics, and authenticated-only execution remain unchanged.

Recovery migration:

20260930113000_recovery_r1_device_checkpoint_ambiguity_repair.sql

R1 active local migration count:

211 historical
+ 2 recovery forward
= 213

The migration is NOT applied to current live Neon during R1.

R2 will absorb the final intended function into the canonical baseline rather than carrying repair noise.

RECOVERY STATUS:

R0: COMPLETE
R1: COMPLETE
R2: NOT STARTED

R1 final generated DB type contract: CURRENT
Historical migration immutability: PASS
Dynamic recovery forward migration tracking: PASS
Full DB certification: PASS
Static certification: PASS
Lint: PASS
Root typecheck: PASS
Mobile typecheck: PASS
Build: PASS
R1 drift regenerated: PASS
FunctionPrivileges captured: PASS
Live Neon writes during R1: NO

R2 — CANONICAL BASELINE CONSTRUCTION

STATUS:
COMPLETE

SOURCE:
Certified clean local Supabase/PostgreSQL schema after R1.

INPUT HISTORY:
211 immutable historical migrations
+ 2 recovery-forward migrations

OUTPUT:
database/baseline/0001_tindio_baseline.sql
database/baseline/0001_tindio_baseline.manifest.json

BASELINE CHARACTERISTICS:
- schema-only
- TINDIO-owned public/private objects
- provider-owned auth/storage/realtime schemas excluded
- source ownership/session metadata removed
- provider administrative ACL metadata removed
- protected business schema captured
- current R1 winning definitions captured
- deterministic two-capture SHA256 verified

IMPORTANT:
R2 is a final-state snapshot, not yet the final provider-neutral installation.

Remaining direct provider identity, provider role, and PostgREST coupling are explicitly inventoried for R3/R4.

Historical supabase/migrations remain untouched and active until later cleanup.

Current live Neon remains authoritative and received zero R2 writes.

R2 BASELINE EVIDENCE:
- SHA256: c2c8183c6f02327e80e561b4b2b504887140586b0d5d03e068ae97132e18ef46
- bytes: 1975098
- lines: 42974
- active migrations: 213
- recovery-forward migrations: 2
- local source objects: 100 public tables, 7 private tables, 196 public functions, 257 private functions, 409 public indexes, 149 public policies, 204 public triggers, 2 private triggers, 0 public sequences, 10 private sequences
- auth.uid references in baseline: 167
- auth.user_id references in baseline: 0
- provider-role references: 698
- provider-coupled policies: 10

RECOVERY STATUS:
R0: COMPLETE
R1: COMPLETE
R2: COMPLETE
R3: NOT STARTED

R3 — PROVIDER-NEUTRAL SQL REWRITE

STATUS: COMPLETE

Input:
132 auth.uid-coupled functions
167 auth.uid references

Provider boundary:
private.current_identity_subject()
private.current_identity_email()

Business functions rewritten:
131

Canonical business identity:
private.current_profile_id()

The three existing public invoker RPCs retain their invoker security model and
resolve through the already authenticated-only public.current_profile_id()
wrapper; private.current_profile_id() remains inaccessible to every client role.

Local provider adapter:
database/provider/local/01_identity.sql

Neon provider adapter:
database/provider/neon/01_identity.sql

Canonical migration:
database/migrations/0002_provider_neutral_business_identity.sql

Canonical baseline after R3:
auth.uid = 0
auth.user_id = 0
auth.jwt = 0

Deferred to R4:
auth.role = 1
provider role dependencies
provider-coupled RLS policies

Historical 211 migrations unchanged.
Live Neon writes during R3: NO.

R3 BASELINE SHA256:
2a43bafc014116efde776ee1b66c9e9426c2a6b5fd4c56ffc013f37354e47d43

R0 COMPLETE
R1 COMPLETE
R2 COMPLETE
R3 COMPLETE
R4 NOT STARTED
