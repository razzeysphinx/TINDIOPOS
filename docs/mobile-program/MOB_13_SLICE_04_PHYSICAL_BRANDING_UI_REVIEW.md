# MOB-13 Slice 04 — physical Android branding and recovery UI review

Status: **IMPLEMENTATION PASS; PLAY LISTING SCREENSHOTS STILL OPEN**

## Phase and ticket

- Phase: Mobile Phase 24 release preparation
- Ticket: MOB-13
- Slice: 04 — physical Android branding/UI review
- Starting commit: `fa106af4c44f165186dded41ba783173d916e5fe`
- Device: Xiaomi `21121210G`, Android 14 / API 34, serial `82eaaf10`

## Observed defect

The candidate icon and launch mark were present, but the real device exposed two gaps that source-only review did not show:

1. the business-context failure route rendered as raw, minimally spaced text with no clear recovery hierarchy; and
2. the splash configuration did not explicitly define the dark-mode resource pair.

The first issue was reproduced in `before-update.png`. It is a cashier-facing usability defect because the failure state is a normal recovery path and must remain readable without implying that saved transactions were lost.

## Architecture decision

`KEEP + HARDEN`.

- Keep the existing Expo Router screen, business-context provider, retry operation, offline readiness policy, and custody rules.
- Add presentation-only loading and recovery styles to the existing cashier home route.
- Keep the Expo splash config plugin and provide its supported dark-mode image/background pair in `app.json`.
- Do not create a second recovery flow, alter authentication, change APIs, or touch SQLite.

## Changed files

- `apps/mobile/app/(app)/index.tsx`
- `apps/mobile/app.json`
- `scripts/mobile-mob-13-cashier-home.test.mjs`
- `scripts/mobile-mob-13-release-inputs.test.mjs`
- `docs/mobile-program/MOB_13_SLICE_04_PHYSICAL_BRANDING_UI_REVIEW.md`
- `docs/mobile-program/evidence/mob-13-slice-04/*`

## Database, SQLite, and API compatibility

- Neon/PostgreSQL: unchanged.
- SQLite schema and data: unchanged.
- POS v2 API: unchanged.
- Supabase Auth and provider-neutral identity: unchanged.
- EAS project identity and production credentials: unchanged.
- The APK is a local ARM64 certification artifact signed with the generated debug certificate; it is not A48 or production-AAB evidence.

## Security and transaction-custody impact

- No uninstall, clear-data, database reset, logout, enrollment reset, cache deletion, or transaction mutation occurred.
- Android `firstInstallTime` remained `2026-10-09 22:13:25` after every in-place `adb install -r` update.
- The pre-update installed APK was preserved outside the repository with SHA-256 `07FFDEE4E93A0CB1F848877C74E828A7AAA0A1CF6D917BD5FB5A0C75614281DC`.
- The final test APK SHA-256 is `B5B349B77788CC5640680E27F9A59475852F6A8A6940D93FB3FF82E9D8F1A59C`.
- Installed and candidate signer SHA-256: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.
- The recovery copy explicitly says that saved transactions remain on the device; it does not offer a reset or destructive workaround.

## Physical Android evidence

| Evidence | Result | SHA-256 |
|---|---|---|
| `before-update.png` | Reproduces the raw recovery-state layout | `4A8973DAF2AA1E99FCD71FC2373F9CB834D4B5D67F9027F1B9BE3A71B5FC26C4` |
| `physical-app-details.png` | Android identifies the installed app as TINDIO POS 1.0.0 and renders the candidate adaptive icon | `60702F2066958A9BD151D1E1BAD44C85377945433ED6309E35263584EE4EEDBF` |
| `physical-splash.png` | Native Android launch transition renders the TINDIO mark | `7D3EA83422423D6F230936E401D4007F759EC9894FBB1563F3B0D7518F15009A` |
| `physical-context-recovery.png` | Corrected safe-area recovery card, readiness badge, custody guidance, and touch-sized retry action render on the device | `85D12BD35E70BBDC67718CF3CB9BB81ABAC225B169CB42399C5E829E24C538E7` |

The generated `values-night/colors.xml` now explicitly sets `splashscreen_background` to `#F4EFE5`. On this Xiaomi/MIUI device the Android launch transition still applies a dark system animation around the mark; that platform transition is recorded rather than hidden.

## Tests and exact results

- MOB-13 cashier home: 4/4 passed.
- MOB-13 release inputs: 7/7 passed.
- Mobile typecheck: passed.
- Root typecheck: passed.
- Lint: passed with 0 errors and 3 pre-existing warnings.
- Android JavaScript export: passed; 1 Android bundle and 27 assets emitted.
- Native ARM64 `assembleRelease`: passed.
- APK signature: v2 verified; signer matches installed app.
- APK 16 KB ZIP alignment: passed.
- Static certification: 159/161 automated package commands passed. The two failures are the existing local-infrastructure gates `test:phase-14-final-recovery` and `test:phase-04-docker-source-connectivity`, both because the local Supabase source is unavailable.
- `git diff --check`: passed before this evidence file was added and must be repeated before commit.

## Remaining limitations

- The retained authenticated installation could not obtain a current business context even after the local Next API was reachable through `adb reverse`; it remained in `PREPARATION REQUIRED`. No credentials were reset and no synthetic transaction was changed merely to obtain screenshots.
- Consequently, signed-in cashier home, checkout, receipt, and sync-review images are not accepted as Google Play listing screenshots in this slice.
- The candidate artwork still requires product-owner approval.
- Support email, final truthful Play screenshots, final release manifest approval, production signing, Play delivery, A48, and merchant-pilot evidence remain open.
- TINDIO POS is not production certified.

## Next smallest safe slice

MOB-13 Slice 05: close the release-readiness handoff without building the production AAB. Obtain product approval for the candidate brand, a support email, and truthful screenshots from a currently authorized synthetic cashier context; update the release-input manifest only for inputs that are actually approved. Keep the production gate blocked until every mandatory input exists.
