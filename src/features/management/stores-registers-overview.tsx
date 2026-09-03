"use client";

import {
  CircleDollarSign,
  MapPin,
  MonitorSmartphone,
  Phone,
  Store,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useRef, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMinorMoney } from "@/features/catalog/catalog-money";
import { EditRegisterButton, EditStoreButton } from "@/features/management/management-forms";
import {
  loadManagementRegisterDrawerAction,
  loadManagementStoreDrawerAction,
} from "@/features/management/quick-view/actions";
import type {
  ManagementRegisterOperationalDrawerData,
  ManagementStoreDrawerData,
  ManagementStoreRegisterOverviewRow,
} from "@/features/management/management-types";

export function StoresRegisterOverview({
  canManageStores,
  canManageRegisters,
  canViewShiftHistory,
  currencyCode,
  stores,
  timezone,
}: {
  canManageStores: boolean;
  canManageRegisters: boolean;
  canViewShiftHistory: boolean;
  currencyCode: string;
  stores: ManagementStoreRegisterOverviewRow[];
  timezone: string;
}) {
  const [detail, setDetail] = useState<ManagementStoreDrawerData | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isLoading, startLoadingTransition] = useTransition();
  const [loadError, setLoadError] = useState(false);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const requestId = useRef(0);
  const lastFocusedStoreTargetId = useRef<string | null>(null);
  const [registerDetail, setRegisterDetail] = useState<ManagementRegisterOperationalDrawerData | null>(null);
  const [isRegisterDrawerOpen, setIsRegisterDrawerOpen] = useState(false);
  const [isRegisterLoading, startRegisterLoadingTransition] = useTransition();
  const [registerLoadError, setRegisterLoadError] = useState(false);
  const [selectedRegisterId, setSelectedRegisterId] = useState<string | null>(null);
  const registerRequestId = useRef(0);
  const lastFocusedRegisterTargetId = useRef<string | null>(null);

  const openStore = (storeId: string, focusTargetId = `store-open-${storeId}`) => {
    const currentRequest = requestId.current + 1;
    requestId.current = currentRequest;
    lastFocusedStoreTargetId.current = focusTargetId;
    setSelectedStoreId(storeId);
    setDetail(null);
    setLoadError(false);
    registerRequestId.current += 1;
    setRegisterDetail(null);
    setRegisterLoadError(false);
    setSelectedRegisterId(null);
    setIsRegisterDrawerOpen(false);
    setIsDrawerOpen(true);

    startLoadingTransition(async () => {
      const result = await loadManagementStoreDrawerAction({ storeId });
      if (requestId.current !== currentRequest) return;

      if (!result.ok || !result.data) {
        setLoadError(true);
        return;
      }

      setDetail(result.data);
    });
  };

  const closeDrawer = () => {
    requestId.current += 1;
    registerRequestId.current += 1;
    setIsDrawerOpen(false);
    setSelectedStoreId(null);
    setLoadError(false);
    setDetail(null);
    setIsRegisterDrawerOpen(false);
    setSelectedRegisterId(null);
    setRegisterLoadError(false);
    setRegisterDetail(null);
    const focusTargetId = lastFocusedStoreTargetId.current;
    if (focusTargetId) {
      window.requestAnimationFrame(() => document.getElementById(focusTargetId)?.focus());
    }
  };

  const openRegister = (registerId: string, focusTargetId = `register-open-${registerId}`) => {
    const currentRequest = registerRequestId.current + 1;
    registerRequestId.current = currentRequest;
    lastFocusedRegisterTargetId.current = focusTargetId;
    setSelectedRegisterId(registerId);
    setRegisterDetail(null);
    setRegisterLoadError(false);
    setIsRegisterDrawerOpen(true);

    startRegisterLoadingTransition(async () => {
      const result = await loadManagementRegisterDrawerAction({ registerId });
      if (registerRequestId.current !== currentRequest) return;

      if (!result.ok || !result.data) {
        setRegisterLoadError(true);
        return;
      }

      setRegisterDetail(result.data);
    });
  };

  const closeRegisterDrawer = () => {
    registerRequestId.current += 1;
    setIsRegisterDrawerOpen(false);
    setSelectedRegisterId(null);
    setRegisterLoadError(false);
    setRegisterDetail(null);
    const focusTargetId = lastFocusedRegisterTargetId.current;
    if (focusTargetId) {
      window.requestAnimationFrame(() => document.getElementById(focusTargetId)?.focus());
    }
  };

  const handleStoreSaved = (updated: { address: string; isActive: boolean; name: string; phone: string }) => {
    setDetail((current) => current
      ? {
          ...current,
          store: {
            ...current.store,
            name: updated.name,
            address: updated.address || null,
            phone: updated.phone || null,
            isActive: updated.isActive,
          },
        }
      : current);
  };

  const handleRegisterSaved = (updated: { isActive: boolean; name: string }) => {
    setDetail((current) => current
      ? {
          ...current,
          registers: current.registers.map((register) => register.id === selectedRegisterId
            ? { ...register, name: updated.name, isActive: updated.isActive }
            : register),
        }
      : current);
    closeRegisterDrawer();
  };

  return (
    <>
      <section aria-label="Stores and register summaries" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {stores.map((store) => (
          <Card
            aria-label={`View store ${store.name}, ${store.code}`}
            className="cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            id={`store-open-${store.id}`}
            key={store.id}
            onClick={() => openStore(store.id)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              openStore(store.id);
            }}
            role="button"
            tabIndex={0}
          >
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
                  <Store className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <CardTitle className="truncate">{store.name}</CardTitle>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">{store.code}</p>
                </div>
              </div>
              <Badge variant={store.isActive ? "secondary" : "outline"}>
                {store.isActive ? "Active" : "Inactive"}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <SummaryMetric icon={<MonitorSmartphone aria-hidden="true" />} label="Registers" value={String(store.registerCount)} />
                {store.openShiftCount !== null ? (
                  <SummaryMetric
                    icon={<CircleDollarSign aria-hidden="true" />}
                    label="Open shifts"
                    value={store.openShiftCount === 0 ? "None" : String(store.openShiftCount)}
                  />
                ) : null}
                {store.activeDeviceCount !== null ? (
                  <SummaryMetric
                    icon={<MonitorSmartphone aria-hidden="true" />}
                    label="Managed devices"
                    value={store.activeDeviceCount === 0 ? "None" : String(store.activeDeviceCount)}
                  />
                ) : null}
                {store.syncIssueCount && store.syncIssueCount > 0 ? (
                  <SummaryMetric
                    icon={<TriangleAlert aria-hidden="true" />}
                    label="Needs attention"
                    value={`${store.syncIssueCount} sync issue${store.syncIssueCount === 1 ? "" : "s"}`}
                  />
                ) : null}
              </dl>
              {store.address ? (
                <p className="flex items-start gap-2 text-sm text-muted-foreground">
                  <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>{store.address}</span>
                </p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </section>

      <Dialog.Root onOpenChange={(open) => { if (!open) closeDrawer(); }} open={isDrawerOpen}>
        <DialogContent
          className="flex h-dvh max-h-none max-w-none flex-col rounded-none sm:max-w-[42rem]"
          closeLabel="Close store details"
          side="right"
        >
          <DialogHeader className="shrink-0">
            <DialogTitle>{detail ? `${detail.store.code} · ${detail.store.name}` : "Store details"}</DialogTitle>
            {detail ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant={detail.store.isActive ? "secondary" : "outline"}>
                  {detail.store.isActive ? "Active" : "Inactive"}
                </Badge>
                <DialogDescription className="mt-0">Store and register overview</DialogDescription>
              </div>
            ) : null}
          </DialogHeader>

          <DialogBody className="min-h-0 max-h-none flex-1">
            {isLoading ? <StoreDrawerSkeleton /> : null}
            {!isLoading && loadError ? (
              <div className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">We couldn&apos;t load this store.</p>
                <Button
                  className="mt-4"
                  onClick={() => { if (selectedStoreId) openStore(selectedStoreId); }}
                  type="button"
                  variant="outline"
                >
                  Try again
                </Button>
              </div>
            ) : null}
            {!isLoading && detail ? (
              <StoreDrawerContent
                canManageStores={canManageStores}
                detail={detail}
                onOpenRegister={openRegister}
                onStoreSaved={handleStoreSaved}
                summary={stores.find((store) => store.id === detail.store.id)}
              />
            ) : null}
          </DialogBody>
        </DialogContent>
      </Dialog.Root>

      <Dialog.Root onOpenChange={(open) => { if (!open) closeRegisterDrawer(); }} open={isRegisterDrawerOpen}>
        <DialogContent
          className="flex h-dvh max-h-none max-w-none flex-col rounded-none sm:max-w-[40rem]"
          closeLabel="Close register details"
          side="right"
        >
          <DialogHeader className="shrink-0">
            <DialogTitle>{registerDetail ? `${registerDetail.register.name} · ${registerDetail.register.code}` : "Register details"}</DialogTitle>
            {registerDetail ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant={registerSummary(registerDetail).variant}>{registerSummary(registerDetail).label}</Badge>
                <DialogDescription className="mt-0">{registerDetail.store.code} · {registerDetail.store.name}</DialogDescription>
                <p className="basis-full text-sm text-muted-foreground">{registerSummary(registerDetail).description}</p>
              </div>
            ) : null}
          </DialogHeader>

          <DialogBody className="min-h-0 max-h-none flex-1">
            {isRegisterLoading ? <RegisterDrawerSkeleton /> : null}
            {!isRegisterLoading && registerLoadError ? (
              <div className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">We couldn&apos;t load this register.</p>
                <Button
                  className="mt-4"
                  onClick={() => { if (selectedRegisterId) openRegister(selectedRegisterId); }}
                  type="button"
                  variant="outline"
                >
                  Try again
                </Button>
              </div>
            ) : null}
            {!isRegisterLoading && registerDetail ? (
              <RegisterDrawerContent
                canManageRegisters={canManageRegisters}
                canViewShiftHistory={canViewShiftHistory}
                currencyCode={currencyCode}
                detail={registerDetail}
                onRegisterSaved={handleRegisterSaved}
                timezone={timezone}
              />
            ) : null}
          </DialogBody>
        </DialogContent>
      </Dialog.Root>
    </>
  );
}

function SummaryMetric({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</dt>
      <dd className="mt-1 font-medium">{value}</dd>
    </div>
  );
}

function StoreDrawerContent({
  canManageStores,
  detail,
  onOpenRegister,
  onStoreSaved,
  summary,
}: {
  canManageStores: boolean;
  detail: ManagementStoreDrawerData;
  onOpenRegister: (registerId: string, focusTargetId?: string) => void;
  onStoreSaved: (updated: { address: string; isActive: boolean; name: string; phone: string }) => void;
  summary: ManagementStoreRegisterOverviewRow | undefined;
}) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="store-overview-heading" className="rounded-xl border p-4">
        <h2 className="text-sm font-semibold" id="store-overview-heading">Store overview</h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Store code</dt>
            <dd className="mt-1 font-mono font-medium">{detail.store.code}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Status</dt>
            <dd className="mt-1 font-medium">{detail.store.isActive ? "Active" : "Inactive"}</dd>
          </div>
          {summary ? <DrawerDetail label="Registers" value={String(summary.registerCount)} /> : null}
          {summary?.openShiftCount !== null && summary?.openShiftCount !== undefined ? (
            <DrawerDetail label="Open shifts" value={summary.openShiftCount === 0 ? "None" : String(summary.openShiftCount)} />
          ) : null}
          {summary?.activeDeviceCount !== null && summary?.activeDeviceCount !== undefined ? (
            <DrawerDetail label="Managed devices" value={summary.activeDeviceCount === 0 ? "None" : String(summary.activeDeviceCount)} />
          ) : null}
          {summary?.syncIssueCount !== null && summary?.syncIssueCount !== undefined && summary.syncIssueCount > 0 ? (
            <DrawerDetail label="Needs attention" value={`${summary.syncIssueCount} sync issue${summary.syncIssueCount === 1 ? "" : "s"}`} />
          ) : null}
          {detail.store.address ? (
            <div className="sm:col-span-2">
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><MapPin aria-hidden="true" className="size-3.5" />Address</dt>
              <dd className="mt-1">{detail.store.address}</dd>
            </div>
          ) : null}
          {detail.store.phone ? (
            <div>
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><Phone aria-hidden="true" className="size-3.5" />Phone</dt>
              <dd className="mt-1">{detail.store.phone}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section aria-labelledby="store-registers-heading">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold" id="store-registers-heading">Registers</h2>
            <p className="mt-1 text-sm text-muted-foreground">Select a register to inspect the operational details your access allows.</p>
          </div>
          <Badge variant="outline">{detail.registers.length}</Badge>
        </div>
        {detail.registers.length > 0 ? (
          <ul className="mt-3 space-y-2" aria-label="Registers in this store">
            {detail.registers.map((register) => (
              <li
                aria-label={`Open register ${register.name}, ${register.code}, ${register.isActive ? "active" : "inactive"}`}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                id={`register-open-${register.id}`}
                key={register.id}
                onClick={() => onOpenRegister(register.id)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onOpenRegister(register.id);
                }}
                role="button"
                tabIndex={0}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-md bg-secondary text-primary"><MonitorSmartphone aria-hidden="true" className="size-4" /></span>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{register.name}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">{register.code}</p>
                  </div>
                </div>
                <Badge variant={register.isActive ? "secondary" : "outline"}>{register.isActive ? "Active" : "Inactive"}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No registers have been added to this store.</div>
        )}
      </section>

      {canManageStores ? (
        <section aria-labelledby="store-management-heading" className="rounded-xl border p-4">
          <h2 className="text-sm font-semibold" id="store-management-heading">Store management</h2>
          <p className="mt-1 text-sm text-muted-foreground">Keep the store name, details, and availability accurate for its registers.</p>
          <div className="mt-4">
            <EditStoreButton onSaved={onStoreSaved} store={detail.store} />
          </div>
        </section>
      ) : null}
    </div>
  );
}

function StoreDrawerSkeleton() {
  return (
    <div aria-label="Loading store" aria-live="polite" className="space-y-5">
      <span className="sr-only">Loading store</span>
      <div className="h-40 animate-pulse rounded-xl border bg-muted/40" />
      <div className="space-y-3">
        <div className="h-5 w-28 animate-pulse rounded bg-muted" />
        <div className="h-16 animate-pulse rounded-xl border bg-muted/40" />
        <div className="h-16 animate-pulse rounded-xl border bg-muted/40" />
      </div>
    </div>
  );
}

function RegisterDrawerContent({
  canManageRegisters,
  canViewShiftHistory,
  currencyCode,
  detail,
  onRegisterSaved,
  timezone,
}: {
  canManageRegisters: boolean;
  canViewShiftHistory: boolean;
  currencyCode: string;
  detail: ManagementRegisterOperationalDrawerData;
  onRegisterSaved: (updated: { isActive: boolean; name: string }) => void;
  timezone: string;
}) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="register-overview-heading" className="rounded-xl border p-4">
        <h2 className="text-sm font-semibold" id="register-overview-heading">Register overview</h2>
        <p className="mt-1 text-sm text-muted-foreground">A selling station used to open shifts and record sales.</p>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Register code</dt>
            <dd className="mt-1 font-mono font-medium">{detail.register.code}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Register status</dt>
            <dd className="mt-1 font-medium">{detail.register.isActive ? "Active" : "Inactive"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">Store</dt>
            <dd className="mt-1 font-medium">{detail.store.code} · {detail.store.name}</dd>
          </div>
        </dl>
      </section>

      <CurrentShiftSection currencyCode={currencyCode} detail={detail} timezone={timezone} />

      {detail.deviceContext ? <DeviceAndSyncSection detail={detail} timezone={timezone} /> : null}

      {canViewShiftHistory ? (
        <section aria-labelledby="register-history-heading" className="rounded-xl border p-4">
          <h2 className="text-sm font-semibold" id="register-history-heading">Shift history</h2>
          <p className="mt-1 text-sm text-muted-foreground">Review completed shift reports without changing the current register shift.</p>
          <Link className={`${buttonVariants({ variant: "outline" })} mt-4`} href={`/back-office/shifts?register=${detail.register.id}`}>
            View shift history
          </Link>
        </section>
      ) : null}

      {canManageRegisters ? (
        <section aria-labelledby="register-management-heading" className="rounded-xl border p-4">
          <h2 className="text-sm font-semibold" id="register-management-heading">Register management</h2>
          <p className="mt-1 text-sm text-muted-foreground">Keep the register name and availability accurate before it is used for a shift.</p>
          <div className="mt-4">
            <EditRegisterButton
              onSaved={onRegisterSaved}
              register={{
                id: detail.register.id,
                name: detail.register.name,
                code: detail.register.code,
                storeName: detail.store.name,
                isActive: detail.register.isActive,
              }}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}

function CurrentShiftSection({
  currencyCode,
  detail,
  timezone,
}: {
  currencyCode: string;
  detail: ManagementRegisterOperationalDrawerData;
  timezone: string;
}) {
  if (!detail.canViewCurrentShift) {
    return (
      <section aria-labelledby="register-current-shift-heading" className="rounded-xl border p-4">
        <h2 className="text-sm font-semibold" id="register-current-shift-heading">Current shift</h2>
        <p className="mt-1 text-sm text-muted-foreground">Current shift and cash drawer details are available only to roles with shift access.</p>
      </section>
    );
  }

  if (!detail.currentShift) {
    return (
      <section aria-labelledby="register-current-shift-heading" className="rounded-xl border p-4">
        <h2 className="text-sm font-semibold" id="register-current-shift-heading">Current shift</h2>
        <p className="mt-1 text-sm text-muted-foreground">No register shift is currently open. No cashier is using this register.</p>
      </section>
    );
  }

  const shift = detail.currentShift;
  return (
    <section aria-labelledby="register-current-shift-heading" className="space-y-4 rounded-xl border p-4">
      <div>
        <h2 className="text-sm font-semibold" id="register-current-shift-heading">Current shift</h2>
        <p className="mt-1 text-sm text-muted-foreground">The work period that must be open before this register can record sales.</p>
      </div>
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <DrawerDetail label="Cashier" value={shift.openedBy} />
        <DrawerDetail label="Opened" value={formatDateTime(shift.openedAt, timezone)} />
        <DrawerDetail label="Duration" value={formatOpenDuration(shift.openedAt)} />
        <DrawerDetail label="Shift reference" value={<span className="font-mono">{shift.number}</span>} />
      </dl>

      <div className="border-t pt-4">
        <h3 className="text-sm font-semibold">Cash drawer</h3>
        <p className="mt-1 text-sm text-muted-foreground">Cash recorded for this current register shift.</p>
        <dl className="mt-3 divide-y text-sm">
          <MoneyDrawerDetail currencyCode={currencyCode} label="Starting cash" value={shift.cash.startingCashMinor} />
          <MoneyDrawerDetail currencyCode={currencyCode} label="Cash sales" value={shift.cash.cashSalesMinor} />
          <MoneyDrawerDetail currencyCode={currencyCode} label="Cash refunds" negative value={shift.cash.cashRefundsMinor} />
          <MoneyDrawerDetail currencyCode={currencyCode} label="Paid in" value={shift.cash.paidInMinor} />
          <MoneyDrawerDetail currencyCode={currencyCode} label="Paid out" negative value={shift.cash.paidOutMinor} />
          <MoneyDrawerDetail currencyCode={currencyCode} emphasized label="Expected cash" value={shift.cash.expectedCashMinor} />
        </dl>
        {shift.cash.expectedCashMinor === null ? <p className="mt-3 text-xs text-muted-foreground">Expected cash is hidden until this blind cash count is closed.</p> : null}
      </div>
    </section>
  );
}

function DeviceAndSyncSection({
  detail,
  timezone,
}: {
  detail: ManagementRegisterOperationalDrawerData;
  timezone: string;
}) {
  const deviceContext = detail.deviceContext;
  if (!deviceContext) return null;

  return (
    <section aria-labelledby="register-device-sync-heading" className="rounded-xl border p-4">
      <h2 className="text-sm font-semibold" id="register-device-sync-heading">Device & sync</h2>
      {deviceContext.activeDevice ? (
        <dl className="mt-3 grid gap-4 text-sm sm:grid-cols-2">
          <DrawerDetail label="Managed device" value={deviceContext.activeDevice.name} />
          <DrawerDetail label="App version" value={deviceContext.activeDevice.appVersion} />
          <DrawerDetail
            label="Last recorded activity"
            value={deviceContext.activeDevice.lastSeenAt ? formatDateTime(deviceContext.activeDevice.lastSeenAt, timezone) : "No activity recorded"}
          />
        </dl>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">No active managed device is linked to this register.</p>
      )}
      <dl className="mt-4 divide-y border-t text-sm">
        <DrawerDetail label="Server-recorded sync queue" value={`${deviceContext.recordedPendingSyncCount} awaiting sync`} />
        <DrawerDetail label="Sync issues requiring review" value={String(deviceContext.syncIssueCount)} />
      </dl>
      {deviceContext.recordedPendingSyncCount > 0 ? <p className="mt-3 text-xs text-muted-foreground">This count reflects records received by TINDIO; device-local work appears after a synchronization attempt.</p> : null}
      {deviceContext.syncIssueCount > 0 ? (
        <Link className={`${buttonVariants({ variant: "outline" })} mt-4`} href={`/back-office/offline-sync?store=${detail.store.id}`}>
          Review sync activity
        </Link>
      ) : null}
    </section>
  );
}

function DrawerDetail({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 first:pt-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function MoneyDrawerDetail({
  currencyCode,
  emphasized = false,
  label,
  negative = false,
  value,
}: {
  currencyCode: string;
  emphasized?: boolean;
  label: string;
  negative?: boolean;
  value: number | null;
}) {
  const formattedValue = value === null
    ? "Hidden until close"
    : `${negative ? "−" : ""}${formatMinorMoney(value, currencyCode)}`;
  return (
    <div className={`flex items-start justify-between gap-4 py-2 ${emphasized ? "border-t pt-3 font-semibold" : ""}`}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums">{formattedValue}</dd>
    </div>
  );
}

function registerSummary(detail: ManagementRegisterOperationalDrawerData) {
  if (!detail.register.isActive) {
    return { label: "Disabled", description: "This register cannot be used for new shifts until it is enabled.", variant: "outline" as const };
  }
  if ((detail.deviceContext?.syncIssueCount ?? 0) > 0) {
    return { label: "Needs attention", description: "Recorded synchronization issues need review.", variant: "outline" as const };
  }
  if (detail.canViewCurrentShift && detail.currentShift) {
    return { label: "Shift open", description: "A cashier currently has an open register shift.", variant: "secondary" as const };
  }
  if (detail.canViewCurrentShift) {
    return { label: "Shift closed", description: "No register shift is currently open.", variant: "outline" as const };
  }
  return { label: "Active", description: "Current shift status is restricted for this role.", variant: "secondary" as const };
}

function formatDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

function formatOpenDuration(openedAt: string) {
  const elapsedMilliseconds = Date.now() - new Date(openedAt).getTime();
  if (!Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds < 0) return "—";
  const minutes = Math.floor(elapsedMilliseconds / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function RegisterDrawerSkeleton() {
  return (
    <div aria-label="Loading register" aria-live="polite" className="space-y-5">
      <span className="sr-only">Loading register</span>
      <div className="h-44 animate-pulse rounded-xl border bg-muted/40" />
      <div className="h-28 animate-pulse rounded-xl border bg-muted/40" />
    </div>
  );
}
