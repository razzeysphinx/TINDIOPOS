import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { PosCartLine } from "@tindio/contracts";

import { TindioButton } from "../../ui/tindio-button";
import { TindioInput } from "../../ui/tindio-input";
import { tindioTheme } from "../../ui/theme";
import { localCartLineTotalMinor } from "../local-first/local-cart";
import { formatMoney } from "./cashier-format";
import { normalizeQuantity } from "./cashier-validation";

type CashierCartLineProps = {
  line: PosCartLine;
  currencyCode: string;
  canEditQuantity: boolean;
  canRemove: boolean;
  onQuantity(value: number): void;
  onNote(value: string | null): void;
  onReconfigure(): void;
  onRemove(): void;
};

export function CashierCartLine({
  line,
  currencyCode,
  canEditQuantity,
  canRemove,
  onQuantity,
  onNote,
  onReconfigure,
  onRemove,
}: CashierCartLineProps) {
  const [quantity, setQuantity] = useState(String(line.quantity));
  const [note, setNote] = useState(line.itemNote ?? "");
  const step = line.allowFractionalQuantity ? 0.1 : 1;
  const lineMinor = localCartLineTotalMinor(line);

  const commitQuantity = () => {
    const normalized = normalizeQuantity(quantity, line.allowFractionalQuantity);

    if (normalized === null) {
      setQuantity(String(line.quantity));
      return;
    }

    setQuantity(String(normalized));
    onQuantity(normalized);
  };

  const changeQuantity = (direction: -1 | 1) => {
    const next = Math.round((line.quantity + direction * step) * 1_000) / 1_000;
    const normalized = normalizeQuantity(next, line.allowFractionalQuantity);
    if (normalized === null) return;
    setQuantity(String(normalized));
    onQuantity(normalized);
  };

  const productLabel = `${line.productName}${line.variantName ? ` / ${line.variantName}` : ""}`;

  return (
    <View accessibilityLabel={`${productLabel} cart line`} style={styles.card}>
      <View style={styles.heading}>
        <View style={styles.productCopy}>
          <Text style={styles.productName}>{productLabel}</Text>
          <Text style={styles.unitPrice}>
            {formatMoney(line.manualPriceMinor ?? line.priceMinor, currencyCode)} / {line.unit}
          </Text>
        </View>
        <Text accessibilityLabel={`Line total ${formatMoney(lineMinor, currencyCode)}`} style={styles.lineTotal}>
          {formatMoney(lineMinor, currencyCode)}
        </Text>
      </View>

      {line.modifiers?.length ? (
        <Text style={styles.detail}>Options: {line.modifiers.map((modifier) => modifier.name).join(", ")}</Text>
      ) : null}

      {line.isVariablePrice ? (
        <Text style={styles.detail}>
          Entered price: {formatMoney(line.manualPriceMinor ?? line.priceMinor, currencyCode)}
        </Text>
      ) : null}

      <View style={styles.quantityRow}>
        <TindioButton
          accessibilityLabel={`Decrease ${line.productName} quantity`}
          disabled={!canEditQuantity || line.quantity <= step}
          onPress={() => changeQuantity(-1)}
          style={styles.stepButton}
          variant="secondary"
        >
          -
        </TindioButton>
        <View style={styles.quantityInput}>
          <TindioInput
            accessibilityLabel={`${line.productName} quantity`}
            editable={canEditQuantity}
            keyboardType="decimal-pad"
            label="Quantity"
            onChangeText={setQuantity}
            onEndEditing={commitQuantity}
            placeholder="Quantity"
            value={quantity}
          />
        </View>
        <TindioButton
          accessibilityLabel={`Increase ${line.productName} quantity`}
          disabled={!canEditQuantity}
          onPress={() => changeQuantity(1)}
          style={styles.stepButton}
          variant="secondary"
        >
          +
        </TindioButton>
      </View>

      <TindioInput
        accessibilityLabel={`${line.productName} line note`}
        helperText="Notes require a connection at checkout."
        label="Line note"
        maxLength={500}
        onChangeText={setNote}
        onEndEditing={() => onNote(note.trim() || null)}
        placeholder="Add a preparation note"
        value={note}
      />

      <View style={styles.actions}>
        {line.isVariablePrice || line.hasModifiers ? (
          <TindioButton
            accessibilityLabel={`Edit price or modifiers for ${line.productName}`}
            onPress={onReconfigure}
            style={styles.action}
            variant="secondary"
          >
            Edit price or options
          </TindioButton>
        ) : null}
        <TindioButton
          accessibilityLabel={`Remove ${line.productName}`}
          disabled={!canRemove}
          onPress={onRemove}
          style={styles.action}
          variant="destructive"
        >
          Remove item
        </TindioButton>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: tindioTheme.color.surface.card,
    borderColor: tindioTheme.color.border.default,
    borderRadius: tindioTheme.radius.lg,
    borderWidth: 1,
    gap: tindioTheme.space.sm,
    padding: tindioTheme.space.md,
  },
  heading: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: tindioTheme.space.sm,
    justifyContent: "space-between",
  },
  productCopy: { flex: 1, gap: tindioTheme.space.xxs },
  productName: { ...tindioTheme.typography.role.label, color: tindioTheme.color.content.primary },
  unitPrice: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.content.secondary },
  lineTotal: { ...tindioTheme.typography.role.numeric, color: tindioTheme.color.brand.ink },
  detail: { ...tindioTheme.typography.role.caption, color: tindioTheme.color.content.secondary },
  quantityRow: { alignItems: "flex-end", flexDirection: "row", gap: tindioTheme.space.xs },
  quantityInput: { flex: 1 },
  stepButton: { minWidth: tindioTheme.target.minimum, paddingHorizontal: tindioTheme.space.xs },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: tindioTheme.space.xs },
  action: { flexGrow: 1 },
});
