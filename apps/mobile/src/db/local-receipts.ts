import { getTindioDatabase } from "./database";
import type { DurableSaleSnapshot } from "../features/outbox/outbox-types";

export const LOCAL_RECEIPT_SEARCH_SQL = `SELECT * FROM local_receipts
  WHERE organization_id=? AND store_id IN (SELECT value FROM json_each(?))
    AND (?='' OR lower(local_reference) LIKE ? OR cast(official_receipt_number AS TEXT) LIKE ? OR lower(snapshot_json) LIKE ?)
  ORDER BY created_at DESC,event_id DESC LIMIT ?`;

export const LOCAL_RECEIPT_DETAIL_SQL = `SELECT * FROM local_receipts
  WHERE organization_id=? AND event_id=? AND store_id IN (SELECT value FROM json_each(?))`;

export const RECEIPT_COPY_HISTORY_SQL = `SELECT jobs.job_id,jobs.copy_number,jobs.document_kind,jobs.state,jobs.created_at,jobs.completed_at,jobs.last_error
  FROM receipt_copy_jobs jobs JOIN local_receipts receipts ON receipts.event_id=jobs.event_id
  WHERE jobs.organization_id=? AND jobs.event_id=?
    AND receipts.organization_id=jobs.organization_id
    AND receipts.store_id IN (SELECT value FROM json_each(?))
  ORDER BY jobs.copy_number DESC`;

type LocalReceiptRow = {
  event_id: string;
  organization_id: string;
  store_id: string;
  register_id: string;
  local_reference: string;
  snapshot_version: number;
  snapshot_json: string;
  created_at: string;
  server_sale_id: string | null;
  official_receipt_number: number | null;
  linked_at: string | null;
};

export type LocalReceipt = {
  eventId: string;
  organizationId: string;
  storeId: string;
  registerId: string;
  localReference: string;
  snapshot: DurableSaleSnapshot;
  createdAt: string;
  serverSaleId: string | null;
  officialReceiptNumber: number | null;
  linkedAt: string | null;
};

export type ReceiptCopyJob = {
  jobId: string;
  copyNumber: number;
  documentKind: "PROVISIONAL" | "OFFICIAL";
  state: "PREPARED" | "COMPLETED" | "FAILED";
  createdAt: string;
  completedAt: string | null;
  lastError: string | null;
};

function parseReceipt(row: LocalReceiptRow): LocalReceipt | null {
  try {
    const snapshot = JSON.parse(row.snapshot_json) as DurableSaleSnapshot;
    if ((snapshot.version !== 1 && snapshot.version !== 2)
      || snapshot.organizationId !== row.organization_id
      || snapshot.storeId !== row.store_id
      || snapshot.localReceiptReference !== row.local_reference) return null;
    if (snapshot.version === 2 && !Array.isArray(snapshot.lines)) return null;
    return {
      eventId: row.event_id,
      organizationId: row.organization_id,
      storeId: row.store_id,
      registerId: row.register_id,
      localReference: row.local_reference,
      snapshot,
      createdAt: row.created_at,
      serverSaleId: row.server_sale_id,
      officialReceiptNumber: row.official_receipt_number,
      linkedAt: row.linked_at,
    };
  } catch {
    return null;
  }
}

function storeScope(authorizedStoreIds: readonly string[]) {
  return JSON.stringify([...new Set(authorizedStoreIds)]);
}

export async function searchLocalReceipts(
  organizationId: string,
  authorizedStoreIds: readonly string[],
  query: string,
  limit = 25,
) {
  if (authorizedStoreIds.length === 0) return [];
  const normalized = query.trim().toLocaleLowerCase();
  const rows = await (await getTindioDatabase()).getAllAsync<LocalReceiptRow>(
    LOCAL_RECEIPT_SEARCH_SQL,
    organizationId,
    storeScope(authorizedStoreIds),
    normalized,
    `%${normalized}%`,
    `%${normalized}%`,
    `%${normalized}%`,
    Math.min(Math.max(limit, 1), 100),
  );
  return rows.flatMap((row) => {
    const receipt = parseReceipt(row);
    return receipt ? [receipt] : [];
  });
}

export async function getLocalReceipt(
  organizationId: string,
  authorizedStoreIds: readonly string[],
  eventId: string,
) {
  if (authorizedStoreIds.length === 0) return null;
  const row = await (await getTindioDatabase()).getFirstAsync<LocalReceiptRow>(
    LOCAL_RECEIPT_DETAIL_SQL,
    organizationId,
    eventId,
    storeScope(authorizedStoreIds),
  );
  return row ? parseReceipt(row) : null;
}

export async function listReceiptCopyJobs(
  organizationId: string,
  authorizedStoreIds: readonly string[],
  eventId: string,
): Promise<ReceiptCopyJob[]> {
  if (authorizedStoreIds.length === 0) return [];
  const rows = await (await getTindioDatabase()).getAllAsync<{
    job_id: string;
    copy_number: number;
    document_kind: ReceiptCopyJob["documentKind"];
    state: ReceiptCopyJob["state"];
    created_at: string;
    completed_at: string | null;
    last_error: string | null;
  }>(
    RECEIPT_COPY_HISTORY_SQL,
    organizationId,
    eventId,
    storeScope(authorizedStoreIds),
  );
  return rows.map((row) => ({
    jobId: row.job_id,
    copyNumber: row.copy_number,
    documentKind: row.document_kind,
    state: row.state,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    lastError: row.last_error,
  }));
}

export async function prepareReceiptCopy(input: {
  jobId: string;
  organizationId: string;
  authorizedStoreIds: readonly string[];
  eventId: string;
  requestedByProfileId: string;
  requestedByEmployeeId: string;
  createdAt: string;
}): Promise<ReceiptCopyJob | null> {
  if (!input.jobId || input.authorizedStoreIds.length === 0) return null;
  const database = await getTindioDatabase();
  let job: ReceiptCopyJob | null = null;
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const receipt = await transaction.getFirstAsync<{
      official_receipt_number: number | null;
    }>(
      `SELECT official_receipt_number FROM local_receipts
       WHERE organization_id=? AND event_id=? AND store_id IN (SELECT value FROM json_each(?))`,
      input.organizationId,
      input.eventId,
      storeScope(input.authorizedStoreIds),
    );
    if (!receipt) return;
    const next = await transaction.getFirstAsync<{ copy_number: number }>(
      "SELECT coalesce(max(copy_number),0)+1 AS copy_number FROM receipt_copy_jobs WHERE organization_id=? AND event_id=?",
      input.organizationId,
      input.eventId,
    );
    if (!next || !Number.isSafeInteger(next.copy_number)) throw new Error("Copy number could not be allocated.");
    const documentKind = receipt.official_receipt_number === null ? "PROVISIONAL" : "OFFICIAL";
    await transaction.runAsync(
      "INSERT INTO receipt_copy_jobs (job_id,organization_id,event_id,copy_number,document_kind,state,requested_by_profile_id,requested_by_employee_id,created_at) VALUES (?,?,?,?,?,'PREPARED',?,?,?)",
      input.jobId,
      input.organizationId,
      input.eventId,
      next.copy_number,
      documentKind,
      input.requestedByProfileId,
      input.requestedByEmployeeId,
      input.createdAt,
    );
    job = {
      jobId: input.jobId,
      copyNumber: next.copy_number,
      documentKind,
      state: "PREPARED",
      createdAt: input.createdAt,
      completedAt: null,
      lastError: null,
    };
  });
  return job;
}
