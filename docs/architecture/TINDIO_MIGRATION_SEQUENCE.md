# TINDIO migration sequence

Status: **IN PROGRESS**

| Slice | Scope | Status | Exit gate |
|---|---|---|---|
| A | Audit, target architecture, ADR, dependency map, baseline | **IMPLEMENTED** | Clean/synchronized Git; evidence recorded; no production mutation |
| B1 | Add `packages/*`, contracts foundation, independent commands | **IMPLEMENTED** | Typecheck/build/compatibility checks pass |
| B2 | Extract platform-neutral POS contract leaves and remove Mobile relative Web imports | **IMPLEMENTED** | Backend/Web/Mobile contract tests; unchanged wire format |
| B3 | Decide and perform root Web to `apps/web/` move | **DEFERRED** | Dedicated Vercel, alias, public asset, Playwright, env, and script proof |
| C | Create real `apps/backend/` and extract first read-only endpoint | **IMPLEMENTED** | Independent health/build/test plus dual-route compatibility |
| D | Progressive Backend extraction, mutations last | **PHASE D COMPLETE; 43 ROUTES BACKEND-OWNED** | Financial/idempotency/offline replay equivalence |
| E | Isolated synthetic Neon Auth proof on a non-production branch | **PHASE E COMPLETE — ALL 6 PLANNED SLICES; 13/13 FLOWS PASS** | Proceed to Phase F identity inventory/dry-run mapping only |
| F | Identity inventory, deterministic mapping, dry-run tooling | **F1 PARTIAL — CANONICAL AGGREGATES + DRY-RUN TOOL COMPLETE; AUTH EXPORT REQUIRED** | All Auth users accounted for; no privilege drift; no real import |
| G | Web and Mobile dual-transition Auth migration | **IN PROGRESS — WEB BLOCKED; MOBILE TRANSITION FOUNDATION IMPLEMENTED** | In-place Mobile upgrade preserves SQLite/outbox/device custody |
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

## Completed Slice D42: device and sync-control compatibility harness

- Freeze device validation/enrollment plus sync baseline, checkpoint, pull,
  resnapshot, and telemetry without moving ownership, including context-first
  authentication, permissions, organization/employee/device/store/register
  custody, request bounds, exact RPC projections, cursor expiry, resnapshot
  scope, telemetry defaults, and response envelopes. **IMPLEMENTED.**
- Extend the focused platform-neutral device and sync-control contracts and add
  a network/database-independent Backend oracle covering all seven routes.
  **IMPLEMENTED.**
- Keep all seven Next.js routes authoritative and add no Backend device/sync
  route or runtime mode. Receipt administration, shifts, approvals, stock
  operations, deployed client origins, schema, and authentication-provider
  ownership remain unchanged. **IMPLEMENTED.**

## Completed Slice D43: device and sync-control ownership

- Move the seven D42-frozen device validation/enrollment, baseline, checkpoint,
  pull, resnapshot, and telemetry POST routes behind a shared Backend-owned/
  proxy boundary while retaining every Next.js handler for rollback.
  **IMPLEMENTED.**
- Preserve context-first authorization, exact request and response contracts,
  device/store/register custody, checkpoint and retention rules, resnapshot
  scope, telemetry bounds, and credential-bound RPC execution through Neon's
  external-JWT Data API. **IMPLEMENTED.**
- Keep shifts, approvals, stock operations, schema, deployment, client origins,
  and Supabase authentication-provider ownership unchanged. **IMPLEMENTED.**

## Completed Slice D44: shift-control compatibility harness

- Freeze shift open, mobile-safe close, offline custody acquisition, and cash
  movement without moving ownership, including context-first authentication,
  permission precedence, organization/employee/device/store/register/shift
  custody, money and note bounds, checkpoint reconciliation, finalization-token
  replay, approval fallback, and exact response envelopes. **IMPLEMENTED.**
