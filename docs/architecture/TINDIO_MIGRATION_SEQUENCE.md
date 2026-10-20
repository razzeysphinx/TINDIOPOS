# TINDIO migration sequence

Status: **IN PROGRESS**

| Slice | Scope | Status | Exit gate |
|---|---|---|---|
| A | Audit, target architecture, ADR, dependency map, baseline | **IMPLEMENTED** | Clean/synchronized Git; evidence recorded; no production mutation |
| B1 | Add `packages/*`, contracts foundation, independent commands | **IMPLEMENTED** | Typecheck/build/compatibility checks pass |
| B2 | Extract platform-neutral POS contract leaves and remove Mobile relative Web imports | **IMPLEMENTED** | Backend/Web/Mobile contract tests; unchanged wire format |
| B3 | Decide and perform root Web to `apps/web/` move | **DEFERRED** | Dedicated Vercel, alias, public asset, Playwright, env, and script proof |
| C | Create real `apps/backend/` and extract first read-only endpoint | **IMPLEMENTED** | Independent health/build/test plus dual-route compatibility |
| D | Progressive Backend extraction, mutations last | **IN PROGRESS — NINE READS AND TWO NON-FINANCIAL MUTATIONS OWNED** | Financial/idempotency/offline replay equivalence |
| E | Isolated synthetic Neon Auth proof on a non-production branch | **OWNER/PROVIDER PREREQUISITES** | Required 13-flow proof including Mobile, RLS, revocation |
| F | Identity inventory, deterministic mapping, dry-run tooling | **PLANNED** | All users accounted for; no privilege drift; no real import |
| G | Web and Mobile dual-transition Auth migration | **PLANNED** | In-place Mobile upgrade preserves SQLite/outbox/device custody |
| H | Controlled production cutover | **OWNER APPROVAL REQUIRED** | Monitoring, rollback, supported clients, tenant/financial proof |
| I | Remove active Supabase runtime dependencies | **PLANNED** | Zero supported-client dependency; separate decommission approval |
| J | Performance measurement, cleanup, independent CI/CD | **PLANNED** | Evidence-based optimization and final certification |

## Completed Slice C

- Create the independent `apps/backend/` foundation with its own health,
  typecheck, build, and test commands. **IMPLEMENTED.**
- Keep the foundation stateless and provider-neutral, with no client-origin,
  authentication, database, or POS route change. **IMPLEMENTED.**
- Extract one read-only POS v2 endpoint behind a dual-route compatibility
  adapter: the already package-typed bootstrap core response. **IMPLEMENTED.**
- Keep the existing Next.js route active and prove identical authentication,
  authorization, status, headers, and JSON response behavior. **IMPLEMENTED.**
- Do not move checkout, sync-push, custody, or other mutation endpoints in the
  foundation slice. **IMPLEMENTED.**

## Completed Slice D1: bootstrap read ownership

- Bootstrap authentication, organization scoping, POS permission checks, and
  Neon Data API core loading are Backend-owned. **IMPLEMENTED.**
- `TINDIO_BOOTSTRAP_READ_MODE=proxy` retains the allowlisted Web compatibility
  adapter as an explicit rollback. **IMPLEMENTED.**
- The owned path preserves the 200/401/403/503 response envelope, retry rule,
  cache control, and request ID without exposing identity or token data.
  **IMPLEMENTED.**
- All mutations remain in Next.js and both clients retain their current origin.
  **IMPLEMENTED.**

## Completed Slice D2: POS reference read ownership

- POS reference authentication, organization scoping, bundle validation, and
  Neon Data API loading are Backend-owned. **IMPLEMENTED.**
- `TINDIO_REFERENCE_READ_MODE=proxy` retains the existing Web reference route
  as an allowlisted rollback. **IMPLEMENTED.**
- The 200/401/403/503 body, request ID, no-store policy, reference version, and
  ETag contracts remain unchanged. **IMPLEMENTED.**
- A focused `@tindio/contracts/pos-data` export supplies the cross-runtime type
  without importing the Bundler-oriented package barrel. **IMPLEMENTED.**
- All mutations remain in Next.js and both clients retain their current origin.
  **IMPLEMENTED.**

## Completed Slice D3: POS catalogue read ownership

