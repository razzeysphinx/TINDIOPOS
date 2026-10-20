# TINDIO architecture certification

Status: **SLICE D2 COMPLETE; TWO BACKEND-OWNED READS CERTIFIED; ENVIRONMENT BLOCKER RECORDED**

Certified scope: Phase 0, Slices B1-B2, Slice C, and Slices D1-D2 Backend-owned bootstrap/reference reads with proxy rollback

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

## Results

| Gate | Result |
|---|---|
| Architecture foundation | **PASS (3/3)** |
| POS shared-contract compatibility | **PASS (7/7)** |
| POS v1 retirement compatibility | **PASS (5/5)** |
| Backend health/read behavior | **PASS (42/42)** |
| Backend foundation boundary | **PASS (3/3)** |
| Backend bootstrap ownership/rollback boundary | **PASS (5/5)** |
| Backend reference ownership/rollback boundary | **PASS (5/5)** |
| Workspace typecheck | **PASS** (Web + contracts + Backend + Mobile) |
| Repository structure and Markdown links | **PASS (7/7)** |
| ESLint | **PASS WITH 2 PRE-EXISTING WARNINGS** |
| Next.js production build | **PASS (90 routes)** |
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
| Static catalogue | **190/191 automated commands pass** |
| Local Supabase/Docker source connectivity | **BLOCKED** — local source unavailable |
| Full local DB/pgTAP | **NOT_RUN** due to the same environment blocker |
| Physical Android certification | **NOT_RUN**; prior evidence status preserved |

The failed environment gate existed before these architecture slices. Slice D2
introduced no new certification failure.

## Safety statement

No production Auth service was provisioned. No database schema or merchant data
changed. No account was exported/imported. No session format, existing JSON wire
field, POS API route, checkout behavior, SQLite database, outbox record,
deployment, client API origin, or provider project changed. The Backend routes
exist only inside the undeployed Backend workspace; the added environment file
is an inert example containing no credential.

## Next gate

Begin Slice D3 by moving the bounded POS catalogue read behind the same Backend
boundary while preserving search/favorites/recent modes, pagination, query
validation, and the Web rollback route. Do not move financial mutations or
change deployed client origins. Neon Auth proof remains a later slice.
