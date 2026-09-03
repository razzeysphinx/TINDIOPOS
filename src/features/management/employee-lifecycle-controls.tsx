"use client";

import { Archive, LoaderCircle, RotateCcw, Trash2, UserMinus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  changeEmployeeLifecycleAction,
  deleteEmployeeIfEligibleAction,
  updateEmployeeProfileAction,
} from "@/features/management/actions";
import type { ManagementActionResult, ManagementEmployeeDetail } from "@/features/management/management-types";

export function EmployeeProfileEditor({ employee }: { employee: ManagementEmployeeDetail }) {
  const router = useRouter();
  const [fullName, setFullName] = useState(employee.fullName);
  const [phone, setPhone] = useState(employee.phone ?? "");
  const [result, setResult] = useState<ManagementActionResult<unknown> | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={(event) => {
      event.preventDefault();
      setResult(null);
      startTransition(async () => {
        const next = await updateEmployeeProfileAction({ employeeId: employee.id, fullName, phone });
        setResult(next);
        if (next.ok) router.refresh();
      });
    }}>
      <label className="grid gap-1.5 text-sm font-medium">Name<Input disabled={isPending} onChange={(event) => setFullName(event.target.value)} value={fullName} /></label>
      <label className="grid gap-1.5 text-sm font-medium">Phone<Input disabled={isPending} onChange={(event) => setPhone(event.target.value)} value={phone} /></label>
      <Button disabled={isPending || fullName.trim().length < 2} type="submit">{isPending ? <LoaderCircle className="animate-spin" /> : null}Save profile</Button>
      {result ? <p aria-live="polite" className="text-sm text-muted-foreground sm:col-span-3">{result.message}</p> : null}
    </form>
  );
}

export function EmployeeLifecycleControls({ employee }: { employee: ManagementEmployeeDetail }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [result, setResult] = useState<ManagementActionResult<unknown> | null>(null);
  const [isPending, startTransition] = useTransition();

  const runLifecycle = (action: "DEACTIVATE" | "REACTIVATE" | "ARCHIVE") => {
    setPendingAction(action);
    setResult(null);
    startTransition(async () => {
      const next = await changeEmployeeLifecycleAction({ employeeId: employee.id, action, reason });
      setResult(next);
      setPendingAction(null);
      if (next.ok) router.refresh();
    });
  };
  const remove = () => {
    setPendingAction("DELETE");
    setResult(null);
    startTransition(async () => {
      const next = await deleteEmployeeIfEligibleAction({ employeeId: employee.id, confirmationNumber: confirmation });
      setResult(next);
      setPendingAction(null);
      if (next.ok) router.push("/back-office/employees?status=archived");
    });
  };
  const blockedByWork = Boolean(employee.openShift || employee.attendance.current);

  return (
    <div className="space-y-4">
      {employee.openShift ? (
        <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-4">
          <p className="font-semibold">Employee has an active register shift</p>
          <p className="mt-1 text-sm text-muted-foreground">{employee.openShift.storeName} · {employee.openShift.registerName}</p>
          <p className="mt-2 text-sm">Resolve the register shift before removing this employee from active operations.</p>
        </div>
      ) : employee.attendance.current ? (
        <div className="rounded-xl border bg-muted/20 p-4 text-sm">Clock this employee out before deactivating or archiving them.</div>
      ) : null}

      {employee.status !== "archived" ? (
        <label className="grid gap-1.5 text-sm font-medium">Reason<Input disabled={isPending} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="Required for lifecycle changes" value={reason} /></label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {employee.status === "active" ? <Button disabled={isPending || blockedByWork || reason.trim().length < 2} onClick={() => runLifecycle("DEACTIVATE")} type="button" variant="outline">{pendingAction === "DEACTIVATE" ? <LoaderCircle className="animate-spin" /> : <UserMinus />}Deactivate</Button> : null}
        {employee.status === "inactive" || employee.status === "suspended" ? <>
          <Button disabled={isPending || reason.trim().length < 2} onClick={() => runLifecycle("REACTIVATE")} type="button" variant="outline">{pendingAction === "REACTIVATE" ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}Reactivate</Button>
          <Button disabled={isPending || blockedByWork || reason.trim().length < 2} onClick={() => runLifecycle("ARCHIVE")} type="button" variant="outline">{pendingAction === "ARCHIVE" ? <LoaderCircle className="animate-spin" /> : <Archive />}Archive</Button>
        </> : null}
      </div>

      {employee.status === "archived" ? (
        <div className="rounded-xl border border-destructive/25 p-4">
          <p className="font-semibold">Permanent deletion</p>
          {employee.deleteBlockers.length > 0 ? <p className="mt-1 text-sm text-muted-foreground">This employee has recorded business activity and cannot be permanently deleted. Historical records will remain intact.</p> : <>
            <p className="mt-1 text-sm text-muted-foreground">No recorded business activity was found. Enter <span className="font-mono font-medium text-foreground">{employee.employeeNumber}</span> to confirm.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row"><Input disabled={isPending} onChange={(event) => setConfirmation(event.target.value)} value={confirmation} /><Button disabled={isPending || confirmation.trim().toUpperCase() !== employee.employeeNumber} onClick={remove} type="button" variant="destructive">{pendingAction === "DELETE" ? <LoaderCircle className="animate-spin" /> : <Trash2 />}Permanently delete</Button></div>
          </>}
        </div>
      ) : null}
      {result ? <p aria-live="polite" className="text-sm text-muted-foreground">{result.message}</p> : null}
    </div>
  );
}
