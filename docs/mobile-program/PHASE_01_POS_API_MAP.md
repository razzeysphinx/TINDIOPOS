# TINDIO Mobile Program — Phase 01 POS API Map

Authentication transport: **CURRENT WEB SESSION ONLY**

Bearer/mobile auth: **DEFERRED TO PHASE 02**

All routes resolve the authoritative server-side `BusinessContext` through `getPosApiBusinessContext(request)`. Client-supplied organization, store, employee, register, and device identifiers remain subject to existing permission, store-assignment, device, RPC, and RLS enforcement.

| Operation | Current Web Adapter | Shared Service/Data Function | HTTP Route | Permissions | Tenant/Store Enforcement | Status |
|---|---|---|---|---|---|---|
| Catalog search | Existing POS fetch | Existing catalog handler and `mapPosCatalogItems()` | `GET /api/pos/v1/catalog` | `pos.access`, `sales.create` | Context organization, assigned store, active shift, scoped RPC | API READY |
| Checkout | `checkoutSaleAction` | `completeCheckout()` | `POST /api/pos/v1/checkout` | Existing checkout permissions | Context organization, store/register/device validation, atomic idempotent RPC | KEEP |
| Customer display | Existing POS fetch | Existing customer-display handler | `PUT /api/pos/v1/customer-display` | `pos.access`, `sales.create` | Context organization and authoritative display RPC | API READY |
| Customer search | Existing POS fetch | Existing customer-search handler | `GET /api/pos/v1/customers` | `pos.access`, `sales.create` | Context organization, assigned store, active shift | API READY |
| Device validation | Existing POS fetch | Existing device handler | `POST /api/pos/v1/device` | `pos.access` | Body organization must match context; authoritative device RPC | API READY |
| Product modifiers | Existing POS fetch | Existing modifier handler | `GET /api/pos/v1/modifiers` | `pos.access`, `sales.create` | Context organization and assigned store | API READY |
| Offline checkout replay | Existing offline sync | `completeCheckout()` | `POST /api/pos/v1/offline-checkout` | Existing checkout permissions | Context organization, device validation, idempotency, atomic RPC | KEEP |
| POS bootstrap | POS page loader | `loadPosWorkspace()`, `getPosCapabilities()` | `GET /api/pos/v1/bootstrap` | `pos.access`, `sales.create` | Context organization and assigned-store workspace queries | API READY |
| Cart stock validation | `validatePosCartStockAction` | `validateCartStock()` | `POST /api/pos/v1/cart/validate-stock` | Existing stock-validation permissions | Context organization and authoritative store/register RPC | API READY |
| Favorite tile | `setPosFavoriteTileAction` | `setPosFavoriteTile()` | `POST /api/pos/v1/favorites` | `products.manage` | Context organization and assigned store | API READY |
| Create customer | `createCustomerAction` | `createCustomer()` | `POST /api/pos/v1/customers/create` | `customers.manage` | Context organization on insert | API READY |
| Open shift | `openShiftAction` | `openShift()` | `POST /api/pos/v1/shifts/open` | `shifts.open` | Context organization plus authoritative store/register/device RPC | EXTRACTED |
| Close shift | `closeShiftAction` | `closeShift()` | `POST /api/pos/v1/shifts/close` | `shifts.close` | Context organization and authoritative shift RPC | EXTRACTED |
| Cash movement | `recordCashMovementAction` | `recordCashMovement()` | `POST /api/pos/v1/shifts/cash-movement` | `cash.pay_in`/`cash.pay_out` or approval | Context organization, approval, idempotent RPC | EXTRACTED |
| Save ticket | `saveOpenTicketAction` | `saveOpenTicket()` | `POST /api/pos/v1/tickets/save` | `pos.access`, `sales.create`, `tickets.manage`; feature enabled | Context organization, assigned store, device RPC | EXTRACTED |
| Cancel ticket | `cancelOpenTicketAction` | `cancelOpenTicket()` | `POST /api/pos/v1/tickets/cancel` | Same ticket permissions | Context organization and device RPC | EXTRACTED |
| Move ticket lines | `moveOpenTicketLinesAction` | `moveOpenTicketLines()` | `POST /api/pos/v1/tickets/move-lines` | Same ticket permissions | Context organization and device RPC | EXTRACTED |
| Split ticket | `splitOpenTicketAction` | `splitOpenTicket()` | `POST /api/pos/v1/tickets/split` | Same ticket permissions | Context organization and device RPC | EXTRACTED |
| Merge tickets | `mergeOpenTicketsAction` | `mergeOpenTickets()` | `POST /api/pos/v1/tickets/merge` | Same ticket permissions | Context organization and device RPC | EXTRACTED |
| Receipt history | POS receipts page | `loadPosReceiptHistory()` | `GET /api/pos/v1/receipts` | `pos.access`, `sales.create`, `receipts.view` | Context organization in authoritative receipt RPC | API READY |
| Receipt detail | `loadPosReceiptQuickViewAction` | `loadPosReceiptDetail()` | `GET /api/pos/v1/receipts/[receiptId]` | `pos.access`, `sales.create`, `receipts.view` | UUID plus context organization in receipt RPC | API READY |
| Refund | `refundSaleAction` | `refundSale()` | `POST /api/pos/v1/receipts/[receiptId]/refund` | `sales.refund` or approval | Receipt resolves authoritative sale in context organization; refund RPC retains idempotency | EXTRACTED |
| Digital receipt delivery | `queueReceiptDeliveryAction` | `queueReceiptDelivery()` | `POST /api/pos/v1/receipts/[receiptId]/delivery` | `receipts.reprint` | Path receipt ID overrides body; context organization RPC | EXTRACTED |
| Attendance employees | `loadAttendanceEmployeesAction` | `loadAttendanceEmployees()` | `GET /api/pos/v1/attendance/employees` | `attendance.use`; feature enabled | Context organization and assigned store | API READY |
| Clock in | `clockInAction` | `clockInEmployee()` | `POST /api/pos/v1/attendance/clock-in` | `attendance.use`; feature enabled | Context organization, assigned store, PIN and request ID RPC | API READY |
| Clock out | `clockOutAction` | `clockOutEmployee()` | `POST /api/pos/v1/attendance/clock-out` | `attendance.use`; feature enabled | Context organization, PIN and request ID RPC | API READY |
| Receive direct transfer | `receiveStockTransferAction` | `receivePosStockTransfer()` | `POST /api/pos/v1/transfers/[transferId]/receive` | `inventory.transfer.receive`; features enabled | Path ID overrides body; context organization and authoritative idempotent RPC | EXTRACTED |
| Receive stock request | `receiveStockRequestAction` | `receivePosStockRequest()` | `POST /api/pos/v1/stock-requests/[stockRequestId]/receive` | `inventory.transfer.receive`; inventory enabled | Path ID overrides body; context organization and authoritative idempotent RPC | EXTRACTED |
| Request approval | `requestManagerApprovalAction` | `requestManagerApproval()` | `POST /api/pos/v1/approvals/request` | Existing approval rule/RPC policy | Context organization and authoritative rule evaluation | EXTRACTED |
| Approval status | `loadManagerApprovalStatusAction` | `loadManagerApprovalStatus()` | `GET /api/pos/v1/approvals/[approvalRequestId]` | Authenticated business context | Context organization filters approval row | EXTRACTED |
| Approve request | `approveManagerApprovalAction` | `approveManagerApproval()` | `POST /api/pos/v1/approvals/[approvalRequestId]/approve` | Existing manager PIN/RPC policy | Path ID overrides body; context organization and manager verification | API READY |
| Mobile bearer authentication | None | Future extension of `getPosApiBusinessContext()` | `/api/pos/v1/*` | To be defined | Provider-neutral identity boundary | DEFERRED TO LATER PHASE |

No database migrations, schema changes, RLS changes, inventory-ledger changes, checkout-engine changes, or offline-queue changes are part of Phase 01.

## Completion record

```text
PHASE_STATUS: CERTIFIED
BASE_BRANCH: TINDIO-PREPRODUCTION
BASE_SHA: 449fac1de8582404c52ebe66feee9292629d8945
PHASE_BRANCH: mobile/phase-01-api-separation
FINAL_SHA: PHASE BRANCH HEAD
CERTIFICATION: PASS
DATABASE_MIGRATIONS_ADDED: 0
WEB_POS_BEHAVIOR_CHANGED: NO
BEARER_AUTH_IMPLEMENTED: NO — PHASE 02
```
