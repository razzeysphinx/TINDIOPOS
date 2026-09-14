import type { BusinessContext } from "@/lib/auth/dal";
import {
  INVENTORY_CAPABILITIES,
  hasAllInventoryCapabilityCodes,
  hasAnyInventoryCapabilityCode,
  hasInventoryCapabilityCode,
  type InventoryCapability,
} from "@/lib/auth/inventory-capabilities";

export {
  INVENTORY_CAPABILITIES,
  type InventoryCapability,
};

export function hasInventoryCapability(
  context: Pick<BusinessContext, "permissions">,
  capability: InventoryCapability,
) {
  return hasInventoryCapabilityCode(
    context.permissions,
    capability,
  );
}

export function hasAllInventoryCapabilities(
  context: Pick<BusinessContext, "permissions">,
  capabilities: readonly InventoryCapability[],
) {
  return hasAllInventoryCapabilityCodes(
    context.permissions,
    capabilities,
  );
}

export function hasAnyInventoryCapability(
  context: Pick<BusinessContext, "permissions">,
  capabilities: readonly InventoryCapability[],
) {
  return hasAnyInventoryCapabilityCode(
    context.permissions,
    capabilities,
  );
}
