import { getTindioDatabase } from "../../db/database";
import {
  applyStoreHubChanges,
  getStoreHubPublishSignature,
  getStoreHubState,
  recordStoreHubError,
  saveStoreHubContact,
  saveStoreHubPublishSignature,
} from "../../db/store-hub-cache";
// store_hub_publish_state is accessed through the cache helpers above.
import { loadMobileDeviceIdentity } from "../device/device-store";
import {
  probeStoreHub,
  publishStoreHubEvent,
  pullStoreHubChanges,
  type StoreHubActivityEvent,
} from "./store-hub-client";

type OutboxHubRow = {
  event_id: string;
  organization_id: string;
  store_id: string;
  device_id: string;
  device_sequence: number;
  local_reference: string;
  payload_json: string;
  state: string;
  synced_at: string | null;
  created_at: string;
};

function toHubEvent(
  row: OutboxHubRow,
): StoreHubActivityEvent | null {
  try {
    const payload = JSON.parse(
      row.payload_json,
    ) as {
      checkout?: {
        items?: Array<{
          productId: string;
          variantId: string | null;
          quantity: number;
        }>;
      };
    };

    const items = payload.checkout?.items;

    if (
      !Array.isArray(items)
      || !Number.isSafeInteger(row.device_sequence)
      || row.device_sequence < 1
    ) {
      return null;
    }

    return {
      eventId: row.event_id,
      organizationId: row.organization_id,
      storeId: row.store_id,
      deviceId: row.device_id,
      deviceSequence: row.device_sequence,
      type: "SALE_COMPLETED",
      createdAt: row.created_at,
      localReference: row.local_reference,
      items: items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId ?? null,
        quantity: item.quantity,
      })),
      cloudSyncedAt:
        row.state === "SYNCED"
          ? row.synced_at
          : null,
    };
  } catch {
    return null;
  }
}

export async function synchronizeWithStoreHub(
  organizationId: string,
) {
  const identity = await loadMobileDeviceIdentity(
    organizationId,
  );

  if (!identity?.binding) {
    return {
      ok: false as const,
      reason: "DEVICE_NOT_ENROLLED",
    };
  }

  const probe = await probeStoreHub({
    organizationId,
    storeId: identity.binding.storeId,
  });

  if (!probe.ok) return probe;

  const scope = {
    organizationId,
    storeId: identity.binding.storeId,
    deviceId: identity.credential.deviceId,
  };

  try {
    const outbox = await (await getTindioDatabase())
      .getAllAsync<OutboxHubRow>(
        "SELECT event_id,organization_id,store_id,device_id,device_sequence,local_reference,payload_json,state,synced_at,created_at FROM outbox_events WHERE organization_id=? AND store_id=? AND device_id=? AND operation_type='SALE_COMPLETED' ORDER BY device_sequence ASC",
        organizationId,
        identity.binding.storeId,
        identity.credential.deviceId,
      );

    let published = 0;

    for (const row of outbox) {
      const event = toHubEvent(row);
      if (!event) continue;

      const previous =
        await getStoreHubPublishSignature({
          ...scope,
          eventId: row.event_id,
        });

      const currentCloudSyncedAt =
        event.cloudSyncedAt ?? null;

      if (
        previous?.outbox_state === row.state
        && previous.cloud_synced_at === currentCloudSyncedAt
      ) {
        continue;
      }

      await publishStoreHubEvent(
        probe.config,
        event,
      );

      await saveStoreHubPublishSignature({
        organizationId,
        storeId: identity.binding.storeId,
        eventId: row.event_id,
        outboxState: row.state,
        cloudSyncedAt: currentCloudSyncedAt,
      });

      published += 1;
    }

    let state = await getStoreHubState(scope);
    let cursor = state?.pullCursor ?? 0;
    let pulled = 0;

    for (let page = 0; page < 10; page += 1) {
      const response = await pullStoreHubChanges(
        probe.config,
        cursor,
        100,
      );

      await applyStoreHubChanges(
        organizationId,
        identity.binding.storeId,
        response.changes,
      );

      pulled += response.changes.length;
      cursor = response.nextCursor;

      if (!response.hasMore) break;
    }

    await saveStoreHubContact({
      ...scope,
      hubUrl: probe.config.endpoint,
      pullCursor: cursor,
      lastError: null,
    });

    return {
      ok: true as const,
      published,
      pulled,
      cursor,
    };
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message
        : "STORE_HUB_SYNC_FAILED";

    await recordStoreHubError({
      ...scope,
      hubUrl: probe.config.endpoint,
      error: reason,
    });

    return {
      ok: false as const,
      reason,
    };
  }
}
