import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  createFeatureSettings,
  isBusinessType,
  type BusinessType,
  type FeatureKey,
  type OrganizationFeatureSettings,
} from "@/features/business-profile/business-features";
import type { TableRow } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { resolveCurrentProfileId } from "@/lib/auth/identity";
import {
  hasInventoryBackOfficeResponsibility,
  hasInventoryControlResponsibility,
  hasPurchasingResponsibility,
} from "@/lib/auth/inventory-capabilities";
import {
  createAuthenticatedDatabaseClient,
} from "@/lib/supabase/authenticated-database-client";

export type BusinessRequestAuth =
  | {
      transport: "cookie";
      authorizationHeader: string;
    }
  | {
      transport: "bearer";
      authorizationHeader: string;
    };

export type VerifiedUser = {
  id: string;
  subject: string;
  email: string | null;
};

export type BusinessContext = {
  requestAuth: BusinessRequestAuth;
  user: VerifiedUser;
  profile: Pick<TableRow<"profiles">, "full_name" | "email">;
  employee: Pick<
    TableRow<"employees">,
    "id" | "employee_number" | "job_title" | "organization_id" | "status"
  >;
  organization: Pick<
    TableRow<"organizations">,
    "id"
    | "name"
    | "currency_code"
    | "timezone"
    | "status"
    | "suspended_at"
    | "suspension_reason"
    | "archive_requested_at"
    | "archived_at"
  > & { business_type: BusinessType; device_management_enabled: boolean };
  availableOrganizations: Array<{
    id: string;
    name: string;
    status: "active" | "suspended" | "archived";
  }>;
  tenantReadiness: {
    canExport: boolean;
    canManageLifecycle: boolean;
    canViewRecovery: boolean;
    canManageRecovery: boolean;
  };
  features: OrganizationFeatureSettings;
  roleNames: string[];
  permissions: string[];
  storeIds: string[];
};

export async function resolveVerifiedUser(
  supabase: Awaited<
    ReturnType<
      typeof createClient
    >
  >,
  accessToken?: string,
  identityClient:
    Parameters<
      typeof resolveCurrentProfileId
    >[0]
    = supabase,
): Promise<VerifiedUser | null> {
  let claimsResult:
    | Awaited<
        ReturnType<
          typeof supabase.auth.getClaims
        >
      >
    | null = null;

  try {
    claimsResult = accessToken
      ? await supabase.auth.getClaims(accessToken)
      : await supabase.auth.getClaims();
  } catch {
    return null;
  }

  const {
    data,
    error,
  } = claimsResult;

  if (
    error
    || !data?.claims
  ) {
    return null;
  }

  const claims = data.claims as Record<string, unknown>;
  const subject =
    typeof claims.sub === "string" && claims.sub.length > 0
      ? claims.sub
      : null;

  if (!subject) return null;

  const id = accessToken
    ? await resolveCurrentProfileId(identityClient)
    : await resolveCurrentProfileId(supabase);

  if (!id) return null;

  return {
    id,
    subject,
    email: typeof claims.email === "string" ? claims.email : null,
  };
}

export const getVerifiedUser = cache(
  async (): Promise<VerifiedUser | null> => {
    const supabase = await createClient();
    return resolveVerifiedUser(supabase);
  },
);

