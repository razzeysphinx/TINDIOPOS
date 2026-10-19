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

export function isBusinessType(value: string): value is BusinessType {
  return businessTypes.includes(value as BusinessType);
}
