# POS API Routes

`/api/pos/v2/*` is the canonical mobile-safe POS API. It resolves authenticated
business context and enforces tenant, employee, store, register, device, shift,
permission, and transaction-custody boundaries appropriate to each endpoint.

The following unversioned routes are intentional compatibility aliases:

- `/api/pos/checkout` → `/api/pos/v2/checkout`
- `/api/pos/customer-display` → `/api/pos/v2/customer-display`
- `/api/pos/customers` → `/api/pos/v2/customers`
- `/api/pos/device` → `/api/pos/v2/device`
- `/api/pos/offline-checkout` → `/api/pos/v2/offline-checkout`

They are `KEEP_COMPATIBILITY`, not duplicate implementations. Retirement
requires proof that supported clients no longer call them, documentation and
tests have zero references, the compatibility window is explicitly closed, and
MOB-10 A43 evidence permits removal. Until then, preserve their route URLs and
forwarding behavior.
