# TINDIO architecture certification

Status: **SLICE E1 COMPLETE; NEON AUTH PREREQUISITES ASSESSED**

Certified scope: Phase 0, Slices B1-B2, Slice C, completed Phase D (Slices D1-D50), and Phase E prerequisite Slice E1 without provider provisioning

Retained Phase D certification: **SLICE D50 COMPLETE; PHASE D CLOSURE CERTIFIED**

Authentication: **SUPABASE_ACTIVE**
Database: **CANONICAL NEON UNCHANGED**

## Certified in this slice

- Git safety and canonical remote synchronization.
- Architecture audit, target, dependency map, migration ADR/sequence, and
  production cutover checklist.
- pnpm discovery for both `apps/*` and `packages/*`.
- Independent `@tindio/contracts` typecheck and platform-neutral boundary.
- Compatibility re-export of the existing POS v2 version identifier.
- Explicit Web, Mobile, contracts, and combined workspace commands.
- Unchanged Web route output and Android export.
- Provider-neutral device schemas, headers, bindings, and sequence/checkpoint
  metadata extracted into `@tindio/contracts`.
- Existing Web device and POS contract paths retained as compatibility facades.
- Device-only Mobile consumers switched from root-relative Web imports to the
  workspace package, reducing that coupling from 37 files to 34.
- Independent sync domain, baseline, cursor-expiry, and device-delta contracts
  extracted without moving checkout- or Web-DTO-dependent payloads.
- Matching Mobile sync consumers now use the workspace package, reducing
  root-relative Web contract imports from 34 files to 33.
- Catalogue, customer, payment/reference, and concrete delta-pull/resnapshot
  DTOs extracted with their existing serialized fields unchanged.
- Matching Mobile cache, local-first, cashier, and sync consumers now use the
  workspace package, reducing root-relative POS-contract imports from 33 to 23.
- Modifier option/group responses and cart-line values extracted without moving
  pricing functions, checkout schemas, checkout results, or transaction actions.
- Matching Mobile pricing, modifier-cache, cashier, inventory, and outbox
  consumers now use the package, reducing root-relative imports from 23 to 16.
- Store, register, active-shift, open-ticket, ticket-assignee, and shift-response
  DTOs extracted without moving shift/ticket schemas, server actions, custody
  policy, or mutation results.
- Matching Mobile ticket and shift-cache consumers now use the package, reducing
  root-relative POS-contract imports from 16 to 15 and direct `pos-types` imports
  from 3 to 2.
- Receipt summary/detail/list and attendance entry/employee/list DTOs extracted
  without moving receipt search, refund/delivery schemas, clock-in/out mutation
  results, workspaces, or server actions.
- The receipt layout now uses an equivalent provider-neutral recursive JSON
  value contract instead of the generated database type.
- Matching Mobile receipt, receipt-cache, and time-clock consumers now use the
  package, reducing root-relative POS-contract imports from 15 to 11.
- Customer-display session and incoming-transfer projection/status contracts
  extracted without moving customer-display validation/actions or transfer
  receipt mutations.
- Existing customer-display, inventory-transfer, POS-type, and root POS paths
  remain compatibility facades.
- The Mobile transfer screen now uses the package, reducing root-relative
  POS-contract imports from 11 to 10.
- POS support-workspace and V2 live-response aggregates extracted after all of
  their leaf dependencies became package-owned.
- Mobile now imports the live-response envelope from the package. The total
  root-relative file count remains 10 because its API transport still consumes
  mutation and bootstrap contracts from the root facade.
- Supported business-type values and their type guard moved into the shared
  package while the Web business-feature module remains a compatibility facade
  for labels and feature recommendations.
- The client-safe POS bootstrap V2 core response moved into the shared package
  with its exact envelope, organization, employee, scope, store/register,
  feature, and active-shift fields unchanged.
- Mobile bootstrap, cache, device setup, offline-authorization, and outbox
  recovery consumers now use the package, reducing direct root-relative POS
  contract imports from 10 files to 4.
- Checkout sale input values and discriminated checkout results moved into the
  shared package while the Web Zod schema remains the validating compatibility
  facade and is statically constrained to the shared output contract.
- Ordered sync-push event, acknowledgement, and response envelopes moved into
  the shared package without changing idempotency, device-sequence, retry,
  conflict, or financial result fields.
- Mobile checkout-intent, cashier, outbox, sync-policy, and API transport
  consumers now use the package, reducing direct root-relative POS contract
  imports from 4 files to 1.
- Stock-validation values, policy projections, and action results moved into the
  shared package while their Web Zod schema remains the validating facade and
  is statically constrained to the shared output contract.
- Ticket action/mutation results and time-clock action results moved into the
  shared operational and attendance domains without changing authorization,
  service, action, or response behavior.
- The Mobile API adapter, local stock estimator, and stock cache now use the
  package. Mobile has zero imports from the root POS facade or Web checkout
  schema/type modules; five unrelated helper/design-token edges remain.
- The deterministic `posItemKey` helper and shared TINDIO design-token contract
  moved into the package while their existing Web paths remain compatibility
  facades.
- Focused `@tindio/contracts/cart` and `@tindio/contracts/ui` runtime exports
  preserve analyzable bundles; Android remains at 1,473 modules and about 4.2 MB
  instead of pulling the package barrel into the UI bundle.
- All five final helper/token consumers now use package subpaths. Mobile has no
  remaining relative imports into the root Web source tree, completing Slice
  B2 without changing component logic or visual behavior.
- `apps/backend/` is now a real pnpm workspace with independent typecheck,
  build, and test commands.
- `GET /api/health` uses a stateless Web `Response`, the default Node.js
  runtime, a stable JSON payload, and `cache-control: no-store`.
- The health foundation remains provider-neutral and isolated from Web source
  and business endpoints.
- Root workspace typechecking now certifies Web, contracts, Backend, and Mobile
  as separate boundaries.
- Backend `GET /api/pos/v2/bootstrap` now provides the first read-only dual-route
  compatibility seam while the existing Next.js handler remains authoritative.
- The adapter forwards only JSON acceptance, bearer authorization, and explicit
  organization scope; cookies and unrelated request headers cannot cross.
- Upstream status, JSON bytes, cache/content metadata, retry timing, and request
  ID are preserved for 200, 401, 403, and 503 responses.
- Missing, malformed, credential-bearing, path-bearing, non-HTTP, and
  self-referential upstream origins fail closed with a bounded 503 response.
- Web and Mobile continue using `/api/pos/v2/bootstrap` on their existing API
  origin; no deployed routing or environment was changed.
- Backend bootstrap now verifies the explicit bearer with Supabase Auth
  `getClaims`, validates organization scope, enforces both POS permissions, and
  loads `get_pos_bootstrap_core_v2` through Neon's external-JWT Data API.
- The provider adapter rewrites only `/rest/v1` requests to Neon and removes the
  Supabase publishable API key while preserving the caller bearer for RLS.
- Backend defaults to owned mode; `TINDIO_BOOTSTRAP_READ_MODE=proxy` retains the
  allowlisted Web compatibility path as rollback.
