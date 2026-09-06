export const businessReportSections = [
  "overview",
  "sales",
  "products",
  "inventory",
  "operations",
  "team-customers",
  "security-accountability",
] as const;

export type BusinessReportSection = (typeof businessReportSections)[number];

export const businessReportSectionLabels: Record<BusinessReportSection, string> = {
  overview: "Overview",
  sales: "Sales",
  products: "Products",
  inventory: "Inventory",
  operations: "Operations",
  "team-customers": "Team & Customers",
  "security-accountability": "Security & Accountability",
};

export function resolveBusinessReportSection(value: string | undefined): BusinessReportSection {
  return businessReportSections.includes(value as BusinessReportSection)
    ? value as BusinessReportSection
    : "overview";
}
