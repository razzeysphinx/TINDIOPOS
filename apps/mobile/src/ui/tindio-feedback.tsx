import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View, type ViewProps } from "react-native";

import type { TindioStatusTone } from "../../../../src/contracts/ui/tindio-design-tokens";
import { tindioTheme } from "./theme";

export type TindioFeedbackKind = "loading" | "empty" | "error" | "restriction" | "recovery" | "review";

type TindioFeedbackProps = ViewProps & {
  action?: ReactNode;
  description: string;
  kind: TindioFeedbackKind;
  title: string;
};

const toneByKind: Record<TindioFeedbackKind, TindioStatusTone> = {
  loading: "information",
  empty: "information",
  error: "danger",
  restriction: "warning",
  recovery: "recovering",
  review: "review",
};

export function TindioFeedback({ action, description, kind, style, title, ...props }: TindioFeedbackProps) {
  const colors = tindioTheme.color.status[toneByKind[kind]];
  const isAlert = kind === "error" || kind === "restriction" || kind === "review";

  return (
    <View
      accessibilityLiveRegion={kind === "loading" || kind === "recovery" ? "polite" : undefined}
      accessibilityRole={isAlert ? "alert" : undefined}
      style={[styles.container, { backgroundColor: colors.surface, borderColor: colors.border }, style]}
      {...props}
    >
      {kind === "loading" || kind === "recovery" ? <ActivityIndicator color={colors.content} /> : null}
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.content }]}>{title}</Text>
        <Text style={[styles.description, { color: colors.content }]}>{description}</Text>
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "flex-start",
    borderRadius: tindioTheme.radius.md,
    borderWidth: 1,
    gap: tindioTheme.space.sm,
    padding: tindioTheme.space.md,
  },
  copy: { gap: tindioTheme.space.xxs },
  title: { ...tindioTheme.typography.role.label },
  description: { ...tindioTheme.typography.role.body },
});
