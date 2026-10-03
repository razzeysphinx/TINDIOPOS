"use client";

import { AlertTriangle, Cloud, Laptop, LoaderCircle, Network, RadioTower, RefreshCw, RotateCcw, ShieldBan } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { changePosDeviceRegisterAction, registerPosDeviceAction, revokePosDeviceAction } from "@/features/devices/actions";
import { TINDIO_POS_APP_VERSION } from "@/features/devices/device-schema";
import { savePosDeviceIdentity } from "@/features/offline/offline-store";

type Store = { id: string; name: string };
type Register = { id: string; storeId: string; name: string; code: string };
type FleetTelemetry = {
  employeeName: string;
  connectionMode: "CLOUD_ONLINE" | "STORE_LOCAL" | "DEVICE_ISOLATED" | "RECOVERING" | "SYNC_REVIEW";
  lastHeartbeatAt: string;
  lastSuccessfulSyncAt: string | null;
  deviceCheckpoint: number;
  serverCheckpoint: number;
  queueDepth: number;
  conflictCount: number;
  failedCount: number;
  offlineSince: string | null;
};

export type DeviceFleetItem = {
  id: string;
  name: string;
  storeId: string;
  registerId: string;
  status: "active" | "revoked";
  appVersion: string;
  lastSeenAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  telemetry: FleetTelemetry | null;
};

function createIdentity() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return {
    deviceId: crypto.randomUUID(),
    secret: Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(""),
    appVersion: TINDIO_POS_APP_VERSION,
  };
}

function dateTime(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : "Never";
}

function newestContact(device: DeviceFleetItem) {
  return [device.lastSeenAt, device.telemetry?.lastHeartbeatAt ?? null]
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((value) => Number.isFinite(value.getTime()))
    .sort((left, right) => right.getTime() - left.getTime())[0]
    ?.toISOString() ?? null;
}

function connectionIcon(mode: FleetTelemetry["connectionMode"]) {
  if (mode === "CLOUD_ONLINE") return <Cloud className="size-4" />;
  if (mode === "STORE_LOCAL") return <Network className="size-4" />;
  return <RadioTower className="size-4" />;
}

