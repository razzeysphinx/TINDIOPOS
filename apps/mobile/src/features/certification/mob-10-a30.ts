import { getDeviceSyncState } from "../../db/device-sync-state";
import { getOutboxSummary } from "../../db/outbox";
import { searchLocalCatalog } from "../local-first/local-catalog";
import { calculateLocalCartTotals } from "../local-first/local-cart";
import { createOfflineCashSale } from "../outbox/create-offline-sale";
import type { PosDeviceBinding } from "../../../../../src/contracts/pos";
import {
  isMob10A30CertificationBuild,
  runMob10A30AcceptanceLoop,
  type Mob10A30Count,
  validateMob10A30Policy,
} from "./mob-10-a30-policy";

export { isMob10A30CertificationBuild } from "./mob-10-a30-policy";

export type Mob10A30QueueResult =
  | {
      ok: true;
      accepted: number;
      durationMs: number;
      firstEventId: string;
      firstIdempotencyKey: string;
      firstSequence: number;
      lastEventId: string;
      lastIdempotencyKey: string;
      lastSequence: number;
      productId: string;
      productName: string;
      totalMinor: number;
      expectedStockDelta: number;
    }
  | {
      ok: false;
      reason: string;
      accepted: number;
    };

export async function createMob10A30Queue(input: {
  organizationId: string;
  organizationName: string;
  binding: PosDeviceBinding;
  deviceId: string;
  count: Mob10A30Count;
  isOffline: boolean;
  isPrepared: boolean;
  onProgress?: (completed: number) => void;
}): Promise<Mob10A30QueueResult> {
  if (!isMob10A30CertificationBuild()) {
    return { ok: false, reason: "CERTIFICATION_BUILD_REQUIRED", accepted: 0 };
  }

  const [summary, sequence, catalog] = await Promise.all([
    getOutboxSummary(input.organizationId),
    getDeviceSyncState(input.organizationId, input.deviceId),
    searchLocalCatalog({
      organizationId: input.organizationId,
      storeId: input.binding.storeId,
      limit: 100,
    }),
  ]);
  const product = catalog.find((item) =>
    item.productName.toLocaleLowerCase().includes("certification")
    && item.priceMinor > 0
    && !item.isVariablePrice
    && !item.hasModifiers
  );
  if (!product) {
    return { ok: false, reason: "CERTIFICATION_PRODUCT_REQUIRED", accepted: 0 };
  }

  const unresolvedCount = summary.pending + summary.syncing + summary.conflict + summary.failed;
  const policyFailure = validateMob10A30Policy({
    buildProfile: process.env.EAS_BUILD_PROFILE,
    campaign: process.env.EXPO_PUBLIC_TINDIO_CERTIFICATION_CAMPAIGN,
    organizationName: input.organizationName,
    productName: product.productName,
    count: input.count,
    isOffline: input.isOffline,
    isPrepared: input.isPrepared,
    unresolvedCount,
  });
  if (policyFailure) return { ok: false, reason: policyFailure, accepted: 0 };
  if (!sequence) return { ok: false, reason: "DEVICE_SEQUENCE_REQUIRED", accepted: 0 };

  const cart = [{
    ...product,
    quantity: 1,
    manualPriceMinor: null,
    modifierOptionIds: [],
    modifiers: [],
  }];
  const totals = calculateLocalCartTotals(cart, null, null);
  const startedAt = Date.now();
  let accepted = 0;

  try {
    const events = await runMob10A30AcceptanceLoop({
      count: input.count,
      accept: async () => {
        const result = await createOfflineCashSale({
          organizationId: input.organizationId,
          binding: input.binding,
          deviceId: input.deviceId,
          cart,
          totals,
          discountId: null,
          taxRateId: null,
          tenderedMinor: totals.totalMinor,
        });
        if (!result.ok) throw new Error(result.reason);
        accepted += 1;
        return result.event;
      },
      onProgress: input.onProgress,
    });
    const first = events[0];
    const last = events.at(-1)!;
    if (
      first.deviceSequence !== sequence.nextSequence
      || last.deviceSequence !== sequence.nextSequence + input.count - 1
    ) {
      throw new Error("NON_CONTIGUOUS_DEVICE_SEQUENCE");
    }
    return {
      ok: true,
      accepted,
      durationMs: Date.now() - startedAt,
      firstEventId: first.eventId,
      firstIdempotencyKey: first.idempotencyKey,
      firstSequence: first.deviceSequence,
      lastEventId: last.eventId,
      lastIdempotencyKey: last.idempotencyKey,
      lastSequence: last.deviceSequence,
      productId: product.productId,
      productName: product.productName,
      totalMinor: totals.totalMinor * input.count,
      expectedStockDelta: -input.count,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "A30_QUEUE_CREATION_FAILED",
      accepted,
    };
  }
}
