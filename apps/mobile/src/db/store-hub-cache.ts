import type {
  StoreHubChange,
} from "../features/store-hub/store-hub-client";
import {
  assertOrganizationScope,
  assertStoreScope,
} from "../features/security/local-scope-guard";
import { getTindioDatabase } from "./database";

export type StoreHubState = {
  organizationId: string;
  storeId: string;
  deviceId: string;
  hubUrl: string;
  pullCursor: number;
  lastContactAt: string | null;
  lastError: string | null;
};

type StateRow = {
  organization_id: string;
  store_id: string;
  device_id: string;
  hub_url: string;
  pull_cursor: number;
  last_contact_at: string | null;
  last_error: string | null;
};

type PeerEventRow = {
  device_id: string;
  cloud_synced_at: string | null;
  items_json: string;
  received_at: string;
};

function toState(row: StateRow): StoreHubState {
  return {
    organizationId: row.organization_id,
    storeId: row.store_id,
    deviceId: row.device_id,
    hubUrl: row.hub_url,
    pullCursor: row.pull_cursor,
    lastContactAt: row.last_contact_at,
    lastError: row.last_error,
  };
}

export async function getStoreHubState(input: {
  organizationId: string;
  storeId: string;
  deviceId: string;
}) {
  const row = await (await getTindioDatabase())
    .getFirstAsync<StateRow>(
      "SELECT * FROM store_hub_state WHERE organization_id=? AND store_id=? AND device_id=?",
      input.organizationId,
      input.storeId,
      input.deviceId,
    );

  return row ? toState(row) : null;
}

export async function saveStoreHubContact(input: {
  organizationId: string;
  storeId: string;
  deviceId: string;
  hubUrl: string;
  pullCursor: number;
  lastError: string | null;
}) {
  const now = new Date().toISOString();

  await (await getTindioDatabase()).runAsync(
    "INSERT INTO store_hub_state (organization_id,store_id,device_id,hub_url,pull_cursor,last_contact_at,last_error) VALUES (?,?,?,?,?,?,?) ON CONFLICT(organization_id,store_id,device_id) DO UPDATE SET hub_url=excluded.hub_url,pull_cursor=MAX(store_hub_state.pull_cursor,excluded.pull_cursor),last_contact_at=excluded.last_contact_at,last_error=excluded.last_error",
    input.organizationId,
    input.storeId,
    input.deviceId,
    input.hubUrl,
    input.pullCursor,
    now,
    input.lastError,
  );

  return now;
}

export async function recordStoreHubError(input: {
  organizationId: string;
  storeId: string;
  deviceId: string;
  hubUrl: string;
  error: string;
}) {
  const current = await getStoreHubState(input);

  await (await getTindioDatabase()).runAsync(
    "INSERT INTO store_hub_state (organization_id,store_id,device_id,hub_url,pull_cursor,last_contact_at,last_error) VALUES (?,?,?,?,?,?,?) ON CONFLICT(organization_id,store_id,device_id) DO UPDATE SET hub_url=excluded.hub_url,last_error=excluded.last_error",
    input.organizationId,
    input.storeId,
    input.deviceId,
    input.hubUrl,
    current?.pullCursor ?? 0,
    current?.lastContactAt ?? null,
    input.error.slice(0, 500),
  );
}

