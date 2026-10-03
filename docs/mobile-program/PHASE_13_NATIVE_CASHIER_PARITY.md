# Phase 13 — Native Cashier Feature Parity

## Implementation status

**IMPLEMENTATION COMPLETE**

## Certification status

**VALIDATING**

Full tests, build/export, Android runtime certification, and the deferred Phase 08–13 certification sweep remain intentionally deferred by the user.

## Implemented native cashier domains

- local-first SQLite catalog/search
- barcode/SKU lookup
- cart quantity controls
- fractional quantity validation
- line notes
- variable-price entry
- modifier selection using the existing POS V2 modifier contract/cache
- discounts and taxes
- dining option selection when enabled
- customer search using server + observed SQLite cache
- customer creation using existing backend service
- customer attachment to checkout
- online cash checkout through existing POS V2 checkout
- stable checkout idempotency identity across ambiguous retries
- durable offline cash sale through the existing Phase 10 `SALE_COMPLETED` outbox
- receipt list with observed offline summary cache
- structured receipt detail
- line-level refund selection
- stable refund idempotency identity
- receipt email delivery
- open-ticket load/save/update in POS
- ticket cancel/split/merge/move-line workflows
- shift open/close
- permission-gated PAY_IN/PAY_OUT using canonical cash-movement schema
- incoming transfer receipt line quantities/discrepancies
- time-clock employee discovery + clock in/out
- business feature/permission navigation gates

## Locked online/offline boundary

Durable offline mutation remains limited to:

```text
SALE_COMPLETED
```

The following remain online-only:

- customer creation
- receipt refund
- receipt delivery
- ticket mutations
- transfer receiving
- shift mutations
- cash movements
- time-clock mutations

No second mobile business engine was created.

No Phase 14 offline inventory intelligence was implemented.

No database migration was introduced by Phase 13.

## Architecture

```text
Native Mobile UI
    ↓
Existing POS V2 / Backend V1
    ↓
Existing domain/services
    ↓
Neon authoritative database
```

## Deferred certification

Still required later:

- root/mobile typecheck
- lint
- build/export
- Android runtime validation
- tenant/store/RBAC runtime checks
- ambiguous retry/idempotency runtime checks
- offline outbox replay runtime checks
- Phase 08–13 certification sweep

## Status marker

```text
PHASE_13_IMPLEMENTATION_COMPLETE_TESTS_DEFERRED
```
