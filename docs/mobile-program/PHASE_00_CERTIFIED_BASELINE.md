# TINDIO Mobile Program — Phase 00 Baseline

SOURCE_OF_TRUTH:
`docs/TINDIO_MOBILE_NEON_SOURCE_OF_TRUTH.md`

PHASE:
`00 — Protect Certified Baseline`

STATUS:
`CERTIFIED`

## Protected input baseline

Remote branch:
`TINDIO-PREPRODUCTION`

Baseline commit:
`a8da4137855b26ae35d78af4e2fb84bb3300aba9`

The baseline represents the certified TINDIO web/POS/inventory system immediately before the Mobile + Offline + Neon program begins implementation.

## Protected architecture

Phase 00 does not modify application or database behavior.

Protected systems include:

- multi-business tenant isolation
- multi-store/store-scope enforcement
- RBAC and permissions
- provider-neutral identity
- inventory ledger and reconciliation
- inventory idempotency
- checkout idempotency
- atomic checkout
- transfers
- purchasing and receiving
- counts and adjustments
- supplier returns
- composite production
- replenishment
- unit conversions
- valuation
- shifts
- device management
- browser offline checkout and conflict safeguards

## Permanent certification entrypoint

```bash
pnpm certify
```

The Mobile + Offline + Neon program must continue using the existing authoritative certification system rather than creating a competing business-logic test path.

## Phase 00 completion requirements

Phase 00 becomes `CERTIFIED` only when:

- Source-of-Truth contract test passes
- authoritative repository certification passes
- local database certification passes
- production build passes
- migration rehearsal passes
- isolated restore drill passes
- migration/generated type tree remains clean
- Phase 00 changes contain no application behavior changes
- CI workflow succeeds
- Phase 00 branch is ready to merge into `TINDIO-PREPRODUCTION`
