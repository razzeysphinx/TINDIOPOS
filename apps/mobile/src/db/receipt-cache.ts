import type { PosReceiptListResponse } from "../../../../src/contracts/pos";
import { saveLocalCacheState } from "./cache-state";
import { getTindioDatabase } from "./database";

export async function saveReceiptSummaries(organizationId: string, response: PosReceiptListResponse) {
  const capturedAt = new Date().toISOString();
  const database = await getTindioDatabase();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    for (const receipt of response.receipts) {
      await transaction.runAsync(
        "INSERT INTO receipt_summaries (organization_id,receipt_id,store_id,register_id,receipt_number,issued_at,total_minor,currency_code,payload_json,captured_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,receipt_id) DO UPDATE SET store_id=excluded.store_id,register_id=excluded.register_id,receipt_number=excluded.receipt_number,issued_at=excluded.issued_at,total_minor=excluded.total_minor,currency_code=excluded.currency_code,payload_json=excluded.payload_json,captured_at=excluded.captured_at",
        organizationId, receipt.receipt_id, receipt.store_id, receipt.register_id, receipt.receipt_number, receipt.issued_at, receipt.total_minor, receipt.currency_code, JSON.stringify(receipt), capturedAt,
      );
    }
  });
  await saveLocalCacheState({ organizationId, domain: "receipts", storeId: "", scopeKey: "observed", sourceVersion: null, recordCount: response.receipts.length, isComplete: !response.hasMore, capturedAt });
  return capturedAt;
}
