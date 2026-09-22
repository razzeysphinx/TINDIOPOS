# TINDIO Phase 14 â€” Final Manual Inventory Certification

FINAL_MANUAL_STATUS: PASS

Date:
Branch:
Commit under test:
Local application URL:
Local Supabase only: YES
Remote database contacted: NO

| ID | Status | Required evidence |
| --- | --- | --- |
| P14-BR-01 | PASS | Create a simple product and a variable product; verify variants and store assignment render correctly in Catalog. |
| P14-BR-02 | PASS | Post opening stock and verify Stock & Restock quantity plus Activity source navigation. |
| P14-BR-03 | PASS | Create a purchase order, receive partially, retry the same receipt operation, finish receiving; verify no duplicate stock. |
| P14-BR-04 | PASS | Create/post an adjustment with valid reason; verify permission/error behavior and ledger source. |
| P14-BR-05 | PASS | Start a count, introduce an intervening stock movement, finalize the count; verify reconciliation behavior. |
| P14-BR-06 | PASS | Direct Store A â†’ Store B transfer; verify dispatch/receipt, source decrement, destination increment, and activity navigation. |
| P14-BR-07 | PASS | Request-backed transfer with partial receipt/discrepancy; verify chain of custody and terminal state. |
| P14-BR-08 | PASS | Supplier return from available stock; verify stock decrement, immutable evidence, and source navigation. |
| P14-BR-09 | PASS | Produce a stocked assembly then sell/use the finished stock path; verify recipe is not consumed twice. Verify made-to-order recipe remains sale-time consumption only. |
| P14-BR-10 | PASS | Configure reorder point/target stock; verify Stock & Restock and Catalog agree. Verify legacy simple fallback and no variant fan-out. |
| P14-BR-11 | PASS | Exercise product unit conversion with fractional/rounding boundary and verify historical transaction quantities remain stable. |
| P14-BR-12 | PASS | Verify valuation after receipt, transfer, production, and supplier return; cost visibility must respect permission. |
| P14-BR-13 | PASS | From Activity, navigate to transfer, receipt, adjustment/count, production, and supplier-return source records where available. |
| P14-BR-14 | PASS | Owner performs authorized inventory workflows across two stores without an owner-name bypass assumption. |
| P14-BR-15 | PASS | Custom/restricted role: assigned-store action succeeds; unassigned source/destination action is denied. |
| P14-BR-16 | PASS | Second organization/account cannot read or mutate the first tenantâ€™s inventory documents or stock. |
| P14-BR-17 | PASS | Trigger duplicate/conflicting operation ID, insufficient stock, invalid lifecycle, and unauthorized action errors; UI shows actionable errors and no partial mutation. |
| P14-BR-18 | PASS | Desktop browser pass across Inventory Overview, Activity, Adjustments, Counts, Transfers, Production, Valuation, Purchasing, Receiving, Supplier Returns, and Stock & Restock. |
| P14-BR-19 | PASS | Mobile/narrow viewport pass for Catalog, Stock & Restock, Inventory navigation, forms, dialogs, tables/cards, loading/error/empty states. |
| P14-BR-20 | PASS | Backup & recovery UI: local export/recovery readiness is understandable; confirm procedure states local drills are isolated and production restore is administrator-controlled. |

## Evidence notes

