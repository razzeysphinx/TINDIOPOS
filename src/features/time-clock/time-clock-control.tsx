"use client";

import { CircleHelp, Clock3, LoaderCircle, LogIn, LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { clockInAction, clockOutAction, loadAttendanceEmployeesAction } from "@/features/time-clock/actions";
import type { AttendanceEmployee, TimeClockEntry } from "@/features/time-clock/time-clock-types";

type StoreOption = { id: string; name: string };

const selectClassName =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-PH", { timeStyle: "short", timeZone: timezone }).format(new Date(value));
}

function formatDuration(start: string, end?: string | null) {
  const minutes = Math.max(0, Math.floor(((end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime()) / 60_000));
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function TimeClockControl({
  initialEmployees = [],
  initialEntry,
  stores,
  timezone,
}: {
  initialEmployees?: AttendanceEmployee[];
  initialEntry: TimeClockEntry | null;
  stores: StoreOption[];
  timezone: string;
}) {
  const router = useRouter();
  const [employees, setEmployees] = useState(initialEmployees);
  const [fallbackEntry, setFallbackEntry] = useState(initialEntry);
  const [storeId, setStoreId] = useState(initialEntry?.storeId ?? stores[0]?.id ?? "");
  const [employeeId, setEmployeeId] = useState(initialEntry?.employeeId ?? initialEmployees[0]?.id ?? "");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [completedEntry, setCompletedEntry] = useState<TimeClockEntry | null>(null);
  const [openShift, setOpenShift] = useState<{ id: string; registerName: string; openedAt: string } | null>(null);
  const [isLoadingEmployees, startEmployeeLoad] = useTransition();
  const [isSubmitting, startSubmission] = useTransition();

  useEffect(() => {
    if (!storeId) return;
    startEmployeeLoad(async () => {
      const result = await loadAttendanceEmployeesAction({ storeId });
      if (!result.ok) {
        setEmployees([]);
        setMessage(result.message);
        return;
      }
      setEmployees(result.employees);
      setEmployeeId((current) => result.employees.some((employee) => employee.id === current)
        ? current
        : result.employees[0]?.id ?? "");
    });
  }, [storeId]);

  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.id === employeeId),
    [employeeId, employees],
  );
  const selectedEntry = selectedEmployee?.entry
    ?? (fallbackEntry?.employeeId === employeeId ? fallbackEntry : null);
  const action = selectedEntry ? "clock-out" : "clock-in";

  const openVerification = () => {
    setMessage(null);
    setOpenShift(null);
    setPin("");
    setDialogOpen(true);
  };

  const submit = () => {
    if (!selectedEmployee || pin.length < 6) return;
    setMessage(null);
    setOpenShift(null);
    startSubmission(async () => {
      const requestId = crypto.randomUUID();
      const result = action === "clock-in"
        ? await clockInAction({ storeId, employeeId: selectedEmployee.id, pin, requestId })
        : await clockOutAction({ employeeId: selectedEmployee.id, pin, requestId });
      setPin("");
      setMessage(result.message);
      if (!result.ok) {
        if (result.openShift) {
          setOpenShift({ id: result.openShift.id, registerName: result.openShift.registerName, openedAt: result.openShift.openedAt });
        }
        return;
      }

      setEmployees((current) => current.map((employee) => employee.id === selectedEmployee.id
        ? { ...employee, entry: action === "clock-in" ? result.entry : null }
        : employee));
      setFallbackEntry(action === "clock-in" ? result.entry : null);
      setCompletedEntry(action === "clock-out" ? result.entry : null);
      setDialogOpen(false);
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
            <Clock3 className="size-5" aria-hidden="true" />
          </span>
          <div><CardTitle>Attendance</CardTitle><p className="mt-1 text-sm text-muted-foreground">Time clock</p></div>
        </div>
        <span title="Attendance tracks work hours separately from register shifts.">
          <CircleHelp className="size-4 text-muted-foreground" aria-label="Attendance help" />
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium">
            Store
            <select className={selectClassName} disabled={isLoadingEmployees || isSubmitting || stores.length === 0} onChange={(event) => setStoreId(event.target.value)} value={storeId}>
              {stores.length === 0 ? <option value="">No assigned store</option> : null}
              {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Employee
            <select className={selectClassName} disabled={isLoadingEmployees || isSubmitting || employees.length === 0} onChange={(event) => { setEmployeeId(event.target.value); setCompletedEntry(null); }} value={employeeId}>
              {employees.length === 0 ? <option value="">No available employees</option> : null}
              {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} · {employee.employeeNumber}</option>)}
            </select>
          </label>
        </div>

        {selectedEmployee ? (
          <div className="rounded-xl border bg-muted/20 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{selectedEmployee.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selectedEntry
                    ? `${selectedEntry.storeName} · Since ${formatTime(selectedEntry.clockedInAt, timezone)} · ${formatDuration(selectedEntry.clockedInAt)}`
                    : stores.find((store) => store.id === storeId)?.name ?? "Assigned store"}
                </p>
              </div>
              <Badge variant={selectedEntry ? "secondary" : "outline"}>{selectedEntry ? "Clocked in" : "Not clocked in"}</Badge>
            </div>
            <Button className="mt-4 w-full sm:w-auto" disabled={isLoadingEmployees || isSubmitting || !selectedEmployee.pinIsSet} onClick={openVerification} type="button" variant={selectedEntry ? "outline" : "default"}>
              {selectedEntry ? <LogOut /> : <LogIn />}{selectedEntry ? "Clock out" : "Clock in"}
            </Button>
            {!selectedEmployee.pinIsSet ? <p className="mt-2 text-xs text-muted-foreground">A manager must set this employee&apos;s PIN first.</p> : null}
          </div>
        ) : null}

        {completedEntry?.clockedOutAt ? (
          <div className="rounded-xl border border-primary/20 bg-secondary/50 p-4">
            <p className="flex items-center gap-2 font-semibold text-primary"><ShieldCheck className="size-4" />Clocked out</p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted-foreground">Clocked in</dt><dd>{formatTime(completedEntry.clockedInAt, timezone)}</dd>
              <dt className="text-muted-foreground">Clocked out</dt><dd>{formatTime(completedEntry.clockedOutAt, timezone)}</dd>
              <dt className="text-muted-foreground">Total</dt><dd>{formatDuration(completedEntry.clockedInAt, completedEntry.clockedOutAt)}</dd>
            </dl>
          </div>
        ) : null}
        {message && !dialogOpen ? <p aria-live="polite" className="text-sm text-muted-foreground">{message}</p> : null}
      </CardContent>

      <Dialog.Root open={dialogOpen} onOpenChange={(nextOpen) => { if (!isSubmitting) setDialogOpen(nextOpen); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{action === "clock-in" ? "Clock in" : "Clock out"}</DialogTitle>
            <DialogDescription>{selectedEmployee?.name} · {selectedEntry?.storeName ?? stores.find((store) => store.id === storeId)?.name}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            {selectedEntry ? <p className="rounded-lg border bg-muted/20 p-3 text-sm">Clocked in {formatTime(selectedEntry.clockedInAt, timezone)}</p> : null}
            <label className="grid gap-1.5 text-sm font-medium">
              Enter employee PIN
              <Input autoComplete="off" autoFocus disabled={isSubmitting} inputMode="numeric" maxLength={12} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} placeholder="••••••" type="password" value={pin} />
            </label>
            {openShift ? (
              <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-4">
                <p className="font-semibold">You still have an open register shift</p>
                <p className="mt-1 text-sm text-muted-foreground">{openShift.registerName} · Opened {formatTime(openShift.openedAt, timezone)}</p>
                <p className="mt-2 text-sm">Close the register shift before clocking out.</p>
                <Link className={`${buttonVariants({ variant: "outline", size: "sm" })} mt-3`} href="/pos/shifts">Go to Shift</Link>
              </div>
            ) : null}
            {message ? <p aria-live="polite" className="text-sm text-muted-foreground">{message}</p> : null}
          </DialogBody>
          <DialogFooter className="justify-end border-t px-4 py-4 sm:px-6">
            <Button disabled={isSubmitting} onClick={() => setDialogOpen(false)} type="button" variant="outline">Cancel</Button>
            <Button disabled={isSubmitting || pin.length < 6} onClick={submit} type="button">
              {isSubmitting ? <LoaderCircle className="animate-spin" /> : action === "clock-in" ? <LogIn /> : <LogOut />}
              {action === "clock-in" ? "Clock in" : "Clock out"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog.Root>
    </Card>
  );
}