- The bounded, paginated search/favorites/recent catalogue read is
  Backend-owned with strict query and response validation. **IMPLEMENTED.**
- `TINDIO_CATALOG_READ_MODE=proxy` retains the query-preserving Web rollback.
  **IMPLEMENTED.**

## Completed Slice D4: POS modifiers read ownership

- The bounded store/product modifiers read is Backend-owned with strict group,
  option, and minor-unit-price validation. **IMPLEMENTED.**
- `TINDIO_MODIFIERS_READ_MODE=proxy` retains the query-preserving Web rollback.
  **IMPLEMENTED.**

## Completed Slice D5: POS customer-search read ownership

- Customer search now resolves the full business context, enforces
  `pos.access` plus `sales.create`, validates assigned store scope, and verifies
  the cashier's open shift before the bounded lookup. **IMPLEMENTED.**
- The exact customer field mapping and database denial/failure classifications
  remain bounded and provider details are not exposed. **IMPLEMENTED.**
- `TINDIO_CUSTOMERS_READ_MODE=proxy` retains the query-preserving Web rollback.
  **IMPLEMENTED.**
- Customer creation, checkout, sync-push, shift custody, and every mutation
  remain in Next.js. **IMPLEMENTED.**

## Completed Slice D6: POS receipt-search read ownership

- The bounded receipt list/search read is Backend-owned with full business
  context validation and the `pos.access`, `sales.create`, and `receipts.view`
  permission gate. **IMPLEMENTED.**
- Search trimming, the 100-character bound, positive safe receipt-number cursor,
  fixed 25-row limit, and exact snake_case receipt summaries remain unchanged.
  **IMPLEMENTED.**
- `TINDIO_RECEIPTS_READ_MODE=proxy` retains the query-preserving Web rollback.
  **IMPLEMENTED.**
- Receipt detail, reprint/delivery, refunds, checkout, and every mutation remain
  in Next.js. **IMPLEMENTED.**

## Completed Slice D7: POS receipt-detail read ownership

- Move only `GET /api/pos/v2/receipts/[receiptId]` behind the Backend boundary
  while preserving UUID validation, authorization, 404 behavior, and the full
  immutable receipt snapshot. **IMPLEMENTED.**
- Retain the Web detail route as rollback and keep delivery, refunds, checkout,
  and all other mutations in Next.js. **IMPLEMENTED.**
- `TINDIO_RECEIPT_DETAIL_READ_MODE=proxy` preserves the exact dynamic path and
  query while rejecting nested delivery/refund mutation paths. **IMPLEMENTED.**
- Every receipt, sale, item, payment, and completed-refund snapshot field is
  strictly validated before the existing camelCase response is returned.
  **IMPLEMENTED.**

## Completed Slice D8: POS attendance-employee read ownership

- Move only `GET /api/pos/v2/attendance/employees` behind the Backend boundary
  while preserving the time-clock feature gate, `attendance.use` permission,
  assigned-store validation, employee projection, and current failure bodies.
  **IMPLEMENTED.**
- Retain the Web route as rollback and keep clock-in, clock-out, shift custody,
  checkout, sync, and every other mutation in Next.js. **IMPLEMENTED.**
- `TINDIO_ATTENDANCE_EMPLOYEES_READ_MODE=proxy` retains the query-preserving Web
  rollback with the established header allowlists. **IMPLEMENTED.**
- Null data remains an empty success, while loader/provider and malformed-row
  failures preserve the existing HTTP 200 failure envelope. **IMPLEMENTED.**

## Completed Slice D9: POS live-state read ownership

- Move only `GET /api/pos/v2/live` behind the Backend boundary while preserving
  required organization scope, optional store/register headers, identity retry,
  strict aggregate validation, request IDs, and the exact V2 live envelope.
  **IMPLEMENTED.**
- Retain the Web route as rollback and keep checkout, customer-display writes,
  ticket operations, attendance mutations, sync, and every mutation in Next.js.
  **IMPLEMENTED.**
- `TINDIO_LIVE_READ_MODE=proxy` preserves the complete query string and only
  forwards the established organization, optional store, and optional register
  scope headers. **IMPLEMENTED.**
- Invalid aggregate envelopes fail closed while the established tolerant
  transfer, open-ticket, cart-line, modifier, customer, and assignee row mapping
  remains unchanged. **IMPLEMENTED.**

