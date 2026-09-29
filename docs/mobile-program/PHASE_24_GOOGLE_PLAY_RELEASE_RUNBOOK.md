# Phase 24 — Google Play Testing + Release Runbook

## Release ladder

```text
development device
↓
internal testing
↓
closed testing
↓
pilot merchants
↓
production
```

No stage may be skipped.

## Package

```text
com.tindio.pos
```

## Build

Production artifact:

```text
Android App Bundle (.aab)
```

## Signing

Use EAS remote Android credentials.

Never commit:

- keystore
- key password
- Google service-account JSON
- Play credentials

## Google Play setup

Before first Play upload, the external Play Console must have:

- developer account
- app created for `com.tindio.pos`
- required app setup completed
- store listing
- app access declaration where applicable
- content rating
- target audience/content declarations
- Data safety form
- privacy-policy information where required
- tester groups
- Google service account configured for EAS Submit if automated submission is used

These are external platform/account tasks and are not fabricated by repository code.

## Internal track

Build:

```bash
cd apps/mobile
pnpm dlx eas-cli@latest build \
  --platform android \
  --profile production
```

After a successful signed build:

```bash
pnpm dlx eas-cli@latest submit \
  --platform android \
  --profile internal
```

Return to repo root afterward.

Internal testing is not production.

## Closed track

Only after internal PASS:

```bash
cd apps/mobile
pnpm dlx eas-cli@latest submit \
  --platform android \
  --profile closed
```

The repository uses the Play `alpha` track for controlled closed testing.

## Pilot merchants

Pilot remains controlled.

Use the closed track and a dedicated pilot tester cohort/group in Google Play Console.

The `pilot` EAS submission profile also targets the controlled closed track.

Do not use the public production track for pilot validation.

## Production

The repository production submit profile is configured as:

```text
track = production
releaseStatus = draft
```

This prevents the repository command from directly performing an uncontrolled global release.

Before production:

```bash
node scripts/phase-24-production-release-gate.mjs
```

must PASS.

After pilot approval, production still requires deliberate human review in Google Play Console.

## Account-specific testing requirements

Google Play account eligibility rules can differ.

If Play Console requires a minimum closed-test period/tester count for the developer account, that external requirement must also be satisfied before production.

Do not bypass Play Console requirements.

## Rollback

Do not solve a bad release by publishing an older binary that cannot understand the installed SQLite schema.

Use:

```text
halt/stage release where available
fix forward
new compatible version
```

Preserve unresolved transaction data.

## Emergency stop conditions

Stop rollout immediately for:

- duplicate charges
- duplicate stock movement
- silent transaction loss
- cross-tenant data leakage
- unrecoverable outbox
- destructive upgrade
- widespread crash loop
