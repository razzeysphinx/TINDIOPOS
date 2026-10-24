# Phase E6 Neon Web lifecycle proof

Status: **PASS — 3 FLOWS PROMOTED; PHASE E 8/13 PASS**

Slice E6 extends the local-only `/auth-proof` surface with explicit email-code
request and verification, password-recovery request and completion, and a
token-free session DTO. The proof remains unavailable unless the local,
non-production, non-Vercel Neon guard passes and accepts only the reserved
`@auth-proof.tindio.invalid` domain.

The session Route Handler uses the official SDK's framework-neutral Auth proxy
path so the HTTP-only `session_data` cache can be minted and refreshed from the
preserved HTTP-only `session_token`. The proof TTL is bounded to 1–60 seconds;
E6 selects 30 seconds transiently while E4 retains its one-second default.

The live Chromium proof directly established:

- `E-AUTH-02`: unverified signup, explicit branch-local OTP creation, OTP
  acceptance, verified identity state, and a localhost-only recovery origin;
- `E-AUTH-04`: two HTTP-only session cookies, deliberate removal of only the
  cache cookie, preservation of the primary token, cache remint, and session
  continuity;
- `E-AUTH-07`: recovery request, branch-local single-use token observation,
  password reset, old-password denial, and new-password acceptance.

The harness restores the branch's original email/password configuration in a
`finally` block. Supabase remains the default provider; no deployment, checked-in
environment, client origin, real identity, or merchant row changed.

During diagnosis, an ignored local environment file was found to reference the
canonical Auth endpoint. Four reserved E6 synthetic identities had been created
there. A read-only audit proved they had zero provider-neutral identity mappings;
the four exact synthetic identities were removed and the post-cleanup count was
zero.

Evidence is recorded in
`TINDIO_PHASE_E6_NEON_WEB_LIFECYCLE_PROOF.json`. The next smallest safe slice is
E7: Mobile flows `E-AUTH-08`, `E-AUTH-09`, and `E-AUTH-10`.
