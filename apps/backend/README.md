# TINDIO Backend

This workspace is the independent TINDIO HTTP backend boundary. It uses the Web
`Request`/`Response` API on Node.js 22 or newer.

## Commands

- `pnpm backend:typecheck`
- `pnpm backend:build`
- `pnpm backend:test`

## Routes

- `GET /api/health` returns a stable, non-cacheable service response.
- `GET /api/pos/v2/bootstrap` owns bearer verification, organization scope,
  POS authorization, and `get_pos_bootstrap_core_v2` loading through Neon's
  external-JWT Data API.
- `GET /api/pos/v2/reference` owns bearer verification, organization scope,
  strict reference-bundle validation, and `get_pos_reference_bundle_v2`
  loading through the same provider boundary.
- `GET /api/pos/v2/catalog` owns search/favorites/recent query validation,
  pagination, bearer verification, explicit organization scope, strict item
  validation, and `get_pos_catalog_v2` loading through the same boundary.
- `GET /api/pos/v2/modifiers` owns product/store query validation, bearer
  verification, explicit organization scope, modifier-group validation, and
  `get_pos_modifiers_v2` loading through the same boundary.
- `GET /api/pos/v2/customers` owns business-context and assigned-store
  validation, `pos.access` plus `sales.create` authorization, the open-shift
  prerequisite, and the bounded `search_pos_customers` lookup through the same
  boundary.
- `GET /api/pos/v2/receipts` owns business-context validation, the three-part
  receipt permission gate, search/cursor validation, strict summary validation,
  and bounded `get_pos_receipt_history` loading through the same boundary.
- `GET /api/pos/v2/receipts/:receiptId` owns business-context validation, the
  same three-part receipt permission gate, UUID validation, unavailable-receipt
  404 behavior, strict immutable-snapshot validation, and bounded
  `get_pos_receipt_detail` loading through the same boundary.
- `GET /api/pos/v2/attendance/employees` owns the time-clock feature gate,
  `attendance.use` permission, assigned-store validation, strict employee-row
  mapping, and bounded `get_attendance_employees` loading through the same
  boundary.
- `GET /api/pos/v2/live` owns required organization scope, optional
  store/register scope, identity retry, strict live-envelope validation, and
  transfer/ticket aggregate mapping through `get_pos_live_state_v2` on the
  same boundary.
- `PUT /api/pos/v2/customer-display` owns bearer verification, business-context
  and permission validation, the frozen display update contract, and the
  `set_customer_display_state` command through the same Neon boundary.
- `POST /api/pos/v2/favorites` owns bearer verification, business-context and
  `products.manage` validation, assigned-store and request validation, and the
  idempotent `set_pos_favorite_tile` command through the same Neon boundary.
- `POST /api/pos/v2/customers/create` owns bearer verification, business-context
  and `customers.manage` validation, normalized customer input, and the direct
  RLS-protected `customers` insert through the same Neon boundary.
- `POST /api/pos/v2/tickets/save` owns the frozen open-ticket save validation,
  device custody, and `save_open_ticket_v2` command through the same boundary.
- `POST /api/pos/v2/tickets/cancel` owns the frozen cancellation validation,
  ticket-derived shift/device custody, and `cancel_open_ticket` command through
  the same boundary.
- `POST /api/pos/v2/tickets/move-lines` owns the frozen dual-ticket and line
  validation, shift/device custody, and `move_open_ticket_lines` command through
  the same boundary.
- `POST /api/pos/v2/tickets/split` owns the frozen source-ticket, label, and line
  validation, shift/device custody, and `split_open_ticket` command through the
  same boundary.
- `POST /api/pos/v2/tickets/merge` owns the frozen dual-ticket validation,
  same-register shift/device custody, and `merge_open_tickets` command through
  the same boundary.
- `POST /api/pos/v2/checkout` owns the frozen online sale validation, assigned
  store/register and first-commit shift/device custody, idempotent
  `checkout_advanced_sale` command, and post-commit stock warning through the
  same boundary.
- `POST /api/pos/v2/offline-checkout` owns the frozen offline sale validation,
  optional device sequence reservation/finalization, cash-only settlement,
  checkout, and terminal outcome recording through the same boundary.
- `POST /api/pos/v2/sync/push` owns the frozen ordered replay batch, validates
  its explicit device once, reuses the Backend offline-checkout processor for
  each event, and stops after the first non-success acknowledgement.
- `POST /api/pos/v2/receipts/:receiptId/refund` owns context-first receipt/sale
  custody, permission-or-approval validation, idempotent `refund_sale`, payment,
  and conditional stock-return effects through the same boundary.
- `POST /api/pos/v2/transfers/:transferId/receive` owns context-first transfer
  receipt validation, destination-store employee custody, idempotent
  `receive_stock_transfer`, and locked destination-stock effects through the
  same boundary.
