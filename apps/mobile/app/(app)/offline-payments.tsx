import {
  ScrollView,
  Text,
  View,
} from "react-native";

import {
  hasOfflinePaymentProvider,
  listOfflinePaymentProviders,
} from "../../src/features/payments/offline-payment-provider-registry";
import {
  failClosedOfflineElectronicPolicy,
} from "../../src/features/payments/offline-payment-risk";

export default function OfflinePaymentsScreen() {
  const providers =
    listOfflinePaymentProviders();

  const providerAvailable =
    hasOfflinePaymentProvider();

  return (
    <ScrollView
      contentContainerStyle={{
        padding: 20,
        gap: 14,
      }}
    >
      <Text>
        OFFLINE PAYMENTS + RISK ENGINE
      </Text>

      <View
        style={{
          gap: 5,
        }}
      >
        <Text>
          Offline cash: ENABLED THROUGH EXISTING DURABLE CASH FLOW
        </Text>

        <Text>
          Electronic offline payments: {providerAvailable ? "PROVIDER AVAILABLE" : "DISABLED — NO COMPLIANT PSP STORE-AND-FORWARD ADAPTER"}
        </Text>

        <Text>
          Registered offline electronic providers: {providers.length}
        </Text>
      </View>

      <Text>
        TINDIO never stores raw card credentials to simulate offline card acceptance.
      </Text>

      <Text>
        Electronic offline payment can only become available when a real PSP/terminal adapter explicitly supports compliant store-and-forward.
      </Text>

      <Text>
        Default electronic policy: {failClosedOfflineElectronicPolicy.electronicOfflineAllowed ? "ENABLED" : "FAIL CLOSED"}
      </Text>

      <Text>
        Risk controls supported by the engine:
      </Text>

      <Text>
        • maximum transaction amount
      </Text>

      <Text>
        • maximum total offline exposure
      </Text>

      <Text>
        • maximum offline duration
      </Text>

      <Text>
        • manager approval threshold
      </Text>

      <Text>
        No provider-specific electronic offline payment is enabled in this build.
      </Text>
    </ScrollView>
  );
}