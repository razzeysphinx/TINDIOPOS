import { Pressable, StyleSheet, Text, View } from "react-native";

import { TindioButton } from "../../ui/tindio-button";
import { tindioTheme } from "../../ui/theme";
import { useTindioResponsiveLayout } from "../../ui/tindio-responsive";

type CashierRegisterHeaderProps = {
  employeeName: string;
  itemCount?: number;
  mode: "online" | "offline";
  organizationName: string;
  shiftOpen: boolean;
  onMenu(): void;
};

export function CashierRegisterHeader({
  employeeName,
  itemCount = 0,
  mode,
  organizationName,
  shiftOpen,
  onMenu,
}: CashierRegisterHeaderProps) {
  const { viewportClass } = useTindioResponsiveLayout();
  const phone = viewportClass === "compact-phone" || viewportClass === "standard-phone";
  const compactPhone = viewportClass === "compact-phone";

  return (
    <View style={[styles.header, compactPhone ? styles.headerCompact : null]} testID="cashier-register-header">
      <Pressable
        accessibilityLabel="Open POS menu"
        accessibilityRole="button"
        onPress={onMenu}
        style={({ pressed }) => [styles.menuButton, pressed ? styles.pressed : null]}
      >
        <Text style={styles.menuGlyph}>≡</Text>
      </Pressable>

      {shiftOpen ? (
        <View style={styles.ticketCopy}>
          <Text numberOfLines={1} style={styles.ticketTitle}>Ticket · {formatItemCount(itemCount)}</Text>
          <Text numberOfLines={1} style={styles.headerMeta}>{organizationName} · {employeeName}</Text>
        </View>
      ) : <View style={styles.headerSpacer} />}

      <View style={[styles.identity, phone ? styles.identityPhone : null]}>
        {!phone ? (
          <View accessibilityElementsHidden style={styles.brandMark}>
            <Text style={styles.brandMarkLabel}>T</Text>
          </View>
        ) : null}
        <View style={styles.identityCopy}>
          <Text numberOfLines={1} style={styles.identityTitle}>
            {phone && shiftOpen ? (mode === "online" ? "Online" : "Offline") : "TINDIO POS"}
          </Text>
          {(!phone || !shiftOpen) && !compactPhone ? (
            <Text numberOfLines={1} style={styles.headerMeta}>
              {shiftOpen ? `${mode === "online" ? "Online" : "Offline"} · ${employeeName}` : `${organizationName} · Register entry`}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

type CashierShiftGateProps = {
  canOpenShift: boolean;
  conflict: boolean;
  mode: "online" | "offline";
  registerName: string;
  storeName: string;
  onOpenShift(): void;
};

export function CashierShiftGate({
  canOpenShift,
  conflict,
  mode,
  registerName,
  storeName,
  onOpenShift,
}: CashierShiftGateProps) {
  const { viewportClass } = useTindioResponsiveLayout();
  const phone = viewportClass === "compact-phone" || viewportClass === "standard-phone";
  const available = canOpenShift && mode === "online";
  const restriction = conflict
    ? "An open shift belongs to another register. Return to shift controls to restore the assigned register."
    : mode === "offline"
      ? "Reconnect before opening this register. Saved receipts remain available while offline."
      : "Your role needs shift-opening permission before this POS can be used.";

  return (
    <View style={[styles.gate, phone ? styles.gatePhone : null]} testID="cashier-shift-gate">
      <View accessibilityElementsHidden style={styles.lockTile}>
        <View style={styles.lockShackle} />
        <View style={styles.lockBody}><View style={styles.lockKeyhole} /></View>
      </View>
      <Text style={styles.gateEyebrow}>{conflict ? "REGISTER LOCKED" : "SHIFT CLOSED"}</Text>
      <Text accessibilityRole="header" style={styles.gateTitle}>
        {conflict ? "Restore this register to start selling" : "Open a register shift to start selling"}
      </Text>
      <Text style={styles.gateDescription}>
        Products, barcode scanning, cart actions, and payments stay unavailable until this register has an active matching shift.
      </Text>
      <Text style={styles.registerLabel}>{storeName} · {registerName}</Text>
      {available ? (
        <TindioButton onPress={onOpenShift} style={styles.openButton}>Open shift</TindioButton>
      ) : (
        <View style={styles.restriction}><Text style={styles.restrictionText}>{restriction}</Text></View>
      )}
    </View>
  );
}

function formatItemCount(count: number) {
  return `${count} ${count === 1 ? "item" : "items"}`;
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    backgroundColor: tindioTheme.color.surface.card,
    borderBottomColor: tindioTheme.color.border.default,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: tindioTheme.space.sm,
    minHeight: 64,
    paddingHorizontal: tindioTheme.space.md,
    paddingVertical: tindioTheme.space.xs,
  },
  headerCompact: { gap: tindioTheme.space.xs, paddingHorizontal: tindioTheme.space.sm },
  menuButton: {
    alignItems: "center",
    backgroundColor: tindioTheme.color.surface.app,
    borderRadius: tindioTheme.radius.md,
    height: tindioTheme.target.minimum,
    justifyContent: "center",
    width: tindioTheme.target.minimum,
  },
  menuGlyph: { color: tindioTheme.color.brand.ink, fontSize: 28, lineHeight: 30 },
  ticketCopy: { flex: 1, minWidth: 0 },
  ticketTitle: { ...tindioTheme.typography.role.label, color: tindioTheme.color.content.primary },
  headerMeta: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.content.secondary },
  headerSpacer: { flex: 1 },
  identity: { alignItems: "center", flexDirection: "row", gap: tindioTheme.space.sm, maxWidth: "48%" },
  identityPhone: { maxWidth: "38%" },
  brandMark: {
    alignItems: "center",
    backgroundColor: tindioTheme.color.brand.primary,
    borderRadius: tindioTheme.radius.md,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  brandMarkLabel: { ...tindioTheme.typography.role.section, color: tindioTheme.color.content.inverse },
  identityCopy: { flexShrink: 1, minWidth: 0 },
  identityTitle: { ...tindioTheme.typography.role.label, color: tindioTheme.color.content.primary },
  gate: {
    alignItems: "center",
    alignSelf: "center",
    justifyContent: "center",
    maxWidth: 560,
    minHeight: 520,
    paddingHorizontal: tindioTheme.space.md,
    paddingVertical: tindioTheme.space.xxl,
    width: "100%",
  },
  gatePhone: { minHeight: 0, paddingVertical: tindioTheme.space.xl },
  lockTile: {
    alignItems: "center",
    backgroundColor: tindioTheme.color.status.danger.surface,
    borderRadius: tindioTheme.radius.lg,
    height: 64,
    justifyContent: "flex-end",
    paddingBottom: 15,
    width: 64,
  },
  lockShackle: {
    borderColor: tindioTheme.color.status.danger.content,
    borderTopLeftRadius: 9,
    borderTopRightRadius: 9,
    borderWidth: 2,
    height: 17,
    position: "absolute",
    top: 14,
    width: 20,
  },
  lockBody: {
    alignItems: "center",
    backgroundColor: tindioTheme.color.status.danger.content,
    borderRadius: 4,
    height: 22,
    justifyContent: "center",
    width: 27,
  },
  lockKeyhole: { backgroundColor: tindioTheme.color.status.danger.surface, borderRadius: 3, height: 7, width: 4 },
  gateEyebrow: {
    ...tindioTheme.typography.role.caption,
    color: tindioTheme.color.status.danger.content,
    fontWeight: "800",
    letterSpacing: 2,
    marginTop: tindioTheme.space.lg,
  },
  gateTitle: {
    ...tindioTheme.typography.role.display,
    color: tindioTheme.color.content.primary,
    marginTop: tindioTheme.space.xs,
    textAlign: "center",
  },
  gateDescription: {
    ...tindioTheme.typography.role.body,
    color: tindioTheme.color.content.secondary,
    marginTop: tindioTheme.space.sm,
    textAlign: "center",
  },
  registerLabel: {
    ...tindioTheme.typography.role.label,
    color: tindioTheme.color.content.primary,
    marginTop: tindioTheme.space.lg,
    textAlign: "center",
  },
  openButton: { marginTop: tindioTheme.space.lg, minWidth: 152 },
  restriction: {
    backgroundColor: tindioTheme.color.status.danger.surface,
    borderColor: tindioTheme.color.status.danger.border,
    borderRadius: tindioTheme.radius.md,
    borderWidth: 1,
    marginTop: tindioTheme.space.lg,
    padding: tindioTheme.space.sm,
  },
  restrictionText: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.status.danger.content, textAlign: "center" },
  pressed: { opacity: 0.72 },
});
