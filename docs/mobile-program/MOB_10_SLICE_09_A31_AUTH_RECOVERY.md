# MOB-10 Slice 9 — A31 authorization recovery

Status: **A31 PASS; MOB-10 REMAINS OPEN**

Starting commit: `d38c5c9bd8828c293d38d55bc24416f02144c0ac`

## Result

On the physical Android device, a supported synthetic offline cash sale entered durable custody as event `0cbe38be-d4eb-41f0-bcb8-036f31330f65`, idempotency key `598e7125-e4bc-42f3-9ea3-f16e18481cdb`, provisional receipt `OFF-598E7125E4`, and device sequence 1108. An external relay changed only the bearer header and forwarded the unchanged production sync request to the real POS v2 route. The server returned `401 AUTH_INVALID` for both the initial request and the client's one bounded refreshed-token retry.

The app then exposed the original event as `FAILED / AUTHORIZATION_CHANGED`, retained its PHP 1.00 amount and receipt, kept next sequence 1109, retained server checkpoint 1107, and entered `SYNC_REVIEW`. The cashier used **Reauthenticate in place**, which signed in through Supabase Auth and reloaded the current organization context. **Retry original transaction** then moved the existing event through the MOB-03 coordinator without replacing its identity.

Canonical Neon verification found exactly one completed sale, payment, receipt, sale item, inventory movement, synced offline event, and applied sequence receipt for the original idempotency key. Official receipt 1141 remained visible on the phone with the immutable one-item PHP 1.00 snapshot. Final checkpoint was 1108, next local sequence remained 1109, and the unresolved queue returned to zero.

This is both **DELIVERY/RECOVERY CORRECT** and **FINANCIAL SETTLEMENT SUCCESS**.

## Architecture decision

**KEEP.** Current source already implements the required A31 behavior:

- `apps/mobile/src/lib/tindio-api.ts` performs one bounded refresh retry after HTTP 401.
- `apps/mobile/src/features/outbox/outbox-sync.ts` converts a repeated 401/403 into a visible `FAILED / AUTHORIZATION_CHANGED` event.
- `apps/mobile/src/features/session/session-provider.tsx` reauthenticates without releasing transaction custody and validates the requested organization through POS v2 Core.
- `apps/mobile/src/features/outbox/recovery-policy.ts` rechecks tenant, store, device, register, employee, and checkout permissions.
- `apps/mobile/src/db/outbox.ts` moves only the reviewed event back to `LOCAL_PENDING` in the same SQLite transaction that records the recovery audit; event ID, idempotency key, payload, receipt, and device sequence are unchanged.
- `apps/mobile/src/features/outbox/outbox-recovery.ts` retries through the existing MOB-03 coordinator.

No application, API, SQLite schema, or canonical database change was required.

## Physical evidence

| Boundary | Observed result |
|---|---|
| Prepared offline acceptance | `OFF-598E7125E4`, event `0cbe38be-d4eb-41f0-bcb8-036f31330f65`, key `598e7125-e4bc-42f3-9ea3-f16e18481cdb`, sequence 1108, PHP 1.00 cash |
| Initial bearer denial | Real `/api/pos/v2/sync/push` returned `401 AUTH_INVALID` at `2026-10-13T12:11:13.103Z` |
| Refreshed bearer denial | Same request identity returned `401 AUTH_INVALID` at `2026-10-13T12:11:14.215Z` |
| Local review custody | `FAILED`, `AUTHORIZATION_CHANGED`, next sequence 1109, checkpoint 1107, `SYNC_REVIEW`, one unresolved transaction |
| In-place recovery | Supabase password sign-in succeeded; current organization bootstrap and terminal context were reloaded; no logout or reset occurred |
| Same-identity retry | Original event was authorized for retry and delivered through the existing single-flight coordinator |
| Final local state | queue `0 / 0 / 0 / 0`, checkpoint 1108, next sequence 1109, `CONTIGUOUS`, `CLOUD_ONLINE` |
| Retained receipt | `OFF-598E7125E4` linked to official receipt 1141; one certification item; total/tender PHP 1.00; change PHP 0.00 |

The first calibration attempt used only one forced 401. The production client refreshed its Supabase session and replayed the same request automatically, producing receipt 1140 and never entering `FAILED`. The actual A31 run therefore forced the real route to reject both the original request and its single refresh retry. This demonstrates the boundary between automatic token recovery and the explicit A31 review workflow.

## Canonical database assertions

For idempotency key `598e7125-e4bc-42f3-9ea3-f16e18481cdb`:

- one completed advanced checkout request and sale `bcd3dda4-916b-4189-a3b1-77cf96008a50`;
- one PHP 1.00 cash payment `adba2fc7-6f12-4fd4-8edb-fada5ed33eca`;
- one receipt `d35b5195-d8c6-4e13-8308-9438428e9bd5`, number 1141;
- one sale item with the original product, quantity, unit, and PHP 1.00 line total;
- one sale inventory movement `7324f3ee-354d-4a20-bd43-c560e833fba7`, quantity 102 to 101;
- one `SYNCED` offline event retaining `OFF-598E7125E4`;
- one sequence-1108 receipt in `APPLIED` state;
- device server checkpoint 1108.

No duplicate money, receipt, item, inventory, offline-event, or sequence effect exists for the transaction.

## Security and custody impact

The invalid bearer was rejected by the unchanged authenticated route. The relay logged neither the original nor refreshed credential. Recovery required fresh Supabase authentication plus current organization, store, permission, device, and register validation. Source behavior and focused tests fail closed for tenant mismatch, unassigned store, changed terminal, missing checkout permissions, employee change without manager authority, non-retryable sequence conflicts, and corrupt records.

No app data was cleared, no APK was uninstalled, no SQLite row was edited, no local database was reset, no receipt/outbox/recovery record was deleted, and no transaction identity was replaced. Offline electronic/card payments remained disabled.

## Validation

- Focused Phase 02/10/12/17/18 and outbox suites: **34/34 passed**.
- Root typecheck: **passed**.
- Mobile typecheck: **passed**.
- Root lint: **passed with three pre-existing warnings and zero errors**.
- Mobile lint: **passed with one pre-existing warning and zero errors**.
- Android export: **passed**.
- Static certification: **147/148 passed**; only `test:phase-04-docker-source-connectivity` failed because the local Supabase source was unavailable. Canonical historical migration integrity and R9 checks passed.
- `git diff --check`: recorded after evidence finalization.

## Compatibility and limitations

Database/SQLite/API compatibility is unchanged. The test used a debug/certification APK and an external local relay; it does not certify production signing, Google Play delivery, 16 KB-page hardware, peripherals, every remaining MOB-10 case, or merchant-pilot readiness. Physical revocation of the certification employee/device was not performed because it would alter shared test-account enrollment; fail-closed revocation and scope boundaries remain covered by the existing Phase 02/MOB-04 contracts.

`A48` remains **NOT_RUN** until the real Phase 23/24 production release candidate exists.

## Next smallest safe slice

MOB-10 Slice 10 should execute A32: change price, tax, payment policy, or product availability after offline cash is accepted; prove the original financial obligation is never silently repriced and that manager resolution retains an audit trail. Do not start A48 in that slice.
