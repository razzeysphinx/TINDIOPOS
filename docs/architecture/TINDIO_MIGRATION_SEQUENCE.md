# TINDIO migration sequence

Status: **IN PROGRESS**

| Slice | Scope | Status | Exit gate |
|---|---|---|---|
| A | Audit, target architecture, ADR, dependency map, baseline | **IMPLEMENTED** | Clean/synchronized Git; evidence recorded; no production mutation |
| B1 | Add `packages/*`, contracts foundation, independent commands | **IMPLEMENTED** | Typecheck/build/compatibility checks pass |
| B2 | Extract platform-neutral POS contract leaves and remove Mobile relative Web imports | **IMPLEMENTED** | Backend/Web/Mobile contract tests; unchanged wire format |
| B3 | Decide and perform root Web to `apps/web/` move | **DEFERRED** | Dedicated Vercel, alias, public asset, Playwright, env, and script proof |
| C | Create real `apps/backend/` and extract first read-only endpoint | **IMPLEMENTED** | Independent health/build/test plus dual-route compatibility |
| D | Progressive Backend extraction, mutations last | **IN PROGRESS — D41 COMPLETE; 27 ROUTES BACKEND-OWNED** | Financial/idempotency/offline replay equivalence |
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

## Completed Slice D14: customer-creation compatibility harness

- Inventory and freeze only `POST /api/pos/v2/customers/create`, including
  context-first and permission-before-JSON ordering, schema validation and
  trimming, exact response envelopes, direct table-insert projection, and
  database authority. Creation has no assigned-store or open-shift prerequisite.
  **IMPLEMENTED.**
- Add a network/database-independent Backend oracle and compatibility gates
  before moving customer-creation ownership.
  **IMPLEMENTED.**
- Freeze the existing dual entry points: Mobile uses the HTTP route while Web
  POS and Back Office use the shared server action/service. **IMPLEMENTED.**
- Preserve customer-number and default loyalty-code generation in the database
  trigger, organization-scoped uniqueness, field constraints, and
  provider-neutral `customers.manage` INSERT/SELECT RLS. **IMPLEMENTED.**
- Keep checkout, refunds, transfer receipt, ticket custody, attendance, sync,
  and every financial/offline-replayed mutation in Next.js. **IMPLEMENTED.**

## Completed Slice D15: customer-creation mutation ownership

- Move only `POST /api/pos/v2/customers/create` behind an explicit Backend-
  owned/proxy boundary while preserving every frozen D14 contract and the Web
  route as rollback. **IMPLEMENTED.**
- Resolve Mobile HTTP plus Web POS/Back Office server-action entry points onto
  one mutation authority without changing the deployed client API origin.
  **IMPLEMENTED.**
- Keep direct RLS-protected insert and database-generated identity semantics;
  do not invent an RPC or add store/open-shift prerequisites. **IMPLEMENTED.**
- Keep checkout, refunds, transfer receipt, ticket custody, attendance, sync,
  and every financial/offline-replayed mutation unchanged. **IMPLEMENTED.**

## Completed Slice D16: open-ticket save compatibility harness

- Inventory and freeze only `POST /api/pos/v2/tickets/save`, including context,
  permission, assigned-register/open-shift custody, validation, idempotency,
  exact response envelopes, RPC arguments, and database authority.
  **IMPLEMENTED.**
- Add a network/database-independent Backend oracle and compatibility gates
  before moving any ticket mutation ownership. **IMPLEMENTED.**
- Keep ticket cancel/merge/move/split, checkout, refunds, transfer receipt,
  attendance, sync, and every financial/offline-replayed mutation unchanged.
  **IMPLEMENTED.**

## Completed Slice D17: open-ticket save mutation ownership

- Move only `POST /api/pos/v2/tickets/save` behind an explicit Backend-owned/
  proxy boundary while preserving every frozen D16 contract and the existing
  Web route as rollback. **IMPLEMENTED.**
- Preserve Mobile HTTP and Web POS behavior, assigned-store and owned-open-shift
  custody, device credential forwarding, create/update semantics, exact RPC
  arguments, and response/error envelopes. **IMPLEMENTED.**
- Keep ticket cancel/merge/move/split, checkout, refunds, transfer receipt,
  attendance, sync, and every other financial/offline-replayed mutation
  unchanged. **IMPLEMENTED.**

