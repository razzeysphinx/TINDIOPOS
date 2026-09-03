import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/features/inventory/inventory-integrity-workflows.tsx", import.meta.url), "utf8");

test("each inventory integrity mutation owns an action-specific transition", () => {
  const actionStates = [
    ["isPolicyPending", "startPolicyTransition"],
    ["isReasonPending", "startReasonTransition"],
    ["isAdjustmentPending", "startAdjustmentTransition"],
    ["isTransferPending", "startTransferTransition"],
    ["isSupplierReturnPending", "startSupplierReturnTransition"],
    ["isProductionPending", "startProductionTransition"],
  ];

  for (const [pendingState, transition] of actionStates) {
    assert.match(source, new RegExp(`const \\[${pendingState}, ${transition}\\] = useTransition\\(\\);`));
  }

  assert.doesNotMatch(source, /const \[isPending, startTransition\] = useTransition\(\);/);
});

test("safeguard and adjustment-reason forms do not share a loading state", () => {
  assert.match(source, /<form className="space-y-3" onSubmit=\{submitPolicy\} noValidate>/);
  assert.match(source, /<SubmitRow pending=\{isPolicyPending\} pendingLabel="Saving safeguard\.\.\." result=\{policyResult\} label="Save safeguard"/);
  assert.match(source, /<form className="grid gap-3 sm:grid-cols-2" onSubmit=\{submitReason\} noValidate>/);
  assert.match(source, /<Button disabled=\{isReasonPending\} type="submit">\{isReasonPending \? <><LoaderCircle/);
  assert.match(source, /Adding reason\.\.\./);
});
