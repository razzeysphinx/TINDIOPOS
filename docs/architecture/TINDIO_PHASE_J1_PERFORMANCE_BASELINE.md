# Phase J1 — performance baseline

This slice records a deterministic source baseline for the exact tracked tree:
source volume by runtime, database-query callsites, explicit parallel groups,
and runtime client factories. It is a change-detection baseline, not a claim
about production latency or database plans.

No live database diagnostics, production traffic, or mutating `EXPLAIN ANALYZE`
was run. Those require the approved release candidate, representative workload,
and production authority recorded under J-01.

**Decision:** repository baseline recorded; live performance evidence deferred.
