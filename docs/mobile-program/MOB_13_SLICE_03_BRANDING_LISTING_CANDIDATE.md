# MOB-13 Slice 03 — TINDIO branding and Play listing candidate

## Phase and ticket

```text
Mobile Phases 06, 23, and 24
MOB-13 Slice 03
Candidate Android branding and truthful Google Play listing package
```

## Starting commit

```text
3fd340315122dd95085c0dff9c3ef0c8509a85fe
```

## Observed defect

The Android application still referenced the default Expo app icon, adaptive
icon artwork, splash mark, and favicon. Those assets could not truthfully be
treated as TINDIO branding. The release inventory also had no feature graphic
or listing copy.

## Architecture decision

Replace only the configured presentation assets, without changing application
navigation, business logic, authentication, local persistence, or transaction
custody. Retain the new TINDIO artwork as an explicitly unapproved candidate:
development and preview exports may render it, but the production build gate
continues to reject the release until a human approves the brand.

Prepare accurate listing copy and an exact-size feature-graphic candidate.
Do not generate fake app screenshots; screenshots must come from the actual
release candidate on supported Android devices. Do not invent a support email.

## Gap matrix

| Classification | Decision |
| --- | --- |
| KEEP | Expo SDK 57, application identity, package ID, splash plugin, adaptive-icon configuration, release-input gate, and Phase 24 release ladder |
| KEEP + HARDEN | Release tests validate configured asset paths, PNG dimensions, honest hardware/payment wording, and missing screenshot/support inputs |
| EXTEND | Add an original TINDIO receipt/check candidate mark, launcher icon, feature graphic, and listing copy |
| REFACTOR | Production branding inventory now records asset paths plus an explicit review status |
| REPLACE | Configured Expo template icon, adaptive foreground/background, splash artwork, and favicon references |
| REMOVE | Expo template background and monochrome adaptive-icon references from the application config |
| NEW | Exact-size exports, retained image-generation masters, listing draft, behavioral checks, and this evidence report |

## Candidate visual system

```text
Primary teal: #007A67
Dark ink: #14231F
Warm cream: #F4EFE5
Mark: receipt + durable confirmation/check gesture
```

The visual candidates were produced with the built-in image-generation tool.
The master prompt requested an original, minimal, vector-friendly TINDIO POS
mark combining a T silhouette, receipt, and confirmation gesture, with no text,
Expo logo, commerce cliché, watermark, or device mockup. A second prompt placed
that mark on a warm-cream launcher-icon field. A third prompt created a wide,
claim-free feature graphic about durable receipt synchronization. Exact-size
exports were derived without overwriting the generated masters.

## Changed files

- Expo app icon, adaptive foreground, splash, iOS icon, and favicon references;
- TINDIO candidate master and exact-size branding PNGs;
- Google Play feature-graphic master and exact 1024 × 500 export;
- production release manifest branding/listing inventory;
- release-input validator and behavioral tests;
- Phase 24 release-evidence schema test;
- non-secret Google Play listing draft;
- this evidence report.

## Database, SQLite, and API compatibility

```text
Neon migration: NONE
SQLite migration/reset: NONE
POS v2 API change: NONE
Supabase Auth change: NONE
Expo route change: NONE
EAS/Play external mutation: NONE
```

## Security and transaction-custody impact

- No merchant data, credential, signing key, service-account key, or production
  endpoint is stored in an image or listing file.
- No outbox event, checkout intent, recovery record, receipt snapshot, device
  sequence, sync cursor, or local credential is changed or deleted.
- Listing copy explicitly preserves the restrictions on offline electronic/card
  payments and unsupported v1 peripherals.
- Screenshots remain absent instead of being fabricated from mock UI.

## Current result

```text
Configured app icon: TINDIO CANDIDATE
Configured adaptive foreground: TINDIO CANDIDATE
Configured splash mark: TINDIO CANDIDATE
Feature graphic: CANDIDATE, 1024 × 500
Listing copy: CANDIDATE
Brand approval: REQUIRED
Phone screenshots from release candidate: NOT PROVIDED
Monitored support email: NOT PROVIDED
Production release manifest: BLOCKED
A48 production-signed release candidate: NOT_RUN
```

## Tests and exact results

```text
pnpm test:mobile-mob-13-release-inputs
PASS — 7 tests, 0 failures

pnpm test:phase-23-android-hardening
PASS — 6 tests, 0 failures

pnpm test:phase-24-google-play
PASS — 7 tests, 0 failures

pnpm test:mobile-mob-13-cashier-home
PASS — 3 tests, 0 failures

pnpm test:phase-06-native-shells
PASS — 1 test, 0 failures

pnpm test:phase-13-native-cashier-parity
PASS — 1 test, 0 failures

pnpm --dir apps/mobile exec expo config --type public
PASS — candidate icon, adaptive foreground, splash and favicon resolve

pnpm mobile:typecheck
PASS

pnpm typecheck
PASS

pnpm --dir apps/mobile lint
PASS — 0 errors, 1 pre-existing warning

pnpm lint
PASS — 0 errors, 3 pre-existing warnings

pnpm mobile:export:android
PASS — Android bundle exported, 1,452 modules

node scripts/phase-24-production-release-gate.mjs
EXPECTED BLOCK — MOB-13 inputs, A46/A47, AAB, testing, pilot, and real-store
evidence remain incomplete

pnpm certify:static
PARTIAL — 159 of 161 automated package commands passed. The two failures are
the pre-existing Phase 14 recovery-document wording assertion and unavailable
local Supabase database runtime; neither is caused by this slice.

git diff --check
PASS
```

## Certification status

MOB-13 Slice 03 implementation: **COMPLETE** after final validation.

MOB-13 overall: **OPEN**. Image generation and source/export checks do not
constitute brand approval, physical launcher/splash validation, truthful
release-candidate screenshots, Play Console setup, or production certification.

A46 and A47 retain their recorded status. A48 remains `NOT_RUN`; no production
AAB or Play submission was started.

## Next smallest safe slice

Review the candidate mark/palette on a physical Android phone and tablet,
approve or replace it, then capture truthful phone/tablet screenshots from the
actual release candidate. Record the monitored support email and A47 inputs
only after their real owners approve them. Keep the release manifest blocked
until those reviews and the remaining EAS/signing/origin inputs are complete.