- `POST /api/pos/v2/attendance/clock-in` and
  `POST /api/pos/v2/attendance/clock-out` own context-first time-clock gates,
  assigned-store/employee PIN validation, request replay, open-register-shift
  protection, and audited time-entry effects through the same boundary.

The default `TINDIO_BOOTSTRAP_READ_MODE=owned`,
`TINDIO_REFERENCE_READ_MODE=owned`, `TINDIO_CATALOG_READ_MODE=owned`,
`TINDIO_MODIFIERS_READ_MODE=owned`, `TINDIO_CUSTOMERS_READ_MODE=owned`, and
`TINDIO_RECEIPTS_READ_MODE=owned`, and
`TINDIO_RECEIPT_DETAIL_READ_MODE=owned`, and
`TINDIO_ATTENDANCE_EMPLOYEES_READ_MODE=owned`, and
`TINDIO_LIVE_READ_MODE=owned`, and
`TINDIO_CUSTOMER_DISPLAY_UPDATE_MODE=owned`, and
`TINDIO_FAVORITE_TILE_UPDATE_MODE=owned`, and
`TINDIO_CUSTOMER_CREATION_MODE=owned`, and
`TINDIO_OPEN_TICKET_SAVE_MODE=owned`, and
`TINDIO_OPEN_TICKET_CANCEL_MODE=owned`, and
`TINDIO_OPEN_TICKET_MOVE_LINES_MODE=owned`, and
`TINDIO_OPEN_TICKET_SPLIT_MODE=owned`, and
`TINDIO_OPEN_TICKET_MERGE_MODE=owned`, and
`TINDIO_CHECKOUT_MODE=owned`, and
`TINDIO_OFFLINE_CHECKOUT_MODE=owned`, and
`TINDIO_SYNC_PUSH_MODE=owned`, and
`TINDIO_REFUND_MODE=owned`, and
`TINDIO_TRANSFER_RECEIPT_MODE=owned`, and
`TINDIO_ATTENDANCE_MUTATION_MODE=owned` paths require `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`, and `NEON_DATA_API_URL`.
Supabase Auth remains the current identity issuer; database traffic is
rewritten only to Neon and the Supabase publishable key is removed at that
provider boundary.

Set a route's read/update mode to `proxy` with `TINDIO_WEB_API_ORIGIN` only for
rollback. All proxies forward only `Accept`, `Authorization`, and
`x-tindio-organization-id`. It preserves the upstream status, body,
`Cache-Control`, `Content-Type`, `Retry-After`, and `x-tindio-request-id`; the
reference proxy also preserves `ETag` and `x-tindio-reference-version`. The
catalogue, modifiers, customer-search, receipt-search, receipt-detail, and
attendance-employee proxies preserve their complete query strings. The detail
proxy preserves only one dynamic receipt path and rejects nested delivery/refund
mutation paths. The live proxy additionally forwards only the optional
`x-tindio-store-id` and `x-tindio-register-id` scope headers. Cookies and
unrelated headers are dropped.

The Slice D10 customer-display compatibility oracle remains network- and
database-independent. Slice D11 uses that frozen contract in the isolated
owned command and its allowlisted Web rollback proxy.

The Slice D12 favorite-tile compatibility oracle remains network- and
database-independent. Slice D13 uses that frozen contract in the isolated
owned command and allowlisted Web rollback proxy. The POS browser now invokes
the shared HTTP path directly instead of maintaining a second server-action
mutation authority; its origin is unchanged.

The Slice D14 customer-creation compatibility oracle is also network- and
database-independent. It freezes the existing Web route, server-action, direct
RLS-protected table insert, generated customer identity, and response mapping.
Slice D15 uses that frozen contract in the isolated owned command and allowlisted
Web rollback proxy. Mobile, Web POS, and Back Office now invoke the shared HTTP
path; their deployed API origins are unchanged.

The Slice D16 open-ticket save compatibility oracle is network- and database-
independent. It freezes the existing Web-owned route, Mobile HTTP and Web
server-action entry points, assigned-store and owned-open-shift custody, create
versus update idempotency, validation bounds, RPC projection, and database error
mapping. No Backend ticket-save route or runtime mode exists in this slice.

Slice D17 uses that frozen contract in an isolated owned command and allowlisted
Web rollback proxy. Mobile and Web POS now invoke the same HTTP path. Device
credentials remain in the validated body until the owned runtime converts them
to Neon RPC headers; ambient device headers and cookies are never proxied.

The Slice D18 open-ticket cancellation compatibility oracle is network- and
database-independent. It freezes the Web-owned route, Mobile HTTP and Web
server-action entry points, context and feature gates, organization-scoped open-
ticket locking, ticket-derived owned-shift/device custody, repeated-cancel
failure, RPC projection, and exact response mapping. No Backend ticket-cancel
route or runtime mode exists in this slice.

