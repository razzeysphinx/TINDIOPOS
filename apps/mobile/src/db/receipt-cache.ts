import type {
  PosReceiptListResponse,
  PosReceiptSummary,
} from "../../../../src/contracts/pos";
import { saveLocalCacheState } from "./cache-state";
import { getTindioDatabase } from "./database";

export async function saveReceiptSummaries(
  organizationId: string,
  response: PosReceiptListResponse,
) {
  const capturedAt = new Date().toISOString();
  const database = await getTindioDatabase();

  await database.withExclusiveTransactionAsync(async (transaction) => {
    for (const receipt of response.receipts) {
      await transaction.runAsync(
        "INSERT INTO receipt_summaries (organization_id,receipt_id,store_id,register_id,receipt_number,issued_at,total_minor,currency_code,payload_json,captured_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,receipt_id) DO UPDATE SET store_id=excluded.store_id,register_id=excluded.register_id,receipt_number=excluded.receipt_number,issued_at=excluded.issued_at,total_minor=excluded.total_minor,currency_code=excluded.currency_code,payload_json=excluded.payload_json,captured_at=excluded.captured_at",
        organizationId,
        receipt.receipt_id,
        receipt.store_id,
        receipt.register_id,
        receipt.receipt_number,
        receipt.issued_at,
        receipt.total_minor,
        receipt.currency_code,
        JSON.stringify(receipt),
        capturedAt,
      );
    }
  });

  await saveLocalCacheState({
    organizationId,
    domain: "receipts",
    storeId: "",
    scopeKey: "observed",
    sourceVersion: null,
    recordCount: response.receipts.length,
    isComplete: !response.hasMore,
    capturedAt,
  });

  return capturedAt;
}

export async function searchCachedReceiptSummaries(
  organizationId: string,
  query: string,
  limit = 25,
) {
  const normalized = query.trim().toLocaleLowerCase();

  const rows = await (await getTindioDatabase()).getAllAsync<{ payload_json: string }>(
    "SELECT payload_json FROM receipt_summaries WHERE organization_id=? AND (?='' OR cast(receipt_number as text) LIKE ? OR lower(payload_json) LIKE ?) ORDER BY receipt_number DESC LIMIT ?",
    organizationId,
    normalized,
    `%${normalized}%`,
    `%${normalized}%`,
    Math.min(Math.max(limit, 1), 100),
  );

  return rows.flatMap((row) => {
    try {
      return [JSON.parse(row.payload_json) as PosReceiptSummary];
    } catch {
      return [];
    }
  });
}
