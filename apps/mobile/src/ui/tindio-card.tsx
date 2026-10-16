import type { ReactNode } from "react";
import { StyleSheet, Text, View, type ViewProps } from "react-native";

import { tindioTheme } from "./theme";

type TindioCardProps = ViewProps & {
  children: ReactNode;
  description?: string;
  title?: string;
};

export function TindioCard({ children, description, style, title, ...props }: TindioCardProps) {
  return (
    <View style={[styles.card, style]} {...props}>
      {title ? <Text accessibilityRole="header" style={styles.title}>{title}</Text> : null}
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...tindioTheme.shadow.card,
    backgroundColor: tindioTheme.color.surface.card,
    borderColor: tindioTheme.color.border.default,
    borderRadius: tindioTheme.radius.lg,
    borderWidth: 1,
    gap: tindioTheme.space.sm,
    padding: tindioTheme.space.md,
  },
  title: { ...tindioTheme.typography.role.section, color: tindioTheme.color.content.primary },
  description: { ...tindioTheme.typography.role.body, color: tindioTheme.color.content.secondary },
});
