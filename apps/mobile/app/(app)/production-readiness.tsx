import * as Application
  from "expo-application";
import {
  useState,
} from "react";
import {
  Pressable,
  ScrollView,
  Text,
} from "react-native";

import {
  getLocalSchemaVersion,
} from "../../src/db/database";
import {
  armAppUpgradeProof,
  verifyAppUpgradeProof,
} from "../../src/features/runtime/app-upgrade-proof";
import {
  useBusinessContext,
} from "../../src/features/business/use-business-context";

export default function ProductionReadinessScreen() {
  const {
    data,
  } = useBusinessContext();

  const organizationId =
    data?.core.organization.id;

  const [
    message,
    setMessage,
  ] = useState(
    "NOT CHECKED",
  );

  const arm = async () => {
    if (!organizationId) {
      return;
    }

    const proof =
      await armAppUpgradeProof(
        organizationId,
      );

    setMessage(
      `UPGRADE PROOF ARMED — ${proof.events.length} UNSYNCED EVENT(S) — SCHEMA ${proof.schemaVersion}`,
    );
  };

  const verify = async () => {
    if (!organizationId) {
      return;
    }

    const result =
      await verifyAppUpgradeProof(
        organizationId,
      );

    if (!result.ok) {
      setMessage(
        `UPGRADE PROOF FAILED — ${result.reason}${result.eventId ? ` — ${result.eventId}` : ""}`,
      );

      return;
    }

    setMessage(
      `UPGRADE PROOF PASS — ${result.proof.events.length} EVENT(S) PRESERVED — SCHEMA ${result.proof.schemaVersion} -> ${result.currentSchemaVersion}`,
    );
  };

  const showSchema =
    async () => {
      setMessage(
        `CURRENT SQLITE SCHEMA ${await getLocalSchemaVersion()}`,
      );
    };

  return (
    <ScrollView
      contentContainerStyle={{
        padding: 20,
        gap: 14,
      }}
    >
      <Text>
        ANDROID PRODUCTION HARDENING
      </Text>

      <Text>
        Package: com.tindio.pos
      </Text>

      <Text>
        App version: {Application.nativeApplicationVersion ?? "DEV"}
      </Text>

      <Text>
        Build version: {Application.nativeBuildVersion ?? "DEV"}
      </Text>

      <Text>
        Production updates use signed Google Play binary releases.
      </Text>

      <Text>
        App updates must not destroy locally accepted unsynced transactions.
      </Text>

      <Pressable
        onPress={() =>
          void arm()
        }
      >
        <Text>
          Arm upgrade preservation proof
        </Text>
      </Pressable>

      <Pressable
        onPress={() =>
          void verify()
        }
      >
        <Text>
          Verify upgrade preservation proof
        </Text>
      </Pressable>

      <Pressable
        onPress={() =>
          void showSchema()
        }
      >
        <Text>
          Show SQLite schema version
        </Text>
      </Pressable>

      <Text>
        {message}
      </Text>
    </ScrollView>
  );
}