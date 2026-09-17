# TINDIO Inventory — Canonical Transfer Lifecycle Design

**Design version:** 1.1
**Phase:** 04 — Transfer Lifecycle Design
**Repository baseline:** `e199d532621d2068dd7b1088c41a17a865df1965`
**Status:** Architecture contract for controlled implementation
**Implementation begins:** Phase 05 only
**Correction 01:** separates the seven canonical physical-transfer states from temporary legacy database compatibility states still written by unmigrated transfer workflows.

---

## 1. Purpose

TINDIO currently has multiple transfer command families that overlap in responsibility.

The redesign must converge physical store-to-store stock movement onto one explicit lifecycle without deleting history, rewriting applied migrations, bypassing the immutable inventory ledger, or breaking existing request/replenishment and direct-transfer callers before compatibility adapters exist.

The target transfer lifecycle is:

```text
draft
  ↓
submitted
  ↓
approved
  ↓
dispatched
  ↓
partially_received
  ↓
received

cancelled is terminal and is legal only before dispatch.
```

The core physical rule remains:

```text
source stock changes only at dispatch
destination stock changes only at receipt
```

No planning, drafting, submission, or approval step changes stock.

---

## 2. Current-state dependency map

### 2.1 Current command family — legacy immediate transfer

Current database surface:

```text
private.transfer_stock(...)
```

Current behavior:

```text
create transfer
→ TRANSFER_OUT source
→ TRANSFER_IN destination
→ complete inside one command
```

This command models instantaneous movement and bypasses physical in-transit custody.

**Target disposition:** legacy / retirement candidate.

It must not become the foundation of the canonical lifecycle.

It may be removed or have execution revoked only after a repository-wide caller and privilege audit proves that no supported caller still requires it.

---

### 2.2 Current command family — replenishment request

Current application commands:

```text
createStockRequestAction
approveStockRequestAction
startStockRequestPickingAction
dispatchStockRequestAction
receiveStockRequestAction
```

Current database commands:

```text
public.create_stock_request
public.approve_stock_request
public.start_stock_request_picking
public.dispatch_stock_request
public.receive_stock_request
```

Responsibility:

```text
stock_requests
= upstream demand / replenishment workflow

stock_transfers
= physical custody document created for the movement

stock_transfer_receipts
= physical receipt events
```

The stock request is **not** the long-term canonical physical transfer aggregate.

The stock request may retain request-specific statuses and discrepancy information while its physical movement is represented by one canonical `stock_transfers` aggregate.

---

### 2.3 Current command family — direct store transfer

Current application path:

```text
InventoryTransferWorkspace
→ transferStockAction
→ public.create_direct_stock_transfer
```

Current behavior:

```text
create + send are collapsed
→ stock_transfers.status = in_transit
→ source TRANSFER_OUT immediately
→ receive later
```

Current receipt path:

```text
receiveStockTransferAction
→ public.receive_stock_transfer
```

**Target disposition:** compatibility adapter over canonical lifecycle commands.

The current "Send transfer" UX may remain temporarily while its server/database implementation performs the canonical lifecycle transitions transactionally.

---

### 2.4 Current POS incoming transfer path

Current POS receipt selection:

```text
stockRequestId present
  → receiveStockRequestAction

stockRequestId absent
  → receiveStockTransferAction
```

The POS inbox is a receiving surface, not a separate stock authority.

**Target disposition:** both paths eventually call the same canonical receipt engine. Request-specific bookkeeping remains an adapter responsibility.

---

## 3. Canonical aggregate ownership

### 3.1 Physical transfer aggregate

The canonical physical movement aggregate is:

```text
stock_transfers
```

Canonical transfer lines are:

```text
stock_transfer_lines
```

Immutable receipt events are:

```text
stock_transfer_receipts
```

and their receipt-line records where already modeled.

The inventory ledger remains:

```text
inventory_movements
```

