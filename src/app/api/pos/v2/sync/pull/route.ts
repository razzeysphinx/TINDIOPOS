import { NextResponse } from "next/server";
import {
  POS_SYNC_CATALOG_RPC,
  POS_SYNC_CHANGE_WINDOW_RPC,
  POS_SYNC_CUSTOMER_RPC,
  POS_SYNC_DEVICE_REJECTED_MESSAGE,
  POS_SYNC_PULL_DEFAULT_LIMIT,
  POS_SYNC_PULL_INVALID_MESSAGE,
  POS_SYNC_PULL_UNAVAILABLE_MESSAGE,
  POS_SYNC_REFERENCE_RPC,
  POS_SYNC_RETENTION_RPC,
  POS_SYNC_VERSION,
} from "@tindio/contracts/sync-control";
import type { PosCatalogDelta, PosCustomerDelta, PosReferenceV2Response, PosSyncCursorExpiredResponse, PosSyncPullResponse } from "@/contracts/pos";
import { syncPullBodySchema, validatedSyncDevice } from "@/features/offline/pos-v2-sync-service";
import { getPosV2BusinessContext } from "@/lib/auth/pos-v2-business-context";

const headers = { "Cache-Control": "private, no-store" };
type Change = { revision: number; domain: string; entity_id: string | null; operation: string; store_id: string | null };
type Retention = { retained_after_revision: number | string; current_revision: number | string };
function jsonRpcValue<T>(data: unknown): T | undefined { return (Array.isArray(data) ? data[0] : data) as T | undefined; }

