import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { tindioTheme } from "../../ui/theme";

type CashierTaskCardProps = { description: string; label: string; onPress: () => void; style?: StyleProp<ViewStyle> };

export function CashierTaskCard({ description, label, onPress, style }: CashierTaskCardProps) {
  return (
    <Pressable accessibilityHint={description} accessibilityLabel={label} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.card, pressed ? styles.pressed : null, style]}>
      <View style={styles.mark}><Text style={styles.markLabel}>{label.slice(0, 1)}</Text></View>
      <View style={styles.copy}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
      <Text accessibilityElementsHidden style={styles.arrow}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { ...tindioTheme.shadow.card, alignItems: "center", backgroundColor: tindioTheme.color.surface.card, borderColor: tindioTheme.color.border.default, borderRadius: tindioTheme.radius.lg, borderWidth: 1, flexDirection: "row", gap: tindioTheme.space.sm, minHeight: 88, padding: tindioTheme.space.md },
  pressed: { opacity: 0.82 },
  mark: { alignItems: "center", backgroundColor: tindioTheme.color.status.success.surface, borderRadius: tindioTheme.radius.md, height: 40, justifyContent: "center", width: 40 },
  markLabel: { ...tindioTheme.typography.role.section, color: tindioTheme.color.brand.primary },
  copy: { flex: 1, gap: tindioTheme.space.xxs },
  label: { ...tindioTheme.typography.role.section, color: tindioTheme.color.content.primary },
  description: { ...tindioTheme.typography.role.body, color: tindioTheme.color.content.secondary },
  arrow: { color: tindioTheme.color.brand.primary, fontSize: 30, lineHeight: 34 },
});
