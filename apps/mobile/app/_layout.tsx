import "react-native-url-polyfill/auto";

import {
  Stack,
} from "expo-router";

import {
  ProductionErrorBoundary,
} from "../src/features/runtime/production-error-boundary";
import {
  SessionProvider,
} from "../src/features/session/session-provider";

export default function RootLayout() {
  return (
    <ProductionErrorBoundary>
      <SessionProvider>
        <Stack
          screenOptions={{
            headerShown: false,
          }}
        />
      </SessionProvider>
    </ProductionErrorBoundary>
  );
}