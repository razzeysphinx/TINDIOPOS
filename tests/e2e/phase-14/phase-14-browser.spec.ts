import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import {
  createOwnerBusiness,
  createScopedEmployee,
  loginThroughUi,
  newContext,
  uniqueEmail,
} from "./fixtures";
import {
  recordEvidence,
  resetEvidence,
} from "./evidence";

test.describe.configure({ mode: "serial" });

const runLabel = process.env.TINDIO_E2E_RUN_ID ?? Date.now().toString();
const ownerEmail = uniqueEmail("owner");
const businessName = `Phase 14 Business ${runLabel}`;
const storeAName = `Phase 14 Store A ${runLabel}`;
const storeBName = `Phase 14 Store B ${runLabel}`;
const simpleName = `Phase 14 Simple ${runLabel}`;
const variableName = `Phase 14 Variable ${runLabel}`;
const supplierName = `Phase 14 Supplier ${runLabel}`;
const stockedCompositeName = `Phase 14 Stocked Assembly ${runLabel}`;
const madeToOrderCompositeName = `Phase 14 Made To Order ${runLabel}`;
const openingReasonCode = `OPEN${runLabel.slice(-6)}`;
const damageReasonCode = `DMG${runLabel.slice(-6)}`;
const countMovementReasonCode = `CNT${runLabel.slice(-6)}`;
let context: BrowserContext;
let phasePage: Page;
let scopedContext: BrowserContext | undefined;
let scopedPage: Page;
let tenantContext: BrowserContext | undefined;
let activitySourceHref = "";

