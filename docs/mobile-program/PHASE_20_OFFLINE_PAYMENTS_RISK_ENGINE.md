# Phase 20 — Offline Payments + Risk Engine

## Implementation status

IMPLEMENTATION COMPLETE

## Certification status

VALIDATING

## Source-of-Truth gate

```text
Electronic offline payments only operate through compliant provider functionality.
```

## Repository evaluation

TINDIO currently has no concrete payment-service-provider adapter that proves compliant electronic store-and-forward support.

Therefore:

```text
OFFLINE CASH
ENABLED

ELECTRONIC OFFLINE
FAIL CLOSED
```

This is intentional.

TINDIO does not simulate card store-and-forward by storing card credentials itself.

## Existing offline cash

The existing native offline flow remains unchanged.

It requires a cached payment method where:

```text
type = CASH
offlinePolicy = cash
```

The server revalidates the same rule when queued sales return online.

## Electronic provider contract

Phase 20 introduces a provider adapter boundary.

A compliant adapter must explicitly declare:

```text
STORE_AND_FORWARD
```

TINDIO receives only an opaque provider result:

- provider code
- provider reference
- approved amount
- provider settlement state
- capture timestamp

TINDIO does not accept raw card credentials through the provider contract.

## Forbidden storage

TINDIO must never store offline in its own application data:

- PAN / card number
- CVV / CVC
- PIN / PIN block
- magnetic-stripe track data
- raw NFC payload
- EMV cryptogram owned by the provider

Sensitive capture belongs to the compliant PSP/terminal SDK.

## Risk engine

The Phase 20 engine evaluates:

- electronic offline enabled
- PSP store-and-forward support
- maximum transaction amount
- maximum total offline exposure
- maximum offline duration
- manager approval threshold

## Manager approval

The existing TINDIO manager approval system is server-based.

Phase 20 does not fake an offline manager PIN flow.

When policy requires manager approval but no compliant offline approval mechanism is available:

```text
MANAGER_APPROVAL_REQUIRED
```

and the electronic offline transaction is denied.

## Provider registry

Current registered electronic offline providers:

```text
0
```

This means electronic offline payment remains unavailable in the current build.

A future provider integration must be separately implemented and reviewed against that PSP's documented store-and-forward behavior.

## manual_external

Existing payment method policy:

```text
manual_external
```

is not treated as card store-and-forward.

It must not bypass PSP requirements.

## Durable outbox

Phase 20 does not widen the durable offline sale outbox to electronic payment.

Current offline durable sale remains cash-only.

A future PSP integration must define how opaque provider authorization references are reconciled without creating duplicate money.

## Database impact

Server migration:

```text
NONE
```

Mobile SQLite migration:

```text
NONE
```

This phase intentionally avoids inventing persistent electronic-risk settings before a real PSP/provider contract exists.

## Certification still required

When a real PSP is selected:

- verify PSP documentation explicitly supports store-and-forward
- verify PCI/compliance responsibilities
- verify what opaque references are safe for TINDIO storage
- test provider queue behavior
- test terminal reboot
- test long offline duration
- test duplicate authorization replay
- test provider settlement failure
- test exposure limits
- test amount limits
- test manager threshold
- test reconnect/reconciliation
- prove no duplicate charge

Until that occurs:

```text
Electronic offline payment = DISABLED
```

## Phase status

```text
PHASE 20
IMPLEMENTATION COMPLETE
STATUS: VALIDATING
CERTIFICATION: NOT CERTIFIED
```

Next canonical phase after review:

```text
PHASE 21 — MOBILE SECURITY + MULTI-TENANT CERTIFICATION
```