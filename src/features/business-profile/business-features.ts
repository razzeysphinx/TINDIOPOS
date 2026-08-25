export const businessTypes = [
  "retail",
  "grocery",
  "convenience_store",
  "restaurant_cafe",
  "bar",
  "wholesale",
  "service",
  "other",
] as const;

export type BusinessType = (typeof businessTypes)[number];

export const businessTypeLabels: Record<BusinessType, string> = {
  retail: "Retail",
  grocery: "Grocery",
  convenience_store: "Convenience store",
  restaurant_cafe: "Restaurant / cafe",
  bar: "Bar",
  wholesale: "Wholesale",
  service: "Service",
  other: "Other",
};

export const featureDefinitions = [
  { key: "inventory", label: "Inventory", description: "Stock levels, movements, counts, and inventory management." },
  { key: "shifts", label: "Register shifts", description: "Shift opening, closing, and cash accountability." },
  { key: "time_clock", label: "Time clock", description: "Employee clock-in and clock-out records." },
  { key: "open_tickets", label: "Open tickets", description: "Hold, resume, split, merge, and assign open orders." },
  { key: "dining", label: "Dining", description: "Dining options such as dine-in, takeaway, and delivery." },
  { key: "modifiers", label: "Modifiers", description: "Product customizations and option groups at the POS." },
  { key: "loyalty", label: "Loyalty", description: "Customer point earning and redemption workflows." },
  { key: "customer_display", label: "Customer display", description: "A paired customer-facing payment screen for a register." },
  { key: "kitchen_display", label: "Kitchen display", description: "Kitchen order queue and preparation status workflow." },
  { key: "purchase_orders", label: "Purchase orders", description: "Supplier purchasing and stock receiving workflows." },
  { key: "transfers", label: "Stock transfers", description: "Tracked movement of stock between stores." },
  { key: "production", label: "Production", description: "Composite-product production and component consumption." },
  { key: "weighted_products", label: "Weighted products", description: "Fractional quantities for weight- or measure-based products." },
  { key: "multi_store", label: "Multi-store", description: "Multi-location operational recommendations and controls." },
] as const;

export type FeatureKey = (typeof featureDefinitions)[number]["key"];

export type OrganizationFeatureSettings = Record<FeatureKey, boolean>;

export const featureKeys = featureDefinitions.map((feature) => feature.key) as FeatureKey[];

export function isBusinessType(value: string): value is BusinessType {
  return businessTypes.includes(value as BusinessType);
}

export function createFeatureSettings(
  values: Array<{ featureKey: string; isEnabled: boolean }> = [],
): OrganizationFeatureSettings {
  const lookup = new Map(values.map((value) => [value.featureKey, value.isEnabled]));

  return Object.fromEntries(
    featureKeys.map((featureKey) => [featureKey, lookup.get(featureKey) ?? false]),
  ) as OrganizationFeatureSettings;
}

export function recommendedFeatureSettings(businessType: BusinessType): OrganizationFeatureSettings {
  const restaurant = businessType === "restaurant_cafe" || businessType === "bar";
  const inventoryBusiness = businessType !== "service";
  const supplyChainBusiness = [
    "retail",
    "grocery",
    "convenience_store",
    "restaurant_cafe",
    "bar",
    "wholesale",
  ].includes(businessType);

  return {
    inventory: inventoryBusiness,
    shifts: true,
    time_clock: true,
    open_tickets: restaurant,
    dining: restaurant,
    modifiers: restaurant,
    loyalty: businessType !== "wholesale",
    customer_display: restaurant,
    kitchen_display: restaurant,
    purchase_orders: supplyChainBusiness,
    transfers: supplyChainBusiness,
    production: restaurant,
    weighted_products: ["grocery", "convenience_store", "restaurant_cafe", "bar", "wholesale"].includes(businessType),
    multi_store: businessType === "wholesale",
  };
}
