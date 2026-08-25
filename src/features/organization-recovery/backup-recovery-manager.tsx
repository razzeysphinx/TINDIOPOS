"use client";

import { CheckCircle2, CloudCog, Download, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { useState, useTransition } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  recordOrganizationRecoveryDrillAction,
  refreshOrganizationRecoverySnapshotAction,
} from "@/features/organization-recovery/actions";
import type {
  OrganizationRecoverySnapshot,
  RecoveryDrillOutcome,
  RecoveryDrillType,
} from "@/features/organization-recovery/types";

const drillLabels: Record<RecoveryDrillType, string> = {
  EXPORT_REVIEW: "Export review",
  LOCAL_RESTORE: "Local restore",
  SUPABASE_RESTORE_OR_CLONE: "Supabase restore or clone",
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function defaultRecoveryPoint() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

export function BackupRecoveryManager({
  organizationId,
  canExport,
  canViewRecovery,
  canManageRecovery,
  initialSnapshot,
}: {
  organizationId: string;
  canExport: boolean;
  canViewRecovery: boolean;
  canManageRecovery: boolean;
  initialSnapshot: OrganizationRecoverySnapshot | null;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [message, setMessage] = useState<string | null>(null);
  const [drillType, setDrillType] = useState<RecoveryDrillType>("LOCAL_RESTORE");
  const [outcome, setOutcome] = useState<RecoveryDrillOutcome>("PASSED");
  const [recoveryPointAt, setRecoveryPointAt] = useState(defaultRecoveryPoint);
  const [durationMinutes, setDurationMinutes] = useState("10");
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();

  const refreshSnapshot = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await refreshOrganizationRecoverySnapshotAction(organizationId);
      setMessage(result.message);

      if (result.ok) {
        setSnapshot(result.snapshot);
      }
    });
  };

  const recordDrill = () => {
    const date = new Date(recoveryPointAt);
    const duration = Number(durationMinutes);

    if (Number.isNaN(date.getTime()) || !Number.isInteger(duration)) {
      setMessage("Enter a valid recovery point and whole-number duration.");
      return;
    }

    setMessage(null);
    startTransition(async () => {
      const result = await recordOrganizationRecoveryDrillAction({
        organizationId,
        drillType,
        outcome,
        recoveryPointAt: date.toISOString(),
        durationMinutes: duration,
        notes,
      });
      setMessage(result.message);

      if (result.ok) {
        setSnapshot(result.snapshot);
        setNotes("");
      }
    });
  };

  if (!canViewRecovery) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CloudCog aria-hidden="true" />Backup & recovery</CardTitle>
          <CardDescription>Recovery readiness is limited to the owner and authorized administrators.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const latestExport = snapshot?.latest_delivered_export;
  const latestDrill = snapshot?.latest_recovery_drill;
  const recoveryStatusAvailable = snapshot !== null;

  return (
    <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CloudCog aria-hidden="true" />Backup & recovery</CardTitle>
          <CardDescription>
            TINDIO records completed export delivery and recovery-drill evidence. A tenant export is a portable data copy, not a replacement for your Supabase platform backup.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-2">
            <ReadinessItem
              label="Latest delivered export"
              value={latestExport ? formatTime(latestExport.delivered_at) : recoveryStatusAvailable ? "No completed export yet" : "Status unavailable"}
              detail={latestExport ? `${latestExport.record_count.toLocaleString()} records · ${latestExport.format}` : recoveryStatusAvailable ? "Download an export and keep an off-site copy." : "Select Refresh status to retry."}
            />
            <ReadinessItem
              label="Latest recovery drill"
              value={latestDrill ? `${latestDrill.outcome === "PASSED" ? "Passed" : "Failed"} · ${formatTime(latestDrill.recorded_at)}` : recoveryStatusAvailable ? "Not recorded yet" : "Status unavailable"}
              detail={latestDrill ? `${drillLabels[latestDrill.drill_type]} · ${latestDrill.duration_minutes} minute(s)` : recoveryStatusAvailable ? "Test a restore before relying on a recovery process." : "Select Refresh status to retry."}
            />
            <ReadinessItem
              label="Audit-log minimum"
              value={snapshot ? `${Math.round(snapshot.governance.audit_retention_days / 365)} years` : "Status unavailable"}
              detail={snapshot ? "Automatic destructive purge is disabled." : "Select Refresh status to retry."}
            />
            <ReadinessItem
              label="Archive readiness"
              value={snapshot ? snapshot.archive_export_is_current ? "Fresh export not required" : "Fresh export required" : "Status unavailable"}
              detail={snapshot ? "An archive request requires a new, completed export before TINDIO will archive the business." : "Select Refresh status to retry."}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {canExport ? (
              <a className={buttonVariants({ variant: "outline" })} href="/api/organization-export">
                <Download />Download export
              </a>
            ) : null}
            <Button disabled={isPending} onClick={refreshSnapshot} type="button" variant="outline">
              {isPending ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
              Refresh status
            </Button>
          </div>
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            Keep exports in a secure, off-site location. TINDIO does not claim that a browser download has been retained after it leaves the device.
          </p>
          {message ? <p aria-live="polite" className="text-sm text-muted-foreground">{message}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck aria-hidden="true" />Recovery drill record</CardTitle>
          <CardDescription>
            Record the outcome only after you have reviewed an export or restored it in an isolated local database, clone, or approved recovery environment.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {canManageRecovery ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-medium" htmlFor="recovery-drill-type">
                  Drill type
                  <select
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    disabled={isPending}
                    id="recovery-drill-type"
                    onChange={(event) => setDrillType(event.target.value as RecoveryDrillType)}
                    value={drillType}
                  >
                    {Object.entries(drillLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className="grid gap-2 text-sm font-medium" htmlFor="recovery-drill-outcome">
                  Outcome
                  <select
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    disabled={isPending}
                    id="recovery-drill-outcome"
                    onChange={(event) => setOutcome(event.target.value as RecoveryDrillOutcome)}
                    value={outcome}
                  >
                    <option value="PASSED">Passed</option>
                    <option value="FAILED">Failed</option>
                  </select>
                </label>
                <label className="grid gap-2 text-sm font-medium" htmlFor="recovery-point-at">
                  Recovery point tested
                  <input
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    disabled={isPending}
                    id="recovery-point-at"
                    max={defaultRecoveryPoint()}
                    onChange={(event) => setRecoveryPointAt(event.target.value)}
                    type="datetime-local"
                    value={recoveryPointAt}
                  />
                </label>
                <label className="grid gap-2 text-sm font-medium" htmlFor="recovery-duration">
                  Duration in minutes
                  <input
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    disabled={isPending}
                    id="recovery-duration"
                    max="10080"
                    min="0"
                    onChange={(event) => setDurationMinutes(event.target.value)}
                    step="1"
                    type="number"
                    value={durationMinutes}
                  />
                </label>
              </div>
              <label className="grid gap-2 text-sm font-medium" htmlFor="recovery-drill-notes">
                Evidence and result
                <textarea
                  className="min-h-24 rounded-lg border border-input bg-background p-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  disabled={isPending}
                  id="recovery-drill-notes"
                  maxLength={1000}
                  minLength={10}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Example: Restored the downloaded export into an isolated test database and verified the organization, catalog, sales, and receipts."
                  value={notes}
                />
              </label>
              <Button disabled={isPending} onClick={recordDrill} type="button">
                {isPending ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />}
                Record recovery drill
              </Button>
            </>
          ) : (
            <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
              Only the organization owner can record a recovery-drill result. Administrators can view its readiness.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function ReadinessItem({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  );
}
