# Phase J4 — final documentation and independent CI/CD

The independent workflow separates Contracts, Web, Backend, Mobile, and
architecture checks. Each job installs from the locked workspace, uses Node 22
and pnpm 10.34.5, has a bounded timeout, and runs without production secrets or
deployment permissions.

This complements the existing Docker-backed baseline certification; it does
not replace database replay, browser, release-candidate, or production evidence.
No deployment or provider mutation is part of this workflow.

**Decision:** independent CI implemented; production/release certification
remains a separate gate.
