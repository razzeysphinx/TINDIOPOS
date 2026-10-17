# Repository Scripts

Scripts are operational interfaces, certification inputs, and historical
recovery tools—not disposable files merely because a package alias does not
reference them.

## Current layout

- `database/` — canonical installer implementation.
- `lib/` — shared script helpers.
- `recovery/` — protected recovery phases and evidence tooling.
- root `mobile-*`, `inventory-*`, `phase-*`, provider, certification, and
  operations scripts — stable paths referenced by the 228-command package
  catalogue, workflows, documentation, phase contracts, and other scripts.

## Naming convention for new scripts

Prefer `<domain>-<behavior>-check.mjs` for deterministic source checks,
`<domain>-<behavior>-certification.mjs` for runtime certification, and
`apply-<domain>-<operation>.mjs` only for explicit state-changing operations.
Put new shared helpers in `lib/` and canonical installer work in `database/`.

Do not mass-move existing root scripts for aesthetics. A move requires a proven
reference graph and atomic updates to package scripts, workflows, phase
contracts, documentation, tests, and script-to-script paths. The singular
`inventory-count-stocktake-check.mjs` and plural
`inventory-counts-stocktake-check.mjs` are not duplicates: one protects earlier
batch/import behavior and the other protects the later canonical lifecycle.
