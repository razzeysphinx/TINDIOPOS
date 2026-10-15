# Google Play reviewer access

## A46 status

```text
IMPLEMENTED: reviewer instructions and fail-closed release evidence
NOT CERTIFIED: Play Console credential entry and fresh-install review remain external
```

This file is the repository copy of the instructions to place in **Play Console > App content > App access**. Never add the reviewer email, password, access token, recovery code, service-account key, or device secret to this repository.

## Credential custody

- Create a dedicated Google Play reviewer employee in the synthetic staging/certification organization. It must not belong to a production merchant.
- Store its username and password only in the Play Console app-access declaration and the approved secret manager. Repository automation refers to them as `TINDIO_PLAY_REVIEWER_EMAIL` and `TINDIO_PLAY_REVIEWER_PASSWORD` but must never print their values.
- Keep the account active and unexpired for the whole review window. Do not require MFA, one-time codes, VPN, IP allowlisting, or manual approval by TINDIO staff.
- The credential owner must test the exact submitted build from a clean Android installation immediately before submission and after any credential rotation.
- Revoke the dedicated account after the review window unless it is retained under the documented reviewer-account rotation policy.

## Required reviewer identity

The fresh install must be able to enroll itself. The dedicated identity therefore needs these permissions in its synthetic organization:

```text
devices.manage
pos.access
sales.create
payments.accept
receipts.view
receipts.reprint
shifts.open
shifts.close
```

If the submitted build declares optional customer, ticket, transfer, time-clock, discount, refund, cash-movement, or inventory functions as reviewable, give the reviewer the corresponding permission and enable the matching feature in the synthetic tenant. Do not grant cross-tenant membership or access to production merchant data.

## Instructions for the reviewer

1. Connect the Android device to the internet and open **TINDIO POS**.
2. Sign in with the username and password supplied in the Play Console app-access declaration.
3. If prompted to select an organization, choose the named TINDIO synthetic reviewer organization supplied in Play Console.
4. On **Enroll this Android POS**, keep the generated device name or enter a name, select the supplied synthetic store and register, then tap **Enroll this device**.
5. Wait for initial preparation to finish. The home screen shows the employee, assigned store, connection state, and terminal-readiness state.
6. Open **shift**. If there is no active shift, open one with the synthetic opening cash amount supplied in Play Console.
7. Open **pos**. Search or scan the supplied synthetic product, add it to the cart, and use **cash** for checkout. Electronic/card payment while offline is intentionally unavailable because no compliant provider has been selected.
8. Open **receipts** to view the resulting receipt. Physical receipt printers are unsupported in v1; the committed receipt remains viewable in-app.
9. Open **sync-status** to see preparation, pending delivery, conflict, and recovery state. Accepted transactions are never cleared merely to recover connectivity.
10. Open **hardware** to test camera barcode scanning. If camera permission is denied or no camera is available, manual barcode/SKU entry remains available in **pos**.
11. Open **settings**, **production-readiness**, and **offline-payments** for terminal/device details, readiness limitations, and the explicit offline-electronic-payment restriction.
12. Conditional routes appear only when both the tenant feature and reviewer permission permit them: **customers**, **tickets**, **transfers**, and **time-clock**.

Initial sign-in, device enrollment, initial preparation, authorization renewal, and cloud reconciliation require network access. A prepared terminal may accept supported offline cash sales only while its bounded authorization and matching shift remain valid.

## Fresh-install verification record

Before changing `reviewerAccess.status` to `PASS`, record all of the following in `PHASE_24_GOOGLE_PLAY_RELEASE_EVIDENCE.json`:

- non-secret credential owner;
- credential verification timestamp;
- Play Console configuration timestamp;
- exact submitted-build fresh-install verification timestamp;
- confirmation that the tenant is synthetic and contains no production merchant data;
- successful sign-in, self-enrollment, initial preparation, shift access, cash checkout, receipt access, sync/recovery access, and all conditional functions declared to Play.

Screenshots alone are insufficient. The reviewer walkthrough must use the exact release candidate and verify the authoritative synthetic sale/receipt result without exposing credentials in captured evidence.
