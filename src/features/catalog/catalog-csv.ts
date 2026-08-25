import { csvCell } from "@/lib/csv";

const requiredHeaders = [
  "name",
  "price",
  "track_inventory",
  "unit",
] as const;

export const catalogCsvHeaders = [
  "name",
  "description",
  "category",
  "sku",
  "barcode",
  "price",
  "cost",
  "track_inventory",
  "unit",
  "image_url",
  "variable_price",
  "allow_fractional_quantity",
  "store_price",
  "low_stock_level",
] as const;

export type CatalogCsvPreviewRow = {
  rowNumber: number;
  name: string;
  description: string;
  categoryName: string;
  sku: string;
  barcode: string;
  price: string;
  cost: string;
  trackInventory: boolean;
  unit: string;
  imageUrl: string;
  isVariablePrice: boolean;
  allowFractionalQuantity: boolean;
  priceOverride: string;
  lowStockLevel: string;
};

export type CatalogCsvParseResult =
  | { ok: true; rows: CatalogCsvPreviewRow[] }
  | { ok: false; errors: string[] };

type BooleanParseResult = { value: boolean; error?: never } | { value?: never; error: string };

function parseCsvRecords(text: string): string[][] | string {
  const records: string[][] = [];
  let record: string[] = [];
  let value = "";
  let quoted = false;

  const input = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
      continue;
    }

    if (character === '"') {
      if (value.length !== 0) return "A quote must start at the beginning of a CSV cell.";
      quoted = true;
    } else if (character === ",") {
      record.push(value);
      value = "";
    } else if (character === "\n") {
      record.push(value.replace(/\r$/, ""));
      records.push(record);
      record = [];
      value = "";
    } else {
      value += character;
    }
  }

  if (quoted) return "The CSV file has an unfinished quoted cell.";
  if (value.length > 0 || record.length > 0) {
    record.push(value.replace(/\r$/, ""));
    records.push(record);
  }

  return records;
}

function normalizeBoolean(value: string, field: string, rowNumber: number): BooleanParseResult {
  const normalized = value.trim().toLocaleLowerCase();
  if (["true", "yes", "1"].includes(normalized)) return { value: true };
  if (["false", "no", "0"].includes(normalized)) return { value: false };
  return { error: `Row ${rowNumber}: ${field} must be yes or no.` };
}

function cell(record: string[], positions: Map<string, number>, header: string) {
  return record[positions.get(header) ?? -1]?.trim() ?? "";
}

export function parseCatalogCsv(text: string): CatalogCsvParseResult {
  const records = parseCsvRecords(text);
  if (typeof records === "string") return { ok: false, errors: [records] };
  if (records.length < 2) return { ok: false, errors: ["Add a header row and at least one product row."] };

  const headers = records[0].map((header) => header.trim().toLocaleLowerCase());
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) {
    return { ok: false, errors: [`Missing required CSV columns: ${missingHeaders.join(", ")}.`] };
  }
  if (new Set(headers).size !== headers.length) {
    return { ok: false, errors: ["CSV headers must not repeat."] };
  }

  const positions = new Map(headers.map((header, index) => [header, index]));
  const errors: string[] = [];
  const rows: CatalogCsvPreviewRow[] = [];

  records.slice(1).forEach((record, index) => {
    const rowNumber = index + 2;
    if (record.every((entry) => entry.trim() === "")) return;
    if (record.length > headers.length) {
      errors.push(`Row ${rowNumber}: it has more cells than the header row.`);
      return;
    }

    const trackInventory = normalizeBoolean(cell(record, positions, "track_inventory"), "track_inventory", rowNumber);
    const variablePrice = normalizeBoolean(cell(record, positions, "variable_price") || "no", "variable_price", rowNumber);
    const fractionalQuantity = normalizeBoolean(
      cell(record, positions, "allow_fractional_quantity") || "no",
      "allow_fractional_quantity",
      rowNumber,
    );
    const name = cell(record, positions, "name");
    const price = cell(record, positions, "price");
    const cost = cell(record, positions, "cost") || "0";
    const unit = cell(record, positions, "unit") || "each";
    const imageUrl = cell(record, positions, "image_url");
    const priceOverride = cell(record, positions, "store_price");
    const lowStockLevel = cell(record, positions, "low_stock_level");

    if (!name) errors.push(`Row ${rowNumber}: name is required.`);
    if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(price)) errors.push(`Row ${rowNumber}: price must be a non-negative amount with up to 2 decimals.`);
    if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(cost)) errors.push(`Row ${rowNumber}: cost must be a non-negative amount with up to 2 decimals.`);
    if (priceOverride && !/^\d{1,8}(?:\.\d{1,2})?$/.test(priceOverride)) errors.push(`Row ${rowNumber}: store_price must use up to 2 decimals.`);
    if (lowStockLevel && !/^\d{1,8}(?:\.\d{1,3})?$/.test(lowStockLevel)) errors.push(`Row ${rowNumber}: low_stock_level must use up to 3 decimals.`);
    if (imageUrl && !/^https?:\/\//i.test(imageUrl)) errors.push(`Row ${rowNumber}: image_url must begin with http:// or https://.`);
    if (trackInventory.error) errors.push(trackInventory.error);
    if (variablePrice.error) errors.push(variablePrice.error);
    if (fractionalQuantity.error) errors.push(fractionalQuantity.error);

    if (
      !name ||
      !/^\d{1,8}(?:\.\d{1,2})?$/.test(price) ||
      !/^\d{1,8}(?:\.\d{1,2})?$/.test(cost) ||
      (priceOverride && !/^\d{1,8}(?:\.\d{1,2})?$/.test(priceOverride)) ||
      (lowStockLevel && !/^\d{1,8}(?:\.\d{1,3})?$/.test(lowStockLevel)) ||
      (imageUrl && !/^https?:\/\//i.test(imageUrl)) ||
      "error" in trackInventory ||
      "error" in variablePrice ||
      "error" in fractionalQuantity
    ) return;

    rows.push({
      rowNumber,
      name,
      description: cell(record, positions, "description"),
      categoryName: cell(record, positions, "category"),
      sku: cell(record, positions, "sku"),
      barcode: cell(record, positions, "barcode"),
      price,
      cost,
      trackInventory: trackInventory.value,
      unit,
      imageUrl,
      isVariablePrice: variablePrice.value,
      allowFractionalQuantity: fractionalQuantity.value,
      priceOverride,
      lowStockLevel,
    });
  });

  if (rows.length > 500) errors.push("Import at most 500 product rows at a time.");
  if (rows.length === 0 && errors.length === 0) errors.push("Add at least one product row.");
  return errors.length > 0 ? { ok: false, errors } : { ok: true, rows };
}

export function catalogCsvTemplate() {
  const example = [
    "Coffee beans 250g",
    "Single-origin coffee beans",
    "Beverages",
    "COFFEE-250",
    "480000000001",
    "350.00",
    "180.00",
    "yes",
    "bag",
    "",
    "no",
    "no",
    "",
    "10",
  ];
  const encode = (value: string) => csvCell(value);
  return [catalogCsvHeaders, example].map((row) => row.map(encode).join(",")).join("\r\n");
}
