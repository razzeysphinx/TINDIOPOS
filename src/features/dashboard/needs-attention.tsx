import type { LucideIcon } from "lucide-react";
import { ArrowRight, CircleAlert } from "lucide-react";
import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type NeedsAttentionItem = {
  description: string;
  href: string;
  icon: LucideIcon;
  label: string;
  value: string;
};

/** Shows only real, permission-filtered conditions supplied by the page. */
export function NeedsAttention({ items }: { items: NeedsAttentionItem[] }) {
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="needs-attention-title" className="space-y-3">
      <div>
        <p className="text-xs font-bold tracking-[0.14em] text-primary uppercase">Focus next</p>
        <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold" id="needs-attention-title">
          <CircleAlert aria-hidden="true" className="size-5 text-destructive" />
          Needs attention
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Open an item to see the affected records in your authorized scope.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring" href={item.href} key={`${item.label}:${item.href}`}>
              <Card className="h-full border-destructive/20 transition-colors group-hover:bg-muted/50">
                <CardHeader className="flex-row items-start justify-between gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive">
                    <Icon aria-hidden="true" className="size-4" />
                  </span>
                  <p className="text-2xl font-semibold tracking-tight">{item.value}</p>
                </CardHeader>
                <CardContent>
                  <CardTitle className="text-base">{item.label}</CardTitle>
                  <CardDescription className="mt-1.5">{item.description}</CardDescription>
                  <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">Review <ArrowRight aria-hidden="true" className="size-3.5" /></span>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
