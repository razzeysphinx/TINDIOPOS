# TINDIO Phase E4 isolated Neon Web adapter

Status: **E4 COMPLETE — THREE WEB FLOWS PASSED**

Completed: 2026-10-24

E4 adds the first Neon Auth application adapter behind an explicit local-only
proof boundary. Supabase remains the default for Web, Backend, and Mobile. No
deployed origin, environment, canonical Neon context, merchant row, or real
identity changed.

## Local-only boundary

Neon selection is allowed only when all of these conditions hold:

- `TINDIO_AUTH_PROVIDER=neon`;
- `TINDIO_AUTH_PROOF_MODE=local`;
- the runtime is non-production and has no Vercel deployment marker;
- `NEON_AUTH_BASE_URL` is a credential-free HTTPS Managed Neon Auth URL; and
- `NEON_AUTH_COOKIE_SECRET` contains at least 32 characters.

The proof UI at `/auth-proof` returns 404 when that boundary is absent. Signup
also rejects any address outside `@auth-proof.tindio.invalid`. No Neon endpoint
or secret is committed; the harness receives both transiently.

## Web adapter and UI

The pinned `@neondatabase/auth` SDK provides server-side signup, password
sign-in, session lookup, explicit session revocation, and sign-out. Session
lookup runs through a local-only Route Handler because the installed Next.js
version allows cookie mutation in Route Handlers and Server Actions, not Server
Components. The browser receives only an `id`, `email`, and `name` DTO—never an
access token, opaque session token, or cookie secret.

The proof UI is intentionally separate from TINDIO's production login and
signup surfaces. Existing Supabase actions, cookies, proxy refresh, and
provider defaults are unchanged.

## Direct runtime evidence

The browser harness created a unique synthetic account, observed an HTTP-only
cookie, verified the session after navigation, denied an invalid password,
accepted the valid password, signed out, replayed the captured pre-sign-out
cookie, and confirmed that the revoked session stayed denied.

The matrix now records `PASS` only for:

- `E-AUTH-01` synthetic email/password signup;
- `E-AUTH-03` password sign-in and invalid-password denial; and
- `E-AUTH-06` sign-out and revoked-cookie replay denial.

Although cookie persistence was observed, refresh was not forced. Therefore
`E-AUTH-04` remains `NOT_RUN`. The remaining nine unexecuted flows also remain
`NOT_RUN`.

## Next slice

E5 should add the isolated server claim-verification and protected-route proof
needed for `E-AUTH-05`, then exercise a valid Neon JWT against the Data API/RLS
boundary for `E-AUTH-11`. It must not promote either flow without direct
runtime evidence.
