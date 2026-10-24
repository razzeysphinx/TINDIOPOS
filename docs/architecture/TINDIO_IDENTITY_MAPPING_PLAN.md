# TINDIO identity mapping plan

Status: **PHASE F1 PARTIAL — CANONICAL INVENTORY COMPLETE; AUTH EXPORT REQUIRED**

Phase F maps provider identities to existing stable TINDIO profiles. It does not
replace profile UUIDs, employee relationships, organization membership, roles,
store assignments, device enrollment, or transaction custody.

## Read-only canonical inventory

The 2026-10-24 aggregate inventory found:

- 2 profiles and 2 Supabase identity links;
- 0 profiles without identity links;
- 0 profiles linked to multiple providers;
- 0 duplicate normalized profile emails;
- 0 Neon identity links;
- 2 active employees across 2 organizations.

The query returned counts only. No email, name, provider subject, UUID,
credential, or merchant record was copied into evidence.

## Deterministic dry-run rules

`scripts/phase-f-identity-mapping-dry-run.mjs` consumes an authorized offline
JSON inventory containing `supabaseUsers`, optional `neonUsers`, `profiles`, and
`identityLinks`. It emits only 16-character SHA-256 references and classifications.

1. An existing Supabase subject link is the authoritative stable-profile match.
2. A unique normalized email without a link is review-only, never auto-approved.
3. Duplicate emails, missing profiles, duplicate subjects, or conflicting Neon
   links are blocked.
4. A Neon subject may be proposed only when one source account and one stable
   profile match, and it still requires owner review.
5. Supabase password hashes are never read or migrated. Every account uses an
   approved account-claim or password-reset path.
6. No identity link is written by the dry-run tool.

Example command:

```powershell
pnpm phase-f:identity-dry-run -- --input C:\secure\tindio-identity-inventory.json
```

The input must remain outside Git. The report must be reviewed without adding
raw identity data to repository artifacts.

## Remaining inventory boundary

The canonical database accounts for two linked Supabase subjects, but current
credentials cannot enumerate the Supabase Auth directory. The Supabase CLI has
no management access token and the repository has no service-role credential.
Therefore F1 cannot yet prove that every Auth user has a link or that no disabled,
orphaned, duplicate, or invitation-only Auth account exists.

To complete F1, an owner must provide one of these temporary read-only paths:

- an audited Supabase Auth user export; or
- time-bounded administrative access sufficient only to list Auth users.

Do not commit the export or credential. Run the dry-run locally, retain only
aggregate counts and pseudonymous issue references, then revoke the access.

## OWNER APPROVAL REQUIRED

Approval is still required before any real-user creation/import, identity-link
write, password reset campaign, production Neon Auth enablement, client cutover,
credential rotation, or Supabase decommission. F1 remains partial until the
authorized Auth inventory is reconciled.
