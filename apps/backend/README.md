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
`TINDIO_OPEN_TICKET_SPLIT_MODE=owned` paths require `SUPABASE_URL`,
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

No financial, custody, attendance, or offline-replayed mutation outside the
explicitly listed Backend-owned commands, authentication provider, deployment,
or client API origin has moved. Clients continue using the existing Next.js
route until a separate deployment and cutover is approved.
