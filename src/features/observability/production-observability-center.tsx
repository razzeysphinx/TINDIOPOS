import { Activity, AlertTriangle, CheckCircle2, Database } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type ProductionObservabilityDevice = {
  deviceId: string; deviceName: string; deviceStatus: "active" | "revoked"; storeName: string; registerName: string; employeeName: string;
  connectionMode: "CLOUD_ONLINE" | "STORE_LOCAL" | "DEVICE_ISOLATED" | "RECOVERING" | "SYNC_REVIEW"; appVersion: string;
  lastHeartbeatAt: string; lastSuccessfulSyncAt: string | null; offlineSince: string | null; deviceCheckpoint: number; serverCheckpoint: number;
  queueDepth: number; conflictCount: number; failedCount: number; crashCount: number; crashWindowStartedAt: string | null; lastCrashAt: string | null;
  apiAverageLatencyMs: number; apiMaxLatencyMs: number; apiFailureCount: number; syncAverageLatencyMs: number; syncMaxLatencyMs: number;
  localDatabaseHealth: "HEALTHY" | "CHECK_REQUIRED" | "UNAVAILABLE" | "UNKNOWN"; localSchemaVersion: number;
};

const dateTime = (value: string | null) => value ? new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Never";
const ageMinutes = (value: string) => { const milliseconds = Date.now() - new Date(value).getTime(); return Number.isFinite(milliseconds) ? Math.max(0, Math.floor(milliseconds / 60_000)) : Number.MAX_SAFE_INTEGER; };
const duration = (value: string | null) => { if (!value) return "Online"; const minutes = ageMinutes(value); return minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${Math.floor(minutes / 1440)}d`; };
const checkpointGap = (device: ProductionObservabilityDevice) => Math.max(0, device.deviceCheckpoint - device.serverCheckpoint);
const crashRatePer24h = (device: ProductionObservabilityDevice) => !device.crashWindowStartedAt || device.crashCount <= 0 ? 0 : device.crashCount / Math.max(1, (Date.now() - new Date(device.crashWindowStartedAt).getTime()) / 3_600_000) * 24;

function healthFor(device: ProductionObservabilityDevice) {
  const heartbeatAge = ageMinutes(device.lastHeartbeatAt);
  if (device.deviceStatus === "active" && (device.connectionMode === "SYNC_REVIEW" || device.conflictCount > 0 || device.failedCount > 0 || device.localDatabaseHealth === "UNAVAILABLE" || heartbeatAge >= 15 || (checkpointGap(device) > 0 && device.queueDepth > 0))) return { level: "critical" as const, label: "ATTENTION REQUIRED" };
  if (device.deviceStatus === "active" && (device.queueDepth > 0 || device.offlineSince !== null || heartbeatAge >= 5 || device.apiFailureCount > 0 || device.apiAverageLatencyMs >= 2_000 || device.syncAverageLatencyMs >= 30_000 || device.localDatabaseHealth !== "HEALTHY" || device.crashCount > 0)) return { level: "warning" as const, label: "CHECK REQUIRED" };
  return { level: "healthy" as const, label: "HEALTHY" };
}

export function ProductionObservabilityCenter({ devices, serverDatabaseHealth, serverDatabaseProbeLatencyMs }: { devices: ProductionObservabilityDevice[]; serverDatabaseHealth: "HEALTHY" | "UNAVAILABLE"; serverDatabaseProbeLatencyMs: number }) {
  const active = devices.filter((device) => device.deviceStatus === "active");
  const attention = active.filter((device) => healthFor(device).level === "critical").length;
  const warnings = active.filter((device) => healthFor(device).level === "warning").length;
  return <section className="space-y-6">
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6"><SummaryCard label="Reporting terminals" value={active.length} /><SummaryCard label="Attention required" value={attention} /><SummaryCard label="Check required" value={warnings} /><SummaryCard label="Pending queue" value={active.reduce((total, device) => total + device.queueDepth, 0)} /><SummaryCard label="Crash count" value={active.reduce((total, device) => total + device.crashCount, 0)} /><SummaryCard label="Local DB issues" value={active.filter((device) => device.localDatabaseHealth !== "HEALTHY").length} /></div>
    <div className="rounded-2xl border bg-card p-5 shadow-sm"><div className="flex items-center justify-between gap-4"><div className="flex items-center gap-3"><Database className="size-5" /><div><h2 className="font-semibold">Server database health</h2><p className="text-sm text-muted-foreground">Tenant-scoped Back Office probe only.</p></div></div><Badge variant={serverDatabaseHealth === "HEALTHY" ? "secondary" : "destructive"}>{serverDatabaseHealth}</Badge></div><p className="mt-4 text-sm">Probe latency: <strong>{serverDatabaseProbeLatencyMs} ms</strong></p></div>
    {devices.length === 0 ? <div className="rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">No terminal observability has reached TINDIO yet.</div> : <div className="grid gap-4">{devices.map((device) => { const health = healthFor(device); return <article className="rounded-2xl border bg-card p-5 shadow-sm" key={device.deviceId}><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{device.deviceName}</h3><Badge variant={health.level === "critical" ? "destructive" : "secondary"}>{health.level === "healthy" ? <CheckCircle2 /> : <AlertTriangle />}{health.label}</Badge><Badge variant="outline">{device.connectionMode.replaceAll("_", " ")}</Badge></div><p className="mt-2 text-sm text-muted-foreground">{device.storeName} · {device.registerName} · {device.employeeName}</p></div><div className="text-right text-xs text-muted-foreground"><p>App {device.appVersion}</p><p>Heartbeat {dateTime(device.lastHeartbeatAt)}</p></div></div><div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Offline duration" value={duration(device.offlineSince)} /><Metric label="Pending queue" value={device.queueDepth} /><Metric label="Sync failures" value={device.failedCount} /><Metric label="Conflicts" value={device.conflictCount} /><Metric label="Checkpoint gap" value={checkpointGap(device)} /><Metric label="Last successful sync" value={dateTime(device.lastSuccessfulSyncAt)} /><Metric label="API avg / max" value={`${device.apiAverageLatencyMs} / ${device.apiMaxLatencyMs} ms`} /><Metric label="API failures" value={device.apiFailureCount} /><Metric label="Sync avg / max" value={`${device.syncAverageLatencyMs} / ${device.syncMaxLatencyMs} ms`} /><Metric label="Crash count" value={device.crashCount} /><Metric label="Crash rate" value={`${crashRatePer24h(device).toFixed(2)} / 24h`} /><Metric label="Last crash" value={dateTime(device.lastCrashAt)} /><Metric label="Local database" value={device.localDatabaseHealth} /><Metric label="SQLite schema" value={device.localSchemaVersion} /><Metric label="Heartbeat age" value={`${ageMinutes(device.lastHeartbeatAt)} min`} /></div></article>; })}</div>}
    <div className="rounded-xl border bg-muted/25 px-4 py-3 text-sm text-muted-foreground"><div className="flex items-start gap-2"><Activity className="mt-0.5 size-4 shrink-0" /><p>Observability stores aggregate operational health only. It does not display merchant transaction content, customer records, payment credentials, access tokens, or device secrets.</p></div></div>
  </section>;
}

function SummaryCard({ label, value }: { label: string; value: number }) { return <div className="rounded-xl border bg-card p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div>; }
function Metric({ label, value }: { label: string; value: string | number }) { return <div className="rounded-lg bg-muted/30 px-3 py-2"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-sm font-semibold">{value}</p></div>; }
