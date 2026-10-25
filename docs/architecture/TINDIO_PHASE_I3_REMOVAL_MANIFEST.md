# Phase I3 — ordered removal manifest

The removal sequence is Web, Mobile, Backend compatibility, deployment
configuration, then workspace tooling. Each step has a distinct production
precondition and must be independently verified before proceeding.

Historical SQL migrations, archived evidence, architecture decisions, and
certification records are permanent evidence and are not removal targets.
Deleting the hosted Supabase project is excluded from this manifest and always
requires a later, separate owner action.

**Decision:** plan complete; no removal executed.
