import { notFound, redirect } from "next/navigation";

import { ShiftAuditReportView } from "@/features/shifts/shift-audit-report";
import { loadShiftAuditReport } from "@/features/shifts/data";
import { requireBackOfficePermission } from "@/lib/auth/dal";

export const metadata = { title: "Shift audit report" };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function ShiftAuditReportPage({
  params,
}: {
  params: Promise<{ shiftId: string }>;
}) {
  const { shiftId } = await params;
  if (!UUID_PATTERN.test(shiftId)) notFound();

  const context = await requireBackOfficePermission(["shifts.view_history", "settings.manage"]);

  let report;
  try {
    report = await loadShiftAuditReport(context, shiftId);
  } catch {
    redirect("/back-office/shifts");
  }

  return <ShiftAuditReportView currencyCode={context.organization.currency_code} report={report} timezone={context.organization.timezone} />;
}