Slice D19 uses that frozen contract in an isolated owned command and allowlisted
Web rollback proxy. Mobile and Web POS now invoke the same HTTP path. Device
credentials remain in the validated body until the owned runtime converts them
to Neon RPC headers; ambient device headers and cookies are never proxied.

The Slice D20 open-ticket line-movement compatibility oracle is network- and
database-independent. It freezes the existing Web-owned route, Mobile HTTP and
Web server-action entry points, context and feature gates, source/destination
same-register custody, line and quantity validation, partial-line identity,
non-empty source behavior, exact RPC projection, audit effects, and response
mapping. No Backend ticket-move route or runtime mode exists in this slice.

Slice D21 Backend-owned open-ticket line movement uses that frozen contract in
an isolated owned command and allowlisted Web rollback proxy. Mobile and Web POS
now invoke the same HTTP path. Device credentials remain in the validated body
until the owned runtime converts them to Neon RPC headers; ambient device
headers and cookies are never proxied.

The Slice D22 open-ticket split compatibility oracle is network- and database-
independent. It freezes the existing Web-owned route, Mobile HTTP and Web
server-action entry points, context and feature gates, source-ticket and shift/
device custody, inherited destination fields, label/line validation, partial-
line identity, current all-selected source behavior, exact RPC projection,
audit effects, ticket identity, and response mapping. No Backend ticket-split
route or runtime mode exists in this slice.

Slice D23 Backend-owned open-ticket split uses that frozen contract in an
isolated owned command and allowlisted Web rollback proxy. Mobile and Web POS
now invoke the same HTTP path. Device credentials remain in the validated body
until the owned runtime converts them to Neon RPC headers; ambient device
headers and cookies are never proxied.

The Slice D24 open-ticket merge compatibility oracle is network- and database-
independent. It freezes the existing Web-owned route, Mobile HTTP and Web
server-action entry points, context and feature gates, same-store/register open-
ticket and owned-shift/device custody, application versus database validation,
full-source movement, destination capacity, preserved source audit cart, merged
status/reference, exact RPC projection, audit effects, and response mapping. No
Backend ticket-merge route or runtime mode exists in this slice.

Slice D25 Backend-owned open-ticket merge uses that frozen contract in an
isolated owned command and allowlisted Web rollback proxy. Mobile and Web POS
now invoke the same HTTP path. Device credentials remain in the validated body
until the owned runtime converts them to Neon RPC headers; ambient device
headers and cookies are never proxied.

The Slice D26 checkout compatibility oracle is network- and database-
independent. It freezes the existing Web-owned route, shared Web/Mobile path,
wrapped and legacy request bodies, Supabase bearer and organization context,
permissions, assigned-store/register and open-shift custody, device-header
forwarding, idempotent operation identity, payment and stock semantics, exact
RPC projection, financial effects, post-commit warning, and response mapping.
The oracle remains the compatibility boundary for ownership verification.

Slice D27 Backend-owned checkout uses that frozen contract in an isolated owned
command and allowlisted Web rollback proxy. Supabase verifies the bearer while
business context, checkout, and stock-warning RPC traffic uses only Neon's
external-JWT Data API. Wrapped device credentials become checkout RPC headers;
cookies and ambient device credentials are never proxied. The existing Web
route remains available for rollback, client API origins are unchanged, and
offline checkout/sync replay plus adjacent financial mutations remain in Web.

The Slice D28 offline-checkout compatibility oracle is network- and database-
independent. It freezes the existing Web-owned direct route and sync-push reuse,
both accepted request shapes, business-context-before-body ordering, optional
device sequencing, device/store/register custody, exact reservation and
finalization states, expected-total and cash-only settlement guards, terminal
outcome recording, database conflict classification, and response mapping. No
Backend offline-checkout route or runtime mode exists in this slice.

Slice D29 Backend-owned offline checkout uses that frozen contract in an
isolated owned command and allowlisted Web rollback proxy. Supabase verifies the
bearer while business context, payment-method policy, checkout, stock-warning,
device sequence, and outcome-recording traffic uses only Neon's external-JWT
Data API. Explicit body device credentials become RPC headers; ambient headers
and cookies are never proxied. The Web direct route remains available for
rollback, Web sync push keeps its existing processor, and client origins remain
unchanged.

The Slice D30 sync-push compatibility oracle is network- and database-
independent. It freezes the existing Web-owned batch route, context-before-body
ordering, one-device ascending unique event and idempotency identities,
authenticated employee/device-store custody, exact offline-checkout processor
submission, acknowledgement classification, stop-on-first-nonsuccess behavior,
and versioned response envelope. No Backend sync-push route or runtime mode
exists in this slice; Mobile keeps its existing Web API origin and path.