- Add focused platform-neutral shift-control contracts plus a network/database-
  independent Backend oracle covering all four routes and the HTTP 426 legacy-
  client upgrade contract. **IMPLEMENTED.**
- Keep all four Next.js routes authoritative and add no Backend shift route or
  runtime mode. Device/sync ownership, approvals, stock operations, deployed
  client origins, schema, and authentication-provider ownership remain
  unchanged. **IMPLEMENTED.**

## Completed Slice D45: shift-control ownership

- Move the four D44-frozen shift open, mobile-safe close, custody, and cash-
  movement POST routes behind a shared Backend-owned/proxy boundary while
  retaining every Next.js handler for rollback. **IMPLEMENTED.**
- Preserve context-first authorization, permission precedence, device/store/
  register/employee/shift custody, the HTTP 426 legacy-client response,
  checkpoint reconciliation, finalization-token replay, approval fallback,
  idempotency, exact RPC projections, and response envelopes through Neon's
  external-JWT Data API. **IMPLEMENTED.**
- Keep device/sync ownership, approvals, stock operations, schema, deployment,
  client origins, and Supabase authentication-provider ownership unchanged.
  **IMPLEMENTED.**

## Completed Slice D46: approval-control compatibility harness

- Freeze approval request, manager-PIN approval, and status without moving
  ownership, including context-first authentication, dynamic request identity,
  supported operations, bounded reasons and credentials, rule/store/requester/
  approver custody, PIN lockout, pending-request reuse, expiry, terminal states,
  exact database projections, and response envelopes. **IMPLEMENTED.**
- Add focused platform-neutral approval-control contracts plus a network/
  database-independent Backend oracle covering all three routes. **IMPLEMENTED.**
- Keep all three Next.js routes authoritative and add no Backend approval route
  or runtime mode. Shift ownership, stock operations, deployed client origins,
  schema, and authentication-provider ownership remain unchanged.
  **IMPLEMENTED.**

## Completed Slice D47: approval-control ownership

- Move the three D46-frozen approval request, manager-PIN approval, and status
  routes behind explicit Backend-owned/proxy boundaries while preserving all
  three Next.js routes as rollback. **IMPLEMENTED.**
- Preserve context-first authentication, dynamic path identity, bounded
  operation/reason/credentials, exact RPC and scoped status-query projections,
  PIN lockout-safe failures, pending-request reuse, expiry conversion, terminal
  states, and response envelopes through Neon's external-JWT Data API.
  **IMPLEMENTED.**
- Keep approval-rule, requesting employee, store/register, requester/approver
  separation, manager permission, PIN lockout, expiry, terminal-state, and audit
  custody in the database. Shift ownership, stock operations, deployed client
  origins, schema, and authentication-provider ownership remain unchanged.
  **IMPLEMENTED.**

## Completed Slice D48: stock-operation compatibility

- Freeze cart stock validation and stock-request receipt across the final two
  Web-owned POS v2 routes, including context-first authentication, dynamic
  request identity, permission/feature precedence, assigned-store, open-shift,
  destination, quantity, discrepancy, and replay semantics. **IMPLEMENTED.**
- Add focused platform-neutral cart-stock and stock-request-receipt contracts,
  Web adoption, plus a network/database-independent Backend compatibility
  oracle covering exact RPC projections, result mapping, and messages.
  **IMPLEMENTED.**
- Keep both Next.js routes authoritative and add no Backend stock route or
  runtime mode. Existing Backend ownership, deployed client origins, schema,
  and authentication-provider ownership remain unchanged. **IMPLEMENTED.**

## Completed Slice D49: stock-operation ownership

- Add Backend-owned POST handlers for cart stock validation and stock-request
  receipt behind an explicit owned/proxy service boundary and a method-aware,
  exact-path rollback proxy. **IMPLEMENTED.**
