import { CircleDollarSign } from "lucide-react";

import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShiftManager, type ShiftOperationalSummary } from "@/features/shifts/shift-manager";
import { hasPermission, requireBackOfficePermission, requireBusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Shift reports" };

const SHIFT_PERMISSIONS = ["shifts.open", "shifts.close", "cash.pay_in", "cash.pay_out"] as const;

export async function ShiftWorkspacePage({
  mode,
}: {
  mode: "operations" | "reports";
}) {
  const context = await requireBusinessContext();
  const isOperationsMode = mode === "operations";
  const canManageSettings = isOperationsMode && hasPermission(context, "settings.manage");
  const canOpen = isOperationsMode && hasPermission(context, "shifts.open");
  const canClose = isOperationsMode && hasPermission(context, "shifts.close");
  const canPayIn = isOperationsMode && hasPermission(context, "cash.pay_in");
  const canPayOut = isOperationsMode && hasPermission(context, "cash.pay_out");
  const canAccessShifts = canManageSettings || SHIFT_PERMISSIONS.some((permission) => hasPermission(context, permission));

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
  const [storesResult, registersResult, shiftsResult, cashCloseSettingResult] = await Promise.all([
    supabase
      .from("stores")
      .select("id, name")
      .eq("organization_id", context.organization.id)
      .eq("is_active", true)
      .in("id", context.storeIds)
      .order("name", { ascending: true }),
    supabase
      .from("registers")
      .select("id, store_id, name, code")
      .eq("organization_id", context.organization.id)
      .eq("is_active", true)
      .in("store_id", context.storeIds)
      .order("name", { ascending: true }),
    supabase
      .from("shifts")
      .select(
        "id, store_id, register_id, opened_by_employee_id, status, opening_cash_minor, expected_cash_minor, counted_cash_minor, difference_minor, opening_note, closing_note, opened_at, closed_at",
      )
      .eq("organization_id", context.organization.id)
      .order("opened_at", { ascending: false })
      .limit(40),
    supabase
      .from("organizations")
      .select("show_expected_cash_before_close")
      .eq("id", context.organization.id)
      .single(),
  ]);

  const baseError = [storesResult, registersResult, shiftsResult, cashCloseSettingResult].find((result) => result.error)?.error;
  if (baseError) throw new Error(`Unable to load register shifts: ${baseError.message}`);

  const shifts = (shiftsResult.data ?? []).map((shift) => ({
    id: shift.id,
    storeId: shift.store_id,
    registerId: shift.register_id,
    openedByEmployeeId: shift.opened_by_employee_id,
    status: shift.status as "open" | "closed",
    openingCashMinor: shift.opening_cash_minor,
    expectedCashMinor: shift.expected_cash_minor,
    countedCashMinor: shift.counted_cash_minor,
    differenceMinor: shift.difference_minor,
    openingNote: shift.opening_note,
    closingNote: shift.closing_note,
    openedAt: shift.opened_at,
    closedAt: shift.closed_at,
  }));
  const accessibleOpenShifts = shifts.filter(
    (shift) => shift.status === "open" && context.storeIds.includes(shift.storeId),
  );
  // A shift closer must be able to recover a register when the original
  // cashier is unavailable. Report viewers see the same context but receive
  // no operational controls through the false permission props below.
  const openShifts =
    !isOperationsMode || canClose
      ? accessibleOpenShifts
      : accessibleOpenShifts.filter((shift) => shift.openedByEmployeeId === context.employee.id);
  const recentClosedShifts = shifts.filter((shift) => shift.status === "closed").slice(0, 25);
  const openShiftIds = openShifts.map((shift) => shift.id);
  const visibleShiftIds = [...new Set([...openShiftIds, ...recentClosedShifts.map((shift) => shift.id)])];
  const database = supabase as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{
      data: unknown;
      error: { message: string } | null;
    }>;
  };
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
    Promise.all(
      visibleShiftIds.map((shiftId) =>
        database.rpc("get_pos_shift_operational_summary", {
          target_organization_id: context.organization.id,
          target_shift_id: shiftId,
        }),
      ),
    ),
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
            : "Review recent drawer closures and cash accountability without changing a register shift."
        }
        action={<Badge variant="secondary"><CircleDollarSign aria-hidden="true" />{openShifts.length} open</Badge>}
      />
      <ShiftManager
        canClose={canClose}
        canManageSettings={canManageSettings}
        canOpen={canOpen}
        canPayIn={canPayIn}
        canPayOut={canPayOut}
        cashMovements={cashMovements}
        currencyCode={context.organization.currency_code}
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
        showExpectedCashBeforeClose={cashCloseSettingResult.data?.show_expected_cash_before_close ?? true}
        timezone={context.organization.timezone}
      />
    </div>
  );
}

export default async function ShiftsPage() {
  await requireBackOfficePermission(["dashboard.view", "reports.view"]);
  return <ShiftWorkspacePage mode="reports" />;
}
