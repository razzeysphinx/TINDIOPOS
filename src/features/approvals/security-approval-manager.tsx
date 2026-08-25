"use client";

import { LoaderCircle, Save, ShieldCheck } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateApprovalRuleAction } from "@/features/approvals/actions";
import type { ApprovalOperation } from "@/features/approvals/approval-schema";

type ApprovalRule = {
  operationCode: ApprovalOperation;
  decision: "ALLOWED" | "DENIED" | "APPROVAL_REQUIRED";
  amountThresholdMinor: number | null;
  isEnabled: boolean;
};

const labels: Record<ApprovalOperation, { name: string; description: string }> = {
  "sales.refund": {
    name: "Refunds",
    description: "Return money and reverse tracked stock only with a recorded reason.",
  },
  "cash.pay_out": {
    name: "Cash pay-outs",
    description: "Remove physical cash from an open register shift.",
  },
  "inventory.adjust": {
    name: "Inventory adjustments",
    description: "Create a signed, append-only inventory movement.",
  },
};

function minorToInput(value: number | null) {
  return value === null ? "" : (value / 100).toFixed(2);
}

function ApprovalRuleCard({ rule }: { rule: ApprovalRule }) {
  const [decision, setDecision] = useState(rule.decision);
  const [amountThreshold, setAmountThreshold] = useState(minorToInput(rule.amountThresholdMinor));
  const [isEnabled, setIsEnabled] = useState(rule.isEnabled);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const label = labels[rule.operationCode];

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await updateApprovalRuleAction({
        operationCode: rule.operationCode,
        decision,
        amountThreshold,
        isEnabled,
      });
      setMessage(result.message);
    });
  };

  return (
    <article className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">{label.name}</p>
          <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">{label.description}</p>
        </div>
        <label className="flex items-center gap-2 text-xs font-medium">
          <input checked={isEnabled} disabled={isPending} onChange={(event) => setIsEnabled(event.target.checked)} type="checkbox" />
          Rule enabled
        </label>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-end">
        <label className="grid gap-1.5 text-sm font-medium">
          Decision
          <select className="h-9 rounded-lg border border-input bg-background px-3 text-sm" disabled={isPending} onChange={(event) => setDecision(event.target.value as typeof decision)} value={decision}>
            <option value="ALLOWED">Allowed for permitted staff</option>
            <option value="APPROVAL_REQUIRED">Manager approval required</option>
            <option value="DENIED">Denied (except authorized bypass)</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Approval above
          <Input disabled={isPending || decision !== "APPROVAL_REQUIRED"} inputMode="decimal" onChange={(event) => setAmountThreshold(event.target.value)} placeholder="No limit" value={amountThreshold} />
        </label>
        <Button disabled={isPending} onClick={save} type="button" variant="outline">
          {isPending ? <LoaderCircle className="animate-spin" /> : <Save />}
          Save
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Leave “Approval above” blank to require an approval every time. A threshold only applies to cash amounts.</p>
      {message ? <p aria-live="polite" className="mt-2 text-xs text-muted-foreground">{message}</p> : null}
    </article>
  );
}

export function SecurityApprovalManager({ rules }: { rules: ApprovalRule[] }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <ShieldCheck className="size-4 text-primary" />
        These rules are enforced by the database, not only this screen.
      </div>
      {rules.map((rule) => <ApprovalRuleCard key={rule.operationCode} rule={rule} />)}
    </div>
  );
}