- Continue using Supabase to verify bearer claims while business context and
  both stock RPCs use only Neon's external-JWT Data API. Preserve context-first
  authentication, dynamic request identity, assigned-store, open-shift,
  destination, quantity, discrepancy, exact RPC projection, database-error,
  and idempotent-replay parity. **IMPLEMENTED.**
- Keep both Next.js stock routes available for rollback. Database functions and
  RLS retain policy, custody, inventory-effect, and audit authority; no schema,
  deployment, client origin, or authentication provider changed.
  **IMPLEMENTED.**

## Completed Slice D50: Phase D closure audit

- Freeze a machine-readable inventory of all 43 supported POS v2 routes under
  29 explicit ownership boundaries, including exact path, HTTP method, runtime
  mode, rollback service/proxy pair, and focused ownership gate.
  **IMPLEMENTED.**
- Derive both Web and Backend route inventories from the filesystem and require
  exact equality with the frozen ledger. Reject missing, extra, method-drifted,
  broadly proxied, ambient-credential, or undocumented routes. **IMPLEMENTED.**
- Certify that every Backend mode defaults to `owned`, every Web handler remains
  available for rollback, and Phase D closes with no schema, deployment, Auth
  provider, or client-origin change. **IMPLEMENTED.**

The post-D50 inventory has 0 Web-owned POS v2 routes without Backend
counterparts. Phase D is complete.

## Completed Slice E1: Neon Auth prerequisite assessment

- Confirmed current Managed Better Auth availability, authenticated Neon CLI
  access, AWS region eligibility, project-level administrator permission, and
  the exact linked canonical branch through read-only provider checks.
  **IMPLEMENTED.**
- Confirmed that Neon Auth is not configured on the linked branch and preserved
  Supabase as the active Auth issuer plus external-JWT Data API verifier.
  **IMPLEMENTED.**
- Froze a machine-readable 13-flow synthetic proof across Web, Backend, Mobile,
  Data API, RLS, revocation, and Supabase rollback. Every flow remains
  `NOT_RUN`; no source check is treated as runtime proof. **IMPLEMENTED.**
- Recorded five mandatory owner decisions covering disposable branch source,
  password continuity, synthetic email/domains, Mobile runtime proof, and
  rollback authority. **IMPLEMENTED.**

## Completed Slice E2: isolated environment provisioning

- Created dedicated empty Neon project `billowing-night-36088699` after the
  legacy recovery project safely rejected schema-only branching. No recovery or
  production data was copied. **IMPLEMENTED.**
- Created expiring child branch `br-spring-shape-b5qliuku`, enabled Managed
  Better Auth and Data API with `neon_auth` only there, and retained localhost
  as the only proof redirect class. **IMPLEMENTED.**
- Installed the manifest-backed canonical baseline, all 18 ordered migrations,
  and provider-neutral identity/role adapters. Independent checks found zero
  organizations, profiles, and unvalidated foreign keys. **IMPLEMENTED.**
- Created exactly one `.invalid` synthetic identity without a password and
  preserved Supabase Auth, application origins, deployment configuration,
  local environment files, and the canonical Neon context. **IMPLEMENTED.**
- Recorded automatic child-branch expiry at `2026-10-31T04:30:00Z` and the
  required manual deletion of the temporary project after Phase E. All 13
  application proof flows remain `NOT_RUN`. **IMPLEMENTED.**

## Completed Slice E3: provider-neutral Auth contracts

- Added platform-neutral provider, identity, session, credential, failure,
  state-event, verified-claims, client-session, and bearer-verifier contracts
  to `@tindio/contracts/auth`. **IMPLEMENTED.**
- Added an explicit provider selector that defaults to Supabase and rejects
  unknown or non-allowlisted providers. Every E3 runtime allowlists only
  Supabase. **IMPLEMENTED.**
- Gated Web server/browser client creation, moved Backend POS read verification
  behind the normalized bearer adapter, and moved Mobile session/token lifecycle
  behind the normalized client adapter. **IMPLEMENTED.**
