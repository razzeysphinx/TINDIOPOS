# TINDIO Deprecations and Compatibility Register

## Intentionally retained compatibility

- Unversioned `/api/pos/*` forwarding routes remain supported aliases to v2.
  Retirement requires an explicitly closed client window and MOB-10 A43 review.
- Historical Supabase business migrations remain under `archive/database/` for
  recovery and audit integrity; they are not current installation inputs.
- Historical recovery scripts, phase contracts, and evidence remain stable even
  when later recovery phases supersede their operational result.
- Both inventory count/stocktake checks remain because they protect different
  stages and semantics.
- Store Hub remains deferred, not abandoned.
- `neon.ts` and `hello.ts` remain stable because Neon preview configuration
  references the function directly.

## Deprecated operating paths

- Installing TINDIO business migrations from `supabase/migrations/` is retired.
  Use the canonical database installer chain.
- Expo Go or browser preview is not accepted as Android certification evidence.
- Historical recovery branch workflow triggers are retired; default-branch and
  pull-request certification belong to the baseline workflow.
- The create-expo-app starter README/reset-project workflow is retired.

## Owner review required

- `apps/mobile/LICENSE` contains the Expo/650 Industries MIT license inherited
  from the starter. It is preserved unchanged as `LICENSE_REVIEW_REQUIRED`.
- Production mobile branding, EAS project linkage, signing verification,
  screenshots, support contact, and Google Play release remain blocked exactly
  as recorded in `apps/mobile/production-release.json`.
