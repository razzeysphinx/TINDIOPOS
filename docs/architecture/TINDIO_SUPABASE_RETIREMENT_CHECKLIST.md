# TINDIO Supabase retirement checklist

Status: **PREPARED — DO NOT DECOMMISSION**

Every checkbox is mandatory and must link dated evidence for the exact
production release/environment. Repository tests cannot substitute for live,
physical, or owner-controlled evidence.

- [ ] All Supabase Auth accounts are migrated or explicitly accounted for.
- [ ] Active Web, Backend, and signed Mobile releases use the approved replacement.
- [ ] No supported client presents or depends on Supabase tokens.
- [ ] All approved Auth lifecycle flows pass in production.
- [ ] Tenant isolation and adversarial authorization pass.
- [ ] Financial replay/reconciliation has no unresolved discrepancy.
- [ ] Offline/device custody no longer depends on legacy Auth.
- [ ] Provider export, external backup, and restore drill are verified.
- [ ] Monitoring/rollback observation window completes without unresolved incident.
- [ ] A named owner signs a separate Supabase decommission approval.

Even after every item passes, project shutdown or deletion is a separately
executed destructive operation. Preserve SQL migrations and audit evidence.
