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

export type InventoryCapability =
  (typeof INVENTORY_CAPABILITIES)[number];

const LEGACY_CAPABILITY_PERMISSIONS:
  Record<InventoryCapability, readonly string[]> = {
  "inventory.transfer.create": [
    "inventory.transfers",
    "inventory.manage",
  ],
  "inventory.transfer.send": [
    "inventory.transfers",
    "inventory.manage",
  ],
  "inventory.transfer.receive": [
    "inventory.transfers",
    "inventory.manage",
  ],
  "inventory.count.create": [
    "inventory.count",
    "inventory.manage",
  ],
  "inventory.count.finalize": [
    "inventory.count",
    "inventory.manage",
  ],
  "inventory.adjust.create": [
    "inventory.adjust",
    "inventory.manage",
  ],
  "inventory.adjust.post": [
    "inventory.adjust",
    "inventory.manage",
  ],
  "inventory.valuation.view": [
    "products.view_cost",
    "inventory.manage",
  ],
  "purchasing.view": [
    "inventory.purchase_orders",
    "inventory.manage",
  ],
  "purchasing.po.create": [
    "inventory.purchase_orders",
    "inventory.manage",
  ],
  "purchasing.receive": [
    "inventory.receive",
    "inventory.manage",
  ],
  "purchasing.suppliers.manage": [
    "inventory.suppliers",
    "inventory.manage",
  ],
  "purchasing.return": [
    "inventory.manage",
  ],
};

export function hasInventoryCapabilityCode(
  permissions: readonly string[],
  capability: InventoryCapability,
) {
  return permissions.includes(capability)
    || LEGACY_CAPABILITY_PERMISSIONS[capability].some(
      (permission) => permissions.includes(permission),
    );
}

export function hasAllInventoryCapabilityCodes(
  permissions: readonly string[],
  capabilities: readonly InventoryCapability[],
) {
  return capabilities.every((capability) =>
    hasInventoryCapabilityCode(permissions, capability),
  );
}

export function hasAnyInventoryCapabilityCode(
  permissions: readonly string[],
  capabilities: readonly InventoryCapability[],
) {
  return capabilities.some((capability) =>
    hasInventoryCapabilityCode(permissions, capability),
  );
}

const CONTROL_CAPABILITIES = [
  "inventory.transfer.create",
  "inventory.transfer.send",
  "inventory.transfer.receive",
  "inventory.count.create",
  "inventory.count.finalize",
  "inventory.adjust.create",
  "inventory.adjust.post",
] as const satisfies readonly InventoryCapability[];

const PURCHASING_CAPABILITIES = [
  "purchasing.view",
  "purchasing.po.create",
  "purchasing.receive",
  "purchasing.suppliers.manage",
  "purchasing.return",
] as const satisfies readonly InventoryCapability[];

export function canViewInventoryValuation(
  permissions: readonly string[],
) {
  return permissions.includes("products.view_cost")
    && hasInventoryCapabilityCode(
      permissions,
      "inventory.valuation.view",
    );
}

export function hasInventoryControlResponsibility(
  permissions: readonly string[],
) {
  return permissions.includes("inventory.view")
    || permissions.includes("inventory.manage")
    || permissions.includes("inventory.count")
    || permissions.includes("inventory.adjust")
    || permissions.includes("inventory.transfers")
    || hasAnyInventoryCapabilityCode(
      permissions,
      CONTROL_CAPABILITIES,
    )
    || canViewInventoryValuation(permissions);
}

export function hasPurchasingResponsibility(
  permissions: readonly string[],
) {
  return permissions.includes("inventory.manage")
    || permissions.includes("inventory.purchase_orders")
    || permissions.includes("inventory.receive")
    || permissions.includes("inventory.suppliers")
    || hasAnyInventoryCapabilityCode(
      permissions,
      PURCHASING_CAPABILITIES,
    );
}

export function hasInventoryBackOfficeResponsibility(
  permissions: readonly string[],
) {
  return hasInventoryControlResponsibility(permissions)
    || hasPurchasingResponsibility(permissions);
}
