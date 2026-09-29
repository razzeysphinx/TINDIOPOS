import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Network,
  RadioTower,
  RefreshCcw,
  ShieldAlert,
} from "lucide-react";

import {
  Badge,
} from "@/components/ui/badge";

export type SyncControlDeviceItem = {
  deviceId: string;
  deviceName: string;
  storeId: string;
  storeName: string;
  registerId: string;
  registerName: string;
  employeeId: string;
  employeeName: string;
  connectionMode:
    | "CLOUD_ONLINE"
    | "STORE_LOCAL"
    | "DEVICE_ISOLATED"
    | "RECOVERING"
    | "SYNC_REVIEW";
  appVersion: string;
  lastHeartbeatAt: string;
  lastSuccessfulSyncAt: string | null;
  deviceCheckpoint: number;
  serverCheckpoint: number;
  queueDepth: number;
  conflictCount: number;
  failedCount: number;
  offlineSince: string | null;
};

function dateTime(value: string | null) {
  if (!value) return "Never";

  return new Intl.DateTimeFormat(
    "en-PH",
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
  ).format(
    new Date(value),
  );
}

function duration(value: string | null) {
  if (!value) return "Online";

  const milliseconds =
    Date.now()
    - new Date(value).getTime();

  if (!Number.isFinite(milliseconds)) {
    return "Unknown";
  }

  const minutes =
    Math.max(
      0,
      Math.floor(
        milliseconds / 60_000,
      ),
    );

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours =
    Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ${minutes % 60}m`;
  }

  const days =
    Math.floor(hours / 24);

  return `${days}d ${hours % 24}h`;
}

function heartbeatAgeMinutes(
  value: string,
) {
  return Math.max(
    0,
    Math.floor(
      (
        Date.now()
        - new Date(value).getTime()
      ) / 60_000,
    ),
  );
}

function statusFor(
  item: SyncControlDeviceItem,
) {
  const heartbeatAge =
    heartbeatAgeMinutes(
      item.lastHeartbeatAt,
    );

  if (
    item.connectionMode === "SYNC_REVIEW"
    || item.conflictCount > 0
    || item.failedCount > 0
  ) {
    return {
      level: "critical" as const,
      label: "ATTENTION REQUIRED",
      reason:
        "Conflict or failed durable operation requires review.",
    };
  }

  if (
    item.connectionMode === "RECOVERING"
    || item.queueDepth > 0
    || heartbeatAge >= 5
  ) {
    return {
      level: "warning" as const,
      label: "CHECK REQUIRED",
      reason:
        heartbeatAge >= 5
          ? `Heartbeat is ${heartbeatAge} minute(s) old.`
          : "Synchronization has not fully settled.",
    };
  }

  return {
    level: "healthy" as const,
    label: "HEALTHY",
    reason:
      "No currently reported sync issue.",
  };
}

function modeIcon(
  mode: SyncControlDeviceItem["connectionMode"],
) {
  if (mode === "CLOUD_ONLINE") {
    return <Cloud aria-hidden="true" />;
  }

  if (mode === "STORE_LOCAL") {
    return <Network aria-hidden="true" />;
  }

  if (mode === "RECOVERING") {
    return <RefreshCcw aria-hidden="true" />;
  }

  if (mode === "SYNC_REVIEW") {
    return <ShieldAlert aria-hidden="true" />;
  }

  return <RadioTower aria-hidden="true" />;
}

export function SyncControlCenterDeviceHealth({
  devices,
}: {
  devices: SyncControlDeviceItem[];
}) {
  const critical =
    devices.filter(
      (device) =>
        statusFor(device).level
        === "critical",
    ).length;

  const warning =
    devices.filter(
      (device) =>
        statusFor(device).level
        === "warning",
    ).length;

  const queued =
    devices.reduce(
      (total, device) =>
        total + device.queueDepth,
      0,
    );

  return (
    <section className="space-y-5">
      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard
          label="Reporting devices"
          value={devices.length}
        />
        <SummaryCard
          label="Attention required"
          value={critical}
        />
        <SummaryCard
          label="Check required"
          value={warning}
        />
        <SummaryCard
          label="Reported queue depth"
          value={queued}
        />
      </div>

      {devices.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
          No native device telemetry has reached TINDIO yet.
        </div>
      ) : (
        <div className="grid gap-4">
          {devices.map((device) => {
            const status =
              statusFor(device);

            const checkpointGap =
              Math.max(
                0,
                device.deviceCheckpoint
                - device.serverCheckpoint,
              );

            return (
              <article
                className="rounded-2xl border bg-card p-5 shadow-sm"
                key={device.deviceId}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">
                        {device.deviceName}
                      </h3>

                      <Badge
                        variant={
                          status.level === "critical"
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {status.level === "healthy"
                          ? <CheckCircle2 aria-hidden="true" />
                          : <AlertTriangle aria-hidden="true" />}

                        {status.label}
                      </Badge>

                      <Badge variant="outline">
                        {modeIcon(
                          device.connectionMode,
                        )}

                        {device.connectionMode.replaceAll(
                          "_",
                          " ",
                        )}
                      </Badge>
                    </div>

                    <p className="mt-2 text-sm text-muted-foreground">
                      {device.storeName}
                      {" · "}
                      {device.registerName}
                      {" · "}
                      {device.employeeName}
                    </p>

                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {device.deviceId}
                    </p>
                  </div>

                  <div className="text-right text-xs text-muted-foreground">
                    <p>
                      App {device.appVersion}
                    </p>
                    <p>
                      Heartbeat{" "}
                      {dateTime(
                        device.lastHeartbeatAt,
                      )}
                    </p>
                  </div>
                </div>

                <p className="mt-4 rounded-lg bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  {status.reason}
                </p>

                <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Metric
                    label="Last successful sync"
                    value={dateTime(
                      device.lastSuccessfulSyncAt,
                    )}
                  />
                  <Metric
                    label="Offline duration"
                    value={duration(
                      device.offlineSince,
                    )}
                  />
                  <Metric
                    label="Device checkpoint"
                    value={device.deviceCheckpoint}
                  />
                  <Metric
                    label="Server checkpoint"
                    value={device.serverCheckpoint}
                  />
                  <Metric
                    label="Checkpoint gap"
                    value={checkpointGap}
                  />
                  <Metric
                    label="Queue depth"
                    value={device.queueDepth}
                  />
                  <Metric
                    label="Conflicts"
                    value={device.conflictCount}
                  />
                  <Metric
                    label="Failed"
                    value={device.failedCount}
                  />
                </dl>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold">
        {value}
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-semibold">
        {value}
      </dd>
    </div>
  );
}
