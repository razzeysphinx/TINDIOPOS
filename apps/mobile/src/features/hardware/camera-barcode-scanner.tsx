import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { TindioButton } from "../../ui/tindio-button";
import { TindioFeedback } from "../../ui/tindio-feedback";
import { TindioScreen } from "../../ui/tindio-screen";
import { tindioTheme } from "../../ui/theme";
import { createBarcodeScanGuard } from "./barcode-scan-guard";

export function CameraBarcodeScanner({ onScanned, onClose }: { onScanned(barcode: string): void | Promise<void>; onClose(): void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  const scanGuard = useRef(createBarcodeScanGuard()).current;

  if (!permission) {
    return <TindioScreen contentContainerStyle={styles.centered}><TindioFeedback description="Checking whether this device can use its camera." kind="loading" title="Opening scanner" /></TindioScreen>;
  }

  if (!permission.granted) {
    return (
      <TindioScreen contentContainerStyle={styles.centered}>
        <TindioFeedback description="Camera access is used only to scan product barcodes. Manual barcode and SKU entry remains available in the POS." kind="restriction" title="Camera access needed" />
        <TindioButton onPress={() => void requestPermission()}>Allow camera</TindioButton>
        <TindioButton onPress={onClose} variant="ghost">Back to POS — Enter code manually</TindioButton>
      </TindioScreen>
    );
  }

  return (
    <View style={styles.scanner} testID="camera-barcode-scanner">
      <CameraView
        barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128", "code39", "qr"] }}
        facing="back"
        onBarcodeScanned={locked ? undefined : ({ data }) => {
          const value = data.trim();
          if (!value || !scanGuard.tryAcquire()) return;
          setLocked(true);
          void Promise.resolve().then(() => onScanned(value)).finally(() => { scanGuard.release(); setLocked(false); });
        }}
        style={styles.camera}
      />
      <View style={styles.guide} pointerEvents="none"><View style={styles.guideFrame} /></View>
      <View style={styles.controls}>
        <Text accessibilityLiveRegion="polite" style={styles.instructions}>{locked ? "Barcode found. Adding item…" : "Hold a product barcode inside the frame."}</Text>
        <TindioButton onPress={onClose} variant="secondary">Cancel scanner</TindioButton>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { justifyContent: "center" },
  scanner: { backgroundColor: tindioTheme.color.brand.ink, flex: 1, minHeight: 480 },
  camera: { flex: 1 },
  guide: { alignItems: "center", bottom: 140, justifyContent: "center", left: 0, position: "absolute", right: 0, top: 0 },
  guideFrame: { borderColor: tindioTheme.color.content.inverse, borderRadius: tindioTheme.radius.lg, borderWidth: 3, height: 180, width: "78%" },
  controls: { backgroundColor: tindioTheme.color.surface.card, gap: tindioTheme.space.sm, padding: tindioTheme.space.md },
  instructions: { ...tindioTheme.typography.role.body, color: tindioTheme.color.content.primary, textAlign: "center" },
});