## Completed Slice D18: open-ticket cancellation compatibility harness

- Inventory and freeze only `POST /api/pos/v2/tickets/cancel`, including
  context, permissions, feature and owned-open-shift custody, device forwarding,
  validation, repeated-cancel behavior, exact envelopes, RPC arguments, and SQL
  authority. **IMPLEMENTED.**
- Add a network/database-independent Backend oracle and compatibility gates
  before moving cancellation ownership. **IMPLEMENTED.**
- Keep ticket merge/move/split, checkout, refunds, transfer receipt, attendance,
  sync, and every other financial/offline-replayed mutation unchanged.
  **IMPLEMENTED.**

## Completed Slice D19: open-ticket cancellation mutation ownership

- Move only `POST /api/pos/v2/tickets/cancel` behind an explicit Backend-owned/
  proxy boundary while preserving every frozen D18 contract and the existing
  Web route as rollback. **IMPLEMENTED.**
- Preserve Mobile HTTP and Web POS behavior, ticket-derived store scope, owned-
  open-shift/device custody, repeated-cancel failure, exact RPC arguments, and
  response/error envelopes. **IMPLEMENTED.**
- Keep ticket merge/move/split, checkout, refunds, transfer receipt, attendance,
  sync, and every other financial/offline-replayed mutation unchanged.
  **IMPLEMENTED.**

## Completed Slice D20: open-ticket line-movement compatibility harness

- Inventory and freeze only `POST /api/pos/v2/tickets/move-lines`, including
  context, permissions, feature and dual-ticket shift/device custody, line and
  quantity validation, partial-line behavior, exact envelopes, RPC arguments,
  audit effects, and SQL authority. **IMPLEMENTED.**
- Add a network/database-independent Backend oracle and compatibility gates
  before moving line-movement ownership. **IMPLEMENTED.**
- Keep ticket merge/split, checkout, refunds, transfer receipt, attendance,
  sync, and every other financial/offline-replayed mutation unchanged.
  **IMPLEMENTED.**

## Completed Slice D21: open-ticket line-movement ownership

- Move only `POST /api/pos/v2/tickets/move-lines` behind an explicit Backend-
  owned/proxy boundary while preserving every frozen D20 contract and the
  existing Web route as rollback. **IMPLEMENTED.**
- Preserve Mobile HTTP and Web POS behavior, same-register ticket scope, owned-
  open-shift/device custody, database-only pair/line validation, partial-line
  identity, exact RPC arguments, audit effects, and response envelopes.
  **IMPLEMENTED.**
- Keep ticket merge/split, checkout, refunds, transfer receipt, attendance,
  sync, and every other financial/offline-replayed mutation unchanged.
  **IMPLEMENTED.**

## Completed Slice D22: open-ticket split compatibility harness

- Inventory and freeze only `POST /api/pos/v2/tickets/split`, including context,
  permissions, feature and shift/device custody, validation, response envelopes,
  RPC arguments, audit effects, and SQL authority. **IMPLEMENTED.**
- Add a network/database-independent Backend oracle and compatibility gates
  before moving split ownership. **IMPLEMENTED.**
- Keep ticket merge, checkout, refunds, transfer receipt, attendance, sync, and
  every other financial/offline-replayed mutation unchanged. **IMPLEMENTED.**

## Completed Slice D23: open-ticket split ownership

- Move only `POST /api/pos/v2/tickets/split` behind an explicit Backend-owned/
  proxy boundary while preserving every frozen D22 contract and the existing
  Web route as rollback. **IMPLEMENTED.**
- Preserve Mobile HTTP and Web POS behavior, source-ticket/shift/device custody,
  inherited destination fields, label and line rules, partial-line identity,
  current all-selected source behavior, exact RPC arguments, audit effects,
  ticket identity, and response envelopes. **IMPLEMENTED.**
- Keep ticket merge, checkout, refunds, transfer receipt, attendance, sync, and
  every other financial/offline-replayed mutation unchanged. **IMPLEMENTED.**

## Completed Slice D24: open-ticket merge compatibility harness

- Inventory and freeze only `POST /api/pos/v2/tickets/merge`, including context,
  permissions, feature and dual-ticket shift/device custody, validation,
  response envelopes, RPC arguments, audit effects, and SQL authority.
  **IMPLEMENTED.**
