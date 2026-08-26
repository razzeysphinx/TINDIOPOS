// Shared CSV encoding used by export routes and client-side templates.
// Output must stay byte-identical: RFC-style quoting with doubled quotes,
// comma cell separators, and CRLF record separators.

export function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function csvRows(rows: Array<Array<string | number>>) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

// A small RFC 4180-compatible parser shared by client-side CSV previews.
// Server-side actions/RPCs always validate again before any write is committed.
export function parseCsvRecords(text: string): string[][] | string {
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
