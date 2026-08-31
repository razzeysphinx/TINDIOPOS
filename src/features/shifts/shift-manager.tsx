"use client";

import {
  ArrowDownToLine,
  ArrowUpRight,
  ArrowUpFromLine,
  Calculator,
  CheckCircle2,
  CircleDollarSign,
  Eye,
  EyeOff,
  LoaderCircle,
  LogIn,
  LockKeyhole,
  Printer,
  ReceiptText,
} from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  canClose,
  canManageSettings,
  canOpen,
  canPayIn,
  canPayOut,
  canViewClosedShiftAudit,
  cashMovements,
  currencyCode,
  openShifts,
  recentClosedShifts,
  registers,
  stores,
  summaries,
  operationalSummaries,
  showExpectedCashBeforeClose,
  timezone,
}: {
  canClose: boolean;
  canManageSettings: boolean;
  canOpen: boolean;
  canPayIn: boolean;
  canPayOut: boolean;
  canViewClosedShiftAudit: boolean;
  cashMovements: CashMovement[];
  currencyCode: string;
  openShifts: ShiftRecord[];
  recentClosedShifts: ShiftRecord[];
  registers: RegisterOption[];
  stores: StoreOption[];
  summaries: CashSummary[];
  operationalSummaries: ShiftOperationalSummary[];
  showExpectedCashBeforeClose: boolean;
  timezone: string;
}) {
  const [lastCloseSummary, setLastCloseSummary] = useState<{
    expectedCashMinor: number;
    countedCashMinor: number;
    differenceMinor: number;
  } | null>(null);
  const summaryByShiftId = new Map(summaries.map((summary) => [summary.shiftId, summary]));
  const operationalSummaryByShiftId = new Map(operationalSummaries.map((summary) => [summary.shift.id, summary]));
  const movementsByShiftId = new Map<string, CashMovement[]>();
  for (const movement of cashMovements) {
    movementsByShiftId.set(movement.shiftId, [
      ...(movementsByShiftId.get(movement.shiftId) ?? []),
      movement,
    ]);
  }

  return (
    <div className="space-y-5">
      {canManageSettings ? (
        <CashCloseVisibilitySetting initialValue={showExpectedCashBeforeClose} />
      ) : null}
      {lastCloseSummary ? (
        <CashCloseRecordedNotice currencyCode={currencyCode} summary={lastCloseSummary} />
      ) : null}
      {canOpen ? <OpenShiftForm registers={registers} stores={stores} /> : null}

      {openShifts.length > 0 ? (
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
              operationalSummary={operationalSummaryByShiftId.get(shift.id)}
              timezone={timezone}
            />
          ))}
        </section>
      ) : (
        <Card>
          <CardHeader className="items-center py-10 text-center">
            <CircleDollarSign className="size-9 text-muted-foreground" aria-hidden="true" />
            <CardTitle>No register shift is open</CardTitle>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              Open a drawer before processing sales or cash movements. TINDIO will then calculate the expected cash from its recorded transactions.
            </p>
          </CardHeader>
        </Card>
      )}

      <ClosedShiftHistory
        canViewClosedShiftAudit={canViewClosedShiftAudit}
        currencyCode={currencyCode}
        registers={registers}
        operationalSummaryByShiftId={operationalSummaryByShiftId}
        shifts={recentClosedShifts}
        stores={stores}
        timezone={timezone}
      />
    </div>
  );
}

