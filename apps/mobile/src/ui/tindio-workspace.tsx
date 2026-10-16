import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type PressableProps, type ViewProps } from "react-native";

import { tindioTheme } from "./theme";

type WorkspaceHeaderProps = {
  eyebrow?: string;
  title: string;
  description: string;
  trailing?: ReactNode;
};

export function TindioWorkspaceHeader({ description, eyebrow, title, trailing }: WorkspaceHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text accessibilityRole="header" style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
      {trailing}
    </View>
  );
}

type WorkspaceSectionProps = ViewProps & {
  children: ReactNode;
  description?: string;
  title: string;
};

export function TindioWorkspaceSection({ children, description, style, title, ...props }: WorkspaceSectionProps) {
  return (
    <View style={[styles.section, style]} {...props}>
      <View style={styles.sectionHeading}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
        {description ? <Text style={styles.sectionDescription}>{description}</Text> : null}
      </View>
      {children}
    </View>
  );
}

type ListItemProps = Omit<PressableProps, "children" | "style"> & {
  detail?: string;
  meta?: string;
  selected?: boolean;
  title: string;
};

export function TindioListItem({ detail, disabled, meta, onPress, selected = false, title, ...props }: ListItemProps) {
  const content = <ListItemContent detail={detail} meta={meta} title={title} />;

  if (!onPress) {
    return <View style={[styles.listItem, selected ? styles.listItemSelected : null, disabled ? styles.disabled : null]}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled), selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.listItem,
        selected ? styles.listItemSelected : null,
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
      {...props}
    >
      {content}
    </Pressable>
  );
}

function ListItemContent({ detail, meta, title }: { detail?: string; meta?: string; title: string }) {
  return (
    <>
      <View style={styles.listCopy}>
        <Text style={styles.listTitle}>{title}</Text>
        {detail ? <Text style={styles.listDetail}>{detail}</Text> : null}
      </View>
      {meta ? <Text style={styles.listMeta}>{meta}</Text> : null}
    </>
  );
}

export function TindioKeyValue({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.keyValue}>
      <Text style={styles.key}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: tindioTheme.space.md, justifyContent: "space-between" },
  headerCopy: { flex: 1, gap: tindioTheme.space.xxs, minWidth: 220 },
  eyebrow: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.brand.primary, letterSpacing: 1.2 },
  title: { ...tindioTheme.typography.role.display, color: tindioTheme.color.brand.ink },
  description: { ...tindioTheme.typography.role.body, color: tindioTheme.color.content.secondary, maxWidth: 680 },
  section: { gap: tindioTheme.space.sm },
  sectionHeading: { gap: tindioTheme.space.xxs },
  sectionTitle: { ...tindioTheme.typography.role.section, color: tindioTheme.color.content.primary },
  sectionDescription: { ...tindioTheme.typography.role.body, color: tindioTheme.color.content.secondary },
  listItem: { alignItems: "center", backgroundColor: tindioTheme.color.surface.card, borderColor: tindioTheme.color.border.default, borderRadius: tindioTheme.radius.md, borderWidth: 1, flexDirection: "row", gap: tindioTheme.space.md, justifyContent: "space-between", minHeight: tindioTheme.target.minimum, padding: tindioTheme.space.md },
  listItemSelected: { backgroundColor: tindioTheme.color.brand.cream, borderColor: tindioTheme.color.brand.primary },
  listCopy: { flex: 1, gap: tindioTheme.space.xxs },
  listTitle: { ...tindioTheme.typography.role.label, color: tindioTheme.color.content.primary },
  listDetail: { ...tindioTheme.typography.role.body, color: tindioTheme.color.content.secondary },
  listMeta: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.brand.primary, flexShrink: 1, textAlign: "right" },
  keyValue: { flexDirection: "row", flexWrap: "wrap", gap: tindioTheme.space.md, justifyContent: "space-between" },
  key: { ...tindioTheme.typography.role.body, color: tindioTheme.color.content.secondary },
  value: { ...tindioTheme.typography.role.label, color: tindioTheme.color.content.primary, flexShrink: 1, textAlign: "right" },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.48 },
});
