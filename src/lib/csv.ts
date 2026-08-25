// Shared CSV encoding used by export routes and client-side templates.
// Output must stay byte-identical: RFC-style quoting with doubled quotes,
// comma cell separators, and CRLF record separators.

export function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function csvRows(rows: Array<Array<string | number>>) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
