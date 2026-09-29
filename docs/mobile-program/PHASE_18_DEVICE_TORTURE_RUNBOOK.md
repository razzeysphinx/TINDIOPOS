# TINDIO Phase 18 — Device Torture Runbook

## Rule

Run only with:

- development Android device/emulator
- non-production organization
- non-production store/register
- synthetic products/customers
- disposable test credentials

Never perform disaster tests against live merchant transactions.

## Required evidence per scenario

Record:

- date/time
- app version
- device ID
- organization/store/register
- starting local queue
- starting server checkpoint
- action performed
- observed app state
- final local queue
- final server checkpoint
- sale count
- payment count
- inventory movement count
- receipt count
- conflict/failure state
- PASS/FAIL

## PASS guarantees

Every scenario must preserve:

1. NO duplicate money
2. NO duplicate stock movement
3. NO silent transaction loss
4. NO cross-tenant leakage

---

## 01 — App kill during checkout

1. Prepare an offline cash sale.
2. Trigger local save/sync.
3. Kill the Android process while the event is `SYNCING`.
4. Relaunch.
5. Wait for interrupted-sync recovery.
6. Reconnect and synchronize.

Expected:
- same local event survives
- same idempotency key survives
- same device sequence survives
- event returns to retryable state
- exactly one authoritative sale/payment/inventory movement/receipt exists

---

## 02 — Network loss before commit

1. Queue one sale.
2. Disable transport before server commit.
3. Confirm local event remains unresolved.
4. Restore transport.
5. Retry same event.

Expected:

- no partial authoritative transaction before retry
- same event identity retries
- exactly one final transaction

---

## 03 — Network loss after commit

1. Queue one sale.
2. Allow server commit.
3. Drop client response/transport before ACK is received.
4. Retry same event.

Expected:

- server replay returns original transaction
- no second sale
- no second payment
- no second inventory movement
- no second receipt

---

## 04 — Missing ACK

Equivalent acceptance criteria to network-loss-after-commit.

The local event must not invent a new idempotency identity.

---

## 05 — Duplicate retry

Retry one already-committed event repeatedly.

Expected:

- one sale
- one payment
- one inventory movement
- one receipt
- replay returns same authoritative identity

---

## 06 — Out-of-order operations

Send sequence 2 before sequence 1.

Expected:
