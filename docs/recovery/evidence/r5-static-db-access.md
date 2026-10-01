# TINDIO R5 Static Database Access Baseline

Branch: `recovery/neon-canonical-rebuild`

HEAD: `4e33995f4f9eb931cdffff352a3af9c819a5b573`

## Totals

```json
{
  "files": 376,
  "files_with_db_calls": 92,
  "from_calls": 167,
  "rpc_calls": 183,
  "db_call_sites": 350,
  "create_client_calls": 132,
  "pos_database_client_calls": 6,
  "supabase_server_imports": 62,
  "direct_supabase_js_imports": 3
}
```

## Domain totals

| Domain | Files with DB calls | .from() | .rpc() | Static DB call sites |
| --- | ---: | ---: | ---: | ---: |
| other | 60 | 121 | 85 | 206 |
| inventory | 12 | 6 | 46 | 52 |
| pos | 10 | 13 | 24 | 37 |
| management | 4 | 12 | 13 | 25 |
| catalog | 3 | 7 | 13 | 20 |
| dashboard | 1 | 6 | 1 | 7 |
| reports | 2 | 2 | 1 | 3 |
| replenishment | 0 | 0 | 0 | 0 |
| database-boundary | 0 | 0 | 0 | 0 |

## Required R5 target files

| File | Domain | .from() | .rpc() | Static DB call sites |
| --- | --- | ---: | ---: | ---: |
| `src/app/(back-office)/back-office/inventory/page.tsx` | inventory | 1 | 10 | 11 |
| `src/app/(back-office)/back-office/replenishment/page.tsx` | replenishment | 0 | 0 | 0 |
| `src/features/management/data.ts` | management | 0 | 3 | 3 |
| `src/features/management/service.ts` | management | 11 | 6 | 17 |
| `src/features/pos/data.ts` | pos | 12 | 10 | 22 |
| `src/features/pos/service.ts` | pos | 0 | 1 | 1 |
| `src/features/catalog/data.ts` | catalog | 0 | 1 | 1 |
| `src/features/catalog/service.ts` | catalog | 7 | 11 | 18 |
| `src/features/dashboard/data.ts` | dashboard | 6 | 1 | 7 |
| `src/features/reports/data.ts` | reports | 1 | 0 | 1 |
| `src/lib/database/env.ts` | database-boundary | 0 | 0 | 0 |
| `src/lib/database/neon-data-api-fetch.ts` | database-boundary | 0 | 0 | 0 |
| `src/lib/supabase/pos-v2-database-client.ts` | database-boundary | 0 | 0 | 0 |

## Highest static DB fan-out files