- Add a network/database-independent Backend oracle and compatibility gates
  before moving merge ownership. **IMPLEMENTED.**
- Keep checkout, refunds, transfer receipt, attendance, sync, and every other
  financial/offline-replayed mutation unchanged. **IMPLEMENTED.**

## Completed Slice D25: open-ticket merge ownership

- Move only `POST /api/pos/v2/tickets/merge` behind an explicit Backend-owned/
  proxy boundary while preserving every frozen D24 contract and the existing
  Web route as rollback.
  **IMPLEMENTED.**
- Preserve Mobile HTTP and Web POS behavior, dual-ticket same-register scope,
  owned-open-shift/device custody, database-only distinct-ticket validation,
  full-source movement, source audit history, exact RPC arguments, audit
  effects, and response envelopes.
  **IMPLEMENTED.**
- Keep checkout, refunds, transfer receipt, attendance, sync, and every other
  financial/offline-replayed mutation unchanged. **IMPLEMENTED.**

## Completed Slice D26: checkout compatibility harness

- Inventory and freeze only `POST /api/pos/v2/checkout`, including authentication,
  organization/store/register and shift/device custody, permissions, validation,
  operation identity, payment and stock semantics, response envelopes, RPC
  arguments, financial effects, and SQL authority. **IMPLEMENTED.**
- Add a network/database-independent Backend oracle and compatibility gates
  before moving checkout ownership. **IMPLEMENTED.**
- Keep refunds, transfer receipt, attendance, sync, and every other financial/
  offline-replayed mutation unchanged. **IMPLEMENTED.**

## Completed Slice D27: checkout ownership

- Move only `POST /api/pos/v2/checkout` behind an explicit Backend-owned/proxy
  boundary while preserving every frozen D26 contract and the existing Web
  route as rollback. **IMPLEMENTED.**
- Preserve both accepted request shapes, exact idempotency and replay semantics,
  assigned store/register and first-commit open-shift custody, payment and stock
  effects, response mapping, and the post-commit stock warning. **IMPLEMENTED.**
- Keep offline checkout/sync replay, refunds, transfer receipt, attendance, and
  every other financial mutation unchanged. **IMPLEMENTED.**

## Completed Slice D28: offline checkout compatibility harness

- Inventory and freeze only `POST /api/pos/v2/offline-checkout`, including
  authenticated organization/store/register/device/shift custody, offline
  metadata and expected-total guards, replay identity, payment restrictions,
  response envelopes, and terminal versus retryable conflict semantics.
  **IMPLEMENTED.**
- Add a network/database-independent Backend oracle and compatibility gates
  before moving offline checkout or sync ownership. **IMPLEMENTED.**
- Keep sync push, refunds, transfer receipt, attendance, and every other
  financial mutation unchanged. **IMPLEMENTED.**

## Completed Slice D29: offline checkout ownership

- Move only direct `POST /api/pos/v2/offline-checkout` behind an explicit
  Backend-owned/proxy boundary while preserving every frozen D28 contract and
  the existing Web route as rollback. **IMPLEMENTED.**
- Keep the Web sync-push route on the same frozen processor until its own
  compatibility and ownership slice; do not split sequence or recording
  semantics while moving the direct route. **IMPLEMENTED.**
- Keep refunds, transfer receipt, attendance, every other financial mutation,
  deployed client origins, and authentication-provider ownership unchanged.
  **IMPLEMENTED.**

## Completed Slice D30: sync-push compatibility harness

- Inventory and freeze only `POST /api/pos/v2/sync/push`, including batch
  validation, ascending unique event/device identity, authenticated business
  context and device custody, stop-on-first-nonsuccess behavior, acknowledgement
  envelopes, and reuse of the frozen offline-checkout processor.
  **IMPLEMENTED.**
- Add a network/database-independent Backend oracle and compatibility gates
  before moving sync-push ownership. **IMPLEMENTED.**
- Keep refunds, transfer receipt, attendance, every other financial mutation,
  deployed client origins, and authentication-provider ownership unchanged.
  **IMPLEMENTED.**

## Completed Slice D31: sync-push ownership

- Move only `POST /api/pos/v2/sync/push` behind an explicit Backend-owned/proxy
  boundary while preserving every frozen D30 contract and the existing Web
  route as rollback. **IMPLEMENTED.**
