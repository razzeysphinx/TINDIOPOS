import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { tindioTheme } from "./theme";

export type TindioButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

type TindioButtonProps = Omit<PressableProps, "children" | "style"> & {
  busy?: boolean;
  children: string;
  style?: StyleProp<ViewStyle>;
  variant?: TindioButtonVariant;
};

export function TindioButton({
  accessibilityLabel,
  accessibilityState,
  busy = false,
  children,
  disabled = false,
  style,
  variant = "primary",
  ...props
}: TindioButtonProps) {
  const unavailable = disabled || busy;
  const palette = buttonPalettes[variant];

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ ...accessibilityState, busy, disabled: unavailable }}
      disabled={unavailable}
      style={({ pressed }) => [
        styles.base,
        palette.container,
        pressed && !unavailable ? styles.pressed : null,
        unavailable ? styles.disabled : null,
        style,
      ]}
      {...props}
    >
      {busy ? <ActivityIndicator color={palette.label.color} /> : null}
      <Text style={[styles.label, palette.label]}>{children}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    borderRadius: tindioTheme.radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: tindioTheme.space.xs,
    justifyContent: "center",
    minHeight: tindioTheme.target.minimum,
    paddingHorizontal: tindioTheme.space.md,
    paddingVertical: tindioTheme.space.sm,
  },
  label: {
    ...tindioTheme.typography.role.label,
    flexShrink: 1,
    textAlign: "center",
  },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.48 },
});

const buttonPalettes = {
  primary: StyleSheet.create({
    container: { backgroundColor: tindioTheme.color.brand.primary, borderColor: tindioTheme.color.brand.primary },
    label: { color: tindioTheme.color.content.inverse },
  }),
  secondary: StyleSheet.create({
    container: { backgroundColor: tindioTheme.color.status.success.surface, borderColor: tindioTheme.color.border.default },
    label: { color: tindioTheme.color.brand.ink },
  }),
  ghost: StyleSheet.create({
    container: { backgroundColor: "transparent", borderColor: "transparent" },
    label: { color: tindioTheme.color.brand.primary },
  }),
  destructive: StyleSheet.create({
    container: { backgroundColor: tindioTheme.color.status.danger.surface, borderColor: tindioTheme.color.status.danger.border },
    label: { color: tindioTheme.color.status.danger.content },
  }),
} as const;