## Completed Slice D10: customer-display mutation compatibility harness

- Freeze the exact customer-display update schema, HTTP constants, permission
  gate, RPC arguments, open-shift denial, status/body/header behavior, and SQL
  authority in the focused `@tindio/contracts/customer-display` boundary.
  **IMPLEMENTED.**
- Keep the existing Next.js `PUT /api/pos/v2/customer-display` route
  authoritative while making it consume the shared contract. **IMPLEMENTED.**
- Add a Backend compatibility oracle and certification harness without adding
  a Backend route, network/database access, provider dependency, environment
  switch, or client-origin change. **IMPLEMENTED.**
- Keep checkout, refunds, transfer receipt, ticket custody, attendance, sync,
  and every financial/offline-replayed mutation in Next.js. **IMPLEMENTED.**

## Completed Slice D11: customer-display update ownership

- Move only `PUT /api/pos/v2/customer-display` behind the Backend boundary,
  preserving business-context resolution, both permissions, schema defaults
  and bounds, exact RPC arguments, `42501` mapping, and the `204`/`no-store`
  success response. **IMPLEMENTED.**
- Add an explicit owned/proxy mode with an allowlisted rollback to the existing
  Web route before changing any deployed client origin. **IMPLEMENTED.**
- Keep checkout, refunds, transfer receipt, ticket custody, attendance, sync,
  and every financial/offline-replayed mutation in Next.js. **IMPLEMENTED.**

## Completed Slice D12: favorite-tile mutation compatibility harness

- Freeze only `POST /api/pos/v2/favorites`, including context-first resolution,
  its product-management permission before JSON parsing, request and assigned-
  store validation, nullable variants, idempotent pin/unpin semantics, and the
  malformed-request `400` versus action-result `200` envelopes. **IMPLEMENTED.**
- Freeze the SQL authority: POS workspace/open-shift access, saleability,
  advisory locking, first-free position from 1 through 24, exact database error
  mapping, provider-neutral grants, and store-scoped RLS. **IMPLEMENTED.**
- Add a network/database-independent Backend compatibility oracle without a
  Backend route, mode variable, deployment change, or client-origin change.
  **IMPLEMENTED.**
- Keep customer creation, checkout, refunds, transfer receipt, ticket custody,
  attendance, sync, and every financial/offline-replayed mutation in Next.js.
  **IMPLEMENTED.**

## Completed Slice D13: favorite-tile mutation ownership

- Move only `POST /api/pos/v2/favorites` behind an explicit Backend-owned/proxy
  boundary while preserving every frozen D12 contract and the existing Web
  route as rollback. **IMPLEMENTED.**
- Converge the POS UI on the same-origin HTTP command and remove the redundant
  favorite-only server action so there is one mutation entry point.
  **IMPLEMENTED.**
- Preserve context-first resolution, permission-before-JSON ordering, exact
  `400` versus `200` envelopes, nullable variants, assigned-store validation,
  RPC arguments/error mapping, and idempotent pin/unpin results. **IMPLEMENTED.**
- Verify Supabase-issued bearer claims while sending business-context and
  favorite RPC traffic only through the external-JWT Neon Data API.
  **IMPLEMENTED.**
- Keep client origins, database schema, customer creation, checkout, refunds,
  transfer receipt, ticket custody, attendance, sync, and every financial or
  offline-replayed mutation unchanged. **IMPLEMENTED.**

## Next smallest safe slice: D14 customer-creation compatibility harness

- Inventory and freeze only `POST /api/pos/v2/customers/create`, including
  context and permission ordering, assigned-store/open-shift requirements,
  validation, normalization, duplicate handling, exact response envelopes, RPC
  arguments, and database authority.
- Add a network/database-independent Backend oracle and compatibility gates
  before moving customer-creation ownership.
- Keep checkout, refunds, transfer receipt, ticket custody, attendance, sync,
  and every financial/offline-replayed mutation in Next.js.

Do not change a deployed API origin or route clients to the new Backend without
separate compatibility evidence and approval.

## Mandatory stop points

Stop for explicit approval before production Neon Auth enablement, real account
export/import, password migration, credential rotation, deployed API-origin
change, live client cutover, Supabase shutdown/deletion, or merchant-data writes
outside established controlled operations.
