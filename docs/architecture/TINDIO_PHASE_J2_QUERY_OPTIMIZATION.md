# Phase J2 — evidence-based query optimization

`getVerifiedUser()` and `getBusinessContext()` are independently callable in a
single Server Component render. Previously, each path could resolve the current
profile independently. Business context now reuses the request-scoped,
React-cached verified identity and overlaps that work with cookie-session
resolution.

When both accessors are requested in one render, the maximum current-profile
identity resolution count falls from two to one. A business-context-only render
does not add an identity query. Authorization checks, bearer propagation,
selected columns, tenant scope, and cross-request caching are unchanged.

**Decision:** safe request-local optimization implemented; live latency remains
part of the deferred production evidence campaign.
