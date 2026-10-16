import "react-native-url-polyfill/auto";

import {
  Stack,
} from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  ProductionErrorBoundary,
} from "../src/features/runtime/production-error-boundary";
import {
  SessionProvider,
} from "../src/features/session/session-provider";
import { TindioAccessibilityProvider } from "../src/ui/tindio-accessibility";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <TindioAccessibilityProvider>
        <ProductionErrorBoundary>
          <SessionProvider>
            <Stack
              screenOptions={{
                headerShown: false,
              }}
            />
          </SessionProvider>
        </ProductionErrorBoundary>
      </TindioAccessibilityProvider>
    </SafeAreaProvider>
  );
}
