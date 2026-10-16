import {
  Redirect,
  Stack,
  usePathname,
} from "expo-router";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  BusinessContextProvider,
} from "../../src/features/business/business-context-provider";
import {
  useBusinessContext,
} from "../../src/features/business/use-business-context";
import {
  useSession,
} from "../../src/features/session/session-provider";
import {
  SyncTelemetryReporter,
} from "../../src/features/sync/sync-telemetry-reporter";
import { ProductionResponsivenessMonitor } from "../../src/features/observability/production-responsiveness-monitor";
import { TindioProgressIndicator } from "../../src/ui/tindio-progress-indicator";

const authorizedSupportPaths = new Set([
  "/a45-certification",
  "/hardware",
  "/offline-payments",
  "/production-readiness",
]);

function AuthorizedAppStack() {
  const pathname = usePathname();
  const { data, loading } = useBusinessContext();
  const requiresSupportAccess =
    authorizedSupportPaths.has(pathname);
  const hasSupportAccess = Boolean(
    data?.core.permissions.includes("devices.manage")
    || data?.core.permissions.includes("settings.manage"),
  );

  if (requiresSupportAccess && loading) {
    return (
      <View
        accessibilityLabel="Checking support access"
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <TindioProgressIndicator label="Checking support access" />
      </View>
    );
  }

  if (requiresSupportAccess && !hasSupportAccess) {
    return <Redirect href="/(app)" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    />
  );
}

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
        <TindioProgressIndicator label="Opening cashier workspace" />
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
      <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1 }}>
        <AuthorizedAppStack />
      </SafeAreaView>
    </BusinessContextProvider>
  );
}
