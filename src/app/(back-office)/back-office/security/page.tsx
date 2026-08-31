import { ClipboardList, ShieldCheck } from "lucide-react";
import { notFound } from "next/navigation";

import { BackOfficeStateCard } from "@/components/back-office/back-office-state-card";
import { GlobalFilterBar } from "@/components/back-office/global-filter-bar";
import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SecurityApprovalManager } from "@/features/approvals/security-approval-manager";
import { loadSecurityOverview } from "@/features/approvals/data";
import {
  loadAuthorizedBackOfficeStores,
  resolveBackOfficeStoreScope,
} from "@/lib/server/back-office-store-scope";
import { hasPermission, requireBackOfficePermission } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

const supportedOperations = ["sales.refund", "cash.pay_out", "inventory.adjust"] as const;

const operationLabels: Record<(typeof supportedOperations)[number], string> = {
  "sales.refund": "Refund",
  "cash.pay_out": "Cash pay-out",
  "inventory.adjust": "Inventory adjustment",
};

export const metadata = { title: "Security & approvals" };

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>;
}) {
  const context = await requireBackOfficePermission(["approvals.manage", "audit.view"]);
  const parameters = await searchParams;
  const storeScope = resolveBackOfficeStoreScope(context, parameters);
  if (storeScope.invalidSelection) notFound();

  const canManageRules = hasPermission(context, "approvals.manage");
  const canViewAudit = hasPermission(context, "audit.view");
  const [{ rules: rulesData, requests, auditEntries, employees }, stores, registersResult] = await Promise.all([
    loadSecurityOverview(context, { includeAudit: canViewAudit, storeId: storeScope.selectedStoreId }),
    loadAuthorizedBackOfficeStores(context),
    (async () => {
      const supabase = await createClient();
      return supabase.from("registers").select("id, name").eq("organization_id", context.organization.id);
    })(),
  ]);
  if (registersResult.error) throw new Error(`Unable to load audit register names: ${registersResult.error.message}`);

  const existingRules = new Map(rulesData.map((rule) => [rule.operation_code, rule]));
  const rules = supportedOperations.map((operationCode) => {
    const rule = existingRules.get(operationCode);
    return {
      operationCode,
      decision: (rule?.decision ?? "ALLOWED") as "ALLOWED" | "DENIED" | "APPROVAL_REQUIRED",
      amountThresholdMinor: rule?.amount_threshold_minor ?? null,
      isEnabled: rule?.is_enabled ?? true,
    };
  });
  const employeeNumbers = new Map(employees.map((employee) => [employee.id, employee.employee_number]));
  const storeNames = new Map(stores.map((store) => [store.id, store.name]));
  const registerNames = new Map((registersResult.data ?? []).map((register) => [register.id, register.name]));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Security"
        title="Approvals & audit"
        description="High-risk operations can be authorized once by a qualified manager and remain traceable after completion."
        action={<Badge variant={canManageRules ? "secondary" : "outline"}>{canManageRules ? "Rule management" : "Approval history"}</Badge>}
      />
      <GlobalFilterBar action="/back-office/security" namePrefix="security-filter" showDateRange={false} storeId={storeScope.selectedStoreId} stores={stores} />

      {canManageRules ? (
        <Card>
          <CardHeader className="flex-row items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 text-primary" aria-hidden="true" />
            <div>
              <CardTitle>Approval rules</CardTitle>
              <CardDescription className="mt-1">Decide when permitted staff can proceed, must request a manager, or are blocked.</CardDescription>
            </div>
          </CardHeader>
          <CardContent><SecurityApprovalManager rules={rules} /></CardContent>
        </Card>
      ) : null}

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Recent approval requests</h2>
          <p className="mt-1 text-sm text-muted-foreground">Only the requester and authorized managers can view a request.</p>
        </div>
        {requests.length > 0 ? (
          <div className="overflow-x-auto overscroll-x-contain rounded-lg border bg-card">
            <table className="w-full min-w-180 text-left text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Operation</th><th className="px-3 py-2 font-medium">Requester</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Reason</th><th className="px-3 py-2 font-medium">Requested</th></tr></thead>
              <tbody className="divide-y">
                {requests.map((request) => <tr key={request.id}><td className="px-3 py-3 font-medium">{operationLabels[request.operation_code as keyof typeof operationLabels] ?? request.operation_code}</td><td className="px-3 py-3">{employeeNumbers.get(request.requested_by_employee_id) ?? "Employee"}</td><td className="px-3 py-3"><Badge variant={request.status === "APPROVED" || request.status === "CONSUMED" ? "secondary" : "outline"}>{request.status}</Badge></td><td className="max-w-xs truncate px-3 py-3 text-muted-foreground" title={request.reason}>{request.reason}</td><td className="px-3 py-3 text-muted-foreground">{formatDate(request.requested_at)}</td></tr>)}
              </tbody>
            </table>
          </div>
        ) : <EmptyState text="No approval requests are visible yet." />}
      </section>

      {canViewAudit ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Security audit</h2>
            <p className="mt-1 text-sm text-muted-foreground">Append-only records identify the organization, store, register, employee, action, and timestamp.</p>
          </div>
          {auditEntries.length > 0 ? (
            <div className="divide-y overflow-hidden rounded-lg border bg-card">
              {auditEntries.map((entry) => <article className="grid gap-1 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center" key={entry.id}><div><p className="font-medium">{entry.event_type.replaceAll("_", " ")}</p><p className="mt-1 text-xs text-muted-foreground">{entry.operation_code ?? "Security"}{entry.reason ? ` · ${entry.reason}` : ""}{entry.actor_employee_id ? ` · ${employeeNumbers.get(entry.actor_employee_id) ?? "Employee"}` : ""}{entry.store_id ? ` · ${storeNames.get(entry.store_id) ?? "Store"}` : " · Organization"}{entry.register_id ? ` · ${registerNames.get(entry.register_id) ?? "Register"}` : ""}</p></div><p className="text-xs text-muted-foreground">{formatDate(entry.created_at)}</p></article>)}
            </div>
          ) : <EmptyState text="No audit records are available yet." />}
        </section>
      ) : null}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <BackOfficeStateCard description="Records appear here when an approval or security event is created." icon={<ClipboardList className="size-5" aria-hidden="true" />} title={text} />;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