- Backend requires Node.js 22 or newer, matching current Supabase JS support and
  the repository's Node 22 certification workflow.
- The owned path preserves the existing 200/401/403/503 envelopes, bounded
  failures, no-store policy, identity-mapping retry, and request IDs without
  returning token, subject, email, or provider error detail.
- Backend `GET /api/pos/v2/reference` now owns bearer verification,
  organization scoping, strict reference-bundle validation, and
  `get_pos_reference_bundle_v2` loading through the shared Neon Data API
  runtime boundary.
- The reference rollback proxy preserves only the required request fields and
  response metadata, including `ETag` and `x-tindio-reference-version`, while
  dropping cookies and unrelated headers.
- A focused `@tindio/contracts/pos-data` export gives NodeNext Backend code the
  existing response type without importing the Bundler-oriented package barrel.
- Both owned reads now preserve the established empty-organization-header
  behavior by treating an empty value as no explicit organization selection.
- Web and Mobile continue calling their current `/api/pos/v2/reference` route;
  no deployed routing, mutation ownership, or environment was changed.
- Backend `GET /api/pos/v2/catalog` now owns the bounded catalogue read with
  exact search, favorites, and recent modes; trimmed search input; optional
  category scope; and the established offset/limit bounds.
- The owned catalogue path requires explicit organization scope, verifies the
  caller bearer with Supabase Auth, retries only transient identity mapping,
  strictly validates every catalogue item, and loads `get_pos_catalog_v2`
  through the shared Neon Data API boundary.
- The catalogue rollback proxy forwards the complete query string while still
  allowlisting request and response headers, rejecting routing loops, dropping
  cookies, and preserving upstream 200/401/403/503 bodies and statuses.
- Web and Mobile continue calling `/api/pos/v2/catalog` on their current API
  origins. No catalogue client, Web route, database schema, mutation, or
  deployed environment changed.
- Backend `GET /api/pos/v2/modifiers` now owns the bounded modifiers read with
  exact store/product UUID validation, explicit organization scope, bearer
  verification, and `get_pos_modifiers_v2` loading through the shared Neon
  Data API boundary.
- Modifier groups preserve their identifiers, names, minimum/maximum selection
  values, option identifiers/names, and minor-unit prices under strict response
  validation. Only transient identity mapping retries.
- The modifiers rollback proxy preserves the complete store/product query while
  retaining the same loop rejection and request/response header allowlists.
- The focused cart contract export is now NodeNext-compatible through an
  explicit `.js` type-import specifier, while its Web and Mobile API remains
  unchanged.
- Web and Mobile continue calling `/api/pos/v2/modifiers` on their current API
  origins. No client, Web route, schema, mutation, or environment changed.
- Backend `GET /api/pos/v2/customers` now owns the bounded customer-search read,
  including full business-context validation, assigned-store enforcement,
  `pos.access` plus `sales.create` authorization, and the cashier open-shift
  prerequisite.
- The owned customer path preserves the existing trim and 100-character query
  bound, fixed eight-result database limit, exact customer field mapping, and
  403-versus-500 database failure classification under strict row validation.
- The customer rollback proxy preserves the complete store/search query while
  retaining the established loop rejection and request/response allowlists.
- Customer search reuses the focused `@tindio/contracts/pos-data` export and all
  authenticated database traffic remains on the shared Neon Data API adapter.
- Web and Mobile continue calling `/api/pos/v2/customers` on their current API
  origins. No customer creation, financial mutation, client, Web route, schema,
  deployed environment, or API origin changed.
- Backend `GET /api/pos/v2/receipts` now owns the bounded receipt-search read,
  including full business-context validation and the `pos.access`,
  `sales.create`, and `receipts.view` permission gate.
- The owned path preserves first-value query parsing, whitespace trimming, the
  100-character search bound, positive safe receipt-number cursor coercion,
  fixed 25-row database limit, and the established `hasMore` rule.
- Every receipt summary field and payment-method discriminator is strictly
  validated before the existing snake_case response is returned. Authorization
  denials and provider failures are bounded without exposing provider detail.
- The receipt rollback proxy preserves the complete query string while
  retaining loop rejection and the established header allowlists.
- A focused `@tindio/contracts/receipts` export supplies the cross-runtime list
  contract without importing the package barrel.
- Web and Mobile continue calling `/api/pos/v2/receipts` on their current API
  origins. Delivery, refunds, checkout, all other mutations, deployment
  configuration, and client origins remain unchanged.
- Backend `GET /api/pos/v2/receipts/:receiptId` now owns the receipt-detail read
  with full business-context validation and the same `pos.access`,
  `sales.create`, and `receipts.view` permission gate.
- The owned path validates exactly one UUID path segment after authorization,
  loads `get_pos_receipt_detail` through the shared Neon Data API boundary, and
  preserves the existing unavailable-receipt 404 body.
- Every nested immutable receipt, sale, item, payment, and completed-refund
  field is strictly validated before the existing camelCase snapshot is
  returned. Provider failures and authorization denials remain bounded.
- `TINDIO_RECEIPT_DETAIL_READ_MODE=proxy` retains the exact dynamic Web path and
  query while rejecting nested delivery/refund mutation routes, routing loops,
  cookies, and unrelated headers.
- Web and Mobile retain their current API origin. Receipt delivery, refunds,
  checkout, clock mutations, every other mutation, database schema, and
  deployment configuration remain unchanged.
- Backend `GET /api/pos/v2/attendance/employees` now owns the bounded employee
  read with full business-context validation, the `time_clock` feature gate,
  `attendance.use` permission, and assigned-store enforcement.
- The owned path preserves first-value `store` parsing, exact snake_case RPC
  arguments, camelCase employee and current-entry mapping, and the `Assigned
  store` fallback through the shared Neon Data API boundary.
- Null database data remains the established empty success. Provider errors,
  database denials, and malformed rows preserve the existing HTTP 200 failure
  envelope with an empty employee list and no provider detail.
- `TINDIO_ATTENDANCE_EMPLOYEES_READ_MODE=proxy` retains the query-preserving Web
  rollback with loop rejection and the established request/response header
  allowlists.
- A focused `@tindio/contracts/attendance` export supplies the cross-runtime
  employee contract without importing the package barrel.
- Web and Mobile retain their current API origin. Clock-in, clock-out, shift
  custody, checkout, sync, every other mutation, database schema, deployment
  configuration, and client routing remain unchanged.
- Backend `GET /api/pos/v2/live` now owns the bounded live-state read with the
  required organization header, optional store/register headers, exact
  pre-authentication validation order, and one `IDENTITY_UNMAPPED` retry.
- The owned path strictly validates time-clock and customer-display values plus
  all aggregate arrays before preserving the existing tolerant transfer,
  open-ticket, cart-line, modifier, customer, and assignee mapping semantics.
- Every success and failure preserves the request ID in both the body and
  `x-tindio-request-id`, with the established `no-store` response policy and
  exact V2 success envelope.
