# MOB-10 Slice 1 — Android baseline audit

Status: **BLOCKED before build and physical execution**

This record does not certify Android runtime behavior. No APK, emulator, physical device, EAS project, signing credential, or Play artifact was created or changed.

## Build audit

| Area | Decision | Current evidence |
|---|---|---|
| Expo application and Router structure | KEEP | Existing CNG application remains under `apps/mobile`; no generated `android` or `ios` directory is committed. |
| Package identity | KEEP | Resolved Android package is `com.tindio.pos`. |
| Expo / React Native | KEEP + HARDEN | Expo Doctor found six SDK 57 patch mismatches. They were aligned to Expo `57.0.27`, React Native remains `0.86.3`, and Expo Doctor now passes 21/21. |
| Native persistence/security modules | KEEP + HARDEN | `expo-sqlite` is aligned to `57.0.4`; `expo-secure-store` remains `57.0.4`. Both are autolinked in resolved prebuild configuration. |
| APK profiles | KEEP + HARDEN | `development` and `preview` remain internal-distribution APK profiles. Their EAS environments are now explicit. Neither enables `developmentClient`, so the intended preview artifact embeds the application bundle and does not require Metro. |
| Production release profile | KEEP | Production remains an AAB, remote-credential profile with remote version source and production-only auto-increment. |
| EAS ownership/project binding | EXTEND (blocked) | Resolved config has no `owner` or `extra.eas.projectId`, no `EXPO_TOKEN` is present, and `eas whoami --non-interactive` reports `Not logged in`. The correct owner/project cannot be invented. |
| Development/preview signing | EXTEND (blocked) | Android APKs must be signed. Existing EAS credential state cannot be inspected without authentication. No command was allowed to initialize a project, generate a keystore, or alter production signing. |
| Build environment selection | KEEP + HARDEN | The three required public variables are validated by the app. EAS profiles now explicitly select `development`, `preview`, and `production`. No values or secrets are recorded here. |
| Local Android toolchain/device | NEW (blocked) | This workstation exposes no ADB, Android SDK variables, JDK, emulator, or connected device. |
| Application/domain architecture | KEEP | No checkout, inventory, sync, identity, database, or authorization logic changed. |

Expo SDK 57 resolves Android `compileSdkVersion` and `targetSdkVersion` 36. The local schema remains 12 and the backend boundary remains POS API v2.

## Version behavior

- `versionName`: app config `1.0.0`.
- Local `android.versionCode`: `1`.
- EAS `appVersionSource`: `remote`, so the actual built version code must be taken from the EAS build record, not inferred from source.
- Only the production profile has `autoIncrement: true`.

## Native modules in the resolved prebuild

The resolved autolink set includes the application-required `expo-application`, `expo-camera`, `expo-constants`, `expo-crypto`, `expo-device`, `expo-file-system`, `expo-font`, `expo-image`, `expo-linking`, `expo-router`, `expo-secure-store`, `expo-splash-screen`, `expo-sqlite`, `expo-system-ui`, and supporting Expo/React Native modules.

## Compatibility and custody impact

- Server database: none.
- SQLite schema/data: none; schema remains version 12.
- API: none; POS API v2 is unchanged.
- Tenant/store security: unchanged.
- Transaction custody: unchanged; no local database was opened, reset, deleted, or migrated by this slice.
- Production signing/package/Play configuration: unchanged.

## Validation

| Check | Result |
|---|---|
| Expo Doctor after alignment | PASS — 21/21 |
| Mobile typecheck | PASS |
| Root typecheck | PASS |
| Lint | PASS — 0 errors, 3 pre-existing warnings |
| Android JavaScript export | PASS — reported separately; not device evidence |
| Static certification | BLOCKED — 142/143 automated package checks passed; only `test:phase-04-docker-source-connectivity` failed because local Supabase was unavailable |
| `git diff --check` | PASS |

## Physical evidence

A01, A07, A08, A42, and A48 are all `NOT_RUN`. No scenario is marked PASS. The structured record is `evidence/MOB_10_SLICE_01_ANDROID_BASELINE.json`.

## Unblocking sequence

1. Authenticate the authorized Expo account without committing a token.
2. Identify and verify the intended EAS owner/project binding for `com.tindio.pos`.
3. Inspect existing Android credentials read-only and confirm a preview build will not replace production signing state.
4. Confirm the preview EAS environment contains the required public endpoint variables and targets an approved synthetic test backend.
5. Start the preview APK build, record its build ID/version, download it, and compute SHA-256.
6. Connect a physical Android device with USB debugging (or provide an authorized direct-install path), capture model/API/page size, then execute A01 first.

Do not begin A07 until A01 has established a prepared synthetic terminal. Do not begin A42 until a prior installed binary exists. Do not claim A48 from an APK or JavaScript export.
