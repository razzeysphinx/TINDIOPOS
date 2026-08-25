"use client";

import { Copy, ExternalLink, LoaderCircle, MonitorUp, RotateCw } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { provisionCustomerDisplayAction } from "@/features/customer-display/actions";

function formatSessionDate(value: string) {
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

export function CustomerDisplayManager({
  registers,
  sessions,
}: {
  registers: Array<{ id: string; name: string; code: string; storeName: string }>;
  sessions: Array<{ registerId: string; createdAt: string; lastPublishedAt: string | null }>;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ message: string; displayUrl?: string } | null>(null);
  const sessionByRegister = new Map(sessions.map((session) => [session.registerId, session]));

  const provision = (registerId: string) => {
    setResult(null);
    startTransition(async () => {
      const nextResult = await provisionCustomerDisplayAction({ registerId });
      setResult(nextResult.ok ? { message: nextResult.message, displayUrl: nextResult.displayUrl } : { message: nextResult.message });
    });
  };

  const copyLink = async () => {
    if (!result?.displayUrl) return;
    try {
      await navigator.clipboard.writeText(result.displayUrl);
      setResult({ ...result, message: "Customer display link copied." });
    } catch {
      setResult({ ...result, message: "Copy the display link manually." });
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-secondary text-primary">
            <MonitorUp aria-hidden="true" className="size-5" />
          </span>
          <div>
            <CardTitle>Customer display</CardTitle>
            <CardDescription className="mt-1">
              Pair a second screen to a register. Rotating a link invalidates its prior URL and stops its future updates.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {registers.map((register) => {
          const session = sessionByRegister.get(register.id);
          return (
            <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between" key={register.id}>
              <div>
                <p className="font-medium">{register.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{register.storeName} · {register.code}</p>
                {session ? <p className="mt-2 text-xs text-muted-foreground">Linked {formatSessionDate(session.createdAt)}{session.lastPublishedAt ? ` · Last updated ${formatSessionDate(session.lastPublishedAt)}` : ""}</p> : <p className="mt-2 text-xs text-muted-foreground">No display link yet</p>}
              </div>
              <Button disabled={isPending} onClick={() => provision(register.id)} type="button" variant={session ? "outline" : "default"}>
                {isPending ? <LoaderCircle className="animate-spin" /> : session ? <RotateCw /> : <MonitorUp />}
                {session ? "Rotate link" : "Create display link"}
              </Button>
            </div>
          );
        })}

        {result ? (
          <div className="rounded-lg border bg-muted/25 p-3 text-sm">
            <p>{result.message}</p>
            {result.displayUrl ? (
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-3 font-mono text-xs" readOnly value={result.displayUrl} />
                <Button onClick={() => void copyLink()} size="sm" type="button" variant="outline"><Copy />Copy</Button>
                <a className="inline-flex h-7 items-center justify-center gap-1 rounded-lg px-2.5 text-sm font-medium text-primary hover:bg-muted" href={result.displayUrl} rel="noreferrer" target="_blank"><ExternalLink className="size-3.5" />Open</a>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
