import type { BusinessContext } from "@/lib/auth/dal";

export const INVENTORY_CAPABILITIES = [
  "inventory.transfer.create",
  "inventory.transfer.send",
  "inventory.transfer.receive",
  "inventory.count.create",
  "inventory.count.finalize",
  "inventory.adjust.create",
  "inventory.adjust.post",
  "inventory.valuation.view",
  "purchasing.view",
  "purchasing.po.create",
  "purchasing.receive",
  "purchasing.suppliers.manage",
  "purchasing.return",
] as const;

export type InventoryCapability = (typeof INVENTORY_CAPABILITIES)[number];

/**
 * Transitional capability mapping for organizations whose role bundles were
 * created before the Phase 6 granular permission catalog. The database uses
 * the same mapping, so visible controls never claim more access than an RPC
 * or RLS policy grants. This maps capabilities only; it never checks role
 * names, which keeps customer-defined roles fully supported.
 */
const LEGACY_CAPABILITY_PERMISSIONS: Record<InventoryCapability, readonly string[]> = {
  "inventory.transfer.create": ["inventory.transfers", "inventory.manage"],
  "inventory.transfer.send": ["inventory.transfers", "inventory.manage"],
  "inventory.transfer.receive": ["inventory.transfers", "inventory.manage"],
  "inventory.count.create": ["inventory.count", "inventory.manage"],
  "inventory.count.finalize": ["inventory.count", "inventory.manage"],
  "inventory.adjust.create": ["inventory.adjust", "inventory.manage"],
  "inventory.adjust.post": ["inventory.adjust", "inventory.manage"],
  "inventory.valuation.view": ["products.view_cost", "inventory.manage"],
  "purchasing.view": ["inventory.purchase_orders", "inventory.manage"],
  "purchasing.po.create": ["inventory.purchase_orders", "inventory.manage"],
  "purchasing.receive": ["inventory.receive", "inventory.manage"],
  "purchasing.suppliers.manage": ["inventory.suppliers", "inventory.manage"],
  "purchasing.return": ["inventory.manage"],
};

export function hasInventoryCapability(
  context: Pick<BusinessContext, "permissions">,
  capability: InventoryCapability,
) {
  return context.permissions.includes(capability)
    || LEGACY_CAPABILITY_PERMISSIONS[capability].some((permission) => context.permissions.includes(permission));
}

export function hasAllInventoryCapabilities(
  context: Pick<BusinessContext, "permissions">,
  capabilities: readonly InventoryCapability[],
) {
  return capabilities.every((capability) => hasInventoryCapability(context, capability));
}

export function hasAnyInventoryCapability(
  context: Pick<BusinessContext, "permissions">,
  capabilities: readonly InventoryCapability[],
) {
  return capabilities.some((capability) => hasInventoryCapability(context, capability));
}
