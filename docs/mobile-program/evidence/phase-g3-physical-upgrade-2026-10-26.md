# Phase G3 physical in-place upgrade evidence - closed 2026-10-27

Status: **PASS**

Release candidate: `0eebdcbccb20fe4da7782df8c644f08d1422bae2`

## Physical upgrade evidence

- An authorized realme RMX2189 running Android 11 was connected through ADB.
- The installed `com.tindio.pos` version `1.0.0` / code `2` APK was captured and hashed before the campaign.
- Every successor was built from the exact release-candidate commit with the same local signing key.
- Every `adb install -r` completed without uninstalling, clearing app data, resetting SQLite or SecureStore, logging out as a migration shortcut, or reenrolling the device.
- Android retained signature marker `51ed3f60`, original install time `2026-10-17 11:41:08`, and app-data inode `933936`.
- The expired/reconnect state and accepted-sales recovery message remained visible across the initial upgrades.

## Diagnosed transport boundaries

The first Preview APK embedded `http://127.0.0.1:3000` while Android cleartext was disabled, so Android rejected the first protected bootstrap request after Auth succeeded.

The corrected HTTPS Preview APK reached Vercel but received an HTTP 302 redirect to Vercel SSO. `vercel curl` reached TINDIO and returned the expected application-level `AUTH_REQUIRED`, proving Preview Deployment Protection was the remaining transport boundary. Deployment Protection was not disabled and no bypass secret was embedded.

The repository's existing development profile was then used for the isolated physical proof. EAS build `4881e00e-07a0-42ab-878d-593b9fcf6249` produced the exact-RC internal APK with SHA-256 `C8032770207C2423284B6E4FCEF7347216F5C68124D1B82598050AABA7CC29A9`, loopback origin `http://127.0.0.1:3000`, and the development-only cleartext allowance.

## Application-level custody proof

The development APK authenticated the existing synthetic account through ADB reverse to the exact-RC local server backed by the isolated Neon staging branch. The authenticated workspace opened successfully.

Before the proof reinstall, `armAppUpgradeProof` recorded:

- Auth state `SUPABASE_ACTIVE`;
- one unsynced event;
- one immutable receipt;
- one device-sequence checkpoint; and
- SQLite schema 13.

After another same-signer `adb install -r`, `verifyAppUpgradeProof` passed and reported that the Auth session, device enrollment, offline authorization grant, event, receipt content, device-sequence checkpoint, and SQLite schema 13 to 13 were preserved.

## Cleanup

- The ADB reverse tunnel was removed.
- The local staging server was stopped.
- Temporary EAS linkage and credentials files were removed.
- Production configuration, deployment protection, and production data were not changed.

Machine-readable evidence is in `phase-g3-physical-upgrade-2026-10-26.json`.
