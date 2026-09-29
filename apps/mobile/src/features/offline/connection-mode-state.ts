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
  offlineSince: string | null;
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
    ) as Partial<ConnectionModeState>;

    if (
      ![
        "CLOUD_ONLINE",
        "STORE_LOCAL",
        "DEVICE_ISOLATED",
        "RECOVERING",
        "SYNC_REVIEW",
      ].includes(parsed.mode ?? "")
      || !parsed.changedAt
      || !Number.isFinite(
        Date.parse(parsed.changedAt),
      )
    ) {
      return null;
    }

    return {
      mode:
        parsed.mode
        as PersistedConnectionMode,
      changedAt:
        parsed.changedAt,
      offlineSince:
        parsed.offlineSince
        && Number.isFinite(
          Date.parse(
            parsed.offlineSince,
          ),
        )
          ? parsed.offlineSince
          : (
              parsed.mode === "CLOUD_ONLINE"
                ? null
                : parsed.changedAt
            ),
    };
  } catch {
    return null;
  }
}

export async function writeConnectionModeState(
  organizationId: string,
  mode: PersistedConnectionMode,
) {
  const previous =
    await readConnectionModeState(
      organizationId,
    );

  const now =
    new Date().toISOString();

  const offlineSince =
    mode === "CLOUD_ONLINE"
      ? null
      : previous?.offlineSince
        ?? (
          previous?.mode
          && previous.mode !== "CLOUD_ONLINE"
            ? previous.changedAt
            : now
        );

  const state: ConnectionModeState = {
    mode,
    changedAt: now,
    offlineSince,
  };

  await writeLocalMetadata(
    key(organizationId),
    JSON.stringify(state),
  );

  return state;
}
