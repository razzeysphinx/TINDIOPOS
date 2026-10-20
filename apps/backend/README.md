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

The default `TINDIO_BOOTSTRAP_READ_MODE=owned` path requires `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`, and `NEON_DATA_API_URL`. Supabase Auth remains the
current identity issuer; database traffic is rewritten only to Neon and the
Supabase publishable key is removed at that provider boundary.

Set `TINDIO_BOOTSTRAP_READ_MODE=proxy` with `TINDIO_WEB_API_ORIGIN` only for
rollback. The proxy forwards only `Accept`, `Authorization`, and
`x-tindio-organization-id`. It preserves the upstream status, body,
`Cache-Control`, `Content-Type`, `Retry-After`, and `x-tindio-request-id` while
dropping cookies and unrelated headers.

No mutation route, authentication provider, deployment, or client API origin
has moved. Clients continue using the existing Next.js route until a separate
deployment and cutover is approved.
