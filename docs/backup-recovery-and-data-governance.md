# TINDIO backup, recovery, and data-governance procedure

## What Phase 17 protects

TINDIO retains historical business records rather than offering destructive tenant deletion. It records a completed tenant export delivery, enforces a fresh delivered export before an organization can be archived, preserves a minimum seven-year audit and archived-data retention setting, and keeps immutable recovery-drill evidence.

The application does not automatically restore its authoritative Neon database. Production branch restore or endpoint cutover can affect every connected service, so it must be performed by an authorized platform administrator during an agreed recovery window. Supabase remains the authentication provider and requires its own identity/session recovery procedure; it is not the authoritative business database.

## Routine procedure for each business owner

1. In TINDIO, open **Back Office → Business profile & features**.
2. In **Backup & recovery**, select **Download export**. Wait for the browser download to finish.
3. Store the `.ndjson` file in a secure location outside the POS computer. Use access-controlled storage and a second location where appropriate.
4. Press **Refresh status**. The latest delivered export should show a date, time, and record count.
5. At least quarterly and before a major deployment, restore or inspect the exported data in an isolated environment. Never test a restore over the production project.
6. Record the result in **Recovery drill record**, including the recovery point, duration, and exact verification notes.

## Organization archive procedure

1. Open **Back Office → Business profile & features → Safe organization lifecycle**.
2. Request the archive and provide the reason.
3. Download a new export after making the request, then wait for it to complete.
4. In **Backup & recovery**, refresh status and confirm the export is current.
5. Select **Archive safely**. TINDIO retains the tenant and its historical records; it does not delete the business.

## Neon business-database recovery

TINDIO's authoritative business database is Neon Postgres. Use an isolated, expiring branch from the required recovery point for investigation and reconciliation. Never rewind the primary/default branch during a drill. Neon branches are copy-on-write isolated database states and can be created from current data or a retained point in time:

- [Neon branching](https://neon.com/docs/introduction/branching)
- [Neon branch restore](https://neon.com/docs/introduction/branch-restore)

Before a production restore:

1. Declare an incident owner and pause normal operations.
2. Record the intended recovery point and estimated data-loss window.
3. Create a non-primary, non-default, expiring recovery branch with a separate endpoint. Prefer read-only compute for verification.
4. Reconcile financial headers and lines, payments, receipts, refunds, shifts, inventory levels and movements, device sequences, checkpoints, and unresolved custody before considering cutover.
5. Record the parent branch, LSN/timestamp, recovery time, recoverable-data window, table fingerprints, relationship checks, and branch expiration.
6. If an actual incident requires cutover, separately approve the production change, pause writes, preserve the original branch, rotate or verify credentials, validate Supabase Auth and all integrations, then run the full TINDIO certification before reopening sales.

## Local development only

The local Supabase stack is for development and local recovery drills, not production cloud-restore certification. Keep the local Docker stack running and use a separate local database for local drills. Never run a destructive reset or restore command against the live business database during a drill.

## Current limitations

- A completed export proves TINDIO finished delivering the export stream; it cannot prove that the browser file is still retained after download. Keep and verify the off-site copy yourself.
- TINDIO does not import an export back into a production tenant automatically. Automated import requires a separately reviewed, conflict-safe recovery workflow.
- The seven-year setting is a product retention floor, not legal advice. Phase 18 will address Philippine localization and compliance architecture separately.
