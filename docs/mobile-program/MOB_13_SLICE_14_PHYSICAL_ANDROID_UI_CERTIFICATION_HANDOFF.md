# MOB-13 Slice 14 — physical Android UI certification and handoff

Status: **PHONE CAMPAIGN PARTIAL PASS; FULL CERTIFICATION BLOCKED**

## Outcome

The Xiaomi phone was recovered, the current application was rebuilt and installed in place without clearing device data, and the physical campaign progressed through catalogue selection, cart editing, offline cash acceptance, process restart, and receipt recovery.

The campaign reproduced a real phone-only layout defect: cashier task cards inherited content-sized widths, became tall narrow columns, and overlapped Store work. Phone cards now occupy the full available width while the existing dense tablet grid remains unchanged. The rebuilt APK was installed over the existing application and the corrected layout was verified on the same phone.

Full Slice 14 certification remains blocked. No physical tablet or keyboard/HID was available, TalkBack was not run, the maximum-font check covered only the sign-in surface, and online checkout/reconnect stopped at the Android-to-local-API transport boundary.

## Physical device and build

| Item | Observed value |
|---|---|
| Device | Xiaomi 21121210G (`82eaaf10`) |
| Android | 14 / API 34 / arm64-v8a |
| Display | 1080×2400, physical density 440 dpi |
| Package | `com.tindio.pos` 1.0.0 (`versionCode` 2) |
| Candidate APK SHA-256 | `74062A3949F4ED0EC3E10C677D06C54CEF2A185EE67406E71FD17DD1F7E84FF4` |
| Signer certificate SHA-256 | `FAC61745DC0903786FB9EDE62A962B399F7348F0BB6F899B8332667591033B9C` |
| Packaging checks | APK v2 signature PASS; 16 KiB zip alignment PASS |
| Install | `adb install -r`; first-install time preserved at `2026-10-09 22:13:25` |
| Production release candidate | NOT AVAILABLE |

A second APK with localhost as the API origin was used only to diagnose `adb reverse`; its SHA-256 is `3777B41D5259EF09C338A36166CE10A5F593663013429E97A34A21D33E13A346`. It is not a release candidate and does not add production evidence.

## Campaign results

| Requirement | Result | Observation |
|---|---|---|
| Fresh sign-in, enrollment, assignment, preparation | NOT_RUN | The in-place update retained a previously prepared synthetic context; these steps were not rerun |
| READY OFFLINE presentation | BLOCKED | Diagnostics reported READY, while the home label was EXPIRING SOON |
| Catalogue search/scan/selection | BLOCKED | Product selection passed; search and scan were not exercised |
| Cart editing/modifiers/variable price | BLOCKED | Quantity and line-note editing passed; fixture had no modifier or variable-price path |
| Synthetic online cash checkout | BLOCKED | Android-to-local-API transport did not reach the local server |
| Synthetic offline cash acceptance | PASS | PHP 1.00 accepted as provisional `OFF-795A00197A`; change PHP 0.00 |
| Force-stop/cold-restart custody | PASS | Cold launch succeeded and local sale custody remained intact |
| Receipt visibility | PASS | `OFF-795A00197A` remained first in Saved device records |
| Reconnect/recovery/sync review | BLOCKED | One pending outbox record was visible; reconnect could not cross the transport boundary |
| Software keyboard | PASS | Line-note field and actions remained reachable with the keyboard visible |
| Maximum font | BLOCKED | Sign-in remained reachable at font scale 2.0; complete cashier flow not run; original 0.86 restored |
| TalkBack | NOT_RUN | Not enabled on the available device |
| Phone responsive layout | PASS | Defect reproduced and corrected at 1080×2400 |
| Tablet responsive layout | NOT_RUN | No supported physical tablet available |
| Physical keyboard/HID | NOT_RUN | No supported device available |

## Online boundary diagnosis

The local Next server was healthy on the host and returned the expected unauthenticated `401` for `/api/pos/v2/bootstrap`. The phone could not reach the host at `192.168.1.8:3000`, and a localhost validation build produced no server request through `adb reverse tcp:3000 tcp:3000`. The supervised retry stopped there in accordance with the end-to-end verification rule. The unverified boundary is Android transport → local API; no claim is made about online checkout or reconciliation beyond that point.

## Transaction custody

- Only synthetic data was used.
- No app data was cleared and the package was not uninstalled.
- Offline record `OFF-795A00197A` remains pending in local custody.
- After restart, Receipts displayed the provisional record and Sync & Recovery reported one pending item in `DEVICE_ISOLATED` mode.
- The later authentication retry reported that the account was not authorized for the protected business; local transactions remained saved.

## Evidence

Screenshots and matching UI-automation dumps are under `docs/mobile-program/evidence/mob-13-slice-14/`. The structured record at `docs/mobile-program/evidence/MOB_13_SLICE_14_PHYSICAL_ANDROID_UI.json` contains exact hashes and explains what each retained artifact proves.

## Compatibility

```text
Neon/PostgreSQL migration: NONE
SQLite migration/reset: NONE
POS v2 API change: NONE
Authentication contract change: NONE
Production environment change: NONE
```

## Verification

```text
MOB-13 regression suite: PASS — 44/44
Physical UI / checkout / outbox / expiry regressions: PASS — 30/30
Phase 06 native shells: PASS — 1/1
Phase 13 cashier parity: PASS — 1/1
Phase 22 performance contracts: PASS — 3/3
Phase 23 Android hardening: PASS — 6/6
Mobile typecheck: PASS
Mobile lint: PASS — 0 errors, 1 pre-existing warning
Root typecheck: PASS
Root lint: PASS — 0 errors, 3 pre-existing warnings
Android export: PASS — 1,472 modules, 27 assets, Hermes bundle emitted
Physical font-scale restoration: PASS — 2.0 test scale restored to 0.86
git diff --check: PASS
```

## Remaining closure work

Resume with a reachable bound API and a fresh authorized synthetic account to complete online checkout, reconnect, and preparation-state presentation. Then run the same build on the agreed tablet with a physical keyboard/HID, complete cashier flows at maximum text, and TalkBack focus/announcement checks. A49 and Slice 14 remain **BLOCKED** until all required device classes and accessibility conditions have evidence.
