import "server-only";

import type { BusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export type ShiftAuditReport = {
  shift: {
    id: string;
    number: string;
    store: string;
    register: string;
    openedBy: string;
    closedBy: string;
    openedAt: string;
    closedAt: string;
    openingCashMinor: number;
    expectedCashMinor: number;
    countedCashMinor: number;
    differenceMinor: number;
    openingNote: string | null;
    closingNote: string | null;
  };
  cash: {
    cashPaymentsMinor: number;
    cashRefundsMinor: number;
    paidInMinor: number;
    paidOutMinor: number;
    calculatedExpectedCashMinor: number;
  };
  sales: {
    saleCount: number;
    grossSalesMinor: number;
    discountsMinor: number;
    taxMinor: number;
    salesTotalMinor: number;
    refundCount: number;
    refundsMinor: number;
    netSalesMinor: number;
  };
  paymentBreakdown: Array<{
    name: string;
    type: string;
    salesMinor: number;
    refundsMinor: number;
    netMinor: number;
    salePaymentCount: number;
    refundPaymentCount: number;
  }>;
  cashMovements: Array<{
    id: string;
    type: "PAY_IN" | "PAY_OUT";
    amountMinor: number;
    reason: string;
    createdAt: string;
    employee: string;
  }>;
  audit: {
    available: boolean;
    events: Array<{
      id: string;
      eventType: string;
      operationCode: string | null;
      amountMinor: number | null;
      reason: string | null;
      createdAt: string;
      actor: string;
      metadata: Record<string, unknown>;
    }>;
    lifecycle: Array<{
      eventType: "SHIFT_OPENED" | "SHIFT_CLOSED";
      createdAt: string;
      actor: string;
      reason: string | null;
    }>;
  };
};

type ShiftAuditRpc = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

export async function loadShiftAuditReport(
  context: BusinessContext,
  shiftId: string,
): Promise<ShiftAuditReport> {
  const supabase = await createClient();
  const database = supabase as unknown as ShiftAuditRpc;
  const { data, error } = await database.rpc("get_shift_audit_report", {
    target_organization_id: context.organization.id,
    target_shift_id: shiftId,
  });

  if (error) throw new Error(`Unable to load the shift audit report: ${error.message}`);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("The shift audit report was unavailable.");
  }

  return data as ShiftAuditReport;
}
