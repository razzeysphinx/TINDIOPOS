# TINDIO Archive

This directory contains historical audit and recovery assets. It is not the
canonical installation path.

`archive/database/supabase-migrations/` and its manifest preserve the former
Supabase business migration chain for recovery comparison, certification, and
forensic integrity. Do not apply these files directly to production, rename or
deduplicate them, or treat them as current Supabase migrations.

Canonical installations use `database/baseline/`, ordered
`database/migrations/`, and the applicable `database/provider/` adapter.
