import { Activity, AlertTriangle, CheckCircle2, Database } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { acknowledgeOperationalAlertAction } from "@/features/observability/actions";

export type ProductionObservabilityDevice = {
  deviceId: string; deviceName: string; deviceStatus: "active" | "revoked"; storeName: string; registerName: string; employeeName: string;
  connectionMode: "CLOUD_ONLINE" | "STORE_LOCAL" | "DEVICE_ISOLATED" | "RECOVERING" | "SYNC_REVIEW"; appVersion: string;
  lastHeartbeatAt: string; lastSuccessfulSyncAt: string | null; offlineSince: string | null; deviceCheckpoint: number; serverCheckpoint: number;
  queueDepth: number; conflictCount: number; failedCount: number; crashCount: number; crashWindowStartedAt: string | null; lastCrashAt: string | null; anrCount: number; lastAnrAt: string | null;
  apiAverageLatencyMs: number; apiMaxLatencyMs: number; apiFailureCount: number; syncAverageLatencyMs: number; syncMaxLatencyMs: number;
  localDatabaseHealth: "HEALTHY" | "CHECK_REQUIRED" | "UNAVAILABLE" | "UNKNOWN"; localSchemaVersion: number;
};

export type ProductionOperationalAlert = {
  alertId: string; deviceId: string; alertType: "APP_CRASH" | "ANR" | "API_OUTAGE" | "STALE_QUEUE";
  severity: "WARNING" | "CRITICAL"; status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  assignedEmployeeName: string; escalationChannel: string; runbookKey: "APP_CRASH" | "ANR" | "API_OUTAGE" | "STALE_QUEUE";
  diagnostic: Record<string, unknown>; occurrenceCount: number; lastDetectedAt: string; acknowledgedAt: string | null;
};

