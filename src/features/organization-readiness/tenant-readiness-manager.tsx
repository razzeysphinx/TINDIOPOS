"use client";

import {
  Archive,
  CircleAlert,
  Download,
  Gauge,
  LoaderCircle,
  PauseCircle,
  PlayCircle,
  RefreshCw,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getOrganizationUsageAction,
  manageOrganizationLifecycleAction,
} from "@/features/organization-readiness/actions";
import type { OrganizationUsageSnapshot } from "@/features/organization-readiness/organization-readiness-types";

type OrganizationStatus = "active" | "suspended" | "archived";

function formatCurrency(amountMinor: number, currencyCode: string) {
  return new Intl.NumberFormat("en-PH", {
    currency: currencyCode,
    style: "currency",
  }).format(amountMinor / 100);
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function TenantReadinessManager({
  organizationId,
  organizationName,
  currencyCode,
  status,
  suspensionReason,
  archiveRequestedAt,
  canViewUsage,
  canManageLifecycle,
}: {
  organizationId: string;
  organizationName: string;
  currencyCode: string;
  status: OrganizationStatus;
  suspensionReason: string | null;
  archiveRequestedAt: string | null;
  canViewUsage: boolean;
  canManageLifecycle: boolean;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [usage, setUsage] = useState<OrganizationUsageSnapshot | null>(null);
  const [isLifecyclePending, startLifecycleTransition] = useTransition();
  const [isUsagePending, startUsageTransition] = useTransition();

  const runLifecycleAction = (action: "SUSPEND" | "RESUME" | "REQUEST_ARCHIVE" | "CANCEL_ARCHIVE" | "ARCHIVE") => {
    setMessage(null);
    startLifecycleTransition(async () => {
      const result = await manageOrganizationLifecycleAction({
        organizationId,
        action,
        reason,
      });
      setMessage(result.message);

      if (result.ok) {
        if (action === "SUSPEND" || action === "ARCHIVE") {
          router.replace("/organization-paused");
        } else {
          router.refresh();
        }
      }
    });
  };

  const refreshUsage = () => {
    setMessage(null);
    startUsageTransition(async () => {
      const result = await getOrganizationUsageAction(organizationId);
      if (result.ok) {
        setUsage(result.usage);
        setMessage("Usage snapshot refreshed.");
      } else {
        setMessage(result.message);
      }
    });
  };

  const statusCopy: Record<OrganizationStatus, string> = {
    active: "This business is operational. Tenant data remains isolated from every other TINDIO organization.",
    suspended: "Operations are paused. Historical records remain retained, and only an owner can resume the business.",
    archived: "This business is archived. Historical records are retained; TINDIO never deletes the tenant from this workflow.",
  };

  return (
    <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Gauge aria-hidden="true" />Tenant readiness</CardTitle>
          <CardDescription>{statusCopy[status]}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-4 text-sm">
            <p className="font-semibold">{organizationName}</p>
            <p className="mt-1 text-muted-foreground">Status: <span className="font-medium capitalize text-foreground">{status}</span></p>
            {suspensionReason ? <p className="mt-2 text-muted-foreground">Pause reason: {suspensionReason}</p> : null}
            {archiveRequestedAt ? <p className="mt-2 text-muted-foreground">Archive requested {formatTime(archiveRequestedAt)}. Download a fresh export before archiving.</p> : null}
          </div>

          {canViewUsage ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button disabled={isUsagePending} onClick={refreshUsage} type="button" variant="outline">
                  {isUsagePending ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                  Refresh usage
                </Button>
                <a className={buttonVariants({ variant: "outline" })} href="/api/organization-export">
                  <Download />Download export
                </a>
              </div>
              {usage ? (
                <dl className="grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-2">
                  <UsageItem label="Active stores" value={String(usage.active_store_count)} />
                  <UsageItem label="Active staff" value={String(usage.active_employee_count)} />
                  <UsageItem label="Active products" value={String(usage.active_product_count)} />
                  <UsageItem label="Customers" value={String(usage.customer_count)} />
                  <UsageItem label="Sales today" value={String(usage.completed_sale_count)} />
                  <UsageItem label="Sales today value" value={formatCurrency(usage.completed_sales_total_minor, currencyCode)} />
                  <UsageItem label="Offline work needing review" value={String(usage.pending_offline_sync_count)} />
                  <UsageItem label="Captured" value={formatTime(usage.captured_at)} />
                </dl>
              ) : null}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
              An owner or administrator with <span className="font-mono text-xs">organization.export</span> can view usage and download an export.
            </p>
          )}
          <a className={buttonVariants({ variant: "outline" })} href="/onboarding?add=1">
            Create another business
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Archive aria-hidden="true" />Safe organization lifecycle</CardTitle>
          <CardDescription>
            Suspension pauses operations immediately. Archiving requires a recorded archive request and a fresh export; neither action deletes historical data.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {canManageLifecycle ? (
            <>
              {(status === "active" || status === "suspended") && !archiveRequestedAt ? (
                <label className="grid gap-2 text-sm font-medium" htmlFor="organization-lifecycle-reason">
                  Reason for suspension or archive request
                  <textarea
                    className="min-h-20 rounded-lg border border-input bg-background p-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    disabled={isLifecyclePending}
                    id="organization-lifecycle-reason"
                    maxLength={500}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Explain why this business is being paused or archived."
                    value={reason}
                  />
                </label>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {status === "active" && !archiveRequestedAt ? (
                  <Button disabled={isLifecyclePending} onClick={() => runLifecycleAction("SUSPEND")} type="button" variant="outline">
                    <PauseCircle />Suspend operations
                  </Button>
                ) : null}
                {status === "suspended" ? (
                  <Button disabled={isLifecyclePending} onClick={() => runLifecycleAction("RESUME")} type="button">
                    <PlayCircle />Resume operations
                  </Button>
                ) : null}
                {status !== "archived" && !archiveRequestedAt ? (
                  <Button disabled={isLifecyclePending} onClick={() => runLifecycleAction("REQUEST_ARCHIVE")} type="button" variant="outline">
                    <Archive />Request archive
                  </Button>
                ) : null}
                {status !== "archived" && archiveRequestedAt ? (
                  <>
                    <Button disabled={isLifecyclePending} onClick={() => runLifecycleAction("CANCEL_ARCHIVE")} type="button" variant="outline">
                      Cancel archive
                    </Button>
                    <Button disabled={isLifecyclePending} onClick={() => runLifecycleAction("ARCHIVE")} type="button" variant="destructive">
                      <Archive />Archive safely
                    </Button>
                  </>
                ) : null}
              </div>
              {archiveRequestedAt ? (
                <p className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-foreground">
                  <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-700" />
                  Download a new export from this panel, then choose “Archive safely.” The database verifies both steps and retains the records.
                </p>
              ) : null}
            </>
          ) : (
            <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
              Only the organization owner can suspend, resume, or archive this business.
            </p>
          )}
          {message ? <p aria-live="polite" className="text-sm text-muted-foreground">{message}</p> : null}
        </CardContent>
      </Card>
    </section>
  );
}

function UsageItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-semibold">{value}</dd>
    </div>
  );
}
