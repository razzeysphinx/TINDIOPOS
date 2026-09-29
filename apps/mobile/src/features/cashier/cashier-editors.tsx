import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type {
  PosCatalogItem,
  PosModifierGroup,
  PosModifierOption,
} from "../../../../../src/contracts/pos";
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

  return (
    <View>
      <Text>VARIABLE PRICE</Text>
      <Text>{item.productName}{item.variantName ? ` / ${item.variantName}` : ""}</Text>
      <TextInput
        value={value}
        onChangeText={setValue}
        keyboardType="decimal-pad"
        placeholder="0.00"
      />
      <Pressable onPress={onCancel}>
        <Text>Cancel</Text>
      </Pressable>
      <Pressable disabled={!valid} onPress={() => valid && onContinue(parsed)}>
        <Text>Continue</Text>
      </Pressable>
    </View>
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
      if (selectedInGroup.length >= group.maxSelections) {
        return current;
      }

      next.add(option.id);
      return next;
    });
  };

  const selectedOptions = groups.flatMap((group) =>
    group.options.filter((option) => selected.has(option.id)),
  );

  return (
    <View>
      <Text>MODIFIERS</Text>
      <Text>{item.productName}{item.variantName ? ` / ${item.variantName}` : ""}</Text>

      {groups.map((group) => {
        const count = group.options.filter((option) => selected.has(option.id)).length;

        return (
          <View key={group.id}>
            <Text>
              {group.name} — {count}/{group.maxSelections}
              {group.minSelections > 0 ? ` — minimum ${group.minSelections}` : ""}
            </Text>

            {group.options.map((option) => (
              <Pressable key={option.id} onPress={() => toggle(group, option)}>
                <Text>
                  {selected.has(option.id) ? "✓ " : ""}
                  {option.name}
                  {option.priceMinor ? ` +${minorToMoney(option.priceMinor)}` : ""}
                </Text>
              </Pressable>
            ))}
          </View>
        );
      })}

      <Pressable onPress={onCancel}>
        <Text>Cancel</Text>
      </Pressable>
      <Pressable disabled={!valid} onPress={() => valid && onConfirm(selectedOptions)}>
        <Text>Apply modifiers</Text>
      </Pressable>
    </View>
  );
}
