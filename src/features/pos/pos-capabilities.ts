import type {
  BusinessType,
  OrganizationFeatureSettings,
} from "@/features/business-profile/business-features";

/**
 * Client-safe POS presentation capabilities. The server resolves permissions
 * and feature settings before this contract reaches an interactive component;
 * it is intentionally not an authorization mechanism.
 */
export type PosCapabilities = {
  businessType: BusinessType;
  canAcceptPayments: boolean;
  canApplyDiscounts: boolean;
  canAssignTickets: boolean;
  canCloseShift: boolean;
  canCreateCustomers: boolean;
  canCreateSales: boolean;
  canEditQuantity: boolean;
  canManageTiles: boolean;
  canOpenShift: boolean;
  canRemoveItems: boolean;
  canUseDining: boolean;
  canUseOpenTickets: boolean;
  canUseShiftControls: boolean;
  canUseTimeClock: boolean;
  canUseCustomerLoyalty: boolean;
  canViewReceipts: boolean;
  showRestaurantControls: boolean;
};

export function getPosCapabilities({
  businessType,
  features,
  permissions,
}: {
  businessType: BusinessType;
  features: OrganizationFeatureSettings;
  permissions: Iterable<string>;
}): PosCapabilities {
  const grants = new Set(permissions);
  const has = (permission: string) => grants.has(permission);
  const canCreateSales = has("pos.access") && has("sales.create");
  const restaurantBusiness = businessType === "restaurant_cafe" || businessType === "bar";
  const canUseDining = features.dining && canCreateSales;
  const canUseOpenTickets = features.open_tickets && canCreateSales && has("tickets.manage");

  return {
    businessType,
    canAcceptPayments: canCreateSales && has("payments.accept"),
    canApplyDiscounts: canCreateSales && has("discounts.apply"),
    canAssignTickets: canUseOpenTickets && has("employees.manage"),
    canCloseShift: has("shifts.close"),
    canCreateCustomers: has("customers.manage"),
    canCreateSales,
    canEditQuantity: has("pos.edit_quantity"),
    canManageTiles: has("products.manage"),
    canOpenShift: has("shifts.open"),
    canRemoveItems: has("pos.remove_item"),
    canUseDining,
    canUseOpenTickets,
    canUseShiftControls: ["shifts.open", "shifts.close", "cash.pay_in", "cash.pay_out", "settings.manage"].some(has),
    canUseTimeClock: features.time_clock && has("attendance.use"),
    canUseCustomerLoyalty: features.loyalty && canCreateSales,
    canViewReceipts: canCreateSales && has("receipts.view"),
    // The configured features remain authoritative. Business type supplies
    // defaults only, so a hybrid retail workflow can intentionally opt in.
    showRestaurantControls: restaurantBusiness && (canUseDining || canUseOpenTickets || features.modifiers),
  };
}