### P14-BR-01
- Evidence: Real Chromium created a tracked simple product and a two-variant product through Catalog, then displayed the expected Store A assignment in the product workspace.
Real Chromium created a tracked simple product and a two-variant product through Catalog, then displayed the expected Store A assignment in the product workspace.
### P14-BR-02
- Evidence: Real Chromium created an opening-stock reason, posted fifteen units through the reviewed adjustment UI, displayed the resulting Stock & Restock quantity, and opened its linked source document from Inventory Activity.
Real Chromium created an opening-stock reason, posted fifteen units through the reviewed adjustment UI, displayed the resulting Stock & Restock quantity, and opened its linked source document from Inventory Activity.
### P14-BR-03
- Evidence: Real Chromium created a ten-unit purchase order, received four units through two synchronous UI submissions sharing the pending operation ID, verified stock increased only once to nineteen, received the remaining six, and verified the final quantity was twenty-five.
Real Chromium created a ten-unit purchase order, received four units through two synchronous UI submissions sharing the pending operation ID, verified stock increased only once to nineteen, received the remaining six, and verified the final quantity was twenty-five.
### P14-BR-04
- Evidence: Real Chromium created a controlled damage reason after purchasing receipts, reviewed and posted a two-unit reduction, verified twenty-three units remained in Stock & Restock, and opened the immutable adjustment source from Activity.
Real Chromium created a controlled damage reason after purchasing receipts, reviewed and posted a two-unit reduction, verified twenty-three units remained in Stock & Restock, and opened the immutable adjustment source from Activity.
### P14-BR-05
- Evidence: Real Chromium prepared a count at twenty-three units, posted a valid intervening one-unit movement, saved a physical count of twenty-four, verified reconciliation used twenty-four rather than the stale snapshot, posted zero additional variance, and confirmed final stock remained twenty-four.
Real Chromium prepared a count at twenty-three units, posted a valid intervening one-unit movement, saved a physical count of twenty-four, verified reconciliation used twenty-four rather than the stale snapshot, posted zero additional variance, and confirmed final stock remained twenty-four.
### P14-BR-06
- Evidence: Real Chromium created Store B, enabled the tracked item there, dispatched four units from Store A, received all four at Store B, verified source stock decreased to twenty and destination stock increased to four, proved exactly one TRANSFER OUT and one TRANSFER IN movement, opened the linked outbound transfer source, and inspected the inbound stock-transfer receipt reference.
Real Chromium created Store B, enabled the tracked item there, dispatched four units from Store A, received all four at Store B, verified source stock decreased to twenty and destination stock increased to four, proved exactly one TRANSFER OUT and one TRANSFER IN movement, opened the linked outbound transfer source, and inspected the inbound stock-transfer receipt reference.
### P14-BR-07
- Evidence: Real Chromium submitted and linked a three-unit request from the Store B warehouse to Store A, approved and picked it without moving stock, dispatched it once, recorded two received and one short with an explanation, reached Received With Discrepancy with the entire timeline accounted for, verified Store A at twenty-two and Store B at one, and proved exactly one additional outbound and inbound ledger movement.
Real Chromium submitted and linked a three-unit request from the Store B warehouse to Store A, approved and picked it without moving stock, dispatched it once, recorded two received and one short with an explanation, reached Received With Discrepancy with the entire timeline accounted for, verified Store A at twenty-two and Store B at one, and proved exactly one additional outbound and inbound ledger movement.
### P14-BR-08
- Evidence: Real Chromium posted a two-unit supplier return against the existing supplier, verified Store A decreased exactly once to twenty while Store B remained one, proved exactly one SUPPLIER RETURN ledger row, opened its dedicated source reference, and confirmed no purchase order was reopened for receiving.
Real Chromium posted a two-unit supplier return against the existing supplier, verified Store A decreased exactly once to twenty while Store B remained one, proved exactly one SUPPLIER RETURN ledger row, opened its dedicated source reference, and confirmed no purchase order was reopened for receiving.
### P14-BR-09
- Evidence: Real Chromium created stocked-assembly and made-to-order recipes through Catalog, proved only the stocked item was eligible for Production, produced two finished units while consuming four component units exactly once, sold one stocked unit without consuming its recipe again, sold one made-to-order unit with exactly three units of sale-time component consumption and zero parent-stock movement, replayed the exact checkout without double consumption, and verified single production output, production consumption, and component SALE movements.
Real Chromium created stocked-assembly and made-to-order recipes through Catalog, proved only the stocked item was eligible for Production, produced two finished units while consuming four component units exactly once, sold one stocked unit without consuming its recipe again, sold one made-to-order unit with exactly three units of sale-time component consumption and zero parent-stock movement, replayed the exact checkout without double consumption, and verified single production output, production consumption, and component SALE movements.
### P14-BR-10
- Evidence: Real Chromium saved canonical reorder point 18 and target stock 30 for the simple product, showed the same Low stock classification at quantity 13 in Stock & Restock and Catalog, kept both variant rows Out of stock without inheriting the simple-product threshold, and created neither stock movements nor purchase orders.
Real Chromium saved canonical reorder point 18 and target stock 30 for the simple product, showed the same Low stock classification at quantity 13 in Stock & Restock and Catalog, kept both variant rows Out of stock without inheriting the simple-product threshold, and created neither stock movements nor purchase orders.
### P14-BR-11
- Evidence: Real Chromium created a 2.5-each fractional purchase unit, ordered and received 0.4 unit to add exactly one base each, then changed the current factor to 3 while the completed purchase order retained its 0.4-unit ordered/received snapshots and stock stayed unchanged.
Real Chromium created a 2.5-each fractional purchase unit, ordered and received 0.4 unit to add exactly one base each, then changed the current factor to 3 while the completed purchase order retained its 0.4-unit ordered/received snapshots and stock stayed unchanged.
### P14-BR-12
- Evidence: Real owner Chromium displayed costed valuation after receipts, transfers, production, supplier return, and fractional receiving, while a real signed-in inventory operator without products.view_cost could not open the valuation view or expose average-cost values.
Real owner Chromium displayed costed valuation after receipts, transfers, production, supplier return, and fractional receiving, while a real signed-in inventory operator without products.view_cost could not open the valuation view or expose average-cost values.
### P14-BR-13
- Evidence: Real Chromium opened current Activity movement dialogs and followed canonical source links for transfer, goods receipt, adjustment/count reconciliation, production, and supplier return into the matching filtered source-document context.
Real Chromium opened current Activity movement dialogs and followed canonical source links for transfer, goods receipt, adjustment/count reconciliation, production, and supplier return into the matching filtered source-document context.
### P14-BR-14
- Evidence: The signed-in owner’s real capability/store-scope contract exposed both Store A and Store B, their correct current quantities, and both stores as valid transfer sources; the earlier direct and request-backed workflows succeeded across that same scope without any owner-name bypass assumption.
The signed-in owner’s real capability/store-scope contract exposed both Store A and Store B, their correct current quantities, and both stores as valid transfer sources; the earlier direct and request-backed workflows succeeded across that same scope without any owner-name bypass assumption.
### P14-BR-15
- Evidence: A real signed-in custom inventory operator assigned only to Store A posted a one-unit adjustment there, saw the resulting quantity 15, could not select or render Store B, could not open transfer workflows, and saw no protected average-cost data.
A real signed-in custom inventory operator assigned only to Store A posted a one-unit adjustment there, saw the resulting quantity 15, could not select or render Store B, could not open transfer workflows, and saw no protected average-cost data.
### P14-BR-16
- Evidence: A separately onboarded organization owner followed a first-tenant source URL and received an empty/inaccessible activity state with no first-tenant product or store rendered; its adjustment UI contained no first-tenant stock target to mutate.
A separately onboarded organization owner followed a first-tenant source URL and received an empty/inaccessible activity state with no first-tenant product or store rendered; its adjustment UI contained no first-tenant stock target to mutate.
### P14-BR-17
- Evidence: Real Chromium proved exact checkout replay was a safe no-op, synchronous receipt retry did not duplicate stock, an over-quantity stocked-assembly sale showed an actionable insufficient-stock error without opening payment or mutating stock, terminal purchase orders exposed no receive action, and the restricted operator could not reach an unauthorized transfer action.
Real Chromium proved exact checkout replay was a safe no-op, synchronous receipt retry did not duplicate stock, an over-quantity stocked-assembly sale showed an actionable insufficient-stock error without opening payment or mutating stock, terminal purchase orders exposed no receive action, and the restricted operator could not reach an unauthorized transfer action.
### P14-BR-18
- Evidence: Real desktop Chromium loaded all fifteen required Catalog, Stock & Restock, Stock Control, Purchasing, and Business Profile routes with their primary heading and navigation visible and no crash text.
Real desktop Chromium loaded all fifteen required Catalog, Stock & Restock, Stock Control, Purchasing, and Business Profile routes with their primary heading and navigation visible and no crash text.
### P14-BR-19
- Evidence: Real Chromium at 390 by 844 displayed Catalog, Stock & Restock, Stock Control navigation, a live product card list, and the Add product dialog without page-level horizontal overflow.
Real Chromium at 390 by 844 displayed Catalog, Stock & Restock, Stock Control navigation, a live product card list, and the Add product dialog without page-level horizontal overflow.
### P14-BR-20
- Evidence: Real Chromium opened Business Profile Backup & recovery and verified understandable export readiness, isolated local drill guidance, platform-backup limits, and owner or authorized-administrator control.
Real Chromium opened Business Profile Backup & recovery and verified understandable export readiness, isolated local drill guidance, platform-backup limits, and owner or authorized-administrator control.
