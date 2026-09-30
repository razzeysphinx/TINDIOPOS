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
