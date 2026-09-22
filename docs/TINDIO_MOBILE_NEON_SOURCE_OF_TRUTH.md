# TINDIO MOBILE + OFFLINE + NEON PROGRAM
## MASTER SOURCE OF TRUTH — LOCKED v1.0

Repository:
https://github.com/razzeysphinx/TINDIOPOS

Current primary/default development branch:
TINDIO-PREPRODUCTION

IMPORTANT:
Always verify the current repository HEAD before beginning work.
Do not assume this document's creation-time commit is still the latest.

---

# 1. PURPOSE

TINDIO is being evolved from a primarily Next.js web POS into a platform with three clearly separated layers:

1. TINDIO BACK OFFICE
   - Next.js web application
   - Used by owners, managers, administrators
   - Inventory
   - Purchasing
   - Employees
   - RBAC
   - Stores/registers
   - Reports
   - Settings
   - Device management
   - Sync management

2. TINDIO MOBILE POS
   - Native Android application
   - React Native + Expo + TypeScript
   - Distributed through Google Play
   - Local-first
   - SQLite-backed
   - Offline capable
   - Cashier/store-facing

3. TINDIO BACKEND
   - Shared by Back Office and Mobile POS
   - API
   - Domain/services
   - Authentication/identity
   - RBAC
   - Tenant/store enforcement
   - PostgreSQL business logic
   - Authoritative transactions
   - Eventually backed by Neon PostgreSQL

The Back Office is NOT "the backend."

Final conceptual architecture:

TINDIO BACK OFFICE ─────┐
                        │
                        ▼
                   TINDIO API
                        │
TINDIO MOBILE POS ──────┤
                        │
                        ▼
               DOMAIN / SERVICES
                        │
               AUTH / RBAC / RLS
                        │
                        ▼
                NEON POSTGRESQL
              GLOBAL SOURCE OF TRUTH

Mobile also contains:

TINDIO MOBILE POS
       │
     SQLite
       │
 Local-first reads
       │
 Durable Outbox
       │
   Sync Engine
       │
       ▼
   TINDIO API

---

# 2. PRIMARY PROGRAM OBJECTIVES

The final platform must support:

- Native Android TINDIO POS
- Google Play distribution
- Cold-start offline operation
- Local-first POS interactions
- Native SQLite persistence
- Durable offline checkout
- Durable generic operation/outbox architecture
- Device-level sequence tracking
- Server checkpoints
- Delta/change-feed synchronization
- Conflict detection
- Automatic reconciliation
- Multi-device store operation
- Store Local Mode
- Device Isolated Mode
- Disaster recovery
- Native barcode/printer/POS hardware
- Controlled offline payments
- Device fleet management
- Production monitoring
- Efficient database/API usage
- Neon PostgreSQL backend
- Strict multi-business isolation
- Strict multi-store access control
- Existing certified inventory correctness

---

# 3. ABSOLUTE NON-NEGOTIABLE RULE

## SCAN BEFORE MODIFYING

Before EVERY phase:

1. Scan the current repository.
2. Understand the existing implementation.
3. Compare existing architecture against the phase requirements.
4. Produce a gap matrix.
5. Classify each relevant component:

KEEP
KEEP + HARDEN
EXTEND
REFACTOR
REPLACE
REMOVE
NEW

6. Never implement the roadmap blindly.
7. Never replace an existing implementation merely because the roadmap describes a similar capability.
8. If the repository already contains an equivalent or stronger implementation:
   KEEP IT.
9. Harden or extend existing architecture wherever possible.
10. Replace only when a proven architectural defect or incompatibility exists.

Required decision flow:

CURRENT IMPLEMENTATION
        │
        ▼
IS IT CORRECT AND STRONG?
        │
   ┌────┴────┐
   │         │
  YES       NO
   │         │
   ▼         ▼
 KEEP      PARTIAL?
   │         │
 HARDEN   ┌──┴──┐
          │     │
         YES    NO
          │     │
       EXTEND  REPAIR/
               REPLACE

---

# 4. NO BIG-BANG REWRITES

Never perform a large uncontrolled architecture rewrite.

Required implementation pattern:

AUDIT
  ↓
SMALL VERTICAL SLICE
  ↓
TYPECHECK
  ↓
TEST
  ↓
BUILD
  ↓
DATABASE/SECURITY TESTS
  ↓