Slice D31 Backend-owned sync push uses that frozen contract in an isolated
owned command and allowlisted Web rollback proxy. Supabase verifies the bearer
and business context once per batch; the explicit batch device is validated
once through Neon's external-JWT Data API. Each ordered event then reuses the
Backend offline-checkout processor with the verified claims and context cached,
while all device-sequence, checkout, stock-warning, finalization, and outcome-
recording traffic remains on the Neon boundary. The existing Web route remains
available for rollback, Mobile keeps the same path and API origin, and adjacent
financial mutations remain in Web.

The Slice D32 refund compatibility oracle is network- and database-independent.
It freezes the Web-owned receipt-path route and server action, context-first
route sequencing, immutable receipt-derived sale identity, permission-or-
approval custody, normalized item/reason/reference bounds, legacy restock
default, exact RPC projection, actor-and-payload idempotency, payment and stock
effects, database error mapping, and new/replayed response envelopes. No Backend
refund route or runtime mode exists; Web and Mobile retain their existing API
origins and entry points.

Slice D33 Backend-owned refund uses that frozen contract in an isolated owned
command and an allowlisted dynamic-path Web rollback proxy. Supabase verifies
the bearer while business context, immutable receipt lookup, and `refund_sale`
traffic use only Neon's external-JWT Data API. The owned handler derives the
sale identity from the receipt before validation, preserves permission-or-
approval execution and exact replay/error envelopes, and never forwards cookies
or ambient device credentials. The Web route and server action remain available
for rollback, client origins are unchanged, and adjacent mutations remain in
Web.

The Slice D34 transfer-receipt compatibility oracle is network- and database-
independent. It freezes the context-first dynamic transfer route, path-owned
transfer identity, inventory/transfer feature gates, receive capability,
bounded received and short quantities, discrepancy notes, canonical RPC
projection, operation-key replay, destination-store employee custody, locked
inventory effects, database error mapping, and exact result envelope. No
Backend transfer-receipt route or runtime mode exists; the Web route remains
authoritative, Mobile retains its current API origin, and adjacent mutations
remain unchanged.

Slice D35 Backend-owned transfer receipt uses that frozen contract in an
isolated owned command and allowlisted dynamic-path Web rollback proxy.
Supabase verifies the bearer while business context and
`receive_stock_transfer` traffic use only Neon's external-JWT Data API. The
database retains destination-store employee custody, operation-and-payload
replay, row and advisory locking, received/short quantity accounting,
destination stock updates, and audit effects. The Web route remains available
for rollback, client origins are unchanged, and adjacent mutations remain in
Web.

The Slice D36 attendance-mutation compatibility oracle is network- and
database-independent. It freezes the context-first clock-in and clock-out
routes, common feature/permission gate, assigned-store and employee PIN
validation, exact RPC projections, request-id replay behavior, terminal and
employee store custody, open-register-shift guard, time-entry and audit effects,
database error mapping, and action result envelopes. No Backend attendance
mutation route or runtime mode exists; the Web routes remain authoritative,
Mobile retains its current API origin, and adjacent mutations remain unchanged.

Slice D37 Backend-owned attendance mutations use that frozen contract in two
isolated owned commands and a shared allowlisted Web rollback proxy. Supabase
verifies the bearer while business context and clock-in/clock-out RPC traffic
use only Neon's external-JWT Data API. Database authority retains terminal and
employee store custody, request replay, employee PIN verification, the open-
register-shift guard, time-entry writes, and audit effects. Both Web routes
remain available for rollback, client origins are unchanged, and shift
open/close plus adjacent mutations remain in Web.

The Slice D38 sale-exchange compatibility oracle is network- and database-
independent. It freezes the existing Next.js Server Action, both required sales
permissions, completed refund and replacement-receipt identities, exact RPC
projection, actor-and-payload idempotency, immutable source-transaction
custody, database error mapping, replay behavior, receipt revalidation, and
exact result messages. No Backend exchange route or runtime mode exists; the
Server Action remains authoritative, and receipt settings, receipt delivery,
shift custody, client origins, and adjacent mutations remain unchanged.

Slice D39 Backend-owned sale exchange uses that frozen contract in an isolated
owned command and an allowlisted Web rollback proxy. Supabase verifies the
bearer while business context and `link_sale_exchange` traffic use only Neon's
external-JWT Data API. The database retains completed refund/replacement-sale
custody, active employee and store checks, actor-and-payload replay, uniqueness,
immutable source transactions, and audit effects. The existing Server Action
and new Web route share the direct Web service for rollback; client origins are
unchanged, and receipt settings/delivery plus adjacent mutations remain in Web.

No financial, custody, attendance, or offline-replayed mutation outside the
explicitly listed Backend-owned commands, authentication provider, deployment,
or client API origin has moved. Clients continue using the existing Next.js
route until a separate deployment and cutover is approved.
