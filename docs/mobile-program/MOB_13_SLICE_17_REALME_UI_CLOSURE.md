# MOB-13 Slice 17 — Realme phone UI closure

Status: **PHONE UI PARTIAL PASS; FULL PHYSICAL CERTIFICATION BLOCKED**

## Outcome

The current mobile source was built, installed in place, and inspected on the attached Realme phone without uninstalling the app, clearing its data, or changing transaction custody. The preserved Phase 04 certification context loaded successfully after the local API was restored.

The compact-phone cashier home, POS catalogue, cart/payment area, and software-keyboard state render with the converged TINDIO UI. Physical inspection also exposed one remaining presentation defect: the POS route used a bare `Local catalog is not prepared.` text fallback while terminal context was loading or unavailable. Slice 17 replaces that raw fallback with a responsive TINDIO setup card, loading/restriction feedback, retry, and safe return-to-register actions.

Full physical certification remains blocked because no tablet, physical keyboard/HID, or TalkBack campaign was available. The closed-shift gate was not forced because the retained certification context contains an active shift and unresolved sync-review custody.

## Device and validation build

| Item | Observed value |
|---|---|
| Device | realme RMX2189 (`TWIJVGS869RWBUGU`) |
| Android | 11 / API 30 / arm64-v8a |
| Display | 720×1600, physical density 320 dpi, font scale 1.0 |
| Package | `com.tindio.pos` 1.0.0 (`versionCode` 2) |
| Validation APK SHA-256 | `98137C48EB7C1600FEF2E9FBACF73EA4D8D2A1C7D8C32E9C6285CB15468013D0` |
| Signer certificate SHA-256 | `FAC61745DC0903786FB9EDE62A962B399F7348F0BB6F899B8332667591033B9C` |
| Packaging checks | APK v2 signature PASS; 16 KiB zip alignment PASS |
| Install | `adb install -r`; first-install time preserved at `2026-10-17 11:41:08` |
| Production release candidate | NOT AVAILABLE |

The APK is a localhost-only validation artifact. Its generated native manifest temporarily permits cleartext traffic solely for `adb reverse tcp:3000 tcp:3000`; committed production source still disallows cleartext traffic.

## Physical results

| Requirement | Result | Observation |
|---|---|---|
| Preserved cashier home | PASS | Phase 04 identity, sync-review warning, navigation hierarchy, and full-width phone cards rendered correctly |
| Compact-phone POS catalogue | PASS | Header, offline state, search, quick barcode entry, camera action, category chip, and product card remained readable at 720×1600 |
| Cart and payment layout | PASS | Empty cart, total, cash-tender input, change state, and readiness content remained aligned and scroll-reachable |
| Software keyboard | PASS | Search retained focus and remained visible above the resized keyboard |
| Register-setup fallback | SOURCE PASS | Raw fallback replaced by shared TINDIO screen/card/feedback/actions; source contract passes |
| Closed-shift gate | NOT_RUN | Active shift and unresolved custody were intentionally preserved |
| Maximum font | NOT_RUN | Font scale remained at the original 1.0 during this slice |
| TalkBack | NOT_RUN | TalkBack was not enabled on the available phone |
| Tablet responsive layout | NOT_RUN | No supported physical tablet was attached |
| Physical keyboard/HID | NOT_RUN | No supported hardware was available |

## Custody and safety

- The application was updated in place; its first-install timestamp stayed unchanged.
- No package uninstall, app-data clear, SQLite reset, database mutation, sale, payment, shift close, or sync-review deletion was performed.
- The unresolved synthetic transaction remains visible under Sync and recovery.
- The localhost validation build is not production evidence and must not be distributed as a release candidate.

## Evidence

Screenshots and matching UI-automation dumps are stored under `docs/mobile-program/evidence/mob-13-slice-17/`. The structured record is `docs/mobile-program/evidence/MOB_13_SLICE_17_REALME_UI.json`.

## Verification

```text
Register-setup UI contract: PASS — 2/2
Slice 16 visual-density contract: PASS — 4/4
Physical UI hardening contract: PASS — 6/6
Mobile typecheck: PASS
Mobile lint: PASS — 0 errors, 1 pre-existing warning
APK v2 signature: PASS
APK 16 KiB zip alignment: PASS
Same-signer in-place install: PASS
Compact-phone catalogue/cart/keyboard visual inspection: PASS
```

## Remaining closure

Run the same current source on the agreed physical tablet and physical keyboard/HID, then complete TalkBack and maximum-font checks. Capture the closed-shift gate only with a safe synthetic context that does not require closing the retained active shift or releasing unresolved transaction custody.
