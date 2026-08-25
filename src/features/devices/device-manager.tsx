"use client";

import { Laptop, LoaderCircle, RefreshCw, ShieldBan } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  changePosDeviceRegisterAction,
  registerPosDeviceAction,
  revokePosDeviceAction,
} from "@/features/devices/actions";
import { TINDIO_POS_APP_VERSION } from "@/features/devices/device-schema";
import { savePosDeviceIdentity } from "@/features/offline/offline-store";

type Store = { id: string; name: string };
type Register = { id: string; storeId: string; name: string; code: string };
type Device = {
  id: string;
  name: string;
  storeId: string;
  registerId: string;
  status: "active" | "revoked";
  appVersion: string;
  lastSeenAt: string | null;
  createdAt: string;
  revokedAt: string | null;
};

function createIdentity() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return {
    deviceId: crypto.randomUUID(),
    secret: Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(""),
    appVersion: TINDIO_POS_APP_VERSION,
  };
}

function deviceDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : "Not seen yet";
}

export function DeviceManager({
  devices,
  organizationId,
  registers,
  stores,
}: {
  devices: Device[];
  organizationId: string;
  registers: Register[];
  stores: Store[];
}) {
  const router = useRouter();
  const [name, setName] = useState("This POS browser");
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [registerId, setRegisterId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pendingDeviceId, setPendingDeviceId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const registersForNewDevice = useMemo(
    () => registers.filter((register) => register.storeId === storeId),
    [registers, storeId],
  );

  const changeNewStore = (nextStoreId: string) => {
    setStoreId(nextStoreId);
    setRegisterId("");
  };

  const registerThisBrowser = () => {
    if (!storeId || !registerId) {
      setMessage("Choose the store and register this browser will use.");
      return;
    }

    const identity = createIdentity();
    startTransition(async () => {
      setMessage(null);
      const result = await registerPosDeviceAction({
        ...identity,
        storeId,
        registerId,
        name,
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }

      try {
        await savePosDeviceIdentity({
          organizationId,
          ...identity,
          createdAt: new Date().toISOString(),
        });
        setMessage("This browser is registered. Open POS to use its assigned register.");
        router.refresh();
      } catch {
        setMessage("The device was registered, but this browser could not save its local credential. Revoke it and register this browser again.");
        router.refresh();
      }
    });
  };

  const rebind = (deviceId: string, nextStoreId: string, nextRegisterId: string) => {
    if (!nextStoreId || !nextRegisterId) return;
    setPendingDeviceId(deviceId);
    startTransition(async () => {
      const result = await changePosDeviceRegisterAction({
        deviceId,
        storeId: nextStoreId,
        registerId: nextRegisterId,
      });
      setMessage(result.message);
      setPendingDeviceId(null);
      if (result.ok) router.refresh();
    });
  };

  const revoke = (deviceId: string, deviceName: string) => {
    if (!window.confirm(`Revoke ${deviceName}? This browser will no longer be able to use TINDIO POS.`)) return;
    setPendingDeviceId(deviceId);
    startTransition(async () => {
      const result = await revokePosDeviceAction({ deviceId, reason: "Device revoked by a manager." });
      setMessage(result.message);
      setPendingDeviceId(null);
      if (result.ok) router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"><Laptop className="size-5" /></span>
          <div>
            <h2 className="font-semibold">Register this browser</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">The browser creates a random credential and saves it only in this browser’s secure local database. It will be locked to one register.</p>
          </div>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <label className="grid gap-1.5 text-sm font-medium">Device name<Input disabled={isPending} maxLength={80} onChange={(event) => setName(event.target.value)} value={name} /></label>
          <label className="grid gap-1.5 text-sm font-medium">Store<select className="h-10 rounded-lg border border-input bg-background px-3 text-sm" disabled={isPending} onChange={(event) => changeNewStore(event.target.value)} value={storeId}><option value="">Choose a store</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
          <label className="grid gap-1.5 text-sm font-medium">Register<select className="h-10 rounded-lg border border-input bg-background px-3 text-sm" disabled={isPending || !storeId} onChange={(event) => setRegisterId(event.target.value)} value={registerId}><option value="">Choose a register</option>{registersForNewDevice.map((register) => <option key={register.id} value={register.id}>{register.name} ({register.code})</option>)}</select></label>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3"><Button disabled={isPending || !storeId || !registerId || name.trim().length < 2} onClick={registerThisBrowser} type="button">{isPending ? <LoaderCircle className="animate-spin" /> : <Laptop />} Register this browser</Button><p className="text-xs text-muted-foreground">Registering the first device activates device enforcement for this organization.</p></div>
      </section>

      {message ? <p aria-live="polite" className="rounded-xl border bg-muted/35 px-4 py-3 text-sm text-muted-foreground">{message}</p> : null}

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="border-b px-5 py-4 sm:px-6"><h2 className="font-semibold">Registered devices</h2><p className="mt-1 text-sm text-muted-foreground">Rebind an active device to another register or revoke it immediately.</p></div>
        {devices.length ? <ul className="divide-y">{devices.map((device) => <DeviceRow device={device} isPending={isPending && pendingDeviceId === device.id} key={device.id} onRebind={rebind} onRevoke={revoke} registers={registers} stores={stores} />)}</ul> : <p className="px-5 py-10 text-sm text-muted-foreground">No browser or POS application is registered yet.</p>}
      </section>
    </div>
  );
}

function DeviceRow({ device, isPending, onRebind, onRevoke, registers, stores }: { device: Device; isPending: boolean; onRebind: (deviceId: string, storeId: string, registerId: string) => void; onRevoke: (deviceId: string, name: string) => void; registers: Register[]; stores: Store[] }) {
  const [storeId, setStoreId] = useState(device.storeId);
  const [registerId, setRegisterId] = useState(device.registerId);
  const availableRegisters = registers.filter((register) => register.storeId === storeId);
  const changeStore = (nextStoreId: string) => { setStoreId(nextStoreId); setRegisterId(""); };

  return <li className="grid gap-4 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_12rem_12rem_auto]"><div><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{device.name}</p><span className={device.status === "active" ? "rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary" : "rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"}>{device.status === "active" ? "Active" : "Revoked"}</span></div><p className="mt-1 font-mono text-xs text-muted-foreground">{device.id}</p><p className="mt-2 text-xs text-muted-foreground">Last seen: {deviceDate(device.lastSeenAt)} · {device.appVersion}</p></div><label className="grid gap-1 text-xs font-medium text-muted-foreground">Store<select className="h-9 rounded-lg border border-input bg-background px-2 text-sm text-foreground" disabled={device.status !== "active" || isPending} onChange={(event) => changeStore(event.target.value)} value={storeId}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label><label className="grid gap-1 text-xs font-medium text-muted-foreground">Register<select className="h-9 rounded-lg border border-input bg-background px-2 text-sm text-foreground" disabled={device.status !== "active" || isPending} onChange={(event) => setRegisterId(event.target.value)} value={registerId}>{availableRegisters.map((register) => <option key={register.id} value={register.id}>{register.name}</option>)}</select></label>{device.status === "active" ? <div className="flex items-end gap-2"><Button aria-label={`Save ${device.name} binding`} disabled={isPending || !registerId || (storeId === device.storeId && registerId === device.registerId)} onClick={() => onRebind(device.id, storeId, registerId)} size="icon" type="button" variant="outline">{isPending ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}</Button><Button aria-label={`Revoke ${device.name}`} disabled={isPending} onClick={() => onRevoke(device.id, device.name)} size="icon" type="button" variant="destructive"><ShieldBan /></Button></div> : <p className="self-end text-xs text-muted-foreground">Revoked {deviceDate(device.revokedAt)}</p>}</li>;
}