export async function POST(request: Request) {
  const resolved = await getPosV2BusinessContext(request);
  if (!resolved.ok) return resolved.response;
  const parsed = syncPullBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: POS_SYNC_PULL_INVALID_MESSAGE }, { status: 400, headers });

  try {
    const checked = await validatedSyncDevice(resolved.context, parsed.data);
    if (!checked) return NextResponse.json({ ok: false, message: POS_SYNC_DEVICE_REJECTED_MESSAGE }, { status: 403, headers });

    const retentionAnswer = await checked.database.rpc(POS_SYNC_RETENTION_RPC, {
      target_organization_id: resolved.context.organization.id,
      target_device_id: checked.device.deviceId,
    });
    const retention = jsonRpcValue<Retention>(retentionAnswer.data);
    if (retentionAnswer.error || !retention) throw new Error(`sync retention unavailable: ${retentionAnswer.error?.message ?? "invalid payload"}`);
    const retainedAfterRevision = Number(retention.retained_after_revision);
    const serverRevision = Number(retention.current_revision);
    if (!Number.isSafeInteger(retainedAfterRevision) || !Number.isSafeInteger(serverRevision)) throw new Error("invalid sync retention revision");

    if (parsed.data.cursor < retainedAfterRevision) {
      const expired: PosSyncCursorExpiredResponse = {
        ok: false,
        version: POS_SYNC_VERSION,
        code: "SYNC_CURSOR_EXPIRED",
        organizationId: resolved.context.organization.id,
        deviceId: checked.device.deviceId,
        storeId: checked.device.storeId,
        fromCursor: parsed.data.cursor,
        retainedAfterRevision,
        serverRevision,
      };
      return NextResponse.json(expired, { status: 409, headers });
    }

    const limit = parsed.data.limit ?? POS_SYNC_PULL_DEFAULT_LIMIT;
    const window = await checked.database.rpc(POS_SYNC_CHANGE_WINDOW_RPC, {
      target_organization_id: resolved.context.organization.id,
      target_device_id: checked.device.deviceId,
      target_after_revision: parsed.data.cursor,
      target_limit: limit,
    });
    if (window.error) throw new Error(window.error.message);
    const raw = (window.data ?? []).map((row) => ({ ...row, revision: Number(row.revision) }) as Change);
    const consumed = raw.slice(0, limit);
    const hasMore = raw.length > limit;
    const nextCursor = consumed.length ? consumed[consumed.length - 1].revision : parsed.data.cursor;
    const catalogIds = [...new Set(consumed.filter((row) => row.domain === "CATALOG" && row.entity_id).map((row) => row.entity_id!))];
    const customerIds = [...new Set(consumed.filter((row) => row.domain === "CUSTOMER" && row.entity_id).map((row) => row.entity_id!))];
    const catalog: PosCatalogDelta[] = [];
    for (const productId of catalogIds) {
      const revision = Math.max(...consumed.filter((row) => row.domain === "CATALOG" && row.entity_id === productId).map((row) => row.revision));
      const answer = await checked.database.rpc(POS_SYNC_CATALOG_RPC, { target_organization_id: resolved.context.organization.id, target_store_id: checked.device.storeId, target_product_id: productId });
      const value = jsonRpcValue<{ items?: PosCatalogDelta["items"] }>(answer.data);
      if (answer.error || !value || !Array.isArray(value.items)) throw new Error(`catalog delta unavailable: ${answer.error?.message ?? "invalid payload"}`);
      catalog.push({ revision, productId, storeId: checked.device.storeId, items: value.items });
    }
    const customers: PosCustomerDelta[] = [];
    for (const customerId of customerIds) {
      const revision = Math.max(...consumed.filter((row) => row.domain === "CUSTOMER" && row.entity_id === customerId).map((row) => row.revision));
      const answer = await checked.database.rpc(POS_SYNC_CUSTOMER_RPC, { target_organization_id: resolved.context.organization.id, target_device_id: checked.device.deviceId, target_customer_id: customerId });
      const value = jsonRpcValue<{ customer?: PosCustomerDelta["customer"] }>(answer.data);
      if (answer.error || !value) throw new Error(`customer delta unavailable: ${answer.error?.message ?? "invalid payload"}`);
      customers.push({ revision, customerId, customer: value.customer ?? null });
    }
    const referenceRows = consumed.filter((row) => row.domain === "REFERENCE");
    const deviceRow = consumed.some((row) => row.domain === "DEVICE" && row.entity_id === checked.device.deviceId);
    const reference = referenceRows.length ? await (async () => {
      const answer = await checked.database.rpc(POS_SYNC_REFERENCE_RPC, { target_organization_id: resolved.context.organization.id });
      const snapshot = jsonRpcValue<PosReferenceV2Response>(answer.data);
      if (answer.error || !snapshot) throw new Error(`reference unavailable: ${answer.error?.message ?? "invalid payload"}`);
      return { revision: Math.max(...referenceRows.map((row) => row.revision)), snapshot };
    })() : null;
    const body: PosSyncPullResponse = {
      ok: true,
      version: POS_SYNC_VERSION,
      organizationId: resolved.context.organization.id,
      deviceId: checked.device.deviceId,
      storeId: checked.device.storeId,
      fromCursor: parsed.data.cursor,
      nextCursor,
      serverRevision,
      hasMore,
      catalog,
      reference,
      customers,
      device: deviceRow ? {
        revision: Math.max(...consumed.filter((row) => row.domain === "DEVICE" && row.entity_id === checked.device.deviceId).map((row) => row.revision)),
        deviceId: checked.device.deviceId,
        status: checked.device.status,
        storeId: checked.device.storeId,
        registerId: checked.device.registerId,
        deviceName: checked.device.deviceName,
        appVersion: checked.device.appVersion,
        lastSeenAt: checked.device.lastSeenAt,
      } : null,
      invalidateModifiers: consumed.some((row) => row.domain === "MODIFIERS"),
    };
    return NextResponse.json(body, { headers });
  } catch (error) {
    console.error("POS sync pull failed", { message: error instanceof Error ? error.message : "unknown error" });
    return NextResponse.json({ ok: false, message: POS_SYNC_PULL_UNAVAILABLE_MESSAGE }, { status: 503, headers });
  }
}
