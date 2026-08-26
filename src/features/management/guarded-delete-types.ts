export const guardedSetupRecordKinds = [
  "category",
  "custom_role",
  "payment_method",
  "discount",
  "tax_rate",
  "dining_option",
  "ticket_template",
  "modifier_group",
  "supplier",
] as const;

export type GuardedSetupRecordKind = (typeof guardedSetupRecordKinds)[number];

export const guardedSetupRecordLabels: Record<GuardedSetupRecordKind, string> = {
  category: "category",
  custom_role: "custom role",
  payment_method: "payment method",
  discount: "discount",
  tax_rate: "tax rate",
  dining_option: "dining option",
  ticket_template: "ticket template",
  modifier_group: "modifier group",
  supplier: "supplier",
};
