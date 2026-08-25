"use client";

import { KeyRound, LoaderCircle } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setEmployeePinAction } from "@/features/approvals/actions";

export function EmployeePinForm({
  employeeId,
  employeeName,
}: {
  employeeId: string;
  employeeName: string;
}) {
  const [pin, setPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    if (pin !== confirmation) {
      setMessage("The PIN confirmation does not match.");
      return;
    }

    setMessage(null);
    startTransition(async () => {
      const result = await setEmployeePinAction({ employeeId, pin });
      setPin("");
      setConfirmation("");
      setMessage(result.message);
    });
  };

  return (
    <div className="rounded-lg border border-dashed p-3">
      <p className="flex items-center gap-2 text-sm font-medium"><KeyRound className="size-4 text-primary" />Secure PIN for {employeeName}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">Use 6–12 digits. The PIN is hashed and cannot be recovered or displayed.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Input aria-label={`New PIN for ${employeeName}`} autoComplete="new-password" disabled={isPending} inputMode="numeric" maxLength={12} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} placeholder="New PIN" type="password" value={pin} />
        <Input aria-label={`Confirm PIN for ${employeeName}`} autoComplete="new-password" disabled={isPending} inputMode="numeric" maxLength={12} onChange={(event) => setConfirmation(event.target.value.replace(/\D/g, ""))} placeholder="Confirm PIN" type="password" value={confirmation} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button disabled={isPending || pin.length < 6 || confirmation.length < 6} onClick={submit} size="sm" type="button" variant="outline">
          {isPending ? <LoaderCircle className="animate-spin" /> : <KeyRound />}
          Save PIN
        </Button>
        {message ? <p aria-live="polite" className="text-xs text-muted-foreground">{message}</p> : null}
      </div>
    </div>
  );
}