The current stock projection remains:

```text
inventory_levels
```

### 3.2 Source of truth by concern

```text
transfer lifecycle state
→ stock_transfers

planned/dispatched item identity and quantity
→ stock_transfer_lines

receipt event identity and quantities
→ stock_transfer_receipts + receipt lines

historical stock mutation
→ inventory_movements

current per-store stock
→ inventory_levels

replenishment intent
→ stock_requests

human/audit history
→ audit_logs + immutable operation documents
```

`stock_requests` must never become a second inventory ledger.

`stock_transfers` must never become a replacement for `inventory_movements`.

---

## 4. Canonical lifecycle

The only canonical physical-transfer states are:

```text
draft
submitted
approved
dispatched
partially_received
received
cancelled
```

No implementation may invent an additional physical-transfer status without updating this architecture contract first.

Request-specific statuses such as:

```text
picking
received_with_discrepancy
```

may remain temporarily on `stock_requests`.

They are not canonical `stock_transfers` lifecycle states.

Discrepancy is orthogonal to physical transfer lifecycle state.

### 4.1 Temporary legacy database compatibility states

The seven states above remain the **only canonical physical-transfer states**.

During incremental migration, the database status constraint must temporarily continue accepting legacy states still written by transfer workflows that have not yet been migrated:

```text
in_transit
completed
```

These are compatibility values, not canonical lifecycle states.

Current ownership:

```text
in_transit
→ current direct-store dispatch
→ current request/replenishment dispatch

completed
→ current request/replenishment physical transfer once receipt accounting is complete
```

Phase 05 migrates only the direct-store path.

Therefore:

```text
direct, non-request rows:
stock_request_id IS NULL
AND status = in_transit
→ may be backfilled to dispatched

request-linked rows:
stock_request_id IS NOT NULL
AND status IN (in_transit, completed)
→ remain unchanged until the request/replenishment migration
```

New canonical commands must never create `in_transit` or `completed`.

The temporary database constraint during Phase 05 may accept:

```text
draft
submitted
approved
dispatched
partially_received
received
cancelled
in_transit
completed
```

The compatibility values may be removed only after every legacy writer that can still produce them has been migrated and repository/database verification proves no supported caller depends on them.

---

## 5. Legal transitions

| From | Command | To | Stock effect |
|---|---|---|---|
| none | create draft | `draft` | none |
| `draft` | submit | `submitted` | none |
| `draft` | cancel | `cancelled` | none |
| `submitted` | approve | `approved` | none |
| `submitted` | cancel | `cancelled` | none |
| `approved` | dispatch | `dispatched` | source OUT exactly once |
| `approved` | cancel | `cancelled` | none |
| `dispatched` | partial receipt | `partially_received` | destination IN for newly received physical quantity only |
| `dispatched` | complete receipt/accounting | `received` | destination IN for newly received physical quantity only |
| `partially_received` | additional partial receipt | `partially_received` | destination IN for newly received physical quantity only |
| `partially_received` | final receipt/accounting | `received` | destination IN for newly received physical quantity only |

No other transition is legal.

Terminal states:

```text
received
cancelled
```

---

## 6. Cancellation rule

Cancellation is legal only before dispatch:

```text
draft
submitted
approved
```

Once stock has been dispatched, the physical goods have left the source store.

Therefore:

```text
dispatched
partially_received
received
```

cannot transition to `cancelled`.

A post-dispatch problem must be represented by physical receiving/discrepancy handling or by a future explicit compensating workflow.

TINDIO must never silently restore source stock merely because someone "cancels" an in-transit transfer.

That would falsify physical custody.

---

## 7. Stock-effect invariant

### Stock-neutral transitions

These commands never write inventory quantity:

```text
create draft
submit
approve
cancel before dispatch
```

### Dispatch

`approved → dispatched` must:

1. lock the transfer document;
2. validate source-store scope and send permission;
3. lock every source inventory key deterministically;
4. revalidate available source quantity;
5. write exactly one source `TRANSFER_OUT` movement per transfer line;
6. update `inventory_levels` through the canonical inventory mutation engine;
7. persist dispatch identity/time/actor;
8. commit the state transition atomically.

Destination quantity does not change at dispatch.

### Receipt

A receipt from `dispatched` or `partially_received` must:

1. lock the transfer document;
2. validate destination-store scope and receive permission;
3. validate receipt line identities;
4. compute previously accounted quantity from immutable receipt events;
5. reject over-receipt / over-accounting;
6. lock destination inventory keys deterministically;
7. insert one immutable receipt event;
8. write destination `TRANSFER_IN` only for newly physically received quantity;
9. never credit `short_quantity`;
10. set `partially_received` or `received` from cumulative line accounting;
11. commit receipt + ledger + projection + lifecycle transition atomically.

---

## 8. Partial receipt semantics

For each dispatched line:

```text
dispatched_quantity
```

is the maximum physical quantity that can ever be accounted for.

Cumulative accounting is:

```text
sum(received_quantity)
+
sum(short_quantity)
```

Rules:

```text
cumulative accounting <= dispatched quantity

received quantity
→ adds destination stock

short quantity
→ records final discrepancy
→ does not add destination stock
→ does not automatically restore source stock
```

### State calculation

If no receipt quantity has been accounted:

```text
dispatched
```

If at least one line has been accounted but at least one line still has unaccounted dispatched quantity:

```text
partially_received
```

If every dispatched line satisfies:

```text
received + short = dispatched
```

then:

```text
received
```

A transfer may therefore be:

```text
received
```

with discrepancy metadata.

Do not encode discrepancy as another canonical transfer lifecycle state.

---

## 9. Variant awareness

Every canonical transfer line is keyed by:

```text
organization_id
source_store_id
destination_store_id
product_id
variant_id
```

where `variant_id` may be null for a simple product.

The system must never merge:

```text
product A / variant X
```

with:

```text
product A / variant Y
```

Transfer payload normalization must reject duplicate product/variant keys.

Both source and destination projections must exist before dispatch unless a future explicit initialization command is designed.

---

## 10. Permissions and store scope

Existing capability catalogue remains the compatibility baseline:

```text
inventory.transfer.create
inventory.transfer.send
inventory.transfer.receive
```

`inventory.manage` remains a compatibility bundle through the centralized capability resolver; new canonical commands must not hard-code a new owner bypass.

### Create draft

Required:

```text
inventory.transfer.create
```

and valid organization membership / source-store scope.

### Submit

Required:

```text
inventory.transfer.create
```

and source-store scope.

### Approve

Required:

```text
inventory.transfer.send
```

and source-store scope.

### Dispatch

Required:

```text
inventory.transfer.send
```

and source-store scope.

### Receive

Required:

```text
inventory.transfer.receive
```

and destination-store scope.

### Cancel

From `draft` or `submitted`:

```text
inventory.transfer.create
```

plus source-store scope.

From `approved`:

```text
inventory.transfer.send
```

plus source-store scope.

Database authorization is final.

Application checks are UX preflight only.

---

## 11. Idempotency model

Every mutating lifecycle command requires a stable client operation ID.

The target lifecycle must not overload one transfer-level operation ID for every transition.

Phase 05 should introduce one canonical immutable operation registry for transfer transitions, conceptually:

```text
stock_transfer_operations
```

with at minimum:

```text
id
organization_id
stock_transfer_id
operation_id
command
normalized_payload
actor_employee_id
created_at
```

Required uniqueness:

```text
unique (organization_id, operation_id)
```

Required replay behavior:

```text
same operation ID
+ same command
+ same normalized payload
→ return original result / no duplicate mutation

same operation ID
+ different command or payload
→ reject
```

Existing:

