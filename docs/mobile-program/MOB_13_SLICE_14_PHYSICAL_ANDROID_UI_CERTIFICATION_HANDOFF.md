# MOB-13 Slice 14 — physical Android UI certification and handoff

Status: **AUTOMATED HANDOFF PASS; PHYSICAL CERTIFICATION BLOCKED**

## Phase and ticket

```text
Phase: MOB-13 UI convergence
Ticket: MOB-13
Slice: 14 — physical Android UI certification and release handoff
Starting commit: b16dd8fa1d4796ac4915c382772206ea59276ec8
```

## Observed defect

The repository defined the physical Android campaign, but did not provide one executable preflight or a current-slice evidence record that prevented source tests and historical screenshots from being mistaken for certification of the current commit.

This session detected a connected Xiaomi USB interface (`VID_2717`). The previously used Xiaomi `21121210G`, serial `82eaaf10`, briefly appeared as an authorized ADB device, then its transport disappeared after an ADB reconnect. No APK artifact bound to the starting commit or production release candidate was available. The physical campaign therefore could not truthfully begin.

## Architecture decision

Keep the application, transaction flows, local custody, API contracts, and prior evidence unchanged. Add an evidence-only certification boundary:

- a machine-readable Slice 14 evidence record with every required physical flow explicitly `NOT_RUN`;
- a read-only preflight that locates ADB, inventories authorized devices, fingerprints a caller-provided APK, and reports blockers;
- a contract test that prevents A49 or Slice 14 from being promoted by source checks alone.

The preflight never installs an APK, clears app data, changes enrollment, performs a transaction, or mutates device custody.

## Gap matrix

| Requirement | Current result | Closure condition |
|---|---|---|
| Current-commit Android artifact | BLOCKED | Provide an APK through `MOB13_APK_PATH` and retain its SHA-256/signing metadata |
| Physical phone flow | NOT_RUN | Re-authorize/reconnect the supported phone and run every recorded campaign step |
| Physical tablet flow | NOT_RUN | Connect a supported tablet and repeat the responsive/accessibility campaign |
| Keyboard/HID | NOT_RUN | Exercise soft keyboard and supported physical keyboard/HID paths |
| Large text | NOT_RUN | Run at the largest supported Android font/display size |
| TalkBack | NOT_RUN | Verify names, roles, state, focus order, and announcements |
| Production certification | BLOCKED | Use the actual bound Phase 23/24 release candidate after the production release gate is ready |

## Protected components

- checkout, payment, receipt, inventory, and outbox identities;
- SQLite databases, cached authorization, and transaction custody;
- device enrollment, assignment, and local preparation state;
- POS v2 and authentication contracts;
- all historical physical evidence and acceptance outcomes.

## Changed files

- `scripts/mobile-mob-13-physical-ui-preflight.mjs`
- `scripts/mobile-mob-13-physical-certification.test.mjs`
- `docs/mobile-program/evidence/MOB_13_SLICE_14_PHYSICAL_ANDROID_UI.json`
- `package.json`
- this handoff report

## Database, SQLite, and API compatibility

```text
Neon/PostgreSQL migration: NONE
SQLite migration/reset: NONE
POS v2 API change: NONE
Authentication change: NONE
Production environment change: NONE
```

## Security and transaction-custody impact

- No device data was cleared, reset, uninstalled, or overwritten.
- No credential, enrollment, assignment, cached authorization, receipt, transaction, or outbox record was changed.
- No synthetic or real financial transaction was attempted because the current build/device prerequisites were not satisfied.
- The evidence record contains no secrets or merchant data.

## Tests and exact results

```text
MOB-13 UI contract: PASS — 4/4
MOB-13 cashier home: PASS — 5/5
MOB-13 catalogue: PASS — 4/4
MOB-13 cart workspace: PASS — 5/5
MOB-13 tender/receipt: PASS — 3/3
MOB-13 supporting workflows: PASS — 4/4
MOB-13 responsive/accessibility: PASS — 6/6
MOB-13 release inputs: PASS — 10/10
MOB-13 physical certification contract: PASS — 3/3
Phase 06 native shells: PASS — 1/1
Phase 13 native cashier parity: PASS — 1/1
Phase 22 performance: PASS — 3/3
Phase 23 Android hardening: PASS — 6/6
Physical UI hardening: PASS — 6/6
Online checkout custody: PASS — 5/5
Outbox recovery custody: PASS — 5/5
Offline authorization/expiry: PASS — 14/14
Mobile typecheck: PASS
Mobile lint: PASS — 0 errors, 1 pre-existing warning
Root typecheck: PASS
Root lint: PASS — 0 errors, 3 pre-existing warnings
Android export: PASS — 1,472 modules bundled; 27 assets; Android Hermes bundle emitted
git diff --check: PASS before this report; repeated before commit
```

## Physical evidence

```text
Xiaomi USB interface: DETECTED
ADB executable: C:\tmp\android-platform-tools\platform-tools\adb.exe
Authorized device: 82eaaf10 briefly visible, then transport unavailable
Current-commit APK: NOT AVAILABLE
Phone campaign: NOT RUN
Tablet campaign: NOT RUN
Large-text campaign: NOT RUN
TalkBack campaign: NOT RUN
Keyboard/HID campaign: NOT RUN
A49: BLOCKED
Slice 14 physical certification: BLOCKED
```

The structured record is `docs/mobile-program/evidence/MOB_13_SLICE_14_PHYSICAL_ANDROID_UI.json`. Prior Xiaomi screenshots certify only their named historical slice; they are not reused as proof for this source commit.

## Resume command

After reconnecting and authorizing the phone and producing the exact APK to test:

```powershell
$env:MOB13_ADB_PATH = 'C:\tmp\android-platform-tools\platform-tools\adb.exe'
$env:MOB13_APK_PATH = 'C:\absolute\path\to\current-candidate.apk'
pnpm audit:mobile-mob-13-physical-ui
```

The command fingerprints the APK and reports the attached device inventory. A successful preflight only permits the campaign to start; it does not itself certify the UI.

## Remaining limitations

- The phone must be unlocked/reconnected with USB debugging authorized.
- A current-commit APK must be built and retained before testing.
- A supported physical tablet and physical keyboard/HID remain unavailable.
- The production release manifest, signing, public origins, support email, approved listing assets, and release-candidate screenshots remain blocked elsewhere; therefore this is not production certification.

## Commit

Recorded by the focused Slice 14 handoff commit following validation.

## Next smallest safe slice

Resume Slice 14 when the phone transport and current APK are available. Run the phone campaign first without clearing existing custody, then the tablet/large-text/TalkBack/keyboard campaign. Update only the new Slice 14 evidence record with truthful screenshots, device/build metadata, and observed results. Do not mark A49 `PASS` until every required device class and accessibility condition has evidence.
