import { ArrowRight, ClipboardList, PackageCheck, Truck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function InventoryTransferWorkspace({
  awaitingReceiptCount,
  replenishmentHref,
}: {
  awaitingReceiptCount: number;
  replenishmentHref: string;
}) {
  return (
    <section className="space-y-4" aria-labelledby="inventory-transfer-workspace-title">
      <Card>
        <CardHeader className="flex-row items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
            <Truck aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <CardTitle id="inventory-transfer-workspace-title">Move stock between stores</CardTitle>
            <CardDescription>
              Create and manage store-to-store requests in Restock items. Stock leaves the source only when it is sent and reaches the destination only when it is received.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="grid gap-2 text-sm sm:grid-cols-4" aria-label="Transfer workflow stages">
            <WorkflowStage icon={<ClipboardList aria-hidden="true" />} label="Requested" />
            <WorkflowStage icon={<ArrowRight aria-hidden="true" />} label="Approved & picked" />
            <WorkflowStage icon={<Truck aria-hidden="true" />} label="In transit" />
            <WorkflowStage icon={<PackageCheck aria-hidden="true" />} label="Received" />
          </ol>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3">
            <p className="text-sm text-muted-foreground">
              Restock suggestions only prepare a request. They never create a transfer or move stock automatically.
            </p>
            <Link className={buttonVariants()} href={replenishmentHref}>Open restock items <ArrowRight /></Link>
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <p className="font-medium">Transfers awaiting receipt</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Complete or partially receive shipped transfers below. Destination balances remain unchanged until receipt.
            </p>
          </div>
          <Badge variant={awaitingReceiptCount ? "secondary" : "outline"}>
            {awaitingReceiptCount} awaiting receipt
          </Badge>
        </CardContent>
      </Card>
    </section>
  );
}

function WorkflowStage({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <li className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 font-medium">
      <span className="text-primary">{icon}</span>
      {label}
    </li>
  );
}
