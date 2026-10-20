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

The default `TINDIO_BOOTSTRAP_READ_MODE=owned`,
`TINDIO_REFERENCE_READ_MODE=owned`, and `TINDIO_CATALOG_READ_MODE=owned` paths
require `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `NEON_DATA_API_URL`.
Supabase Auth remains the current identity issuer; database traffic is
rewritten only to Neon and the Supabase publishable key is removed at that
provider boundary.

Set the route's read mode to `proxy` with `TINDIO_WEB_API_ORIGIN` only for
rollback. All proxies forward only `Accept`, `Authorization`, and
`x-tindio-organization-id`. It preserves the upstream status, body,
`Cache-Control`, `Content-Type`, `Retry-After`, and `x-tindio-request-id`; the
reference proxy also preserves `ETag` and `x-tindio-reference-version`. The
catalogue proxy preserves the complete validated query string. Cookies and
unrelated headers are dropped.

No mutation route, authentication provider, deployment, or client API origin
has moved. Clients continue using the existing Next.js route until a separate
deployment and cutover is approved.
