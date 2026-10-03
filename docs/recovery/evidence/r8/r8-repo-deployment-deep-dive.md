# R8 repository and deployment deep-dive

Generated during R8 preparation from the pushed R7 checkpoint
`4a169ae1aef2e09edf59b87f36090a8c6fde0307`. No database, deployment, or
environment configuration was changed for this inspection.

## Runtime boundary

- `src/lib/database/env.ts` supports `supabase` and `neon`; Neon requires the
  server-only `NEON_DATA_API_URL`.
- `src/lib/supabase/server.ts` keeps Supabase SSR/session handling while
  rewriting only Supabase `/rest/v1` database traffic to the configured Neon
  Data API. The Supabase publishable key is removed at that boundary.
- `src/lib/supabase/client.ts` remains a Supabase browser Auth client. Supabase
  Auth is therefore not a cutover target.
- The local runtime configuration is Neon mode and fingerprints the old source
  Data API as `ep-steep-bonus-ay5df74y.apirest.c-5.us-east-2.aws.neon.tech`.
  This local file is evidence of the development runtime only, not proof of a
  production environment value.

## Mutation and maintenance coverage

- Web business mutations are Server Functions or Next route handlers. Next
  Proxy runs before their route execution under the existing global matcher.
- Mobile uses Supabase directly only for Auth/session operations. Its business
  reads and mutations use `/api/pos/v2/*` through `tindio-api.ts`.
- Durable offline-sale sync treats HTTP 5xx as retryable and retains the outbox
  event. A maintenance HTTP 503 therefore does not discard a queued sale.
- R8 adds `TINDIO_CUTOVER_MODE=freeze`, a server-only bypass header, browser
  redirect to `/maintenance`, and machine-readable API HTTP 503 with
  `Retry-After` and `Cache-Control: no-store`. The gate defaults to `normal`.

## Deployment inspection

- Vercel project: `tindiopos` (`prj_tpvljbdT1DWpAZP6Gh8SiZbASMcM`), owned by
  `RAZZEYSPHINX`, Next.js, Node.js 24.x, region `iad1`.
- Latest inspected production deployment was
  `tindiopos-4d8ra0tyx-razzeysphinx.vercel.app`, from branch
  `TINDIO-PREPRODUCTION` at SHA
  `479362660c58ee9d32a2ad05a99247e24abddd10`.
- The recovery branch preview alias exists separately. No recovery-branch
  deployment was promoted or changed by this inspection.
- Production has the expected five configuration names: database provider,
  Neon Data API URL, application URL, Supabase URL, and Supabase publishable
  key. No values were displayed or changed.
- The Vercel CLI can identify and inspect deployments and supports deployment
  rollback by redeploying/promoting a previously inspected deployment. Exact
  production environment values are encrypted and require explicit approval
  for a temporary secret-safe extraction before they can be independently
  fingerprinted.

## Source and target identity

- Source remains `noisy-violet-27747237` /
  `tindio-preproduction-phase-04` / `neondb`.
- Certified target remains `divine-sound-41148108` /
  `r6-clean-canonical-20261002` / `tindio_r6_recovery`.
- The target direct endpoint is
  `ep-wandering-voice-b5w9m9db.c-7.us-east-2.aws.neon.tech`; the expected
  Data API host is the corresponding
  `ep-wandering-voice-b5w9m9db.apirest.c-7.us-east-2.aws.neon.tech`.
- Both Neon branches were inspected read-only and remain present. The old
  source has not been deleted.

## R8 tooling decision

R8 reuses the proven R7 census, dependency planning, migration,
post-import normalization, reconciliation, and runtime certification scripts
through phase/evidence/guard parameters. The obsolete Phase-04 cutover
migrator is not selected. The R8 target reset enumerates every classified
`public`/`private` target table and uses `TRUNCATE ... RESTART IDENTITY`
without `CASCADE`; it is unavailable unless all three R8 authorization guards
are explicitly set.

## Remaining external gate

No production environment value, deployment, source freeze, or endpoint switch
has been changed. The target-only final-sync rehearsal and target-configured
preview checks are complete. Only an explicit production cutover authorization
can permit a production environment change, deployment, source freeze, or
endpoint switch.

## Production environment fingerprint (read-only)

- The repository-linked Vercel production environment was fingerprinted with
  `vercel env run -e production` from an isolated linked working directory, so
  repository-local environment files could not override the inspected values.
- `TINDIO_DATABASE_PROVIDER` is `neon`.
- The sanitized Data API identity is
  `ep-steep-bonus-ay5df74y.apirest.c-5.us-east-2.aws.neon.tech` at
  `/neondb/rest/v1`, with value SHA-256
  `05a17431cd556414d1c84786718a9c2072dc5226ff53c9ca0801cbb949c82606`.
- That endpoint maps to the R7 authoritative old source, not the certified
  R7 target. The target remains non-production.
- No raw environment value was written, and no Vercel environment,
  deployment, or database state changed.

## Target preview and isolated rehearsal

- Normal target preview: deployment `dpl_HCpUiGFLcuVP5TBpwSdeE1F3iv8o` at
  `tindiopos-6khz4swc5-razzeysphinx.vercel.app`; Vercel reported `Ready` as a
  preview deployment with the R8 checkpoint traceability marker.
- Its Data API was the approved target
  `ep-wandering-voice-b5w9m9db.apirest.c-7.us-east-2.aws.neon.tech` at
  `/tindio_r6_recovery/rest/v1`. API V2, direct target Data API, browser
  fallback, and protection-bypass checks passed without business mutations.
- Verified freeze preview: deployment `dpl_CoAL3Ug8UJR8sJfWNHDis1a2fdr7` at
  `tindiopos-ha058lmri-razzeysphinx.vercel.app`. Normal API traffic received
  cache-safe retryable HTTP 503; browser routes redirected to maintenance;
  static maintenance assets remained available; an in-memory, server-only
  bypass reached ordinary endpoint authentication.
- Two earlier non-production freeze previews were not used as evidence after
  their automation-bypass setup was inconclusive. They made no production
  change and were retained only as transparent non-certifying attempts.
- The isolated target final-sync rehearsal selected, attempted, and inserted
  561 rows with zero skipped and zero failed; source writes and production
  writes were zero. Row-count, ID, content, relationship, sequence, security,
  runtime, and domain checks all passed.