- Reuse the frozen Backend offline-checkout processor for each event, preserving
  authenticated business context, device custody, request order, exact
  acknowledgement mapping, and stop-on-first-nonsuccess behavior.
  **IMPLEMENTED.**
- Keep refunds, transfer receipt, attendance, every other financial mutation,
  deployed client origins, and authentication-provider ownership unchanged.
  **IMPLEMENTED.**

## Completed Slice D32: refund compatibility harness

- Inventory and freeze only `POST /api/pos/v2/receipts/:receiptId/refund`,
  including receipt/organization custody, permissions and approval fallback,
  item quantities, payment method/reference rules, idempotency, stock effects,
  database error mapping, and the exact result envelope. **IMPLEMENTED.**
- Add a network/database-independent Backend oracle and compatibility gates
  before moving refund ownership. **IMPLEMENTED.**
- Keep transfer receipt, attendance, exchanges, every other financial mutation,
  deployed client origins, and authentication-provider ownership unchanged.
  **IMPLEMENTED.**

## Completed Slice D33: refund ownership

- Move only `POST /api/pos/v2/receipts/:receiptId/refund` behind an explicit
  Backend-owned/proxy boundary while preserving every frozen D32 contract and
  the existing Web route as rollback. **IMPLEMENTED.**
- Resolve receipt-derived sale custody before mutation, preserve permission-or-
  approval execution, idempotent replay, payment and conditional stock effects,
  and exact response mapping through the external-JWT Neon boundary.
  **IMPLEMENTED.**
- Keep transfer receipt, attendance, exchanges, every other financial mutation,
  deployed client origins, and authentication-provider ownership unchanged.
  **IMPLEMENTED.**

## Completed Slice D34: transfer-receipt compatibility harness

- Inventory and freeze only `POST /api/pos/v2/transfers/:transferId/receive`,
  including organization/store/device/shift custody, accepted quantities,
  idempotency, inventory effects, validation, database errors, and response
  mapping. **IMPLEMENTED.**
- Add a network/database-independent Backend oracle and compatibility gates
  before moving transfer-receipt ownership. **IMPLEMENTED.**
- Keep attendance, exchanges, every other financial mutation, deployed client
  origins, and authentication-provider ownership unchanged. **IMPLEMENTED.**

## Completed Slice D35: transfer-receipt ownership

- Move only `POST /api/pos/v2/transfers/:transferId/receive` behind an explicit
  Backend-owned/proxy boundary while preserving every frozen D34 contract and
  the existing Web route as rollback. **IMPLEMENTED.**
- Preserve context-first authorization, path-owned transfer identity,
  destination-store employee custody, operation-key replay, locked quantity
  application, audit effects, and exact response mapping through Neon's
  external-JWT boundary. **IMPLEMENTED.**
- Keep attendance, exchanges, every other financial mutation, deployed client
  origins, and authentication-provider ownership unchanged. **IMPLEMENTED.**

## Completed Slice D36: attendance mutation compatibility harness

- Inventory and freeze only `POST /api/pos/v2/attendance/clock-in` and
  `POST /api/pos/v2/attendance/clock-out`, including business/store/employee
  custody, feature and permission gates, validation, database effects, error
  mapping, and exact response envelopes. **IMPLEMENTED.**
- Add a network/database-independent Backend oracle and compatibility gates
  before moving attendance mutation ownership. **IMPLEMENTED.**
- Keep shift custody, exchanges, every other financial mutation, deployed
  client origins, and authentication-provider ownership unchanged.
  **IMPLEMENTED.**

## Completed Slice D37: attendance mutation ownership

- Move only `POST /api/pos/v2/attendance/clock-in` and
  `POST /api/pos/v2/attendance/clock-out` behind an explicit Backend-owned/proxy
  boundary while preserving every frozen D36 contract and both Web routes as
  rollback. **IMPLEMENTED.**
- Preserve context-first authorization, terminal and employee store custody,
  request-id replay, employee PIN verification, the open-register-shift guard,
  time-entry/audit effects, and exact response mapping through Neon's external-
  JWT boundary. **IMPLEMENTED.**
- Keep shift open/close ownership, exchanges, every other financial mutation,
  deployed client origins, and authentication-provider ownership unchanged.
  **IMPLEMENTED.**

## Completed Slice D38: sale-exchange compatibility harness

