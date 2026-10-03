# Phase 24 — Real Android Store Test Matrix

## Rule

Run only with test/pilot merchant data until pilot approval.

Never use uncontrolled live merchant transactions for destructive failure testing.

Every scenario records:

- app version
- Android build/version code
- device
- organization
- store
- register
- employee
- starting connection mode
- starting outbox count
- starting device/server checkpoint
- action
- observed behavior
- final outbox state
- final server transaction state
- duplicate count
- PASS / FAIL

---

## A. Development device

### A1 — Fresh install

Expected:

```text
install
authenticate
enroll
assign store
assign register
initial sync
ready
```

### A2 — Existing installation upgrade

Use an existing installation containing at least one unresolved synthetic offline event.

Do NOT uninstall.

Expected:

```text
binary upgrade
SQLite migration
same event ID
same idempotency key
same device sequence
same payload/snapshot digest
```

---

## B. Internal Google Play testing

Install the signed AAB from the Google Play internal-test link.

Run:

1. login
2. business context
3. device enrollment
4. store/register assignment
5. initial sync
6. online cash sale
7. offline cash sale
8. camera barcode
9. HID barcode if hardware is available
10. reconnect/sync

Required:

```text
0 duplicate sale
0 duplicate payment
0 duplicate stock movement
0 silent loss
```

---

## C. Failure scenarios

### C1 — App kill with unsynced transaction

Expected:

```text
transaction survives
same identity survives
recovery occurs
```

### C2 — Phone restart

Expected:

```text
SQLite survives
outbox survives
device sequence survives
sync cursor survives
```

### C3 — Network loss before commit

Expected:

```text
no partial authoritative transaction
retry same identity
```

### C4 — Network loss after commit / missing ACK

Expected:

```text
server replay
no second sale
no second payment
no second inventory movement
```

### C5 — Revoked device

Expected:

```text
explicit rejection
no silent deletion
```

### C6 — Closed shift

Expected:

```text
explicit conflict/review
no silent rewrite
```

---

## D. Tenant/store scenarios

### D1 — Business A → Business B

Expected:

Business B must not inherit Business A:

- products
- customers
- receipts
- inventory
- events
- configuration

### D2 — Store A → unauthorized Store B

Expected:

```text
access denied
no Store B cache injection
```

---

## E. Closed testing

Only begin after internal testing passes.

Use a controlled tester group.

Repeat the core transaction/failure matrix on more than one Android device class where possible.

Capture:

- tester count
- device models
- Android versions
- crashes
- sync failures
- reported UX blockers

Any data-integrity failure blocks pilot.

---

## F. Pilot merchants

Pilot is NOT a global production launch.

Pilot merchants must use controlled stores/registers.

Minimum pilot evidence should include:

- more than one real register if available
- repeated daily open/close operation
- online transactions
- network interruption
- offline cash
- reconnect/reconciliation
- device restart
- application upgrade
- barcode operation
- shift lifecycle
- no cross-tenant leakage

Any occurrence of:

```text
duplicate money
duplicate inventory
lost transaction
cross-tenant data
unrecoverable queue
```

immediately blocks production.

---

## G. Production eligibility

Production is eligible only when:

```text
signed AAB PASS
development device PASS
internal testing PASS
closed testing PASS
pilot merchants PASS
all real-store scenarios PASS
Phase 23 upgrade proof PASS
```

Then run:

```bash
node scripts/phase-24-production-release-gate.mjs
```

It must PASS before preparing a production release.

Even after that gate:

```text
production remains a deliberate human-approved release
```

Never automate global release from this phase.
