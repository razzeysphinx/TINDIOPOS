# TINDIO R9 Isolated Neon Fresh-Install Evidence

Status: **PASS**

The permanent canonical installer completed against the isolated project
`morning-silence-91604301`, branch `br-summer-mountain-b59fxsgq`, database
`tindio_r9_certification`. The branch TTL was removed because Neon Data API does
not support expiring branches. The branch remains non-primary, non-default, and
non-protected; its manual cleanup is separately gated.

The approved Supabase JWKS host returned two asymmetric signing keys. Neon Data
API is active with external Supabase authentication, only `public` exposed,
OpenAPI disabled, and no provider default grants. `auth.user_id()` and
`auth.jwt()` are C-language functions backed by `$libdir/pg_session_jwt` and
remained present after the complete canonical installation.

The canonical baseline hash was
`b3a0fd6bac3f670b251680698c315e229eff940e05fc1370f5f392b198d50a87`.
Migrations `0002` through `0011`, the Neon role adapter, and the Neon identity
adapter completed in deterministic order. Post-install evidence recorded 100
public tables, 7 private tables, 149 policies, 104 RLS-enabled tables, three
provider-to-canonical role mappings, zero unvalidated foreign keys, zero
organization rows, and 65 canonical permission-reference rows.

A dedicated existing Supabase certification identity produced a valid JWT that
the isolated Data API accepted with HTTP 200. The provider-neutral identity RPC
was callable with HTTP 200 and returned null, as expected in the deliberately
empty business-data database. Missing and invalid-signature bearer requests
were denied with HTTP 400 and explicit authentication errors. The packet named
HTTP 401, but the current Neon Data API platform contract emits 400 for these
authentication parsing/signature failures; no access was granted and the gate
is recorded as a secure platform-status variance rather than weakened.

Production Neon, retained old-source Neon, Vercel production, deployments, and
Git remotes were not changed. No production data was copied. The disposable
branch and project were not deleted.
