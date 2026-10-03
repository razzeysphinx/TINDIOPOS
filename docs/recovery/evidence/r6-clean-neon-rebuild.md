# TINDIO Neon Recovery R6 — Clean Rebuild Evidence

Status: **COMPLETE — clean schema rebuild and portability certified**

## Scope

This evidence covers the fresh isolated Neon schema rebuild only. The locked
Recovery Source of Truth assigns business-data migration and reconciliation to
R7; no business data was extracted or imported during this R6 checkpoint.

## Git and target

- Starting recovery HEAD: `de8fd6a375407bc4cc6d2fbc83b02801357462ce`
- Recovery project: `divine-sound-41148108` (`TINDIO R6 RECOVERY 2026-10-02`)
- Recovery branch: `br-snowy-heart-b5nf6q3n` (`r6-clean-canonical-20261002`)
- Database: `tindio_r6_recovery`
- Region: `aws-us-east-2`
- Target source: fresh project root, then isolated child branch
- Target verification: explicit project, branch, database, owner role, and
  direct-host allowlist required before every R6 schema write.

## External authentication

- Approved Supabase JWKS endpoint returned HTTP 200.
- Public signing keys: two (`ES256` / `EC`, `RS256` / `RSA`).
- Neon Data API was configured only for the isolated R6 branch with external
  authentication and no default grants.

## Canonical installation

- Baseline SHA-256:
  `b3a0fd6bac3f670b251680698c315e229eff940e05fc1370f5f392b198d50a87`
- Forward chain: `0002` through `0010`, in lexical deterministic order.
- Extension prerequisite, canonical baseline, Neon role adapter, all forward
  migrations, Neon identity adapter, and Data API anonymous-role mapping:
  **PASS**.

## Remote schema evidence

| Check | Result |
| --- | ---: |
| Public tables | 100 |
| Private tables | 7 |
| Policies | 149 |
| RLS-enabled tables | 104 |
| Canonical roles | 3 |
| Provider-to-canonical mappings | 3 |
| Provider-targeted policies | 0 |
| R5 read-model functions | 9 |
| `auth.user_id()` / `auth.jwt()` | available |
| TINDIO identity helpers | available |
| Organization rows | 0 |

## Certification completed

- R3 provider-neutral SQL contract: PASS
- R4 security contract: PASS
- R5 final regression contract: PASS
- Disposable local canonical rebuild: PASS
- Root typecheck: PASS
- Mobile typecheck: PASS
- Lint: PASS with three pre-existing warnings
- Production build: PASS
- Static certification: PASS

## Safety

- Live/production schema writes: **NO**
- Live/production business-data writes: **NO**
- Historical migrations rewritten: **NO**
- Canonical pushed migrations rewritten: **NO**
- Cutover: **NO**
- R7 started: **NO**

## Phase boundary

R6 is complete because the locked Recovery Source of Truth defines its exit as
a reproducible fresh clean Neon schema. R7 is the next, not-started phase for
authoritative business-data migration and reconciliation.