- `TINDIO_LIVE_READ_MODE=proxy` retains the query-preserving Web rollback with
  loop rejection and explicit organization/store/register request-header and
  response-header allowlists.
- A focused `@tindio/contracts/pos-runtime` export supplies the cross-runtime
  live envelope without importing the package barrel.
- Web and Mobile retain their current API origin. Checkout, customer-display
  writes, ticket actions, attendance mutations, sync, every other mutation,
  database schema, deployment configuration, and client routing remain
  unchanged.
- A focused `@tindio/contracts/customer-display` export now freezes the exact
  customer-display state/update schema, HTTP path, permission pair, RPC name,
  error bodies, open-shift database code, and success response requirements.
- The authoritative Web `PUT /api/pos/v2/customer-display` route consumes that
  contract while preserving business-context resolution, Zod defaults and
  bounds, exact RPC arguments, `42501` mapping, and `204`/`no-store` success.
- A Backend compatibility oracle reproduces validation and error mapping for
  certification only. It exposes no HTTP handler and performs no network,
  database, provider, or environment access.
- Static checks preserve the SQL permission and exact open-shift prerequisites,
  organization-scoped update, and provider-neutral role grants. No mutation
  ownership, schema, deployment, client origin, or financial/offline behavior
  changed.
- Backend `PUT /api/pos/v2/customer-display` now owns the first bounded,
  non-financial mutation while preserving the Web route as rollback.
- The owned path preserves bearer verification, organization selection and one
  identity-mapping retry, full business-context validation, the exact permission
  pair, context-before-body ordering, schema defaults/bounds, and RPC arguments.
- Supabase remains the identity issuer, while both the context and update RPCs
  are sent only to the external-JWT Neon Data API without forwarding the
  Supabase publishable key across the database-provider boundary.
- `TINDIO_CUSTOMER_DISPLAY_UPDATE_MODE=proxy` preserves the complete request
  body and query while forwarding only allowlisted headers, rejecting loops,
  credentials in origins, cookies, and unrelated ambient headers.
- Web and Mobile retain their current API origin. Customer creation, checkout,
  refunds, transfers, ticket custody, attendance, sync, database schema,
  deployment configuration, and every financial/offline mutation are unchanged.
- A focused `@tindio/contracts/favorite-tile` export freezes the exact path,
  permission, schema, result messages, RPC name/error codes, and 24-tile limit.
- At the Slice D12 gate, the authoritative Web HTTP route and server action
  consumed that contract while preserving context-before-body ordering,
  permission-before-JSON ordering, assigned-store validation, nullable
  variants, and exact RPC args.
- The Backend compatibility oracle reproduces validation and RPC result mapping
  without network or database access; D12 introduced no HTTP handler,
  environment mode, or second runtime mutation authority.
- Static checks preserve saleability, active POS workspace/shift access,
  advisory locking, first-free 1-through-24 placement, idempotent pin/unpin,
  provider-neutral grants, and store-scoped RLS. Malformed JSON remains HTTP
  `400`; permission, validation, RPC failure, and success results remain HTTP
  `200` through the Web response envelope.
- At the Slice D12 gate, the POS UI still invoked the existing server action
  and the Web API route remained authoritative. No ownership, client origin,
  schema, deployment, or higher-risk mutation changed in that slice.
- Backend `POST /api/pos/v2/favorites` now owns the second bounded,
  non-financial mutation while preserving the Web route as rollback.
- The owned path preserves bearer verification, organization selection and one
  identity-mapping retry, full business-context validation, `products.manage`
  before body parsing, malformed-JSON `400`, action-result `200`, assigned-store
  validation, nullable variants, exact RPC arguments, error mapping, and
  idempotent pin/unpin success bodies.
- Supabase remains the identity issuer, while both context and favorite RPCs
  are sent only to the external-JWT Neon Data API without forwarding the
  Supabase publishable key across the database-provider boundary.
- `TINDIO_FAVORITE_TILE_UPDATE_MODE=proxy` preserves the complete request body
  and query while forwarding only allowlisted headers and rejecting loops,
  credential-bearing origins, cookies, and unrelated ambient headers.
- The POS browser now uses the same-origin favorite HTTP command and the
  redundant favorite-only server action is removed. Web and Mobile origins,
  database schema, deployment, customer creation, and every financial,
  custody, attendance, or offline-replayed mutation remain unchanged.
- A focused `@tindio/contracts/customer-creation` export now freezes the path,
  `customers.manage` permission, normalized input schema, selected database
  projection, exact messages, and success/failure result envelope.
- The Web route still resolves business context and permission before JSON.
  Mobile still uses that HTTP route, while Web POS and Back Office still use
  the shared server action/service; D14 moves neither entry point.
- Customer creation performs a direct `customers` insert. It has no store or
  open-shift prerequisite and no RPC. RLS enforces organization permission;
  the database trigger serializes and assigns customer numbers and default
  loyalty codes, while constraints and unique keys remain authoritative.
- The isolated Backend oracle reproduces validation, permission/database-error
  mapping, and the POS customer projection without network/database access.
  No Backend route, runtime mode, environment variable, schema, deployment, or
  client origin was added or changed in D14.
- Backend `POST /api/pos/v2/customers/create` now owns the third bounded,
  non-financial mutation while preserving the Web route as rollback.
- The owned path preserves bounded bearer verification, organization selection
  and identity retry, full business-context validation, `customers.manage`
  before JSON parsing, exact `400` versus `200` envelopes, normalization,
  database-error mapping, strict returned-row validation, and success mapping.
- Supabase remains the identity issuer. Business context and direct customer
  insertion are sent only through the external-JWT Neon Data API, and the
  Supabase publishable key is removed at that database-provider boundary.
- `TINDIO_CUSTOMER_CREATION_MODE=proxy` preserves the complete request body and
  query while forwarding only allowlisted headers and rejecting loops,
  credential-bearing origins, cookies, and unrelated ambient headers.
- Mobile, Web POS, and Back Office now use the same shared HTTP command. The
  creation-only server action is removed; deployed origins, database schema,
  checkout, custody, attendance, sync, and offline replay remain unchanged.
- A focused `@tindio/contracts/open-ticket-save` export now freezes the path,
  three application permissions, feature gate, complete nested schema, RPC,
  database codes, messages, and result envelope.
- The isolated Backend oracle freezes assigned-store validation, owned-open-
  shift custody, non-idempotent creation versus stable-ticket updates, exact RPC
  projection, and database error mapping without network/database access.
- The Web route remains authoritative. Mobile still uses the HTTP endpoint and
  Web POS still uses its server action/service. No Backend ticket-save route,
  runtime mode, schema, deployment, client origin, or adjacent mutation changed.
- Backend `POST /api/pos/v2/tickets/save` now owns the fourth bounded mutation
  while preserving the existing Web route as rollback.
- The owned path preserves Supabase claim verification, organization selection
  and identity retry, full business-context validation, context-before-JSON
  ordering, exact `400` versus `200` envelopes, permissions, feature and store
  scope, schema normalization, device-bound RPC headers, and error mapping.
