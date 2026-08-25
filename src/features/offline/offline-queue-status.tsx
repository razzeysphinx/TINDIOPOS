"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  CloudUpload,
  LoaderCircle,
  ShieldAlert,
  Wifi,
  X,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { formatMinorMoney } from "@/features/catalog/catalog-money";
import {
  retryOfflineCheckout,
  useOfflineQueue,
} from "@/features/offline/offline-sync";
import type { OfflineCheckoutState } from "@/features/offline/offline-store";

function stateLabel(state: OfflineCheckoutState) {
  switch (state) {
    case "DRAFT": return "Draft";
    case "LOCAL_PENDING": return "Queued locally";
    case "SYNCING": return "Syncing";
    case "SYNCED": return "Synced";
    case "CONFLICT": return "Needs manager review";
    case "FAILED": return "Sign-in or retry needed";
  }
}

function stateClassName(state: OfflineCheckoutState) {
  if (state === "CONFLICT" || state === "FAILED") {
    return "rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive";
  }
  if (state === "SYNCED") {
    return "rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary";
  }
  return "rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-primary";
}

export function OfflineQueueStatus({ scope }: { scope: string }) {
  const { entries, isOnline, isSyncing, refresh, storage, summary, sync } = useOfflineQueue(scope);
  const [isOpen, setIsOpen] = useState(false);
  const hasLocalHistory = entries.length > 0;
  const unresolved = summary.pending + summary.syncing + summary.conflict + summary.failed;

  const retry = async (idempotencyKey: string) => {
    await retryOfflineCheckout(idempotencyKey);
    await refresh();
    await sync();
  };

  const label = summary.conflict > 0
    ? `${summary.conflict} sale${summary.conflict === 1 ? "" : "s"} need review`
    : summary.failed > 0
      ? `${summary.failed} sale${summary.failed === 1 ? "" : "s"} need attention`
      : summary.pending + summary.syncing > 0
        ? `${summary.pending + summary.syncing} queued sale${summary.pending + summary.syncing === 1 ? "" : "s"}`
        : summary.synced > 0
          ? `${summary.synced} offline receipt${summary.synced === 1 ? "" : "s"}`
          : "Offline";

  return (
    <>
      {hasLocalHistory || !isOnline ? (
        <Button
          className="h-9 px-3 text-xs"
          onClick={() => setIsOpen(true)}
          size="sm"
          type="button"
          variant="outline"
        >
          {isSyncing ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : summary.conflict + summary.failed > 0 ? <ShieldAlert aria-hidden="true" /> : isOnline ? <CloudUpload aria-hidden="true" /> : <CloudOff aria-hidden="true" />}
          {label}
        </Button>
      ) : (
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
          <Wifi className="size-3.5 text-primary" aria-hidden="true" />
          Online
        </span>
      )}

      {isOpen ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-foreground/35 p-4" role="presentation">
          <section
            aria-labelledby="offline-queue-title"
            aria-modal="true"
            className="max-h-[85svh] w-full max-w-xl overflow-y-auto rounded-2xl border bg-background p-5 shadow-xl"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.15em] text-primary">Offline protection</p>
                <h2 className="mt-1 text-xl font-semibold" id="offline-queue-title">Saved POS transactions</h2>
              </div>
              <Button aria-label="Close offline queue" onClick={() => setIsOpen(false)} size="icon" type="button" variant="ghost">
                <X aria-hidden="true" />
              </Button>
            </div>

            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {isOnline
                ? "TINDIO syncs saved cash sales in their original order. A record is retained after confirmation so the temporary receipt can be matched to its official receipt."
                : "Transactions are stored durably in this browser’s IndexedDB. Do not enter the same sale again; it already has a permanent checkout key."}
            </p>

            {storage.isLow ? (
              <div className="mt-4 flex gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm leading-5 text-foreground">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden="true" />
                <p>Browser storage is nearly full. Reconnect and let TINDIO sync before accepting more offline payments.</p>
              </div>
            ) : null}

            {entries.length > 0 ? (
              <ul className="mt-5 divide-y rounded-xl border">
                {entries.map((entry) => (
                  <li className="p-4" key={entry.idempotencyKey}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">
                          {formatMinorMoney(entry.summary.totalMinor, entry.summary.currencyCode)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {entry.localReceiptReference} · {entry.summary.itemCount} item{entry.summary.itemCount === 1 ? "" : "s"} · {new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.createdAt))}
                        </p>
                      </div>
                      <span className={stateClassName(entry.state)}>{stateLabel(entry.state)}</span>
                    </div>
                    {entry.officialReceiptNumber !== null ? (
                      <p className="mt-3 flex items-center gap-2 rounded-lg bg-primary/5 p-3 text-sm text-primary">
                        <CheckCircle2 className="size-4" aria-hidden="true" />
                        Confirmed as receipt #{entry.officialReceiptNumber}.
                      </p>
                    ) : null}
                    {entry.conflictType ? (
                      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-destructive">{entry.conflictType.replaceAll("_", " ")}</p>
                    ) : null}
                    {entry.lastError ? (
                      <p className="mt-3 rounded-lg bg-muted p-3 text-sm leading-5 text-muted-foreground">
                        {entry.lastError}
                      </p>
                    ) : null}
                    {(entry.state === "CONFLICT" || entry.state === "FAILED") ? (
                      <Button
                        className="mt-3"
                        disabled={!isOnline || isSyncing}
                        onClick={() => void retry(entry.idempotencyKey)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <CloudUpload aria-hidden="true" />
                        Retry after resolving
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-5 rounded-xl border bg-muted/25 p-4 text-sm text-muted-foreground">
                There are no saved offline sales for this signed-in employee.
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <Button disabled={!isOnline || isSyncing || unresolved === 0} onClick={() => void sync()} type="button" variant="outline">
                {isSyncing ? <LoaderCircle className="animate-spin" /> : <CloudUpload />}
                Sync now
              </Button>
              <Button onClick={() => setIsOpen(false)} type="button">Close</Button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