VERIFY BEHAVIOR
  ↓
COMMIT
  ↓
NEXT SLICE

Every major phase must end with a clean checkpoint commit.

Never combine unrelated architectural changes into one risky migration when they can be separated.

---

# 5. PROTECTED TINDIO CORE

The following current capabilities must be treated as protected architecture unless a test proves a defect.

DO NOT casually redesign these:

- Inventory ledger
- Inventory movements
- Inventory projections
- Inventory reconciliation
- Inventory operation IDs
- Inventory idempotency
- Checkout idempotency
- Atomic checkout
- Sales
- Payments
- Receipts
- Multi-store inventory
- Direct store transfers
- Request-backed transfers
- Purchasing
- Receiving
- Supplier returns
- Inventory counts
- Controlled adjustments
- Opening stock
- Composite production
- Replenishment settings
- Unit conversions
- Inventory valuation
- Shifts
- RBAC
- Store assignment
- Tenant/business isolation
- Provider-neutral identity foundation
- Device management
- Existing offline checkout safeguards
- Existing offline conflict handling

The current certified inventory system must remain authoritative.

---

# 6. CRITICAL BUSINESS / TENANT ISOLATION RULE

TINDIO is multi-tenant.

Business A must NEVER be able to read or mutate Business B data.

This applies to:

- stores
- registers
- products
- variants
- inventory
- inventory movements
- purchasing
- transfers
- customers
- employees
- users
- roles
- permissions
- reports
- receipts
- sales
- payments
- devices
- files
- settings
- synchronization data
- cached mobile data

Store permissions must also remain enforced.

A user assigned only to Store A must not gain access to Store B merely because a mobile request contains Store B's ID.

NEVER trust organization_id, store_id, role, permission, device_id, employee_id, or register_id from the client without server-side verification.

Mobile must use the same authoritative tenant/RBAC boundaries as Back Office.

---

# 7. MOBILE MUST NOT CREATE A SECOND BUSINESS ENGINE

Never create:

WEB INVENTORY ENGINE
+
MOBILE INVENTORY ENGINE

Never create:

WEB CHECKOUT LOGIC
+
MOBILE CHECKOUT LOGIC

Instead:

WEB CLIENT ─────┐
                │
                ▼
           TINDIO BACKEND
                │
MOBILE CLIENT ──┘
                │
        EXISTING DOMAIN LOGIC
                │
          AUTHORITATIVE DB

Mobile may calculate temporary UI estimates locally.

The backend remains authoritative for:

- official checkout
- official receipt creation
- inventory mutations
- refunds
- stock adjustments
- transfers
- shift reconciliation
- authoritative permissions
- official stock
- financial outcomes

---

# 8. OFFLINE INVENTORY RULE

Mobile devices must NEVER synchronize inventory by saying:

"Current stock = 47"

and overwrite central inventory.

Devices synchronize WHAT HAPPENED.

Example:

SALE_COMPLETED
product = Coke
quantity_delta = -3

The server applies the authoritative operation through the existing inventory ledger/business rules.

Correct:

Server stock = 50
Sale A = -3
Sale B = -5
Final authoritative stock = 42

Incorrect:

Device A says stock = 47
Device B says stock = 45
Last writer wins.

Never implement last-write-wins stock replacement.

---

# 9. LOCAL-FIRST / COST CONTROL RULE

The cloud database is the authoritative source of truth.

It is NOT the POS user interface's scratchpad.

Avoid unnecessary database/API requests.

Mobile should perform locally when safe:

- catalog search
- barcode lookup
- category filtering
- cart state
- cart calculations
- cached product display
- cached stock estimation
- tax display
- cached discount rules
- cached configuration
- recent-product lookup
- local receipt display

Prefer:

USER
 ↓
SQLite
 ↓
instant result

instead of:

USER
 ↓
API
 ↓
database
 ↓
response

Authoritative server validation remains required where financially or operationally necessary.

---

# 10. DATABASE COST OPTIMIZATION PRINCIPLES

Explicitly optimize:

- query count
- rows scanned
- query complexity
- payload size
- API invocations
- serverless executions
- database compute
- Realtime usage
- polling
- network bandwidth
- cache utilization
- indexes
- pagination
- batching
- delta synchronization

Avoid aggressive polling.

Do NOT design:

every second:
"Anything changed?"

Prefer:

