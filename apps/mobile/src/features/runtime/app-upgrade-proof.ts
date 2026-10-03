import * as Application
  from "expo-application";
import * as Crypto
  from "expo-crypto";

import {
  getTindioDatabase,
  getLocalSchemaVersion,
  readLocalMetadata,
  writeLocalMetadata,
} from "../../db/database";

type EventRow = {
  event_id: string;
  idempotency_key: string;
  device_sequence: number;
  payload_json: string;
  snapshot_json: string;
};

type ProofEvent = {
  eventId: string;
  idempotencyKey: string;
  deviceSequence: number;
  contentDigest: string;
};

export type AppUpgradeProof = {
  organizationId: string;
  armedAt: string;
  applicationVersion:
    string | null;
  nativeBuildVersion:
    string | null;
  schemaVersion: number;
  events: ProofEvent[];
};

export type AppUpgradeVerification =
  | {
      ok: true;
      proof: AppUpgradeProof;
      currentApplicationVersion:
        string | null;
      currentNativeBuildVersion:
        string | null;
      currentSchemaVersion: number;
    }
  | {
      ok: false;
      reason:
        | "NOT_ARMED"
        | "EVENT_MISSING"
        | "EVENT_IDENTITY_CHANGED"
        | "EVENT_CONTENT_CHANGED"
        | "INVALID_PROOF";
      eventId?: string;
    };

const key = (
  organizationId: string,
) =>
  `phase23_upgrade_proof:${organizationId}`;

async function digestEvent(
  row: EventRow,
) {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm
      .SHA256,
    [
      row.payload_json,
      row.snapshot_json,
    ].join("\n"),
  );
}

export async function armAppUpgradeProof(
  organizationId: string,
): Promise<AppUpgradeProof> {
  const database =
    await getTindioDatabase();

  const rows =
    await database
      .getAllAsync<EventRow>(
        `SELECT
          event_id,
          idempotency_key,
          device_sequence,
          payload_json,
          snapshot_json
        FROM outbox_events
        WHERE organization_id=?
          AND state<>'SYNCED'
        ORDER BY device_sequence ASC,
                 event_id ASC`,
        organizationId,
      );

  const events:
    ProofEvent[] = [];

  for (const row of rows) {
    events.push({
      eventId:
        row.event_id,
      idempotencyKey:
        row.idempotency_key,
      deviceSequence:
        row.device_sequence,
      contentDigest:
        await digestEvent(row),
    });
  }

  const proof:
    AppUpgradeProof = {
      organizationId,
      armedAt:
        new Date()
          .toISOString(),
      applicationVersion:
        Application
          .nativeApplicationVersion,
      nativeBuildVersion:
        Application
          .nativeBuildVersion,
      schemaVersion:
        await getLocalSchemaVersion(),
      events,
    };

  await writeLocalMetadata(
    key(organizationId),
    JSON.stringify(proof),
  );

  return proof;
}

export async function verifyAppUpgradeProof(
  organizationId: string,
): Promise<AppUpgradeVerification> {
  const saved =
    await readLocalMetadata(
      key(organizationId),
    );

  if (!saved) {
    return {
      ok: false,
      reason: "NOT_ARMED",
    };
  }

  let proof:
    AppUpgradeProof;

  try {
    proof =
      JSON.parse(
        saved.value,
      ) as AppUpgradeProof;
  } catch {
    return {
      ok: false,
      reason:
        "INVALID_PROOF",
    };
  }

  if (
    proof.organizationId
      !== organizationId
    || !Array.isArray(
      proof.events,
    )
  ) {
    return {
      ok: false,
      reason:
        "INVALID_PROOF",
    };
  }

  const database =
    await getTindioDatabase();

  for (
    const expected
    of proof.events
  ) {
    const row =
      await database
        .getFirstAsync<EventRow>(
          `SELECT
            event_id,
            idempotency_key,
            device_sequence,
            payload_json,
            snapshot_json
          FROM outbox_events
          WHERE organization_id=?
            AND event_id=?
          LIMIT 1`,
          organizationId,
          expected.eventId,
        );

    if (!row) {
      return {
        ok: false,
        reason:
          "EVENT_MISSING",
        eventId:
          expected.eventId,
      };
    }

    if (
      row.idempotency_key
        !== expected
          .idempotencyKey
      || row.device_sequence
        !== expected
          .deviceSequence
    ) {
      return {
        ok: false,
        reason:
          "EVENT_IDENTITY_CHANGED",
        eventId:
          expected.eventId,
      };
    }

    if (
      await digestEvent(row)
      !== expected.contentDigest
    ) {
      return {
        ok: false,
        reason:
          "EVENT_CONTENT_CHANGED",
        eventId:
          expected.eventId,
      };
    }
  }

  return {
    ok: true,
    proof,
    currentApplicationVersion:
      Application
        .nativeApplicationVersion,
    currentNativeBuildVersion:
      Application
        .nativeBuildVersion,
    currentSchemaVersion:
      await getLocalSchemaVersion(),
  };
}