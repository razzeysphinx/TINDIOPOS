import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";

import { tindioTheme } from "./theme";

type TindioInputProps = TextInputProps & {
  error?: string;
  helperText?: string;
  label: string;
};

export function TindioInput({
  accessibilityLabel,
  editable = true,
  error,
  helperText,
  label,
  style,
  ...props
}: TindioInputProps) {
  const supportingText = error ?? helperText;

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled: !editable }}
        editable={editable}
        placeholderTextColor={tindioTheme.color.content.disabled}
        style={[styles.input, error ? styles.inputError : null, !editable ? styles.disabled : null, style]}
        {...props}
      />
      {supportingText ? (
        <Text accessibilityLiveRegion={error ? "polite" : undefined} style={error ? styles.error : styles.helper}>
          {supportingText}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: tindioTheme.space.xxs },
  label: { ...tindioTheme.typography.role.label, color: tindioTheme.color.content.primary },
  input: {
    ...tindioTheme.typography.role.body,
    backgroundColor: tindioTheme.color.surface.input,
    borderColor: tindioTheme.color.border.default,
    borderRadius: tindioTheme.radius.md,
    borderWidth: 1,
    color: tindioTheme.color.content.primary,
    minHeight: tindioTheme.target.minimum,
    paddingHorizontal: tindioTheme.space.sm,
    paddingVertical: tindioTheme.space.xs,
  },
  inputError: { borderColor: tindioTheme.color.status.danger.border },
  disabled: { backgroundColor: tindioTheme.color.surface.app, opacity: 0.64 },
  helper: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.content.secondary },
  error: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.status.danger.content },
});
