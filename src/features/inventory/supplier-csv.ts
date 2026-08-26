import { csvRows, parseCsvRecords } from "@/lib/csv";

const requiredHeaders = ["name"] as const;
export const supplierCsvHeaders = ["name", "contact_name", "email", "phone", "address", "notes"] as const;
export type SupplierCsvPreviewRow = { rowNumber: number; name: string; contactName: string; email: string; phone: string; address: string; notes: string };
export type SupplierCsvParseResult = { ok: true; rows: SupplierCsvPreviewRow[] } | { ok: false; errors: string[] };

function cell(record: string[], positions: Map<string, number>, header: string) { return record[positions.get(header) ?? -1]?.trim() ?? ""; }

export function parseSupplierCsv(text: string): SupplierCsvParseResult {
  const records = parseCsvRecords(text);
  if (typeof records === "string") return { ok: false, errors: [records] };
  if (records.length < 2) return { ok: false, errors: ["Add a header row and at least one supplier row."] };
  const headers = records[0].map((value) => value.trim().toLowerCase());
  const missing = requiredHeaders.filter((header) => !headers.includes(header));
  if (missing.length) return { ok: false, errors: [`Missing required CSV columns: ${missing.join(", ")}.`] };
  if (new Set(headers).size !== headers.length) return { ok: false, errors: ["CSV headers must not repeat."] };
  const positions = new Map(headers.map((header, index) => [header, index]));
  const rows: SupplierCsvPreviewRow[] = []; const errors: string[] = [];
  records.slice(1).forEach((record, index) => {
    const rowNumber = index + 2;
    if (record.every((value) => !value.trim())) return;
    if (record.length > headers.length) { errors.push(`Row ${rowNumber}: it has more cells than the header row.`); return; }
    const name = cell(record, positions, "name"); const email = cell(record, positions, "email");
    if (!name || name.length > 160) errors.push(`Row ${rowNumber}: name is required and must be at most 160 characters.`);
    if (email && (!/^\S+@\S+\.\S+$/.test(email) || email.length > 320)) errors.push(`Row ${rowNumber}: email is invalid.`);
    if (!name || name.length > 160 || (email && (!/^\S+@\S+\.\S+$/.test(email) || email.length > 320))) return;
    rows.push({ rowNumber, name, contactName: cell(record, positions, "contact_name"), email, phone: cell(record, positions, "phone"), address: cell(record, positions, "address"), notes: cell(record, positions, "notes") });
  });
  if (rows.length > 500) errors.push("Import at most 500 supplier rows at a time.");
  if (!rows.length && !errors.length) errors.push("Add at least one supplier row.");
  return errors.length ? { ok: false, errors } : { ok: true, rows };
}

export function supplierCsvTemplate() { return csvRows([Array.from(supplierCsvHeaders), ["Acme Foods", "Pat Cruz", "orders@acme.example", "+63 917 000 0000", "Quezon City", "Imported supplier"]]); }