- Both context and ticket RPC traffic use the external-JWT Neon Data API. The
  Supabase publishable key is removed at the provider boundary, while cookies
  and ambient device credentials are excluded from rollback proxy forwarding.
- Mobile and Web POS now use the shared HTTP command. The save-only server
  action is removed; cancel/move/split/merge, checkout, refunds, transfer
  receipt, attendance, sync, deployment, schema, and client origins are intact.
- A focused `@tindio/contracts/open-ticket-cancel` export now freezes the path,
  three application permissions, feature gate, ticket/device schema, RPC,
  database codes, messages, and result envelope.
- The isolated Backend oracle freezes context and feature validation, ticket-
  derived store scope, owned-open-shift/device custody, exact RPC projection,
  repeated-cancel `P0002` behavior, and response mapping without network or
  database access.
- The existing Web route remains authoritative. Mobile still uses HTTP and Web
  POS still uses its server action/service. No Backend cancellation route,
  runtime mode, schema, deployment, client origin, or adjacent mutation changed.
- Backend `POST /api/pos/v2/tickets/cancel` now owns the fifth bounded mutation
  while preserving the existing Web route as rollback.
- The owned path preserves Supabase claim verification, organization selection
  and identity retry, full business-context validation, context-before-JSON
  ordering, exact `400` versus `200` envelopes, permissions, feature gate,
  device-bound RPC execution, repeated-cancel failure, and error mapping.
- Context and cancellation RPC traffic use only the external-JWT Neon Data API.
  The Supabase publishable key is removed at the provider boundary; cookies and
  ambient device credentials are excluded from rollback proxy forwarding.
- Mobile and Web POS now use the shared HTTP command. The cancellation-only
  server action is removed; move/split/merge, checkout, refunds, transfer
  receipt, attendance, sync, deployment, schema, and client origins are intact.
- A focused `@tindio/contracts/open-ticket-move-lines` export now freezes the
  path, permissions, feature, dual-ticket/line/device schema, RPC, database
  codes, messages, and result envelope.
- The isolated Backend oracle freezes context and feature validation, same-
  store/register open-ticket scope, owned-open-shift/device custody, app versus
  database validation responsibilities, exact RPC projection, partial-line
  identity, non-empty source and destination capacity, audit effects, and
  response mapping without network or database access.
- The existing Web route remains authoritative. Mobile still uses HTTP and Web
  POS still uses its server action/service. No Backend line-movement route,
  runtime mode, schema, deployment, client origin, or adjacent mutation changed.
- Backend `POST /api/pos/v2/tickets/move-lines` now owns the sixth bounded
  mutation while preserving the existing Web route as rollback.
- The owned path preserves Supabase claim verification, organization selection
  and identity retry, full business-context validation, context-before-JSON
  ordering, exact `400` versus `200` envelopes, permissions, feature gate,
  device-bound RPC execution, dual-ticket/line rules, and error mapping.
- Context and line-movement RPC traffic use only the external-JWT Neon Data API.
  The Supabase publishable key is removed at the provider boundary; cookies and
  ambient device credentials are excluded from rollback proxy forwarding.
- Mobile and Web POS now use the shared HTTP command. The movement-only server
  action is removed; merge/split, checkout, refunds, transfer receipt,
  attendance, sync, deployment, schema, and client origins are intact.
- A focused `@tindio/contracts/open-ticket-split` export now freezes the path,
  permissions, feature, source-ticket/label/line/device schema, RPC, database
  codes, messages, ticket identity, and result envelope.
- The isolated Backend oracle freezes source-ticket and owned-open-shift/device
  custody, destination field inheritance, app versus database validation, exact
  RPC projection, partial-line identity, current all-selected source behavior,
  audit effects, and response mapping without network or database access.
- The existing Web route remains authoritative. Mobile still uses HTTP and Web
  POS still uses its server action/service. No Backend split route, runtime
  mode, schema, deployment, client origin, or adjacent mutation changed.
- Backend `POST /api/pos/v2/tickets/split` now owns the seventh bounded mutation
  while preserving the existing Web route as rollback.
- The owned path preserves Supabase claim verification, organization selection
  and identity retry, full business-context validation, context-before-JSON
  ordering, exact `400` versus `200` envelopes, permissions, feature gate,
  device-bound RPC execution, returned ticket identity, and error mapping.
- Context and split RPC traffic use only the external-JWT Neon Data API. The
  Supabase publishable key is removed at the provider boundary; cookies and
  ambient device credentials are excluded from rollback proxy forwarding.
- Mobile and Web POS now use the shared HTTP command. The split-only server
  action is removed; merge, checkout, refunds, transfer receipt, attendance,
  sync, deployment, schema, and client origins are intact.
- A focused `@tindio/contracts/open-ticket-merge` export now freezes the path,
  permissions, feature, dual-ticket/device schema, RPC, database codes,
  messages, and result envelope.
- The isolated Backend oracle freezes context and feature validation, same-
  store/register open-ticket scope, owned-open-shift/device custody, application
  versus database validation, full-source movement, destination capacity,
  preserved source audit cart, merged status/reference, exact RPC projection,
  audit effects, and response mapping without network or database access.
- The existing Web route remains authoritative. Mobile still uses HTTP and Web
  POS still uses its server action/service. No Backend merge route, runtime
  mode, schema, deployment, client origin, or adjacent mutation changed.
- Backend `POST /api/pos/v2/tickets/merge` now owns the eighth bounded mutation
  while preserving the existing Web route as rollback.
- The owned path preserves Supabase claim verification, organization selection
  and identity retry, full business-context validation, context-before-JSON
  ordering, exact `400` versus `200` envelopes, permissions, feature gate,
  device-bound RPC execution, dual-ticket rules, and error mapping.
- Context and merge RPC traffic use only the external-JWT Neon Data API. The
  Supabase publishable key is removed at the provider boundary; cookies and
  ambient device credentials are excluded from rollback proxy forwarding.
- Mobile and Web POS now use the shared HTTP command. The merge-only server
  action is removed; checkout, refunds, transfer receipt, attendance, sync,
  deployment, schema, and client origins are intact.
- A focused `@tindio/contracts/checkout` export now freezes the shared Web/Mobile
  path, wrapped and legacy request bodies, validation bounds, permissions,
  messages, RPC names, and financial result envelope.
- The isolated Backend oracle freezes JSON-before-context ordering, Supabase
  bearer and organization selection, assigned-store/register and first-commit
  open-shift custody, device-header forwarding, conditional discount/ticket
  permissions, idempotent operation identity, exact RPC projection, payment and
  stock semantics, financial effects, post-commit warning, and response mapping
  without network or database access.
- The existing Web route remains authoritative. Web and Mobile now import the
  shared path constant but retain their current API origins. No Backend checkout
  route, runtime mode, schema, deployment, offline replay, or adjacent financial
  mutation changed.
- Backend `POST /api/pos/v2/checkout` now owns the ninth bounded mutation while
  preserving the existing Web route as rollback.
