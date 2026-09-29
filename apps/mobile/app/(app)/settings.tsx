import { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
} from "react-native";
import { useBusinessContext } from "../../src/features/business/use-business-context";
import { useTerminalDevice } from "../../src/features/device/use-terminal-device";
import { useSession } from "../../src/features/session/session-provider";
import {
  clearStoreHubConfig,
  readStoreHubConfig,
  saveStoreHubConfig,
} from "../../src/features/store-hub/store-hub-config";
import { probeStoreHub } from "../../src/features/store-hub/store-hub-client";
import { canReleaseTransactionCustody } from "../../src/features/offline/transaction-custody";

export default function SettingsScreen() {
  const { data } = useBusinessContext();
  const { signOut } = useSession();
  const core = data?.core;
  const terminal = useTerminalDevice(
    core?.organization.id,
  );
  const binding = terminal.identity?.binding;

  const [endpoint, setEndpoint] = useState("");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!core) return;

    let active = true;

    void readStoreHubConfig(
      core.organization.id,
    ).then((config) => {
      if (!active || !config) return;
      setEndpoint(config.endpoint);
      setMessage("Store Hub token is securely stored.");
    });

    return () => {
      active = false;
    };
  }, [core]);

  if (!core) return <Text>Loadingâ€¦</Text>;

  const saveHub = async () => {
    if (!binding) return;

    try {
      await saveStoreHubConfig({
        organizationId: core.organization.id,
        storeId: binding.storeId,
        endpoint,
        token,
      });

      setToken("");
      setMessage("Store Hub configuration saved securely.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Store Hub configuration failed.",
      );
    }
  };

  const testHub = async () => {
    if (!binding) return;

    const result = await probeStoreHub({
      organizationId: core.organization.id,
      storeId: binding.storeId,
    });

    setMessage(
      result.ok
        ? `STORE LOCAL HUB READY â€” revision ${result.currentRevision}`
        : `Store Hub unavailable: ${result.reason}`,
    );
  };

  const clearHub = async () => {
    const custody = await canReleaseTransactionCustody(
      core.organization.id,
    );

    if (!custody.ok) {
      setMessage(
        `${custody.message} Store Hub configuration is being retained as a recovery path.`,
      );
      return;
    }

    await clearStoreHubConfig(
      core.organization.id,
    );
    setEndpoint("");
    setToken("");
    setMessage("Store Hub configuration removed.");
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Text>Settings</Text>
      <Text>{core.organization.name}</Text>
      <Text>{core.employee.name}</Text>
      <Text>{core.roleNames.join(", ")}</Text>
      <Text>
        {binding
          ? `Device ready: ${binding.storeId} / ${binding.registerId}`
          : "Device missing"}
      </Text>
      <Text>{binding?.appVersion ?? ""}</Text>
      <Text>{terminal.identity?.lastVerifiedAt ?? ""}</Text>

      <Text>STORE HUB â€” PRIVATE LAN ONLY</Text>

      <TextInput
        value={endpoint}
        onChangeText={setEndpoint}
        placeholder="http://192.168.1.10:8787"
        autoCapitalize="none"
      />

      <TextInput
        value={token}
        onChangeText={setToken}
        placeholder="Enter/re-enter 32+ character Store Hub token"
        autoCapitalize="none"
        secureTextEntry
      />

      <Pressable
        disabled={!binding || !endpoint || token.length < 32}
        onPress={() => void saveHub()}
      >
        <Text>Save Store Hub</Text>
      </Pressable>

      <Pressable
        disabled={!binding}
        onPress={() => void testHub()}
      >
        <Text>Test Store Hub</Text>
      </Pressable>

      <Pressable
        onPress={() => void clearHub()}
      >
        <Text>Remove Store Hub</Text>
      </Pressable>

      <Text>{message}</Text>

      <Pressable
        onPress={() => void signOut().then((result) => {
          if (!result.ok) setMessage(result.message);
        })}
      >
        <Text>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}
