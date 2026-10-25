# Phase G3 physical Auth and custody upgrade

Status: **HARNESS IMPLEMENTED; PHYSICAL RUN BLOCKED — NO AUTHORIZED DEVICE**

The existing Android production-readiness screen now arms and verifies a
versioned upgrade proof covering:

- presence of the existing Supabase and Neon session formats, without storing
  token or cookie contents;
- device enrollment identity and store/register binding, without storing the
  device secret;
- offline authorization scope;
- unresolved event identity, idempotency key, sequence, payload, and snapshot;
- immutable local receipt content through SHA-256 digests; and
- local next-sequence and server-checkpoint values.

The support UI also displays the current Auth transition state. Verification
fails closed for a missing session, enrollment, offline grant, transaction,
receipt, or sequence checkpoint, or for any changed protected identity/content.

## Physical procedure

1. Connect one authorized Android device and provide same-package, same-signer
   baseline and successor APKs to the Phase G3 preflight.
2. On the baseline, sign in with a synthetic certification account, prepare the
   assigned register, create one unresolved synthetic offline transaction, and
   arm the upgrade proof.
3. Disconnect networking and record the installed package, signer, build,
   `firstInstallTime`, Auth transition state, schema, and diagnostic summary.
4. Install the successor with `adb install -r`. Do not uninstall, clear app
   data, reset SQLite/SecureStore, sign out, or reenroll the device.
5. Launch while still offline and verify the proof before any synchronization.
6. Record that the old session remains present/readable, enrollment and offline
   authorization are intact, and the event, receipt, and sequence checkpoints
   exactly match the baseline. Reconnect only after preservation passes.

The repository already has prior physical `adb install -r` evidence for SQLite
custody in MOB-10 A42. That evidence remains valid, but it predates this Auth
transition proof and therefore is not reused as a Phase G3 physical PASS.

On 2026-10-25, ADB was available but listed no authorized device. No Phase G
baseline/successor APK pair was supplied. The implementation and preflight can
be certified automatically; the physical observation remains blocked.