function OpenShiftForm({
  registers,
  stores,
}: {
  registers: RegisterOption[];
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
          <label className="grid gap-1.5 text-sm font-medium">
            Store
            <select className={selectClassName} disabled={isPending || stores.length === 0} onChange={(event) => changeStore(event.target.value)} value={storeId}>
              {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Register
            <select className={selectClassName} disabled={isPending || availableRegisters.length === 0} onChange={(event) => setRegisterId(event.target.value)} value={registerId}>
              {availableRegisters.map((register) => <option key={register.id} value={register.id}>{register.name} ({register.code})</option>)}
            </select>
          </label>
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
  timezone: string;
}) {
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

        {canPayIn || canPayOut ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {canPayIn ? <CashMovementForm currencyCode={currencyCode} movementType="PAY_IN" shiftId={shift.id} /> : null}
            {canPayOut ? <CashMovementForm currencyCode={currencyCode} movementType="PAY_OUT" shiftId={shift.id} /> : null}
          </div>
        ) : null}

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

        {canClose ? (
          <CloseShiftForm
            currencyCode={currencyCode}
            expectedCashMinor={summary?.expectedCashMinor ?? null}
            onClosed={onClosed}
            shiftId={shift.id}
          />
        ) : null}
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
  shiftId,
}: {
  currencyCode: string;
  expectedCashMinor: number | null;
  onClosed: (summary: { expectedCashMinor: number; countedCashMinor: number; differenceMinor: number }) => void;
  shiftId: string;
}) {
  const router = useRouter();
  const [countedCash, setCountedCash] = useState("");
  const [closingNote, setClosingNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    if (!window.confirm("Close this shift? The expected cash and any drawer difference will be permanently recorded.")) return;
    startTransition(async () => {
      const result = await closeShiftAction({ shiftId, countedCash, closingNote });
      setMessage(result.message);
      if (result.ok) {
        if (result.closeSummary) onClosed(result.closeSummary);
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
      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto]">
        <Input aria-label="Counted cash" disabled={isPending} inputMode="decimal" min="0" onChange={(event) => setCountedCash(event.target.value)} placeholder="Counted cash" step="0.01" type="number" value={countedCash} />
        <Input disabled={isPending} maxLength={500} onChange={(event) => setClosingNote(event.target.value)} placeholder="Closing note (optional)" value={closingNote} />
        <Button disabled={isPending || !countedCash} onClick={submit} type="button">
          {isPending ? <LoaderCircle className="animate-spin" /> : <LockKeyhole />}
          Close shift
        </Button>
      </div>
      {message ? <p aria-live="polite" className="mt-2 text-xs text-muted-foreground">{message}</p> : null}
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
  canViewClosedShiftAudit,
  currencyCode,
  operationalSummaryByShiftId,
  registers,
  shifts,
  stores,
  timezone,
}: {
  canViewClosedShiftAudit: boolean;
  currencyCode: string;
  operationalSummaryByShiftId: Map<string, ShiftOperationalSummary>;
  registers: RegisterOption[];
  shifts: ShiftRecord[];
  stores: StoreOption[];
  timezone: string;
}) {
  const router = useRouter();

  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><ReceiptText className="size-5" /></span>
        <div>
          <CardTitle>Shift-close audit trail</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">Stored expected cash, drawer count, and difference for the latest 25 closed shifts.{canViewClosedShiftAudit ? " Select a row to inspect its full reconciliation report." : ""}</p>
        </div>
      </CardHeader>
      <CardContent>
        {shifts.length > 0 ? (
          <div className="overflow-x-auto overscroll-x-contain rounded-lg border">
            <table className="w-full min-w-220 text-left text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Store</th><th className="px-3 py-2 font-medium">Register</th><th className="px-3 py-2 font-medium">Employee</th><th className="px-3 py-2 font-medium">Closed</th><th className="px-3 py-2 text-right font-medium">Expected</th><th className="px-3 py-2 text-right font-medium">Counted</th><th className="px-3 py-2 text-right font-medium">Difference</th><th className="px-3 py-2 text-right font-medium">Print</th></tr></thead>
              <tbody className="divide-y">
                {shifts.map((shift) => {
                  const difference = shift.differenceMinor ?? 0;
                  const registerName = registers.find((item) => item.id === shift.registerId)?.name ?? "Register";
                  const storeName = stores.find((item) => item.id === shift.storeId)?.name ?? "Store";
                  const reportHref = `/back-office/shifts/${shift.id}`;
                  const navigateToReport = () => {
                    if (canViewClosedShiftAudit) router.push(reportHref);
                  };
                  return <tr
                    aria-label={canViewClosedShiftAudit ? `View audit report for ${registerName}` : undefined}
                    className={canViewClosedShiftAudit ? "group cursor-pointer transition-colors hover:bg-muted/50 focus-visible:bg-muted/50" : undefined}
                    key={shift.id}
                    onClick={navigateToReport}
                    onKeyDown={(event) => {
                      if (!canViewClosedShiftAudit || event.currentTarget !== event.target || (event.key !== "Enter" && event.key !== " ")) return;
                      event.preventDefault();
                      navigateToReport();
                    }}
                    role={canViewClosedShiftAudit ? "link" : undefined}
                    tabIndex={canViewClosedShiftAudit ? 0 : undefined}
                  >
                    <td className="px-3 py-3 font-medium">{storeName}</td>
                    <td className="px-3 py-3"><p className="flex items-center gap-1.5 font-medium">{registerName}{canViewClosedShiftAudit ? <ArrowUpRight aria-hidden="true" className="size-3.5 text-muted-foreground transition-colors group-hover:text-primary" /> : null}</p></td>
                    <td className="px-3 py-3 text-muted-foreground">{shift.openedByName}</td>
                    <td className="px-3 py-3 text-muted-foreground">{shift.closedAt ? formatShiftTime(shift.closedAt, timezone) : "—"}</td>
                    <td className="px-3 py-3 text-right">{formatMinorMoney(shift.expectedCashMinor ?? 0, currencyCode)}</td>
                    <td className="px-3 py-3 text-right">{formatMinorMoney(shift.countedCashMinor ?? 0, currencyCode)}</td>
                    <td className={difference === 0 ? "px-3 py-3 text-right font-medium" : difference > 0 ? "px-3 py-3 text-right font-medium text-emerald-700 dark:text-emerald-400" : "px-3 py-3 text-right font-medium text-destructive"}>{difference > 0 ? "+" : ""}{formatMinorMoney(difference, currencyCode)}</td>
                    <td className="px-3 py-3 text-right">
                      <span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                        <ShiftClosePrintButton
                        closedAt={shift.closedAt}
                        countedCashMinor={shift.countedCashMinor ?? 0}
                        currencyCode={currencyCode}
                        expectedCashMinor={shift.expectedCashMinor ?? 0}
                        differenceMinor={difference}
                        openedAt={shift.openedAt}
                        registerName={registerName}
                        shiftId={shift.id}
                        storeName={storeName}
                        operationalSummary={operationalSummaryByShiftId.get(shift.id)}
                        timezone={timezone}
                        />
                      </span>
                    </td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No shifts have been closed yet.</p>}
      </CardContent>
    </Card>
  );
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
  shiftId,
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
  shiftId: string;
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

  return (
    <Button aria-label={`Print shift close for ${registerName}`} onClick={print} size="sm" title="Print shift close" type="button" variant="ghost">
      <Printer aria-hidden="true" />
      <span className="sr-only">Print shift close</span>
    </Button>
  );
}
