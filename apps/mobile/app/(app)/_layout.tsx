import {
  Redirect,
  Stack,
} from "expo-router";
import {
  ActivityIndicator,
  View,
} from "react-native";

import {
  BusinessContextProvider,
} from "../../src/features/business/business-context-provider";
import {
  useSession,
} from "../../src/features/session/session-provider";
import {
  SyncTelemetryReporter,
} from "../../src/features/sync/sync-telemetry-reporter";
import { ProductionResponsivenessMonitor } from "../../src/features/observability/production-responsiveness-monitor";

export default function AppLayout() {
  const {
    loading,
    accessMode,
  } = useSession();

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator />
      </View>
    );
  }

  if (
    accessMode !== "online"
    && accessMode !== "offline"
  ) {
    return (
      <Redirect href="/sign-in" />
    );
  }

  return (
    <BusinessContextProvider>
      <ProductionResponsivenessMonitor />
      <SyncTelemetryReporter />

      <Stack
        screenOptions={{
          headerShown: false,
        }}
      />
    </BusinessContextProvider>
  );
}
