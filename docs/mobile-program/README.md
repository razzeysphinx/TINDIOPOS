# TINDIO Mobile Program Index

The mobile program is intentionally evidence-heavy. Stable paths are retained
because release gates, scripts, and historical reports reference them directly.

## Program definition

- [Canonical mobile + Neon source of truth](../TINDIO_MOBILE_NEON_SOURCE_OF_TRUTH.md)
- [Web/mobile UI source of truth](TINDIO_POS_WEB_MOBILE_UI_SOURCE_OF_TRUTH.md)
- [Android v1 hardware scope](ANDROID_V1_HARDWARE_SUPPORT.md)

## Phase reports

Files named `PHASE_*` describe the canonical implementation sequence from API
separation and native SQLite through recovery, security, performance, Android
hardening, release, fleet management, and observability.

## MOB implementation reports

Files named `MOB_<program>_SLICE_*` are auditably separate slice reports. They
must not be merged simply to reduce file count:

- MOB-10 — physical failure, compatibility, policy, accessibility, and restore
  evidence.
- MOB-11 — Store Hub v1 deferral.
- MOB-12 — v1 hardware scope.
- MOB-13 — web/mobile UI convergence and physical UI evidence.
- MOB-14 — protected production gate, submission, reconciliation, and telemetry.

## Release and operations

- [Android production hardening](PHASE_23_ANDROID_PRODUCTION_HARDENING.md)
- [Google Play testing/release](PHASE_24_GOOGLE_PLAY_TESTING_RELEASE.md)
- [Google Play listing draft](GOOGLE_PLAY_LISTING_DRAFT.md)
- [Google Play reviewer access](GOOGLE_PLAY_REVIEWER_ACCESS.md)
- [Performance runbook](PHASE_22_PERFORMANCE_RUNBOOK.md)
- [Real-store test matrix](PHASE_24_REAL_STORE_TEST_MATRIX.md)

## Evidence

`evidence/` contains machine-readable results, screenshots, UI hierarchy dumps,
and release evidence. Evidence remains immutable in meaning: deterministic test
success never upgrades a deferred physical, hardware, accessibility, signing,
Google Play, or real-store outcome.

## Deferred components

Store Hub remains in `apps/store-hub` for later completion. It is not abandoned,
archived, or certified for the v1 merchant release.
