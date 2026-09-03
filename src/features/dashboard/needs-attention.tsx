import { ArrowRight, CircleAlert, ShieldAlert, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type NeedsAttentionItem = {
  description: string;
  href: string;
  label: string;
  severity: "critical" | "needs_attention" | "watch";
  value: string;
};

/** Shows only real, permission-filtered conditions supplied by the page. */
export function NeedsAttention({ items }: { items: NeedsAttentionItem[] }) {
  const orderedItems = [...items].sort((left, right) => {
    const order = { critical: 0, needs_attention: 1, watch: 2 };
    return order[left.severity] - order[right.severity];
  });

  return (
    <section aria-labelledby="needs-attention-title" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-[0.14em] text-primary uppercase">Problems</p>
          <h2 className="mt-1 flex items-center gap-2 text-xl font-semibold" id="needs-attention-title">
            <CircleAlert aria-hidden="true" className="size-5 text-destructive" />
            Needs attention
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Prioritized conditions in your authorized store scope.</p>
        </div>
        <Badge variant="outline">{items.length} active {items.length === 1 ? "issue" : "issues"}</Badge>
      </div>
      {items.length === 0 ? (
        <Card className="border-primary/20 py-0">
          <CardContent className="flex min-h-20 items-center gap-3 px-4 py-4 sm:px-5">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><CircleAlert aria-hidden="true" className="size-4" /></span>
            <div><p className="font-semibold">No urgent issues in this scope</p><p className="mt-0.5 text-sm text-muted-foreground">TINDIO has not found a condition that needs review right now.</p></div>
          </CardContent>
        </Card>
      ) : <Card className="overflow-hidden py-0">
        <CardContent className="divide-y px-0">
          {orderedItems.map((item) => {
            const Icon = item.severity === "critical" ? ShieldAlert : item.severity === "needs_attention" ? CircleAlert : TriangleAlert;
            const severityLabel = item.severity === "critical" ? "Critical" : item.severity === "needs_attention" ? "Needs attention" : "Watch";
            return (
              <Link
                className="group flex min-h-16 items-center gap-3 px-4 py-3 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
                href={item.href}
                key={`${item.label}:${item.href}`}
              >
                <span className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-lg",
                  item.severity === "critical"
                    ? "bg-destructive/10 text-destructive"
                    : item.severity === "needs_attention"
                      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                      : "bg-secondary text-secondary-foreground",
                )}>
                  <Icon aria-hidden="true" className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{severityLabel}</span>
                    <span className="font-semibold">{item.value} {item.label}</span>
                  </span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{item.description}</span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary">
                  Review <ArrowRight aria-hidden="true" className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            );
          })}
        </CardContent>
      </Card>}
    </section>
  );
}