export async function loadBusinessContext({
  requestAuth,
  requestedOrganizationId,
  strictRequestedOrganization = false,
  supabase,
  user,
}: {
  requestAuth: BusinessRequestAuth;
  requestedOrganizationId?: string | null;
  strictRequestedOrganization?: boolean;
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: VerifiedUser;
}): Promise<BusinessContext | null> {
  const membershipsResult = await supabase
    .from("employees")
    .select("id, employee_number, job_title, organization_id, status")
    .eq("profile_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (membershipsResult.error) {
    throw new Error(
      `Unable to resolve business membership: ${membershipsResult.error.message}`,
    );
  }

  if (!membershipsResult.data || membershipsResult.data.length === 0) {
    return null;
  }

  const membershipIds = membershipsResult.data.map(
    (membership) => membership.organization_id,
  );

  const { data: organizations, error: organizationsError } = await supabase
    .from("organizations")
    .select(
      "id, name, currency_code, timezone, status, suspended_at, suspension_reason, archive_requested_at, archived_at, business_type, device_management_enabled",
    )
    .in("id", membershipIds);

  if (organizationsError) {
    throw new Error(
      `Unable to load organization memberships: ${organizationsError.message}`,
    );
  }

  const organizationById = new Map(
    (organizations ?? []).map((organization) => [
      organization.id,
      organization,
    ]),
  );

  const availableOrganizations = membershipsResult.data
    .map((membership) =>
      organizationById.get(membership.organization_id),
    )
    .filter((organization) => organization !== undefined)
    .map((organization) => ({
      id: organization.id,
      name: organization.name,
      status: organization.status as
        | "active"
        | "suspended"
        | "archived",
    }));

  if (availableOrganizations.length === 0) {
    return null;
  }

  const requestedOrganization = requestedOrganizationId
    ? availableOrganizations.find(
        (organization) =>
          organization.id === requestedOrganizationId,
      )
    : undefined;

  if (
    strictRequestedOrganization
    && requestedOrganizationId
    && !requestedOrganization
  ) {
    return null;
  }

  const selectedOrganization =
    requestedOrganization
    ?? availableOrganizations.find(
      (organization) => organization.status === "active",
    )
    ?? availableOrganizations[0];

  const employee = membershipsResult.data.find(
    (membership) =>
      membership.organization_id === selectedOrganization.id,
  );

  const organizationResult =
    organizationById.get(selectedOrganization.id);

  if (!employee || !organizationResult) {
    throw new Error(
      "Unable to resolve the selected organization membership.",
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    throw new Error(
      `Unable to load profile: ${profileError?.message ?? "Not found"}`,
    );
  }

  const organization =
    organizationResult as typeof organizationResult & {
      device_management_enabled: boolean;
    };

  if (organization.status !== "active") {
    const { data: readinessData, error: readinessError } =
      await supabase.rpc(
        "get_organization_readiness_access",
        {
          target_organization_id: organization.id,
        },
      );

    if (readinessError || !readinessData) {
      throw new Error(
        `Unable to resolve organization lifecycle access: ${readinessError?.message ?? "Not found"}`,
      );
    }

    const tenantReadiness = readinessData as {
      can_export?: boolean;
      can_manage_lifecycle?: boolean;
      can_view_recovery?: boolean;
      can_manage_recovery?: boolean;
    };

    return {
      requestAuth,
      user,
      profile,
      employee,
      organization: {
        ...organization,
        business_type: isBusinessType(
          organization.business_type,
        )
          ? organization.business_type
          : "retail",
      },
      availableOrganizations,
      tenantReadiness: {
        canExport: Boolean(tenantReadiness.can_export),
        canManageLifecycle: Boolean(
          tenantReadiness.can_manage_lifecycle,
        ),
        canViewRecovery: Boolean(
          tenantReadiness.can_view_recovery,
        ),
        canManageRecovery: Boolean(
          tenantReadiness.can_manage_recovery,
        ),
      },
      features: createFeatureSettings([]),
      roleNames: [],
      permissions: [],
      storeIds: [],
    };
  }

  const [
    roleLinksResult,
    storeLinksResult,
    featuresResult,
  ] = await Promise.all([
    supabase
      .from("employee_roles")
      .select("role_id")
      .eq("organization_id", employee.organization_id)
      .eq("employee_id", employee.id),

    supabase
      .from("employee_stores")
      .select("store_id")
      .eq("organization_id", employee.organization_id)
      .eq("employee_id", employee.id),

    supabase
      .from("organization_features")
      .select("feature_key, is_enabled")
      .eq("organization_id", employee.organization_id),
  ]);

  if (roleLinksResult.error) {
    throw new Error(
      `Unable to load roles: ${roleLinksResult.error.message}`,
    );
  }

  if (storeLinksResult.error) {
    throw new Error(
      `Unable to load store assignments: ${storeLinksResult.error.message}`,
    );
  }

  if (featuresResult.error) {
    throw new Error(
      `Unable to load business features: ${featuresResult.error.message}`,
    );
  }

  const roleIds =
    roleLinksResult.data.map((link) => link.role_id);

  let roleNames: string[] = [];
  let permissions: string[] = [];

  if (roleIds.length > 0) {
    const [
      rolesResult,
      permissionsResult,
    ] = await Promise.all([
      supabase
        .from("roles")
        .select("name")
        .in("id", roleIds),

      supabase
        .from("role_permissions")
        .select("permission_code")
        .eq("organization_id", employee.organization_id)
        .in("role_id", roleIds),
    ]);

    if (rolesResult.error || permissionsResult.error) {
      throw new Error(
        `Unable to resolve permissions: ${rolesResult.error?.message ?? permissionsResult.error?.message}`,
      );
    }

    roleNames =
      rolesResult.data
        .map((role) => role.name)
        .sort();

    permissions = [
      ...new Set(
        permissionsResult.data.map(
          (permission) => permission.permission_code,
        ),
      ),
    ].sort();
  }

  let storeIds = [
    ...new Set(
      storeLinksResult.data.map(
        (link) => link.store_id,
      ),
    ),
  ];

  if (
    hasOrganizationWideStoreScope({
      permissions,
    })
  ) {
    const {
      data: organizationStores,
      error: organizationStoresError,
    } = await supabase
      .from("stores")
      .select("id")
      .eq("organization_id", employee.organization_id);

    if (organizationStoresError) {
      throw new Error(
        `Unable to load organization-wide store scope: ${organizationStoresError.message}`,
      );
    }

    storeIds = [
      ...new Set(
        (organizationStores ?? []).map(
          (store) => store.id,
        ),
      ),
    ];
  }

  return {
    requestAuth,
    user,
    profile,
    employee,
    organization: {
      ...organization,
      business_type: isBusinessType(
        organization.business_type,
      )
        ? organization.business_type
        : "retail",
    },
    availableOrganizations,
    tenantReadiness: {
      canExport:
        permissions.includes("organization.export"),

      canManageLifecycle: [
        "organization.archive",
        "organization.lifecycle",
      ].every(
        (permission) =>
          permissions.includes(permission),
      ),

      canViewRecovery:
        permissions.some(
          (permission) =>
            permission === "recovery.view"
            || permission === "recovery.manage",
        ),

      canManageRecovery:
        permissions.includes("recovery.manage"),
    },

    features:
      createFeatureSettings(
        (featuresResult.data ?? []).map(
          (feature) => ({
            featureKey:
              feature.feature_key as FeatureKey,
            isEnabled:
              feature.is_enabled,
          }),
        ),
      ),

    roleNames,
    permissions,
    storeIds,
  };
}

export const getBusinessContext = cache(
  async (): Promise<BusinessContext | null> => {
    const cookieClient =
      await createClient();

    const {
      data: sessionData,
      error: sessionError,
    } =
      await cookieClient.auth
        .getSession();

    const accessToken =
      sessionData
        .session
        ?.access_token
        ?.trim();

    if (
      sessionError
      || !accessToken
    ) {
      return null;
    }

    const authorizationHeader =
      `Bearer ${accessToken}`;

    const databaseClient =
      createAuthenticatedDatabaseClient(
        authorizationHeader,
      );

    const user =
      await resolveVerifiedUser(
        cookieClient,
        accessToken,
        databaseClient,
      );

    if (!user) {
      return null;
    }

    const cookieStore =
      await cookies();

    return loadBusinessContext({
      supabase:
        databaseClient,
      user,
      requestedOrganizationId:
        cookieStore.get(
          "tindio-active-organization",
        )?.value,
      strictRequestedOrganization: false,
      requestAuth: {
        transport:
          "cookie",

        authorizationHeader,
      },
    });
  },
);

export async function requireUser() {
  const user = await getVerifiedUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}

export async function requireBusinessContext() {
  const user = await requireUser();
  const context = await getBusinessContext();

  if (!context) {
    redirect("/onboarding");
  }

  if (context.organization.status !== "active") {
    redirect("/organization-paused");
  }

  return { ...context, user };
}

export function hasPermission(context: BusinessContext, permission: string) {
  return context.permissions.includes(permission);
}

/**
 * Organization-wide store access is a capability, not a role label. This
 * mirrors `private.has_store_read_scope` in the database, allowing future
 * customer-defined roles to opt in simply by receiving `stores.manage`.
 */
export function hasOrganizationWideStoreScope(
  context: Pick<BusinessContext, "permissions">,
) {
  return context.permissions.includes("stores.manage");
}

/**
 * Use this for a single-store UI decision. Server actions and RLS remain the
 * authority for mutations, but this keeps page/API checks consistent with
 * the effective store scope resolved in `getBusinessContext`.
 */
export function hasStoreAccess(context: BusinessContext, storeId: string) {
  return hasOrganizationWideStoreScope(context) || context.storeIds.includes(storeId);
}

export function hasFeature(context: BusinessContext, feature: FeatureKey) {
  return context.features[feature];
}

/**
 * Permissions that represent a Back Office responsibility. Operational POS
 * permissions are deliberately excluded: a cashier should enter the POS,
 * not receive a Back Office shell solely because they can sell.
 */
const BACK_OFFICE_PERMISSIONS = [
  "dashboard.view",
  "reports.view",
  "products.manage",
  "customers.manage",
  "employees.manage",
  "roles.manage",
  "stores.manage",
  "registers.manage",
  "organization.manage",
  "settings.manage",
  "approvals.manage",
  "audit.view",
  "devices.manage",
  "organization.export",
  "organization.archive",
  "organization.lifecycle",
  "recovery.view",
  "recovery.manage",
] as const;

export function hasAnyPermission(context: BusinessContext, permissions: readonly string[]) {
  return permissions.some((permission) => hasPermission(context, permission));
}

/**
 * Shared, capability-based visibility model for the operational POS menu.
 * It deliberately returns permissions rather than role labels so customer
 * roles work without application changes.
 */
export function getPosNavigationCapabilities(context: BusinessContext) {
  return {
    canCreateSales: hasPermission(context, "sales.create"),
    canUseShiftControls: hasAnyPermission(context, [
      "shifts.open",
      "shifts.close",
      "cash.pay_in",
      "cash.pay_out",
      "settings.manage",
    ]),
    canViewReceipts: hasPermission(context, "receipts.view"),
  };
}

export function canAccessBackOffice(context: BusinessContext) {
  return hasAnyPermission(context, BACK_OFFICE_PERMISSIONS)
    || (
      context.features.inventory
      && hasInventoryBackOfficeResponsibility(
        context.permissions,
      )
    );
}

/**
 * Select an authorized Back Office landing page. This doubles as the safe
 * fallback for a denied Back Office deep link.
 */
export function getBackOfficeHome(context: BusinessContext) {
  if (hasPermission(context, "dashboard.view")) return "/back-office";
  if (hasPermission(context, "reports.view")) return "/back-office/reports";
  if (
    context.features.inventory
    && hasInventoryControlResponsibility(context.permissions)
  ) {
    return "/back-office/inventory";
  }
  if (
    context.features.inventory
    && hasPurchasingResponsibility(context.permissions)
  ) {
    return "/back-office/purchasing";
  }
  if (hasPermission(context, "products.manage")) return "/back-office/catalog";
  if (hasPermission(context, "customers.manage")) return "/back-office/customers";
  if (hasPermission(context, "employees.manage")) return "/back-office/employees";
  if (hasPermission(context, "roles.manage")) return "/back-office/roles";
  if (hasAnyPermission(context, ["stores.manage", "registers.manage"])) {
    return "/back-office/stores-registers";
  }
  if (hasPermission(context, "devices.manage")) return "/back-office/devices";
  if (hasAnyPermission(context, ["approvals.manage", "audit.view"])) {
    return "/back-office/security";
  }
  if (hasAnyPermission(context, [
    "settings.manage",
    "organization.manage",
    "organization.export",
    "organization.archive",
    "organization.lifecycle",
    "recovery.view",
    "recovery.manage",
  ])) {
    return "/back-office/business-profile";
  }
  return "/workspace/no-access";
}

export function getWorkspaceHome(context: BusinessContext) {
  if (canAccessBackOffice(context)) return getBackOfficeHome(context);
  if (hasPermission(context, "pos.access") && hasPermission(context, "sales.create")) return "/pos";
  if (hasPermission(context, "pos.access")) return "/pos/items";
  if (
    context.features.kitchen_display &&
    hasAnyPermission(context, ["kitchen.view", "kitchen.manage"])
  ) {
    return "/kitchen";
  }
  return "/workspace/no-access";
}

/**
 * Route gate for every Back Office page. Server actions, RPCs, and RLS remain
 * the command authorization source; this prevents POS-only users from using
 * a typed Back Office URL to load the Back Office UI.
 */
export async function requireBackOfficeContext() {
  const context = await requireBusinessContext();

  if (!canAccessBackOffice(context)) {
    redirect(getWorkspaceHome(context));
  }

  return context;
}

/** Require one of the route's declared Back Office permissions. */
export async function requireBackOfficePermission(
  permissions: string | readonly string[],
) {
  const context = await requireBackOfficeContext();
  const requiredPermissions = typeof permissions === "string" ? [permissions] : permissions;

  if (!hasAnyPermission(context, requiredPermissions)) {
    redirect(getBackOfficeHome(context));
  }

  return context;
}