- local SQLite
- delta sync
- change revisions
- controlled background synchronization
- selective Realtime only where immediacy matters

Realtime should be reserved for appropriate workflows such as:

- customer display
- important live register/store events
- KDS/order coordination
- urgent store changes

Do not subscribe every device to every table and every historical record.

---

# 11. SYNC PRINCIPLES

Eventually every durable mobile operation should have sufficient metadata for safe synchronization.

Target model:

event_id
idempotency_key

organization_id
store_id
register_id
device_id
employee_id
shift_id

device_sequence

event_type

created_at
payload

sync_state
retry_count

server_received_at
server_committed_at

server_checkpoint
server_revision

Possible states:

LOCAL_PENDING
SYNCING
ACKNOWLEDGED
CONFLICT
FAILED

Do not add fields merely for appearance.
Implement only when required by the relevant phase.

---

# 12. IDEMPOTENCY RULE

All financial and stock-changing operations that can be retried must use stable operation/idempotency identities.

Scenario:

Client sends operation.
Server commits.
Connection dies before response.
Client retries.

Correct outcome:

ONE sale
ONE payment
ONE inventory movement
ONE official receipt

Never duplicate a transaction because acknowledgement was lost.

Existing TINDIO idempotency implementations must be preserved and reused.

---

# 13. ATOMIC TRANSACTION RULE

A checkout must never end as:

sale created
payment created
inventory failed
receipt missing

Authoritative operations must be atomic where required:

BEGIN
  validate
  create sale
  create sale items
  create payment
  apply inventory movement
  create receipt
COMMIT

Failure:

ROLLBACK

Either the authoritative operation succeeds consistently or fails safely.

---

# 14. CONNECTION MODES

Final TINDIO Mobile connection model:

## CLOUD ONLINE

Cloud reachable.
Store network reachable.

## STORE LOCAL

Cloud/internet unavailable.
Local store network/hub available.

## DEVICE ISOLATED

Cloud unavailable.
Store hub/LAN unavailable.
Individual POS operates independently through SQLite and local outbox.

## RECOVERING

Connectivity restored.
Queues are being replayed and reconciled.

## SYNC REVIEW

One or more conflicts require attention.

Do NOT report ONLINE immediately after network connectivity returns.

Required flow:

NETWORK RETURNS
 ↓
RECOVERING
 ↓
PUSH OUTBOX
 ↓
VALIDATE ACKNOWLEDGEMENTS
 ↓
PULL DELTA CHANGES
 ↓
CHECK CHECKPOINTS
 ↓
CHECK CONFLICTS
 ↓
QUEUE EMPTY / SAFE
 ↓
ONLINE

---

# 15. UNSYNCED DATA SAFETY

Never allow destructive operations to silently destroy pending business transactions.

Potentially protected actions include:

- logout
- business switch
- local database reset
- device removal
- unregister device
- app data reset workflow
- register reassignment

If unsynced transactions exist, either:

1. synchronize them successfully,
2. transfer/recover custody through an explicitly authorized recovery workflow,
3. or block the destructive action.

Never silently discard pending transactions.

---

# 16. OFFLINE PAYMENT SAFETY

Current offline cash support is valid and should be preserved.

Electronic/card offline support must only be introduced through a payment provider that explicitly supports compliant store-and-forward/offline payments.

TINDIO must NEVER store:

- raw PAN/card number
- CVV
- sensitive authentication data

inside ordinary SQLite or application files.

Offline payment rules may later include:

- maximum transaction amount
- maximum offline cumulative amount
- maximum offline duration
- manager approval threshold
- allowed payment type
- device-specific policy

---

# 17. DATABASE MIGRATION PRINCIPLE

TINDIO will migrate its primary PostgreSQL database architecture toward Neon.

Neon is PostgreSQL, but Supabase currently provides more than PostgreSQL.

Therefore migration must distinguish:

- PostgreSQL database
- Auth
- SSR sessions
- RLS
- RPC/functions
- Realtime
- API/client behavior
- generated types
- storage, if used

Never assume replacing Supabase PostgreSQL with Neon automatically replaces all Supabase capabilities.

Do not migrate authentication and database infrastructure recklessly at the same time.

The provider-neutral TINDIO identity model must remain the stable business identity layer.

---

# 18. BACKEND V1 ARCHITECTURE LOCK

The mobile application must NOT be heavily developed against a database architecture that is immediately going to be replaced.

