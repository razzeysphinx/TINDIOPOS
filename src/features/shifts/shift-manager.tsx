"use client";

import { Menu } from "@base-ui/react/menu";
import {
  ArrowLeft,
  ArrowDownToLine,
  ArrowUpFromLine,
  Calculator,
  CheckCircle2,
  CircleDollarSign,
  Eye,
  EyeOff,
  EllipsisVertical,
  History,
  LoaderCircle,
  LogIn,
  LockKeyhole,
  Printer,
} from "lucide-react";
import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { BackOfficeDetailDrawer } from "@/components/back-office/back-office-detail-drawer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContextHelp } from "@/components/back-office/context-help";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatMinorMoney, moneyInputToMinor } from "@/features/catalog/catalog-money";
import { ManagerApprovalDialog } from "@/features/approvals/manager-approval-dialog";
import { requestManagerApprovalAction } from "@/features/approvals/actions";
import {
  closeShiftAction,
  openShiftAction,
  recordCashMovementAction,
  updateShiftCashCloseSettingAction,
} from "@/features/shifts/actions";
import type { ShiftAuditReport } from "@/features/shifts/data";
import { loadShiftQuickViewAction } from "@/features/shifts/quick-view/actions";

type StoreOption = { id: string; name: string };
type RegisterOption = { id: string; storeId: string; name: string; code: string };

type ShiftRecord = {
  id: string;
  storeId: string;
  registerId: string;
  openedByEmployeeId: string;
  openedByName: string;
  status: "open" | "closed";
  openingCashMinor: number;
  expectedCashMinor: number | null;
  countedCashMinor: number | null;
  differenceMinor: number | null;
  openingNote: string | null;
  closingNote: string | null;
  openedAt: string;
  closedAt: string | null;
};

type CashSummary = {
  shiftId: string;
  openingCashMinor: number | null;
  cashSalesMinor: number | null;
  cashRefundsMinor: number | null;
  payInsMinor: number | null;
  payOutsMinor: number | null;
  expectedCashMinor: number | null;
};

type CashMovement = {
  id: string;
  shiftId: string;
  movementType: "PAY_IN" | "PAY_OUT";
  amountMinor: number;
  reason: string;
  createdAt: string;
};

type ShiftHistoryEntry = {
  shift: ShiftRecord;
  storeName: string;
  registerName: string;
};

export type ShiftOperationalSummary = {
  shift: {
    id: string;
    number: string;
    status: "open" | "closed";
    openedBy: string;
    openedAt: string;
    closedAt: string | null;
    store: string;
    register: string;
    startingCashMinor: number;
    actualCashMinor: number | null;
    differenceMinor: number | null;
  };
  cash: {
    cashPaymentsMinor: number | null;
    cashRefundsMinor: number | null;
    paidInMinor: number | null;
    paidOutMinor: number | null;
    expectedCashMinor: number | null;
  };
  sales: {
    grossSalesMinor: number;
    refundsMinor: number;
    discountsMinor: number;
    netSalesMinor: number;
  };
};

const selectClassName =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function formatShiftTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

export function ShiftManager({
  auditFilters,
  canClose,
  canManageSettings,
  canOpen,
  canPayIn,
  canPayOut,
  canViewClosedShiftAudit,
  cashMovements,
  currencyCode,
  hasAccessibleOpenShift,
  openShifts,
  recentClosedShifts,
  registers,
  stores,
  summaries,
  operationalSummaries,
  historyPresentation = "audit-card",
  showExpectedCashBeforeClose,
  simplifyOpenShiftContext = false,
  timezone,
}: {
  auditFilters?: ReactNode;
  canClose: boolean;
  canManageSettings: boolean;
  canOpen: boolean;
  canPayIn: boolean;
  canPayOut: boolean;
  canViewClosedShiftAudit: boolean;
  cashMovements: CashMovement[];
  currencyCode: string;
  hasAccessibleOpenShift?: boolean;
  openShifts: ShiftRecord[];
  recentClosedShifts: ShiftRecord[];
  registers: RegisterOption[];
  stores: StoreOption[];
  summaries: CashSummary[];
  operationalSummaries: ShiftOperationalSummary[];
  historyPresentation?: "audit-card" | "drawer-action";
  showExpectedCashBeforeClose: boolean;
  simplifyOpenShiftContext?: boolean;
  timezone: string;
}) {
  const [lastCloseSummary, setLastCloseSummary] = useState<{
    expectedCashMinor: number;
    countedCashMinor: number;
    differenceMinor: number;
  } | null>(null);
  const summaryByShiftId = new Map(summaries.map((summary) => [summary.shiftId, summary]));
  const hasOpenShift = hasAccessibleOpenShift ?? openShifts.length > 0;
  const operationalSummaryByShiftId = new Map(operationalSummaries.map((summary) => [summary.shift.id, summary]));
  const movementsByShiftId = new Map<string, CashMovement[]>();
  for (const movement of cashMovements) {
    movementsByShiftId.set(movement.shiftId, [
      ...(movementsByShiftId.get(movement.shiftId) ?? []),
      movement,
    ]);
  }
  const showOperationalWorkspace = historyPresentation === "drawer-action";

  return (
    <div className="space-y-5">
      {showOperationalWorkspace && canManageSettings ? (
        <CashCloseVisibilitySetting initialValue={showExpectedCashBeforeClose} />
      ) : null}
      {showOperationalWorkspace && lastCloseSummary ? (
        <CashCloseRecordedNotice currencyCode={currencyCode} summary={lastCloseSummary} />
      ) : null}
      {showOperationalWorkspace && canOpen && !hasOpenShift ? (
        <OpenShiftForm registers={registers} simplifyContext={simplifyOpenShiftContext} stores={stores} />
      ) : null}

      {showOperationalWorkspace && openShifts.length > 0 ? (
        <section className="grid gap-4 xl:grid-cols-2">
          {openShifts.map((shift) => (
            <OpenShiftCard
              canClose={canClose}
              canPayIn={canPayIn}
              canPayOut={canPayOut}
              currencyCode={currencyCode}
              key={shift.id}
              movements={movementsByShiftId.get(shift.id) ?? []}
              onClosed={setLastCloseSummary}
              register={registers.find((item) => item.id === shift.registerId)}
              shift={shift}
              store={stores.find((item) => item.id === shift.storeId)}
              summary={summaryByShiftId.get(shift.id)}
              showExpectedCashBeforeClose={showExpectedCashBeforeClose}
              operationalSummary={operationalSummaryByShiftId.get(shift.id)}
              timezone={timezone}
            />
          ))}
        </section>
      ) : showOperationalWorkspace && hasOpenShift ? (
        <Card>
          <CardHeader className="items-center py-10 text-center">
            <CircleDollarSign className="size-9 text-muted-foreground" aria-hidden="true" />
            <CardTitle>A register shift is already open</CardTitle>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              A current shift is already using an assigned register. It must be reviewed or closed before another shift can be opened.
            </p>
          </CardHeader>
        </Card>
      ) : showOperationalWorkspace ? (
        <Card>
          <CardHeader className="items-center py-10 text-center">
            <CircleDollarSign className="size-9 text-muted-foreground" aria-hidden="true" />
            <CardTitle>No register shift is open</CardTitle>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              Open a drawer before processing sales or cash movements. TINDIO will then calculate the expected cash from its recorded transactions.
            </p>
          </CardHeader>
        </Card>
      ) : null}

      <ClosedShiftHistory
        auditFilters={auditFilters}
        canViewClosedShiftAudit={canViewClosedShiftAudit}
        currencyCode={currencyCode}
        registers={registers}
        presentation={historyPresentation}
        shifts={recentClosedShifts}
        stores={stores}
        timezone={timezone}
      />
    </div>
  );
}