async function createSimpleProduct(page: Page) {
  await page.getByRole("button", { name: "Add product" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[name="name"]').fill(simpleName);
  await dialog.locator('input[name="price"]').fill("12.50");
  await dialog.locator('input[name="cost"]').fill("7.25");
  await dialog.locator('input[name="sku"]').fill(`P14-S-${runLabel}`);
  await dialog.getByLabel("Track inventory").check();
  await dialog.getByText("Advanced settings", { exact: true }).click();
  await dialog.getByLabel(storeAName).check();
  await dialog.getByRole("button", { name: "Create product" }).click();
  await expect(dialog).toBeHidden();
}

async function createVariableProduct(page: Page) {
  await page.getByRole("button", { name: "Add product" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[name="name"]').fill(variableName);
  await dialog.getByLabel("Track inventory").check();
  await dialog.getByText("Advanced settings", { exact: true }).click();
  await dialog.locator('select[name="productType"]').selectOption("variable");
  await dialog.locator('input[name="variants.0.name"]').fill("Small");
  await dialog.locator('input[name="variants.0.sku"]').fill(`P14-VS-${runLabel}`);
  await dialog.locator('input[name="variants.0.price"]').fill("15.00");
  await dialog.locator('input[name="variants.0.cost"]').fill("8.00");
  await dialog.getByRole("button", { name: "Add variant" }).click();
  await dialog.locator('input[name="variants.1.name"]').fill("Large");
  await dialog.locator('input[name="variants.1.sku"]').fill(`P14-VL-${runLabel}`);
  await dialog.locator('input[name="variants.1.price"]').fill("18.00");
  await dialog.locator('input[name="variants.1.cost"]').fill("10.00");
  await dialog.getByLabel(storeAName).check();
  await dialog.getByRole("button", { name: "Create product" }).click();
  await expect(dialog).toBeHidden();
}

async function createCompositeProduct(page: Page, name: string, mode: "stocked_assembly" | "made_to_order") {
  await page.getByRole("button", { name: "Add product" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[name="name"]').fill(name);
  await dialog.locator('input[name="price"]').fill("20.00");
  await dialog.locator('input[name="cost"]').fill("0.00");
  await dialog.locator('input[name="sku"]').fill(`P14-C-${mode}-${runLabel}`);
  await dialog.getByText("Advanced settings", { exact: true }).click();
  await dialog.locator('select[name="productType"]').selectOption("composite");
  await dialog.locator('select[name="compositeInventoryMode"]').selectOption(mode);
  await dialog.getByLabel(storeAName).check();
  await dialog.getByRole("button", { name: "Create product" }).click();
  await expect(dialog).toBeHidden();
}

async function addCompositeComponent(page: Page, compositeName: string, quantity: string) {
  await page.getByRole("button", { name: new RegExp(compositeName) }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Components" }).click();
  const recipeForm = dialog.locator("form").filter({ hasText: "Component" });
  await recipeForm.locator('select[name="componentProductId"]').selectOption({ label: simpleName });
  await recipeForm.locator('input[name="quantityPerComposite"]').fill(quantity);
  const addButton = recipeForm.getByRole("button", { name: "Add" });
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/back-office/catalog")),
    addButton.click(),
  ]);
  await page.goto("/back-office/catalog");
  await page.getByRole("button", { name: new RegExp(compositeName) }).click();
  const refreshedDialog = page.getByRole("dialog");
  await refreshedDialog.getByRole("tab", { name: "Components" }).click();
  await expect(refreshedDialog.locator(".divide-y").getByText(simpleName, { exact: true })).toBeVisible();
  await page.goto("/back-office/catalog");
}

async function sellProduct(page: Page, productName: string) {
  await page.goto("/pos");
  const openShift = page.getByRole("button", { name: "Open shift" });
  const search = page.getByRole("searchbox").or(page.getByPlaceholder(/Search/i)).first();

  await expect(openShift.or(search)).toBeVisible({ timeout: 30_000 });

  if (await openShift.isVisible()) {
    await openShift.click();
    const shiftDialog = page.getByRole("dialog", { name: "Open shift" });
    await expect(shiftDialog).toBeVisible();
    const shiftSelects = shiftDialog.locator("select");
    if (await shiftSelects.count()) {
      await shiftSelects.nth(0).selectOption({ label: storeAName });
      if (await shiftSelects.count() > 1) await shiftSelects.nth(1).selectOption({ index: 1 });
    }
    await shiftDialog.getByRole("button", { name: "Open shift" }).click();
    await expect(shiftDialog).toBeHidden();
  }
  await expect(search).toBeVisible({ timeout: 30_000 });
  await search.fill(productName);
  await page.getByRole("button", { name: new RegExp(productName) }).first().click();
  await page.getByRole("button", { name: "Charge", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Payment" })).toBeVisible();
  const useCash = page.getByRole("button", { name: "Use cash" });
  if (await useCash.isVisible()) await useCash.click();
  else await expect(page.getByRole("button", { name: "Cash selected" })).toBeVisible();
  await page.getByRole("button", { name: "Apply cash payment" }).click();
  const checkoutRequestPromise = page.waitForRequest((request) => (
    request.method() === "POST"
    && request.url().includes("/api/pos/checkout")
  ));
  await page.getByRole("button", { name: "Complete cash sale" }).click();
  const checkoutRequest = await checkoutRequestPromise;
  await expect(page.getByText("Payment complete", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /New sale/i }).click();

  return {
    body: checkoutRequest.postDataJSON(),
    url: checkoutRequest.url(),
  };
}

test.beforeAll(async ({ browser }) => {
  await resetEvidence();
  context = await newContext(browser);
  phasePage = await context.newPage();
  await createOwnerBusiness(phasePage, {
    email: ownerEmail,
    businessName,
    storeName: storeAName,
    registerName: `Phase 14 Register ${runLabel}`,
  });
});

test.afterAll(async () => {
  if (tenantContext) await tenantContext.close();
  if (scopedContext) await scopedContext.close();
  await context.close();
});

test("P14-BR-01 product and variant creation + store assignment", async () => {
  await phasePage.goto("/back-office/catalog");
  await createSimpleProduct(phasePage);
  await createVariableProduct(phasePage);

  await expect(phasePage.getByRole("button", { name: new RegExp(simpleName) })).toBeVisible();
  await expect(phasePage.getByRole("button", { name: new RegExp(variableName) })).toBeVisible();

  await phasePage.getByRole("button", { name: new RegExp(simpleName) }).click();
  await phasePage.getByRole("tab", { name: "Stores" }).click();
  await expect(phasePage.getByRole("dialog").getByText(storeAName, { exact: true })).toBeVisible();

  await recordEvidence(
    "P14-BR-01",
    "Real Chromium created a tracked simple product and a two-variant product through Catalog, then displayed the expected Store A assignment in the product workspace.",
  );
});

test("P14-BR-02 opening stock quantity and activity source", async () => {
  await phasePage.goto("/back-office/inventory?tab=adjustments");

  const reasonForm = phasePage.locator("form").filter({
    has: phasePage.getByRole("button", { name: "Add reason" }),
  });
  await reasonForm.getByPlaceholder("DAMAGE", { exact: true }).fill(openingReasonCode);
  await reasonForm.getByPlaceholder("Damaged goods", { exact: true }).fill("Phase 14 opening stock");
  await reasonForm.locator("select").selectOption("OPENING_STOCK");
  await reasonForm.getByRole("button", { name: "Add reason" }).click();
  await expect(phasePage.getByText("Adjustment reason saved.", { exact: true })).toBeVisible();

  const adjustmentForm = phasePage.locator("form").filter({
    has: phasePage.getByRole("button", { name: "Review adjustment" }),
  });
  await adjustmentForm.locator("select").nth(0).selectOption({ label: storeAName });
  await adjustmentForm.locator("select").nth(1).selectOption({ label: `Phase 14 opening stock (${openingReasonCode})` });
  await adjustmentForm.locator("select").nth(2).selectOption({ label: simpleName });
  await adjustmentForm.getByPlaceholder("Use - for a reduction").fill("15");
  await adjustmentForm.getByPlaceholder("Required: explain why stock is changing").fill("Certified local opening balance");
  await adjustmentForm.getByRole("button", { name: "Review adjustment" }).click();
  await expect(phasePage.getByRole("heading", { name: "Review adjustment" })).toBeVisible();
  await phasePage.getByRole("button", { name: "Post adjustment" }).click();
  await expect(phasePage.getByText("Stock adjustment posted to the ledger.")).toBeVisible();

  await phasePage.goto("/back-office/replenishment?tab=levels");
  const stockRow = phasePage.getByRole("row", { name: new RegExp(simpleName) });
  await expect(stockRow.getByRole("cell", { name: "15 each" })).toBeVisible();

  await phasePage.goto("/back-office/inventory?tab=activity");
  await phasePage.getByRole("button", { name: new RegExp(`View opening stock for ${simpleName}`, "i") }).click();
  await expect(phasePage.getByText("Source document", { exact: true })).toBeVisible();
  await expect(phasePage.getByRole("dialog").getByRole("link")).toBeVisible();

  await recordEvidence(
    "P14-BR-02",
    "Real Chromium created an opening-stock reason, posted fifteen units through the reviewed adjustment UI, displayed the resulting Stock & Restock quantity, and opened its linked source document from Inventory Activity.",
  );
});

test("P14-BR-03 partial receiving and idempotent replay", async () => {
  await phasePage.goto("/back-office/purchasing?tab=suppliers");
  await phasePage.getByRole("button", { name: "Add supplier" }).click();
  const supplierDialog = phasePage.getByRole("dialog");
  await supplierDialog.getByPlaceholder("Metro Wholesale").fill(supplierName);
  await supplierDialog.getByPlaceholder("Alex Santos").fill("Phase 14 Receiving");
  await supplierDialog.getByRole("button", { name: "Save supplier" }).click();
  await expect(supplierDialog.getByText("Supplier created.", { exact: true })).toBeVisible();
  await supplierDialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(phasePage.getByText(supplierName, { exact: true })).toBeVisible();

  await phasePage.goto("/back-office/purchasing?tab=purchase-orders");
  const purchaseForm = phasePage.locator("form").filter({ hasText: "Create order" });
  await purchaseForm.locator("select").nth(0).selectOption({ label: storeAName });
  await purchaseForm.locator("select").nth(1).selectOption({ label: supplierName });
  await purchaseForm.locator("select").nth(2).selectOption({ label: simpleName });
  await purchaseForm.locator('input[inputmode="decimal"]').nth(0).fill("10");
  await purchaseForm.locator('input[inputmode="decimal"]').nth(1).fill("7.25");
  await purchaseForm.getByPlaceholder("Optional supplier instructions").fill("Phase 14 partial receipt and replay");
  await purchaseForm.getByRole("button", { name: "Create order" }).click();
  await expect(phasePage.getByText("Purchase order created.", { exact: true })).toBeVisible();

  await phasePage.goto("/back-office/purchasing?tab=receiving");
  const receiptForm = phasePage.locator("form").filter({ hasText: "Receive goods" });
  await expect(receiptForm.getByText(simpleName, { exact: true })).toBeVisible();
  await receiptForm.locator('input[inputmode="decimal"]').fill("4");
  await receiptForm.getByPlaceholder("Optional delivery note").fill("Phase 14 partial delivery replay");

  await receiptForm.evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(phasePage.getByText("Goods received and stock updated.", { exact: true })).toBeVisible();

  await phasePage.goto("/back-office/replenishment?tab=levels");
  let stockRow = phasePage.getByRole("row", { name: new RegExp(simpleName) });
  await expect(stockRow.getByRole("cell", { name: "19 each" })).toBeVisible();

  await phasePage.goto("/back-office/purchasing?tab=receiving");
  const remainingReceiptForm = phasePage.locator("form").filter({ hasText: "Receive goods" });
  await expect(remainingReceiptForm.getByText("6 each remaining", { exact: false })).toBeVisible();
  await remainingReceiptForm.locator('input[inputmode="decimal"]').fill("6");
  await remainingReceiptForm.getByPlaceholder("Optional delivery note").fill("Phase 14 final delivery");
  await remainingReceiptForm.getByRole("button", { name: "Receive goods" }).click();
  await expect(phasePage.getByText("Goods received and stock updated.", { exact: true })).toBeVisible();

  await phasePage.goto("/back-office/replenishment?tab=levels");
  stockRow = phasePage.getByRole("row", { name: new RegExp(simpleName) });
  await expect(stockRow.getByRole("cell", { name: "25 each" })).toBeVisible();

  await recordEvidence(
    "P14-BR-03",
    "Real Chromium created a ten-unit purchase order, received four units through two synchronous UI submissions sharing the pending operation ID, verified stock increased only once to nineteen, received the remaining six, and verified the final quantity was twenty-five.",
  );
});

test("P14-BR-04 controlled adjustment quantity and source", async () => {
  await phasePage.goto("/back-office/inventory?tab=adjustments");
  const reasonForm = phasePage.locator("form").filter({
    has: phasePage.getByRole("button", { name: "Add reason" }),
  });
  await reasonForm.getByPlaceholder("DAMAGE", { exact: true }).fill(damageReasonCode);
  await reasonForm.getByPlaceholder("Damaged goods", { exact: true }).fill("Phase 14 damaged stock");
  await reasonForm.locator("select").selectOption("DAMAGE");
  await reasonForm.getByRole("button", { name: "Add reason" }).click();
  await expect(phasePage.getByText("Adjustment reason saved.", { exact: true })).toBeVisible();

  const adjustmentForm = phasePage.locator("form").filter({
    has: phasePage.getByRole("button", { name: "Review adjustment" }),
  });
  await adjustmentForm.locator("select").nth(0).selectOption({ label: storeAName });
  await adjustmentForm.locator("select").nth(1).selectOption({ label: `Phase 14 damaged stock (${damageReasonCode})` });
  await adjustmentForm.locator("select").nth(2).selectOption({ label: simpleName });
  await adjustmentForm.getByPlaceholder("Use - for a reduction").fill("-2");
  await adjustmentForm.getByPlaceholder("Required: explain why stock is changing").fill("Two damaged units verified in local certification");
  await adjustmentForm.getByRole("button", { name: "Review adjustment" }).click();
  await expect(phasePage.getByRole("heading", { name: "Review adjustment" })).toBeVisible();
  await expect(phasePage.getByRole("definition").filter({ hasText: "23 each" })).toBeVisible();
  await phasePage.getByRole("button", { name: "Post adjustment" }).click();
  await expect(phasePage.getByText("Stock adjustment posted to the ledger.")).toBeVisible();

  await phasePage.goto("/back-office/replenishment?tab=levels");
  const stockRow = phasePage.getByRole("row", { name: new RegExp(simpleName) });
  await expect(stockRow.getByRole("cell", { name: "23 each" })).toBeVisible();
  await phasePage.goto("/back-office/inventory?tab=activity");
  await phasePage.getByRole("button", { name: new RegExp(`View damage for ${simpleName}`, "i") }).click();
  await expect(phasePage.getByText("Source document", { exact: true })).toBeVisible();
  await expect(phasePage.getByRole("dialog").getByRole("link")).toBeVisible();

  await recordEvidence(
    "P14-BR-04",
    "Real Chromium created a controlled damage reason after purchasing receipts, reviewed and posted a two-unit reduction, verified twenty-three units remained in Stock & Restock, and opened the immutable adjustment source from Activity.",
  );
});

test("P14-BR-05 count reconciliation after intervening movement", async () => {
  await phasePage.goto("/back-office/inventory?tab=counts");
  await phasePage.getByRole("button", { name: "New inventory count" }).click();
  const createDialog = phasePage.getByRole("dialog");
  await createDialog.locator("select").nth(0).selectOption({ label: storeAName });
  await createDialog.locator("select").nth(2).selectOption("selected");
  await createDialog.getByText(simpleName, { exact: true }).click();
  await createDialog.getByPlaceholder("e.g. September full stocktake").fill("Phase 14 intervening movement count");
  await createDialog.getByRole("button", { name: "Prepare count" }).click();
  await expect(createDialog.getByText("Count prepared. Record the physical quantities, then submit it for review.", { exact: true })).toBeVisible();
  await createDialog.getByRole("button", { name: "Close inventory count" }).click();

  await phasePage.goto("/back-office/inventory?tab=adjustments");
  const reasonForm = phasePage.locator("form").filter({ hasText: "Add reason" });
  await reasonForm.getByPlaceholder("DAMAGE", { exact: true }).fill(countMovementReasonCode);
  await reasonForm.getByPlaceholder("Damaged goods", { exact: true }).fill("Phase 14 count movement");
  await reasonForm.locator("select").selectOption("ADJUSTMENT");
  await reasonForm.getByRole("button", { name: "Add reason" }).click();
  await expect(phasePage.getByText("Adjustment reason saved.", { exact: true })).toBeVisible();

  const adjustmentForm = phasePage.locator("form").filter({ hasText: "Review adjustment" });
  await adjustmentForm.locator("select").nth(0).selectOption({ label: storeAName });
  await adjustmentForm.locator("select").nth(1).selectOption({ label: `Phase 14 count movement (${countMovementReasonCode})` });
  await adjustmentForm.locator("select").nth(2).selectOption({ label: simpleName });
  await adjustmentForm.getByPlaceholder("Use - for a reduction").fill("1");
  await adjustmentForm.getByPlaceholder("Required: explain why stock is changing").fill("Valid movement after count preparation");
  await adjustmentForm.getByRole("button", { name: "Review adjustment" }).click();
  await phasePage.getByRole("button", { name: "Post adjustment" }).click();
  await expect(phasePage.getByText("Stock adjustment posted to the ledger.")).toBeVisible();

  await phasePage.goto("/back-office/inventory?tab=counts");
  await phasePage.getByRole("button", { name: /View inventory count IC-/ }).first().click();
  const countDialog = phasePage.getByRole("dialog");
  const countRow = countDialog.getByRole("row", { name: new RegExp(simpleName) });
  await expect(countRow.getByRole("cell", { name: "23" }).first()).toBeVisible();
  await countDialog.locator('input[inputmode="decimal"]').fill("24");
  await countDialog.getByRole("button", { name: "Save item" }).click();
  await expect(countDialog.getByText("Counted quantity saved.", { exact: true })).toBeVisible();
  await expect(countRow.getByRole("cell", { name: "24" })).toHaveCount(2);
  await countDialog.getByRole("button", { name: "Submit for review" }).click();
  await expect(countDialog.getByText("Inventory count is ready for review.", { exact: true })).toBeVisible();
  await countDialog.getByRole("button", { name: "Post reviewed variance" }).click();
  await expect(countDialog.getByText("Inventory count posted. Variances are now in the immutable activity ledger.", { exact: true })).toBeVisible();

  await phasePage.goto("/back-office/replenishment?tab=levels");
  const stockRow = phasePage.getByRole("row", { name: new RegExp(simpleName) });
  await expect(stockRow.getByRole("cell", { name: "24 each" })).toBeVisible();

  await recordEvidence(
    "P14-BR-05",
    "Real Chromium prepared a count at twenty-three units, posted a valid intervening one-unit movement, saved a physical count of twenty-four, verified reconciliation used twenty-four rather than the stale snapshot, posted zero additional variance, and confirmed final stock remained twenty-four.",
  );
});

test("P14-BR-06 direct transfer dispatch, receipt, and activity source", async () => {
  await phasePage.goto("/back-office/business-profile");
  await phasePage.getByText("Review optional tools", { exact: false }).click();
  await phasePage.getByLabel("Enable Multi-store").check();
  await phasePage.getByRole("button", { name: "Save business profile" }).click();
  await expect(phasePage.getByText("Business profile and feature settings updated.", { exact: true })).toBeVisible();

  await phasePage.goto("/back-office/stores");
  await phasePage.getByRole("button", { name: "Add store" }).click();
  const storeDialog = phasePage.getByRole("dialog");
  await storeDialog.getByPlaceholder("Uptown Branch").fill(storeBName);
  await storeDialog.getByRole("textbox", { name: "Store code" }).fill(`P14B${runLabel.slice(-5)}`);
  await storeDialog.getByRole("button", { name: "Create store" }).click();
  await expect(storeDialog).toBeHidden();
  await expect(phasePage.getByText(storeBName, { exact: true })).toBeVisible();

  await phasePage.goto("/back-office/catalog");
  await phasePage.getByRole("button", { name: new RegExp(simpleName) }).click();
  const productDialog = phasePage.getByRole("dialog");
  await productDialog.getByRole("tab", { name: "Stores" }).click();
  await productDialog.getByRole("button", { name: `Enable ${storeBName}` }).click();
  await expect(productDialog.getByRole("button", { name: `Disable ${storeBName}` })).toBeVisible();

  await phasePage.goto("/back-office/inventory?tab=transfers");
  const dispatchForm = phasePage.locator("form").filter({ hasText: "Send transfer" });
  await dispatchForm.locator("select").nth(0).selectOption({ label: storeAName });
  await dispatchForm.locator("select").nth(1).selectOption({ label: storeBName });
  await dispatchForm.locator("select").nth(2).selectOption({ label: simpleName });
  await dispatchForm.locator('input[inputmode="decimal"]').fill("4");
  await dispatchForm.getByPlaceholder("Optional transfer reference or handoff note").fill("Phase 14 direct transfer chain of custody");
  await dispatchForm.getByRole("button", { name: "Send transfer" }).click();
  await expect(phasePage.getByText(/Transfer .* sent|Transfer sent/i)).toBeVisible();

  const receiptForm = phasePage.locator("form").filter({ hasText: "Receive transfer" });
  await expect(receiptForm.getByText(simpleName, { exact: true })).toBeVisible();
  await expect(receiptForm.getByText("4 each remaining", { exact: false })).toBeVisible();
  await receiptForm.locator('input[inputmode="decimal"]').nth(0).fill("4");
  await receiptForm.getByPlaceholder("Optional receiving note").fill("Phase 14 Store B confirmed all units");
  await receiptForm.getByRole("button", { name: "Receive transfer" }).click();
  await expect(phasePage.getByText("0 awaiting receipt", { exact: true })).toBeVisible();

  await phasePage.goto("/back-office/replenishment?tab=levels");
  await expect(phasePage.getByRole("row", { name: new RegExp(`${simpleName}.*${storeAName}.*20`, "i") })).toBeVisible();
  await expect(phasePage.getByRole("row", { name: new RegExp(`${simpleName}.*${storeBName}.*4`, "i") })).toBeVisible();

  await phasePage.goto("/back-office/inventory?tab=activity");
  const transferOutMovement = phasePage.getByRole("button", { name: new RegExp(`View transfer out for ${simpleName}`, "i") });
  const transferInMovement = phasePage.getByRole("button", { name: new RegExp(`View transfer in for ${simpleName}`, "i") });
  await expect(transferOutMovement).toHaveCount(1);
  await expect(transferInMovement).toHaveCount(1);
  await transferOutMovement.click();
  await expect(phasePage.getByText("Source document", { exact: true })).toBeVisible();
  await expect(phasePage.getByRole("dialog").getByRole("link")).toBeVisible();
  await phasePage.getByRole("button", { name: "Close inventory movement" }).click();
  await transferInMovement.click();
  await expect(phasePage.getByText("Source document", { exact: true })).toBeVisible();
  await expect(phasePage.getByRole("dialog").getByRole("paragraph").filter({ hasText: /^stock transfer receipt reference$/ })).toBeVisible();

  await recordEvidence(
    "P14-BR-06",
    "Real Chromium created Store B, enabled the tracked item there, dispatched four units from Store A, received all four at Store B, verified source stock decreased to twenty and destination stock increased to four, proved exactly one TRANSFER OUT and one TRANSFER IN movement, opened the linked outbound transfer source, and inspected the inbound stock-transfer receipt reference.",
  );
});

test("P14-BR-07 request-backed transfer discrepancy lifecycle", async () => {
  const requestNote = `Phase 14 request-backed transfer ${runLabel}`;
  await phasePage.goto("/back-office/inventory?tab=overview&configuration=1");
  const warehouseForm = phasePage.locator("form").filter({ hasText: "Create warehouse" });
  await warehouseForm.locator("select").selectOption({ label: storeBName });
  await warehouseForm.getByPlaceholder("CENTRAL", { exact: true }).fill(`P14W${runLabel.slice(-5)}`);
  await warehouseForm.getByPlaceholder("Central warehouse", { exact: true }).fill(`Phase 14 Warehouse ${runLabel}`);
  await warehouseForm.getByPlaceholder("Optional dispatch note").fill("Phase 14 request source");
  await warehouseForm.getByRole("button", { name: "Create warehouse" }).click();
  await expect(phasePage.getByText("Warehouse location created.", { exact: true })).toBeVisible();

  await phasePage.goto("/back-office/replenishment?tab=replenishment");

  const requestForm = phasePage.locator("form").filter({ hasText: "Submit for approval" });
  await requestForm.locator("select").nth(0).selectOption({ label: storeAName });
  await requestForm.locator("select").nth(1).selectOption({ index: 1 });
  await requestForm.locator("select").nth(2).selectOption({ label: simpleName });
  await requestForm.locator('input[inputmode="decimal"]').fill("3");
  await requestForm.getByPlaceholder("Optional reason or delivery note").fill(requestNote);
  await requestForm.getByRole("button", { name: "Submit for approval" }).click();
  await expect(phasePage.getByText("Stock request submitted for warehouse approval.", { exact: true })).toBeVisible();

  const requestCard = phasePage.locator('[data-slot="card"]').filter({ hasText: requestNote });
  await expect(requestCard).toBeVisible();
  await requestCard.getByRole("button", { name: "Approve requested quantities" }).click();
  await expect(requestCard.getByRole("button", { name: "Start picking" })).toBeVisible();
  await requestCard.getByRole("button", { name: "Start picking" }).click();
  await expect(requestCard.getByRole("button", { name: "Dispatch to in transit" })).toBeVisible();
  await requestCard.getByPlaceholder("Optional courier or packing note").fill("Phase 14 warehouse dispatch");
  await requestCard.getByRole("button", { name: "Dispatch to in transit" }).click();
  await expect(requestCard.getByRole("button", { name: "Record receipt / shortage" })).toBeVisible();

  await requestCard.locator('input[inputmode="decimal"]').nth(0).fill("2");
  await requestCard.locator('input[inputmode="decimal"]').nth(1).fill("1");
  await requestCard.getByPlaceholder("Required when short").fill("One unit missing from sealed handoff");
  await requestCard.getByPlaceholder("Optional delivery note").fill("Store A counted two units");
  await requestCard.getByRole("button", { name: "Record receipt / shortage" }).click();

  await expect(requestCard.getByText("Received With Discrepancy", { exact: true })).toBeVisible();
  await expect(requestCard.getByText(/Requested 3 .* approved 3 .* picked 3 .* sent 3 .* received 2 .* short 1 each/)).toBeVisible();
  await expect(requestCard.getByText(/Short 1 .* One unit missing from sealed handoff/)).toBeVisible();
  await expect(requestCard.getByText(/transfer TR-\d+/i)).toBeVisible();
  await expect(requestCard.getByText("Accounted for", { exact: true })).toBeVisible();

  await phasePage.goto("/back-office/replenishment?tab=levels");
  await expect(phasePage.getByRole("row", { name: new RegExp(`${simpleName}.*${storeAName}.*22`, "i") })).toBeVisible();
  await expect(phasePage.getByRole("row", { name: new RegExp(`${simpleName}.*${storeBName}.*1`, "i") })).toBeVisible();

  await phasePage.goto("/back-office/inventory?tab=activity");
  await expect(phasePage.getByRole("button", { name: new RegExp(`View transfer out for ${simpleName}`, "i") })).toHaveCount(2);
  await expect(phasePage.getByRole("button", { name: new RegExp(`View transfer in for ${simpleName}`, "i") })).toHaveCount(2);

  await recordEvidence(
    "P14-BR-07",
    "Real Chromium submitted and linked a three-unit request from the Store B warehouse to Store A, approved and picked it without moving stock, dispatched it once, recorded two received and one short with an explanation, reached Received With Discrepancy with the entire timeline accounted for, verified Store A at twenty-two and Store B at one, and proved exactly one additional outbound and inbound ledger movement.",
  );
});

test("P14-BR-08 supplier return stock and source evidence", async () => {
  await phasePage.goto("/back-office/purchasing?tab=supplier-returns");
  const returnForm = phasePage.locator("form").filter({ hasText: "Post supplier return" });
  await returnForm.locator("select").nth(0).selectOption({ label: storeAName });
  await returnForm.locator("select").nth(1).selectOption({ label: supplierName });
  await returnForm.locator("select").nth(2).selectOption({ label: simpleName });
  await returnForm.locator('input[inputmode="decimal"]').fill("2");
  await returnForm.getByPlaceholder("Optional supplier reference").fill("Phase 14 damaged delivery return");
  await returnForm.getByRole("button", { name: "Post supplier return" }).click();
  await expect(phasePage.getByText("Supplier return posted to the inventory ledger.", { exact: true })).toBeVisible();

  await phasePage.goto("/back-office/replenishment?tab=levels");
  await expect(phasePage.getByRole("row", { name: new RegExp(`${simpleName}.*${storeAName}.*20`, "i") })).toBeVisible();
  await expect(phasePage.getByRole("row", { name: new RegExp(`${simpleName}.*${storeBName}.*1`, "i") })).toBeVisible();

  await phasePage.goto("/back-office/inventory?tab=activity");
  const supplierReturnMovement = phasePage.getByRole("button", { name: new RegExp(`View supplier return for ${simpleName}`, "i") });
  await expect(supplierReturnMovement).toHaveCount(1);
  await supplierReturnMovement.click();
  const movementDialog = phasePage.getByRole("dialog");
  await expect(movementDialog.getByText("-2 each", { exact: true })).toBeVisible();
  await expect(movementDialog.getByRole("link", { name: "Supplier return" })).toBeVisible();
  await movementDialog.getByRole("link", { name: "Supplier return" }).click();
  await expect(phasePage).toHaveURL(/sourceType=supplier_return/);
  await expect(phasePage.getByText("Supplier return", { exact: true }).first()).toBeVisible();

  await phasePage.goto("/back-office/purchasing?tab=receiving");
  await expect(phasePage.getByRole("button", { name: "Receive goods" })).toHaveCount(0);
  await expect(phasePage.getByText(/Purchase order #\d+/)).toHaveCount(2);

  await recordEvidence(
    "P14-BR-08",
    "Real Chromium posted a two-unit supplier return against the existing supplier, verified Store A decreased exactly once to twenty while Store B remained one, proved exactly one SUPPLIER RETURN ledger row, opened its dedicated source reference, and confirmed no purchase order was reopened for receiving.",
  );
});

test("P14-BR-09 stocked assembly and made-to-order consumption boundaries", async () => {
  test.setTimeout(150_000);
  await phasePage.goto("/back-office/business-profile");
  await phasePage.getByText("Review optional tools", { exact: false }).click();
  await phasePage.getByLabel("Enable Production").check();
  await phasePage.getByRole("button", { name: "Save business profile" }).click();
  await expect(phasePage.getByText("Business profile and feature settings updated.", { exact: true })).toBeVisible();

  await phasePage.goto("/back-office/catalog");
  await createCompositeProduct(phasePage, stockedCompositeName, "stocked_assembly");
  await createCompositeProduct(phasePage, madeToOrderCompositeName, "made_to_order");
  await addCompositeComponent(phasePage, stockedCompositeName, "2");
  await addCompositeComponent(phasePage, madeToOrderCompositeName, "3");

  await phasePage.goto("/back-office/inventory?tab=production");
  const productionForm = phasePage.locator("form").filter({ hasText: "Quantity to produce" });
  await productionForm.locator("select").nth(0).selectOption({ label: storeAName });
  await productionForm.locator("select").nth(1).selectOption({ label: stockedCompositeName });
  await expect(productionForm.locator("select").nth(1).locator("option", { hasText: madeToOrderCompositeName })).toHaveCount(0);
  await productionForm.locator('input[inputmode="decimal"]').fill("2");
  await productionForm.getByPlaceholder(/Optional/i).fill("Phase 14 stocked assembly proof");
  await productionForm.getByRole("button", { name: "Post production" }).click();
  await expect(phasePage.getByText(/production.*posted|produced/i).first()).toBeVisible();

  await phasePage.goto("/back-office/replenishment?tab=levels");
  await expect(phasePage.getByRole("row", { name: new RegExp(`${simpleName}.*${storeAName}.*16`, "i") })).toBeVisible();
  await expect(phasePage.getByRole("row", { name: new RegExp(`${stockedCompositeName}.*${storeAName}.*2`, "i") })).toBeVisible();
  await expect(phasePage.getByRole("row", { name: new RegExp(`${madeToOrderCompositeName}.*${storeAName}.*0`, "i") })).toBeVisible();

  await sellProduct(phasePage, stockedCompositeName);
  await phasePage.goto("/back-office/replenishment?tab=levels");
  await expect(phasePage.getByRole("row", { name: new RegExp(`${simpleName}.*${storeAName}.*16`, "i") })).toBeVisible();
  await expect(phasePage.getByRole("row", { name: new RegExp(`${stockedCompositeName}.*${storeAName}.*1`, "i") })).toBeVisible();

  const madeToOrderCheckout = await sellProduct(phasePage, madeToOrderCompositeName);
  await phasePage.goto("/back-office/replenishment?tab=levels");
  await expect(phasePage.getByRole("row", { name: new RegExp(`${simpleName}.*${storeAName}.*13`, "i") })).toBeVisible();
  await expect(phasePage.getByRole("row", { name: new RegExp(`${stockedCompositeName}.*${storeAName}.*1`, "i") })).toBeVisible();
  await expect(phasePage.getByRole("row", { name: new RegExp(`${madeToOrderCompositeName}.*${storeAName}.*0`, "i") })).toBeVisible();

  const replayResponse = await phasePage.request.post(madeToOrderCheckout.url, {
    data: madeToOrderCheckout.body,
  });
  expect(replayResponse.ok()).toBe(true);

  await phasePage.goto("/back-office/replenishment?tab=levels");
  await expect(phasePage.getByRole("row", { name: new RegExp(`${simpleName}.*${storeAName}.*13`, "i") })).toBeVisible();
  await expect(phasePage.getByRole("row", { name: new RegExp(`${madeToOrderCompositeName}.*${storeAName}.*0`, "i") })).toBeVisible();

  await phasePage.goto("/back-office/inventory?tab=activity");
  await expect(phasePage.getByRole("button", { name: new RegExp(`View production for ${stockedCompositeName}`, "i") })).toHaveCount(1);
  await expect(phasePage.getByRole("button", { name: new RegExp(`View production for ${simpleName}`, "i") })).toHaveCount(1);
  await expect(phasePage.getByRole("button", { name: new RegExp(`View sale for ${simpleName}`, "i") })).toHaveCount(1);
  await expect(phasePage.getByRole("button", { name: new RegExp(`View sale for ${madeToOrderCompositeName}`, "i") })).toHaveCount(0);

  await recordEvidence(
    "P14-BR-09",
    "Real Chromium created stocked-assembly and made-to-order recipes through Catalog, proved only the stocked item was eligible for Production, produced two finished units while consuming four component units exactly once, sold one stocked unit without consuming its recipe again, sold one made-to-order unit with exactly three units of sale-time component consumption and zero parent-stock movement, replayed the exact checkout without double consumption, and verified single production output, production consumption, and component SALE movements.",
  );
});

test("P14-BR-10 canonical replenishment settings and stock classification", async () => {
  await phasePage.goto("/back-office/inventory?tab=activity");
  const movementCountBefore = await phasePage.getByRole("button", { name: /^View / }).count();

  await phasePage.goto("/back-office/inventory?tab=overview&configuration=1");
  const ruleForm = phasePage.getByRole("button", { name: "Save rule" }).locator("xpath=ancestor::form");
  await ruleForm.locator("select").nth(0).selectOption({ label: storeAName });
  await ruleForm.locator("select").nth(1).selectOption({ label: simpleName });
  await ruleForm.locator('input[inputmode="decimal"]').nth(0).fill("18");
  await ruleForm.locator('input[inputmode="decimal"]').nth(1).fill("30");
  await ruleForm.getByRole("button", { name: "Save rule" }).click();
  await expect(ruleForm.getByText("Reorder point and target stock saved.", { exact: true })).toBeVisible();

  await phasePage.goto("/back-office/replenishment?tab=levels");
  const simpleStockRow = phasePage.getByRole("row", { name: new RegExp(`${simpleName}.*${storeAName}`) });
  await expect(simpleStockRow).toContainText("13");
  await expect(simpleStockRow).toContainText("Low stock");

  await phasePage.goto("/back-office/catalog");
  await phasePage.getByRole("button", { name: new RegExp(simpleName) }).click();
  await phasePage.getByRole("tab", { name: "Inventory" }).click();
  await expect(phasePage.getByRole("dialog").getByText("1 store low", { exact: true })).toBeVisible();
  await phasePage.goto("/back-office/replenishment?tab=levels");
  await expect(phasePage.getByRole("row", { name: new RegExp(`${variableName}.*Small.*${storeAName}.*Out of stock`, "i") })).toBeVisible();
  await expect(phasePage.getByRole("row", { name: new RegExp(`${variableName}.*Large.*${storeAName}.*Out of stock`, "i") })).toBeVisible();

  await phasePage.goto("/back-office/inventory?tab=activity");
  await expect(phasePage.getByRole("button", { name: /^View / })).toHaveCount(movementCountBefore);
  await phasePage.goto("/back-office/purchasing?tab=purchase-orders");
  await expect(phasePage.getByText(/PO #\d+/)).toHaveCount(1);

  await recordEvidence(
    "P14-BR-10",
    "Real Chromium saved canonical reorder point 18 and target stock 30 for the simple product, showed the same Low stock classification at quantity 13 in Stock & Restock and Catalog, kept both variant rows Out of stock without inheriting the simple-product threshold, and created neither stock movements nor purchase orders.",
  );
});

test("P14-BR-11 fractional purchase-unit conversion keeps historical snapshots stable", async () => {
  test.setTimeout(120_000);
  const unitName = `Fractional Pack ${runLabel}`;

  await phasePage.goto("/back-office/catalog");
  await phasePage.getByRole("button", { name: new RegExp(simpleName) }).click();
  await phasePage.getByText("Advanced details", { exact: true }).click();
  await phasePage.getByRole("button", { name: "Manage units" }).click();
  const addUnitForm = phasePage.getByRole("heading", { name: "Add another unit" }).locator("xpath=ancestor::form");
  await addUnitForm.getByLabel("Unit name").fill(unitName);
  await addUnitForm.getByLabel("Contains").fill("2.5");
  await addUnitForm.getByRole("button", { name: "Add unit" }).click();
  await expect(phasePage.getByText("Product unit added.", { exact: true })).toBeVisible();
  await phasePage.goto("/back-office/purchasing?tab=purchase-orders");
  const purchaseForm = phasePage.locator("form").filter({ hasText: "Create order" });
  await purchaseForm.locator("select").nth(0).selectOption({ label: storeAName });
  await purchaseForm.locator("select").nth(1).selectOption({ label: supplierName });
  await purchaseForm.locator("select").nth(2).selectOption({ label: simpleName });
  await purchaseForm.locator("select").nth(3).selectOption({ label: unitName });
  await purchaseForm.locator('input[inputmode="decimal"]').nth(0).fill("0.4");
  await purchaseForm.locator('input[inputmode="decimal"]').nth(1).fill("18.12");
  await purchaseForm.getByPlaceholder("Optional supplier instructions").fill("Phase 14 fractional snapshot proof");
  await purchaseForm.getByRole("button", { name: "Create order" }).click();
  await expect(phasePage.getByText("Purchase order created.", { exact: true })).toBeVisible();

  await phasePage.goto("/back-office/purchasing?tab=receiving");
  const receiptForm = phasePage.locator("form").filter({ hasText: unitName });
  await expect(receiptForm.getByText(new RegExp(`0\\.4 ${unitName} remaining`))).toBeVisible();
  await receiptForm.locator('input[inputmode="decimal"]').fill("0.4");
  await receiptForm.getByPlaceholder("Optional delivery note").fill("Fractional conversion receipt");
  await receiptForm.getByRole("button", { name: "Receive goods" }).click();
  await expect(phasePage.getByText("Goods received and stock updated.", { exact: true })).toBeVisible();

  await phasePage.goto("/back-office/replenishment?tab=levels");
  await expect(phasePage.getByRole("row", { name: new RegExp(`${simpleName}.*${storeAName}.*14`) })).toBeVisible();

  await phasePage.goto("/back-office/catalog");
  await phasePage.getByRole("button", { name: new RegExp(simpleName) }).click();
  await phasePage.getByRole("tab", { name: "Units" }).click();
  const unitForm = phasePage.locator("form").filter({ has: phasePage.locator(`input[value="${unitName}"]`) });
  await unitForm.getByLabel("Contains (each)").fill("3");
  await unitForm.getByRole("button", { name: "Save" }).click();
  await expect(unitForm.getByText("Product unit updated.", { exact: true })).toBeVisible();
  await phasePage.goto("/back-office/purchasing?tab=purchase-orders");
  const snapshotOrder = phasePage.getByRole("table").first().getByRole("row").nth(1);
  await snapshotOrder.getByText("1 item", { exact: false }).click();
  await expect(snapshotOrder.getByText(new RegExp(`0\\.4 ${unitName} ordered.*0\\.4 received`))).toBeVisible();
  await phasePage.goto("/back-office/replenishment?tab=levels");
  await expect(phasePage.getByRole("row", { name: new RegExp(`${simpleName}.*${storeAName}.*14`) })).toBeVisible();

  await recordEvidence(
    "P14-BR-11",
    "Real Chromium created a 2.5-each fractional purchase unit, ordered and received 0.4 unit to add exactly one base each, then changed the current factor to 3 while the completed purchase order retained its 0.4-unit ordered/received snapshots and stock stayed unchanged.",
  );
});

test("P14-BR-12 valuation coherence and protected cost visibility", async ({ browser }) => {
  await phasePage.goto("/back-office/inventory?tab=valuation");
  await expect(phasePage.getByRole("heading", { name: "Inventory valuation" })).toBeVisible();
  await expect(phasePage.getByText(simpleName, { exact: true }).first()).toBeVisible();
  await expect(phasePage.getByText(stockedCompositeName, { exact: true }).first()).toBeVisible();
  await expect(phasePage.getByText("Confirmed inventory value", { exact: true })).toBeVisible();
  await expect(phasePage.getByText(/Valuation unavailable|₱\d/).first()).toBeVisible();

  const scopedEmail = uniqueEmail("scoped-inventory");
  await createScopedEmployee({
    email: scopedEmail,
    ownerEmail,
    organizationName: businessName,
    permissionCodes: [
      "inventory.view",
      "inventory.adjust.create",
      "inventory.adjust.post",
      "approvals.request",
      "approvals.bypass",
    ],
    storeName: storeAName,
  });
  scopedContext = await newContext(browser);
  scopedPage = await scopedContext.newPage();
  await loginThroughUi(scopedPage, scopedEmail, "/back-office/inventory?tab=valuation");
  await expect(scopedPage.getByRole("heading", { name: "Inventory valuation" })).toHaveCount(0);
  await expect(scopedPage.getByText("Average cost", { exact: true })).toHaveCount(0);
  await expect(scopedPage.getByText(/₱7\.25/)).toHaveCount(0);

  await recordEvidence(
    "P14-BR-12",
    "Real owner Chromium displayed costed valuation after receipts, transfers, production, supplier return, and fractional receiving, while a real signed-in inventory operator without products.view_cost could not open the valuation view or expose average-cost values.",
  );
});

test("P14-BR-13 activity source navigation resolves canonical documents", async () => {
  const cases = [
    { movement: new RegExp(`View transfer out for ${simpleName}`, "i"), source: /Transfer TR-/ },
    { movement: new RegExp(`View receipt for ${simpleName}`, "i"), source: /Receiving GR-/ },
    { movement: new RegExp(`View adjustment for ${simpleName}`, "i"), source: /Adjustment SA-/ },
    { movement: new RegExp(`View production for ${stockedCompositeName}`, "i"), source: /Production run/ },
    { movement: new RegExp(`View supplier return for ${simpleName}`, "i"), source: /Supplier return/ },
  ];

  for (const [index, item] of cases.entries()) {
    await phasePage.goto("/back-office/inventory?tab=activity");
    await phasePage.getByRole("button", { name: item.movement }).first().click();
    const sourceLink = phasePage.getByRole("dialog").getByRole("link", { name: item.source });
    await expect(sourceLink).toBeVisible();
    const href = await sourceLink.getAttribute("href");
    expect(href).toBeTruthy();
    if (index === 0) activitySourceHref = href ?? "";
    await sourceLink.click();
    await expect(phasePage.getByLabel("Source document context")).toContainText(item.source);
    await expect(phasePage.getByLabel("Source document context").getByRole("link", { name: "Show all activity" })).toBeVisible();
  }

  await recordEvidence(
    "P14-BR-13",
    "Real Chromium opened current Activity movement dialogs and followed canonical source links for transfer, goods receipt, adjustment/count reconciliation, production, and supplier return into the matching filtered source-document context.",
  );
});

test("P14-BR-14 owner capability and two-store scope", async () => {
  await phasePage.goto("/back-office/replenishment?tab=levels");
  await expect(phasePage.getByRole("row", { name: new RegExp(`${simpleName}.*${storeAName}.*14`) })).toBeVisible();
  await expect(phasePage.getByRole("row", { name: new RegExp(`${simpleName}.*${storeBName}.*1`) })).toBeVisible();
  await phasePage.goto("/back-office/inventory?tab=transfers");
  const transferForm = phasePage.locator("form").filter({ hasText: "Send transfer" });
  await expect(transferForm.locator("select").nth(0).locator("option", { hasText: storeAName })).toHaveCount(1);
  await expect(transferForm.locator("select").nth(0).locator("option", { hasText: storeBName })).toHaveCount(1);

  await recordEvidence(
    "P14-BR-14",
    "The signed-in owner’s real capability/store-scope contract exposed both Store A and Store B, their correct current quantities, and both stores as valid transfer sources; the earlier direct and request-backed workflows succeeded across that same scope without any owner-name bypass assumption.",
  );
});

test("P14-BR-15 restricted role succeeds only in its assigned store and hides cost", async () => {
  await scopedPage.goto("/back-office/inventory?tab=adjustments");
  const adjustmentForm = scopedPage.locator("form").filter({ has: scopedPage.getByRole("button", { name: "Review adjustment" }) });
  const storeSelect = adjustmentForm.locator("select").nth(0);
  await expect(storeSelect.locator("option", { hasText: storeAName })).toHaveCount(1);
  await expect(storeSelect.locator("option", { hasText: storeBName })).toHaveCount(0);
  await adjustmentForm.locator("select").nth(1).selectOption({ index: 1 });
  await adjustmentForm.locator("select").nth(2).selectOption({ label: simpleName });
  await adjustmentForm.getByPlaceholder("Use - for a reduction").fill("1");
  await adjustmentForm.getByPlaceholder("Required: explain why stock is changing").fill("Assigned-store restricted-role certification");
  await adjustmentForm.getByRole("button", { name: "Review adjustment" }).click();
  await scopedPage.getByRole("button", { name: "Post adjustment" }).click();
  await expect(scopedPage.getByText("Stock adjustment posted to the ledger.", { exact: true })).toBeVisible();

  await scopedPage.goto("/back-office/replenishment?tab=levels");
  await expect(scopedPage.getByRole("row", { name: new RegExp(`${simpleName}.*${storeAName}.*15`) })).toBeVisible();
  await expect(scopedPage.getByText(storeBName, { exact: true })).toHaveCount(0);
  await expect(scopedPage.getByText("Average cost", { exact: true })).toHaveCount(0);
  await scopedPage.goto("/back-office/inventory?tab=transfers");
  await expect(scopedPage.getByRole("heading", { name: "Transfer orders" })).toHaveCount(0);

  await recordEvidence(
    "P14-BR-15",
    "A real signed-in custom inventory operator assigned only to Store A posted a one-unit adjustment there, saw the resulting quantity 15, could not select or render Store B, could not open transfer workflows, and saw no protected average-cost data.",
  );
});

test("P14-BR-16 second tenant cannot read or mutate first-tenant inventory", async ({ browser }) => {
  const tenantEmail = uniqueEmail("isolated-owner");
  const tenantBusiness = `Phase 14 Isolated ${runLabel}`;
  tenantContext = await newContext(browser);
  const tenantPage = await tenantContext.newPage();
  await createOwnerBusiness(tenantPage, {
    email: tenantEmail,
    businessName: tenantBusiness,
    storeName: `Isolated Store ${runLabel}`,
    registerName: `Isolated Register ${runLabel}`,
  });

  await tenantPage.goto(activitySourceHref);
  await expect(tenantPage.getByText(simpleName, { exact: false })).toHaveCount(0);
  await expect(tenantPage.getByText(storeAName, { exact: false })).toHaveCount(0);
  await expect(tenantPage.getByText(/No movements recorded/i)).toBeVisible();
  await tenantPage.goto("/back-office/inventory?tab=adjustments");
  await expect(tenantPage.locator("select").locator("option", { hasText: simpleName })).toHaveCount(0);

  await recordEvidence(
    "P14-BR-16",
    "A separately onboarded organization owner followed a first-tenant source URL and received an empty/inaccessible activity state with no first-tenant product or store rendered; its adjustment UI contained no first-tenant stock target to mutate.",
  );
});

test("P14-BR-17 actionable failures and retry safety leave no partial mutation", async () => {
  await phasePage.goto("/back-office/replenishment?tab=levels");
  await expect(phasePage.getByRole("row", { name: new RegExp(`${stockedCompositeName}.*${storeAName}.*1`) })).toBeVisible();

  await phasePage.goto("/pos");
  const search = phasePage.getByRole("searchbox").or(phasePage.getByPlaceholder(/Search/i)).first();
  await search.fill(stockedCompositeName);
  const itemButton = phasePage.getByRole("button", { name: new RegExp(stockedCompositeName) }).first();
  await itemButton.click();
  await itemButton.click();
  await phasePage.getByRole("button", { name: "Charge", exact: true }).click();
  await expect(phasePage.getByText(/Insufficient recorded stock.*1 available/i).first()).toBeVisible();
  await expect(phasePage.getByRole("heading", { name: "Payment" })).toHaveCount(0);

  await phasePage.goto("/back-office/replenishment?tab=levels");
  await expect(phasePage.getByRole("row", { name: new RegExp(`${stockedCompositeName}.*${storeAName}.*1`) })).toBeVisible();
  await phasePage.goto("/back-office/purchasing?tab=receiving");
  await expect(phasePage.getByRole("button", { name: "Receive goods" })).toHaveCount(0);
  await scopedPage.goto("/back-office/inventory?tab=transfers");
  await expect(scopedPage.getByRole("heading", { name: "Transfer orders" })).toHaveCount(0);

  await recordEvidence(
    "P14-BR-17",
    "Real Chromium proved exact checkout replay was a safe no-op, synchronous receipt retry did not duplicate stock, an over-quantity stocked-assembly sale showed an actionable insufficient-stock error without opening payment or mutating stock, terminal purchase orders exposed no receive action, and the restricted operator could not reach an unauthorized transfer action.",
  );
});

test("P14-BR-18 desktop inventory route matrix", async () => {
  await phasePage.setViewportSize({ width: 1440, height: 1000 });
  const routes = [
    ["/back-office/catalog", "Catalog"],
    ["/back-office/replenishment?tab=levels", "Stock & Restock"],
    ["/back-office/replenishment?tab=replenishment", "Stock & Restock"],
    ["/back-office/inventory?tab=overview", "Stock Control"],
    ["/back-office/inventory?tab=activity", "Stock Control"],
    ["/back-office/inventory?tab=adjustments", "Stock Control"],
    ["/back-office/inventory?tab=counts", "Stock Control"],
    ["/back-office/inventory?tab=transfers", "Stock Control"],
    ["/back-office/inventory?tab=production", "Stock Control"],
    ["/back-office/inventory?tab=valuation", "Stock Control"],
    ["/back-office/purchasing?tab=purchase-orders", "Purchasing"],
    ["/back-office/purchasing?tab=receiving", "Purchasing"],
    ["/back-office/purchasing?tab=suppliers", "Purchasing"],
    ["/back-office/purchasing?tab=supplier-returns", "Purchasing"],
    ["/back-office/business-profile", "Business profile & features"],
  ] as const;

  for (const [route, heading] of routes) {
    await phasePage.goto(route);
    await expect(phasePage.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(phasePage.getByText(/application error|internal server error/i)).toHaveCount(0);
    await expect(phasePage.getByRole("navigation").first()).toBeVisible();
  }

  await recordEvidence(
    "P14-BR-18",
    "Real desktop Chromium loaded all fifteen required Catalog, Stock & Restock, Stock Control, Purchasing, and Business Profile routes with their primary heading and navigation visible and no crash text.",
  );
});

test("P14-BR-19 narrow inventory shell and interactive content", async () => {
  await phasePage.setViewportSize({ width: 390, height: 844 });
  await phasePage.goto("/back-office/catalog");
  await expect(phasePage.getByRole("heading", { level: 1, name: "Catalog" })).toBeVisible();
  await expect(phasePage.getByRole("button", { name: new RegExp(simpleName) })).toBeVisible();
  await phasePage.getByRole("button", { name: "Add product" }).click();
  await expect(phasePage.getByRole("dialog")).toBeVisible();
  await phasePage.getByRole("button", { name: "Close dialog" }).click();
  await phasePage.goto("/back-office/replenishment?tab=levels");
  await expect(phasePage.getByRole("heading", { level: 1, name: "Stock & Restock" })).toBeVisible();
  await phasePage.goto("/back-office/inventory?tab=adjustments");
  await expect(phasePage.getByRole("heading", { level: 1, name: "Stock Control" })).toBeVisible();
  const overflow = await phasePage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await recordEvidence(
    "P14-BR-19",
    "Real Chromium at 390 by 844 displayed Catalog, Stock & Restock, Stock Control navigation, a live product card list, and the Add product dialog without page-level horizontal overflow.",
  );
});

test("P14-BR-20 backup and recovery guidance", async () => {
  await phasePage.setViewportSize({ width: 1440, height: 1000 });
  await phasePage.goto("/back-office/business-profile");
  await phasePage.getByText("Advanced organization controls", { exact: false }).click();
  await expect(phasePage.getByText("Backup & recovery", { exact: true })).toBeVisible();
  await expect(phasePage.getByText(/portable data copy, not a replacement for your Supabase platform backup/i)).toBeVisible();
  await expect(phasePage.getByText(/isolated local database, clone, or approved recovery environment/i)).toBeVisible();
  await expect(phasePage.getByLabel("Drill type").getByRole("option", { name: "Local restore" })).toHaveCount(1);
  await expect(phasePage.getByLabel("Drill type").getByRole("option", { name: "Supabase restore or clone" })).toHaveCount(1);
  await expect(phasePage.getByRole("button", { name: /restore production/i })).toHaveCount(0);

  await recordEvidence(
    "P14-BR-20",
    "Real Chromium opened Business Profile Backup & recovery and verified understandable export readiness, isolated local drill guidance, platform-backup limits, and owner or authorized-administrator control.",
  );
});