- The owned path preserves JSON-before-context ordering, bounded Supabase claim
  verification, organization selection and identity retry, complete business-
  context validation, wrapped and legacy request bodies, assigned-store and
  conditional capability checks, exact `400`/`409`/`503`/ambiguous `500`
  envelopes, and post-commit stock warnings.
- Business context, checkout, and warning RPC traffic use only the external-JWT
  Neon Data API. Explicit wrapped device credentials become checkout RPC
  headers; the publishable key, cookies, and ambient device credentials do not
  cross the database or rollback-proxy boundaries.
- Web and Mobile keep the shared HTTP path and their existing deployed origins.
  Offline checkout/sync replay, refunds, transfer receipt, attendance, schema,
  deployment, and every adjacent financial mutation remain unchanged.
- A focused `@tindio/contracts/offline-checkout` export now freezes the direct
  path, sequence RPCs/statuses, terminal conflict vocabulary, validation schema,
  exact retry/conflict messages, and result envelope.
- The isolated Backend oracle freezes context-before-JSON ordering, wrapped and
  legacy requests, optional device sequencing, device/store/register custody,
  reservation/finalization states, expected-total and cash-only settlement,
  terminal outcome recording, database-error classification, and response
  mapping without network or database access.
- The existing Web direct route remains authoritative, and Web sync push still
  reuses its processor. Mobile remains on `/api/pos/v2/sync/push`. No Backend
  offline-checkout route, runtime mode, schema, deployment, client origin,
  authentication provider, or adjacent financial mutation changed.
- Backend `POST /api/pos/v2/offline-checkout` now owns the tenth bounded mutation
  while preserving the existing Web direct route as rollback.
- The owned path preserves bounded Supabase claim verification, business-
  context-before-JSON ordering, organization selection and identity retry,
  wrapped and legacy request bodies, optional device sequencing, exact terminal
  versus retryable outcomes, cash-only settlement, total-marker protection,
  post-commit stock warnings, sequence finalization, and outcome recording.
- Business context, payment-method policy, checkout, stock-warning, sequence,
  and recording traffic use only the external-JWT Neon Data API. Explicit body
  device credentials become database headers; cookies and ambient device
  credentials do not cross the rollback-proxy boundary.
- The Web sync-push route still reuses its existing Web processor. Client API
  origins, refunds, transfer receipt, attendance, schema, deployment,
  authentication-provider ownership, and adjacent mutations remain unchanged.
- A focused `@tindio/contracts/sync-push` export now freezes the route path,
  operation/version/event limits, request schema, exact error messages,
  acknowledgement statuses, and response envelope.
- The isolated Backend oracle freezes context-before-JSON ordering, one-device
  ascending unique event/checkout identities, authenticated device validation,
  exact offline-checkout submissions, acknowledgement classification,
  stop-on-first-nonsuccess behavior, and response construction without network
  or database access.
- The existing Web sync-push route remains authoritative and still invokes the
  frozen Web offline-checkout processor. No Backend sync-push route, runtime
  mode, schema, deployment, client origin, authentication-provider ownership,
  outbox data, or adjacent mutation changed.
- Backend `POST /api/pos/v2/sync/push` now owns the eleventh bounded mutation
  while preserving the existing Web batch route as rollback.
- The owned path preserves one-time bounded Supabase claim verification,
  business-context-before-JSON ordering, organization selection and identity
  retry, one-device ascending unique event and checkout identities, exact
  acknowledgement mapping, and stop-on-first-nonsuccess behavior.
- The explicit batch device is validated once through Neon's external-JWT Data
  API. Each event reuses the Backend offline-checkout processor with cached
  verified claims and business context; sequence, payment-method, checkout,
  stock-warning, finalization, and recording traffic remains Neon-only.
- Mobile retains `/api/pos/v2/sync/push` and its existing deployed origin. The
  Web rollback route, schema, outbox records, refunds, transfer receipt,
  attendance, deployment, and authentication-provider ownership are unchanged.
- A focused `@tindio/contracts/refund` export now freezes the dynamic receipt
  path, permission and database vocabulary, bounded refund schema, historical
  restock default, exact messages, database row, and response envelope.
- The isolated Backend oracle freezes context-first route sequencing, immutable
  receipt-derived sale identity, permission-or-approval execution, normalized
  RPC projection, actor-and-payload idempotency, conditional inventory return,
  payment/reference policy, error mapping, and replay messages without network
  or database access.
- The existing Web route and server action remain authoritative. Web and Mobile
  consume the shared schema/path or result contract while retaining their
  current origins. No Backend refund route, runtime mode, schema, deployment,
  authentication provider, transfer, attendance, or exchange mutation changed.
- Backend `POST /api/pos/v2/receipts/:receiptId/refund` now owns the twelfth
  bounded mutation while preserving the existing Web route as rollback.
- The owned path preserves bounded Supabase claim verification, context-first
  ordering, dynamic receipt validation, immutable receipt-derived sale identity,
  permission-or-approval execution, normalized input, exact idempotent replay,
  database error, and response mapping.
- Business context, receipt custody, and `refund_sale` traffic use only the
  external-JWT Neon Data API. The dedicated mutation runtime leaves the shared
  read-RPC allowlist unchanged; cookies and ambient device credentials do not
  cross the rollback boundary.
- Web and Mobile retain the shared refund contract and their existing origins.
  Schema, deployment, authentication-provider ownership, transfer receipt,
  attendance, exchanges, and adjacent mutations remain unchanged.
- A focused `@tindio/contracts/transfer-receipt` export now freezes the dynamic
  route, permission and feature vocabulary, bounded receipt schema, exact
  messages, path builder, and result envelope.
- The isolated Backend oracle freezes context-before-path-before-JSON ordering,
  path-owned transfer identity, feature and permission precedence, normalized
  RPC projection, operation-and-payload replay, destination-store employee
  custody, locked received/short quantities, destination inventory effects,
  error mapping, and success response without network or database access.
- The existing Web route remains authoritative and Mobile consumes the shared
  path/result contract at its current origin. No Backend transfer-receipt route,
  runtime mode, schema, deployment, authentication provider, attendance,
  exchange, or adjacent mutation changed.
- Backend `POST /api/pos/v2/transfers/:transferId/receive` now owns the
  thirteenth bounded mutation while preserving the existing Web route as
  rollback.
- The owned path preserves bounded Supabase claim verification, context-first
  ordering, dynamic transfer validation, path-owned transfer identity, feature
  and permission precedence, normalized input, database error mapping, and the
  exact response envelope.
- Business context and `receive_stock_transfer` traffic use only the external-
  JWT Neon Data API. Database authority retains destination-store employee
  custody, operation-and-payload replay, advisory and row locks, received/short
  accounting, destination stock effects, and audit logging.
- Web and Mobile retain the shared transfer-receipt contract and existing
  origins. Schema, deployment, authentication-provider ownership, attendance,
  stock-request receipt, exchanges, and adjacent mutations remain unchanged.
- A focused `@tindio/contracts/attendance-mutation` export now freezes both
  attendance mutation paths, permission/RPC vocabulary, employee PIN schemas,
  exact messages, database row, and action result envelope.
