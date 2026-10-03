import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Phase 13 native cashier parity implementation contract", () => {
  const pos = read("apps/mobile/app/(app)/pos.tsx");
  const receipt = read("apps/mobile/app/(app)/receipt/[receiptId].tsx");
  const tickets = read("apps/mobile/app/(app)/tickets.tsx");
  const shift = read("apps/mobile/app/(app)/shift.tsx");
  const transfers = read("apps/mobile/app/(app)/transfers.tsx");
  const timeClock = read("apps/mobile/app/(app)/time-clock.tsx");
  const api = read("apps/mobile/src/lib/tindio-api.ts");
  const cart = read("apps/mobile/src/features/local-first/local-cart.ts");
  const outbox = read("apps/mobile/src/features/outbox/outbox-types.ts");

  for (const file of [
    "apps/mobile/src/features/cashier/cashier-validation.ts",
    "apps/mobile/src/features/cashier/cashier-editors.tsx",
    "apps/mobile/src/features/cashier/cashier-cart-line.tsx",
    "apps/mobile/app/(app)/customers.tsx",
    "apps/mobile/app/(app)/receipts.tsx",
    "apps/mobile/app/(app)/receipt/[receiptId].tsx",
    "apps/mobile/app/(app)/tickets.tsx",
    "apps/mobile/app/(app)/transfers.tsx",
    "apps/mobile/app/(app)/time-clock.tsx",
  ]) {
    assert.ok(fs.existsSync(file), `${file} must exist`);
  }

  for (const marker of [
    "checkoutPosV2",
    "savePosV2Ticket",
    "searchPosV2Customers",
    "createPosV2Customer",
    "getLocalFirstModifiers",
    "VariablePriceEditor",
    "ModifierPicker",
    "manualPriceMinor",
    "modifierOptionIds",
    "itemNote",
    "customerId: selectedCustomer?.id",
    "openTicketId: activeTicketId",
    "idempotencyKey: checkoutKey",
  ]) {
    assert.ok(pos.includes(marker), `POS must include ${marker}`);
  }

  assert.doesNotMatch(
    pos,
    /idempotencyKey:\s*Crypto\.randomUUID\(\)/,
    "checkout request must not generate a fresh key inside the request",
  );

  assert.ok(
    receipt.includes("saleItemId")
    && receipt.includes("paymentMethodId")
    && receipt.includes("returnToStock")
    && receipt.includes("refundKey"),
    "receipt refund must submit explicit line selections with stable identity",
  );

  assert.doesNotMatch(
    receipt,
    /JSON\.stringify\(detail\)/,
    "receipt detail must be rendered as cashier UI, not raw JSON",
  );

  assert.doesNotMatch(
    receipt,
    /items:\s*\[\s*\]/,
    "refund must not submit an empty item list",
  );

  for (const marker of [
    "sourceTicketId",
    "destinationTicketId",
    "ticketLineId",
    "splitPosV2Ticket",
    "mergePosV2Ticket",
    "movePosV2TicketLines",
  ]) {
    assert.ok(tickets.includes(marker), `ticket workflow must include ${marker}`);
  }

  for (const permission of [
    "shifts.open",
    "shifts.close",
    "cash.pay_in",
    "cash.pay_out",
  ]) {
    assert.ok(shift.includes(permission), `shift UI must gate ${permission}`);
  }

  assert.ok(
    shift.includes("movementType")
    && shift.includes("idempotencyKey"),
    "cash movement must match the canonical schema",
  );

  assert.ok(
    transfers.includes("receivedQuantity")
    && transfers.includes("shortQuantity")
    && transfers.includes("discrepancyNote")
    && transfers.includes("operationId"),
    "transfer receiving must submit canonical line receipt data",
  );

  assert.ok(
    timeClock.includes("fetchPosV2AttendanceEmployees")
    && timeClock.includes("requestId")
    && timeClock.includes("6–12 digit PIN"),
    "time clock must use employee discovery and canonical request identity",
  );

  assert.ok(
    cart.includes("(baseMinor + modifierMinor) * line.quantity"),
    "local cart preview must multiply the complete configured unit price by quantity",
  );

  for (const marker of [
    "createPosV2Customer",
    "fetchPosV2ReceiptDetail",
    "refundPosV2Receipt",
    "recordPosV2CashMovement",
    "splitPosV2Ticket",
    "receivePosV2Transfer",
    "clockInPosV2Employee",
  ]) {
    assert.ok(api.includes(marker), `mobile POS V2 helper must expose ${marker}`);
  }

  assert.equal(
    /export type OutboxOperationType\s*=\s*"SALE_COMPLETED"/.test(outbox),
    true,
    "Phase 13 must not expand the durable outbox operation set",
  );
});
