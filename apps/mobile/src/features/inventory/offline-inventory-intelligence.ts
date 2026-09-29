import type { PosCartLine } from "../../../../../src/contracts/pos";
import { getTindioDatabase } from "../../db/database";
import { getCachedStockEstimate } from "../../db/stock-estimate-cache";
import {
  getStoreHubState,
  readPeerStoreLocalInventoryActivity,
} from "../../db/store-hub-cache";
import type { OutboxState } from "../outbox/outbox-types";

type OutboxInventoryRow = {
  state: OutboxState;
  synced_at: string | null;
  payload_json: string;
};

type CheckoutInventoryLine = {
  productId: string;
  variantId: string | null;
  quantity: number;
};

export type OfflineInventoryIntelligence = {
  status: "ESTIMATED" | "NO_CLOUD_BASELINE";
  authority: "ESTIMATE_ONLY";
  scope: "STORE_LOCAL_AWARE" | "CURRENT_DEVICE_ONLY";
  lastConfirmedCloudStock: number | null;
  lastConfirmedAt: string | null;
  baselineAgeMinutes: number | null;
  knownSyncedActivityFromThisTerminal: number;
  deviceOnlyUnsyncedActivity: number;
  peerStoreLocalActivity: number;
  peerDeviceCount: number;
  peerAffectingEventCount: number;
  storeHubLastContactAt: string | null;
  estimatedAvailableStock: number | null;
  unresolvedEventCount: number;
};

export type CartInventoryIntelligenceLine =
  OfflineInventoryIntelligence & {
    productId: string;
    variantId: string | null;
    label: string;
    cartQuantity: number;
    projectedAfterCurrentCart: number | null;
    projectedBelowZero: boolean;
  };

function normalizedVariant(value: string | null | undefined) {
  return value ?? "";
}

function baselineAgeMinutes(checkedAt: string | null) {
  if (!checkedAt) return null;

  const parsed = Date.parse(checkedAt);

  if (!Number.isFinite(parsed)) return null;

  return Math.max(
    0,
    Math.floor((Date.now() - parsed) / 60_000),
  );
}

function quantityForSaleable(
  payloadJson: string,
  productId: string,
  variantId: string | null,
) {
  try {
    const payload = JSON.parse(payloadJson) as {
      checkout?: {
        items?: CheckoutInventoryLine[];
      };
    };

    const items = payload.checkout?.items;
    if (!Array.isArray(items)) return 0;

    return items.reduce((total, item) => {
      if (
        item.productId !== productId
        || normalizedVariant(item.variantId)
          !== normalizedVariant(variantId)
        || !Number.isFinite(item.quantity)
        || item.quantity <= 0
      ) {
        return total;
      }

      return total + item.quantity;
    }, 0);
  } catch {
    return 0;
  }
}

