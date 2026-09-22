import { loadPosWorkspace } from "@/features/pos/data";
import { getPosCapabilities } from "@/features/pos/pos-capabilities";
import { posApiJson } from "@/features/pos/pos-api-response";
import { hasPermission } from "@/lib/auth/dal";
import { getPosApiBusinessContext } from "@/lib/auth/pos-api-context";

export async function GET(request: Request) {
  const context = await getPosApiBusinessContext(request);

  if (!context) {
    return posApiJson({ ok: false, message: "Sign in is required." }, 401);
  }

  if (!hasPermission(context, "pos.access") || !hasPermission(context, "sales.create")) {
    return posApiJson({ ok: false, message: "POS access is not permitted." }, 403);
  }

  const workspace = await loadPosWorkspace(context);
  const capabilities = getPosCapabilities({
    businessType: context.organization.business_type,
    features: context.features,
    permissions: context.permissions,
  });

  return posApiJson({
    organization: {
      id: context.organization.id,
      name: context.organization.name,
      currencyCode: context.organization.currency_code,
      timezone: context.organization.timezone,
      businessType: context.organization.business_type,
      deviceManagementEnabled: context.organization.device_management_enabled,
    },
    employee: {
      id: context.employee.id,
      employeeNumber: context.employee.employee_number,
      name: context.profile.full_name || context.profile.email || context.employee.employee_number,
    },
    capabilities,
    offlineScope: `${context.organization.id}:${context.user.id}`,
    workspace,
  });
}
