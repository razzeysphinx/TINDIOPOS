# Phase 01 POS API map

## Current authoritative POS API

The original Phase 01 versioned POS surface has been retired. The authoritative POS API is `/api/pos/v2/*`.

V2 replaced the monolithic bootstrap with independent Core, Reference, Live, Catalog, and Modifiers domains. Required operational and mutation capabilities remain backed by the existing shared service layer; service semantics were not duplicated or changed during the migration.

Supabase Auth remains authoritative for identity. Neon remains authoritative for TINDIO business data. Tenant, organization, RBAC, store, and register scope are validated server-side.

V2 command routes resolve the bearer-authenticated `BusinessContext` through `getPosV2BusinessContext(request)`. V2 read routes use their dedicated V2 loaders. Client-supplied organization, store, employee, register, and device identifiers remain subject to existing permission, store-assignment, device, RPC, and RLS enforcement.

## Current route map

| Capability | Shared service or loader | Current API |
| --- | --- | --- |
| POS Core | `get_pos_bootstrap_core_v2` | `GET /api/pos/v2/bootstrap` |
| POS Reference | V2 reference loader | `GET /api/pos/v2/reference` |
| POS Live | V2 live loader | `GET /api/pos/v2/live` |
| Catalog search | V2 catalog loader | `GET /api/pos/v2/catalog` |
| Product modifiers | V2 modifier loader | `GET /api/pos/v2/modifiers` |
| Cart stock validation | `validateCartStock()` | `POST /api/pos/v2/cart/validate-stock` |
| Checkout | `completeCheckout()` | `POST /api/pos/v2/checkout` |
| Offline checkout replay | `completeCheckout()` | `POST /api/pos/v2/offline-checkout` |
| Customer display | Existing display handler | `PUT /api/pos/v2/customer-display` |
| Customer search/create | Existing customer handler / `createCustomer()` | `GET /api/pos/v2/customers`, `POST /api/pos/v2/customers/create` |
| Device validation | Existing device handler | `POST /api/pos/v2/device` |
| Favorite tile | `setPosFavoriteTile()` | `POST /api/pos/v2/favorites` |
| Shift lifecycle | `openShift()`, `closeShift()`, `recordCashMovement()` | `POST /api/pos/v2/shifts/*` |
| Open tickets | Shared ticket services | `POST /api/pos/v2/tickets/*` |
| Receipt search/detail | Receipt loaders | `GET /api/pos/v2/receipts/*` |
| Refund / delivery | `refundSale()`, `queueReceiptDelivery()` | `POST /api/pos/v2/receipts/[receiptId]/*` |
| Attendance | Time-clock services | `GET/POST /api/pos/v2/attendance/*` |
| Transfer receipt | `receivePosStockTransfer()` | `POST /api/pos/v2/transfers/[transferId]/receive` |
| Stock-request receipt | `receivePosStockRequest()` | `POST /api/pos/v2/stock-requests/[stockRequestId]/receive` |
| Manager approval | Shared approval services | `POST/GET /api/pos/v2/approvals/*` |

## Historical Phase 01 provenance

Phase 01 established the capability inventory above and the rule that all POS operations must use server-validated organization, RBAC, store, register, device, RPC, and RLS boundaries. Its original monolithic bootstrap and version-specific route plumbing are retired; the capability and shared-service provenance remain intact in the V2 map.

The mobile bearer-authentication extension originally deferred to Phase 02 is now implemented by the V2 bearer context. No service-role credential is used in production POS request paths.
