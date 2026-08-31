import "server-only";

import { z } from "zod";

import { hasOrganizationWideStoreScope, type BusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

type StoreSearchParams = { store?: string | string[] };

export type BackOfficeStoreScope = {
  canAccessAllStores: boolean;
  invalidSelection: boolean;
  selectedStoreId: string | null;
  storeIds: string[] | null;
};

function firstString(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

/**
 * `stores.manage` is the existing explicit organization-wide authority.
 * All other Back Office users are constrained to their employee-store links.
 */
export function canAccessAllBackOfficeStores(context: BusinessContext) {
  return hasOrganizationWideStoreScope(context);
}

export function resolveBackOfficeStoreScope(
  context: BusinessContext,
  searchParams: StoreSearchParams,
): BackOfficeStoreScope {
  const canAccessAllStores = canAccessAllBackOfficeStores(context);
  const assignedStoreIds = [...new Set(context.storeIds)];
  const candidate = firstString(searchParams.store);

  if (!candidate) {
    return {
      canAccessAllStores,
      invalidSelection: false,
      selectedStoreId: null,
      storeIds: canAccessAllStores ? null : assignedStoreIds,
    };
  }

  const selectedStoreId = z.uuid().safeParse(candidate).success ? candidate : null;
  const invalidSelection = !selectedStoreId || (!canAccessAllStores && !assignedStoreIds.includes(selectedStoreId));

  return {
    canAccessAllStores,
    invalidSelection,
    selectedStoreId: invalidSelection ? null : selectedStoreId,
    storeIds: invalidSelection
      ? []
      : selectedStoreId
        ? [selectedStoreId]
        : canAccessAllStores
          ? null
          : assignedStoreIds,
  };
}

export async function loadAuthorizedBackOfficeStores(context: BusinessContext) {
  const scope = resolveBackOfficeStoreScope(context, {});
  if (scope.storeIds?.length === 0) return [];

  const supabase = await createClient();
  let query = supabase
    .from("stores")
    .select("id, name")
    .eq("organization_id", context.organization.id)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (scope.storeIds) query = query.in("id", scope.storeIds);

  const { data, error } = await query;
  if (error) throw new Error(`Unable to load authorized stores: ${error.message}`);
  return data ?? [];
}
