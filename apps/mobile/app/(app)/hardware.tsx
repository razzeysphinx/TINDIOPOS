import {
  ScrollView,
  Text,
  View,
} from "react-native";

import {
  hardwareCapabilityMatrix,
} from "../../src/features/hardware/hardware-contracts";

export default function HardwareScreen() {
  return (
    <ScrollView
      contentContainerStyle={{
        padding: 20,
        gap: 14,
      }}
    >
      <Text>
        NATIVE POS HARDWARE
      </Text>

      <Text>
        Hardware adapters are isolated from transaction authority.
      </Text>

      <Text>
        A hardware failure may fail that hardware action, but it must never duplicate, erase, or roll back a TINDIO transaction.
      </Text>

      {hardwareCapabilityMatrix.map(
        (item) => (
          <View
            key={item.capability}
            style={{
              gap: 4,
            }}
          >
            <Text>
              {item.capability}
            </Text>

            <Text>
              Support: {item.support}
            </Text>

            <Text>
              Role: {item.transactionRole}
            </Text>

            <Text>
              {item.note}
            </Text>
          </View>
        ),
      )}

      <Text>
        Provider-specific printer, drawer, display, KDS, and payment-terminal transports are intentionally not faked. They must implement the hardware adapter contracts without entering TINDIO business/domain logic.
      </Text>
    </ScrollView>
  );
}