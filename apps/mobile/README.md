# TINDIO Mobile POS

`apps/mobile` is the native Android cashier client for TINDIO. It uses Expo SDK
57, React Native 0.86, Expo Router, TypeScript, SecureStore, and SQLite. The
Android package ID is locked as `com.tindio.pos`.

## Authority boundaries

- Supabase Auth authenticates the employee and issues the session.
- The TINDIO API enforces tenant, store, employee, register, and device scope.
- Neon is authoritative for business data and accepted cloud transactions.
- SQLite holds local catalogue/reference snapshots, receipts, sync metadata,
  durable checkout intents, and the offline outbox.
- The device does not implement a second pricing, authorization, inventory, or
  receipt authority.

Prepared terminals may accept supported cash sales while isolated. Card and
electronic payments, unsupported customer/ticket/dining carts, expired offline
authorization, or unresolved online checkout outcomes fail closed. Store Hub is
retained in `apps/store-hub` but deferred from v1.

## Environment

Copy `.env.example` to `.env.local` and provide only the approved public origins
and Supabase publishable key:

```text
EXPO_PUBLIC_TINDIO_API_URL=https://your-tindio-api.example.com
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Never commit `.env.local`, service-role keys, database credentials, device
secrets, signing files, EAS credentials, or production account credentials.

## Development commands

Run from the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm mobile:start
pnpm mobile:android
pnpm mobile:typecheck
pnpm --dir apps/mobile lint
pnpm mobile:export:android
```

`pnpm mobile:start` can provide a browser preview, but browser/Expo Go rendering
is not certification evidence for the native Android runtime. Camera,
SecureStore, SQLite durability, Android lifecycle behavior, upgrades, and
physical accessibility/hardware gates require a development/preview APK or the
appropriate release candidate on physical devices.

## Builds and release inputs

EAS profiles in `eas.json`:

- `development` — internal APK for development.
- `preview` — internal APK for controlled review and physical testing.
- `production` — remotely signed Android App Bundle; production submission is
  kept as a draft unless the protected release gate passes.

`production-release.json` is the fail-closed release-input manifest. It records
approved EAS ownership/project identity, API/Auth origins, signing verification,
branding, listing assets, screenshots, support contact, and public-policy
evidence. Do not change its blocked outcomes merely to make a build pass.

Useful root checks include:

```powershell
pnpm test:mobile-source-of-truth
pnpm test:phase-23-android-hardening
pnpm test:phase-24-google-play
pnpm gate:phase-24:production
pnpm certify:static
```

The full mobile test catalogue is intentionally exposed through root
`test:mobile-*` scripts and discovered by static certification. Physical-device
evidence remains separate from deterministic source checks.

## Source of truth

- [Mobile + Neon program](../../docs/TINDIO_MOBILE_NEON_SOURCE_OF_TRUTH.md)
- [Mobile program index](../../docs/mobile-program/README.md)
- [Android production hardening](../../docs/mobile-program/PHASE_23_ANDROID_PRODUCTION_HARDENING.md)
- [Google Play testing and release](../../docs/mobile-program/PHASE_24_GOOGLE_PLAY_TESTING_RELEASE.md)
- [Web/mobile UI source of truth](../../docs/mobile-program/TINDIO_POS_WEB_MOBILE_UI_SOURCE_OF_TRUTH.md)
- [Hardware support scope](../../docs/mobile-program/ANDROID_V1_HARDWARE_SUPPORT.md)

The Expo-generated `LICENSE` is retained pending owner licensing review. It is
not interpreted here as the repository-wide TINDIO license.