export function DeviceManager({ business, devices, registers, stores }: {
  business: { id: string; name: string };
  devices: DeviceFleetItem[];
  registers: Register[];
  stores: Store[];
}) {
  const router = useRouter();
  const [name, setName] = useState("This POS browser");
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [registerId, setRegisterId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pendingDeviceId, setPendingDeviceId] = useState<string | null>(null);
  const [isRegisteringPending, startRegisteringTransition] = useTransition();
  const [isDeviceActionPending, startDeviceActionTransition] = useTransition();
  const registersForNewDevice = useMemo(() => registers.filter((register) => register.storeId === storeId), [registers, storeId]);
  const activeCount = devices.filter((device) => device.status === "active").length;
  const attentionCount = devices.filter((device) => device.status === "active" && ((device.telemetry?.conflictCount ?? 0) > 0 || (device.telemetry?.failedCount ?? 0) > 0 || device.telemetry?.connectionMode === "SYNC_REVIEW")).length;
  const queued = devices.reduce((total, device) => total + (device.telemetry?.queueDepth ?? 0), 0);

  const registerThisBrowser = () => {
    if (!storeId || !registerId) {
      setMessage("Choose the store and register this browser will use.");
      return;
    }
    const identity = createIdentity();
    startRegisteringTransition(async () => {
      setMessage(null);
      const result = await registerPosDeviceAction({ ...identity, storeId, registerId, name });
      if (!result.ok) return setMessage(result.message);
      try {
        await savePosDeviceIdentity({ organizationId: business.id, ...identity, createdAt: new Date().toISOString() });
        setMessage("This browser is enrolled and assigned to the selected store/register.");
      } catch {
        setMessage("The device was enrolled, but this browser could not save its local credential. Revoke it and enroll again.");
      }
      router.refresh();
    });
  };

  const rebind = (deviceId: string, nextStoreId: string, nextRegisterId: string) => {
    if (!nextStoreId || !nextRegisterId) return;
    setPendingDeviceId(deviceId);
    startDeviceActionTransition(async () => {
      const result = await changePosDeviceRegisterAction({ deviceId, storeId: nextStoreId, registerId: nextRegisterId });
      setMessage(result.message);
      setPendingDeviceId(null);
      if (result.ok) router.refresh();
    });
  };

  const revoke = (device: DeviceFleetItem) => {
    if (!window.confirm(`Disable ${device.name}? It will no longer be able to use TINDIO POS.`)) return;
    setPendingDeviceId(device.id);
    startDeviceActionTransition(async () => {
      const result = await revokePosDeviceAction({ deviceId: device.id, reason: "Device disabled by a fleet manager." });
      setMessage(result.message);
      setPendingDeviceId(null);
      if (result.ok) router.refresh();
    });
  };

  const replace = (device: DeviceFleetItem) => {
    const store = stores.find((candidate) => candidate.id === device.storeId);
    const register = registers.find((candidate) => candidate.id === device.registerId);
    if (!window.confirm(`Replace ${device.name}? The old terminal will be disabled immediately and a new terminal must be enrolled with a new credential.`)) return;
    setPendingDeviceId(device.id);
    startDeviceActionTransition(async () => {
      const result = await revokePosDeviceAction({ deviceId: device.id, reason: "Device replacement started by a fleet manager. Old credential intentionally revoked." });
      setPendingDeviceId(null);
      if (!result.ok) return setMessage(result.message);
      setMessage(`${device.name} was disabled for replacement. On the replacement Android terminal: Install TINDIO POS → Authenticate → Enroll → ${store?.name ?? device.storeId} → ${register?.name ?? device.registerId} → Initial Sync → Ready. The replacement device must generate a NEW device ID and secret.`);
      router.refresh();
    });
  };

  return <div className="space-y-6">
    <section className="grid gap-3 md:grid-cols-4">
      <SummaryCard label="Fleet devices" value={devices.length} />
      <SummaryCard label="Active" value={activeCount} />
      <SummaryCard label="Attention required" value={attentionCount} />
      <SummaryCard label="Queued operations" value={queued} />
    </section>

    <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
      <h2 className="font-semibold">Deployment flow</h2>
      <p className="mt-2 text-sm text-muted-foreground">Install → Authenticate → Enroll → Assign Store → Assign Register → Initial Sync → Ready</p>
      <p className="mt-3 text-sm">Business assignment: <strong>{business.name}</strong></p>
      <p className="mt-1 font-mono text-xs text-muted-foreground">{business.id}</p>
      <p className="mt-2 text-xs text-muted-foreground">Business assignment is locked to the authenticated tenant. Devices cannot be moved across businesses with a client-side selector.</p>
    </section>

    <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"><Laptop className="size-5" /></span><div><h2 className="font-semibold">Enroll current browser POS</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Native Android terminals enroll from the TINDIO POS app. This browser enrollment remains available for the existing web POS.</p></div></div>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <label className="grid gap-1.5 text-sm font-medium">Device name<Input disabled={isRegisteringPending} maxLength={80} onChange={(event) => setName(event.target.value)} value={name} /></label>
        <label className="grid gap-1.5 text-sm font-medium">Store<select className="h-10 rounded-lg border border-input bg-background px-3 text-sm" disabled={isRegisteringPending} onChange={(event) => { setStoreId(event.target.value); setRegisterId(""); }} value={storeId}><option value="">Choose a store</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
        <label className="grid gap-1.5 text-sm font-medium">Register<select className="h-10 rounded-lg border border-input bg-background px-3 text-sm" disabled={isRegisteringPending || !storeId} onChange={(event) => setRegisterId(event.target.value)} value={registerId}><option value="">Choose a register</option>{registersForNewDevice.map((register) => <option key={register.id} value={register.id}>{register.name} ({register.code})</option>)}</select></label>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3"><Button disabled={isRegisteringPending || !storeId || !registerId || name.trim().length < 2} onClick={registerThisBrowser} type="button">{isRegisteringPending ? <LoaderCircle className="animate-spin" /> : <Laptop />} Enroll current browser</Button></div>
    </section>

    {message ? <p aria-live="polite" className="rounded-xl border bg-muted/35 px-4 py-3 text-sm text-muted-foreground">{message}</p> : null}

    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="border-b px-5 py-4 sm:px-6"><h2 className="font-semibold">Managed terminals</h2><p className="mt-1 text-sm text-muted-foreground">Assign store/register, monitor health, disable compromised terminals, or start a safe replacement.</p></div>
      {devices.length ? <div className="divide-y">{devices.map((device) => <FleetDeviceCard busy={isDeviceActionPending && pendingDeviceId === device.id} device={device} key={device.id} onRebind={rebind} onReplace={replace} onRevoke={revoke} registers={registers} stores={stores} />)}</div> : <p className="px-5 py-10 text-sm text-muted-foreground">No POS terminal is enrolled in this business yet.</p>}
    </section>
  </div>;
}