| File | Domain | DB call sites | .from() | .rpc() |
| --- | --- | ---: | ---: | ---: |
| `src/features/pos/data.ts` | pos | 22 | 12 | 10 |
| `src/features/inventory/advanced-inventory-actions.ts` | inventory | 21 | 0 | 21 |
| `src/features/advanced-sales/service.ts` | other | 18 | 18 | 0 |
| `src/features/catalog/service.ts` | catalog | 18 | 7 | 11 |
| `src/features/management/service.ts` | management | 17 | 11 | 6 |
| `src/features/customers/service.ts` | other | 13 | 4 | 9 |
| `src/features/receipts/detail/data.ts` | other | 13 | 13 | 0 |
| `src/features/customers/data.ts` | other | 12 | 8 | 4 |
| `src/app/(back-office)/back-office/inventory/page.tsx` | inventory | 11 | 1 | 10 |
| `src/lib/auth/dal.ts` | other | 10 | 9 | 1 |
| `src/app/(back-office)/back-office/shifts/page.tsx` | other | 9 | 6 | 3 |
| `src/features/time-clock/data.ts` | other | 8 | 6 | 2 |
| `src/features/dashboard/data.ts` | dashboard | 7 | 6 | 1 |
| `src/features/inventory/supply-chain-actions.ts` | inventory | 7 | 0 | 7 |
| `src/app/(back-office)/back-office/receipts/page.tsx` | other | 6 | 6 | 0 |
| `src/features/advanced-sales/data.ts` | other | 6 | 6 | 0 |
| `src/features/approvals/service.ts` | other | 6 | 1 | 5 |
| `src/features/payments/actions.ts` | other | 6 | 1 | 5 |
| `src/features/smart-menu/data.ts` | other | 6 | 6 | 0 |
| `src/app/(back-office)/back-office/observability/page.tsx` | other | 5 | 5 | 0 |
| `src/app/(back-office)/back-office/offline-sync/page.tsx` | other | 5 | 5 | 0 |
| `src/app/api/pos/v2/sync/pull/route.ts` | pos | 5 | 0 | 5 |
| `src/features/advanced-sales/ticket-service.ts` | other | 5 | 0 | 5 |
| `src/app/(back-office)/back-office/devices/page.tsx` | other | 4 | 4 | 0 |
| `src/features/approvals/data.ts` | other | 4 | 4 | 0 |
| `src/features/checkout/checkout-service.ts` | other | 4 | 1 | 3 |
| `src/features/kitchen/service.ts` | other | 4 | 0 | 4 |
| `src/features/management/actions.ts` | management | 4 | 1 | 3 |
| `src/features/offline/pos-v2-offline-checkout-service.ts` | other | 4 | 0 | 4 |
| `src/app/(back-office)/back-office/payment-methods/page.tsx` | other | 3 | 3 | 0 |
| `src/app/api/organization-export/route.ts` | other | 3 | 0 | 3 |
| `src/features/auth/actions.ts` | other | 3 | 2 | 1 |
| `src/features/devices/actions.ts` | other | 3 | 0 | 3 |
| `src/features/inventory/inventory-stock-view.tsx` | inventory | 3 | 3 | 0 |
| `src/features/kitchen/data.ts` | other | 3 | 1 | 2 |
| `src/features/management/data.ts` | management | 3 | 0 | 3 |
| `src/features/organization-readiness/service.ts` | other | 3 | 1 | 2 |
| `src/features/shifts/service.ts` | other | 3 | 0 | 3 |
| `src/app/api/pos/v2/customers/route.ts` | pos | 2 | 1 | 1 |
| `src/app/api/pos/v2/sync/checkpoint/route.ts` | pos | 2 | 0 | 2 |
| `src/features/inventory/inventory-specialized-data.ts` | inventory | 2 | 0 | 2 |
| `src/features/inventory/pos-transfer-service.ts` | inventory | 2 | 0 | 2 |
| `src/features/receipts/improvement-6-actions.ts` | other | 2 | 0 | 2 |
| `src/features/receipts/service.ts` | other | 2 | 0 | 2 |
| `src/features/reports/reporting.ts` | reports | 2 | 1 | 1 |
| `src/features/time-clock/service.ts` | other | 2 | 0 | 2 |
| `src/lib/auth/pos-v2-catalog.ts` | other | 2 | 0 | 2 |
| `src/app/(back-office)/back-office/categories/page.tsx` | other | 1 | 1 | 0 |
| `src/app/(back-office)/back-office/page.tsx` | other | 1 | 1 | 0 |
| `src/app/(back-office)/back-office/receipt-settings/page.tsx` | other | 1 | 1 | 0 |
| `src/app/(back-office)/back-office/security/page.tsx` | other | 1 | 1 | 0 |
| `src/app/api/customers/export/route.ts` | other | 1 | 1 | 0 |
| `src/app/api/inventory/suppliers/export/route.ts` | inventory | 1 | 1 | 0 |
| `src/app/api/pos/v2/customer-display/route.ts` | pos | 1 | 0 | 1 |
| `src/app/api/pos/v2/device/enroll/route.ts` | pos | 1 | 0 | 1 |
| `src/app/api/pos/v2/device/route.ts` | pos | 1 | 0 | 1 |
| `src/app/api/pos/v2/sync/baseline/route.ts` | pos | 1 | 0 | 1 |
| `src/app/api/pos/v2/sync/telemetry/route.ts` | pos | 1 | 0 | 1 |
| `src/app/customer-display/[token]/page.tsx` | other | 1 | 0 | 1 |
| `src/app/customer-display/[token]/receipt/[saleId]/page.tsx` | other | 1 | 0 | 1 |
| `src/app/join/page.tsx` | other | 1 | 1 | 0 |
| `src/app/loyalty/verify/[cardId]/page.tsx` | other | 1 | 0 | 1 |
| `src/app/menu/[menuId]/page.tsx` | other | 1 | 0 | 1 |
| `src/app/onboarding/page.tsx` | other | 1 | 1 | 0 |
| `src/components/back-office/date-range-picker.tsx` | other | 1 | 1 | 0 |
| `src/features/business-profile/service.ts` | other | 1 | 0 | 1 |
| `src/features/catalog/catalog-read-model.ts` | catalog | 1 | 0 | 1 |
| `src/features/catalog/data.ts` | catalog | 1 | 0 | 1 |
| `src/features/customer-display/service.ts` | other | 1 | 0 | 1 |
| `src/features/customers/customer-csv.ts` | other | 1 | 1 | 0 |
| `src/features/devices/device-manager.tsx` | other | 1 | 1 | 0 |
| `src/features/inventory/inventory-purchasing-data.ts` | inventory | 1 | 0 | 1 |
| `src/features/inventory/inventory-read-model.ts` | inventory | 1 | 0 | 1 |
| `src/features/inventory/inventory-schema-contract.ts` | inventory | 1 | 0 | 1 |
| `src/features/inventory/replenishment-data.ts` | inventory | 1 | 0 | 1 |
| `src/features/inventory/supplier-csv.ts` | inventory | 1 | 1 | 0 |
| `src/features/management/management-read-model.ts` | management | 1 | 0 | 1 |
| `src/features/offline/pos-v2-sync-service.ts` | other | 1 | 0 | 1 |
| `src/features/onboarding/service.ts` | other | 1 | 0 | 1 |
| `src/features/organization-recovery/data.ts` | other | 1 | 0 | 1 |
| `src/features/organization-recovery/service.ts` | other | 1 | 0 | 1 |
| `src/features/pos/service.ts` | pos | 1 | 0 | 1 |
| `src/features/reports/data.ts` | reports | 1 | 1 | 0 |
| `src/features/shifts/actions.ts` | other | 1 | 0 | 1 |
| `src/features/shifts/data.ts` | other | 1 | 0 | 1 |
| `src/features/smart-menu/service.ts` | other | 1 | 0 | 1 |
| `src/lib/auth/identity-provisioning.ts` | other | 1 | 0 | 1 |
| `src/lib/auth/identity.ts` | other | 1 | 0 | 1 |
| `src/lib/auth/pos-v2-context.ts` | other | 1 | 0 | 1 |
| `src/lib/auth/pos-v2-live.ts` | other | 1 | 0 | 1 |
| `src/lib/auth/pos-v2-reference.ts` | other | 1 | 0 | 1 |
| `src/lib/server/back-office-store-scope.ts` | other | 1 | 1 | 0 |
| `src/app/auth/callback/route.ts` | other | 0 | 0 | 0 |
| `src/lib/supabase/client.ts` | database-boundary | 0 | 0 | 0 |
| `src/lib/supabase/context-client.ts` | database-boundary | 0 | 0 | 0 |
| `src/lib/supabase/pos-v2-database-client.ts` | database-boundary | 0 | 0 | 0 |
| `src/lib/supabase/realtime-client.ts` | database-boundary | 0 | 0 | 0 |
| `src/lib/supabase/server.ts` | database-boundary | 0 | 0 | 0 |

## Missing required targets

None.

## Interpretation

This is static source evidence.

It measures source-level database call sites and database-client usage.

It does NOT by itself prove runtime latency, query execution count, DB CPU cost, or production request latency.

Those measurements remain required during later R5 slices and R5 final certification.
