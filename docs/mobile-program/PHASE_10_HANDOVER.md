# Phase 10 Durable Outbox — Implementation Handover

## Current state

- Repository: `razzeysphinx/TINDIOPOS`
- Current branch: `mobile/phase-10-durable-outbox`
- Required base: `mobile/phase-09-local-first` at `84884000e57c39839db7a93513dc7d9ec780972a`
- Phase 10 branch was created from that exact commit.
- Do not recreate, reset, clean, discard, or overwrite existing local work.
- Do not checkout another base branch.

## Master authority

Read and follow the entire packet before changing code:

`C:\Users\peral\Downloads\TINDIO_PHASE_10_DURABLE_OUTBOX_MASTER_PACKET.md`

The packet is implementation-only. It explicitly defers tests/certification.

## Completed / partial work

1. Schema v4 was started in `apps/mobile/src/db/schema.ts`.
   - `TINDIO_LOCAL_SCHEMA_VERSION` is `4`.
   - Migration `phase_10_durable_outbox` adds `outbox_events`, only `SALE_COMPLETED`, required states, idempotency uniqueness, and indexes.
2. `apps/mobile/src/features/outbox/outbox-types.ts` exists with core Phase 10 outbox types.
3. `apps/mobile/src/db/outbox.ts` exists with an initial transaction-backed enqueue, FIFO pending listing, stale `SYNCING` recovery, update helper, and summary helper.
4. `apps/mobile/src/features/outbox/retry-policy.ts` exists and implements bounded exponential backoff.

These files are uncommitted. Inspect and improve them as needed; do not discard legitimate work.

## Exact next implementation order

5. Create `apps/mobile/src/features/outbox/create-offline-sale.ts`.
   - Only producer: `SALE_COMPLETED`.
   - Require Phase 08 readiness, matching org/device/store/register/shift, non-empty cart, positive local total, and a cached eligible cash-only payment method.
   - Reject electronic payments, variable-price items, unsupported modifiers, and invalid fractional quantities.
   - Generate UUID event/idempotency keys and `OFF-XXXXXXXXXX` local reference.
   - Build canonical checkout payload and immutable, secret-free snapshot.
   - SQLite enqueue must commit before UI says accepted.
6. Refactor `apps/mobile/src/lib/tindio-api.ts` with raw authenticated response support.
7. Add `syncPosV2OfflineCheckout` for `/api/pos/v2/offline-checkout`.
8. Create sequential `apps/mobile/src/features/outbox/outbox-sync.ts`.
   - Recover stale syncing rows first.
   - FIFO, one event at a time; no `Promise.all`.
   - Load device credential from SecureStore only at sync time and reject mismatch as conflict.
   - Persist `SYNCED`, retryable `LOCAL_PENDING` + backoff, `CONFLICT`, or auth `FAILED`; never delete events.
9. Create `apps/mobile/src/features/outbox/outbox-summary.ts` with safe summary and oldest unresolved event.
10. Extend `apps/mobile/app/(app)/pos.tsx` with local cart-line quantities, cash tender/change preview, `SAVE OFFLINE CASH SALE`, enqueue-first clearing, accepted reference, and opportunistic online one-shot sync. Do not implement other checkout behavior.
11. Extend Sync Status with Phase 10 summary, oldest unresolved safe fields, and manual online-only sync button.
12. Ensure `clearOrganizationLocalCache` does not delete `outbox_events`; add a comment/contract guard.
13. Create `docs/mobile-program/PHASE_10_DURABLE_OUTBOX.md` as `IMPLEMENTATION: COMPLETE`, `STATUS: VALIDATING`, `TESTS: DEFERRED BY USER`.
14. Create `scripts/phase-10-durable-outbox-check.mjs` and root script `test:phase-10-durable-outbox`; do not run it.
15. Only run `git status --short`, `git diff --stat`, `git diff --name-status`, and `git diff --check`.
16. Commit exactly: `feat(mobile): implement durable offline outbox engine`.
17. Push: `git push -u origin mobile/phase-10-durable-outbox`.
18. Stop.

## Absolute boundaries

- Do not run `pnpm install`, typecheck, lint, tests, build, Expo export, certification, or database rehearsal.
- Do not create a PR, merge, poll GitHub, or begin Phase 11.
- Do not modify Backend V1 routes/business logic, PostgreSQL/Neon schema, RBAC/RLS, or Supabase configuration.
- Do not create `device_sequence`, `server_checkpoint`, `delta_cursor`, or a conflicts table.
- Do not add outbox support for customer, shift, ticket, or transfer events.
- Do not store tokens, passwords, device secrets, card data, CVV, or database credentials in SQLite/outbox payloads/snapshots.
- SecureStore remains the only location for device credential secret.
- No polling loop, background busy loop, or parallel outbox delivery.
- Do not delete pending, syncing, conflict, failed, or synced events automatically.

## Required safety behavior

- Server remains authoritative. Mobile must not duplicate Backend V1 business logic.
- Cash-only offline acceptance; no CARD, E_WALLET, BANK_TRANSFER, VOUCHER, or manual electronic store-and-forward.
- Same idempotency key on every retry.
- Conflicts preserve original payload/history and require later review.
- If the UI says `SAVED LOCALLY`, the outbox row must already be committed.
- App/process/device interruption must recover stale `SYNCING` to `LOCAL_PENDING` after 60 seconds.

## Expected final result

`PHASE_10_IMPLEMENTATION_COMPLETE_TESTS_DEFERRED`

Phase 10 docs must remain `VALIDATING`; tests are deferred by the user.
