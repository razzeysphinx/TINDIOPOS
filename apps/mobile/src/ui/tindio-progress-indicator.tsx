import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { useTindioAccessibilityPreferences } from "./tindio-accessibility";
import { tindioTheme } from "./theme";

export function TindioProgressIndicator({ color, label }: { color?: string; label: string }) {
  const { reduceMotionEnabled } = useTindioAccessibilityPreferences();

  return (
    <View accessibilityLabel={label} accessibilityLiveRegion="polite" style={styles.container}>
      {reduceMotionEnabled
        ? <Text style={styles.label}>{label}</Text>
        : <ActivityIndicator color={color} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", justifyContent: "center", minHeight: tindioTheme.target.minimum },
  label: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.content.secondary, textAlign: "center" },
});
