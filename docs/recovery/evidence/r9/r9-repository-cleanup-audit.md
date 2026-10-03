# TINDIO R9 Repository Cleanup Audit

Starting recovery head: `761effb81a0784ded8b56adad2d93e1dc72d8193`.

The active canonical replacement is `scripts/database/install-local.mjs` and
`scripts/database/install-neon.mjs`. It validates the baseline manifest, loads
the ordered canonical migrations dynamically, and applies provider adapters in
the required order. The local path is guarded to loopback-only Supabase
Postgres and passed fresh installation, full pgTAP, and database lint before
historical migrations are eligible for archival.

Historical migrations remain immutable evidence. They are to be moved only to
`archive/database/supabase-migrations`, with a SHA-256 manifest, after caller
references are redirected. No business data, production configuration, remote
branch, default branch, or old Neon source is in scope.

The completed R6 installer, R5 local-chain helper, and legacy Phase-04
cutover runner are removal candidates only because the permanent replacement
is now independently certified. Deployed API/browser certifiers remain and
will receive stable aliases instead of being removed.

The R4 handover remains untracked and externally archived by user choice. Its
disposition is unchanged; it must not be staged, modified, or deleted.
