# TINDIO Backend

This workspace is the independent TINDIO HTTP backend boundary. It uses the Web
`Request`/`Response` API and the default Node.js runtime.

## Commands

- `pnpm backend:typecheck`
- `pnpm backend:build`
- `pnpm backend:test`

## Routes

- `GET /api/health` returns a stable, non-cacheable service response.
- `GET /api/pos/v2/bootstrap` is a read-only compatibility proxy to the existing
  authoritative Next.js bootstrap route. It requires `TINDIO_WEB_API_ORIGIN` to
  contain only the Web deployment origin.

The bootstrap proxy forwards only `Accept`, `Authorization`, and
`x-tindio-organization-id`. It preserves the upstream status, body,
`Cache-Control`, `Content-Type`, `Retry-After`, and `x-tindio-request-id` while
dropping cookies and unrelated headers.

No mutation, authentication provider, database driver, deployment, or client
API origin has moved here. Clients continue using the existing Next.js route
until a separate deployment and cutover is approved.
