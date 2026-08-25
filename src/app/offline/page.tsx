import Link from "next/link";
import { CloudOff } from "lucide-react";

import { Button } from "@/components/ui/button";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="grid min-h-svh place-items-center bg-muted/35 p-5">
      <section className="w-full max-w-md rounded-2xl border bg-card p-7 text-center shadow-sm">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
          <CloudOff className="size-6" aria-hidden="true" />
        </span>
        <p className="mt-6 text-sm font-medium uppercase tracking-[0.16em] text-primary">TINDIO offline</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">Connection unavailable</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Reconnect to open a fresh TINDIO session. If the POS was already open, queued cash sales will sync automatically when the connection returns.
        </p>
        <Button className="mt-6" nativeButton={false} render={<Link href="/pos" />}>
          Try POS again
        </Button>
      </section>
    </main>
  );
}
