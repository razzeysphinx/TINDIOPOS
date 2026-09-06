import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/features/inventory/inventory-integrity-workflows.tsx", import.meta.url), "utf8");

test("each inventory integrity mutation owns an action-specific transition", () => {
  const actionStates = [
    ["isDefaultPolicyPending", "startDefaultPolicyTransition"],
    ["isOverridePolicyPending", "startOverridePolicyTransition"],
    ["isRemoveOverridePending", "startRemoveOverrideTransition"],
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

test("stock-policy and adjustment-reason forms do not share a loading state", () => {
  assert.match(source, /<form className="rounded-xl border bg-muted\/20 p-4" onSubmit=\{submitDefaultPolicy\} noValidate>/);
  assert.match(source, /<Button disabled=\{isDefaultPolicyPending\} type="submit">\{isDefaultPolicyPending \? <>\s*<LoaderCircle className="animate-spin" \/>Saving default\.\.\.<\/> :/);
  assert.match(source, /<form className="grid gap-3 rounded-xl border border-dashed p-4 md:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1fr\)_auto\] md:items-end" onSubmit=\{submitOverridePolicy\} noValidate>/);
  assert.match(source, /<Button disabled=\{isOverridePolicyPending\} type="submit">\{isOverridePolicyPending \? <>\s*<LoaderCircle className="animate-spin" \/>Saving override\.\.\.<\/> :/);
  assert.match(source, /<form className="grid gap-3 sm:grid-cols-2" onSubmit=\{submitReason\} noValidate>/);
  assert.match(source, /<Button disabled=\{isReasonPending\} type="submit">\{isReasonPending \? <><LoaderCircle/);
  assert.match(source, /Adding reason\.\.\./);
});
