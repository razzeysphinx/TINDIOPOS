import type {
  StoreHubChange,
} from "../features/store-hub/store-hub-client";
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
        if (
          change.event.organizationId !== organizationId
          || change.event.storeId !== storeId
        ) {
          throw new Error("STORE_HUB_SCOPE_MISMATCH");
        }

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
