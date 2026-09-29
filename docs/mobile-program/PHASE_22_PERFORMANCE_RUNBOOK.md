# Phase 22 — Performance Measurement Runbook

## Rule

Measure first.

Do not optimize from intuition.

Use:

- development/test merchant
- non-production checkout data
- production-like Neon endpoint
- Android development build
- representative catalog size
- representative queued sync workload

## 1. POS launch

Capture database snapshot:

```bash
node scripts/phase-22-cost-snapshot.mjs pos-launch-before
```

Cold launch the native POS and allow bootstrap/offline preparation to settle.

Capture:

```bash
node scripts/phase-22-cost-snapshot.mjs pos-launch-after
```

Diff:

```bash
node scripts/phase-22-cost-diff.mjs \
  docs/mobile-program/evidence/PHASE_22_COST_pos-launch-before.json \
  docs/mobile-program/evidence/PHASE_22_COST_pos-launch-after.json
```

Record:

- database statement calls
- rows returned
- table scan activity
- API calls
- payload bytes
- launch duration

## 2. Checkout

Use a synthetic test sale only.

Capture:

```bash
node scripts/phase-22-cost-snapshot.mjs checkout-before
```

Perform exactly one checkout.

Capture:

```bash
node scripts/phase-22-cost-snapshot.mjs checkout-after
```

Diff the snapshots.

Record:

- database statement calls
- transaction commits/rollbacks
- rows returned/changed
- query execution time
- checkout HTTP duration

Never profile by creating uncontrolled production sales.

## 3. Cashier-hour API rate

Reset the mobile Phase 22 performance window.

Operate the test POS for at least 60 minutes or run a representative scripted workflow.

Record:

```text
API calls
API calls/hour
API retries
API failures
response bytes
```

## 4. SQLite search

Use representative catalog sizes.

Test:

- empty catalog browse
- category filter
- common text search
- barcode lookup
- SKU lookup

Record average/max SQLite latency.

## 5. Catalog / delta sync

Measure:

- full catalog preparation
- small delta
- large delta
- customer delta
- modifier invalidation

Record:

- pull pages
- catalog rows
- customer rows
- response bytes
- duration
- records/second

## 6. Realtime

Current native architecture uses:

```text
0 Realtime connections
```

Do not add Realtime unless a later requirement proves it is necessary.

## 7. Recovery

Create an interrupted sync in a development environment.

Measure recovery duration from:

```text
SYNCING
→
LOCAL_PENDING / resolved recovery state
```

Do not modify accepted transaction identity.

## 8. Optimization rule

Only create a tuning patch when evidence identifies:

```text
actual high-call endpoint
actual slow query
actual high row scan
actual oversized payload
actual slow SQLite path
actual low sync throughput
```

Every optimization must include:

```text
before measurement
change
after measurement
regression result
```

No speculative indexes.
No speculative caching.
No removal of integrity checks for speed.