- Preserved current cookies, SecureStore persistence, bearer transport, database
  claims envelope, endpoints, deployments, and Supabase provider ownership. No
  Neon SDK or application endpoint was introduced. **IMPLEMENTED.**
- Kept every Phase E runtime proof flow `NOT_RUN`; E3 compile and architecture
  gates are not provider-integration evidence. **IMPLEMENTED.**

## Completed Slice E4: isolated Neon Web adapter and proof harness

- Pinned the official Neon Auth SDK and added a Web adapter available only when
  explicit local, non-production, non-deployed proof guards pass. **IMPLEMENTED.**
- Added a synthetic-only `/auth-proof` UI plus a token-free session DTO Route
  Handler; no existing Supabase login surface changed. **IMPLEMENTED.**
- Bound the harness transiently to the E2 branch without changing any checked-in
  or deployed environment. **IMPLEMENTED.**
- Directly passed `E-AUTH-01`, `E-AUTH-03`, and `E-AUTH-06`, including an
  HTTP-only cookie, invalid-password denial, explicit revocation, and captured
  pre-sign-out cookie replay denial. **IMPLEMENTED.**
- Kept `E-AUTH-04` and the other nine unexecuted flows `NOT_RUN`; navigation
  persistence alone is not refresh proof. **IMPLEMENTED.**

## Completed Slice E5: isolated Backend claims and Data API identity

- Pinned `jose` in the Backend and added a Managed Neon Auth verifier behind
  explicit local, non-production, non-deployed guards. Supabase remains the
  default for all existing routes. **IMPLEMENTED.**
- Added a no-store proof route that returns only normalized claims and rejects
  missing bearers, invalid signatures, unauthenticated roles, and invalid
  provider configuration. **IMPLEMENTED.**
- Directly proved valid JWT acceptance and tampered-token denial in the built
  Backend, promoting `E-AUTH-05`. **IMPLEMENTED.**
- Directly proved Data API rejection of the tampered JWT and authenticated-role
  access to `current_profile_id()` with a null result, promoting `E-AUTH-11`
  without creating a merchant profile. **IMPLEMENTED.**
- Signed out the passing synthetic session and kept account secrets, JWTs,
  cookies, environment values, deployments, and client origins out of the
  repository. Five of 13 flows pass; eight remain `NOT_RUN`. **IMPLEMENTED.**

## Completed Slice E6: isolated Web lifecycle proof

- Added explicit synthetic verification and recovery UI/actions plus a no-store
  session route that forwards the SDK's HTTP-only cache cookie. **IMPLEMENTED.**
- Directly proved branch-local OTP verification and verified-session creation,
  promoting `E-AUTH-02`. **IMPLEMENTED.**
- Deleted only `session_data`, preserved `session_token`, observed cache remint,
  and retained the session, promoting `E-AUTH-04`. **IMPLEMENTED.**
- Directly proved recovery request, reset completion, old-password denial, and
  new-password acceptance, promoting `E-AUTH-07`. **IMPLEMENTED.**
- Restored the branch Auth configuration exactly, retained Supabase as default,
  and left five of 13 flows `NOT_RUN`. **IMPLEMENTED.**
- Removed four unmapped synthetic E6 identities created on the canonical Auth
  branch during diagnosis and verified zero remained. **IMPLEMENTED.**

## Completed planned Slice E5: Mobile Auth and custody proof

- Added a local-only, non-production Neon Mobile adapter with a managed Auth URL
  and localhost-origin guard while retaining Supabase as default. **IMPLEMENTED.**
- Directly proved fresh password sign-in, JWT issue, dedicated SecureStore
  cookie persistence, and relaunch restoration for `E-AUTH-08`. **IMPLEMENTED.**
- Coalesced concurrent refresh into exactly one session and one token request,
  preserving the existing one-refresh/one-retry API bound for `E-AUTH-09`.
  **IMPLEMENTED.**
