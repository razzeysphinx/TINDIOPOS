# TINDIO production cutover checklist

Status: **NOT READY — OWNER APPROVAL REQUIRED AT CUTOVER**

## Before any production Auth change

- [x] Canonical repository/branch/HEAD verified.
- [x] Canonical Neon project and branch verified read-only.
- [x] Current Supabase Auth/Web/Mobile dependency inventory recorded.
- [x] Phase E provider capability, account/region access, linked-branch status,
      and 13-flow synthetic proof requirements assessed read-only.
- [x] Disposable Neon branch and synthetic Auth environment approved and
      provisioned; application proof remains `NOT_RUN`.
- [ ] Password reset/account-claim or OAuth reauthentication policy approved;
      existing Supabase password hashes are not treated as portable.
- [ ] Expo/React Native session persistence and refresh proof path approved.
- [ ] Current Neon Auth Web, server, Mobile, Data API, RLS, rate-limit, email,
      reset, verification, revocation, and account-import behavior proven.
- [ ] Identity mapping and collision policy reviewed.
- [ ] Password continuity or secure reset/claim process approved.
- [ ] Rollback window, backup, monitoring, and support runbook approved.

## Application readiness

- [ ] Backend independently deployable with health/readiness and observability.
- [ ] Supported Web and Mobile versions consume compatible versioned contracts.
- [ ] Web signup, login, logout, reset, verification, invitation, cookie, tenant,
      onboarding, deletion, and sensitive reauthentication tests pass.
- [ ] Mobile fresh install and in-place upgrade tests pass without clearing data.
- [ ] Existing device enrollment, SQLite, receipt snapshots, offline grants,
      pending outbox, stable operation IDs, and sequence checkpoints survive.
- [ ] Old supported clients have an explicit compatibility or forced-upgrade path.

## Security and financial gates

- [ ] Invalid, expired, revoked, malformed, and forged identities are denied.
- [ ] Cross-organization/store access and forged context headers are denied.
- [ ] Neon Auth claim subject/email/audience/issuer/signature/rotation semantics
      match the provider adapter and RLS tests.
- [ ] One checkout/retry produces one sale/payment/receipt/stock effect.
- [ ] Refund, shift custody, conflict, lost-response, and reconciliation tests pass.
- [ ] Privileged database/Auth credentials are absent from browser/mobile bundles.

## Cutover and retirement

- [ ] Explicit owner approval recorded for production provisioning/import.
- [ ] Cutover maintenance/freeze procedure rehearsed.
- [ ] Account import or claim process produces a complete auditable mapping.
- [ ] Production traffic and error monitoring show no unresolved dependency.
- [ ] Rollback remains viable through the agreed observation window.
- [ ] Active Supabase SDK/env/webhook/redirect/job dependencies are removed only
      after all supported clients no longer require them.
- [ ] Required historical evidence is archived and backups verified.
- [ ] Separate explicit owner approval recorded before Supabase project shutdown.

Never use a local typecheck, source scan, or synthetic proof alone as production
cutover evidence.
