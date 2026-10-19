import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type {
  PosCatalogItem,
  PosModifierGroup,
  PosModifierOption,
} from "@tindio/contracts";

import { TindioButton } from "../../ui/tindio-button";
import { TindioInput } from "../../ui/tindio-input";
import { tindioTheme } from "../../ui/theme";
import { minorToMoney, parseMoneyToMinor } from "./cashier-validation";

export function VariablePriceEditor({
  item,
  initialMinor,
  onCancel,
  onContinue,
}: {
  item: PosCatalogItem;
  initialMinor: number | null;
  onCancel(): void;
  onContinue(minor: number): void;
}) {
  const [value, setValue] = useState(initialMinor ? minorToMoney(initialMinor) : "");
  const parsed = parseMoneyToMinor(value);
  const valid = parsed !== null && parsed > 0 && parsed <= 9_999_999_999;
  const productLabel = `${item.productName}${item.variantName ? ` / ${item.variantName}` : ""}`;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.fill}>
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.screen}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        testID="variable-price-scroll"
      >
        <View style={styles.editorCard}>
          <Text style={styles.eyebrow}>ITEM SETUP</Text>
          <Text accessibilityRole="header" style={styles.title}>Set item price</Text>
          <Text style={styles.productName}>{productLabel}</Text>
          <Text style={styles.description}>Enter the price for this item before adding it to the cart.</Text>
          <TindioInput
            accessibilityLabel={`Price for ${item.productName}`}
            error={value && !valid ? "Enter an amount greater than zero with no more than two decimal places." : undefined}
            keyboardType="decimal-pad"
            label="Item price"
            onChangeText={setValue}
            placeholder="0.00"
            returnKeyType="done"
            value={value}
          />
          <View style={styles.actions}>
            <TindioButton onPress={onCancel} style={styles.action} variant="ghost">Cancel</TindioButton>
            <TindioButton disabled={!valid} onPress={() => valid && onContinue(parsed)} style={styles.action}>
              Continue
            </TindioButton>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function ModifierPicker({
  item,
  groups,
  initialIds,
  onCancel,
  onConfirm,
}: {
  item: PosCatalogItem;
  groups: PosModifierGroup[];
  initialIds: string[];
  onCancel(): void;
  onConfirm(options: PosModifierOption[]): void;
}) {
  const [selected, setSelected] = useState(() => new Set(initialIds));
  const productLabel = `${item.productName}${item.variantName ? ` / ${item.variantName}` : ""}`;

  const valid = useMemo(
    () => groups.every((group) => {
      const count = group.options.filter((option) => selected.has(option.id)).length;
      return count >= group.minSelections && count <= group.maxSelections;
    }),
    [groups, selected],
  );

  const toggle = (group: PosModifierGroup, option: PosModifierOption) => {
    setSelected((current) => {
      const next = new Set(current);

      if (next.has(option.id)) {
        next.delete(option.id);
        return next;
      }

      const selectedInGroup = group.options.filter((candidate) => next.has(candidate.id));
      if (selectedInGroup.length >= group.maxSelections) return current;

      next.add(option.id);
      return next;
    });
  };

  const selectedOptions = groups.flatMap((group) =>
    group.options.filter((option) => selected.has(option.id)),
  );

  return (
    <ScrollView contentContainerStyle={styles.screen} testID="modifier-picker-scroll">
      <View style={styles.editorCard}>
        <Text style={styles.eyebrow}>ITEM SETUP</Text>
        <Text accessibilityRole="header" style={styles.title}>Choose options</Text>
        <Text style={styles.productName}>{productLabel}</Text>
        <Text style={styles.description}>Complete each required group before applying these options.</Text>

        {groups.map((group) => {
          const count = group.options.filter((option) => selected.has(option.id)).length;
          const groupValid = count >= group.minSelections && count <= group.maxSelections;

          return (
            <View key={group.id} style={styles.group}>
              <View style={styles.groupHeading}>
                <Text accessibilityRole="header" style={styles.groupTitle}>{group.name}</Text>
                <Text style={[styles.groupRequirement, !groupValid ? styles.groupRequirementOpen : null]}>
                  {group.minSelections === group.maxSelections
                    ? `Choose ${group.maxSelections}`
                    : `Choose ${group.minSelections}-${group.maxSelections}`} / {count} selected
                </Text>
              </View>

              {group.options.map((option) => {
                const isSelected = selected.has(option.id);
                const optionPrice = option.priceMinor ? ` +${minorToMoney(option.priceMinor)}` : "";

                return (
                  <Pressable
                    accessibilityLabel={`${option.name}${optionPrice}`}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isSelected }}
                    key={option.id}
                    onPress={() => toggle(group, option)}
                    style={({ pressed }) => [
                      styles.option,
                      isSelected ? styles.optionSelected : null,
                      pressed ? styles.pressed : null,
                    ]}
                  >
                    <View style={[styles.checkbox, isSelected ? styles.checkboxSelected : null]}>
                      <Text style={styles.checkmark}>{isSelected ? "✓" : ""}</Text>
                    </View>
                    <Text style={styles.optionName}>{option.name}</Text>
                    {option.priceMinor ? <Text style={styles.optionPrice}>+{minorToMoney(option.priceMinor)}</Text> : null}
                  </Pressable>
                );
              })}
            </View>
          );
        })}

        <View style={styles.actions}>
          <TindioButton onPress={onCancel} style={styles.action} variant="ghost">Cancel</TindioButton>
          <TindioButton disabled={!valid} onPress={() => valid && onConfirm(selectedOptions)} style={styles.action}>
            Apply options
          </TindioButton>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  screen: { backgroundColor: tindioTheme.color.surface.app, flexGrow: 1, padding: tindioTheme.space.md, paddingBottom: tindioTheme.space.xxl },
  editorCard: { ...tindioTheme.shadow.card, alignSelf: "center", backgroundColor: tindioTheme.color.surface.card, borderColor: tindioTheme.color.border.default, borderRadius: tindioTheme.radius.lg, borderWidth: 1, gap: tindioTheme.space.md, maxWidth: 640, padding: tindioTheme.space.lg, width: "100%" },
  eyebrow: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.brand.primary, letterSpacing: 1.2 },
  title: { ...tindioTheme.typography.role.title, color: tindioTheme.color.content.primary },
  productName: { ...tindioTheme.typography.role.section, color: tindioTheme.color.brand.ink },
  description: { ...tindioTheme.typography.role.body, color: tindioTheme.color.content.secondary },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: tindioTheme.space.sm },
  action: { flexGrow: 1 },
  group: { borderColor: tindioTheme.color.border.default, borderRadius: tindioTheme.radius.md, borderWidth: 1, gap: tindioTheme.space.xs, padding: tindioTheme.space.sm },
  groupHeading: { gap: tindioTheme.space.xxs },
  groupTitle: { ...tindioTheme.typography.role.section, color: tindioTheme.color.content.primary },
  groupRequirement: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.status.success.content },
  groupRequirementOpen: { color: tindioTheme.color.status.warning.content },
  option: { alignItems: "center", borderColor: tindioTheme.color.border.default, borderRadius: tindioTheme.radius.md, borderWidth: 1, flexDirection: "row", gap: tindioTheme.space.sm, minHeight: tindioTheme.target.minimum, padding: tindioTheme.space.sm },
  optionSelected: { backgroundColor: tindioTheme.color.status.success.surface, borderColor: tindioTheme.color.status.success.border },
  checkbox: { alignItems: "center", borderColor: tindioTheme.color.border.strong, borderRadius: tindioTheme.radius.sm, borderWidth: 1, height: 24, justifyContent: "center", width: 24 },
  checkboxSelected: { backgroundColor: tindioTheme.color.brand.primary, borderColor: tindioTheme.color.brand.primary },
  checkmark: { ...tindioTheme.typography.role.label, color: tindioTheme.color.content.inverse },
  optionName: { ...tindioTheme.typography.role.body, color: tindioTheme.color.content.primary, flex: 1 },
  optionPrice: { ...tindioTheme.typography.role.label, color: tindioTheme.color.content.secondary },
  pressed: { opacity: 0.8 },
});