- The isolated Backend oracle freezes context-first feature/permission gates,
  assigned-store clock-in validation, employee clock-out validation, RPC
  projections, approved database-error passthrough, replayed results, the open-
  register-shift guard, and completed entries without network or database
  access.
- The existing Web routes remain authoritative and Mobile consumes the shared
  paths/input types at its current origin. No Backend attendance mutation route,
  runtime mode, schema, deployment, authentication provider, shift custody,
  exchange, or adjacent mutation changed.
- Backend `POST /api/pos/v2/attendance/clock-in` and
  `POST /api/pos/v2/attendance/clock-out` now own the fourteenth and fifteenth
  bounded mutations while preserving both existing Web routes as rollback.
- The owned handlers preserve context-first feature/permission gates, assigned-
  store clock-in validation, employee clock-out validation, request-id replay,
  employee PIN verification, the open-register-shift guard, time-entry/audit
  effects, approved database-error detail, and exact result envelopes.
- Supabase verifies bearer claims while business context and both attendance RPCs
  use only Neon's external-JWT Data API. The shared rollback proxy rejects loops
  and forwards only allowlisted headers; cookies and ambient device credentials
  do not cross the boundary.
- Mobile retains the shared paths and its existing deployed origin. Schema,
  deployment, authentication-provider ownership, shift open/close ownership,
  exchanges, and adjacent mutations remain unchanged.
- A focused `@tindio/contracts/sale-exchange` export now freezes both required
  sales permissions, UUID and replacement-receipt validation, RPC vocabulary,
  exact database/result messages, the database row, and action result envelope.
- The isolated Backend oracle freezes permission-before-input precedence, exact
  RPC projection, approved database-error handling, new/replayed messages,
  completed refund/replacement identity, actor-and-payload idempotency, and
  immutable source-transaction custody without network or database access.
- The existing Next.js Server Action remains authoritative. No Backend exchange
  route or runtime mode, schema, deployment, authentication provider, receipt
  settings/delivery, shift custody, client origin, or adjacent mutation changed.
- Backend `POST /api/pos/v2/exchanges/link` now owns the sixteenth bounded
  mutation while preserving the existing Server Action and direct Web route as
  rollback surfaces.
- The owned handler preserves context-first claim and business authorization,
  both sales permissions before action validation, exact RPC projection,
  completed refund/replacement identities, actor-and-payload replay, immutable
  source transactions, approved database-error detail, and exact result
  messages.
- Supabase verifies bearer claims while business context and sale-exchange RPC
  traffic use only Neon's external-JWT Data API. The rollback proxy rejects
  loops and forwards only allowlisted headers; cookies and ambient device
  credentials do not cross the boundary. Client origins, schema, deployment,
  authentication-provider ownership, receipt settings/delivery, shift custody,
  and adjacent mutations remain unchanged.
- Focused `@tindio/contracts/receipt-settings` and
  `@tindio/contracts/receipt-delivery` exports now freeze the permissions,
  bounded inputs, RPC vocabulary, exact database/result messages, delivery row,
  and Server Action result envelopes.
- The isolated Backend receipt-administration oracle freezes context-first
  permission precedence, exact settings and EMAIL-delivery RPC projections,
  approved database-error handling, delivery replay, settings snapshots,
  receipt/store scope, actor-and-payload idempotency, immutable outbox custody,
  revalidation, and exact result messages without network or database access.
- Both existing Next.js Server Actions remain authoritative. No Backend receipt-
  settings or delivery route or runtime mode, schema, deployment,
  authentication provider, sale exchange, shift custody, client origin, or
  adjacent mutation changed.
- Backend `POST /api/pos/v2/receipt-settings` and
  `POST /api/pos/v2/receipts/:receiptId/delivery` now own the seventeenth and
  eighteenth bounded mutations while preserving both Server Actions and direct
  Web routes as rollback surfaces.
- The owned handlers preserve context-first authentication, settings/reprint
  permission precedence, exact RPC projections, dynamic receipt identity,
  actor-and-payload delivery replay, future-only receipt-layout snapshots,
  immutable delivery-outbox custody, approved database errors, and exact result
  messages.
- Supabase verifies bearer claims while business context and both mutation RPCs
  use only Neon's external-JWT Data API. The shared rollback proxy rejects
  loops and forwards only allowlisted headers; cookies and ambient device
  credentials do not cross the boundary. Client origins, schema, deployment,
  authentication-provider ownership, sale exchange, shifts, and adjacent
  mutations remain unchanged.
- Focused `@tindio/contracts/device` and `@tindio/contracts/sync-control`
  exports now freeze the seven device/sync paths, permissions, bounded request
  schemas, RPC vocabulary, exact messages, cursor-expiry discriminant,
  resnapshot flags, telemetry defaults, and response shapes.
- The isolated Backend device/sync oracle freezes context-first authorization,
  exact validation and enrollment projections, device/store/register mapping,
  safe checkpoint/revision handling, retained-cursor expiry, authoritative
  resnapshot scope, employee-bound telemetry, and exact telemetry projection
  without network or database access.
- Backend now owns all seven frozen device/sync POST paths through one isolated
  command boundary and one allowlisted rollback proxy; the existing Next.js
  handlers remain intact.
- Supabase continues to verify bearer claims while business context and all
  device/sync RPCs use Neon's external-JWT Data API. Device credentials are
  attached only to the RPC clients that enforce device custody.
- No schema, deployment, authentication provider, shift, approval, stock
  operation, client origin, or adjacent mutation changed.
- Focused `@tindio/contracts/shift-control` exports now freeze all four shift
  paths, permissions, RPC vocabulary, bounded inputs, device custody, the
  legacy HTTP 426 upgrade envelope, and response messages.
- The isolated Backend shift oracle freezes permission and validation
  precedence, exact RPC projections, cash conversion, database error mapping,
  checkpoint/finalization custody, approval fallback, replay, and cash-summary
  semantics without network or database access.
- All four existing Next.js shift routes remain authoritative. No Backend shift
  route or runtime mode, schema, deployment, Auth provider, client origin,
  approval route, stock route, or adjacent mutation changed.
- The D46 approval-control oracle freezes context-first authentication, dynamic
  request identity, operation and credential bounds, exact RPC/query
  projections, database error filtering, pending-request reuse, expiry,
  terminal states, and response envelopes without network or database access.
- Backend now owns all three frozen approval routes through isolated handlers
  and one method-aware, allowlisted Web rollback proxy; the existing Next.js
  handlers remain intact.
- Supabase continues to verify bearer claims while business context, both
  approval RPCs, and the organization-scoped status read use Neon's external-
  JWT Data API. Database functions and RLS retain approval-rule, actor/store,
  requester/approver separation, manager permission, PIN lockout, expiry,
  state, and audit custody.
- No schema, deployment, authentication provider, shift ownership, stock
  operation, client origin, or adjacent mutation changed.
- Focused shared cart-stock and stock-request-receipt contracts now freeze both
  final Web-owned POS v2 stock routes, permissions, bounds, messages, dynamic
  identity, and exact RPC vocabulary.