export async function readOfflineInventoryIntelligence(input: {
  organizationId: string;
  storeId: string;
  deviceId: string;
  productId: string;
  variantId: string | null;
}): Promise<OfflineInventoryIntelligence> {
  const baseline = await getCachedStockEstimate(
    input.organizationId,
    input.storeId,
    input.productId,
    input.variantId,
  );

  const rows = await (await getTindioDatabase())
    .getAllAsync<OutboxInventoryRow>(
      "SELECT state,synced_at,payload_json FROM outbox_events WHERE organization_id=? AND store_id=? AND device_id=? AND operation_type='SALE_COMPLETED' ORDER BY device_sequence ASC",
      input.organizationId,
      input.storeId,
      input.deviceId,
    );

  let syncedQuantityAfterBaseline = 0;
  let unresolvedQuantity = 0;
  let unresolvedEventCount = 0;

  for (const row of rows) {
    const quantity = quantityForSaleable(
      row.payload_json,
      input.productId,
      input.variantId,
    );

    if (quantity <= 0) continue;

    if (row.state === "SYNCED") {
      if (
        baseline
        && row.synced_at
        && row.synced_at > baseline.checked_at
      ) {
        syncedQuantityAfterBaseline += quantity;
      }

      continue;
    }

    unresolvedQuantity += quantity;
    unresolvedEventCount += 1;
  }

  const [hubState, peers] = await Promise.all([
    getStoreHubState({
      organizationId: input.organizationId,
      storeId: input.storeId,
      deviceId: input.deviceId,
    }),
    readPeerStoreLocalInventoryActivity({
      organizationId: input.organizationId,
      storeId: input.storeId,
      currentDeviceId: input.deviceId,
      productId: input.productId,
      variantId: input.variantId,
      baselineCheckedAt:
        baseline?.checked_at ?? null,
    }),
  ]);

  const scope =
    hubState?.lastContactAt
      ? "STORE_LOCAL_AWARE" as const
      : "CURRENT_DEVICE_ONLY" as const;

  if (!baseline) {
    return {
      status: "NO_CLOUD_BASELINE",
      authority: "ESTIMATE_ONLY",
      scope,
      lastConfirmedCloudStock: null,
      lastConfirmedAt: null,
      baselineAgeMinutes: null,
      knownSyncedActivityFromThisTerminal: 0,
      deviceOnlyUnsyncedActivity: -unresolvedQuantity,
      peerStoreLocalActivity: peers.activityDelta,
      peerDeviceCount: peers.peerDeviceCount,
      peerAffectingEventCount: peers.affectingEvents,
      storeHubLastContactAt: hubState?.lastContactAt ?? null,
      estimatedAvailableStock: null,
      unresolvedEventCount,
    };
  }

  return {
    status: "ESTIMATED",
    authority: "ESTIMATE_ONLY",
    scope,
    lastConfirmedCloudStock: baseline.available_quantity,
    lastConfirmedAt: baseline.checked_at,
    baselineAgeMinutes:
      baselineAgeMinutes(baseline.checked_at),
    knownSyncedActivityFromThisTerminal:
      -syncedQuantityAfterBaseline,
    deviceOnlyUnsyncedActivity:
      -unresolvedQuantity,
    peerStoreLocalActivity:
      peers.activityDelta,
    peerDeviceCount:
      peers.peerDeviceCount,
    peerAffectingEventCount:
      peers.affectingEvents,
    storeHubLastContactAt:
      hubState?.lastContactAt ?? null,
    estimatedAvailableStock:
      baseline.available_quantity
      - syncedQuantityAfterBaseline
      - unresolvedQuantity
      + peers.activityDelta,
    unresolvedEventCount,
  };
}

export async function readCartOfflineInventoryIntelligence(input: {
  organizationId: string;
  storeId: string;
  deviceId: string;
  cart: PosCartLine[];
}) {
  const uniqueLines = new Map<
    string,
    {
      productId: string;
      variantId: string | null;
      label: string;
      quantity: number;
    }
  >();

  for (const line of input.cart) {
    const key =
      `${line.productId}:${line.variantId ?? "simple"}`;
    const existing = uniqueLines.get(key);

    if (existing) {
      existing.quantity += line.quantity;
      continue;
    }

    uniqueLines.set(key, {
      productId: line.productId,
      variantId: line.variantId,
      label: line.variantName
        ? `${line.productName} / ${line.variantName}`
        : line.productName,
      quantity: line.quantity,
    });
  }

  const rows: CartInventoryIntelligenceLine[] = [];

  for (const line of uniqueLines.values()) {
    const intelligence =
      await readOfflineInventoryIntelligence({
        organizationId: input.organizationId,
        storeId: input.storeId,
        deviceId: input.deviceId,
        productId: line.productId,
        variantId: line.variantId,
      });

    const projectedAfterCurrentCart =
      intelligence.estimatedAvailableStock === null
        ? null
        : intelligence.estimatedAvailableStock
          - line.quantity;

    rows.push({
      ...intelligence,
      productId: line.productId,
      variantId: line.variantId,
      label: line.label,
      cartQuantity: line.quantity,
      projectedAfterCurrentCart,
      projectedBelowZero:
        projectedAfterCurrentCart !== null
        && projectedAfterCurrentCart < 0,
    });
  }

  return rows;
}