- Proved Auth sign-out removes only the Neon cookie while device identity,
  SQLite transactions, receipt snapshots, and outbox custody remain unchanged,
  promoting `E-AUTH-10`. **IMPLEMENTED.**
- Deleted the exact synthetic identity and restored the disposable branch Auth
  configuration. Eleven of 13 flows now pass. **IMPLEMENTED.**

## Completed planned Slice E6: adversarial authorization and rollback closure

- Directly proved own-tenant visibility plus cross-tenant and forged-context
  denial with a real Neon JWT on the disposable Data API. **IMPLEMENTED.**
- Proved malformed and tampered denial, real-JWT expiry rejection against the
  live JWKS, and revoked identity replay resolving to no profile or RLS rows,
  promoting `E-AUTH-12`. **IMPLEMENTED.**
- Restored Supabase selection for independent Web and Mobile sessions, resolved
  the existing test identity through canonical Neon, and preserved all device/
  SQLite/receipt/outbox custody, promoting `E-AUTH-13`. **IMPLEMENTED.**
- Removed all temporary branch rows and the synthetic user, restored branch
  configuration, and closed the matrix at 13/13. **IMPLEMENTED.**

## Next phase: F identity inventory and deterministic dry-run mapping

- Inventory every current identity and business-profile relationship.
- Build deterministic mapping and exception reports without importing users.
- Stop for owner approval before any real-user import, password migration,
  production cutover, credential rotation, or provider decommission.

## Phase F1: canonical identity inventory and dry-run mapper

- Captured a read-only, PII-free aggregate inventory of canonical profiles,
  provider links, employee state, and duplicate/missing mapping risks.
  **IMPLEMENTED.**
- Added a deterministic, no-write mapper that preserves stable profile identity,
  pseudonymizes output, blocks ambiguity/conflicts, and always requires account
  claim or password reset instead of hash migration. **IMPLEMENTED.**
- Confirmed current credentials cannot enumerate Supabase Auth users: the CLI
  has no management token and no service-role credential is present. **BLOCKED
  PENDING TEMPORARY READ-ONLY AUTH EXPORT/AUTHORIZATION.**

## Phase F2: deterministic no-write user migration rehearsal

- Versioned the mapper output and made records/issues deterministic across
  source ordering. **IMPLEMENTED.**
- Added fail-closed classifications for disabled/invited source accounts,
  duplicate provider subjects, multiple same-provider profile links, orphan
  target accounts, and conflicting stable-profile mappings. **IMPLEMENTED.**
- Certified that the rehearsal emits pseudonymous references only and performs
  zero account, identity-link, or password-hash writes. **IMPLEMENTED.**

## Phase F3: provider compatibility certification

- Certified Supabase default/fallback behavior and fail-closed unknown-provider
  selection across the shared, Web, Backend, and Mobile boundaries.
  **IMPLEMENTED.**
- Certified guarded Neon claims/session normalization and consumer use of the
  provider-neutral contracts without enabling production Neon Auth.
  **IMPLEMENTED.**

## Phase F4: cutover readiness package

- Recorded completed evidence, open production gates, prohibited operations,
  and the explicit `DO_NOT_CUT_OVER` decision in a machine-readable artifact.
  **PREPARED; OWNER APPROVAL NOT GRANTED.**
- Production user import, identity-link writes, password reset campaigns,
  provider enablement, live client cutover, credential rotation, and Supabase
  decommission remain prohibited. **STOP GATE ACTIVE.**

## Phase G1: Web activation gate

- Audited the production Web sign-in, proxy, DAL, and profile-resolution path.
  Enabling Neon before F1 Auth-directory reconciliation could attach or create
  the wrong canonical profile. **BLOCKED; SUPABASE REMAINS DEFAULT.**

## Phase G2: Mobile in-place Auth transition foundation

- Pinned the current Supabase SecureStore key, added non-destructive legacy and
  Neon session inspection, and made Neon reauthentication explicit when only a
  legacy session exists. **IMPLEMENTED.**
- Provider verification is recorded only after Backend identity/tenant proof;
  sign-out retains the financial-custody gate. Legacy-session retirement has no
  deletion implementation and additionally requires explicit owner approval.
  **IMPLEMENTED; NO PRODUCTION ACTIVATION.**
- Physical installed-app upgrade and offline custody preservation remain the
  next required Phase G certification. **PENDING.**

## Phase G3: physical Auth and offline-custody upgrade harness

- Extended the existing on-device upgrade proof across legacy/new session
  presence, enrollment, offline authorization, unresolved events, immutable
  receipts, and device sequence checkpoints without persisting secrets.
  **IMPLEMENTED.**
- Added a fail-closed physical preflight and exact same-signer `adb install -r`
  campaign procedure. **IMPLEMENTED.**
- ADB is available, but no authorized Android device or Phase G baseline/
  successor APK pair was present on 2026-10-25. **PHYSICAL PASS BLOCKED.**

## Phase G4: supported-client and forced-upgrade boundary

- Added a provider-neutral client capability/version contract with explicit
  Supabase compatibility, dual-transition, and Neon-required decisions.
  **IMPLEMENTED.**
- Mobile requests now declare version, Auth provider, and transition/custody
  capabilities. Structured forced-upgrade responses preserve the provider
  session, offline readiness, and recovery custody instead of signing out.
  **IMPLEMENTED.**
- Production enforcement remains disabled. Physical fresh-install, old-client,
  forced-upgrade, in-place-upgrade, and rollback evidence is retained in the
  deferred completion register. **EXTERNAL EVIDENCE PENDING.**

## Phase G5: implementation closure and Phase H entry gate

- Consolidated G1-G4 into a machine-readable closure artifact. Repository and
  isolated implementation work is complete, while all external, physical, and
  owner-controlled gates remain open. **IMPLEMENTATION CLOSED; EXTERNAL
  CERTIFICATION OPEN.**
- Phase H may begin with runbook drafting, evidence templates, monitoring and
  support planning, and synthetic or isolated rehearsal only. Production Auth,
  identity, domain, email, credential, client-window, traffic, and provider
  retirement changes remain prohibited. **PLANNING/REHEARSAL ONLY.**
- The F4 `DO_NOT_CUT_OVER` decision remains controlling, Supabase remains the
  runtime default, and owner approval has not been recorded. **STOP GATE
  ACTIVE.**

Do not change a deployed API origin or route clients to the new Backend without
separate compatibility evidence and approval.

## Phase H1: production readiness inventory

- Reconciled the isolated Auth evidence to 13/13 flows and explicitly retained
  the distinction between synthetic feasibility and production proof.
  **PREPARED.**
- Recorded the canonical target, nine live configuration checks, six named
  operator roles, all predecessor gates, and a fail-closed `NO_GO` decision.
  **NOT READY; NO PRODUCTION CHANGE.**

## Phase H2: authenticated-traffic canary controls

- Defined zero, 1%, 5%, 25%, and 100% stages with mandatory observation
  windows, predecessor passage, reconciliation, monitoring, support, and
  operator acknowledgement. **PREPARED; H2-0 ONLY.**
- Every failed gate triggers `ROLLBACK_AND_HOLD`; no stage can promote on time
  or traffic percentage alone. **NO LIVE TRAFFIC CHANGED.**

## Phase H3: monitoring, incident, and support controls

- Defined correlated application, provider, database, Mobile, financial, and
  support evidence with 15-minute through 72-hour windows. **PREPARED.**
- Security, cross-tenant, identity, duplicate-finance, and lost-custody defects
  have zero tolerance and force rollback. Numerical availability/latency
  thresholds remain owner-ratification gates. **NOT APPROVED; NO GO.**

