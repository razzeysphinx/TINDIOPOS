import { StyleSheet, Text, View, type ViewProps } from "react-native";

import type { TindioStatusTone } from "../../../../src/contracts/ui/tindio-design-tokens";
import { tindioTheme } from "./theme";

type TindioStatusBadgeProps = ViewProps & {
  label: string;
  tone: TindioStatusTone;
};

export function TindioStatusBadge({ label, style, tone, ...props }: TindioStatusBadgeProps) {
  const colors = tindioTheme.color.status[tone];

  return (
    <View
      accessibilityLabel={label}
      style={[styles.badge, { backgroundColor: colors.surface, borderColor: colors.border }, style]}
      {...props}
    >
      <View accessibilityElementsHidden style={[styles.dot, { backgroundColor: colors.content }]} />
      <Text style={[styles.label, { color: colors.content }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: tindioTheme.radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: tindioTheme.space.xs,
    minHeight: 32,
    paddingHorizontal: tindioTheme.space.sm,
    paddingVertical: tindioTheme.space.xxs,
  },
  dot: { borderRadius: tindioTheme.radius.pill, height: 8, width: 8 },
  label: { ...tindioTheme.typography.role.caption, flexShrink: 1 },
});
