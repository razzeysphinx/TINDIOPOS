# TINDIO Backend

This workspace is the independent TINDIO HTTP backend boundary. Its first
slice contains only a stateless health function built on the Web
`Request`/`Response` API and the default Node.js runtime.

## Commands

- `pnpm backend:typecheck`
- `pnpm backend:build`
- `pnpm backend:test`

## Current scope

- `GET /api/health` returns a stable, non-cacheable service response.
- No POS endpoint, mutation, authentication provider, database driver, secret,
  deployment, or client API origin has moved here yet.
- The existing Next.js POS routes remain authoritative until a later slice
  proves a read-only endpoint through a dual-route compatibility adapter.
