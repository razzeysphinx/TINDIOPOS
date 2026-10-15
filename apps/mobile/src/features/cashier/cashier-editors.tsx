import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import type {
  PosCatalogItem,
  PosModifierGroup,
  PosModifierOption,
} from "../../../../../src/contracts/pos";
import { minorToMoney, parseMoneyToMinor } from "./cashier-validation";

const actionStyle = { minHeight: 48, justifyContent: "center" as const };

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

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1 }}
    >
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ flexGrow: 1, gap: 12, padding: 20, paddingBottom: 64 }}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        testID="variable-price-scroll"
      >
        <Text accessibilityRole="header">VARIABLE PRICE</Text>
        <Text>{item.productName}{item.variantName ? ` / ${item.variantName}` : ""}</Text>
        <TextInput
          accessibilityLabel={`Price for ${item.productName}`}
          value={value}
          onChangeText={setValue}
          keyboardType="decimal-pad"
          placeholder="0.00"
          returnKeyType="done"
          style={{ minHeight: 48 }}
        />
        <Pressable accessibilityRole="button" onPress={onCancel} style={actionStyle}>
          <Text>Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={!valid}
          onPress={() => valid && onContinue(parsed)}
          style={actionStyle}
        >
          <Text>Continue</Text>
        </Pressable>
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

  const valid = useMemo(
    () =>
      groups.every((group) => {
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
    <ScrollView
      contentContainerStyle={{ flexGrow: 1, gap: 12, padding: 20, paddingBottom: 64 }}
      testID="modifier-picker-scroll"
    >
      <Text accessibilityRole="header">MODIFIERS</Text>
      <Text>{item.productName}{item.variantName ? ` / ${item.variantName}` : ""}</Text>

      {groups.map((group) => {
        const count = group.options.filter((option) => selected.has(option.id)).length;

        return (
          <View key={group.id}>
            <Text>
              {group.name} — {count}/{group.maxSelections}
              {group.minSelections > 0 ? ` — minimum ${group.minSelections}` : ""}
            </Text>

            {group.options.map((option) => {
              const isSelected = selected.has(option.id);

              return (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isSelected }}
                  key={option.id}
                  onPress={() => toggle(group, option)}
                  style={actionStyle}
                >
                  <Text>
                    {isSelected ? "✓ " : ""}
                    {option.name}
                    {option.priceMinor ? ` +${minorToMoney(option.priceMinor)}` : ""}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        );
      })}

      <Pressable accessibilityRole="button" onPress={onCancel} style={actionStyle}>
        <Text>Cancel</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={!valid}
        onPress={() => valid && onConfirm(selectedOptions)}
        style={actionStyle}
      >
        <Text>Apply modifiers</Text>
      </Pressable>
    </ScrollView>
  );
}