const dateTime = (value: string | null) => value ? new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Never";
const ageMinutes = (value: string) => { const milliseconds = Date.now() - new Date(value).getTime(); return Number.isFinite(milliseconds) ? Math.max(0, Math.floor(milliseconds / 60_000)) : Number.MAX_SAFE_INTEGER; };
const duration = (value: string | null) => { if (!value) return "Online"; const minutes = ageMinutes(value); return minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${Math.floor(minutes / 1440)}d`; };
const checkpointGap = (device: ProductionObservabilityDevice) => Math.max(0, device.deviceCheckpoint - device.serverCheckpoint);
const crashRatePer24h = (device: ProductionObservabilityDevice) => !device.crashWindowStartedAt || device.crashCount <= 0 ? 0 : device.crashCount / Math.max(1, (Date.now() - new Date(device.crashWindowStartedAt).getTime()) / 3_600_000) * 24;

function healthFor(device: ProductionObservabilityDevice) {
  const heartbeatAge = ageMinutes(device.lastHeartbeatAt);
  if (device.deviceStatus === "active" && (device.connectionMode === "SYNC_REVIEW" || device.conflictCount > 0 || device.failedCount > 0 || device.localDatabaseHealth === "UNAVAILABLE" || heartbeatAge >= 15 || (checkpointGap(device) > 0 && device.queueDepth > 0))) return { level: "critical" as const, label: "ATTENTION REQUIRED" };
  if (device.deviceStatus === "active" && (device.queueDepth > 0 || device.offlineSince !== null || heartbeatAge >= 5 || device.apiFailureCount > 0 || device.apiAverageLatencyMs >= 2_000 || device.syncAverageLatencyMs >= 30_000 || device.localDatabaseHealth !== "HEALTHY" || device.crashCount > 0 || device.anrCount > 0)) return { level: "warning" as const, label: "CHECK REQUIRED" };
  return { level: "healthy" as const, label: "HEALTHY" };
}

const runbook: Record<ProductionOperationalAlert["runbookKey"], string> = {
  APP_CRASH: "Preserve device data, identify app version, restart once, and escalate repeated crashes without clearing app storage.",
  ANR: "Record the affected workflow and app version, preserve local custody, restart once, and escalate recurring unresponsiveness.",
  API_OUTAGE: "Confirm service reachability, keep the device in its safe offline mode, and reconcile through the existing sync path after recovery.",
  STALE_QUEUE: "Do not clear app data. Reconnect, use Sync Review, and reconcile each unresolved financial obligation through the existing recovery controls.",
};

function diagnosticSummary(alert: ProductionOperationalAlert) {
  const diagnostic = alert.diagnostic;
  if (alert.alertType === "APP_CRASH") return `App ${String(diagnostic.app_version ?? "unknown")} · crashes ${Number(diagnostic.crash_count ?? 0)}`;
  if (alert.alertType === "ANR") return `App ${String(diagnostic.app_version ?? "unknown")} · unresponsive incidents ${Number(diagnostic.anr_count ?? 0)}`;
  if (alert.alertType === "API_OUTAGE") return `App ${String(diagnostic.app_version ?? "unknown")} · ${String(diagnostic.connection_mode ?? "unknown")} · API failures ${Number(diagnostic.api_failure_count ?? 0)}`;
  return `App ${String(diagnostic.app_version ?? "unknown")} · queue ${Number(diagnostic.queue_depth ?? 0)} · failed ${Number(diagnostic.failed_count ?? 0)} · conflicts ${Number(diagnostic.conflict_count ?? 0)}`;
}

export function ProductionObservabilityCenter({ alerts, devices, serverDatabaseHealth, serverDatabaseProbeLatencyMs }: { alerts: ProductionOperationalAlert[]; devices: ProductionObservabilityDevice[]; serverDatabaseHealth: "HEALTHY" | "UNAVAILABLE"; serverDatabaseProbeLatencyMs: number }) {
  const active = devices.filter((device) => device.deviceStatus === "active");
  const attention = active.filter((device) => healthFor(device).level === "critical").length;
  const warnings = active.filter((device) => healthFor(device).level === "warning").length;
  return <section className="space-y-6">
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6"><SummaryCard label="Reporting terminals" value={active.length} /><SummaryCard label="Attention required" value={attention} /><SummaryCard label="Check required" value={warnings} /><SummaryCard label="Pending queue" value={active.reduce((total, device) => total + device.queueDepth, 0)} /><SummaryCard label="Crash count" value={active.reduce((total, device) => total + device.crashCount, 0)} /><SummaryCard label="Local DB issues" value={active.filter((device) => device.localDatabaseHealth !== "HEALTHY").length} /></div>
    <div className="rounded-2xl border bg-card p-5 shadow-sm"><div className="flex items-center justify-between gap-4"><div className="flex items-center gap-3"><Database className="size-5" /><div><h2 className="font-semibold">Server database health</h2><p className="text-sm text-muted-foreground">Tenant-scoped Back Office probe only.</p></div></div><Badge variant={serverDatabaseHealth === "HEALTHY" ? "secondary" : "destructive"}>{serverDatabaseHealth}</Badge></div><p className="mt-4 text-sm">Probe latency: <strong>{serverDatabaseProbeLatencyMs} ms</strong></p></div>
    <div className="space-y-3 rounded-2xl border bg-card p-5 shadow-sm"><div><h2 className="font-semibold">Routed operational alerts</h2><p className="text-sm text-muted-foreground">Every alert is assigned to a named devices manager and contains aggregate diagnostics only.</p></div>{alerts.length === 0 ? <p className="text-sm text-muted-foreground">No operational alerts are currently recorded.</p> : alerts.map((alert) => <article className="space-y-3 rounded-xl border p-4" key={alert.alertId}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><Badge variant={alert.severity === "CRITICAL" ? "destructive" : "secondary"}>{alert.alertType.replaceAll("_", " ")}</Badge><Badge variant="outline">{alert.status}</Badge></div><p className="mt-2 text-sm font-medium">{diagnosticSummary(alert)}</p><p className="mt-1 text-xs text-muted-foreground">Last detected {dateTime(alert.lastDetectedAt)} · occurrences {alert.occurrenceCount}</p></div>{alert.status === "OPEN" ? <form action={acknowledgeOperationalAlertAction}><input name="alertId" type="hidden" value={alert.alertId} /><Button type="submit" variant="outline">Acknowledge</Button></form> : null}</div><div className="grid gap-2 text-sm md:grid-cols-2"><p><strong>Operator:</strong> {alert.assignedEmployeeName}</p><p><strong>Escalation:</strong> {alert.escalationChannel}</p></div><p className="rounded-lg bg-muted/30 p-3 text-sm"><strong>Runbook:</strong> {runbook[alert.runbookKey]}</p></article>)}</div>
    {devices.length === 0 ? <div className="rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">No terminal observability has reached TINDIO yet.</div> : <div className="grid gap-4">{devices.map((device) => { const health = healthFor(device); return <article className="rounded-2xl border bg-card p-5 shadow-sm" key={device.deviceId}><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{device.deviceName}</h3><Badge variant={health.level === "critical" ? "destructive" : "secondary"}>{health.level === "healthy" ? <CheckCircle2 /> : <AlertTriangle />}{health.label}</Badge><Badge variant="outline">{device.connectionMode.replaceAll("_", " ")}</Badge></div><p className="mt-2 text-sm text-muted-foreground">{device.storeName} · {device.registerName} · {device.employeeName}</p></div><div className="text-right text-xs text-muted-foreground"><p>App {device.appVersion}</p><p>Heartbeat {dateTime(device.lastHeartbeatAt)}</p></div></div><div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Offline duration" value={duration(device.offlineSince)} /><Metric label="Pending queue" value={device.queueDepth} /><Metric label="Sync failures" value={device.failedCount} /><Metric label="Conflicts" value={device.conflictCount} /><Metric label="Checkpoint gap" value={checkpointGap(device)} /><Metric label="Last successful sync" value={dateTime(device.lastSuccessfulSyncAt)} /><Metric label="API avg / max" value={`${device.apiAverageLatencyMs} / ${device.apiMaxLatencyMs} ms`} /><Metric label="API failures" value={device.apiFailureCount} /><Metric label="Sync avg / max" value={`${device.syncAverageLatencyMs} / ${device.syncMaxLatencyMs} ms`} /><Metric label="Crash count" value={device.crashCount} /><Metric label="Crash rate" value={`${crashRatePer24h(device).toFixed(2)} / 24h`} /><Metric label="Last crash" value={dateTime(device.lastCrashAt)} /><Metric label="ANR count" value={device.anrCount} /><Metric label="Last ANR" value={dateTime(device.lastAnrAt)} /><Metric label="Local database" value={device.localDatabaseHealth} /><Metric label="SQLite schema" value={device.localSchemaVersion} /><Metric label="Heartbeat age" value={`${ageMinutes(device.lastHeartbeatAt)} min`} /></div></article>; })}</div>}
    <div className="rounded-xl border bg-muted/25 px-4 py-3 text-sm text-muted-foreground"><div className="flex items-start gap-2"><Activity className="mt-0.5 size-4 shrink-0" /><p>Observability stores aggregate operational health only. It does not display merchant transaction content, customer records, payment credentials, access tokens, device secrets, exception messages, or stack traces.</p></div></div>
  </section>;
}

function SummaryCard({ label, value }: { label: string; value: number }) { return <div className="rounded-xl border bg-card p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div>; }
function Metric({ label, value }: { label: string; value: string | number }) { return <div className="rounded-lg bg-muted/30 px-3 py-2"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-sm font-semibold">{value}</p></div>; }
