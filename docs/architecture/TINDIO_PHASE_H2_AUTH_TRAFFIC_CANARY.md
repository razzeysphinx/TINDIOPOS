# Phase H2 authenticated-traffic canary plan

Status: **PREPARED; NOT EXECUTED**  
Current stage: **H2-0 — zero production traffic**  
Decision: **NO GO**

## Staged rollout

| Stage | Scope | Minimum observation | Promotion rule |
| --- | --- | --- | --- |
| H2-0 | Preflight; 0% traffic | None | Every H1 gate and H2 entry requirement passes. |
| H2-1 | Named internal accounts; maximum 1% | 60 minutes | Metrics, identity mapping, authorization, finance, custody, and support pass. |
| H2-2 | One explicitly approved pilot tenant; maximum 5% | 4 hours | H2-1 passed and tenant reconciliation is complete. |
| H2-3 | Limited cohort; maximum 25% | 24 hours | H2-2 passed with no unresolved severity 1/2 incident. |
| H2-4 | General cutover | 72 hours | H2-3 passed, owner approves, rollback remains available. |

Percentages are hard ceilings, not targets. A stage must never advance because
time elapsed alone. Every required evidence field must be populated with dated,
non-secret production evidence and acknowledged by the cutover commander and
rollback authority.

## Authenticated surface coverage

Every stage exercises Web session lifecycle, Backend bearer validation, tenant
and store authorization, and Data API/RLS. Applicable signed-build stages also
cover Mobile fresh install, in-place upgrade, and offline-custody recovery.

## Fail-closed behavior

Any failed entry criterion, threshold, identity reconciliation, authorization
denial expectation, duplicate financial effect, unresolved custody issue, or
severity 1/2 incident triggers `ROLLBACK_AND_HOLD`. Promotion resumes only with
a new reviewed decision; there is no automatic forward retry.

This slice defines and certifies the canary control plane. It does not create
accounts, change provider configuration, or route live traffic.