- The isolated D48 Backend oracle freezes validation precedence, assigned-store
  custody, stock-policy result mapping, receipt projection, discrepancy rules,
  database errors, and idempotent replay without network or database access.
- Both Next.js stock routes remain authoritative. No Backend stock route or
  runtime mode, schema, deployment, Auth provider, or client origin changed.
- Backend now owns both frozen stock-operation routes through isolated POST
  handlers and one exact-path, method-aware Web rollback proxy. Both existing
  Next.js handlers remain intact.
- Supabase continues to verify bearer claims while business context, cart stock
  validation, and stock-request receipt use only Neon's external-JWT Data API.
  Database functions and RLS retain negative-stock, open-shift, component,
  request/destination, received-only inventory, replay, and audit custody.
- No schema, deployment, authentication provider, client origin, or adjacent
  mutation changed.
- The D50 machine-readable route ledger freezes all 43 supported POS v2 routes
  under 29 explicit ownership boundaries with exact methods, owned-by-default
  runtime modes, rollback services/proxies, and focused ownership gates.
- Filesystem-derived Web and Backend inventories match the ledger exactly. No
  Web-only, Backend-only, missing, extra, or method-drifted POS v2 route remains.
- Every rollback proxy remains method-aware and allowlisted without ambient
  cookie or device-secret forwarding. All Web handlers remain intact.
- Phase D closes without schema, deployment, Auth provider, credential, client
  origin, or live cutover changes.
- Read-only provider checks confirm Neon CLI 4.14.3 OAuth access, administrator
  permission to the linked `aws-us-east-2` project, the canonical branch
  identity, and that Managed Better Auth is not configured on that branch.
- A machine-readable Phase E matrix freezes exactly 13 synthetic-only Web,
  Backend, Mobile, Data API, database/RLS, revocation, and rollback flows. All
  remain `NOT_RUN` until real isolated execution evidence exists.
- Provisioning remains fail-closed pending owner decisions for the disposable
  branch source, password continuity, synthetic email/domains, Mobile runtime
  proof, and rollback authority. Supabase Auth remains active.

## Results

| Gate | Result |
|---|---|
| Architecture foundation | **PASS (3/3)** |
| POS shared-contract compatibility | **PASS (7/7)** |
| POS v1 retirement compatibility | **PASS (5/5)** |
| Backend behavior and contracts | **PASS (776/776)** |
| Backend foundation boundary | **PASS (3/3)** |
| Backend bootstrap ownership/rollback boundary | **PASS (5/5)** |
| Backend reference ownership/rollback boundary | **PASS (5/5)** |
| Backend catalogue ownership/rollback boundary | **PASS (5/5)** |
| Backend modifiers ownership/rollback boundary | **PASS (5/5)** |
| Backend customer-search ownership/rollback boundary | **PASS (5/5)** |
| Backend receipt-search ownership/rollback boundary | **PASS (5/5)** |
| Backend receipt-detail ownership/rollback boundary | **PASS (5/5)** |
| Backend attendance-employee ownership/rollback boundary | **PASS (5/5)** |
| Backend live-state ownership/rollback boundary | **PASS (5/5)** |
| Backend customer-display mutation compatibility boundary | **PASS (5/5)** |
| Backend customer-display ownership/rollback boundary | **PASS (5/5)** |
| Backend favorite-tile mutation compatibility boundary | **PASS (5/5)** |
| Backend favorite-tile ownership/rollback boundary | **PASS (5/5)** |
| Backend customer-creation mutation compatibility boundary | **PASS (5/5)** |
| Backend customer-creation ownership/rollback boundary | **PASS (5/5)** |
| Backend open-ticket save mutation compatibility boundary | **PASS (5/5)** |
| Backend open-ticket save ownership/rollback boundary | **PASS (5/5)** |
| Backend open-ticket cancellation mutation compatibility boundary | **PASS (5/5)** |
| Backend open-ticket cancellation ownership/rollback boundary | **PASS (5/5)** |
| Backend open-ticket line-movement compatibility boundary | **PASS (5/5)** |
| Backend open-ticket line-movement ownership/rollback boundary | **PASS (5/5)** |
| Backend open-ticket split mutation compatibility boundary | **PASS (5/5)** |
| Backend open-ticket split ownership/rollback boundary | **PASS (5/5)** |
| Backend open-ticket merge mutation compatibility boundary | **PASS (5/5)** |
| Backend open-ticket merge ownership/rollback boundary | **PASS (5/5)** |
| Backend checkout mutation compatibility boundary | **PASS (5/5)** |
| Backend checkout ownership/rollback boundary | **PASS (5/5)** |
| Backend offline-checkout compatibility boundary | **PASS (5/5)** |
| Backend offline-checkout ownership/rollback boundary | **PASS (5/5)** |
| Backend sync-push compatibility boundary | **PASS (5/5)** |
| Backend sync-push ownership/rollback boundary | **PASS (5/5)** |
| Backend refund mutation compatibility boundary | **PASS (5/5)** |
| Backend refund ownership/rollback boundary | **PASS (5/5)** |
| Backend transfer-receipt compatibility boundary | **PASS (5/5)** |
| Backend transfer-receipt ownership/rollback boundary | **PASS (5/5)** |
| Backend attendance mutation compatibility boundary | **PASS (5/5)** |
| Backend attendance mutation ownership/rollback boundary | **PASS (5/5)** |
| Backend sale-exchange compatibility boundary | **PASS (5/5)** |
| Backend sale-exchange ownership/rollback boundary | **PASS (5/5)** |
| Backend receipt-administration compatibility boundary | **PASS (5/5)** |
| Backend receipt-administration ownership/rollback boundary | **PASS (5/5)** |
| Backend device/sync-control compatibility boundary | **PASS (5/5)** |
| Backend device/sync-control ownership/rollback boundary | **PASS (5/5)** |
| Backend shift-control compatibility boundary | **PASS (5/5)** |
| Backend shift-control ownership boundary | **PASS (5/5)** |
| Backend approval-control compatibility boundary | **PASS (5/5)** |
| Backend approval-control ownership/rollback boundary | **PASS (5/5)** |
| Backend stock-operation compatibility boundary | **PASS (5/5)** |
| Backend stock-operation ownership/rollback boundary | **PASS (5/5)** |
| Phase D complete route/owner/rollback inventory | **PASS (7/7)** |
| Phase E Neon Auth prerequisite boundary | **PASS (6/6)** |
| Workspace typecheck | **PASS** (Web + contracts + Backend + Mobile) |
| Repository structure and Markdown links | **PASS (7/7)** |
| ESLint | **PASS WITH 3 WARNINGS** (2 pre-existing source warnings; 1 generated Expo type warning) |
| Next.js production build | **PASS (92 routes)** |
| Android export | **PASS** |
| Device contract compatibility | **PASS (3/3)** |
| Sync-control contract compatibility | **PASS (3/3)** |
| POS data-contract compatibility | **PASS (3/3)** |
| Cart/modifier contract compatibility | **PASS (3/3)** |
| Operational read-model compatibility | **PASS (3/3)** |
| Receipt/attendance read-model compatibility | **PASS (3/3)** |
| Display/transfer read-model compatibility | **PASS (3/3)** |
| POS runtime aggregate compatibility | **PASS (3/3)** |
| POS bootstrap/business compatibility | **PASS (4/4)** |
| Checkout/sync-push compatibility | **PASS (4/4)** |
| Mobile action-contract compatibility | **PASS (4/4)** |
| Helper/design-token compatibility | **PASS (4/4)** |
| Mobile UI contract | **PASS (4/4)** |
| Device sequence and delta reconciliation | **PASS (2/2)** |
| Catalogue/cache/local-first/resnapshot behavior | **PASS (11/11)** |
| Pricing/checkout-intent/outbox/offline-cart behavior | **PASS (39/39)** |
| Device retirement custody | **PASS (4/4)** |
| Sequence replay, delta resnapshot, and shift custody | **PASS (20/20)** |
| Static catalogue | **PASS (239/240 automated commands); 1 ENVIRONMENT-BLOCKED** |
| Local Supabase/Docker source connectivity | **BLOCKED**; Docker CLI/daemon unavailable in this environment |
| Full local DB/pgTAP | **NOT_RUN**; no schema change in this slice |
| Physical Android certification | **NOT_RUN**; prior evidence status preserved |

