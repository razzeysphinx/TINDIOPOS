# Phase H4 rollback runbook and rehearsal evaluator

Status: **IMPLEMENTED; PRODUCTION REHEARSAL NOT RUN**  
Decision: **NO GO**

## Rollback order

1. Declare the incident, freeze promotion, and record the timestamp and stage.
2. Stop new Neon Auth traffic without deleting accounts or sessions.
3. Restore Web and Backend selectors to Supabase.
4. Reopen the supported-client compatibility window.
5. Verify Web, Backend, and supported Mobile access.
6. Preserve Neon sessions and sanitized logs for forensic analysis.
7. Preserve device enrollment, offline authorization, SQLite, outbox, receipts,
   shifts, checkpoints, and all transaction custody.
8. Reconcile identity mappings and financial/inventory effects.
9. Keep forward promotion on hold until a new owner-approved decision.
10. Publish a sanitized status for operators and support.

Rollback is a traffic and selector decision, never a data-deletion operation.
Neither provider's accounts or sessions are deleted. Mobile SecureStore and
SQLite are not cleared, devices are not reenrolled, outbox work is not
discarded, and historical financial rows are not rewritten.

## Executable evaluation

`scripts/phase-h-rollback-evaluator.mjs` separately evaluates readiness before
a rehearsal and completeness after it. Every required boolean must be exactly
`true`; missing, false, malformed, or partial evidence fails closed. The model
does not execute provider or deployment changes.

The existing Phase E E-AUTH-13 isolated Supabase rollback proof remains `PASS`.
It proves the provider-neutral fallback and custody behavior in its recorded
environment. A production-like rehearsal remains `NOT_RUN` until H1 is ready,
the rollback authority and owner approval are recorded, and an approved release
candidate/cohort exists.