function OpenShiftForm({
  registers,
  simplifyContext,
  stores,
}: {
  registers: RegisterOption[];
  simplifyContext: boolean;
  stores: StoreOption[];
}) {
  const router = useRouter();
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const availableRegisters = useMemo(
    () => registers.filter((register) => register.storeId === storeId),
    [registers, storeId],
  );
  const [registerId, setRegisterId] = useState(
    () => registers.find((register) => register.storeId === stores[0]?.id)?.id ?? "",
  );
  const [openingCash, setOpeningCash] = useState("0.00");
  const [openingNote, setOpeningNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const hasFixedStore = simplifyContext && stores.length === 1;
  const hasFixedRegister = simplifyContext && availableRegisters.length === 1;

  const changeStore = (nextStoreId: string) => {
    setStoreId(nextStoreId);
    setRegisterId(registers.find((register) => register.storeId === nextStoreId)?.id ?? "");
  };

  const submit = () => {
    startTransition(async () => {
      const result = await openShiftAction({ storeId, registerId, openingCash, openingNote });
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
          <LogIn className="size-5" aria-hidden="true" />
        </span>
        <div>
          <CardTitle>Open register shift</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Record the opening float before this register accepts sales.
          </p>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          {hasFixedStore ? (
            <ShiftContextField label="Store" value={stores[0]?.name ?? "Assigned store"} />
          ) : (
            <label className="grid gap-1.5 text-sm font-medium">
              Store
              <select className={selectClassName} disabled={isPending || stores.length === 0} onChange={(event) => changeStore(event.target.value)} value={storeId}>
                {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
            </label>
          )}
          {hasFixedRegister ? (
            <ShiftContextField label="Register" value={`${availableRegisters[0]?.name ?? "Register"} (${availableRegisters[0]?.code ?? ""})`} />
          ) : (
            <label className="grid gap-1.5 text-sm font-medium">
              Register
              <select className={selectClassName} disabled={isPending || availableRegisters.length === 0} onChange={(event) => setRegisterId(event.target.value)} value={registerId}>
                {availableRegisters.map((register) => <option key={register.id} value={register.id}>{register.name} ({register.code})</option>)}
              </select>
            </label>
          )}
          <label className="grid gap-1.5 text-sm font-medium">
            Opening cash
            <Input disabled={isPending} inputMode="decimal" min="0" onChange={(event) => setOpeningCash(event.target.value)} step="0.01" type="number" value={openingCash} />
          </label>
        </div>
        <label className="grid gap-1.5 text-sm font-medium">
          Opening note <span className="font-normal text-muted-foreground">(optional)</span>
          <Input disabled={isPending} maxLength={500} onChange={(event) => setOpeningNote(event.target.value)} placeholder="e.g. Daily opening float" value={openingNote} />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={isPending || !storeId || !registerId} onClick={submit} type="button">
            {isPending ? <LoaderCircle className="animate-spin" /> : <LogIn />}
            Open shift
          </Button>
          {message ? <p aria-live="polite" className="text-sm text-muted-foreground">{message}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function ShiftContextField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1.5 text-sm font-medium">
      <span>{label}</span>
      <p className="flex h-10 items-center rounded-lg border bg-muted/35 px-3 text-sm font-normal">{value}</p>
    </div>
  );
}

function OpenShiftCard({
  canClose,
  canPayIn,
  canPayOut,
  currencyCode,
  movements,
  onClosed,
  register,
  shift,
  store,
  summary,
  operationalSummary,
  showExpectedCashBeforeClose,
  timezone,
}: {
  canClose: boolean;
  canPayIn: boolean;
  canPayOut: boolean;
  currencyCode: string;
  movements: CashMovement[];
  onClosed: (summary: { expectedCashMinor: number; countedCashMinor: number; differenceMinor: number }) => void;
  register: RegisterOption | undefined;
  shift: ShiftRecord;
  store: StoreOption | undefined;
  summary: CashSummary | undefined;
  operationalSummary: ShiftOperationalSummary | undefined;
  showExpectedCashBeforeClose: boolean;
  timezone: string;
}) {
  const [isCashManagementOpen, setIsCashManagementOpen] = useState(false);
  const [isCloseReviewOpen, setIsCloseReviewOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="truncate">{register?.name ?? "Register"}</CardTitle>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {store?.name ?? "Assigned store"} · opened {formatShiftTime(shift.openedAt, timezone)}
          </p>
        </div>
        <Badge variant="secondary"><CheckCircle2 aria-hidden="true" />Open</Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        {operationalSummary ? <ShiftOperationalOverview currencyCode={currencyCode} summary={operationalSummary} timezone={timezone} /> : null}
        {summary?.expectedCashMinor !== null && summary ? (
          <CashExpectation currencyCode={currencyCode} summary={summary} />
        ) : (
          <BlindCashNotice />
        )}
        {shift.openingNote ? <p className="rounded-lg bg-muted/45 px-3 py-2 text-sm text-muted-foreground">Opening note: {shift.openingNote}</p> : null}

        <div className="flex flex-wrap gap-2">
          {canPayIn || canPayOut ? (
            <Button onClick={() => setIsCashManagementOpen(true)} type="button" variant="outline">
              <CircleDollarSign aria-hidden="true" />
              Cash management
            </Button>
          ) : null}
          {canClose ? (
            <Button onClick={() => setIsCloseReviewOpen(true)} type="button">
              <LockKeyhole aria-hidden="true" />
              Close shift
            </Button>
          ) : null}
        </div>

        {movements.length > 0 ? (
          <div>
            <p className="text-sm font-medium">Recent cash movements</p>
            <div className="mt-2 divide-y overflow-hidden rounded-lg border">
              {movements.slice(0, 6).map((movement) => (
                <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm" key={movement.id}>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{movement.reason}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{formatShiftTime(movement.createdAt, timezone)}</p>
                  </div>
                  <span className={movement.movementType === "PAY_IN" ? "font-semibold text-emerald-700 dark:text-emerald-400" : "font-semibold text-destructive"}>
                    {movement.movementType === "PAY_IN" ? "+" : "−"}{formatMinorMoney(movement.amountMinor, currencyCode)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <Dialog.Root onOpenChange={setIsCashManagementOpen} open={isCashManagementOpen}>
          <DialogContent className="w-full max-w-2xl" closeLabel="Close cash management">
            <DialogHeader>
              <DialogTitle>Cash management</DialogTitle>
              <DialogDescription>Record a pay in or pay out against this open shift. Every entry is retained in the cash audit trail.</DialogDescription>
            </DialogHeader>
            <DialogBody className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {canPayIn ? <CashMovementForm currencyCode={currencyCode} movementType="PAY_IN" shiftId={shift.id} /> : null}
                {canPayOut ? <CashMovementForm currencyCode={currencyCode} movementType="PAY_OUT" shiftId={shift.id} /> : null}
              </div>
              <CashMovementActivity currencyCode={currencyCode} movements={movements} timezone={timezone} />
            </DialogBody>
          </DialogContent>
        </Dialog.Root>

        <Dialog.Root onOpenChange={setIsCloseReviewOpen} open={isCloseReviewOpen}>
          <DialogContent className="w-full max-w-xl" closeLabel="Close shift review">
            <DialogHeader>
              <DialogTitle>Shift closing review</DialogTitle>
              <DialogDescription>Count the drawer before finalizing this historical shift record.</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <CloseShiftForm
                currencyCode={currencyCode}
                expectedCashMinor={summary?.expectedCashMinor ?? null}
                onClosed={(closeSummary) => {
                  setIsCloseReviewOpen(false);
                  onClosed(closeSummary);
                }}
                operationalSummary={operationalSummary}
                showExpectedCashBeforeClose={showExpectedCashBeforeClose}
                shiftId={shift.id}
              />
            </DialogBody>
          </DialogContent>
        </Dialog.Root>
      </CardContent>
    </Card>
  );
}

function ShiftOperationalOverview({
  currencyCode,
  summary,
  timezone,
}: {
  currencyCode: string;
  summary: ShiftOperationalSummary;
  timezone: string;
}) {
  const cashRows = [
    ["Starting cash", summary.shift.startingCashMinor],
    ["Cash payments", summary.cash.cashPaymentsMinor],
    ["Cash refunds", -(summary.cash.cashRefundsMinor ?? 0)],
    ["Paid in", summary.cash.paidInMinor],
    ["Paid out", -(summary.cash.paidOutMinor ?? 0)],
  ] as const;
  const salesRows = [
    ["Gross sales", summary.sales.grossSalesMinor],
    ["Refunds", -summary.sales.refundsMinor],
    ["Discounts", -summary.sales.discountsMinor],
    ["Net sales", summary.sales.netSalesMinor],
  ] as const;

  return (
    <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <p><span className="block text-xs text-muted-foreground">Shift number</span><span className="font-semibold">{summary.shift.number}</span></p>
        <p><span className="block text-xs text-muted-foreground">Opened by</span><span className="font-semibold">{summary.shift.openedBy}</span></p>
        <p><span className="block text-xs text-muted-foreground">Opened time</span>{formatShiftTime(summary.shift.openedAt, timezone)}</p>
        <p><span className="block text-xs text-muted-foreground">Store / register</span>{summary.shift.store} · {summary.shift.register}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <SummaryRows currencyCode={currencyCode} title="Cash drawer summary" rows={cashRows} />
        <SummaryRows currencyCode={currencyCode} title="Sales summary" rows={salesRows} />
      </div>
    </div>
  );
}

function SummaryRows({
  currencyCode,
  rows,
  title,
}: {
  currencyCode: string;
  rows: ReadonlyArray<readonly [string, number | null]>;
  title: string;
}) {
  return (
    <div className="rounded-lg bg-background p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="mt-2 grid gap-1 text-xs">
        {rows.map(([label, amount]) => (
          <p className="flex justify-between gap-3" key={label}><span>{label}</span><span className="font-medium">{amount === null ? "Hidden" : `${amount < 0 ? "−" : ""}${formatMinorMoney(Math.abs(amount), currencyCode)}`}</span></p>
        ))}
      </div>
    </div>
  );
}

function CashExpectation({ currencyCode, summary }: { currencyCode: string; summary: CashSummary }) {
  if (
    summary.openingCashMinor === null ||
    summary.cashSalesMinor === null ||
    summary.cashRefundsMinor === null ||
    summary.payInsMinor === null ||
    summary.payOutsMinor === null ||
    summary.expectedCashMinor === null
  ) {
    return null;
  }

  const rows = [
    ["Opening cash", summary.openingCashMinor],
    ["Cash sales", summary.cashSalesMinor],
    ["Cash refunds", -summary.cashRefundsMinor],
    ["Pay-ins", summary.payInsMinor],
    ["Pay-outs", -summary.payOutsMinor],
  ] as const;

  return (
    <div className="rounded-lg border bg-muted/25 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-medium"><Calculator className="size-4 text-primary" />Expected cash</p>
        <p className="text-lg font-semibold">{formatMinorMoney(summary.expectedCashMinor, currencyCode)}</p>
      </div>
      <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
        {rows.map(([label, amount]) => (
          <div className="flex justify-between" key={label}><span>{label}</span><span>{amount < 0 ? "−" : ""}{formatMinorMoney(Math.abs(amount), currencyCode)}</span></div>
        ))}
      </div>
    </div>
  );
}

function BlindCashNotice() {
  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
      <p className="flex items-center gap-2 text-sm font-medium"><EyeOff className="size-4 text-primary" />Blind cash count enabled</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        Count the drawer and submit the actual cash first. TINDIO will reveal the expected amount and over/short result after closing.
      </p>
    </div>
  );
}

function CashMovementActivity({
  currencyCode,
  movements,
  timezone,
}: {
  currencyCode: string;
  movements: CashMovement[];
  timezone: string;
}) {
  return (
    <section aria-labelledby="cash-management-activity">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium" id="cash-management-activity">Activity</p>
        <p className="text-xs text-muted-foreground">Newest first</p>
      </div>
      {movements.length > 0 ? (
        <div className="mt-2 divide-y overflow-hidden rounded-lg border">
          {movements.map((movement) => (
            <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm" key={movement.id}>
              <div className="min-w-0">
                <p className="truncate font-medium">{movement.reason}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{formatShiftTime(movement.createdAt, timezone)}</p>
              </div>
              <span className={movement.movementType === "PAY_IN" ? "shrink-0 font-semibold text-emerald-700 dark:text-emerald-400" : "shrink-0 font-semibold text-destructive"}>
                {movement.movementType === "PAY_IN" ? "+" : "−"}{formatMinorMoney(movement.amountMinor, currencyCode)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">No pay-in or pay-out has been recorded for this shift.</p>
      )}
    </section>
  );
}

function CashMovementForm({
  currencyCode,
  movementType,
  shiftId,
}: {
  currencyCode: string;
  movementType: "PAY_IN" | "PAY_OUT";
  shiftId: string;
}) {
  const router = useRouter();
  const isPayIn = movementType === "PAY_IN";
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [message, setMessage] = useState<string | null>(null);
  const [approvalRequestId, setApprovalRequestId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const completeMovement = async (pendingApprovalRequestId: string | null) => {
    const result = await recordCashMovementAction({
      shiftId,
      movementType,
      amount,
      reason,
      idempotencyKey,
      approvalRequestId: pendingApprovalRequestId,
    });
    setMessage(result.message);
    if (result.ok) {
      setAmount("");
      setReason("");
      setIdempotencyKey(crypto.randomUUID());
      router.refresh();
    }
  };

  const submit = () => {
    startTransition(async () => {
      if (movementType === "PAY_OUT") {
        const approval = await requestManagerApprovalAction({
          operationCode: "cash.pay_out",
          reason,
          payload: {
            shift_id: shiftId,
            movement_type: movementType,
            amount_minor: moneyInputToMinor(amount),
            reason: reason.trim(),
          },
        });

        if (!approval.ok) {
          setMessage(approval.message);
          return;
        }

        if (approval.decision === "APPROVAL_REQUIRED") {
          setApprovalRequestId(approval.data.approvalRequestId);
          setMessage(approval.message);
          return;
        }
      }

      await completeMovement(null);
    });
  };

  return (
    <div className="rounded-lg border p-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        {isPayIn ? <ArrowDownToLine className="size-4 text-emerald-700 dark:text-emerald-400" /> : <ArrowUpFromLine className="size-4 text-destructive" />}
        {isPayIn ? "Pay in" : "Pay out"}
      </p>
      <div className="mt-3 grid gap-2">
        <Input aria-label={`${isPayIn ? "Pay in" : "Pay out"} amount in ${currencyCode}`} disabled={isPending} inputMode="decimal" min="0.01" onChange={(event) => setAmount(event.target.value)} placeholder="Amount" step="0.01" type="number" value={amount} />
        <Input disabled={isPending} maxLength={500} minLength={2} onChange={(event) => setReason(event.target.value)} placeholder="Reason" value={reason} />
        <Button disabled={isPending || !amount || reason.trim().length < 2} onClick={submit} size="sm" type="button" variant={isPayIn ? "secondary" : "outline"}>
          {isPending ? <LoaderCircle className="animate-spin" /> : isPayIn ? <ArrowDownToLine /> : <ArrowUpFromLine />}
          Record {isPayIn ? "pay-in" : "pay-out"}
        </Button>
        {message ? <p aria-live="polite" className="text-xs text-muted-foreground">{message}</p> : null}
      </div>
      {approvalRequestId ? (
        <ManagerApprovalDialog
          approvalRequestId={approvalRequestId}
          onApproved={() => {
            const requestId = approvalRequestId;
            setApprovalRequestId(null);
            startTransition(async () => {
              await completeMovement(requestId);
            });
          }}
          onCancel={() => setApprovalRequestId(null)}
          operationLabel="Cash pay-out"
        />
      ) : null}
    </div>
  );
}

function CloseShiftForm({
  currencyCode,
  expectedCashMinor,
  onClosed,
  operationalSummary,
  showExpectedCashBeforeClose,
  shiftId,
}: {
  currencyCode: string;
  expectedCashMinor: number | null;
  onClosed: (summary: { expectedCashMinor: number; countedCashMinor: number; differenceMinor: number }) => void;
  operationalSummary: ShiftOperationalSummary | undefined;
  showExpectedCashBeforeClose: boolean;
  shiftId: string;
}) {
  const router = useRouter();
  const [countedCash, setCountedCash] = useState("");
  const [closingNote, setClosingNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const countedCashMinor = moneyInputToMinor(countedCash);
  const expectedDifferenceMinor = expectedCashMinor === null ? null : countedCashMinor - expectedCashMinor;

  const submit = () => {
    startTransition(async () => {
      const result = await closeShiftAction({ shiftId, countedCash, closingNote });
      setMessage(result.message);
      if (result.ok) {
        if (result.closeSummary) onClosed(result.closeSummary);
        setConfirmOpen(false);
        router.refresh();
      }
    });
  };

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium"><LockKeyhole className="size-4 text-primary" />Close shift</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {expectedCashMinor === null
              ? "Counted cash is compared after you submit this blind close."
              : `Expected: ${formatMinorMoney(expectedCashMinor, currencyCode)}`}
          </p>
        </div>
      </div>
      {showExpectedCashBeforeClose && operationalSummary ? (
        <ShiftCloseReviewTotals currencyCode={currencyCode} summary={operationalSummary} />
      ) : null}
      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto]">
        <Input aria-label="Counted cash" disabled={isPending} inputMode="decimal" min="0" onChange={(event) => setCountedCash(event.target.value)} placeholder="Counted cash" step="0.01" type="number" value={countedCash} />
        <Input disabled={isPending} maxLength={500} onChange={(event) => setClosingNote(event.target.value)} placeholder="Closing note (optional)" value={closingNote} />
        <Button disabled={isPending || !countedCash} onClick={() => setConfirmOpen(true)} type="button">
          {isPending ? <LoaderCircle className="animate-spin" /> : <LockKeyhole />}
          Close shift
        </Button>
      </div>
      {countedCash && expectedDifferenceMinor !== null ? (
        <p className="mt-3 text-sm">
          <span className="text-muted-foreground">Difference</span>
          <span className={expectedDifferenceMinor === 0 ? "ml-2 font-semibold" : expectedDifferenceMinor > 0 ? "ml-2 font-semibold text-emerald-700 dark:text-emerald-400" : "ml-2 font-semibold text-destructive"}>
            {expectedDifferenceMinor > 0 ? "+" : ""}{formatMinorMoney(expectedDifferenceMinor, currencyCode)}
          </span>
        </p>
      ) : null}
      {message ? <p aria-live="polite" className="mt-2 text-xs text-muted-foreground">{message}</p> : null}
      <Dialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record this shift close?</DialogTitle>
            <DialogDescription>
              This records the cash count and any difference in shift history. Completed sales and payments are not changed.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-3">
              {expectedCashMinor === null ? <p><span className="block text-xs text-muted-foreground">Expected cash</span>Shown after blind close</p> : <p><span className="block text-xs text-muted-foreground">Expected cash</span>{formatMinorMoney(expectedCashMinor, currencyCode)}</p>}
              <p><span className="block text-xs text-muted-foreground">Counted cash</span>{formatMinorMoney(countedCashMinor, currencyCode)}</p>
              {expectedDifferenceMinor === null ? null : <p><span className="block text-xs text-muted-foreground">Difference</span>{expectedDifferenceMinor > 0 ? "+" : ""}{formatMinorMoney(expectedDifferenceMinor, currencyCode)}</p>}
            </div>
            {closingNote ? <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">Closing note:</span> {closingNote}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button disabled={isPending} onClick={() => setConfirmOpen(false)} type="button" variant="outline">Cancel</Button>
            <Button disabled={isPending} onClick={submit} type="button">
              {isPending ? <LoaderCircle className="animate-spin" /> : <LockKeyhole />}
              Record close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog.Root>
    </div>
  );
}

function ShiftCloseReviewTotals({
  currencyCode,
  summary,
}: {
  currencyCode: string;
  summary: ShiftOperationalSummary;
}) {
  const rows = [
    ["Gross sales", summary.sales.grossSalesMinor],
    ["Refunds", -summary.sales.refundsMinor],
    ["Discounts", -summary.sales.discountsMinor],
    ["Net sales", summary.sales.netSalesMinor],
    ["Starting cash", summary.shift.startingCashMinor],
    ["Cash sales", summary.cash.cashPaymentsMinor],
    ["Cash refunds", -(summary.cash.cashRefundsMinor ?? 0)],
    ["Paid in", summary.cash.paidInMinor],
    ["Paid out", -(summary.cash.paidOutMinor ?? 0)],
    ["Expected cash", summary.cash.expectedCashMinor],
  ] as const;

  return (
    <div className="mt-4 rounded-lg border bg-background/70 p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Closing review</p>
      <div className="mt-3 grid gap-x-5 gap-y-1.5 text-xs sm:grid-cols-2">
        {rows.map(([label, amount]) => (
          <p className="flex justify-between gap-3" key={label}>
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium">
              {amount === null
                ? "—"
                : `${amount < 0 ? "−" : ""}${formatMinorMoney(Math.abs(amount), currencyCode)}`}
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}

function CashCloseRecordedNotice({
  currencyCode,
  summary,
}: {
  currencyCode: string;
  summary: { expectedCashMinor: number; countedCashMinor: number; differenceMinor: number };
}) {
  const differenceLabel = summary.differenceMinor === 0
    ? "Balanced"
    : summary.differenceMinor > 0
      ? "Over"
      : "Short";

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="size-4 text-primary" />Cash close recorded</p>
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        <p className="rounded-lg bg-background/70 px-3 py-2"><span className="block text-xs text-muted-foreground">Expected</span>{formatMinorMoney(summary.expectedCashMinor, currencyCode)}</p>
        <p className="rounded-lg bg-background/70 px-3 py-2"><span className="block text-xs text-muted-foreground">Counted</span>{formatMinorMoney(summary.countedCashMinor, currencyCode)}</p>
        <p className="rounded-lg bg-background/70 px-3 py-2"><span className="block text-xs text-muted-foreground">{differenceLabel}</span>{summary.differenceMinor > 0 ? "+" : ""}{formatMinorMoney(summary.differenceMinor, currencyCode)}</p>
      </div>
    </div>
  );
}

function CashCloseVisibilitySetting({ initialValue }: { initialValue: boolean }) {
  const router = useRouter();
  const [showExpectedCashBeforeClose, setShowExpectedCashBeforeClose] = useState(initialValue);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const toggle = () => {
    const nextValue = !showExpectedCashBeforeClose;
    startTransition(async () => {
      const result = await updateShiftCashCloseSettingAction(nextValue);
      setMessage(result.message);
      if (result.ok) {
        setShowExpectedCashBeforeClose(nextValue);
        router.refresh();
      }
    });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2"><Eye className="size-4 text-primary" />Cash-close visibility</CardTitle>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {showExpectedCashBeforeClose
              ? "Cashiers can see expected drawer cash before entering their counted amount."
              : "Blind count is on: expected cash and transaction breakdowns stay hidden until the close is submitted."}
          </p>
        </div>
        <Button disabled={isPending} onClick={toggle} type="button" variant={showExpectedCashBeforeClose ? "outline" : "default"}>
          {isPending ? <LoaderCircle className="animate-spin" /> : showExpectedCashBeforeClose ? <EyeOff /> : <Eye />}
          {showExpectedCashBeforeClose ? "Enable blind count" : "Show expected cash"}
        </Button>
      </CardHeader>
      {message ? <CardContent className="pt-0"><p aria-live="polite" className="text-sm text-muted-foreground">{message}</p></CardContent> : null}
    </Card>
  );
}

function ClosedShiftHistory({
  auditFilters,
  canViewClosedShiftAudit,
  currencyCode,
  presentation,
  registers,
  shifts,
  stores,
  timezone,
}: {
  auditFilters?: ReactNode;
  canViewClosedShiftAudit: boolean;
  currencyCode: string;
  presentation: "audit-card" | "drawer-action";
  registers: RegisterOption[];
  shifts: ShiftRecord[];
  stores: StoreOption[];
  timezone: string;
}) {
  const [detail, setDetail] = useState<ShiftAuditReport | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isLoading, startLoadingTransition] = useTransition();
  const [loadError, setLoadError] = useState(false);
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
  const requestId = useRef(0);
  const lastFocusedShiftId = useRef<string | null>(null);

  const openShiftReport = (shiftId: string) => {
    if (!canViewClosedShiftAudit) return;
    const currentRequest = requestId.current + 1;
    requestId.current = currentRequest;
    lastFocusedShiftId.current = shiftId;
    setSelectedShiftId(shiftId);
    setDetail(null);
    setLoadError(false);
    setIsDrawerOpen(true);

    startLoadingTransition(async () => {
      const result = await loadShiftQuickViewAction({ shiftId });
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
    setIsDrawerOpen(false);
    setLoadError(false);
    setDetail(null);
    const shiftId = lastFocusedShiftId.current;
    if (shiftId) {
      window.requestAnimationFrame(() => {
        const candidates = [
          document.getElementById(`shift-report-open-${shiftId}`),
          document.getElementById(`shift-report-open-mobile-${shiftId}`),
        ];
        candidates.find((element) => element && element.getClientRects().length > 0)?.focus();
      });
    }
  };
  const openHistory = () => {
    requestId.current += 1;
    setSelectedShiftId(null);
    setDetail(null);
    setLoadError(false);
    setIsDrawerOpen(true);
  };
  const historyEntries = shifts.map((shift) => ({
    shift,
    registerName: registers.find((item) => item.id === shift.registerId)?.name ?? "Register",
    storeName: stores.find((item) => item.id === shift.storeId)?.name ?? "Store",
  }));

  return (
    <>
    {presentation === "audit-card" ? <Card>
      <CardHeader className="border-b">
        <CardTitle>Shift history</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">Review closed shifts, expected cash, counted cash, and any differences.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {auditFilters}
        {shifts.length > 0 ? (
          <>
          <div className="hidden overflow-x-auto overscroll-x-contain rounded-lg border md:block">
            <table className="w-full min-w-190 text-left text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Store</th><th className="px-3 py-2 font-medium">Register</th><th className="px-3 py-2 font-medium">Employee</th><th className="px-3 py-2 font-medium">Closed</th><th className="px-3 py-2 text-right font-medium">Expected</th><th className="px-3 py-2 text-right font-medium">Counted</th><th className="px-3 py-2 text-right font-medium">Difference</th></tr></thead>
              <tbody className="divide-y">
                {shifts.map((shift) => {
                  const difference = shift.differenceMinor ?? 0;
                  const registerName = registers.find((item) => item.id === shift.registerId)?.name ?? "Register";
                  const storeName = stores.find((item) => item.id === shift.storeId)?.name ?? "Store";
                  const isSelected = selectedShiftId === shift.id && isDrawerOpen;
                  const openLabel = `View shift report for ${registerName}, closed ${shift.closedAt ? formatShiftTime(shift.closedAt, timezone) : "recently"}`;
                  const openReport = () => openShiftReport(shift.id);
                  return <tr
                    aria-busy={isSelected && isLoading ? true : undefined}
                    aria-label={canViewClosedShiftAudit ? openLabel : undefined}
                    className={canViewClosedShiftAudit ? `cursor-pointer transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 ${isSelected ? "bg-primary/10 hover:bg-primary/10" : ""}` : undefined}
                    id={`shift-report-open-${shift.id}`}
                    key={shift.id}
                    onClick={openReport}
                    onKeyDown={(event) => {
                      if (!canViewClosedShiftAudit || event.currentTarget !== event.target || (event.key !== "Enter" && event.key !== " ")) return;
                      event.preventDefault();
                      openReport();
                    }}
                    role={canViewClosedShiftAudit ? "button" : undefined}
                    aria-pressed={isSelected}
                    tabIndex={canViewClosedShiftAudit ? 0 : undefined}
                  >
                    <td className="px-3 py-3 font-medium">{storeName}</td>
                    <td className="px-3 py-3 font-medium">{registerName}</td>
                    <td className="px-3 py-3 text-muted-foreground">{shift.openedByName}</td>
                    <td className="px-3 py-3 text-muted-foreground">{shift.closedAt ? formatShiftTime(shift.closedAt, timezone) : "—"}</td>
                    <td className="px-3 py-3 text-right">{formatMinorMoney(shift.expectedCashMinor ?? 0, currencyCode)}</td>
                    <td className="px-3 py-3 text-right">{formatMinorMoney(shift.countedCashMinor ?? 0, currencyCode)}</td>
                    <td className={difference === 0 ? "px-3 py-3 text-right font-medium" : difference > 0 ? "px-3 py-3 text-right font-medium text-emerald-700 dark:text-emerald-400" : "px-3 py-3 text-right font-medium text-destructive"}><span className="block">{difference > 0 ? "+" : ""}{formatMinorMoney(difference, currencyCode)}</span><span className="block text-xs font-normal">{difference === 0 ? "Balanced" : difference > 0 ? "Over" : "Short"}</span></td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          <div className="divide-y overflow-hidden rounded-lg border md:hidden">
            {historyEntries.map(({ registerName, shift, storeName }) => {
              const difference = shift.differenceMinor ?? 0;
              const isSelected = selectedShiftId === shift.id && isDrawerOpen;
              return <button aria-pressed={isSelected} className={`w-full px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${isSelected ? "bg-primary/10" : ""}`} id={`shift-report-open-mobile-${shift.id}`} key={shift.id} onClick={() => openShiftReport(shift.id)} type="button">
                <span className="flex items-start justify-between gap-3"><span><span className="block font-semibold">{storeName} · {registerName}</span><span className="mt-1 block text-xs text-muted-foreground">{shift.openedByName} · {shift.closedAt ? formatShiftTime(shift.closedAt, timezone) : "Recently closed"}</span></span><span className={difference === 0 ? "shrink-0 text-right text-sm" : difference > 0 ? "shrink-0 text-right text-sm text-emerald-700 dark:text-emerald-400" : "shrink-0 text-right text-sm text-destructive"}><span className="block font-semibold">{difference > 0 ? "+" : ""}{formatMinorMoney(difference, currencyCode)}</span><span className="block text-xs">{difference === 0 ? "Balanced" : difference > 0 ? "Over" : "Short"}</span></span></span>
                <span className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground"><span>Expected <strong className="block text-foreground">{formatMinorMoney(shift.expectedCashMinor ?? 0, currencyCode)}</strong></span><span>Counted <strong className="block text-foreground">{formatMinorMoney(shift.countedCashMinor ?? 0, currencyCode)}</strong></span></span>
              </button>;
            })}
          </div>
          </>
        ) : <div className="rounded-lg border border-dashed p-5"><p className="font-medium">No closed shifts yet.</p><p className="mt-1 text-sm text-muted-foreground">Completed register shifts will appear here after they are closed.</p></div>}
      </CardContent>
    </Card> : canViewClosedShiftAudit ? (
      <div className="flex justify-end">
        <Button onClick={openHistory} type="button" variant="outline">
          <History aria-hidden="true" />
          Shift history
        </Button>
      </div>
    ) : null}
      <ShiftAuditDrawer
        allowHistoryNavigation={presentation === "drawer-action"}
        currencyCode={currencyCode}
        detail={detail}
        historyEntries={historyEntries}
        isLoading={isLoading}
        loadError={loadError}
        onOpenShiftReport={openShiftReport}
        onShowHistory={openHistory}
        onClose={closeDrawer}
        onRetry={() => selectedShiftId && openShiftReport(selectedShiftId)}
        open={isDrawerOpen}
        timezone={timezone}
      />
    </>
  );
}

function ShiftAuditDrawer({
  allowHistoryNavigation,
  currencyCode,
  detail,
  historyEntries,
  isLoading,
  loadError,
  onClose,
  onOpenShiftReport,
  onRetry,
  onShowHistory,
  open,
  timezone,
}: {
  allowHistoryNavigation: boolean;
  currencyCode: string;
  detail: ShiftAuditReport | null;
  historyEntries: ShiftHistoryEntry[];
  isLoading: boolean;
  loadError: boolean;
  onClose: () => void;
  onOpenShiftReport: (shiftId: string) => void;
  onRetry: () => void;
  onShowHistory: () => void;
  open: boolean;
  timezone: string;
}) {
  const [activityExpandedForShiftId, setActivityExpandedForShiftId] = useState<string | null>(null);
  const showAllActivity = activityExpandedForShiftId === detail?.shift.id;
  const difference = detail?.shift.differenceMinor ?? 0;
  const differenceLabel = difference === 0 ? "Balanced" : difference > 0 ? "Over" : "Short";
  const chronologicalCashMovements = detail?.cashMovements.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt)) ?? [];
  const cashActivity = showAllActivity ? chronologicalCashMovements : chronologicalCashMovements.slice(0, 4);

  return (
    <Dialog.Root onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }} open={open}>
      <BackOfficeDetailDrawer closeLabel="Close shift report" width="compact">
        <DialogHeader className="sticky top-0 z-10 shrink-0 border-b bg-background pr-20 sm:pr-24">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2"><DialogTitle>{detail ? `Shift ${detail.shift.number}` : "Shift history"}</DialogTitle>{detail ? <Badge variant="secondary">Closed</Badge> : null}</div>
              <DialogDescription className="mt-1">{detail ? <>{detail.shift.store} · {detail.shift.register}<span className="block">{detail.shift.openedBy}</span></> : "Select a closed shift to inspect its recorded reconciliation."}</DialogDescription>
            </div>
            {detail ? <Menu.Root modal={false}>
              <Menu.Trigger aria-label="Shift report actions" className="grid size-9 shrink-0 place-items-center rounded-lg border bg-background text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"><EllipsisVertical aria-hidden="true" className="size-4" /></Menu.Trigger>
              <Menu.Portal><Menu.Positioner align="end" className="z-[70]" side="bottom" sideOffset={6}><Menu.Popup className="w-52 rounded-lg border bg-popover p-1 shadow-lg outline-none">
                <ShiftClosePrintButton closedAt={detail.shift.closedAt} countedCashMinor={detail.shift.countedCashMinor} currencyCode={currencyCode} differenceMinor={detail.shift.differenceMinor} expectedCashMinor={detail.shift.expectedCashMinor} openedAt={detail.shift.openedAt} operationalSummary={toShiftOperationalSummary(detail)} registerName={detail.shift.register} renderAsMenuItem shiftId={detail.shift.number} storeName={detail.shift.store} timezone={timezone} />
              </Menu.Popup></Menu.Positioner></Menu.Portal>
            </Menu.Root> : null}
          </div>
        </DialogHeader>
        <DialogBody aria-busy={isLoading || undefined} className="min-h-0 max-h-none flex-1 space-y-4">
          {detail && allowHistoryNavigation ? (
            <Button onClick={onShowHistory} size="sm" type="button" variant="ghost">
              <ArrowLeft aria-hidden="true" />
              All closed shifts
            </Button>
          ) : null}
          {isLoading && !detail ? <ShiftReportSkeleton /> : null}
          {isLoading && detail ? <p aria-live="polite" className="text-xs text-muted-foreground">Updating shift report…</p> : null}
          {loadError ? (
            <section className="rounded-xl border border-dashed p-5 text-center">
              <p className="font-medium">We couldn&apos;t load this shift report.</p>
              <p className="mt-1 text-sm text-muted-foreground">The shift list is still available. Please try again.</p>
              <Button className="mt-4" onClick={onRetry} type="button" variant="outline">Try again</Button>
            </section>
          ) : null}
          {!detail && !isLoading && !loadError ? (
            <ShiftHistoryList currencyCode={currencyCode} entries={historyEntries} onOpenShiftReport={onOpenShiftReport} timezone={timezone} />
          ) : null}
          {detail ? <ShiftAuditDetail
            cashActivity={cashActivity}
            currencyCode={currencyCode}
            detail={detail}
            difference={difference}
            differenceLabel={differenceLabel}
            onToggleActivity={() => setActivityExpandedForShiftId((current) => current === detail.shift.id ? null : detail.shift.id)}
            showAllActivity={showAllActivity}
            timezone={timezone}
          /> : null}
        </DialogBody>
      </BackOfficeDetailDrawer>
    </Dialog.Root>
  );
}

function ShiftHistoryList({
  currencyCode,
  entries,
  onOpenShiftReport,
  timezone,
}: {
  currencyCode: string;
  entries: ShiftHistoryEntry[];
  onOpenShiftReport: (shiftId: string) => void;
  timezone: string;
}) {
  return (
    <section aria-label="Closed shifts">
      <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">Closed shifts</p>
      {entries.length > 0 ? (
        <div className="mt-3 divide-y overflow-hidden rounded-xl border">
          {entries.map(({ registerName, shift, storeName }) => {
            const difference = shift.differenceMinor ?? 0;
            return (
              <button
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                key={shift.id}
                onClick={() => onOpenShiftReport(shift.id)}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{storeName} · {registerName}</span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {shift.closedAt ? formatShiftTime(shift.closedAt, timezone) : "Recently closed"}
                  </span>
                </span>
                <span className="shrink-0 text-right text-sm">
                  <span className="block font-medium">{difference === 0 ? "Balanced" : difference > 0 ? "Over" : "Short"}</span>
                  <span className={difference === 0 ? "text-xs text-muted-foreground" : difference > 0 ? "text-xs text-emerald-700 dark:text-emerald-400" : "text-xs text-destructive"}>
                    {difference > 0 ? "+" : ""}{formatMinorMoney(Math.abs(difference), currencyCode)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-dashed p-4"><p className="font-medium">No closed shifts yet.</p><p className="mt-1 text-sm text-muted-foreground">Completed register shifts will appear here after they are closed.</p></div>
      )}
    </section>
  );
}

function ShiftAuditDetail({
  cashActivity,
  currencyCode,
  detail,
  difference,
  differenceLabel,
  onToggleActivity,
  showAllActivity,
  timezone,
}: {
  cashActivity: ShiftAuditReport["cashMovements"];
  currencyCode: string;
  detail: ShiftAuditReport;
  difference: number;
  differenceLabel: string;
  onToggleActivity: () => void;
  showAllActivity: boolean;
  timezone: string;
}) {
  return <>
    <section className="rounded-xl border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-sm font-semibold">{detail.shift.store} · {detail.shift.register}</p><p className="mt-1 text-sm text-muted-foreground">Closed {formatShiftTime(detail.shift.closedAt, timezone)}</p></div>
        <Badge variant={difference === 0 ? "secondary" : difference > 0 ? "default" : "destructive"}>{differenceLabel}{difference === 0 ? "" : ` ${formatMinorMoney(Math.abs(difference), currencyCode)}`}</Badge>
      </div>
    </section>

    <ShiftReportSection title="Shift identity">
      <ShiftReportRow label="Store" value={detail.shift.store} />
      <ShiftReportRow label="Register" value={detail.shift.register} />
      <ShiftReportRow label="Employee" value={detail.shift.openedBy} />
      <ShiftReportRow label="Opened" value={formatShiftTime(detail.shift.openedAt, timezone)} />
      <ShiftReportRow label="Closed" value={formatShiftTime(detail.shift.closedAt, timezone)} />
      <ShiftReportRow label="Duration" value={formatShiftDuration(detail.shift.openedAt, detail.shift.closedAt)} />
    </ShiftReportSection>

    <ShiftReportSection title="Cash reconciliation">
      <ShiftReportRow label="Starting cash" value={formatMinorMoney(detail.shift.openingCashMinor, currencyCode)} />
      <ShiftReportRow label="Cash payments" value={formatMinorMoney(detail.cash.cashPaymentsMinor, currencyCode)} />
      <ShiftReportRow label="Cash refunds" value={`−${formatMinorMoney(detail.cash.cashRefundsMinor, currencyCode)}`} />
      <ShiftReportRow label="Pay in" value={formatMinorMoney(detail.cash.paidInMinor, currencyCode)} />
      <ShiftReportRow label="Pay out" value={`−${formatMinorMoney(detail.cash.paidOutMinor, currencyCode)}`} />
      <ShiftReportRow label={<span className="inline-flex items-center gap-1.5">Expected cash <ContextHelp label="How expected cash is calculated">Starting cash + cash sales − cash refunds + paid in − paid out. This comes from recorded payments and cash movements.</ContextHelp></span>} value={formatMinorMoney(detail.shift.expectedCashMinor, currencyCode)} />
      <ShiftReportRow label="Counted cash" value={formatMinorMoney(detail.shift.countedCashMinor, currencyCode)} />
      <ShiftReportRow emphasized label="Difference" value={`${difference > 0 ? "+" : ""}${formatMinorMoney(difference, currencyCode)} · ${differenceLabel}`} />
    </ShiftReportSection>

    <ShiftReportSection title="Sales summary">
      <ShiftReportRow label="Gross sales" value={formatMinorMoney(detail.sales.grossSalesMinor, currencyCode)} />
      <ShiftReportRow label="Refunds" value={`−${formatMinorMoney(detail.sales.refundsMinor, currencyCode)}`} />
      <ShiftReportRow label="Discounts" value={`−${formatMinorMoney(detail.sales.discountsMinor, currencyCode)}`} />
      <ShiftReportRow label="Tax" value={formatMinorMoney(detail.sales.taxMinor, currencyCode)} />
      <ShiftReportRow emphasized label="Net sales" value={formatMinorMoney(detail.sales.netSalesMinor, currencyCode)} />
      <ShiftReportRow label="Transactions" value={String(detail.sales.saleCount)} />
      <ShiftReportRow label="Average order" value={detail.sales.saleCount > 0 ? formatMinorMoney(Math.round(detail.sales.netSalesMinor / detail.sales.saleCount), currencyCode) : "—"} />
    </ShiftReportSection>

    <ShiftReportSection title="Payments">
      {detail.paymentBreakdown.length > 0 ? detail.paymentBreakdown.map((payment) => <div className="border-b py-2.5 last:border-b-0" key={`${payment.type}-${payment.name}`}>
        <div className="flex items-baseline justify-between gap-3"><span className="font-medium">{payment.name}</span><span className="font-medium tabular-nums">{formatMinorMoney(payment.netMinor, currencyCode)}</span></div>
        <p className="mt-1 text-xs text-muted-foreground">{payment.type} · {payment.salePaymentCount} payment{payment.salePaymentCount === 1 ? "" : "s"}{payment.refundPaymentCount > 0 ? ` · ${payment.refundPaymentCount} refund${payment.refundPaymentCount === 1 ? "" : "s"}` : ""}</p>
      </div>) : <p className="text-sm text-muted-foreground">No recorded payment breakdown is available.</p>}
    </ShiftReportSection>

    <ShiftReportSection title="Cash movements">
      {cashActivity.length > 0 ? <>
        {cashActivity.map((movement) => <div className="border-b py-2.5 last:border-b-0" key={movement.id}>
          <div className="flex items-baseline justify-between gap-3"><span className="font-medium">{movement.type === "PAY_IN" ? "Pay in" : "Pay out"}</span><span className="font-medium tabular-nums">{movement.type === "PAY_IN" ? "+" : "−"}{formatMinorMoney(movement.amountMinor, currencyCode)}</span></div>
          <p className="mt-1 text-xs text-muted-foreground">{movement.reason} · {movement.employee} · {formatShiftTime(movement.createdAt, timezone)}</p>
        </div>)}
        {detail.cashMovements.length > 4 ? <Button className="mt-3" onClick={onToggleActivity} size="sm" type="button" variant="ghost">{showAllActivity ? "Show recent activity" : `View all ${detail.cashMovements.length} movements`}</Button> : null}
      </> : <p className="text-sm text-muted-foreground">No cash movements recorded.</p>}
    </ShiftReportSection>

    {detail.shift.closingNote || detail.shift.openingNote ? <ShiftReportSection title="Shift notes">
      {detail.shift.openingNote ? <ShiftReportRow label="Opening note" value={detail.shift.openingNote} /> : null}
      {detail.shift.closingNote ? <ShiftReportRow label="Closing note" value={detail.shift.closingNote} /> : null}
    </ShiftReportSection> : null}

    {detail.audit.available && detail.audit.events.length > 0 ? <ShiftReportSection title="Audit history">
      {detail.audit.events.slice(0, 5).map((event) => <div className="border-b py-2.5 last:border-b-0" key={event.id}><p className="font-medium">{event.eventType.replaceAll("_", " ")}</p><p className="mt-1 text-xs text-muted-foreground">{event.actor} · {formatShiftTime(event.createdAt, timezone)}{event.reason ? ` · ${event.reason}` : ""}</p></div>)}
    </ShiftReportSection> : null}
  </>;
}

function ShiftReportSection({ children, title }: { children: ReactNode; title: string }) {
  return <section className="rounded-xl border p-4"><h3 className="text-sm font-semibold">{title}</h3><div className="mt-2 divide-y">{children}</div></section>;
}

function ShiftReportRow({ emphasized = false, label, value }: { emphasized?: boolean; label: ReactNode; value: ReactNode }) {
  return <div className={`flex items-start justify-between gap-4 py-2 text-sm ${emphasized ? "font-semibold" : ""}`}><span className="text-muted-foreground">{label}</span><span className="text-right tabular-nums">{value}</span></div>;
}

function ShiftReportSkeleton() {
  return <div aria-label="Loading shift report" className="space-y-4" role="status"><div className="h-20 animate-pulse rounded-xl bg-muted" /><div className="h-64 animate-pulse rounded-xl bg-muted" /><div className="h-40 animate-pulse rounded-xl bg-muted" /><span className="sr-only">Loading shift report</span></div>;
}

function formatShiftDuration(openedAt: string, closedAt: string) {
  const milliseconds = new Date(closedAt).getTime() - new Date(openedAt).getTime();
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  const totalMinutes = Math.floor(milliseconds / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function toShiftOperationalSummary(detail: ShiftAuditReport): ShiftOperationalSummary {
  return {
    shift: { id: detail.shift.id, number: detail.shift.number, status: "closed", openedBy: detail.shift.openedBy, openedAt: detail.shift.openedAt, closedAt: detail.shift.closedAt, store: detail.shift.store, register: detail.shift.register, startingCashMinor: detail.shift.openingCashMinor, actualCashMinor: detail.shift.countedCashMinor, differenceMinor: detail.shift.differenceMinor },
    cash: { cashPaymentsMinor: detail.cash.cashPaymentsMinor, cashRefundsMinor: detail.cash.cashRefundsMinor, paidInMinor: detail.cash.paidInMinor, paidOutMinor: detail.cash.paidOutMinor, expectedCashMinor: detail.shift.expectedCashMinor },
    sales: { grossSalesMinor: detail.sales.grossSalesMinor, refundsMinor: detail.sales.refundsMinor, discountsMinor: detail.sales.discountsMinor, netSalesMinor: detail.sales.netSalesMinor },
  };
}

function escapePrintHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;",
  })[character] ?? character);
}

export function ShiftClosePrintButton({
  closedAt,
  countedCashMinor,
  currencyCode,
  differenceMinor,
  expectedCashMinor,
  openedAt,
  operationalSummary,
  registerName,
  renderAsMenuItem = false,
  shiftId,
  showLabel = false,
  storeName,
  timezone,
}: {
  closedAt: string | null;
  countedCashMinor: number;
  currencyCode: string;
  differenceMinor: number;
  expectedCashMinor: number;
  openedAt: string;
  operationalSummary: ShiftOperationalSummary | undefined;
  registerName: string;
  renderAsMenuItem?: boolean;
  shiftId: string;
  showLabel?: boolean;
  storeName: string;
  timezone: string;
}) {
  const print = () => {
    const printWindow = window.open("", "tindio-shift-close", "width=480,height=700");
    if (!printWindow) return;

    const differenceLabel = differenceMinor === 0
      ? "Balanced"
      : differenceMinor > 0
        ? "Over"
        : "Short";
    const rows = operationalSummary
      ? [
          ["Starting cash", formatMinorMoney(operationalSummary.shift.startingCashMinor, currencyCode)],
          ["Cash payments", formatMinorMoney(operationalSummary.cash.cashPaymentsMinor ?? 0, currencyCode)],
          ["Cash refunds", formatMinorMoney(operationalSummary.cash.cashRefundsMinor ?? 0, currencyCode)],
          ["Paid in", formatMinorMoney(operationalSummary.cash.paidInMinor ?? 0, currencyCode)],
          ["Paid out", formatMinorMoney(operationalSummary.cash.paidOutMinor ?? 0, currencyCode)],
          ["Expected cash", operationalSummary.cash.expectedCashMinor === null ? "Hidden until close" : formatMinorMoney(operationalSummary.cash.expectedCashMinor, currencyCode)],
          ["Actual cash", formatMinorMoney(operationalSummary.shift.actualCashMinor ?? countedCashMinor, currencyCode)],
          [differenceLabel, `${differenceMinor > 0 ? "+" : ""}${formatMinorMoney(differenceMinor, currencyCode)}`],
          ["Gross sales", formatMinorMoney(operationalSummary.sales.grossSalesMinor, currencyCode)],
          ["Refunds", formatMinorMoney(operationalSummary.sales.refundsMinor, currencyCode)],
          ["Discounts", formatMinorMoney(operationalSummary.sales.discountsMinor, currencyCode)],
          ["Net sales", formatMinorMoney(operationalSummary.sales.netSalesMinor, currencyCode)],
        ]
      : [
          ["Expected cash", formatMinorMoney(expectedCashMinor, currencyCode)],
          ["Counted cash", formatMinorMoney(countedCashMinor, currencyCode)],
          [differenceLabel, `${differenceMinor > 0 ? "+" : ""}${formatMinorMoney(differenceMinor, currencyCode)}`],
        ];
    const details = [
      ["Store", storeName],
      ["Register", registerName],
      ["Shift reference", shiftId],
      ["Opened", formatShiftTime(openedAt, timezone)],
      ["Closed", closedAt ? formatShiftTime(closedAt, timezone) : "Recorded close"],
    ];

    printWindow.document.write(`<!doctype html><html><head><title>TINDIO shift close</title><style>body{margin:0;padding:28px;color:#10251e;font-family:Arial,sans-serif}.brand{font-size:11px;font-weight:700;letter-spacing:2px;color:#008060}.title{margin:5px 0 0;font-size:24px}.muted{margin:5px 0 20px;color:#52645d;font-size:12px}.details{border-top:1px solid #d1d5db;margin:0;padding:12px 0;list-style:none}.details li{display:flex;justify-content:space-between;gap:16px;padding:5px 0;font-size:13px}.details span:first-child{color:#52645d}.summary{margin-top:14px;border:1px solid #d1d5db;border-radius:10px;padding:14px}.summary p{display:flex;justify-content:space-between;margin:0;padding:6px 0;font-size:14px}.summary p:last-child{border-top:1px solid #d1d5db;margin-top:6px;padding-top:12px;font-weight:700}.foot{margin-top:20px;color:#52645d;font-size:11px;line-height:1.5}</style></head><body><p class="brand">TINDIO POS</p><h1 class="title">Shift close printout</h1><p class="muted">Immutable close snapshot</p><ul class="details">${details.map(([label, value]) => `<li><span>${escapePrintHtml(label)}</span><strong>${escapePrintHtml(value)}</strong></li>`).join("")}</ul><section class="summary">${rows.map(([label, value]) => `<p><span>${escapePrintHtml(label)}</span><strong>${escapePrintHtml(value)}</strong></p>`).join("")}</section><p class="foot">This printout reflects the server-recorded shift-close values. Cash movements and transaction records remain available in TINDIO&apos;s audit trail.</p><script>window.onload=()=>window.print()</script></body></html>`);
    printWindow.document.close();
  };

  if (renderAsMenuItem) return (
    <Menu.Item className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-highlighted:bg-muted" onClick={print}>
      <Printer aria-hidden="true" className="size-4" />
      Print shift report
    </Menu.Item>
  );

  return (
    <Button aria-label={`Print shift close for ${registerName}`} onClick={print} size={showLabel ? "default" : "sm"} title="Print shift close" type="button" variant={showLabel ? "outline" : "ghost"}>
      <Printer aria-hidden="true" />
      <span className={showLabel ? undefined : "sr-only"}>{showLabel ? "Print shift report" : "Print shift close"}</span>
    </Button>
  );
}
