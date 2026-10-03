import {
  CameraView,
  useCameraPermissions,
} from "expo-camera";
import {
  useState,
} from "react";
import {
  Pressable,
  Text,
  View,
} from "react-native";

export function CameraBarcodeScanner({
  onScanned,
  onClose,
}: {
  onScanned(
    barcode: string,
  ): void | Promise<void>;
  onClose(): void;
}) {
  const [
    permission,
    requestPermission,
  ] = useCameraPermissions();

  const [
    locked,
    setLocked,
  ] = useState(false);

  if (!permission) {
    return (
      <View
        style={{
          flex: 1,
          padding: 20,
          justifyContent: "center",
          gap: 12,
        }}
      >
        <Text>
          Checking camera permission…
        </Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View
        style={{
          flex: 1,
          padding: 20,
          justifyContent: "center",
          gap: 12,
        }}
      >
        <Text>
          Camera permission is required only for camera barcode scanning.
        </Text>

        <Pressable
          onPress={() =>
            void requestPermission()
          }
        >
          <Text>
            Allow camera
          </Text>
        </Pressable>

        <Pressable
          onPress={onClose}
        >
          <Text>
            Back to POS
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        minHeight: 480,
      }}
    >
      <CameraView
        style={{
          flex: 1,
        }}
        facing="back"
        barcodeScannerSettings={{
          barcodeTypes: [
            "ean13",
            "ean8",
            "upc_a",
            "upc_e",
            "code128",
            "code39",
            "qr",
          ],
        }}
        onBarcodeScanned={
          locked
            ? undefined
            : ({ data }) => {
                const value =
                  data.trim();

                if (!value) {
                  return;
                }

                setLocked(true);

                void Promise.resolve(
                  onScanned(value),
                ).finally(() => {
                  setLocked(false);
                });
              }
        }
      />

      <View
        style={{
          padding: 16,
          gap: 10,
        }}
      >
        <Text>
          Point the camera at a product barcode.
        </Text>

        <Pressable
          onPress={onClose}
        >
          <Text>
            Cancel scanner
          </Text>
        </Pressable>
      </View>
    </View>
  );
}