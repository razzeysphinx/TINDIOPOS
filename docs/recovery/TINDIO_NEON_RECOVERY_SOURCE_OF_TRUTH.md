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
