import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { PosCartLine } from "../../../../../src/contracts/pos";
import { formatMoney } from "./cashier-format";
import { normalizeQuantity } from "./cashier-validation";

export function CashierCartLine({
  line,
  currencyCode,
  canEditQuantity,
  canRemove,
  onQuantity,
  onNote,
  onReconfigure,
  onRemove,
}: {
  line: PosCartLine;
  currencyCode: string;
  canEditQuantity: boolean;
  canRemove: boolean;
  onQuantity(value: number): void;
  onNote(value: string | null): void;
  onReconfigure(): void;
  onRemove(): void;
}) {
  const [quantity, setQuantity] = useState(String(line.quantity));
  const [note, setNote] = useState(line.itemNote ?? "");

  useEffect(() => setQuantity(String(line.quantity)), [line.quantity]);
  useEffect(() => setNote(line.itemNote ?? ""), [line.itemNote]);

  const baseMinor = line.manualPriceMinor ?? line.priceMinor;
  const modifierMinor = (line.modifiers ?? []).reduce((sum, modifier) => sum + modifier.priceMinor, 0);
  const lineMinor = Math.round((baseMinor + modifierMinor) * line.quantity);

  const commitQuantity = () => {
    const normalized = normalizeQuantity(quantity, line.allowFractionalQuantity);

    if (normalized === null) {
      setQuantity(String(line.quantity));
      return;
    }

    onQuantity(normalized);
  };

  return (
    <View>
      <Text>
        {line.productName}
        {line.variantName ? ` / ${line.variantName}` : ""}
      </Text>

      <Text>{formatMoney(lineMinor, currencyCode)}</Text>

      {line.modifiers?.length ? (
        <Text>
          {line.modifiers.map((modifier) => modifier.name).join(", ")}
        </Text>
      ) : null}

      {line.isVariablePrice ? (
        <Text>Manual price: {formatMoney(line.manualPriceMinor ?? line.priceMinor, currencyCode)}</Text>
      ) : null}

      <TextInput
        value={quantity}
        onChangeText={setQuantity}
        onEndEditing={commitQuantity}
        editable={canEditQuantity}
        keyboardType="decimal-pad"
        placeholder="Quantity"
      />

      <TextInput
        value={note}
        onChangeText={setNote}
        onEndEditing={() => onNote(note.trim() || null)}
        maxLength={500}
        placeholder="Line note"
      />

      {line.isVariablePrice || line.hasModifiers ? (
        <Pressable onPress={onReconfigure}>
          <Text>Edit price / modifiers</Text>
        </Pressable>
      ) : null}

      <Pressable disabled={!canRemove} onPress={onRemove}>
        <Text>Remove</Text>
      </Pressable>
    </View>
  );
}