export async function applyStoreHubChanges(
  organizationId: string,
  storeId: string,
  changes: StoreHubChange[],
) {
  const database = await getTindioDatabase();
  const receivedAt = new Date().toISOString();

  await database.withExclusiveTransactionAsync(
    async (transaction) => {
      for (const change of changes) {
        assertOrganizationScope(
          organizationId,
          change.event.organizationId,
        );

        assertStoreScope(
          storeId,
          change.event.storeId,
        );

        await transaction.runAsync(
          "INSERT INTO store_hub_events (organization_id,store_id,event_id,device_id,device_sequence,hub_revision,event_type,created_at,cloud_synced_at,local_reference,items_json,received_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,store_id,event_id) DO UPDATE SET device_id=excluded.device_id,device_sequence=excluded.device_sequence,hub_revision=MAX(store_hub_events.hub_revision,excluded.hub_revision),event_type=excluded.event_type,created_at=excluded.created_at,cloud_synced_at=excluded.cloud_synced_at,local_reference=excluded.local_reference,items_json=excluded.items_json,received_at=excluded.received_at",
          organizationId,
          storeId,
          change.event.eventId,
          change.event.deviceId,
          change.event.deviceSequence,
          change.hubRevision,
          change.event.type,
          change.event.createdAt,
          change.event.cloudSyncedAt,
          change.event.localReference,
          JSON.stringify(change.event.items),
          receivedAt,
        );
      }
    },
  );
}

export async function getStoreHubPublishSignature(input: {
  organizationId: string;
  storeId: string;
  eventId: string;
}) {
  return (await getTindioDatabase()).getFirstAsync<{
    outbox_state: string;
    cloud_synced_at: string | null;
  }>(
    "SELECT outbox_state,cloud_synced_at FROM store_hub_publish_state WHERE organization_id=? AND store_id=? AND event_id=?",
    input.organizationId,
    input.storeId,
    input.eventId,
  );
}

export async function saveStoreHubPublishSignature(input: {
  organizationId: string;
  storeId: string;
  eventId: string;
  outboxState: string;
  cloudSyncedAt: string | null;
}) {
  await (await getTindioDatabase()).runAsync(
    "INSERT INTO store_hub_publish_state (organization_id,store_id,event_id,outbox_state,cloud_synced_at,published_at) VALUES (?,?,?,?,?,?) ON CONFLICT(organization_id,store_id,event_id) DO UPDATE SET outbox_state=excluded.outbox_state,cloud_synced_at=excluded.cloud_synced_at,published_at=excluded.published_at",
    input.organizationId,
    input.storeId,
    input.eventId,
    input.outboxState,
    input.cloudSyncedAt,
    new Date().toISOString(),
  );
}

export async function readPeerStoreLocalInventoryActivity(input: {
  organizationId: string;
  storeId: string;
  currentDeviceId: string;
  productId: string;
  variantId: string | null;
  baselineCheckedAt: string | null;
}) {
  const rows = await (await getTindioDatabase())
    .getAllAsync<PeerEventRow>(
      "SELECT device_id,cloud_synced_at,items_json,received_at FROM store_hub_events WHERE organization_id=? AND store_id=? AND device_id<>? AND event_type='SALE_COMPLETED'",
      input.organizationId,
      input.storeId,
      input.currentDeviceId,
    );

  const devices = new Set<string>();
  let quantity = 0;
  let affectingEvents = 0;
  let newestReceivedAt: string | null = null;

  for (const row of rows) {
    if (
      row.cloud_synced_at
      && input.baselineCheckedAt
      && row.cloud_synced_at <= input.baselineCheckedAt
    ) {
      continue;
    }

    let items: Array<{
      productId: string;
      variantId: string | null;
      quantity: number;
    }>;

    try {
      items = JSON.parse(row.items_json);
    } catch {
      continue;
    }

    const eventQuantity = items.reduce(
      (total, item) =>
        item.productId === input.productId
        && (item.variantId ?? "") === (input.variantId ?? "")
        && Number.isFinite(item.quantity)
        && item.quantity > 0
          ? total + item.quantity
          : total,
      0,
    );

    if (eventQuantity <= 0) continue;

    devices.add(row.device_id);
    quantity += eventQuantity;
    affectingEvents += 1;

    if (
      !newestReceivedAt
      || row.received_at > newestReceivedAt
    ) {
      newestReceivedAt = row.received_at;
    }
  }

  return {
    peerDeviceCount: devices.size,
    affectingEvents,
    activityDelta: -quantity,
    newestReceivedAt,
  };
}
