# TINDIO Phase E5 isolated Neon Backend adapter

Status: **E5 COMPLETE — BACKEND AND DATA API FLOWS PASSED**

Completed: 2026-10-24

E5 adds Neon JWT verification to the existing provider-neutral Backend Auth
boundary and proves one authenticated-only Data API identity read. Supabase
remains the default for every existing Backend route. No deployed client, API
origin, environment file, canonical Neon context, merchant row, or real
identity changed.

## Local-only boundary

Neon selection is allowed only when all of these conditions hold:

- `TINDIO_AUTH_PROVIDER=neon`;
- `TINDIO_AUTH_PROOF_MODE=local`;
- the runtime is non-production and has no Vercel deployment marker;
- `NEON_AUTH_BASE_URL` is a credential-free HTTPS Managed Neon Auth URL ending
  in `/auth`; and
- `NEON_AUTH_JWKS_URL` is the exact same-origin
  `/.well-known/jwks.json` endpoint below that Auth base URL.

The proof route returns 404 when that boundary is absent. Existing POS routes
still construct their verifier from the default Supabase environment and are
unchanged.

## JWT and response boundary

The Backend uses `jose` to obtain the remote JWKS and accepts only EdDSA JWTs
from the Managed Neon Auth origin. A token must contain a non-empty `sub` and
the `authenticated` role. Its subject, email, role, session identifier, and
expiry are normalized into the existing provider-neutral claims contract.

The local `GET /api/auth-proof/claims` handler rejects missing and invalid
bearers, sends `Cache-Control: no-store`, and returns only normalized identity
fields. It never returns the JWT, opaque session token, cookie, or raw claims.

## Direct runtime evidence

The harness created a unique `.invalid` account in the disposable E2 branch,
obtained its real JWT, and called the built Backend route. The route denied a
missing bearer and a tampered signature, then accepted the valid JWT and
matched the normalized subject and email to the Auth user.

The same tampered JWT was denied by the Neon Data API. The valid JWT could call
`public.current_profile_id()`, which is granted to TINDIO's authenticated Data
API role rather than the anonymous role. It returned `null`, proving that the
synthetic Auth subject crossed the authenticated role/RLS boundary but had no
merchant profile mapping. The proof performed no merchant write and signed out
the passing session.

The matrix now records `PASS` for `E-AUTH-05` and `E-AUTH-11`. Together with
E4, 5 of 13 flows pass and eight remain `NOT_RUN`.

## Rollback and limitations

Removing the proof-only environment values makes Neon selection fail closed;
Supabase continues as the default without a data or account rollback. E5 does
not import accounts, establish canonical profile links, prove token expiry or
revocation at the database boundary, change Mobile, or authorize production
cutover.

## Next slice

E6 should complete the remaining isolated Web lifecycle evidence: email
verification (`E-AUTH-02`), forced session refresh (`E-AUTH-04`), and password
reset/recovery confirmation (`E-AUTH-07`). It must keep all redirect targets
branch-local or localhost and promote only directly observed flows.