Therefore:

PHASES 00–03
 ↓
PHASE 04 NEON MIGRATION
 ↓
PHASE 05 NEON STABILIZATION
 ↓
BACKEND V1 ARCHITECTURE LOCK
 ↓
PHASE 06 NATIVE MOBILE DEVELOPMENT

After Phase 05 certification:

- core backend contract is stabilized
- database provider is stabilized
- security is certified
- mobile development can proceed against Backend V1

Changes after that require explicit compatibility consideration.

---

# 19. LOCKED FINAL PHASE STRUCTURE

DO NOT RENUMBER OR REORDER THESE PHASES WITHOUT EXPLICIT USER APPROVAL.

This is the canonical program plan.

---

## PHASE 00 — PROTECT CERTIFIED BASELINE

Goal:
Protect current TINDIO before architectural work.

Tasks:

- scan repository
- verify current branch/HEAD
- preserve certified inventory behavior
- preserve checkout
- preserve RBAC
- preserve tenant isolation
- verify CI
- update workflows where necessary
- create focused mobile architecture development branch
- establish baseline certification

Gate:

typecheck PASS
lint PASS
build PASS
security PASS
offline integrity PASS
inventory certification PASS
tenant isolation PASS
clean working tree

---

## PHASE 01 — POS / BACKEND API SEPARATION

Goal:
Make POS functionality consumable independently of Next.js Server Actions.

Audit:

- current /api/pos/* routes
- POS Server Actions
- data.ts
- service.ts
- checkout-service
- shift actions
- customer actions
- ticket actions
- receipt actions
- transfer actions
- device actions

Create missing transport-neutral API boundaries.

Do NOT duplicate service/domain logic.

Gate:
Every required mobile cashier workflow has a stable backend path.

---

## PHASE 02 — MOBILE-SAFE AUTHENTICATION + TENANT/STORE ISOLATION

Goal:
Support native authentication transport while preserving current identity/RBAC.

Target:

WEB
cookie/session
 ↓

TINDIO IDENTITY

MOBILE
Bearer access token
 ↓

TINDIO IDENTITY

Both must resolve:

organization
employee
profile
roles
permissions
assigned stores
device/register context

Certify:

cross-tenant denial
cross-store denial
revoked user
revoked device
tampered IDs

Gate:
Mobile API cannot bypass current tenant/store security.

---

## PHASE 03 — SHARED CONTRACTS

Goal:
Create common schemas/contracts for Web, Mobile and Backend.

Potential contracts:

CheckoutRequest
CheckoutResult
CatalogItem
Customer
Store
Register
Shift
Receipt
Payment
Device
Permission
OfflineEvent
Conflict
SyncAck
SyncCursor

Reuse existing Zod/types when strong.

Do not reorganize the repository unnecessarily.

Gate:
Mobile and Web do not maintain conflicting definitions of the same backend contract.

---

## PHASE 04 — NEON READINESS + DATABASE MIGRATION

Goal:
Move the authoritative PostgreSQL database architecture to Neon safely.

Subtasks:

1. Supabase dependency audit
2. PostgreSQL vs Supabase-specific feature classification
3. Auth/session dependency audit
4. RLS audit
5. RPC/function audit
6. database adapter/repository hardening where useful
7. Neon migration environment
8. schema migration
9. function/index/trigger migration
10. test-data migration
11. production-data migration strategy
12. inventory reconciliation
13. checkout certification
14. tenant isolation certification
15. concurrency/idempotency certification
16. migration rehearsal
17. rollback rehearsal
18. cutover

Do NOT destroy existing database business semantics.

Gate:
Equivalent certified behavior on Neon.

---

## PHASE 05 — NEON STABILIZATION + FINAL BACKEND CERTIFICATION

Goal:
Run the full TINDIO application against Neon and stabilize it.

Certify:

Back Office
POS web
inventory
sales
checkout
payments
receipts
RBAC
multi-store
multi-tenant
transfers
purchasing
offline sync
devices
reports

Measure:

query performance
connections
database load
API behavior

After successful completion:

================================
BACKEND V1 ARCHITECTURE LOCK
================================

---

## PHASE 06 — NATIVE ANDROID FOUNDATION

Goal:
Create actual TINDIO Mobile POS.

Preferred baseline:

Expo
React Native
TypeScript
Expo Router

Create:

login
business context
device enrollment
store/register selection
shift shell
POS shell
settings
sync status

Gate:
Native Android app authenticates and communicates with Backend V1.

---

## PHASE 07 — NATIVE SQLITE FOUNDATION

Goal:
Create persistent native local storage.

Potential local domains:

catalog
products
variants
categories
barcodes
prices
taxes
discounts
payment methods
customer cache
store/register context
shift snapshot
receipts
outbox
sync metadata
conflicts
checkpoints

Sensitive secrets:
use secure device storage.

Do NOT store sensitive credentials casually in SQLite.

Gate:
Local state survives app kill and phone restart.

---

## PHASE 08 — COLD-START OFFLINE POS

Goal:
Open TINDIO Mobile while the internet is already unavailable.

Validate cached:

identity authorization window
business
store
register
device
shift
configuration
catalog

Define security expiration and reauthentication rules.

Gate:
An enrolled terminal can reboot offline and safely resume permitted operations.

---

## PHASE 09 — LOCAL-FIRST ARCHITECTURE + DATABASE COST OPTIMIZATION

Goal:
Move frequent POS interactions away from cloud/database calls.

Localize:

product search
barcode lookup
category filtering
cart calculations
cached stock estimates
cached taxes
cached discounts
catalog browsing

Optimize:

indexes
pagination
payload size
batching
cache
Realtime
polling
database query count

Gate:
Normal cashier interaction does not constantly hit PostgreSQL.

---

## PHASE 10 — DURABLE EVENT / OUTBOX ENGINE

Goal:
Generalize safe offline operation handling.

Build on current OfflineQueuedCheckout concepts.

Potential operations:

SALE_COMPLETED
CUSTOMER_CREATED
SHIFT_EVENT
TICKET_CHANGED
TRANSFER_RECEIVED

Only allow workflows proven safe offline.

Gate:
Accepted offline operations survive app/process/device interruption.

---

## PHASE 11 — DEVICE SEQUENCE + SERVER CHECKPOINTS

Goal:
Detect incomplete sync.

Example:

Device events:

100
101
102
104

Server detects:

103 MISSING

Track:

device_sequence
server_checkpoint

Potential later hardening:

payload hashes
event-chain integrity

Only add complexity where justified.

Gate:
Missing, duplicate and out-of-order durable operations are detectable.

---

## PHASE 12 — DELTA SYNC + CLOUD RECONCILIATION

Goal:
Efficient two-way synchronization.

PUSH:

SQLite Outbox
 ↓
batch
 ↓
API
 ↓
server transaction
 ↓
ACK

PULL:

last revision/cursor
 ↓
server
 ↓
only changed records

Potential synchronized domains:

catalog
prices
configuration
taxes
discounts
customers
device configuration

Gate:
Normal reconnection does not require full-database reload.

---

## PHASE 13 — NATIVE CASHIER FEATURE PARITY

Port cashier workflows in controlled order:

catalog
cart
cash checkout
receipts
customers
shift controls
tickets
incoming transfers
time clock
business-type specific POS features

Reuse existing backend.

Gate:
Native mobile POS reaches defined cashier parity.

---

## PHASE 14 — OFFLINE INVENTORY INTELLIGENCE

Goal:
Give useful but honest inventory information offline.

Display distinctions such as:

LAST CONFIRMED CLOUD STOCK
KNOWN STORE-LOCAL ACTIVITY
DEVICE-ONLY ACTIVITY
ESTIMATED AVAILABLE STOCK

Never claim an isolated device estimate is globally authoritative.

Never overwrite central stock with local calculated state.

Gate:
Multiple offline devices cannot destroy authoritative inventory state.

---

## PHASE 15 — STORE LOCAL MODE / STORE HUB

Goal:
Allow devices in one physical store to coordinate when internet/cloud is unavailable.

Concept:

POS A ─┐
POS B ─┼── TINDIO STORE HUB
POS C ─┘

Hub may eventually support:

local acknowledgements
store event coordination
local stock awareness
KDS coordination
local printing support

Do this only after individual-device offline mode is stable.

Gate:
Cloud outage does not automatically isolate all terminals.

---

## PHASE 16 — ISOLATED DEVICE MODE

Goal:
Operate when both internet and store LAN/hub are unavailable.

Each POS:

SQLite
+
Outbox
+
Local runtime

Recovery path:

ISOLATED
 ↓
STORE LOCAL
 ↓
RECOVERING
 ↓
CLOUD ONLINE

Gate:
Independent devices recover without silent data loss or duplicate operations.

---

## PHASE 17 — SYNC CONTROL CENTER 2.0

Upgrade current Back Office Sync Center.

Display:

organization
store
register
device
employee
connection mode
app version
last heartbeat
last successful sync
device checkpoint
server checkpoint
queue depth
conflicts
offline duration

Possible status:

CLOUD ONLINE
STORE LOCAL
DEVICE ISOLATED
RECOVERING
SYNC REVIEW

Gate:
Sync problems cannot silently remain invisible.

---

## PHASE 18 — DISASTER RECOVERY + OFFLINE TORTURE TESTING

Deliberately test:

app kill during checkout
network loss before commit
network loss after commit
missing ACK
duplicate retry
out-of-order operations
missing sequence
phone reboot
router failure
API outage
database outage
expired token
revoked employee
revoked device
closed shift
changed price
changed tax
stock conflict
low storage
SQLite migration failure
100 queued operations
1000 queued operations

Required guarantees:

NO duplicate money
NO duplicate stock movement
NO silent transaction loss
NO cross-tenant leakage

Gate:
Recovery is deterministic and documented.

---

## PHASE 19 — NATIVE POS HARDWARE

Potential integrations:

camera barcode scanning
Bluetooth scanners
USB scanners
Bluetooth printers
USB printers
LAN printers
cash drawers
customer displays
KDS
NFC/payment terminals where appropriate

Use hardware adapters.

Do not mix device-specific logic directly into business/domain logic.

Gate:
Hardware failures cannot corrupt transactions.

---

## PHASE 20 — OFFLINE PAYMENTS + RISK ENGINE

Keep:

offline cash

Evaluate:

PSP-supported card store-and-forward

Potential policies:

offline payment allowed
max transaction amount
max total offline exposure
max offline duration
manager approval threshold

Never store forbidden card data.

Gate:
Electronic offline payments only operate through compliant provider functionality.

---

## PHASE 21 — MOBILE SECURITY + MULTI-TENANT CERTIFICATION

Attack:

Business A → Business B
Store A → unauthorized Store B
tampered organization ID
tampered store ID
tampered employee ID
tampered device ID
replayed credentials
stale authorization
revoked device
privilege escalation
modified offline payload

Also certify local cache isolation.

Business B must NEVER inherit Business A cached:

products
customers
receipts
inventory
events
configuration

Gate:
Cloud and local-storage tenant isolation certified.

---

## PHASE 22 — PERFORMANCE + DATABASE COST CERTIFICATION

Measure:

DB queries per checkout
DB queries per POS launch
API calls per cashier hour
rows scanned
query latency
payload size
catalog sync size
delta sync size
Realtime connections
SQLite search latency
sync throughput
recovery duration

Optimize based on measurements, not guesses.

Gate:
Operational cost and performance characteristics are understood.

---

## PHASE 23 — ANDROID PRODUCTION HARDENING

Prepare:

app signing
package ID
permissions
privacy handling
secure storage
network security
release build
crash handling
SQLite schema migrations
application updates
backward compatibility

Critical requirement:

App upgrades must not destroy unsynced events.

Gate:
Version upgrade/restart/recovery behavior certified.

---

## PHASE 24 — GOOGLE PLAY TESTING + RELEASE

Release flow:

development device
 ↓
internal testing
 ↓
closed testing
 ↓
pilot merchants
 ↓
production

Do NOT launch globally without real-store pilot validation.

Gate:
Production build passes real Android store scenarios.

---

## PHASE 25 — DEVICE FLEET MANAGEMENT

Back Office capabilities:

enroll device
assign business
assign store
assign register
disable device
replace device
view app version
view heartbeat
view sync status
view conflicts
view last contact

Deployment flow:

Install
 ↓
Authenticate
 ↓
Enroll
 ↓
Assign Store
 ↓
Assign Register
 ↓
Initial Sync
 ↓
Ready

Gate:
Owners can administer many terminals without manual database work.

---

## PHASE 26 — PRODUCTION OBSERVABILITY

Monitor operational health:

crash rate
API latency
sync latency
queue depth
sync failures
conflicts
app version
offline duration
device heartbeat
database health

Example:

STORE 12
REGISTER 4

Offline: 17 hours
Pending: 184
Checkpoint gap detected

ATTENTION REQUIRED

Avoid unnecessary exposure of sensitive merchant/customer transaction content in telemetry.

Gate:
Operational problems can be detected before they become silent business failures.

---

# 20. PHASE STATUS RULE

Every phase has one of these statuses:

NOT STARTED
AUDITING
IMPLEMENTING
VALIDATING
BLOCKED
CERTIFIED

Never mark a phase complete merely because code was written.

A phase is complete only when:

implementation ✓
tests ✓
security ✓
database integrity ✓
failure behavior ✓
build ✓
documentation ✓
clean commit ✓

Then status becomes:

CERTIFIED

---

# 21. BRANCH RULE

Branches are for meaningful high-priority work, not disposable recovery backups.

Preferred pattern:

mobile/phase-00-foundation
mobile/phase-01-api-separation
migration/phase-04-neon
mobile/phase-06-native-foundation

Avoid creating unnecessary branches for every minor fix.

Before deleting or merging a branch:

- verify unique commits
- verify changes exist in the intended primary branch
- verify certification
- never delete valuable unmerged work

---

# 22. COMMIT RULE

Use small, meaningful commits.

Examples:

feat(mobile-api): expose shift lifecycle endpoints
refactor(auth): add mobile bearer context adapter
feat(sync): add device checkpoint contract
test(tenant): certify cross-business mobile isolation
perf(pos): move catalog search to SQLite
migration(neon): port inventory ledger functions

Do not mix unrelated large changes into one commit.

---

# 23. DATABASE CHANGE RULE

Every database mutation requires:

- reason
- migration
- backwards-compatibility review
- tenant isolation review
- store-scope review
- idempotency review where applicable
- tests
- rollback/recovery consideration

Never modify production schema manually as the primary implementation path.

Schema changes must be represented in migrations.

---

# 24. SECURITY RULE

Never weaken:

RBAC
RLS/security boundary
tenant isolation
store assignments
device validation

just to make mobile development easier.

Never use:

"owner" name checks
client-only permission checks
hidden UI

as security.

Security must be enforced server/database side.

---

# 25. SOURCE OF TRUTH RULE

This file is the canonical architectural roadmap.

If another document, old prompt, branch note, generated plan, or AI response conflicts with this document:

THIS DOCUMENT WINS

unless the user explicitly approves a change.

Do NOT automatically modify the phase numbering or architecture because a future prompt casually suggests another structure.

Instead report:

"That request conflicts with the locked TINDIO Mobile Source of Truth."

Then identify the conflict before changing architecture.

---

# 26. CHANGE CONTROL

The roadmap is LOCKED but not stupidly immutable.

A change is allowed when repository evidence proves:

- current architecture is stronger
- a planned step is unnecessary
- an external platform requirement changed
- security requires a change
- Neon/mobile technical evidence requires adaptation

When this happens:

DO NOT silently modify the plan.

Instead produce:

PROPOSED SOURCE-OF-TRUTH CHANGE

Current rule:
...

Evidence:
...

Recommended change:
...

Affected phases:
...

Risk:
...

Wait for explicit approval before changing the canonical roadmap.

---

# 27. STARTING INSTRUCTION

When asked to begin or continue work:

1. Read this file.
2. Identify the current phase.
3. Scan the repository.
4. Verify branch/HEAD.
5. Produce a short audit:
   - existing implementation
   - protected components
   - gaps
   - proposed changes
   - files expected to change
   - database impact
   - security impact
   - test plan
6. Do NOT modify code until the audit supports the change.
7. Execute the smallest safe slice.
8. Run relevant gates.
9. Report results.
10. Commit only after validation.

If anything unexpected is discovered:

STOP.
DO NOT bulldoze through existing architecture.
Explain the discovery and adapt the implementation around the stronger current design.

---

# FINAL PRINCIPLE

TINDIO IS NOT BEING REBUILT.

TINDIO IS BEING EVOLVED.

Preserve the certified core.
Separate the platform properly.
Move PostgreSQL to Neon safely.
Build the mobile client around the backend.
Make operation local-first.
Keep the server authoritative.
Make synchronization durable.
Detect incomplete synchronization.
Minimize unnecessary cloud/database usage.
Protect every tenant.
Protect every store.
Protect every transaction.
Never trade data integrity for development speed.
