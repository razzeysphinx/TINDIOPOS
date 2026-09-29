import {
  readLocalMetadata,
  writeLocalMetadata,
} from "../../db/database";

export type PersistedConnectionMode =
  | "CLOUD_ONLINE"
  | "STORE_LOCAL"
  | "DEVICE_ISOLATED"
  | "RECOVERING"
  | "SYNC_REVIEW";

export type ConnectionModeState = {
  mode: PersistedConnectionMode;
  changedAt: string;
};

const key = (organizationId: string) =>
  `connection_mode:${organizationId}`;

export async function readConnectionModeState(
  organizationId: string,
): Promise<ConnectionModeState | null> {
  const row = await readLocalMetadata(
    key(organizationId),
  );

  if (!row) return null;

  try {
    const parsed = JSON.parse(
      row.value,
    ) as ConnectionModeState;

    if (
      ![
        "CLOUD_ONLINE",
        "STORE_LOCAL",
        "DEVICE_ISOLATED",
        "RECOVERING",
        "SYNC_REVIEW",
      ].includes(parsed.mode)
      || !Number.isFinite(
        Date.parse(parsed.changedAt),
      )
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export async function writeConnectionModeState(
  organizationId: string,
  mode: PersistedConnectionMode,
) {
  const state: ConnectionModeState = {
    mode,
    changedAt: new Date().toISOString(),
  };

  await writeLocalMetadata(
    key(organizationId),
    JSON.stringify(state),
  );

  return state;
}
