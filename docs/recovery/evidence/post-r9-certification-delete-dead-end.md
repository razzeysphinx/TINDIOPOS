# Certification tenant physical-delete dead end

Captured: 2026-10-05  
Classification: historical evidence; never executable cleanup guidance.

The guarded physical-delete dry run for the certification tenant reached
`public.inventory_count_lines` and PostgreSQL rejected the mutation with
`Terminal inventory count lines are immutable.` The single-statement dry run
rolled back. The approved snapshot remained unchanged: all 103 direct
tenant-table counts, the certification organization, the RAZZEY control
organization, and the linked Supabase Auth identity were preserved.

The historical five-file evidence set is retained byte-for-byte under
`docs/recovery/evidence/post-r9/`; its exact-plan files describe the failed
physical-delete path only. It must not be run.

Decision: physical deletion is unsupported for this tenant because its
terminal inventory-count history is intentional audit evidence. The supported
cleanup model is generic organization archival: retain history, remove
operational eligibility, and deny future operational writes.