## Safety statement

No production Auth service was provisioned. No database schema or merchant data
changed. No account was exported/imported. No session format, existing Web POS
offline-checkout or sync-push route, accepted JSON body, checkout behavior,
SQLite database, outbox record, deployment, client API origin, or provider
project changed. The D29 Backend offline-checkout and D31 Backend sync-push
boundaries are undeployed; their Web rollback routes remain intact. The D33
Backend refund boundary is also undeployed and its Web rollback route remains
intact. The D35 Backend transfer-receipt boundary is also undeployed and its Web
rollback route remains intact. D35 adds no schema, credential, provider setting,
deployment, or live client cutover. D36 adds only a shared attendance-mutation
contract, isolated compatibility oracle, and certification gate; both Web
attendance mutation routes remain authoritative and undeployed client origins
remain unchanged. The D37 Backend attendance boundary is also undeployed and
both Web rollback routes remain intact. D37 adds no schema, credential, provider
setting, deployment, or live client cutover. D38 adds only a shared sale-
exchange contract, isolated compatibility oracle, and certification gate; the
Next.js Server Action remains authoritative and no Backend exchange route,
runtime mode, schema, credential, provider setting, deployment, or live client
cutover was added. The D39 Backend sale-exchange boundary is also undeployed;
the Server Action and Web rollback route remain intact. D39 adds no schema,
credential, provider setting, deployment, or live client cutover.
The D40 receipt-administration slice adds only focused shared receipt-settings
and delivery contracts, an isolated compatibility oracle, and a certification
gate. Both Next.js Server Actions remain authoritative; no Backend receipt-
settings or delivery route, runtime mode, schema, credential, provider setting,
deployment, or live client cutover was added.
The D41 Backend receipt-administration boundary is also undeployed; both Server
Actions and Web rollback routes remain intact. D41 adds no schema, credential,
provider setting, deployment, or live client cutover. The audited post-D41
inventory retains 16 Web-owned POS v2 routes, so Phase D remains in progress.
The D42 device/sync-control slice added only shared contract vocabulary, Web
adoption, an isolated compatibility oracle, and a certification gate. The D43
Backend boundary is undeployed and all seven Web rollback routes remain intact.
D43 adds no schema, provider setting, deployment, or live client cutover; it
forwards validated device credentials only to database RPCs whose custody
checks require them. The audited post-D43 inventory retains 9 Web-owned POS v2
routes, so Phase D remains in progress.
The D44 shift-control slice added focused shared contracts, Web facades, an
isolated compatibility oracle, and a certification gate. The D45 Backend
boundary is undeployed and all four Web rollback routes remain intact. D45 adds
no schema, provider setting, deployment, or live client cutover; it forwards
device credentials only for open, close, and custody RPCs whose database checks
require them. The audited post-D45 inventory retains 5 Web-owned POS v2 routes,
so Phase D remains in progress.
The D46 approval-control slice adds only focused shared contracts, Web schema
adoption, an isolated compatibility oracle, and a certification gate. All three
Next.js approval routes remain authoritative; no Backend approval route,
runtime mode, schema, provider setting, deployment, or live client cutover was
added. The audited post-D46 inventory therefore still retains 5 Web-owned POS
v2 routes and Phase D remains in progress.
The D47 Backend approval-control boundary is undeployed and all three Next.js
rollback routes remain intact. D47 adds no schema, provider setting,
deployment, credential, or live client cutover; Supabase remains the Auth
issuer while the owned runtime sends database work only to Neon's external-JWT
Data API. The audited post-D47 inventory retains 2 Web-owned POS v2 routes, so
Phase D remains in progress.
The D48 stock-operation slice adds focused platform-neutral contracts, Web
adoption, a network/database-independent Backend oracle, ten behavior tests,
and a five-gate architecture certification. Both final stock-operation Next.js
routes remain authoritative; no Backend stock route, runtime mode, schema,
provider setting, credential, deployment, or live client cutover was added.
Database custody remains authoritative for negative-stock policy, open shift,
made-to-order components, request/destination scope, received-only inventory,
discrepancies, idempotent replay, and audit effects. The audited post-D48
inventory still retains 2 Web-owned POS v2 routes, so Phase D remains in
progress.
The D49 Backend stock-operation boundary is undeployed and both Next.js
rollback routes remain intact. D49 adds no schema, provider setting,
deployment, credential, or live client cutover; Supabase remains the Auth
issuer while the owned runtime sends database work only to Neon's external-JWT
Data API. The audited post-D49 inventory retains 0 Web-owned POS v2 routes
without Backend counterparts. Phase D remains in progress only until the D50
closure audit certifies the complete owner and rollback inventory.
The D50 closure audit adds only a machine-readable inventory and deterministic
architecture certification. All 43 supported POS v2 Web routes have exact
Backend counterparts across 29 owned-by-default boundaries, and every Web
rollback handler remains intact. No schema, deployment, Auth provider,
credential, client origin, or live cutover changed. Phase D is complete.
The E1 prerequisite assessment used only repository inspection, current official
provider documentation, and read-only Neon CLI queries. Managed Better Auth is
not configured on the linked canonical branch. No branch, Auth service, user,
session, trusted domain, secret, schema, deployment, or client origin was
created or changed. Supabase Auth remains active, and all 13 proof flows remain
`NOT_RUN` pending isolated execution.

## Next gate

Begin E2 only after explicit approval of the five decisions in the Phase E
prerequisite assessment. Then create one expiring non-production branch from a
proven synthetic-only, schema-only, or anonymized source and enable Managed
Better Auth only there. Do not integrate application runtimes, import real
users, change deployments, or cut over any client origin in E2.
