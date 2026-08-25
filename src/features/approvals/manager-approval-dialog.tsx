"use client";

import { LoaderCircle, ShieldCheck, X } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { approveManagerApprovalAction } from "@/features/approvals/actions";

export function ManagerApprovalDialog({
  approvalRequestId,
  operationLabel,
  onApproved,
  onCancel,
}: {
  approvalRequestId: string;
  operationLabel: string;
  onApproved: () => void;
  onCancel: () => void;
}) {
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const approve = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await approveManagerApprovalAction({
        approvalRequestId,
        employeeNumber,
        pin,
      });
      setPin("");
      setMessage(result.message);
      if (result.ok) onApproved();
    });
  };

  return (
    <div
      aria-labelledby="manager-approval-title"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/35 p-4"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !isPending) onCancel();
      }}
      role="dialog"
    >
      <section className="w-full max-w-md rounded-xl border bg-background p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.14em] text-primary">TINDIO SECURITY</p>
            <h2 className="mt-1 text-lg font-semibold" id="manager-approval-title">
              Manager approval required
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Approve this {operationLabel.toLowerCase()} only. The cashier keeps their own access.
            </p>
          </div>
          <Button aria-label="Cancel manager approval" disabled={isPending} onClick={onCancel} size="icon" type="button" variant="ghost">
            <X />
          </Button>
        </div>

        <div className="mt-5 grid gap-3">
          <label className="grid gap-1.5 text-sm font-medium">
            Manager employee number
            <Input
              autoComplete="off"
              disabled={isPending}
              maxLength={32}
              onChange={(event) => setEmployeeNumber(event.target.value.toUpperCase())}
              value={employeeNumber}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Manager PIN
            <Input
              autoComplete="off"
              disabled={isPending}
              inputMode="numeric"
              maxLength={12}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
              type="password"
              value={pin}
            />
          </label>
          <p className="text-xs leading-5 text-muted-foreground">
            PIN attempts are protected by a lockout. TINDIO never saves the PIN in the browser or database as plain text.
          </p>
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button disabled={isPending} onClick={onCancel} type="button" variant="outline">Cancel</Button>
            <Button disabled={isPending || employeeNumber.length < 2 || pin.length < 6} onClick={approve} type="button">
              {isPending ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}
              Approve operation
            </Button>
          </div>
          {message ? <p aria-live="polite" className="text-sm text-muted-foreground">{message}</p> : null}
        </div>
      </section>
    </div>
  );
}
