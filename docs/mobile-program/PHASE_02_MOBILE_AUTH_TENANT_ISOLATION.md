# TINDIO Mobile Program â€” Phase 02

## Mobile-Safe Authentication + Tenant/Store Isolation

SOURCE_OF_TRUTH:
`docs/TINDIO_MOBILE_NEON_SOURCE_OF_TRUTH.md`

PHASE:
`02 â€” Mobile-Safe Authentication + Tenant/Store Isolation`

STATUS:
`CERTIFIED`

## Authentication transports

TINDIO POS API supports two authentication transports that resolve into the same server-side BusinessContext.

### Web

```text
Supabase cookie/session
â†’ getBusinessContext()
â†’ stable TINDIO profile
â†’ organization / RBAC / store scope
```

### Mobile/API

```text
Authorization: Bearer <Supabase access token>
â†’ verified Supabase JWT claims
â†’ provider subject
â†’ resolveCurrentProfileId()
â†’ stable TINDIO profile
â†’ organization / RBAC / store scope
```

A Bearer header, when present, is authoritative. An invalid Bearer token never falls back to a valid browser cookie.

## Organization selection

Mobile callers may request an organization with:

```http
X-Tindio-Organization-Id: <organization-uuid>
```

The header is not authorization.

The requested organization must exist in the authenticated TINDIO profile's active employee memberships.

A foreign or malformed organization header fails closed.

## Store isolation

Store scope remains server-derived from:

```text
BusinessContext.storeIds
```

and the existing organization-wide `stores.manage` capability.

Client-supplied Store IDs never grant access.

## Database/RPC authorization propagation

All Phase 01 POS API database and RPC operations use:

```text
createBusinessContextClient(context)
```

For bearer requests this propagates the verified access token to PostgreSQL/RLS/RPC execution.

For web requests existing cookie/session behavior remains unchanged.

Device headers may be added, but cannot replace the authenticated Authorization header.

## Secrets

Production mobile/POS API code never exposes:

```text
service_role
secret API key
database password
Neon credentials
```

The Phase 02 service-role credential is used only by local test fixture creation.

## Provider-neutral identity

Business authorization remains based on:

```text
external provider subject
â†’ private.identity_links
â†’ permanent TINDIO profile ID
```

Business logic does not treat provider `sub` as the permanent TINDIO profile ID.

## Database impact

```text
DATABASE_MIGRATIONS_ADDED: 0
RLS_CHANGES: 0
RBAC_CHANGES: 0
GENERATED_DB_TYPES_CHANGED: NO
```

## Required certification

Phase 02 must prove:

- cookie auth compatibility;
- bearer auth without cookies;
- invalid bearer cannot fall back to cookies;
- cross-tenant requested organization denial;
- malformed organization denial;
- malformed authorization denial;
- assigned-store-only bootstrap;
- unauthorized store operation denial;
- authorized organization list isolation;
- provider-neutral identity checks;
- Phase 01 API contract compatibility;
- complete repository certification.

## Completion record

```text
PHASE_STATUS: CERTIFIED
BASE_BRANCH: TINDIO-PREPRODUCTION
BASE_SHA: 70a5ae7e063cc7402d0a10231a7ffc264511bbeb
PHASE_BRANCH: mobile/phase-02-auth-tenant-isolation
FINAL_SHA: PENDING

COOKIE_AUTH: PASS
BEARER_AUTH: PASS
CREDENTIAL_CONFUSION_TEST: PASS
CROSS_TENANT_DENIAL: PASS
STORE_SCOPE_DENIAL: PASS
PROVIDER_NEUTRAL_IDENTITY: PASS

DATABASE_MIGRATIONS_ADDED: 0
GENERATED_DB_TYPES_CHANGED: NO
SERVICE_ROLE_EXPOSED: NO
```
