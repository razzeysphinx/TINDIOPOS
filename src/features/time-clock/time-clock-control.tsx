"use client";

import { Clock3, LoaderCircle, LogIn, LogOut } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { clockInAction, clockOutAction } from "@/features/time-clock/actions";
import type { TimeClockEntry } from "@/features/time-clock/time-clock-types";

type StoreOption = { id: string; name: string };

const selectClassName =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function formatClockedInAt(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

export function TimeClockControl({
  initialEntry,
  stores,
  timezone,
}: {
  initialEntry: TimeClockEntry | null;
  stores: StoreOption[];
  timezone: string;
}) {
  const router = useRouter();
  const [entry, setEntry] = useState(initialEntry);
  const [storeId, setStoreId] = useState(initialEntry?.storeId ?? stores[0]?.id ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const store = useMemo(
    () => stores.find((item) => item.id === entry?.storeId),
    [entry?.storeId, stores],
  );

  const clockIn = () => {
    startTransition(async () => {
      const result = await clockInAction({ storeId });
      setMessage(result.message);
      if (result.ok) {
        setEntry(result.entry);
        router.refresh();
      }
    });
  };

  const clockOut = () => {
    startTransition(async () => {
      const result = await clockOutAction();
      setMessage(result.message);
      if (result.ok) {
        setEntry(null);
        router.refresh();
      }
    });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
            <Clock3 className="size-5" aria-hidden="true" />
          </span>
          <div>
            <CardTitle>Time clock</CardTitle>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Attendance is separate from your register shift. Clocking in does not unlock the POS, and clocking out does not close a drawer.
            </p>
          </div>
        </div>
        <Badge variant={entry ? "secondary" : "outline"}>{entry ? "Clocked in" : "Clocked out"}</Badge>
      </CardHeader>
      <CardContent>
        {entry ? (
          <div className="flex flex-col gap-3 rounded-lg border bg-muted/25 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">Clocked in at {store?.name ?? "assigned store"}</p>
              <p className="mt-1 text-sm text-muted-foreground">Since {formatClockedInAt(entry.clockedInAt, timezone)}</p>
            </div>
            <Button disabled={isPending} onClick={clockOut} type="button" variant="outline">
              {isPending ? <LoaderCircle className="animate-spin" /> : <LogOut />}
              Clock out
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="grid gap-1.5 text-sm font-medium">
              Clock in at
              <select
                className={selectClassName}
                disabled={isPending || stores.length === 0}
                onChange={(event) => setStoreId(event.target.value)}
                value={storeId}
              >
                {stores.length === 0 ? <option value="">No assigned store</option> : null}
                {stores.map((storeOption) => (
                  <option key={storeOption.id} value={storeOption.id}>{storeOption.name}</option>
                ))}
              </select>
            </label>
            <Button disabled={isPending || !storeId} onClick={clockIn} type="button">
              {isPending ? <LoaderCircle className="animate-spin" /> : <LogIn />}
              Clock in
            </Button>
          </div>
        )}
        {message ? <p aria-live="polite" className="mt-3 text-sm text-muted-foreground">{message}</p> : null}
      </CardContent>
    </Card>
  );
}