## Phase H4: rollback runbook and rehearsal evaluator

- Added a deterministic fail-closed evaluator for rehearsal readiness and
  outcome completeness plus the ordered selector/session/custody rollback
  procedure. **IMPLEMENTED; SYNTHETIC CHECKS PASS.**
- Retained the Phase E isolated Supabase rollback pass. Production-like
  rehearsal remains blocked by H1, named authority, owner approval, and an
  approved release candidate/cohort. **NOT RUN; NO GO.**

## Phase H5: go/no-go package and controlled-cutover closure

- Consolidated H1-H4 into a deterministic evaluator and unsigned approval
  record. Every prerequisite must be boolean `true`; partial evidence fails
  closed. **REPOSITORY PACKAGE COMPLETE.**
- Live authenticated traffic, production monitoring, production rollback
  rehearsal, and owner approval remain absent. Supabase stays default and Phase
  I retirement remains unauthorized. **PRODUCTION EXECUTION BLOCKED; NO GO.**

## Mandatory stop points

## Phase I1: Supabase dependency inventory

- Classified active Web, Mobile, Backend, package/configuration, transition, and
  historical Supabase references. **INVENTORY COMPLETE.**
- Supabase remains the runtime default under the H5 `NO_GO` decision. No active
  dependency was removed and historical migrations remain preserved.
  **REMOVAL BLOCKED.**

## Phase I2: provider retirement gate

- Added a fail-closed twelve-condition retirement evaluator covering clients,
  Auth, tenant isolation, finance, custody, backups, observation, and approval.
  **IMPLEMENTED.**
- Current repository evidence satisfies none of the production retirement
  conditions. **DO NOT RETIRE.**

## Phase I3: ordered removal manifest

- Sequenced future Web, Mobile, Backend, deployment, and workspace removal with
  surface-specific preconditions. **PLAN COMPLETE; NOT EXECUTED.**
- Protected SQL migrations, archives, and certification evidence from deletion;
  hosted-project deletion is outside the manifest. **EVIDENCE PRESERVED.**

## Phase I4: evidence archive and backup readiness

- Hash-verified the controlling H5 decision and Phase I retirement artifacts
  without storing secrets or merchant data. **REPOSITORY EVIDENCE VERIFIED.**
- Provider export, external backup, and restore drill require controlled live
  execution and remain unverified. **RETIREMENT BLOCKED.**

## Phase I5: decommission decision and Phase I closure

- Consolidated all five repository slices and the separate retirement
  checklist. **REPOSITORY PACKAGE COMPLETE.**
- Active dependencies, production evidence, backup/restore, observation, and
  owner approval remain open. No hosted resource changed. **DO NOT
  DECOMMISSION.**

## Phase J1: performance baseline

- Recorded deterministic runtime source volume, database-query callsites,
  explicit parallel groups, and client factories for the tracked tree.
  **REPOSITORY BASELINE COMPLETE.**
- Production query plans, traffic, and latency were not inspected or generated.
  **LIVE PERFORMANCE EVIDENCE DEFERRED.**

## Phase J2: evidence-based query optimization

- Reused request-scoped cached identity between verified-user and business-
  context reads and overlapped independent session work. **IMPLEMENTED.**
- Preserved authorization, bearer, tenant, and cache boundaries; no production
  configuration or data changed. **BEHAVIOR CONTRACT RETAINED.**

## Phase J3: directory organization and cleanup

- Documented canonical directory ownership and retained intentional root
  infrastructure adjacency. **OWNERSHIP CERTIFIED.**
- Hardened ignore boundaries for local package/device/temp output without
  deleting developer files or historical evidence. **SAFE CLEANUP COMPLETE.**

Stop for explicit approval before production Neon Auth enablement, real account
export/import, password migration, credential rotation, deployed API-origin
change, live client cutover, Supabase shutdown/deletion, or merchant-data writes
outside established controlled operations.
