# TINDIO Phase E Neon Auth prerequisites

Status: **E1 COMPLETE — PROVISIONING NOT APPROVED**

Assessment date: 2026-10-23

This assessment authorizes no provider mutation. Supabase Auth remains active,
the Neon Data API continues to verify Supabase JWTs, and no application origin,
credential, account, session, schema, or deployment changed.

## Read-only findings

| Prerequisite | Result | Evidence |
|---|---|---|
| Current provider capability | **PASS** | Managed Better Auth is available for AWS Neon projects and stores branch-local users, sessions, configuration, and JWKS in `neon_auth`. |
| CLI and account access | **PASS** | Neon CLI 4.14.3 authenticated through the existing OAuth profile on 2026-10-23. |
| Project permission and region | **PASS** | Linked project `divine-sound-41148108` reports `ADMIN` access in `aws-us-east-2`, without IP Allow or Private Networking. |
| Current branch identity | **PASS** | Linked branch `r6-clean-canonical-20261002` resolves to `br-snowy-heart-b5nf6q3n`; it is archived and remains the canonical recovery branch, not the Phase E test target. |
| Current Neon Auth service | **NOT CONFIGURED** | Read-only `neon neon-auth status` returned “Neon Auth is not configured for this branch.” Checked-in `auth: true` remains unapplied configuration intent. |
| Supabase compatibility state | **PASS / PRESERVED** | `neon.ts` still configures Data API external authentication with the Supabase JWKS; Web, Mobile, and Backend still use Supabase sessions. |

Official provider references used for this assessment:

- [Managed Better Auth overview](https://neon.com/docs/auth/about)
- [Branching authentication](https://neon.com/docs/auth/branching-authentication)
- [Supabase-to-Neon Auth migration guide](https://neon.com/docs/auth/migrate/from-supabase)
- [Auth production checklist](https://neon.com/docs/auth/production-checklist)
- [Neon branching](https://neon.com/docs/introduction/branching)

## Decisions required before provisioning

1. **Disposable branch approval.** Approve a new expiring, non-production branch
   and confirm its parent contains synthetic data only. If that cannot be
   proven, use a separately approved schema-only or anonymized source instead.
2. **Password continuity policy.** Current Neon guidance states that existing
   Supabase password hashes cannot migrate because the hashing schemes differ.
   Approve one audited path: password reset/account claim, account recreation,
   or OAuth reauthentication. No real-user export/import is part of Phase E.
3. **Synthetic identity and email policy.** Approve dedicated synthetic email
   addresses, branch-local verification/reset delivery, trusted localhost or
   preview domains, and teardown/retention rules. Shared development email is
   acceptable only for the isolated proof, never production.
4. **Mobile proof path.** Neon publishes Web/React/Next.js guidance but no
   dedicated Expo/React Native quickstart. Approve an isolated SDK spike that
   proves SecureStore persistence, refresh, bearer delivery, sign-out, and
   process restart before changing the production Mobile session provider.
5. **Rollback authority.** Keep Supabase Auth active and unchanged throughout
   the proof. Record the individual authorized to order rollback and the
   maximum observation window before any later dual-provider transition.

## Required proof

The machine-readable [Phase E Auth proof matrix](TINDIO_PHASE_E_AUTH_PROOF_MATRIX.json)
defines exactly 13 synthetic flows across Web, Backend, Mobile, Data API, RLS,
revocation, and Supabase rollback. Every flow starts `NOT_RUN`; source checks or
SDK compatibility claims cannot promote a flow to `PASS`.

## Recommended isolated target

- Create a new expiring branch only after the decisions above are recorded.
- Prefer a normal child branch when its parent is proven synthetic-only and the
  proof needs realistic provider-neutral identity/RLS fixtures.
- Otherwise use an approved schema-only/anonymized source and seed only the
  minimum synthetic organization, employee, store, register, device, and data.
- Enable Managed Better Auth only on that branch. Its unique Auth endpoint,
  trusted domains, configuration, users, sessions, and tokens must never be
  reused by production.
- Do not point existing Web or Mobile deployments at the proof branch.

## Mandatory stop

Do not create the branch, enable Neon Auth, alter `neon.ts`, pull branch secrets,
install a replacement Auth runtime, import users, or change any application
origin until the five decisions above are approved. Production provisioning,
password migration, credential rotation, cutover, and Supabase retirement each
remain separately approval-gated.
