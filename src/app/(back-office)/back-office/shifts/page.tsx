import { CircleDollarSign } from "lucide-react";
import { notFound } from "next/navigation";

import { GlobalFilterBar } from "@/components/back-office/global-filter-bar";
import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShiftManager, type ShiftOperationalSummary } from "@/features/shifts/shift-manager";
import {
  loadAuthorizedBackOfficeStores,
  resolveBackOfficeStoreScope,
} from "@/lib/server/back-office-store-scope";
import { hasPermission, requireBackOfficePermission, requireBusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Shift reports" };

const SHIFT_PERMISSIONS = ["shifts.open", "shifts.close", "cash.pay_in", "cash.pay_out"] as const;

export async function ShiftWorkspacePage({
  mode,
  operationalWorkspace = "back-office",
  searchParams = {},
}: {
  mode: "operations" | "reports";
  operationalWorkspace?: "back-office" | "pos";
  searchParams?: { employee?: string; end?: string; register?: string; start?: string; store?: string };
}) {
  const context = await requireBusinessContext();
  const isOperationsMode = mode === "operations";
  const canManageOrganizationSettings = hasPermission(context, "settings.manage");
  const canManageSettings = isOperationsMode && canManageOrganizationSettings;
  const canOpen = isOperationsMode && hasPermission(context, "shifts.open");
  const canClose = isOperationsMode && hasPermission(context, "shifts.close");
  const canPayIn = isOperationsMode && hasPermission(context, "cash.pay_in");
  const canPayOut = isOperationsMode && hasPermission(context, "cash.pay_out");
  const canViewClosedShiftAudit = canManageOrganizationSettings || hasPermission(context, "shifts.view_history");
  const canAccessShifts = canManageSettings || SHIFT_PERMISSIONS.some((permission) => hasPermission(context, permission));
  const storeScope = resolveBackOfficeStoreScope(context, searchParams);
  if (!isOperationsMode && storeScope.invalidSelection) notFound();

  if (isOperationsMode && !canAccessShifts) {
    return (
      <div className="space-y-8">
        <PageHeader
          eyebrow="Cash control"
          title="Register shifts"
          description="Open drawers, record cash movements, and close against a counted amount."
          action={<Badge variant="outline">No shift access</Badge>}
        />
        <Card>
          <CardHeader>
            <CardTitle>Shift access is required</CardTitle>
            <CardDescription>
              Ask an owner to assign an appropriate shift or cash-movement permission to your role.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const supabase = await createClient();
  const database = supabase as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{
      data: unknown;
      error: { message: string } | null;
    }>;
  };
  const storesQuery = supabase
    .from("stores")
    .select("id, name")
    .eq("organization_id", context.organization.id)
    .eq("is_active", true)
    .order("name", { ascending: true });
  const registersQuery = supabase
    .from("registers")
    .select("id, store_id, name, code")
    .eq("organization_id", context.organization.id)
    .eq("is_active", true)
    .order("name", { ascending: true });

  // Settings managers can audit every store in the organization. Other
  // viewers stay limited to their assigned stores, which matches the RPC.
  if (isOperationsMode && !canManageOrganizationSettings) {
    storesQuery.in("id", context.storeIds);
    registersQuery.in("store_id", context.storeIds);
  } else if (!isOperationsMode && storeScope.storeIds) {
    storesQuery.in("id", storeScope.storeIds);
    registersQuery.in("store_id", storeScope.storeIds);
  }

  const [storesResult, registersResult, shiftsResult, cashCloseSettingResult, auditHistoryResult] = await Promise.all([
    storesQuery,
    registersQuery,
    isOperationsMode
      ? supabase
          .from("shifts")
          .select(
            "id, store_id, register_id, opened_by_employee_id, status, opening_cash_minor, expected_cash_minor, counted_cash_minor, difference_minor, opening_note, closing_note, opened_at, closed_at",
          )
          .eq("organization_id", context.organization.id)
          .order("opened_at", { ascending: false })
          .limit(40)
      : Promise.resolve({ data: [], error: null }),
    isOperationsMode
      ? supabase
          .from("organizations")
          .select("show_expected_cash_before_close")
          .eq("id", context.organization.id)
          .single()
      : Promise.resolve({ data: null, error: null }),
    !isOperationsMode && canViewClosedShiftAudit
      ? database.rpc("get_shift_audit_history", {
          target_organization_id: context.organization.id,
          target_limit: 100,
        })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const baseError = [storesResult, registersResult, shiftsResult, cashCloseSettingResult, auditHistoryResult].find((result) => result.error)?.error;
  if (baseError) throw new Error(`Unable to load register shifts: ${baseError.message}`);

  const allShifts = (!isOperationsMode && canViewClosedShiftAudit && Array.isArray(auditHistoryResult.data)
    ? auditHistoryResult.data.map((shift) => ({
      id: (shift as { shift_id: string }).shift_id,
      storeId: (shift as { store_id: string }).store_id,
      registerId: (shift as { register_id: string }).register_id,
      openedByEmployeeId: (shift as { opened_by_employee_id: string }).opened_by_employee_id,
      openedByName: (shift as { opened_by_name?: string }).opened_by_name ?? "Employee",
      status: "closed" as const,
      openingCashMinor: (shift as { opening_cash_minor: number }).opening_cash_minor,
      expectedCashMinor: (shift as { expected_cash_minor: number | null }).expected_cash_minor,
      countedCashMinor: (shift as { counted_cash_minor: number | null }).counted_cash_minor,
      differenceMinor: (shift as { difference_minor: number | null }).difference_minor,
      openingNote: (shift as { opening_note: string | null }).opening_note,
      closingNote: (shift as { closing_note: string | null }).closing_note,
      openedAt: (shift as { opened_at: string }).opened_at,
      closedAt: (shift as { closed_at: string }).closed_at,
    }))
    : (shiftsResult.data ?? []).map((shift) => ({
    id: shift.id,
    storeId: shift.store_id,
    registerId: shift.register_id,
    openedByEmployeeId: shift.opened_by_employee_id,
    openedByName: "Employee",
    status: shift.status as "open" | "closed",
    openingCashMinor: shift.opening_cash_minor,
    expectedCashMinor: shift.expected_cash_minor,
    countedCashMinor: shift.counted_cash_minor,
    differenceMinor: shift.difference_minor,
    openingNote: shift.opening_note,
    closingNote: shift.closing_note,
    openedAt: shift.opened_at,
    closedAt: shift.closed_at,
  }))) as Array<{
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
  }>;
  const registerFilter = searchParams.register;
  const employeeFilter = searchParams.employee;
  const shifts = !isOperationsMode
    ? allShifts.filter((shift) =>
      (!storeScope.selectedStoreId || shift.storeId === storeScope.selectedStoreId)
      && (!registerFilter || shift.registerId === registerFilter)
      && (!employeeFilter || shift.openedByEmployeeId === employeeFilter)
      && (!searchParams.start || (shift.closedAt ?? shift.openedAt) >= `${searchParams.start}T00:00:00.000Z`)
      && (!searchParams.end || (shift.closedAt ?? shift.openedAt) <= `${searchParams.end}T23:59:59.999Z`),
    )
    : allShifts;
  const accessibleOpenShifts = shifts.filter(
    (shift) => shift.status === "open" && context.storeIds.includes(shift.storeId),
  );
  // A shift closer must be able to recover a register when the original
  // cashier is unavailable. Report viewers see the same context but receive
  // no operational controls through the false permission props below.
  const shiftsForOperationalWorkspace = operationalWorkspace === "pos"
    ? accessibleOpenShifts.filter((shift) => shift.openedByEmployeeId === context.employee.id)
    : accessibleOpenShifts;
  const openShifts =
    !isOperationsMode || canClose
      ? shiftsForOperationalWorkspace
      : shiftsForOperationalWorkspace.filter((shift) => shift.openedByEmployeeId === context.employee.id);
  const recentClosedShifts = shifts
    .filter((shift) => shift.status === "closed")
    .slice(0, isOperationsMode ? 25 : 100);
  const openShiftIds = openShifts.map((shift) => shift.id);
  const visibleShiftIds = [...new Set([...openShiftIds, ...recentClosedShifts.map((shift) => shift.id)])];
  const canReadOperationalSummaries = isOperationsMode
    && (hasPermission(context, "settings.manage")
      || SHIFT_PERMISSIONS.some((permission) => hasPermission(context, permission)));
  const [summariesResult, movementsResult, operationalSummaryResults] = await Promise.all([
    Promise.all(
      openShiftIds.map((shiftId) =>
        supabase.rpc("get_shift_cash_summary", {
          target_organization_id: context.organization.id,
          target_shift_id: shiftId,
        }),
      ),
    ),
    openShiftIds.length > 0
      ? supabase
          .from("cash_movements")
          .select("id, shift_id, movement_type, amount_minor, reason, created_at")
          .eq("organization_id", context.organization.id)
          .in("shift_id", openShiftIds)
          .order("created_at", { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [], error: null }),
    canReadOperationalSummaries ? Promise.all(
      visibleShiftIds.map((shiftId) =>
        database.rpc("get_pos_shift_operational_summary", {
          target_organization_id: context.organization.id,
          target_shift_id: shiftId,
        }),
      ),
    ) : Promise.resolve([]),
  ]);

  const summaryError = summariesResult.find((result) => result.error)?.error;
  const operationalSummaryError = operationalSummaryResults.find((result) => result.error)?.error;
  if (summaryError || movementsResult.error || operationalSummaryError) {
    throw new Error(`Unable to calculate register cash: ${summaryError?.message ?? movementsResult.error?.message ?? operationalSummaryError?.message}`);
  }

  const summaries = summariesResult.flatMap((result) =>
    (result.data ?? []).map((summary) => ({
      shiftId: summary.shift_id,
      openingCashMinor: summary.opening_cash_minor,
      cashSalesMinor: summary.cash_sales_minor,
      cashRefundsMinor: summary.cash_refunds_minor,
      payInsMinor: summary.pay_ins_minor,
      payOutsMinor: summary.pay_outs_minor,
      expectedCashMinor: summary.expected_cash_minor,
    })),
  );
  const cashMovements = (movementsResult.data ?? []).map((movement) => ({
    id: movement.id,
    shiftId: movement.shift_id,
    movementType: movement.movement_type as "PAY_IN" | "PAY_OUT",
    amountMinor: movement.amount_minor,
    reason: movement.reason,
    createdAt: movement.created_at,
  }));
  const operationalSummaries = operationalSummaryResults.flatMap((result) =>
    result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? [result.data as ShiftOperationalSummary]
      : [],
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Cash control"
        title={isOperationsMode ? "Shift controls" : "Shift reports"}
        description={
          isOperationsMode
            ? "Open drawers, record cash movements, and close against a counted amount."
            : "Review closed shifts, cash reconciliation, and drawer differences across your authorized stores and registers."
        }
        action={isOperationsMode ? <Badge variant="secondary"><CircleDollarSign aria-hidden="true" />{openShifts.length} open</Badge> : undefined}
      />
      <ShiftManager
        auditFilters={!isOperationsMode ? (
          <GlobalFilterBar
            action="/back-office/shifts"
            additionalFields={<><label className="grid min-w-36 gap-1.5 text-sm font-medium">Register<select className="h-8 min-w-36 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" defaultValue={registerFilter ?? ""} name="register"><option value="">All registers</option>{(registersResult.data ?? []).map((register) => <option key={register.id} value={register.id}>{register.name} ({register.code})</option>)}</select></label><label className="grid min-w-36 gap-1.5 text-sm font-medium">Employee<select className="h-8 min-w-36 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" defaultValue={employeeFilter ?? ""} name="employee"><option value="">All employees</option>{Array.from(new Map(allShifts.map((shift) => [shift.openedByEmployeeId, shift.openedByName])).entries()).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></>}
            embedded
            fromDate={searchParams.start}
            namePrefix="shift-report-filter"
            storeId={storeScope.selectedStoreId}
            stores={await loadAuthorizedBackOfficeStores(context)}
            toDate={searchParams.end}
          />
        ) : null}
        canClose={canClose}
        canManageSettings={canManageSettings}
        canOpen={canOpen}
        canPayIn={canPayIn}
        canPayOut={canPayOut}
        cashMovements={cashMovements}
        canViewClosedShiftAudit={canViewClosedShiftAudit}
        currencyCode={context.organization.currency_code}
        hasAccessibleOpenShift={accessibleOpenShifts.length > 0}
        openShifts={openShifts}
        recentClosedShifts={recentClosedShifts}
        registers={(registersResult.data ?? []).map((register) => ({
          id: register.id,
          storeId: register.store_id,
          name: register.name,
          code: register.code,
        }))}
        stores={storesResult.data ?? []}
        summaries={summaries}
        operationalSummaries={operationalSummaries}
        historyPresentation={isOperationsMode ? "drawer-action" : "audit-card"}
        showExpectedCashBeforeClose={cashCloseSettingResult.data?.show_expected_cash_before_close ?? true}
        simplifyOpenShiftContext={operationalWorkspace === "pos"}
        timezone={context.organization.timezone}
      />
    </div>
  );
}

export default async function ShiftsPage({
  searchParams,
}: {
  searchParams: Promise<{ employee?: string; end?: string; register?: string; start?: string; store?: string }>;
}) {
  await requireBackOfficePermission(["shifts.view_history", "settings.manage"]);
  return <ShiftWorkspacePage mode="reports" searchParams={await searchParams} />;
}