```text
stock_transfers.operation_id
stock_transfer_receipts.operation_id
stock_requests.operation_id
```

must be preserved during migration for compatibility and historical evidence.

Do not drop them in the first implementation slice.

---

## 12. Concurrency and lock order

Canonical commands must use a deterministic lock order.

### Lifecycle command lock

Always lock:

```text
stock_transfers row
```

before applying a lifecycle transition.

### Dispatch stock locks

Then lock source projection rows in stable order:

```text
product_id
variant_id
```

### Receipt stock locks

Then lock destination projection rows in stable order:

```text
product_id
variant_id
```

No caller may mutate a transfer state based only on an earlier application read.

State must be re-read and validated inside the same database transaction that performs the mutation.

This protects:

```text
double dispatch
double receipt
stale status transitions
same-product transfer collisions
```

Phase 03 concurrency evidence remains part of the certification foundation and must continue passing throughout transfer consolidation.

---

## 13. Audit and accountability

Every successful lifecycle transition must retain:

```text
organization
transfer ID
human transfer number
command
from state
to state
actor
source store
destination store
operation ID
timestamp
optional note
```

Dispatch must remain tied to its source ledger movement.

Receipt must remain tied to its immutable receipt event and destination ledger movement.

No state transition may erase prior custody evidence.

---

## 14. Canonical command target

The target database command family is:

```text
create_inventory_transfer_draft
submit_inventory_transfer
approve_inventory_transfer
dispatch_inventory_transfer
receive_inventory_transfer
cancel_inventory_transfer
```

Public functions are thin authorized command surfaces.

Private functions own transactional implementation.

The exact SQL signatures are implemented in Phase 05 after final repository verification of this design.

Do not create them in Phase 04.

---

## 15. Compatibility adapters

The redesign must migrate callers before retiring older commands.

### Direct-store compatibility

Current:

```text
transferStockAction
→ create_direct_stock_transfer
```

Temporary target adapter:

```text
create_direct_stock_transfer
→ canonical create
→ canonical submit
→ canonical approve
→ canonical dispatch
```

inside one transaction, preserving the existing "Send transfer" UX while routing all stock mutation through the canonical engine.

The adapter still requires both:

```text
inventory.transfer.create
inventory.transfer.send
```

### Direct receipt compatibility

Current:

```text
receive_stock_transfer
```

Temporary target:

```text
receive_stock_transfer
→ canonical receive_inventory_transfer
```

### Replenishment compatibility

Current:

```text
dispatch_stock_request
```

must eventually materialize/link one canonical `stock_transfers` document and invoke the canonical dispatch engine.

Current:

```text
receive_stock_request
```

must eventually invoke the canonical receipt engine and then update request-specific discrepancy/status bookkeeping.

The stock request remains an upstream replenishment document.

### Legacy immediate command

Current:

```text
private.transfer_stock
```

must be quarantined and retired after caller/grant verification.

It must never be used as the canonical implementation because it credits destination stock before physical receipt.

---

## 16. Current-to-target state mapping

Canonical lifecycle targets remain:

```text
draft
submitted
approved
dispatched
partially_received
received
cancelled
```

### Direct-store legacy rows

For direct physical transfer rows:

```text
stock_request_id IS NULL
AND status = in_transit
→ dispatched
```

Phase 05 may perform this deterministic backfill because the direct-store path itself is being migrated in that phase.

Existing direct rows already in:

```text
partially_received
received
```

remain unchanged.

### Request/replenishment legacy rows

The request/replenishment workflow is intentionally not migrated in Phase 05.

Its physical transfer rows may still use:

```text
in_transit
partially_received
completed
```

Therefore Phase 05 must preserve request-linked:

```text
stock_request_id IS NOT NULL
AND status IN (in_transit, partially_received, completed)
```

without canonical backfill.

The later request/replenishment migration is responsible for converting its physical lifecycle to:

```text
dispatched
partially_received
received
```

