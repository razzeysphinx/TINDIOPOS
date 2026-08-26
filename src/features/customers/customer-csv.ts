import { csvRows, parseCsvRecords } from "@/lib/csv";

const requiredHeaders = ["full_name"] as const;
export const customerCsvHeaders = [
  "full_name",
  "email",
  "phone",
  "address",
  "birthday",
  "notes",
  "loyalty_card_code",
] as const;

export type CustomerCsvPreviewRow = {
  rowNumber: number;
  fullName: string;
  email: string;
  phone: string;
  address: string;
  birthday: string;
  notes: string;
  loyaltyCardCode: string;
};

export type CustomerCsvParseResult =
  | { ok: true; rows: CustomerCsvPreviewRow[] }
  | { ok: false; errors: string[] };

function cell(record: string[], positions: Map<string, number>, header: string) {
  return record[positions.get(header) ?? -1]?.trim() ?? "";
}

export function parseCustomerCsv(text: string): CustomerCsvParseResult {
  const records = parseCsvRecords(text);
  if (typeof records === "string") return { ok: false, errors: [records] };
  if (records.length < 2) return { ok: false, errors: ["Add a header row and at least one customer row."] };
  const headers = records[0].map((value) => value.trim().toLowerCase());
  const missing = requiredHeaders.filter((header) => !headers.includes(header));
  if (missing.length) return { ok: false, errors: [`Missing required CSV columns: ${missing.join(", ")}.`] };
  if (new Set(headers).size !== headers.length) return { ok: false, errors: ["CSV headers must not repeat."] };

  const positions = new Map(headers.map((header, index) => [header, index]));
  const rows: CustomerCsvPreviewRow[] = [];
  const errors: string[] = [];
  records.slice(1).forEach((record, index) => {
    const rowNumber = index + 2;
    if (record.every((value) => !value.trim())) return;
    if (record.length > headers.length) {
      errors.push(`Row ${rowNumber}: it has more cells than the header row.`);
      return;
    }
    const fullName = cell(record, positions, "full_name");
    const email = cell(record, positions, "email");
    const phone = cell(record, positions, "phone");
    const birthday = cell(record, positions, "birthday");
    const loyaltyCardCode = cell(record, positions, "loyalty_card_code");
    if (!fullName || fullName.length > 160) errors.push(`Row ${rowNumber}: full_name is required and must be at most 160 characters.`);
    if (email && (!/^\S+@\S+\.\S+$/.test(email) || email.length > 320)) errors.push(`Row ${rowNumber}: email is invalid.`);
    if (phone && (phone.length < 3 || phone.length > 40)) errors.push(`Row ${rowNumber}: phone must be 3–40 characters.`);
    if (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) errors.push(`Row ${rowNumber}: birthday must use YYYY-MM-DD.`);
    if (loyaltyCardCode && (loyaltyCardCode.length < 3 || loyaltyCardCode.length > 80)) errors.push(`Row ${rowNumber}: loyalty_card_code must be 3–80 characters.`);
    if (!fullName || fullName.length > 160 || (email && (!/^\S+@\S+\.\S+$/.test(email) || email.length > 320)) || (phone && (phone.length < 3 || phone.length > 40)) || (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) || (loyaltyCardCode && (loyaltyCardCode.length < 3 || loyaltyCardCode.length > 80))) return;
    rows.push({ rowNumber, fullName, email, phone, address: cell(record, positions, "address"), birthday, notes: cell(record, positions, "notes"), loyaltyCardCode });
  });
  if (rows.length > 500) errors.push("Import at most 500 customer rows at a time.");
  if (!rows.length && !errors.length) errors.push("Add at least one customer row.");
  return errors.length ? { ok: false, errors } : { ok: true, rows };
}

export function customerCsvTemplate() {
  return csvRows([Array.from(customerCsvHeaders), ["Jamie Santos", "jamie@example.com", "+63 917 000 0000", "Manila", "1992-04-15", "Imported from prior CRM", ""]]);
}
