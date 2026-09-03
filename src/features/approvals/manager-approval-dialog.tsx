"use client";

import { Clock3, LoaderCircle, ShieldCheck } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { approveManagerApprovalAction } from "@/features/approvals/actions";

export function ManagerApprovalDialog({
  approvalRequestId,
  operationLabel,
  onApproved,
  onCancel,
  onRequestApproval,
  requestAmount,
  requestReference,
}: {
  approvalRequestId: string;
  operationLabel: string;
  onApproved: () => void;
  onCancel: () => void;
  onRequestApproval?: () => void;
  requestAmount?: string;
  requestReference?: string;
}) {
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showPin, setShowPin] = useState(!onRequestApproval);

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
    <Dialog.Root onOpenChange={(open) => { if (!open && !isPending) onCancel(); }} open>
      <DialogContent closeLabel="Cancel manager approval" showCloseButton={!isPending}>
        <DialogHeader>
          <p className="text-xs font-semibold tracking-[0.14em] text-primary">TINDIO SECURITY</p>
          <DialogTitle className="mt-1 break-words">Manager approval required</DialogTitle>
          <DialogDescription>
            Approve this {operationLabel.toLowerCase()} only. The cashier keeps their own access.
          </DialogDescription>
          {requestReference || requestAmount ? <p className="mt-2 text-sm font-medium">{[requestReference, requestAmount].filter(Boolean).join(" · ")}</p> : null}
        </DialogHeader>

        <DialogBody>
        {!showPin ? (
          <div className="grid gap-3">
            <Button onClick={() => setShowPin(true)} type="button">
              <ShieldCheck />
              Approve with PIN
            </Button>
            <Button onClick={onRequestApproval} type="button" variant="outline">
              <Clock3 />
              Request approval
            </Button>
            <p className="text-xs leading-5 text-muted-foreground">
              Use a nearby authorized employee&apos;s PIN, or leave this request pending for an authorized approver in Back Office.
            </p>
          </div>
        ) : (
        <div className="grid gap-3">
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
        )}
        </DialogBody>
      </DialogContent>
    </Dialog.Root>
  );
}