function FleetDeviceCard({ busy, device, onRebind, onReplace, onRevoke, registers, stores }: {
  busy: boolean;
  device: DeviceFleetItem;
  onRebind: (deviceId: string, storeId: string, registerId: string) => void;
  onReplace: (device: DeviceFleetItem) => void;
  onRevoke: (device: DeviceFleetItem) => void;
  registers: Register[];
  stores: Store[];
}) {
  const [storeId, setStoreId] = useState(device.storeId);
  const [registerId, setRegisterId] = useState(device.registerId);
  const telemetry = device.telemetry;
  const availableRegisters = registers.filter((register) => register.storeId === storeId);
  const checkpointGap = telemetry ? Math.max(0, telemetry.deviceCheckpoint - telemetry.serverCheckpoint) : 0;
  const needsAttention = Boolean(telemetry && (telemetry.conflictCount > 0 || telemetry.failedCount > 0 || telemetry.connectionMode === "SYNC_REVIEW"));

  return <article className="space-y-5 p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{device.name}</h3><span className={device.status === "active" ? "rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary" : "rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"}>{device.status === "active" ? "Active" : "Disabled"}</span>{needsAttention ? <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"><AlertTriangle className="size-3" />Attention required</span> : null}{telemetry ? <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">{connectionIcon(telemetry.connectionMode)}{telemetry.connectionMode.replaceAll("_", " ")}</span> : null}</div><p className="mt-1 font-mono text-xs text-muted-foreground">{device.id}</p></div><div className="text-right text-xs text-muted-foreground"><p>App {device.appVersion}</p><p>Last contact: {dateTime(newestContact(device))}</p></div></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Heartbeat" value={dateTime(telemetry?.lastHeartbeatAt ?? null)} /><Metric label="Last successful sync" value={dateTime(telemetry?.lastSuccessfulSyncAt ?? null)} /><Metric label="Employee" value={telemetry?.employeeName ?? "Not reported"} /><Metric label="Offline since" value={dateTime(telemetry?.offlineSince ?? null)} /><Metric label="Queue depth" value={telemetry?.queueDepth ?? 0} /><Metric label="Conflicts" value={telemetry?.conflictCount ?? 0} /><Metric label="Failed" value={telemetry?.failedCount ?? 0} /><Metric label="Checkpoint gap" value={checkpointGap} /></div>
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"><label className="grid gap-1 text-xs font-medium text-muted-foreground">Store assignment<select className="h-9 rounded-lg border border-input bg-background px-2 text-sm text-foreground" disabled={device.status !== "active" || busy} onChange={(event) => { setStoreId(event.target.value); setRegisterId(""); }} value={storeId}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label><label className="grid gap-1 text-xs font-medium text-muted-foreground">Register assignment<select className="h-9 rounded-lg border border-input bg-background px-2 text-sm text-foreground" disabled={device.status !== "active" || busy} onChange={(event) => setRegisterId(event.target.value)} value={registerId}><option value="">Choose register</option>{availableRegisters.map((register) => <option key={register.id} value={register.id}>{register.name} ({register.code})</option>)}</select></label>{device.status === "active" ? <div className="flex flex-wrap items-end gap-2"><Button aria-label={`Save ${device.name} assignment`} disabled={busy || !registerId || (storeId === device.storeId && registerId === device.registerId)} onClick={() => onRebind(device.id, storeId, registerId)} size="icon" type="button" variant="outline">{busy ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}</Button><Button disabled={busy} onClick={() => onReplace(device)} type="button" variant="outline"><RotateCcw />Replace</Button><Button aria-label={`Disable ${device.name}`} disabled={busy} onClick={() => onRevoke(device)} type="button" variant="destructive"><ShieldBan />Disable</Button></div> : <p className="self-end text-xs text-muted-foreground">Disabled {dateTime(device.revokedAt)}</p>}</div>
  </article>;
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border bg-card p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-lg bg-muted/30 px-3 py-2"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>;
}