- Inventory and freeze only the existing `linkSaleExchangeAction`, including
  sales-create/refund permissions, refund and replacement-receipt identities,
  idempotency, immutable sale/refund custody, database errors, replay behavior,
  and exact result messages. **IMPLEMENTED.**
- Add a platform-neutral shared contract and network/database-independent
  Backend oracle before creating any Backend exchange route or moving ownership.
  **IMPLEMENTED.**
- Keep receipt settings/delivery, shift custody, every other financial mutation,
  deployed client origins, and authentication-provider ownership unchanged.
  **IMPLEMENTED.**

## Completed Slice D39: sale-exchange ownership

- Move only sale-exchange linking behind an explicit Backend-owned/proxy
  boundary while preserving every frozen D38 contract and the existing Server
  Action as rollback. **IMPLEMENTED.**
- Preserve context-first authentication, both sales permissions, completed
  refund/replacement identities, actor-and-payload replay, immutable source
  transactions, database authority, and exact result messages through Neon's
  external-JWT boundary. **IMPLEMENTED.**
- Keep receipt settings/delivery, shift custody, every other financial mutation,
  deployed client origins, and authentication-provider ownership unchanged.
  **IMPLEMENTED.**

## Completed Slice D40: receipt-settings and delivery compatibility harness

- Inventory and freeze only `updateReceiptSettingsAction` and
  `queueReceiptDeliveryAction`, including permissions, bounded settings and
  recipient inputs, receipt identity, idempotency, database effects, error
  mapping, revalidation, and exact result messages.
  **IMPLEMENTED.**
- Add focused platform-neutral contracts and network/database-independent
  Backend oracles before creating any Backend receipt-settings or delivery
  route or moving ownership.
  **IMPLEMENTED.**
- Keep sale exchange, shift custody, every other financial mutation, deployed
  client origins, and authentication-provider ownership unchanged.
  **IMPLEMENTED.**

## Completed Slice D41: receipt-settings and delivery ownership

- Move only receipt-settings updates and digital-receipt queueing behind
  explicit Backend-owned/proxy boundaries while preserving every frozen D40
  contract and both existing Server Actions as rollback.
  **IMPLEMENTED.**
- Preserve context-first authentication, permission gates, bounded inputs,
  receipt scope, actor-and-payload replay, settings snapshots, immutable
  delivery outbox custody, database authority, and exact result messages
  through Neon's external-JWT boundary.
  **IMPLEMENTED.**
- Keep sale exchange, shift custody, every other financial mutation, deployed
  client origins, and authentication-provider ownership unchanged.
  **IMPLEMENTED.**

## Remaining Phase D closure sequence

The post-D41 route inventory has 16 Web-owned POS v2 routes without Backend
counterparts. Phase D is not complete until each group below has frozen
compatibility evidence, an owned/proxy boundary, and a final route-inventory
audit:

- **D42-D43:** device validation/enrollment plus sync baseline, checkpoint,
  pull, resnapshot, and telemetry compatibility then ownership (7 routes).
- **D44-D45:** shift open, close, custody, and cash-movement compatibility then
  ownership (4 routes).
- **D46-D47:** approval request, approve, and status compatibility then
  ownership (3 routes).
- **D48-D49:** cart stock validation and stock-request receipt compatibility
  then ownership (2 routes).
- **D50:** Phase D closure audit proving every supported POS v2 route has a
  Backend owner and Web rollback surface before beginning Neon Auth proof.

## Next smallest safe slice: D42 device and sync compatibility harness

- Freeze the seven existing device/sync routes without moving ownership,
  including device/store/register scope, sequence/checkpoint and cursor rules,
  resnapshot behavior, telemetry bounds, exact RPC projections, and responses.
- Add focused platform-neutral contracts and network/database-independent
  Backend oracles before creating the remaining Backend device/sync routes.
- Keep receipt administration, shifts, approvals, stock operations, deployed
  client origins, and authentication-provider ownership unchanged.

Do not change a deployed API origin or route clients to the new Backend without
separate compatibility evidence and approval.

## Mandatory stop points

Stop for explicit approval before production Neon Auth enablement, real account
export/import, password migration, credential rotation, deployed API-origin
change, live client cutover, Supabase shutdown/deletion, or merchant-data writes
outside established controlled operations.
