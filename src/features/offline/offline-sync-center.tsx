"use client";

import { CheckCircle2, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type OfflineSyncEventItem = {
  id: string;
  localReceiptReference: string;
  state: "LOCAL_PENDING" | "SYNCING" | "SYNCED" | "CONFLICT" | "FAILED";
  conflictType: string | null;
  failureMessage: string | null;
  storeName: string;
  registerName: string;
  deviceName: string | null;
  employeeName: string;
  localCreatedAt: string | null;
  lastAttemptAt: string;
  attemptCount: number;
  officialReceiptNumber: number | null;
};

function isIssue(item: OfflineSyncEventItem) {
  return item.state === "CONFLICT" || item.state === "FAILED";
}

export function OfflineSyncCenter({ events }: { events: OfflineSyncEventItem[] }) {
  const [showResolved, setShowResolved] = useState(false);
  const visibleEvents = useMemo(
    () => showResolved ? events : events.filter(isIssue),
    [events, showResolved],
  );
  const issueCount = events.filter(isIssue).length;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
        <div>
          <p className="font-medium">{issueCount === 0 ? "No offline sync issues" : `${issueCount} offline sync issue${issueCount === 1 ? "" : "s"}`}</p>
          <p className="mt-1 text-sm text-muted-foreground">Only outcomes observed after a POS reconnects appear here. Pending browser-only sales stay on the originating POS until it reconnects.</p>
        </div>
        <Button onClick={() => setShowResolved((current) => !current)} size="sm" type="button" variant="outline">
          {showResolved ? "Show issues only" : "Show all outcomes"}
        </Button>
      </div>

      {visibleEvents.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
          {showResolved ? "No offline sync outcomes have reached the server yet." : "TINDIO has not recorded any offline sync conflicts."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <ul className="divide-y">
            {visibleEvents.map((event) => (
              <li className="p-4 sm:p-5" key={event.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{event.localReceiptReference}</p>
                      <Badge variant={isIssue(event) ? "destructive" : "secondary"}>
                        {isIssue(event) ? <ShieldAlert aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
                        {event.state.replaceAll("_", " ")}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{event.storeName} · {event.registerName} · {event.deviceName ?? "Unmanaged browser"} · {event.employeeName}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">Attempt {event.attemptCount} · {new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.lastAttemptAt))}</p>
                </div>
                {event.officialReceiptNumber !== null ? <p className="mt-3 text-sm text-primary">Confirmed as official receipt #{event.officialReceiptNumber}.</p> : null}
                {event.conflictType ? <p className="mt-3 text-xs font-semibold tracking-wide text-destructive uppercase">{event.conflictType.replaceAll("_", " ")}</p> : null}
                {event.failureMessage ? <p className="mt-2 rounded-lg bg-muted p-3 text-sm leading-5 text-muted-foreground">{event.failureMessage}</p> : null}
                {isIssue(event) ? <p className="mt-3 text-xs leading-5 text-muted-foreground">Resolve the underlying register, device, catalog, payment, or permission change, then have the cashier retry the original temporary receipt from the POS offline queue. TINDIO keeps the same checkout key and will not create a duplicate sale.</p> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
