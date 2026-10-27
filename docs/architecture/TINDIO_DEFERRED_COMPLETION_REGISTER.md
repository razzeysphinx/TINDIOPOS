# TINDIO deferred completion register

Status: **ACTIVE — OPEN ITEMS ARE NOT PASSES**  
Established: **2026-10-25**  
Branch: **TINDIO-PREPRODUCTION**

## Purpose and control rule

This is the consolidated record of work that must be completed later because
it requires production authority, real identities, external services, signed
artifacts, physical hardware, an observation window, or explicit owner
approval. Finishing an implementation phase does not waive an item here.

Every item remains open until its named evidence exists, is dated, identifies
the tested release/environment, and receives the required approval. Automated
source checks may support an item but cannot replace physical, production, or
owner evidence. No agent may mark an item complete merely because a later
phase has started or finished.

Phase G repository implementation closed on 2026-10-25 under the decision
`ADVANCE_TO_PHASE_H_PLANNING_AND_REHEARSAL_ONLY`. This changes none of the
statuses below: the F4 `DO_NOT_CUT_OVER` decision remains controlling and Phase
H production execution is not authorized.

## Auth migration and client transition

| ID | Required later work | Current state | Completion evidence |
| --- | --- | --- | --- |
| F1-01 | Obtain an authorized full Supabase Auth-directory export and reconcile it with canonical profiles. | `BLOCKED_EXTERNAL` | Pseudonymous aggregate report, collision disposition, zero unresolved identities, owner review. |
| F1-02 | Approve the password reset/account-claim and OAuth reauthentication policy. | `OWNER_DECISION_REQUIRED` | Signed policy plus rehearsed user/support procedure. |
| G1-01 | Activate and certify Neon Auth for Web only after F1 reconciliation. | `BLOCKED_BY_F1` | All Web lifecycle flows pass against the approved target and production-like email/OAuth configuration. |
| G3-01 | Run the same-signer Android in-place Auth/offline-custody upgrade. | `PASS` | Physical same-signer reinstall passed on 2026-10-27 with original install identity and app-data inode retained. The built-in proof verified the active Auth session, device enrollment, offline grant, one unsynced event, immutable receipt, sequence checkpoint, and SQLite schema 13 without clearing custody. |
| G4-01 | Run fresh-install, supported-old-client, forced-upgrade, and provider-rollback campaigns. | `IN_PROGRESS_PHYSICAL_CAMPAIGN` | On 2026-10-27, the supported-old-client, same-signer version-code 2 to 3 and 3 to 4 upgrades, and a non-destructive binary 4 to 3 to 4 rollback/re-upgrade passed with Auth, schema, and offline custody preserved. Fresh-install, forced-upgrade-426, and Auth-provider rollback legs remain; fresh install requires a disposable target or explicit reset approval. |
| G4-02 | Approve the supported-client window and minimum version/capability policy. | `OWNER_DECISION_REQUIRED` | Version population report, merchant communication/support plan, staged enforcement approval. |
| G4-03 | Configure production Neon Auth trusted domains, application identity, SMTP, verification, and OAuth credentials; disable localhost allowances. | `NOT_AUTHORIZED` | Reviewed production configuration and live delivery/redirect evidence. |

## Cutover, observation, and retirement

| ID | Required later work | Current state | Completion evidence |
| --- | --- | --- | --- |
| H-01 | Approve the production cutover package, maintenance/freeze window, named operators, monitoring, support, and rollback runbook. | `PACKAGE_PREPARED_OWNER_APPROVAL_REQUIRED` | Signed go/no-go record and successful rehearsal. |
| H-02 | Execute controlled identity import/account claim and production client rollout. | `PROHIBITED_UNTIL_H01` | Auditable identity mapping, canary results, error/latency/Auth metrics, reconciliation report. |
| H-03 | Observe production through the approved rollback window with no unresolved financial/Auth incident. | `NOT_STARTED` | Dated dashboards, incident ledger, support review, owner exit approval. |
| I-01 | Close the legacy client window only after supported-client adoption and custody reconciliation. | `GATE_PREPARED_NOT_SATISFIED` | Active-version report, zero unresolved blocked-device custody, approved enforcement change. |
| I-02 | Remove inactive Supabase SDK/env/webhook/redirect/job dependencies. | `INVENTORIED_PLAN_ONLY_NOT_EXECUTED` | Dependency inventory reaches zero for approved scope and rollback window is closed. |
| I-03 | Decommission or delete Supabase resources. | `DO_NOT_DECOMMISSION_SEPARATE_DESTRUCTIVE_APPROVAL_REQUIRED` | Verified backups/archive, retention approval, explicit named-owner authorization, post-action audit. |
| J-01 | Run final performance, security, accessibility, disaster-recovery, CI/CD, and end-to-end release certification. | `REPOSITORY_PACKAGE_COMPLETE_EXTERNAL_EVIDENCE_OPEN` | Exact release candidate passes the full certification catalogue with archived evidence. |

## Mobile, hardware, Play, and business gates

The detailed case-level source of truth remains
`docs/mobile-program/MOB_10_DEFERRED_EVIDENCE_REGISTER.md`. It includes the
multi-terminal cases A34/A35, HID scanner A37, printer A38, Store Hub A39/A40,
Play reviewer/public-policy/release cases A46-A48, accessibility/device case
A49, and the conditional payment case A41. Those cases are incorporated here
by reference and retain their existing status and scope restrictions.

## Maintenance protocol

When an item becomes executable:

1. Record the exact environment, release identifier, operator, and date.
2. Attach non-secret logs/screenshots/reports and link the governing runbook.
3. Record pass, fail, or blocked honestly; never convert `NOT_RUN` to `PASS`.
4. Obtain the named owner approval when the row requires it.
5. Update this register, the production cutover checklist, and architecture
   certification in the same reviewed change.

Until every applicable row is closed, TINDIO must not be represented as having
completed production Auth cutover, provider retirement, or final release
certification.
