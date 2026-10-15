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
        V1 supported hardware: this Android device&apos;s built-in camera for barcode scanning. Manual barcode and SKU entry does not require hardware.
      </Text>

      <Text>
        External scanners, receipt printers, cash drawers, customer displays, KDS transports, and payment terminals are not supported in the v1 release.
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
        Provider-specific printer, drawer, display, KDS, and payment-terminal transports are intentionally not faked. A future release must implement the adapter contract and pass physical release-binary certification before claiming support.
      </Text>
    </ScrollView>
  );
}
