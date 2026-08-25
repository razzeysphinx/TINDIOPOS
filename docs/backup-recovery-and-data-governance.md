# TINDIO backup, recovery, and data-governance procedure

## What Phase 17 protects

TINDIO retains historical business records rather than offering destructive tenant deletion. It records a completed tenant export delivery, enforces a fresh delivered export before an organization can be archived, preserves a minimum seven-year audit and archived-data retention setting, and keeps immutable recovery-drill evidence.

The application does not automatically restore a Supabase project. A platform restore can overwrite a whole project, so it must be performed by an authorized platform administrator during an agreed recovery window.

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

## Supabase platform recovery

For a hosted project, use the authorized Supabase administrator account to review **Database → Backups**. Supabase daily backups and Point-in-Time Recovery depend on the selected hosted plan and configuration. The platform documentation explains restore downtime, clone-based recovery, and the distinction between database metadata and Storage objects:

- [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups)
- [Supabase Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Supabase Restore to a New Project](https://supabase.com/docs/guides/platform/clone-project)

Before a production restore:

1. Declare an incident owner and pause normal operations.
2. Record the intended recovery point and estimated data-loss window.
3. Prefer restoring to a new project or clone for investigation when feasible.
4. Include Storage objects separately: database backups contain Storage metadata but do not restore objects deleted after the backup.
5. Rotate or verify credentials after a physical restore, verify Auth, storage, webhooks, Realtime, and environment settings, then run the TINDIO recovery checks before reopening sales.

## Local development only

The local Supabase stack is for development and recovery drills, not production. Keep the local Docker stack running, and use a separate local database or project for a restore drill. Never run a destructive reset or restore command against the live business database during a drill.

## Current limitations

- A completed export proves TINDIO finished delivering the export stream; it cannot prove that the browser file is still retained after download. Keep and verify the off-site copy yourself.
- TINDIO does not import an export back into a production tenant automatically. Automated import requires a separately reviewed, conflict-safe recovery workflow.
- The seven-year setting is a product retention floor, not legal advice. Phase 18 will address Philippine localization and compliance architecture separately.