and only after that conversion may the database drop legacy compatibility values.

### Request document statuses

Request-specific `stock_requests` statuses such as:

```text
picking
received
received_with_discrepancy
```

remain request metadata/workflow states.

They are not canonical `stock_transfers` lifecycle states.

### Fail-closed rule

If migration preparation discovers any `stock_transfers.status` outside:

```text
draft
submitted
approved
dispatched
partially_received
received
cancelled
in_transit
completed
```

implementation must stop and report the unmapped value.

No guessed mapping is allowed.

---

## 17. Forward-migration rules

Phase 05 must:

```text
use a new forward migration
never rewrite an applied migration
preserve existing transfer/receipt/history rows
backfill deterministically
retain compatibility functions until callers migrate
retain old operation IDs and human references
```

A migration must fail closed if it encounters a state it cannot map safely.

No destructive cleanup belongs in the same migration that introduces the canonical lifecycle.

Phase 05 must keep `in_transit` and `completed` temporarily legal in the `stock_transfers` database status constraint because the request/replenishment writer remains unmigrated.

Only direct, non-request `in_transit` rows may be backfilled to `dispatched` in Phase 05.

Request-linked `in_transit` and `completed` rows must remain unchanged until the request/replenishment migration.

---

## 18. Phase 05 controlled implementation slice

Phase 05 is deliberately narrow.

It should implement:

```text
canonical transfer lifecycle foundation
+
canonical transition/idempotency engine
+
direct-store compatibility adapter
+
direct direct-receipt compatibility adapter
+
tests
```

It should **not yet** migrate the replenishment stock-request workflow.

That gives TINDIO one controlled production slice:

```text
Store A
→ direct transfer adapter
→ canonical lifecycle
→ dispatch
→ Store B receipt
```

while request/replenishment remains operational on its existing path.

After Phase 05 is verified, a later controlled slice migrates:

```text
stock request
→ approval / picking
→ canonical transfer dispatch
→ canonical receipt
→ request-specific discrepancy bookkeeping
```

---

## 19. Phase 05 required verification

Before Phase 05 may be accepted, it must prove at minimum:

```text
draft is stock-neutral
submitted is stock-neutral
approved is stock-neutral

dispatch:
  source decreases once
  destination unchanged

partial receipt:
  destination increases only by actual received quantity
  remaining quantity stays in transit
  short quantity does not increase stock

final receipt:
  all lines accounted
  status becomes received

pre-dispatch cancellation:
  stock-neutral

post-dispatch cancellation:
  rejected

exact retry:
  no duplicate transition
  no duplicate ledger movement

operation-key payload mismatch:
  rejected

same-source-product concurrent dispatch:
  no lost update / no negative race

concurrent duplicate receipt:
  destination credits once

ledger ↔ projection reconciliation:
  zero anomalies

legacy direct "Send transfer" path:
  behavior preserved through adapter
```

The Phase 03 evidence framework remains mandatory.

---

## 20. Explicit non-goals of Phase 04

Phase 04 does not:

```text
change a production table
change a database function
change a status constraint
change application UI
change permissions
change stock
drop a legacy route
create a migration
perform competitor research
```

It establishes the architecture contract that makes those future changes controlled and reviewable.

---

## 21. Architecture decision summary

TINDIO will converge to:

```text
ONE physical transfer aggregate
ONE explicit lifecycle
ONE transition engine
ONE immutable stock ledger
ONE current stock projection
ONE canonical receipt engine
```

while preserving:

```text
replenishment requests as upstream planning documents
compatibility adapters during migration
existing history and human references
granular create/send/receive permissions
variant-aware quantities
partial receipt/discrepancy evidence
idempotency
concurrency safety
```

The central physical rule is permanent:

```text
SOURCE OUT AT DISPATCH
DESTINATION IN AT RECEIPT
```

Not before.
Not twice.
Not by UI convention.
By transactional database authority.
```
