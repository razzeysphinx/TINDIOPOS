import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { useBusinessContext } from "../../src/features/business/use-business-context";
import { useTerminalDevice } from "../../src/features/device/use-terminal-device";
import { fetchPosV2Live } from "../../src/lib/tindio-api";

export default function PosScreen() {
  const { data } = useBusinessContext();
  const core = data?.core;
  const terminal = useTerminalDevice(core?.organization.id);
  const [live, setLive] = useState<Record<string, unknown> | null>(null);
  const binding = terminal.identity?.binding;

  const matches =
    Boolean(core?.activeShift) &&
    Boolean(binding) &&
    core?.activeShift?.storeId === binding?.storeId &&
    core?.activeShift?.registerId === binding?.registerId;

  useEffect(() => {
    if (core && binding && matches) {
      void fetchPosV2Live(core.organization.id, binding).then((result) => {
        setLive(result as Record<string, unknown>);
      });
    }
  }, [core, binding, matches]);

  if (!core) {
    return <Text>Loading business context…</Text>;
  }

  if (!binding) {
    return <Text>Enroll or verify this terminal first.</Text>;
  }

  if (!matches) {
    return <Text>Open the shift for this terminal before starting POS.</Text>;
  }

  return (
    <View>
      <Text>POS terminal ready</Text>
      <Text>{core.organization.name}</Text>
      <Text>{core.employee.name}</Text>
      <Text>
        {binding.storeId} / {binding.registerId}
      </Text>
      <Text>Active shift: {core.activeShift?.id}</Text>
      <Text>Live context: {live ? "loaded" : "loading"}</Text>
    </View>
  );
}
