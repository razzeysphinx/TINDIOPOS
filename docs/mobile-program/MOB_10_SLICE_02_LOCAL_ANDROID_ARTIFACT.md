# MOB-10 Slice 2 — Local Android qualification artifact

Status: **BUILD PASS; PHYSICAL EXECUTION BLOCKED**

This slice produced an installable ARM64 APK from exact source commit `80b2aeb53dd6ef1f2233d7c2d9d789985ebd349d`. It does not certify runtime behavior or production release readiness. No Android device was attached, the APK uses the generated Android debug certificate, and no EAS project, production credential, package identity, Play configuration, database, or application source was changed.

## Artifact identity

| Field | Evidence |
|---|---|
| Source commit | `80b2aeb53dd6ef1f2233d7c2d9d789985ebd349d` |
| Lockfile SHA-256 | `B4450BC03089943AF8001072F8F18C3895B1CD0F0401EF94F42BB02561FF33CB` |
| Local build ID | `local-gradle-20261009T121554Z-80b2aeb` |
| Build method | Expo CNG `prebuild`, then Gradle `:app:assembleRelease` for `arm64-v8a` in a disposable short-path copy |
| Package | `com.tindio.pos` |
| Version | `1.0.0` (`versionCode` 1) |
| SDK levels | min 24; compile 36; target 36 |
| Artifact | `C:\tmp\TINDIOPOS-MOB10-80b2aeb-arm64-local.apk` (local handoff; not committed) |
| Size | 54,417,231 bytes |
| Artifact SHA-256 | `FBAFF2C3322F26DEEFA29F8096739EEF5D936ABF215EEF187862C3B598D4F5B3` |
| ABI | `arm64-v8a` |
| Signature | APK Signature Scheme v2; generated debug certificate, SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c` |
| Bundle behavior | `assets/index.android.bundle` is present; this artifact does not require Metro or Expo Go |
| Native persistence | `libexpo-sqlite.so` is present; SecureStore is included through the resolved Expo module set recorded in Slice 1 |
| 16 KB ZIP alignment | PASS for this APK with Build Tools 36 `zipalign -c -P 16 -v 4`; this is not A48 AAB certification |

The disposable build used the repository's configured local public Expo environment variables without recording their values. No runtime connection or synthetic backend fixture was exercised.

## Host-build finding

The initial native builds failed because pnpm's nested module paths plus the Gradle cache location exceeded the Windows 260-character limit inside CMake/Ninja. A disposable copy with hoisted lockfile-pinned dependencies and a short Gradle-cache alias removed that host-only path constraint. The successful build required no product-source or native-configuration change.

The build emitted an Android SDK XML compatibility warning while using command-line tools `15859902`, but Gradle completed successfully. This warning remains a host-tooling observation, not a demonstrated application defect.

## Compatibility and custody impact

- Server database: none.
- SQLite schema/data: none; schema remains version 12 and no installed database was opened.
- POS API v2: unchanged.
- Tenant/store security: unchanged and not physically exercised.
- Transaction custody: unchanged; no outbox, receipt, checkout intent, recovery record, credential, sequence, or cursor was created, reset, or deleted.
- Package identity and production signing: unchanged.
- Repository application code: unchanged.

## Acceptance status

| Case | Result | Evidence boundary |
|---|---|---|
| A01 | `NOT_RUN` | ADB reported no attached device; clean install, launch, sign-in, enrollment, assignment, preparation, and READY state were not executed. |
| A07 | `NOT_RUN` | Requires a prepared physical terminal from A01. |
| A08 | `NOT_RUN` | First-install/incomplete-preparation behavior was not observed on Android. |
| A42 | `NOT_RUN` | Requires a prior installed binary, preserved custody fixture, and an in-place upgrade. |
| A48 | `NOT_RUN` | This debug-key-signed ARM64 APK is not the actual production-signed AAB. APK alignment is only a preliminary native check. |

No case is marked PASS from build or source evidence.

## Validation

| Check | Result |
|---|---|
| Local ARM64 `assembleRelease` | PASS |
| APK metadata/signature/ABI inspection | PASS |
| APK 16 KB ZIP alignment | PASS — preliminary APK evidence only |
| ADB device discovery | BLOCKED — no attached device |
| Mobile typecheck | PASS |
| Root typecheck | PASS |
| Lint | PASS — 0 errors, 3 pre-existing warnings |
| Android JavaScript export | PASS — reported separately from native/device evidence |
| Static certification | BLOCKED — 142/143 automated package checks passed; only `test:phase-04-docker-source-connectivity` failed because local Supabase was unavailable |
| `git diff --check` | PASS |

## Exact next slice

Attach and authorize a physical ARM64 Android device, record its model/API/page size, verify the APK hash again, install this exact artifact, and execute A01 with synthetic data. Preserve installation and runtime logs. Only after A01 establishes a prepared terminal should the campaign proceed to A07; A08 must use a genuinely clean/unprepared installation, and A42 must wait for a controlled upgrade pair.

EAS owner/project binding and production credentials remain unverified and untouched. They are still required before a cloud preview build or production AAB can be claimed.
